"""M3 端到端:真实 Server + Runner + 假模型,验证「用户消息 → 模型调 remote_exec → 回复」全链路。

用 server 的 venv 运行:
    server/.venv/bin/python scripts/e2e_agent.py
"""

import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parent.parent
SERVER_PORT = 8703
MODEL_PORT = 8704
BASE = f"http://127.0.0.1:{SERVER_PORT}"
API = {"X-API-Key": "e2e-key"}


def wait_until(fn, timeout=20.0, interval=0.3, desc="条件"):
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        try:
            last = fn()
            if last:
                return last
        except Exception as exc:
            last = exc
        time.sleep(interval)
    raise TimeoutError(f"等待{desc}超时,最后状态: {last!r}")


def main() -> int:
    tmp = Path(tempfile.mkdtemp(prefix="agent-m3-"))
    work = tmp / "work"
    work.mkdir()

    (tmp / "config.yaml").write_text(
        f"server_url: {BASE}\nmachine_name: m3-machine\nenrollment_token: e2e-enroll\n"
        f"allowed_roots:\n  - {work}\nheartbeat_interval_seconds: 2\n",
        encoding="utf-8",
    )
    (tmp / "models.yaml").write_text(
        f"backends:\n  - id: fake\n    base_url: http://127.0.0.1:{MODEL_PORT}/v1\n"
        f"    model: fake-model\n    api_key: x\n    max_concurrency: 2\ndefault_backend_id: fake\n",
        encoding="utf-8",
    )

    server_env = os.environ | {
        "AGENT_ENROLLMENT_TOKEN": "e2e-enroll",
        "AGENT_API_KEY": "e2e-key",
        "AGENT_DATABASE_URL": f"sqlite+aiosqlite:///{tmp}/m3.db",
        "AGENT_MODELS_CONFIG_PATH": str(tmp / "models.yaml"),
    }
    model_env = os.environ | {"E2E_WORKDIR": str(work)}

    procs = []
    try:
        procs.append(subprocess.Popen(
            [str(ROOT / "server/.venv/bin/uvicorn"), "fake_model_server:app",
             "--app-dir", str(ROOT / "scripts"), "--port", str(MODEL_PORT), "--log-level", "warning"],
            env=model_env))
        procs.append(subprocess.Popen(
            [str(ROOT / "server/.venv/bin/uvicorn"), "app.main:app", "--app-dir", str(ROOT / "server"),
             "--port", str(SERVER_PORT), "--log-level", "warning"], env=server_env, cwd=tmp))
        with httpx.Client(timeout=5) as http:
            wait_until(lambda: http.get(f"{BASE}/api/machines", headers=API).status_code == 200, desc="server 就绪")
            wait_until(lambda: httpx.get(f"http://127.0.0.1:{MODEL_PORT}/openapi.json").status_code == 200,
                       desc="假模型就绪")
            print("[1] server + 假模型已就绪")

            procs.append(subprocess.Popen(
                [str(ROOT / "runner/.venv/bin/python"), "-m", "agent_runner",
                 "--config", str(tmp / "config.yaml"), "--state", str(tmp / "state.json")], cwd=tmp))
            machine = wait_until(
                lambda: next((m for m in http.get(f"{BASE}/api/machines", headers=API).json()
                              if m["status"] == "online"), None), desc="runner 上线")
            mid = machine["machine_id"]
            print(f"[2] runner 上线: {mid}")

            sid = http.post(f"{BASE}/api/sessions", headers=API, json={"machine_id": mid}).json()["session_id"]
            print(f"[3] 会话已创建: {sid}")

            r = http.post(f"{BASE}/api/sessions/{sid}/messages", headers=API,
                          json={"content": "帮我在工作目录跑个命令验证一下"}, timeout=30)
            assert r.status_code == 200, r.text
            body = r.json()
            print(f"[4] Agent 回复: stopped={body['stopped']} steps={body['steps']}")
            print(f"    reply = {body['reply']!r}")
            assert body["stopped"] == "completed"
            assert "agent-e2e-ok" in body["reply"]

            history = http.get(f"{BASE}/api/sessions/{sid}/messages", headers=API).json()
            roles = [m["role"] for m in history]
            print(f"[5] 消息历史落库: {roles}")
            assert roles == ["user", "assistant", "tool", "assistant"]
            import json as _json
            tool_result = _json.loads(history[2]["content"])
            assert tool_result["exit_code"] == 0 and "agent-e2e-ok" in tool_result["stdout_tail"]
            print("[6] 工具结果正确回填(真实 Runner 执行,exit_code=0)")

        print("\nM3 AGENT E2E: 全部通过 ✔  (真实 Server+Runner+模型驱动的远程任务闭环)")
        return 0
    finally:
        for p in reversed(procs):
            p.terminate()
            try:
                p.wait(timeout=5)
            except subprocess.TimeoutExpired:
                p.kill()


if __name__ == "__main__":
    sys.exit(main())
