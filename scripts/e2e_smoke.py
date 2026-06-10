"""端到端冒烟测试:真实进程跑通 enroll → 注册 → 心跳 → 五个工具 → 越界拒绝。

用法(用 server 的 venv 跑,里面有 httpx):
    server/.venv/bin/python scripts/e2e_smoke.py
"""

import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parent.parent
PORT = 8701
BASE = f"http://127.0.0.1:{PORT}"
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


def run_task(http, machine_id, tool, payload, expect_status="completed"):
    r = http.post(f"{BASE}/api/tasks", headers=API, json={"machine_id": machine_id, "tool": tool, "payload": payload})
    assert r.status_code == 200, f"下发失败: {r.status_code} {r.text}"
    tid = r.json()["task_id"]
    task = wait_until(
        lambda: (lambda t: t if t["status"] not in ("queued", "dispatched", "running") else None)(
            http.get(f"{BASE}/api/tasks/{tid}", headers=API).json()
        ),
        desc=f"任务 {tool} 终态",
    )
    assert task["status"] == expect_status, f"{tool}: 期望 {expect_status},实际 {task['status']} {task['result']}"
    return tid, task


def main() -> int:
    tmp = Path(tempfile.mkdtemp(prefix="agent-e2e-"))
    work = tmp / "work"
    work.mkdir()
    (tmp / "config.yaml").write_text(
        f"""
server_url: {BASE}
machine_name: e2e-machine
enrollment_token: e2e-enroll
allowed_roots:
  - {work}
blocked_paths: []
heartbeat_interval_seconds: 2
""",
        encoding="utf-8",
    )

    env = os.environ | {
        "AGENT_ENROLLMENT_TOKEN": "e2e-enroll",
        "AGENT_API_KEY": "e2e-key",
        "AGENT_DATABASE_URL": f"sqlite+aiosqlite:///{tmp}/e2e.db",
    }
    server = subprocess.Popen(
        [str(ROOT / "server/.venv/bin/uvicorn"), "app.main:app", "--app-dir", str(ROOT / "server"),
         "--port", str(PORT), "--log-level", "warning"],
        env=env, cwd=tmp,
    )
    runner = None
    try:
        with httpx.Client(timeout=5) as http:
            wait_until(lambda: http.get(f"{BASE}/api/machines", headers=API).status_code == 200, desc="server 就绪")
            print("[1] server 已就绪")

            runner = subprocess.Popen(
                [str(ROOT / "runner/.venv/bin/python"), "-m", "agent_runner",
                 "--config", str(tmp / "config.yaml"), "--state", str(tmp / "state.json")],
                cwd=tmp,
            )
            machine = wait_until(
                lambda: next((m for m in http.get(f"{BASE}/api/machines", headers=API).json() if m["status"] == "online"), None),
                desc="runner 上线",
            )
            mid = machine["machine_id"]
            print(f"[2] runner 已注册并上线: {mid} capabilities={machine['capabilities']}")

            _, task = run_task(http, mid, "remote_exec", {"workdir": str(work), "command": "hostname && echo e2e-ok"})
            tid = task["task_id"]
            out = http.get(f"{BASE}/api/tasks/{tid}/output", headers=API).json()
            assert "e2e-ok" in out["stdout"], out
            assert task["result"]["exit_code"] == 0
            print(f"[3] remote_exec 通过: stdout={out['stdout'].strip()!r}")

            run_task(http, mid, "remote_write_file", {"path": str(work / "demo.txt"), "content": "版本 = 1\n"})
            _, task = run_task(http, mid, "remote_read_file", {"path": str(work / "demo.txt")})
            assert task["result"]["content"] == "版本 = 1\n"
            print("[4] remote_write_file / remote_read_file 通过")

            _, task = run_task(http, mid, "remote_patch_file",
                               {"path": str(work / "demo.txt"), "old_string": "= 1", "new_string": "= 2"})
            assert "+版本 = 2" in task["result"]["diff"]
            assert (work / "demo.txt").read_text() == "版本 = 2\n"
            print("[5] remote_patch_file 通过(磁盘文件已验证)")

            _, task = run_task(http, mid, "remote_list_files", {"path": str(work)})
            assert any(e["name"] == "demo.txt" for e in task["result"]["entries"])
            print("[6] remote_list_files 通过")

            _, task = run_task(http, mid, "remote_read_file", {"path": "/etc/passwd"}, expect_status="failed")
            assert task["result"]["error_code"] == "path_denied"
            _, task = run_task(http, mid, "remote_exec", {"workdir": "/tmp", "command": "id"}, expect_status="failed")
            assert task["result"]["error_code"] == "path_denied"
            print("[7] 越界路径全部被 Runner 本地策略拒绝(path_denied)")

            _, task = run_task(http, mid, "remote_exec",
                               {"workdir": str(work), "command": "sleep 30", "timeout_seconds": 1},
                               expect_status="timeout")
            print("[8] 超时任务正确返回 timeout")

        print("\nE2E SMOKE: 全部通过 ✔")
        return 0
    finally:
        for proc in (runner, server):
            if proc is not None:
                proc.terminate()
                try:
                    proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    proc.kill()


if __name__ == "__main__":
    sys.exit(main())
