"""自助注册 + 管理员审批:注册 pending → 待审批列表 → 批准可登录 / 拒绝释放用户名。"""


def admin_h(client):
    tok = client.post("/api/auth/login", json={"username": "admin", "password": "adminpass"}).json()["token"]
    return {"Authorization": f"Bearer {tok}"}


def test_register_pending_then_approve(client):
    # 注册 → pending,未签发 token
    r = client.post("/api/register", json={"username": "newbie", "password": "pass1234", "note": "想用编码 agent"})
    assert r.status_code == 200
    assert r.json()["status"] == "pending" and "token" not in r.json()

    # pending 用户不能登录
    r2 = client.post("/api/auth/login", json={"username": "newbie", "password": "pass1234"})
    assert r2.status_code == 403 and r2.json()["error"]["code"] == "pending_approval"

    # 管理员看到待审批申请(含 note)
    h = admin_h(client)
    regs = client.get("/api/admin/registrations", headers=h).json()
    reg = next(u for u in regs if u["username"] == "newbie")
    assert reg["status"] == "pending" and reg["note"] == "想用编码 agent"
    uid = reg["id"]

    # 批准 → active,可登录
    assert client.post(f"/api/admin/registrations/{uid}/approve", headers=h).json()["status"] == "active"
    login = client.post("/api/auth/login", json={"username": "newbie", "password": "pass1234"})
    assert login.status_code == 200 and login.json()["user"]["role"] == "user"

    # 已处理的申请不再出现在待审批列表;重复审批 409
    assert all(u["username"] != "newbie" for u in client.get("/api/admin/registrations", headers=h).json())
    assert client.post(f"/api/admin/registrations/{uid}/approve", headers=h).status_code == 409


def test_register_reject_frees_username(client):
    h = admin_h(client)
    uid = client.post("/api/register", json={"username": "spammer", "password": "pass1234"}).json()
    uid = next(u["id"] for u in client.get("/api/admin/registrations", headers=h).json() if u["username"] == "spammer")
    assert client.post(f"/api/admin/registrations/{uid}/reject", headers=h).json()["rejected"] == uid
    # 用户名释放,可再次注册
    assert client.post("/api/register", json={"username": "spammer", "password": "other123"}).status_code == 200


def test_register_duplicate_and_admin_created_active(client):
    h = admin_h(client)
    # 管理员建号默认 active,直接可登录
    client.post("/api/users", headers=h, json={"username": "alice", "password": "pass1234"})
    assert client.post("/api/auth/login", json={"username": "alice", "password": "pass1234"}).status_code == 200
    # 注册占用同名 → 409
    assert client.post("/api/register", json={"username": "alice", "password": "pass1234"}).status_code == 409
    # 非管理员看不到审批列表
    atok = client.post("/api/auth/login", json={"username": "alice", "password": "pass1234"}).json()["token"]
    assert client.get("/api/admin/registrations", headers={"Authorization": f"Bearer {atok}"}).status_code == 403


def test_registration_can_be_disabled(tmp_path):
    from app.config import Settings
    from app.main import create_app
    from starlette.testclient import TestClient

    settings = Settings(
        database_url=f"sqlite+aiosqlite:///{tmp_path}/reg.db",
        enrollment_token="test-enroll", api_key="test-key",
        admin_username="admin", admin_password="adminpass",
        allow_registration=False,
    )
    with TestClient(create_app(settings)) as c:
        assert c.post("/api/register", json={"username": "x", "password": "pass1234"}).status_code == 403
