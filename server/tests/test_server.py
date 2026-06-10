import time

import pytest
from starlette.websockets import WebSocketDisconnect

API = {"X-API-Key": "test-key"}
ENROLL = {"Authorization": "Bearer test-enroll"}


def enroll(client, name="alice-laptop"):
    r = client.post(
        "/api/runners/enroll",
        headers=ENROLL,
        json={"machine_name": name, "os": "darwin", "runner_version": "0.1.0"},
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["machine_id"].startswith("m_")
    assert data["runner_token"].startswith("rt_")
    return data["machine_id"], data["runner_token"]


def hello(ws, mid, caps=None):
    ws.send_json(
        {
            "type": "hello",
            "machine_id": mid,
            "runner_version": "0.1.0",
            "capabilities": caps or ["remote_exec", "remote_read_file"],
            "allowed_roots": ["/tmp"],
        }
    )
    ack = ws.receive_json()
    assert ack["type"] == "hello_ack"


def wait_for(predicate, timeout=3.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        value = predicate()
        if value:
            return value
        time.sleep(0.05)
    raise AssertionError("条件等待超时")


def test_enroll_requires_token(client):
    r = client.post("/api/runners/enroll", json={"machine_name": "x"})
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "unauthorized"


def test_api_key_required(client):
    assert client.get("/api/machines").status_code == 401


def test_dispatch_to_offline_machine_409(client):
    mid, _ = enroll(client)
    r = client.post(
        "/api/tasks",
        headers=API,
        json={"machine_id": mid, "tool": "remote_exec", "payload": {"command": "hostname"}},
    )
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "machine_offline"


def test_unknown_tool_422(client):
    mid, _ = enroll(client)
    r = client.post("/api/tasks", headers=API, json={"machine_id": mid, "tool": "rm_rf", "payload": {}})
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "tool_unknown"


def test_ws_rejects_bad_token(client):
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/ws/runner", headers={"Authorization": "Bearer rt_bogus"}) as ws:
            ws.receive_json()


def test_full_task_flow(client):
    mid, tok = enroll(client)
    with client.websocket_connect("/ws/runner", headers={"Authorization": f"Bearer {tok}"}) as ws:
        hello(ws, mid)

        machines = wait_for(
            lambda: [m for m in client.get("/api/machines", headers=API).json() if m["status"] == "online"]
        )
        assert machines[0]["machine_id"] == mid

        r = client.post(
            "/api/tasks",
            headers=API,
            json={"machine_id": mid, "tool": "remote_exec", "payload": {"workdir": ".", "command": "hostname"}},
        )
        assert r.status_code == 200, r.text
        tid = r.json()["task_id"]

        frame = ws.receive_json()
        assert frame["type"] == "task"
        assert frame["task_id"] == tid
        assert frame["payload"]["command"] == "hostname"

        ws.send_json({"type": "task_accepted", "task_id": tid})
        ws.send_json({"type": "task_output", "task_id": tid, "stream": "stdout", "seq": 0, "data": "my-host\n"})
        # 重复 seq 必须被去重
        ws.send_json({"type": "task_output", "task_id": tid, "stream": "stdout", "seq": 0, "data": "dup-ignored"})
        ws.send_json(
            {
                "type": "task_result",
                "task_id": tid,
                "status": "completed",
                "result": {"exit_code": 0, "duration_ms": 12, "truncated": False},
            }
        )

        task = wait_for(
            lambda: (lambda t: t if t["status"] == "completed" else None)(
                client.get(f"/api/tasks/{tid}", headers=API).json()
            )
        )
        assert task["result"]["exit_code"] == 0

        out = client.get(f"/api/tasks/{tid}/output", headers=API).json()
        assert out["stdout"] == "my-host\n"
        assert out["truncated"] is False

        listed = client.get(f"/api/tasks?machine_id={mid}", headers=API).json()
        assert listed[0]["task_id"] == tid


def test_capability_gate(client):
    mid, tok = enroll(client, "caps-machine")
    with client.websocket_connect("/ws/runner", headers={"Authorization": f"Bearer {tok}"}) as ws:
        hello(ws, mid, caps=["remote_exec"])
        wait_for(
            lambda: any(
                m["machine_id"] == mid and m["status"] == "online"
                for m in client.get("/api/machines", headers=API).json()
            )
        )
        r = client.post(
            "/api/tasks",
            headers=API,
            json={
                "machine_id": mid,
                "tool": "remote_patch_file",
                "payload": {"path": "/tmp/x", "old_string": "a", "new_string": "b"},
            },
        )
        assert r.status_code == 409
        assert r.json()["error"]["code"] == "tool_not_supported"


def test_disconnect_marks_machine_offline_and_tasks_lost(client):
    mid, tok = enroll(client, "drop-machine")
    with client.websocket_connect("/ws/runner", headers={"Authorization": f"Bearer {tok}"}) as ws:
        hello(ws, mid)
        wait_for(
            lambda: any(
                m["machine_id"] == mid and m["status"] == "online"
                for m in client.get("/api/machines", headers=API).json()
            )
        )
        r = client.post(
            "/api/tasks",
            headers=API,
            json={"machine_id": mid, "tool": "remote_exec", "payload": {"command": "sleep 99"}},
        )
        tid = r.json()["task_id"]
        ws.receive_json()  # 收到 task 帧后直接断线,不回结果

    wait_for(lambda: client.get(f"/api/tasks/{tid}", headers=API).json()["status"] == "lost")
    wait_for(
        lambda: any(
            m["machine_id"] == mid and m["status"] == "offline"
            for m in client.get("/api/machines", headers=API).json()
        )
    )
