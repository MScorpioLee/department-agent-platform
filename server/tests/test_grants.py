"""M6-b 跨机器临时授权测试。"""


def admin_h(client):
    tok = client.post("/api/auth/login", json={"username": "admin", "password": "adminpass"}).json()["token"]
    return {"Authorization": f"Bearer {tok}"}


def make_user(client, username):
    client.post("/api/users", headers=admin_h(client), json={"username": username, "password": "pass1234"})
    tok = client.post("/api/auth/login", json={"username": username, "password": "pass1234"}).json()["token"]
    h = {"Authorization": f"Bearer {tok}"}
    uid = client.get("/api/auth/me", headers=h).json()["id"]
    return h, uid


def owned_machine(client, owner_id, name):
    et = client.post(
        "/api/enrollment-tokens", headers=admin_h(client), json={"owner_user_id": owner_id}
    ).json()["enrollment_token"]
    return client.post(
        "/api/runners/enroll",
        headers={"Authorization": f"Bearer {et}"},
        json={"machine_name": name, "os": "darwin"},
    ).json()["machine_id"]


def test_grant_gives_access(client):
    alice_h, alice_id = make_user(client, "alice")
    bob_h, bob_id = make_user(client, "bob")
    mid = owned_machine(client, alice_id, "alice-pc")

    # 授权前:bob 看不到、不能创建会话
    assert client.get("/api/machines", headers=bob_h).json() == []
    assert client.post("/api/sessions", headers=bob_h, json={"machine_id": mid}).status_code == 403

    # alice 授权 bob
    g = client.post(f"/api/machines/{mid}/grants", headers=alice_h, json={"grantee_user_id": bob_id})
    assert g.status_code == 200, g.text
    grant_id = g.json()["grant_id"]

    # 授权后:bob 能看到、能创建会话
    machines = client.get("/api/machines", headers=bob_h).json()
    assert [m["machine_id"] for m in machines] == [mid]
    assert client.post("/api/sessions", headers=bob_h, json={"machine_id": mid}).status_code == 200

    # 撤销后:恢复无权
    assert client.delete(f"/api/grants/{grant_id}", headers=alice_h).status_code == 200
    assert client.get("/api/machines", headers=bob_h).json() == []
    assert client.post("/api/sessions", headers=bob_h, json={"machine_id": mid}).status_code == 403


def test_only_owner_can_grant(client):
    alice_h, alice_id = make_user(client, "alice")
    bob_h, bob_id = make_user(client, "bob")
    mid = owned_machine(client, alice_id, "alice-pc")
    # bob 不是 owner,不能授权(给自己)
    r = client.post(f"/api/machines/{mid}/grants", headers=bob_h, json={"grantee_user_id": bob_id})
    assert r.status_code == 403


def test_grantee_cannot_approve_high_risk(client):
    """被授权人能用机器,但高风险操作仍需机器所有者审批,grantee 不能自批。"""
    alice_h, alice_id = make_user(client, "alice")
    bob_h, bob_id = make_user(client, "bob")
    mid = owned_machine(client, alice_id, "alice-pc")
    client.post(f"/api/machines/{mid}/grants", headers=alice_h, json={"grantee_user_id": bob_id})

    rtok = None  # 需要机器在线才能走到审批后的下发;此处只验证审批创建与裁决权限
    # 让机器在线
    # 重新注册一台并连 ws 太繁琐,这里用已存在机器:它未连 ws,create_task 会在 online 检查前先过归属,
    # 但 online 检查在风险判断之前 → 不在线会 409。所以连一下 ws。
    # 简化:直接断言 grantee 在 /api/approvals 看不到、approve 403(用一条已存在的 pending 审批)
    # 通过 services.create_approval 间接构造:用 alice 下一个高危任务(需在线)。改为直接 DB 不便,
    # 这里复用在线流程:
    import time

    # 给机器建立 ws 连接
    # 通过 enroll 已有 runner_token? owned_machine 没返回 token。重新做一台带 token 的。
    et = client.post(
        "/api/enrollment-tokens", headers=admin_h(client), json={"owner_user_id": alice_id}
    ).json()["enrollment_token"]
    r = client.post(
        "/api/runners/enroll",
        headers={"Authorization": f"Bearer {et}"},
        json={"machine_name": "alice-pc2", "os": "darwin"},
    ).json()
    mid2, rtok = r["machine_id"], r["runner_token"]
    client.post(f"/api/machines/{mid2}/grants", headers=alice_h, json={"grantee_user_id": bob_id})

    with client.websocket_connect("/ws/runner", headers={"Authorization": f"Bearer {rtok}"}) as ws:
        ws.send_json({"type": "hello", "machine_id": mid2, "capabilities": ["remote_exec"], "allowed_roots": ["/tmp"]})
        assert ws.receive_json()["type"] == "hello_ack"
        for _ in range(40):
            ms = client.get("/api/machines", headers=admin_h(client)).json()
            if any(m["machine_id"] == mid2 and m["status"] == "online" for m in ms):
                break
            time.sleep(0.05)
        # bob(被授权人)发起高危任务 → 进审批
        ap = client.post(
            "/api/tasks", headers=bob_h,
            json={"machine_id": mid2, "tool": "remote_exec", "payload": {"workdir": "/tmp", "command": "rm -rf /tmp/x"}},
        ).json()
        assert ap["status"] == "needs_approval"
        approval_id = ap["approval_id"]
        # bob 不能自批
        assert client.post(f"/api/approvals/{approval_id}/approve", headers=bob_h).status_code == 403
        # alice(所有者)能批
        assert client.post(f"/api/approvals/{approval_id}/approve", headers=alice_h).status_code == 200
