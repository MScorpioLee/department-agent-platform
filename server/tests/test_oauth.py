"""M14 OAuth:纯流程函数(设备码/PKCE/刷新)+ 端点授权闭环 + 网关用 OAuth 令牌。"""

import time

import pytest

from app import oauth


def admin_h(client):
    tok = client.post("/api/auth/login", json={"username": "admin", "password": "adminpass"}).json()["token"]
    return {"Authorization": f"Bearer {tok}"}


# ---------- 假 httpx ----------


class _Resp:
    def __init__(self, status, body=None, text=""):
        self.status_code = status
        self._body = body
        self.text = text

    def json(self):
        if self._body is None:
            raise ValueError("no json")
        return self._body


class _Client:
    def __init__(self, handler):
        self.handler = handler

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def post(self, url, data=None, headers=None):
        return self.handler(url, data)


def factory(handler):
    return lambda timeout=None: _Client(handler)


# ---------- 纯函数 ----------


def test_pkce_pair():
    import base64
    import hashlib

    v, c = oauth.pkce_pair()
    expect = base64.urlsafe_b64encode(hashlib.sha256(v.encode()).digest()).rstrip(b"=").decode()
    assert c == expect and "=" not in c


async def test_device_flow_and_poll():
    cfg = {"client_id": "cid", "device_authorization_url": "https://idp/dev", "token_url": "https://idp/tok"}

    start = await oauth.start_device_flow(cfg, client_factory=factory(
        lambda url, data: _Resp(200, {"device_code": "dc", "user_code": "WXYZ",
                                      "verification_uri": "https://idp/activate", "interval": 5})))
    assert start["user_code"] == "WXYZ"

    pending = await oauth.poll_device_token(cfg, "dc", client_factory=factory(
        lambda url, data: _Resp(400, {"error": "authorization_pending"})))
    assert pending == {"pending": True, "error": "authorization_pending"}

    tok = await oauth.poll_device_token(cfg, "dc", client_factory=factory(
        lambda url, data: _Resp(200, {"access_token": "AT", "refresh_token": "RT", "expires_in": 3600})))
    assert tok["access_token"] == "AT" and tok["expires_at"] > time.time()


async def test_exchange_and_refresh():
    cfg = {"client_id": "cid", "token_url": "https://idp/tok", "redirect_uri": "https://app/cb"}
    tok = await oauth.exchange_code(cfg, "code123", "verifier", client_factory=factory(
        lambda url, data: _Resp(200, {"access_token": "AT", "refresh_token": "RT", "expires_in": 3600})))
    assert tok["access_token"] == "AT"

    # 刷新时 IdP 不回新 refresh_token → 沿用旧的
    refreshed = await oauth.refresh_tokens(cfg, "RT", client_factory=factory(
        lambda url, data: _Resp(200, {"access_token": "AT2", "expires_in": 3600})))
    assert refreshed["access_token"] == "AT2" and refreshed["refresh_token"] == "RT"


async def test_token_error_surfaces():
    cfg = {"client_id": "cid", "token_url": "https://idp/tok"}
    with pytest.raises(oauth.OAuthError) as ei:
        await oauth.refresh_tokens(cfg, "bad", client_factory=factory(
            lambda url, data: _Resp(400, {"error": "invalid_grant", "error_description": "过期"})))
    assert ei.value.code == "invalid_grant"


def test_token_expired():
    assert oauth.token_expired({"expires_at": time.time() - 10}) is True
    assert oauth.token_expired({"expires_at": time.time() + 9999}) is False
    assert oauth.token_expired({}) is False  # 无过期时间视为不过期


# ---------- 端点闭环(monkeypatch oauth 模块)----------


def _make_oauth_backend(client, h):
    return client.post("/api/admin/models", headers=h, json={
        "name": "claude-oauth", "base_url": "https://api.example.com/v1", "model": "x",
        "auth_type": "oauth", "is_default": True,
        "oauth": {"client_id": "cid", "token_url": "https://idp/tok",
                  "device_authorization_url": "https://idp/dev", "scope": "read"},
    }).json()


def test_device_flow_endpoints(client, monkeypatch):
    h = admin_h(client)
    backend = _make_oauth_backend(client, h)
    assert backend["auth_type"] == "oauth"
    assert backend["oauth"]["status"] == "pending"  # 已配置待授权
    assert "client_secret" not in str(backend) and "access_token" not in str(backend)
    bid = backend["id"]

    async def fake_start(cfg, **kw):
        return {"device_code": "dc", "user_code": "ABCD",
                "verification_uri": "https://idp/activate", "interval": 5, "expires_in": 600}

    state = {"polls": 0}

    async def fake_poll(cfg, device_code, **kw):
        state["polls"] += 1
        if state["polls"] == 1:
            return {"pending": True}
        return {"access_token": "AT", "refresh_token": "RT", "expires_at": time.time() + 3600}

    monkeypatch.setattr(oauth, "start_device_flow", fake_start)
    monkeypatch.setattr(oauth, "poll_device_token", fake_poll)

    started = client.post(f"/api/admin/models/{bid}/oauth/device/start", headers=h).json()
    assert started["user_code"] == "ABCD"

    assert client.post(f"/api/admin/models/{bid}/oauth/device/poll", headers=h).json()["status"] == "pending"
    assert client.post(f"/api/admin/models/{bid}/oauth/device/poll", headers=h).json()["status"] == "authorized"

    # 列表显示 authorized;网关用上了 access_token
    row = next(m for m in client.get("/api/admin/models", headers=h).json() if m["id"] == bid)
    assert row["oauth"]["status"] == "authorized"
    assert client.app.state.gateway.resolve("anyone").api_key == "AT"


def test_oauth_refresh_endpoint(client, monkeypatch):
    h = admin_h(client)
    bid = _make_oauth_backend(client, h)["id"]

    async def fake_start(cfg, **kw):
        return {"device_code": "dc", "user_code": "Z", "interval": 1}

    async def fake_poll(cfg, device_code, **kw):
        return {"access_token": "AT", "refresh_token": "RT", "expires_at": time.time() + 3600}

    async def fake_refresh(cfg, rt, **kw):
        return {"access_token": "AT2", "refresh_token": "RT", "expires_at": time.time() + 3600}

    monkeypatch.setattr(oauth, "start_device_flow", fake_start)
    monkeypatch.setattr(oauth, "poll_device_token", fake_poll)
    monkeypatch.setattr(oauth, "refresh_tokens", fake_refresh)

    client.post(f"/api/admin/models/{bid}/oauth/device/start", headers=h)
    client.post(f"/api/admin/models/{bid}/oauth/device/poll", headers=h)
    assert client.app.state.gateway.resolve("u").api_key == "AT"

    assert client.post(f"/api/admin/models/{bid}/oauth/refresh", headers=h).json()["status"] == "refreshed"
    assert client.app.state.gateway.resolve("u").api_key == "AT2"


def test_oauth_requires_config(client):
    h = admin_h(client)
    # auth_type=oauth 但缺 oauth 配置 → 422
    r = client.post("/api/admin/models", headers=h, json={
        "name": "bad", "base_url": "http://x/v1", "model": "x", "auth_type": "oauth"})
    assert r.status_code == 422
