"""M4-b 机器归属与按用户鉴权隔离测试。"""

ADMIN_KEY = {"X-API-Key": "test-key"}  # 管理通道


def admin_token(client):
    return client.post("/api/auth/login", json={"username": "admin", "password": "adminpass"}).json()["token"]


def bearer(token):
    return {"Authorization": f"Bearer {token}"}


def make_user(client, username, password="pass1234", role="user"):
    client.post(
        "/api/users",
        headers=bearer(admin_token(client)),
        json={"username": username, "password": password, "role": role},
    )
    return client.post("/api/auth/login", json={"username": username, "password": password}).json()["token"]


def enroll(client, name, enroll_token="test-enroll"):
    r = client.post(
        "/api/runners/enroll",
        headers={"Authorization": f"Bearer {enroll_token}"},
        json={"machine_name": name, "os": "darwin"},
    )
    return r


def test_enrollment_token_binds_owner(client):
    """管理员签发绑定 owner 的 enroll token,机器注册即归属该用户。"""
    alice = make_user(client, "alice")
    alice_id = client.get("/api/auth/me", headers=bearer(alice)).json()["id"]

    et = client.post(
        "/api/enrollment-tokens",
        headers=bearer(admin_token(client)),
        json={"owner_user_id": alice_id, "max_uses": 1, "expires_in_days": 1},
    )
    assert et.status_code == 200, et.text
    token = et.json()["enrollment_token"]
    assert token.startswith("et_")

    r = enroll(client, "alice-pc", enroll_token=token)
    assert r.status_code == 200
    mid = r.json()["machine_id"]

    # alice 能在自己的机器列表里看到它
    machines = client.get("/api/machines", headers=bearer(alice)).json()
    assert [m["machine_id"] for m in machines] == [mid]
    assert machines[0]["owner_user_id"] == alice_id


def test_enrollment_token_max_uses_exhausted(client):
    alice = make_user(client, "alice")
    alice_id = client.get("/api/auth/me", headers=bearer(alice)).json()["id"]
    token = client.post(
        "/api/enrollment-tokens",
        headers=bearer(admin_token(client)),
        json={"owner_user_id": alice_id, "max_uses": 1},
    ).json()["enrollment_token"]

    assert enroll(client, "pc1", enroll_token=token).status_code == 200
    # 第二次超过 max_uses
    assert enroll(client, "pc2", enroll_token=token).status_code == 401


def test_user_cannot_see_others_machines(client):
    alice = make_user(client, "alice")
    bob = make_user(client, "bob")
    alice_id = client.get("/api/auth/me", headers=bearer(alice)).json()["id"]

    token = client.post(
        "/api/enrollment-tokens", headers=bearer(admin_token(client)),
        json={"owner_user_id": alice_id},
    ).json()["enrollment_token"]
    mid = enroll(client, "alice-pc", enroll_token=token).json()["machine_id"]

    # bob 看不到 alice 的机器
    assert client.get("/api/machines", headers=bearer(bob)).json() == []
    # bob 不能对 alice 的机器创建会话
    r = client.post("/api/sessions", headers=bearer(bob), json={"machine_id": mid})
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "forbidden"
    # bob 不能对 alice 的机器下任务
    r2 = client.post(
        "/api/tasks", headers=bearer(bob),
        json={"machine_id": mid, "tool": "remote_exec", "payload": {"command": "id"}},
    )
    assert r2.status_code == 403


def test_unowned_machine_only_admin(client):
    """无主机器(静态 token 注册)普通用户不可用,admin 可见。"""
    bob = make_user(client, "bob")
    mid = enroll(client, "shared-box").json()["machine_id"]  # 静态 token → 无主

    assert client.get("/api/machines", headers=bearer(bob)).json() == []
    # admin(用户 token)能看到
    machines = client.get("/api/machines", headers=bearer(admin_token(client))).json()
    assert any(m["machine_id"] == mid and m["owner_user_id"] is None for m in machines)
    # bob 不能用
    assert client.post("/api/sessions", headers=bearer(bob), json={"machine_id": mid}).status_code == 403


def test_admin_assigns_machine(client):
    bob = make_user(client, "bob")
    bob_id = client.get("/api/auth/me", headers=bearer(bob)).json()["id"]
    mid = enroll(client, "shared-box").json()["machine_id"]  # 无主

    r = client.post(f"/api/machines/{mid}/assign", headers=bearer(admin_token(client)), json={"user_id": bob_id})
    assert r.status_code == 200
    # 分配后 bob 能看到
    machines = client.get("/api/machines", headers=bearer(bob)).json()
    assert [m["machine_id"] for m in machines] == [mid]


def test_non_admin_cannot_issue_enrollment_token(client):
    bob = make_user(client, "bob")
    r = client.post("/api/enrollment-tokens", headers=bearer(bob), json={"max_uses": 1})
    assert r.status_code == 403


def test_admin_key_channel_sees_all(client):
    """X-API-Key 管理通道(向后兼容 WebUI)能看到所有机器。"""
    alice = make_user(client, "alice")
    alice_id = client.get("/api/auth/me", headers=bearer(alice)).json()["id"]
    token = client.post(
        "/api/enrollment-tokens", headers=bearer(admin_token(client)),
        json={"owner_user_id": alice_id},
    ).json()["enrollment_token"]
    enroll(client, "alice-pc", enroll_token=token)
    enroll(client, "shared-box")  # 无主

    machines = client.get("/api/machines", headers=ADMIN_KEY).json()
    assert len(machines) == 2
