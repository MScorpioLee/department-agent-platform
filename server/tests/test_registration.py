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


def _fresh_app(tmp_path, **overrides):
    """无预置管理员的全新应用(空库),用于测首次引导。"""
    from app.config import Settings
    from app.main import create_app
    from starlette.testclient import TestClient

    settings = Settings(
        database_url=f"sqlite+aiosqlite:///{tmp_path}/boot.db",
        enrollment_token="test-enroll", api_key="test-key",
        admin_username=None, admin_password=None,  # 不预置管理员
        **overrides,
    )
    return TestClient(create_app(settings))


def test_first_register_becomes_admin(tmp_path):
    with _fresh_app(tmp_path) as c:
        # 空库:需要首次设置
        assert c.get("/api/auth/setup-status").json()["needs_setup"] is True
        # 首个注册者 = 管理员,直接 active
        r = c.post("/api/register", json={"username": "boss", "password": "pass1234"})
        assert r.status_code == 200
        assert r.json()["bootstrap"] is True and r.json()["role"] == "admin" and r.json()["status"] == "active"
        # 直接可登录,且是 admin
        login = c.post("/api/auth/login", json={"username": "boss", "password": "pass1234"})
        assert login.status_code == 200 and login.json()["user"]["role"] == "admin"
        # 不再 needs_setup;之后注册回到 pending(普通用户)
        assert c.get("/api/auth/setup-status").json()["needs_setup"] is False
        r2 = c.post("/api/register", json={"username": "staff", "password": "pass1234"})
        assert r2.json()["status"] == "pending" and "bootstrap" not in r2.json()


def test_bootstrap_works_even_if_registration_disabled(tmp_path):
    # 即便关了自助注册,空库仍允许创建首个管理员(否则永远没管理员)
    with _fresh_app(tmp_path, allow_registration=False) as c:
        r = c.post("/api/register", json={"username": "boss", "password": "pass1234"})
        assert r.json()["role"] == "admin"
        # 但第二个注册被拒(注册已关)
        assert c.post("/api/register", json={"username": "x", "password": "pass1234"}).status_code == 403


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
