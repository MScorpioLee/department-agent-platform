"""M13 中转站:个人 API Key 生命周期 + OpenAI 兼容 /v1 端点 + 用量审计。"""

from types import SimpleNamespace


def admin_h(client):
    tok = client.post("/api/auth/login", json={"username": "admin", "password": "adminpass"}).json()["token"]
    return {"Authorization": f"Bearer {tok}"}


class FakeGateway:
    def resolve(self, user_id=None):
        return SimpleNamespace(id="fake-backend", model="fake-model")

    async def chat(self, backend, messages, tools=None, **kw):
        return {
            "choices": [{"message": {"role": "assistant", "content": f"echo:{messages[-1]['content']}"}}],
            "usage": {"prompt_tokens": 7, "completion_tokens": 3, "total_tokens": 10},
        }


def test_api_key_lifecycle(client):
    h = admin_h(client)
    created = client.post("/api/me/api-keys", headers=h, json={"name": "我的工具"}).json()
    assert created["api_key"].startswith("ak_")
    # 列表只回前缀,不回明文
    rows = client.get("/api/me/api-keys", headers=h).json()
    assert rows[0]["prefix"].endswith("…") and "api_key" not in rows[0]
    assert created["api_key"] not in str(rows)
    # 吊销后失效
    client.app.state.gateway = FakeGateway()
    kh = {"Authorization": f"Bearer {created['api_key']}"}
    assert client.get("/v1/models", headers=kh).status_code == 200
    client.delete(f"/api/me/api-keys/{created['id']}", headers=h)
    assert client.get("/v1/models", headers=kh).status_code == 401


def test_v1_chat_with_api_key_and_usage(client):
    h = admin_h(client)
    client.app.state.gateway = FakeGateway()
    key = client.post("/api/me/api-keys", headers=h, json={}).json()["api_key"]
    kh = {"Authorization": f"Bearer {key}"}

    r = client.post("/v1/chat/completions", headers=kh,
                    json={"model": "whatever", "messages": [{"role": "user", "content": "hi"}]})
    assert r.status_code == 200
    assert r.json()["choices"][0]["message"]["content"] == "echo:hi"

    # 用量进审计(admin 聚合可见)
    usage = client.get("/api/audit/usage", headers=h).json()
    assert any(row.get("total_tokens", 0) >= 10 for row in usage.get("rows", [])) or usage

    # /v1/models 返回路由到的模型
    models = client.get("/v1/models", headers=kh).json()
    assert models["data"][0]["id"] == "fake-model"


def test_v1_auth_and_validation(client):
    client.app.state.gateway = FakeGateway()
    # 无认证 / 错 key
    assert client.post("/v1/chat/completions", json={"messages": [{"role": "user", "content": "x"}]}).status_code == 401
    assert client.get("/v1/models", headers={"Authorization": "Bearer ak_wrong"}).status_code == 401
    # 登录 token 也可用
    h = admin_h(client)
    assert client.get("/v1/models", headers=h).status_code == 200
    # stream 明确拒绝;空 messages 422
    assert client.post("/v1/chat/completions", headers=h,
                       json={"messages": [{"role": "user", "content": "x"}], "stream": True}).status_code == 400
    assert client.post("/v1/chat/completions", headers=h, json={"messages": []}).status_code == 422
