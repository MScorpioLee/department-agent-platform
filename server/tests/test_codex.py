"""M15 Codex 订阅(per-user):chat↔responses 互译 + 适配器 + 每用户登录 + 网关分发。"""

import time

from app import codex_adapter


def admin_h(client):
    tok = client.post("/api/auth/login", json={"username": "admin", "password": "adminpass"}).json()["token"]
    return {"Authorization": f"Bearer {tok}"}


def make_user(client, username):
    client.post("/api/users", headers=admin_h(client), json={"username": username, "password": "pass1234"})
    tok = client.post("/api/auth/login", json={"username": username, "password": "pass1234"}).json()["token"]
    h = {"Authorization": f"Bearer {tok}"}
    uid = client.get("/api/auth/me", headers=h).json()["id"]
    return h, uid


# ---------- 假 httpx ----------


class _Resp:
    def __init__(self, status, body):
        self.status_code = status
        self._body = body
        self.text = ""

    def json(self):
        return self._body

    def raise_for_status(self):
        if self.status_code >= 400:
            import httpx

            raise httpx.HTTPStatusError("err", request=None, response=self)


class _Client:
    def __init__(self, handler):
        self.handler = handler

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def post(self, url, json=None, headers=None):
        return self.handler(url, json, headers)


def factory(handler):
    return lambda timeout=None: _Client(handler)


# ---------- 互译纯函数 ----------


def test_chat_to_responses():
    req = codex_adapter.chat_to_responses({
        "model": "gpt-5.1-codex",
        "messages": [
            {"role": "system", "content": "你是助手"},
            {"role": "user", "content": "hi"},
        ],
        "tools": [{"type": "function", "function": {"name": "f"}}],
    })
    assert req["model"] == "gpt-5.1-codex"
    assert req["instructions"] == "你是助手"
    assert req["input"] == [{"role": "user", "content": "hi"}]
    assert req["tools"]


def test_responses_to_chat_text_and_tools():
    out = codex_adapter.responses_to_chat({
        "output": [
            {"type": "message", "content": [{"type": "output_text", "text": "答案"}]},
            {"type": "function_call", "call_id": "c1", "name": "run", "arguments": "{}"},
        ],
        "usage": {"input_tokens": 5, "output_tokens": 7},
    })
    msg = out["choices"][0]["message"]
    assert msg["content"] == "答案"
    assert msg["tool_calls"][0]["function"]["name"] == "run"
    assert out["usage"]["prompt_tokens"] == 5 and out["usage"]["total_tokens"] == 12


async def test_codex_chat_roundtrip():
    captured = {}

    def handler(url, json, headers):
        captured["url"] = url
        captured["auth"] = headers["Authorization"]
        captured["has_input"] = "input" in json
        return _Resp(200, {"output_text": "ok", "usage": {"input_tokens": 1, "output_tokens": 1}})

    out = await codex_adapter.codex_chat(
        "https://chatgpt.example/backend-api/codex", "USER_TOKEN",
        {"model": "m", "messages": [{"role": "user", "content": "hi"}]},
        client_factory=factory(handler))
    assert captured["url"].endswith("/responses")
    assert captured["auth"] == "Bearer USER_TOKEN" and captured["has_input"]
    assert out["choices"][0]["message"]["content"] == "ok"


# ---------- per-user 登录闭环 ----------


def _make_codex_backend(client):
    return client.post("/api/admin/models", headers=admin_h(client), json={
        "name": "codex-sub", "base_url": "https://chatgpt.example/backend-api/codex", "model": "gpt-5.1-codex",
        "auth_type": "oauth", "auth_scope": "per_user", "runtime": "codex_responses", "is_default": True,
        "oauth": {"client_id": "codex-cli", "token_url": "https://idp/tok",
                  "device_authorization_url": "https://idp/dev", "scope": "openid"},
    }).json()


def test_per_user_login_isolated(client, monkeypatch):
    from app import oauth

    backend = _make_codex_backend(client)
    assert backend["auth_scope"] == "per_user" and backend["runtime"] == "codex_responses"
    bid = backend["id"]
    alice_h, _ = make_user(client, "alice")
    bob_h, _ = make_user(client, "bob")

    # 都还没登录
    rows = client.get("/api/me/model-logins", headers=alice_h).json()
    assert rows[0]["backend_id"] == bid and rows[0]["logged_in"] is False

    async def fake_start(cfg, **kw):
        return {"device_code": "dc", "user_code": "A1B2", "verification_uri": "https://idp/act", "interval": 5}

    async def fake_poll(cfg, device_code, **kw):
        return {"access_token": "ALICE_TOKEN", "refresh_token": "RT", "expires_at": time.time() + 3600}

    monkeypatch.setattr(oauth, "start_device_flow", fake_start)
    monkeypatch.setattr(oauth, "poll_device_token", fake_poll)

    assert client.post(f"/api/me/model-logins/{bid}/device/start", headers=alice_h).json()["user_code"] == "A1B2"
    assert client.post(f"/api/me/model-logins/{bid}/device/poll", headers=alice_h).json()["status"] == "authorized"

    # alice 已登录,bob 仍未登录(隔离)
    assert client.get("/api/me/model-logins", headers=alice_h).json()[0]["logged_in"] is True
    assert client.get("/api/me/model-logins", headers=bob_h).json()[0]["logged_in"] is False


def test_per_user_gateway_uses_own_token_via_codex(client, monkeypatch):
    """alice 登录后,/v1 中转用她的 token 经 Codex 适配器调用。"""
    from app import codex_adapter, oauth

    bid = _make_codex_backend(client)["id"]
    alice_h, _ = make_user(client, "alice")

    async def fake_start(cfg, **kw):
        return {"device_code": "dc", "user_code": "X", "interval": 1}

    async def fake_poll(cfg, device_code, **kw):
        return {"access_token": "ALICE_TOKEN", "refresh_token": "RT", "expires_at": time.time() + 3600}

    seen = {}

    async def fake_codex_chat(base_url, token, payload, **kw):
        seen["token"] = token
        seen["base_url"] = base_url
        return {"choices": [{"message": {"role": "assistant", "content": "via-codex"}}],
                "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2}}

    monkeypatch.setattr(oauth, "start_device_flow", fake_start)
    monkeypatch.setattr(oauth, "poll_device_token", fake_poll)
    monkeypatch.setattr(codex_adapter, "codex_chat", fake_codex_chat)

    # 未登录 → 中转 503 提示需登录
    r0 = client.post("/v1/chat/completions", headers=alice_h, json={"messages": [{"role": "user", "content": "hi"}]})
    assert r0.status_code == 503 and "登录" in r0.json()["error"]["message"]

    # 登录后再调
    client.post(f"/api/me/model-logins/{bid}/device/start", headers=alice_h)
    client.post(f"/api/me/model-logins/{bid}/device/poll", headers=alice_h)
    r = client.post("/v1/chat/completions", headers=alice_h, json={"messages": [{"role": "user", "content": "hi"}]})
    assert r.status_code == 200, r.text
    assert r.json()["choices"][0]["message"]["content"] == "via-codex"
    assert seen["token"] == "ALICE_TOKEN"  # 用了 alice 自己的订阅令牌
