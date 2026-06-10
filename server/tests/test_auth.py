def login(client, username="admin", password="adminpass"):
    return client.post("/api/auth/login", json={"username": username, "password": password})


def auth_header(client, username="admin", password="adminpass"):
    token = login(client, username, password).json()["token"]
    return {"Authorization": f"Bearer {token}"}


def test_seeded_admin_can_login(client):
    r = login(client)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["token"].startswith("at_")
    assert body["user"]["role"] == "admin"
    assert body["user"]["username"] == "admin"


def test_login_wrong_password(client):
    r = login(client, password="nope")
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "invalid_credentials"


def test_login_unknown_user(client):
    r = login(client, username="ghost", password="x")
    assert r.status_code == 401


def test_me_with_token(client):
    r = client.get("/api/auth/me", headers=auth_header(client))
    assert r.status_code == 200
    assert r.json()["username"] == "admin"


def test_me_without_token(client):
    assert client.get("/api/auth/me").status_code == 401


def test_me_with_bad_token(client):
    r = client.get("/api/auth/me", headers={"Authorization": "Bearer at_bogus"})
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "unauthorized"


def test_admin_creates_user_who_can_login(client):
    r = client.post(
        "/api/users",
        headers=auth_header(client),
        json={"username": "alice", "password": "alicepass", "role": "user"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["role"] == "user"
    # 新用户能登录
    r2 = login(client, "alice", "alicepass")
    assert r2.status_code == 200
    assert r2.json()["user"]["username"] == "alice"


def test_duplicate_username_rejected(client):
    h = auth_header(client)
    client.post("/api/users", headers=h, json={"username": "dup", "password": "secret1", "role": "user"})
    r = client.post("/api/users", headers=h, json={"username": "dup", "password": "secret2", "role": "user"})
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "user_exists"


def test_non_admin_cannot_create_user(client):
    # admin 先建一个普通用户
    client.post(
        "/api/users",
        headers=auth_header(client),
        json={"username": "bob", "password": "bobpass", "role": "user"},
    )
    bob_header = auth_header(client, "bob", "bobpass")
    r = client.post(
        "/api/users", headers=bob_header, json={"username": "eve", "password": "evepass", "role": "user"}
    )
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "forbidden"


def test_password_not_stored_plaintext(client):
    # 通过登录验证哈希可用,且 verify 对错误密码返回 False(间接确认走了 pbkdf2)
    from app.auth import hash_password, verify_password

    h = hash_password("hunter2")
    assert h.startswith("pbkdf2_sha256$")
    assert "hunter2" not in h
    assert verify_password("hunter2", h) is True
    assert verify_password("wrong", h) is False


def test_weak_password_rejected(client):
    r = client.post(
        "/api/users", headers=auth_header(client), json={"username": "weak", "password": "123", "role": "user"}
    )
    assert r.status_code == 422  # password min_length=6
