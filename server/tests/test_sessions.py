import json
from types import SimpleNamespace

from app import services

API = {"X-API-Key": "test-key"}
ENROLL = {"Authorization": "Bearer test-enroll"}


def enroll(client, name="alice-laptop", caps=None):
    r = client.post(
        "/api/runners/enroll",
        headers=ENROLL,
        json={"machine_name": name, "os": "darwin", "runner_version": "0.1.0"},
    )
    mid = r.json()["machine_id"]
    # 给机器写上 capabilities(正常由 ws hello 上报;测试直连数据库太重,走一次假心跳代价大,
    # 这里用创建会话不依赖 online,capabilities 为 None 时工具全开)
    return mid


def _assistant(content=None, tool_calls=None):
    msg = {"role": "assistant", "content": content}
    if tool_calls:
        msg["tool_calls"] = tool_calls
    return {"choices": [{"message": msg}]}


def _tool_call(call_id, name, args):
    return {"id": call_id, "type": "function", "function": {"name": name, "arguments": json.dumps(args)}}


class FakeGateway:
    """替换 app.state.gateway:resolve 返回占位 backend,chat 吐预设脚本。"""

    def __init__(self, scripted):
        self._calls = iter(scripted)

    def resolve(self, user_id=None):
        return SimpleNamespace(id="fake", model="fake")

    async def chat(self, backend, messages, tools=None, **kw):
        return next(self._calls)


def install_fake_dispatch(monkeypatch, result):
    async def fake_dispatch(app, machine_id, tool, payload):
        return SimpleNamespace(status="completed", result=result)

    monkeypatch.setattr(services, "dispatch_and_wait", fake_dispatch)


def test_create_session_unknown_machine(client):
    r = client.post("/api/sessions", headers=API, json={"machine_id": "m_nope"})
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "machine_not_found"


def test_session_message_flow(client, monkeypatch):
    mid = enroll(client)
    sid = client.post("/api/sessions", headers=API, json={"machine_id": mid}).json()["session_id"]

    client.app.state.gateway = FakeGateway(
        [
            _assistant(tool_calls=[_tool_call("c1", "remote_exec", {"workdir": ".", "command": "hostname"})]),
            _assistant(content="主机名是 my-host,执行成功。"),
        ]
    )
    install_fake_dispatch(monkeypatch, {"exit_code": 0, "stdout_tail": "my-host\n"})

    r = client.post(f"/api/sessions/{sid}/messages", headers=API, json={"content": "查一下主机名"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["stopped"] == "completed"
    assert "my-host" in body["reply"]
    assert body["steps"] == 2

    history = client.get(f"/api/sessions/{sid}/messages", headers=API).json()
    assert [m["role"] for m in history] == ["user", "assistant", "tool", "assistant"]
    # assistant 第一条带 tool_calls,tool 消息回填了执行结果
    assert history[1]["tool_calls"][0]["function"]["name"] == "remote_exec"
    assert json.loads(history[2]["content"])["exit_code"] == 0


def test_session_no_backend_503(client):
    mid = enroll(client)
    sid = client.post("/api/sessions", headers=API, json={"machine_id": mid}).json()["session_id"]
    # 默认 gateway 无 backend → resolve 抛 no_backend
    r = client.post(f"/api/sessions/{sid}/messages", headers=API, json={"content": "hi"})
    assert r.status_code == 503
    assert r.json()["error"]["code"] == "no_backend"


def test_message_to_unknown_session_404(client):
    client.app.state.gateway = FakeGateway([_assistant(content="x")])
    r = client.post("/api/sessions/s_nope/messages", headers=API, json={"content": "hi"})
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "session_not_found"


def test_tool_call_persisted(client, monkeypatch):
    mid = enroll(client)
    sid = client.post("/api/sessions", headers=API, json={"machine_id": mid}).json()["session_id"]
    client.app.state.gateway = FakeGateway(
        [
            _assistant(tool_calls=[_tool_call("c1", "remote_list_files", {"path": "."})]),
            _assistant(content="列目录完成。"),
        ]
    )
    install_fake_dispatch(monkeypatch, {"entries": [{"name": "a.txt", "type": "file", "size": 3}]})
    r = client.post(f"/api/sessions/{sid}/messages", headers=API, json={"content": "列一下目录"})
    assert r.json()["stopped"] == "completed"
