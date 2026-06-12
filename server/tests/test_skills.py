"""M11 技能:CRUD + 作用域/启停 + 导入解析 + 提示词并入会话。"""

from app.skills import parse_skill_manifest


def admin_h(client):
    tok = client.post("/api/auth/login", json={"username": "admin", "password": "adminpass"}).json()["token"]
    return {"Authorization": f"Bearer {tok}"}


def make_user(client, username):
    client.post("/api/users", headers=admin_h(client), json={"username": username, "password": "pass1234"})
    tok = client.post("/api/auth/login", json={"username": username, "password": "pass1234"}).json()["token"]
    h = {"Authorization": f"Bearer {tok}"}
    uid = client.get("/api/auth/me", headers=h).json()["id"]
    return h, uid


# ---------- 清单解析 ----------


def test_parse_yaml_manifest():
    m = parse_skill_manifest("name: rev\ndescription: 审查\nprompt: 你是审查助手\n")
    assert m["name"] == "rev" and m["prompt"] == "你是审查助手"


def test_parse_markdown_frontmatter():
    text = "---\nname: rev\ndescription: 审查\n---\n你是审查助手,严格检查代码。"
    m = parse_skill_manifest(text)
    assert m["name"] == "rev"
    assert "严格检查代码" in m["prompt"]


# ---------- CRUD + 作用域 + 启停 ----------


def test_create_scope_and_user_toggle(client):
    h = admin_h(client)
    alice_h, alice_id = make_user(client, "alice")
    sk = client.post("/api/admin/skills", headers=h,
                     json={"name": "reviewer", "description": "审查", "prompt": "你是审查助手"}).json()
    sid = sk["id"]

    # 未授权 → alice 看不到这个 reviewer(但能看到内置技能),也不能启用它
    before = client.get("/api/skills", headers=alice_h).json()
    assert not any(s["id"] == sid for s in before)
    assert client.put(f"/api/skills/{sid}/enabled", headers=alice_h, json={"enabled": True}).status_code == 403

    # 授权给 alice → 看得到(默认未启用)
    client.put(f"/api/admin/skills/{sid}/scope", headers=h, json={"user_ids": [alice_id]})
    rev = next(s for s in client.get("/api/skills", headers=alice_h).json() if s["id"] == sid)
    assert rev["name"] == "reviewer" and rev["enabled"] is False

    # 启用
    assert client.put(f"/api/skills/{sid}/enabled", headers=alice_h, json={"enabled": True}).status_code == 200
    rev2 = next(s for s in client.get("/api/skills", headers=alice_h).json() if s["id"] == sid)
    assert rev2["enabled"] is True


def test_skill_prompt_enters_session(client, monkeypatch):
    from types import SimpleNamespace
    import json as _json
    from app import services

    h = admin_h(client)
    alice_h, alice_id = make_user(client, "alice")
    sid = client.post("/api/admin/skills", headers=h,
                      json={"name": "persona", "prompt": "SKILL_MARKER_必须出现", "scope_all": True}).json()["id"]
    client.put(f"/api/skills/{sid}/enabled", headers=alice_h, json={"enabled": True})

    mid = client.post("/api/runners/enroll", headers={"Authorization": "Bearer test-enroll"},
                      json={"machine_name": "m1", "os": "darwin"}).json()["machine_id"]
    client.post(f"/api/machines/{mid}/assign", headers=h, json={"user_id": alice_id})  # 归属 alice
    sess_id = client.post("/api/sessions", headers=alice_h, json={"machine_id": mid}).json()["session_id"]

    captured = {}

    class FakeGateway:
        def resolve(self, user_id=None):
            return SimpleNamespace(id="fake", model="fake")

        async def chat(self, backend, messages, tools=None, **kw):
            captured["system"] = messages[0]["content"]
            return {"choices": [{"message": {"role": "assistant", "content": "ok"}}], "usage": {}}

    client.app.state.gateway = FakeGateway()
    r = client.post(f"/api/sessions/{sess_id}/messages", headers=alice_h, json={"content": "hi"})
    assert r.status_code == 200, r.text
    # 已启用技能的提示词进入了系统消息
    assert "SKILL_MARKER_必须出现" in captured["system"]


def test_allowed_roots_in_system_prompt(client):
    """机器上报 allowed_roots 后,系统提示词应告知模型可用根目录(防盲猜 workdir)。"""
    from types import SimpleNamespace

    r = client.post("/api/runners/enroll", headers={"Authorization": "Bearer test-enroll"},
                    json={"machine_name": "m2", "os": "windows"})
    mid, rtok = r.json()["machine_id"], r.json()["runner_token"]
    with client.websocket_connect("/ws/runner", headers={"Authorization": f"Bearer {rtok}"}) as ws:
        ws.send_json({"type": "hello", "machine_id": mid, "capabilities": ["remote_exec"],
                      "allowed_roots": ["D:/Tools/agent-workspace"]})
        assert ws.receive_json()["type"] == "hello_ack"

        sess_id = client.post("/api/sessions", headers={"X-API-Key": "test-key"},
                              json={"machine_id": mid}).json()["session_id"]
        captured = {}

        class FakeGateway:
            def resolve(self, user_id=None):
                return SimpleNamespace(id="fake", model="fake")

            async def chat(self, backend, messages, tools=None, **kw):
                captured["system"] = messages[0]["content"]
                return {"choices": [{"message": {"role": "assistant", "content": "ok"}}], "usage": {}}

        client.app.state.gateway = FakeGateway()
        assert client.post(f"/api/sessions/{sess_id}/messages", headers={"X-API-Key": "test-key"},
                           json={"content": "hi"}).status_code == 200
        assert "D:/Tools/agent-workspace" in captured["system"]


def test_builtin_skills_seeded(client):
    # 启动时已播种内置技能,管理员能看到 source=builtin 的若干技能
    rows = client.get("/api/admin/skills", headers=admin_h(client)).json()
    builtins = [s for s in rows if s.get("source") == "builtin"]
    assert any(s["name"] == "代码审查" for s in builtins)
    assert all(s["scope_all"] for s in builtins)  # 内置默认全员可见


def test_imported_skill_source(client):
    # 手动创建的技能 source=custom
    sk = client.post("/api/admin/skills", headers=admin_h(client),
                     json={"name": "自建", "prompt": "x"}).json()
    assert sk["source"] == "custom"


def test_requires_admin_for_management(client):
    alice_h, _ = make_user(client, "alice")
    assert client.get("/api/admin/skills", headers=alice_h).status_code == 403
    assert client.post("/api/admin/skills", headers=alice_h, json={"name": "x", "prompt": "y"}).status_code == 403
