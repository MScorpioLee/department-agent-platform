"""M8 模型管理:admin CRUD + 密钥脱敏 + 热生效 + 路由。"""


def admin_h(client):
    tok = client.post("/api/auth/login", json={"username": "admin", "password": "adminpass"}).json()["token"]
    return {"Authorization": f"Bearer {tok}"}


def make_user_token(client, username):
    client.post("/api/users", headers=admin_h(client), json={"username": username, "password": "pass1234"})
    return client.post("/api/auth/login", json={"username": username, "password": "pass1234"}).json()["token"]


def test_provider_presets_catalog(client):
    r = client.get("/api/admin/model-providers", headers=admin_h(client))
    assert r.status_code == 200
    ids = [p["id"] for p in r.json()]
    assert "deepseek" in ids and "ollama" in ids and "custom" in ids
    ds = next(p for p in r.json() if p["id"] == "deepseek")
    assert ds["base_url"] == "https://api.deepseek.com/v1" and "deepseek-chat" in ds["models"]


def test_requires_admin(client):
    utok = make_user_token(client, "alice")
    assert client.get("/api/admin/models", headers={"Authorization": f"Bearer {utok}"}).status_code == 403


def test_create_lists_and_redacts_key(client):
    h = admin_h(client)
    r = client.post(
        "/api/admin/models",
        headers=h,
        json={"name": "deepseek", "base_url": "https://api.deepseek.com/v1", "model": "deepseek-chat",
              "api_key": "sk-supersecret-abcdef123456", "is_default": True},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    # 关键:响应不含明文 key
    assert "supersecret" not in str(body)
    assert body["api_key"].startswith("sk-") and "…" in body["api_key"]
    assert body["is_default"] is True

    lst = client.get("/api/admin/models", headers=h).json()
    assert len(lst) == 1 and lst[0]["name"] == "deepseek"
    assert "supersecret" not in str(lst)

    # 热生效:网关已能用该后端(默认路由)
    backend = client.app.state.gateway.resolve(None)
    assert backend.model == "deepseek-chat"


def test_only_one_default(client):
    h = admin_h(client)
    client.post("/api/admin/models", headers=h,
                json={"name": "m1", "base_url": "http://x/v1", "model": "a", "is_default": True})
    client.post("/api/admin/models", headers=h,
                json={"name": "m2", "base_url": "http://y/v1", "model": "b", "is_default": True})
    rows = client.get("/api/admin/models", headers=h).json()
    defaults = [r for r in rows if r["is_default"]]
    assert len(defaults) == 1 and defaults[0]["name"] == "m2"


def test_duplicate_name_409(client):
    h = admin_h(client)
    client.post("/api/admin/models", headers=h, json={"name": "dup", "base_url": "http://x/v1", "model": "a"})
    r = client.post("/api/admin/models", headers=h, json={"name": "dup", "base_url": "http://x/v1", "model": "a"})
    assert r.status_code == 409


def test_update_and_delete(client):
    h = admin_h(client)
    mid = client.post("/api/admin/models", headers=h,
                      json={"name": "m", "base_url": "http://x/v1", "model": "a", "is_default": True}).json()["id"]
    # 改 model + key
    r = client.patch(f"/api/admin/models/{mid}", headers=h, json={"model": "b", "api_key": "sk-newkey-998877"})
    assert r.json()["model"] == "b"
    assert client.app.state.gateway.resolve(None).model == "b"  # 热生效
    # 删除
    assert client.delete(f"/api/admin/models/{mid}", headers=h).status_code == 200
    assert client.get("/api/admin/models", headers=h).json() == []


def test_user_routes(client):
    h = admin_h(client)
    a = client.post("/api/admin/models", headers=h,
                    json={"name": "ma", "base_url": "http://x/v1", "model": "a", "is_default": True}).json()["id"]
    b = client.post("/api/admin/models", headers=h,
                    json={"name": "mb", "base_url": "http://y/v1", "model": "b"}).json()["id"]
    # 给 alice 路由到 mb
    client.post("/api/users", headers=h, json={"username": "alice", "password": "pass1234"})
    alice_id = client.get("/api/auth/me",
                          headers={"Authorization": f"Bearer {client.post('/api/auth/login', json={'username':'alice','password':'pass1234'}).json()['token']}"}).json()["id"]
    client.put("/api/admin/model-routes", headers=h, json={"user_id": alice_id, "backend_id": b})
    gw = client.app.state.gateway
    assert gw.resolve(alice_id).id == b      # alice → mb
    assert gw.resolve("someone-else").id == a  # 其他人 → 默认 ma
    # 删路由 → 回落默认
    client.put("/api/admin/model-routes", headers=h, json={"user_id": alice_id, "backend_id": None})
    assert client.app.state.gateway.resolve(alice_id).id == a


def test_discover_models(client, monkeypatch):
    """填 base_url+key 拉取端点真实模型列表(对标 Hermes);失败给可读错误。"""
    from app import model_providers

    async def fake_list(base_url, api_key=""):
        assert base_url == "https://api.deepseek.com/v1" and api_key == "sk-x"
        return ["deepseek-chat", "deepseek-reasoner"]

    monkeypatch.setattr(model_providers, "list_models_from_endpoint", fake_list)
    h = admin_h(client)
    r = client.post("/api/admin/model-providers/discover", headers=h,
                    json={"base_url": "https://api.deepseek.com/v1", "api_key": "sk-x"})
    assert r.status_code == 200
    assert r.json() == {"models": ["deepseek-chat", "deepseek-reasoner"], "count": 2}


def test_discover_models_bad_key(client, monkeypatch):
    from types import SimpleNamespace

    from app import model_providers

    async def fail(base_url, api_key=""):
        raise RuntimeError_with_response()

    class RuntimeError_with_response(Exception):
        response = SimpleNamespace(status_code=401)

    monkeypatch.setattr(model_providers, "list_models_from_endpoint", fail)
    r = client.post("/api/admin/model-providers/discover", headers=admin_h(client),
                    json={"base_url": "http://x/v1", "api_key": "bad"})
    assert r.status_code == 502
    assert "Key 无效" in r.json()["error"]["message"]
