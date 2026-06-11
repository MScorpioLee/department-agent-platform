import json
from types import SimpleNamespace

from app import services
from app.redaction import redact, redact_obj


def admin_header(client):
    tok = client.post("/api/auth/login", json={"username": "admin", "password": "adminpass"}).json()["token"]
    return {"Authorization": f"Bearer {tok}"}


# ---------- 脱敏 ----------


def test_redact_bearer_and_keys():
    assert "«REDACTED»" in redact("Authorization: Bearer abcdef1234567890XYZ")
    assert "REDACTED" in redact("my key is sk-1234567890abcdefghij")
    assert "REDACTED" in redact("export DEEPSEEK_API_KEY=sk-abc123def456ghi789")
    assert redact("普通输出 hello world") == "普通输出 hello world"


def test_redact_password_kv():
    out = redact('{"password": "supersecret"}')
    assert "supersecret" not in out
    assert "REDACTED" in out


def test_redact_private_key_block():
    text = "-----BEGIN RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY-----"
    assert redact(text) == "«REDACTED-PRIVATE-KEY»"


def test_redact_obj_recurses():
    obj = {"command": "curl -H 'Authorization: Bearer tok_abcdefghijkl'", "nested": ["sk-abcdefghijklmnop"]}
    out = redact_obj(obj)
    assert "tok_abcdefghijkl" not in json.dumps(out, ensure_ascii=False)
    assert "REDACTED" in json.dumps(out, ensure_ascii=False)


def test_redact_none():
    assert redact(None) is None


# ---------- 审计接口鉴权 ----------


def test_audit_requires_admin(client):
    # 普通用户被拒
    client.post("/api/users", headers=admin_header(client), json={"username": "u1", "password": "pass1234"})
    utok = client.post("/api/auth/login", json={"username": "u1", "password": "pass1234"}).json()["token"]
    r = client.get("/api/audit/usage", headers={"Authorization": f"Bearer {utok}"})
    assert r.status_code == 403


def test_audit_usage_empty(client):
    r = client.get("/api/audit/usage", headers=admin_header(client))
    assert r.status_code == 200
    assert r.json() == {"total_tokens": 0, "by_user_backend": []}


def _assistant(content=None, tool_calls=None):
    msg = {"role": "assistant", "content": content}
    if tool_calls:
        msg["tool_calls"] = tool_calls
    return {"choices": [{"message": msg}], "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15}}


class FakeGateway:
    def __init__(self, scripted):
        self._calls = iter(scripted)

    def resolve(self, user_id=None):
        return SimpleNamespace(id="fake-backend", model="fake-model")

    async def chat(self, backend, messages, tools=None, **kw):
        return next(self._calls)


def test_usage_recorded_after_turn(client, monkeypatch):
    h = admin_header(client)
    mid = client.post(
        "/api/runners/enroll",
        headers={"Authorization": "Bearer test-enroll"},
        json={"machine_name": "m1", "os": "darwin"},
    ).json()["machine_id"]
    sid = client.post("/api/sessions", headers=h, json={"machine_id": mid}).json()["session_id"]

    client.app.state.gateway = FakeGateway([_assistant(content="你好,有什么需要?")])
    r = client.post(f"/api/sessions/{sid}/messages", headers=h, json={"content": "hi"})
    assert r.status_code == 200, r.text

    usage = client.get("/api/audit/usage", headers=h).json()
    assert usage["total_tokens"] == 15
    assert usage["by_user_backend"][0]["backend_id"] == "fake-backend"
    assert usage["by_user_backend"][0]["total_tokens"] == 15


def test_audit_commands_redacted(client, monkeypatch):
    h = admin_header(client)
    mid = client.post(
        "/api/runners/enroll",
        headers={"Authorization": "Bearer test-enroll"},
        json={"machine_name": "m1", "os": "darwin"},
    ).json()["machine_id"]
    sid = client.post("/api/sessions", headers=h, json={"machine_id": mid}).json()["session_id"]

    # 让模型调一次 remote_exec,命令里含一个伪 token
    tool_call = {
        "id": "c1",
        "type": "function",
        "function": {
            "name": "remote_exec",
            "arguments": json.dumps({"workdir": "/w", "command": "curl -H 'Authorization: Bearer tok_secret123456'"}),
        },
    }
    client.app.state.gateway = FakeGateway([_assistant(tool_calls=[tool_call]), _assistant(content="完成")])

    async def fake_dispatch(app, machine_id, tool, payload, session_id=None):
        return SimpleNamespace(status="completed", result={"exit_code": 0, "stdout_tail": "ok"})

    monkeypatch.setattr(services, "dispatch_and_wait", fake_dispatch)
    client.post(f"/api/sessions/{sid}/messages", headers=h, json={"content": "跑个命令"})

    tcs = client.get("/api/audit/tool-calls", headers=h).json()
    assert tcs, "应有工具调用审计记录"
    dumped = json.dumps(tcs, ensure_ascii=False)
    assert "tok_secret123456" not in dumped
    assert "REDACTED" in dumped
