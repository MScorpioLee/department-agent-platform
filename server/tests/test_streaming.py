import asyncio
from types import SimpleNamespace

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from starlette.websockets import WebSocketDisconnect

from app import services
from app.config import Settings
from app.db import Base
from app.events import EventBus, TicketStore
from app.models import Machine, Session
from app.registry import RunnerHub

API = {"X-API-Key": "test-key"}


def _login(client, username="admin", password="adminpass"):
    return client.post("/api/auth/login", json={"username": username, "password": password}).json()["token"]


# ---------- EventBus / TicketStore 单元 ----------


async def test_eventbus_pub_sub():
    bus = EventBus()
    q = bus.subscribe("s1")
    await bus.publish("s1", {"type": "x"})
    await bus.publish("other", {"type": "y"})  # 不同会话不应收到
    assert q.get_nowait() == {"type": "x"}
    assert q.empty()
    bus.unsubscribe("s1", q)
    assert not bus.has_subscribers("s1")


def test_ticket_single_use_and_unknown():
    store = TicketStore(ttl_seconds=30)
    tk = store.issue("u1")
    assert store.consume(tk) == "u1"
    assert store.consume(tk) is None  # 一次性
    assert store.consume("nope") is None
    assert store.consume(None) is None


def test_ticket_expiry():
    store = TicketStore(ttl_seconds=-1)  # 立即过期
    tk = store.issue("u1")
    assert store.consume(tk) is None


# ---------- /ws/client 鉴权与订阅 ----------


def _make_session_for_admin(client):
    """用 admin(X-API-Key 与登录用户)创建一台机器与会话,返回 (session_id, user_id)。"""
    mid = client.post(
        "/api/runners/enroll",
        headers={"Authorization": "Bearer test-enroll"},
        json={"machine_name": "m1", "os": "darwin"},
    ).json()["machine_id"]
    tok = _login(client)
    h = {"Authorization": f"Bearer {tok}"}
    uid = client.get("/api/auth/me", headers=h).json()["id"]
    # 用登录用户建会话(归属该用户)
    sid = client.post("/api/sessions", headers=h, json={"machine_id": mid}).json()["session_id"]
    return sid, uid, tok


def test_ws_client_rejects_bad_ticket(client):
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/ws/client?ticket=bogus") as ws:
            ws.receive_json()


def test_ws_client_subscribe_own_session(client):
    sid, uid, tok = _make_session_for_admin(client)
    ticket = client.post("/api/ws-ticket", headers={"Authorization": f"Bearer {tok}"}).json()["ticket"]
    with client.websocket_connect(f"/ws/client?ticket={ticket}") as ws:
        ws.send_json({"type": "subscribe", "session_id": sid})
        ack = ws.receive_json()
        assert ack == {"type": "subscribed", "session_id": sid}


def test_ws_client_cannot_subscribe_others_session(client):
    sid, _uid, _tok = _make_session_for_admin(client)
    # 另一个用户
    admin_h = {"Authorization": f"Bearer {_login(client)}"}
    client.post("/api/users", headers=admin_h, json={"username": "bob", "password": "pass1234"})
    bob_tok = client.post("/api/auth/login", json={"username": "bob", "password": "pass1234"}).json()["token"]
    ticket = client.post("/api/ws-ticket", headers={"Authorization": f"Bearer {bob_tok}"}).json()["ticket"]
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect(f"/ws/client?ticket={ticket}") as ws:
            ws.send_json({"type": "subscribe", "session_id": sid})
            ws.receive_json()


# ---------- run_session_turn 发布事件 ----------


def _assistant(content=None, tool_calls=None):
    msg = {"role": "assistant", "content": content}
    if tool_calls:
        msg["tool_calls"] = tool_calls
    return {"choices": [{"message": msg}], "usage": {"prompt_tokens": 5, "completion_tokens": 3, "total_tokens": 8}}


class FakeGateway:
    def __init__(self, scripted):
        self._calls = iter(scripted)

    def resolve(self, user_id=None):
        return SimpleNamespace(id="fake", model="fake")

    async def chat(self, backend, messages, tools=None, **kw):
        return next(self._calls)


async def test_run_session_turn_publishes_events(tmp_path, monkeypatch):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path}/s.db")
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.create_all)
    sm = async_sessionmaker(engine, expire_on_commit=False)
    async with sm() as s:
        s.add(Machine(id="m1", machine_name="x", token_hash="h", capabilities=["remote_exec"]))
        s.add(Session(id="s1", user_id="u1", machine_id="m1"))
        await s.commit()

    from app.connectors import ConnectorManager

    bus = EventBus()
    app = SimpleNamespace(state=SimpleNamespace(
        connectors=ConnectorManager(),
        sessionmaker=sm,
        gateway=FakeGateway([
            _assistant(tool_calls=[{"id": "c1", "type": "function",
                                    "function": {"name": "remote_exec", "arguments": '{"workdir":".","command":"ls"}'}}]),
            _assistant(content="完成"),
        ]),
        events=bus,
        hub=RunnerHub(1024),
        settings=Settings(),
        task_sessions={},
    ))
    q = bus.subscribe("s1")

    async def fake_dispatch(app, machine_id, tool, payload, session_id=None):
        return SimpleNamespace(status="completed", result={"exit_code": 0, "stdout_tail": "ok"})

    monkeypatch.setattr(services, "dispatch_and_wait", fake_dispatch)

    res = await services.run_session_turn(app, "s1", "列个目录")
    assert res["stopped"] == "completed"

    events = []
    while not q.empty():
        events.append(q.get_nowait())
    types = [e["type"] for e in events]
    assert types[0] == "turn_started"
    assert "tool_call" in types
    assert "tool_result" in types
    assert "assistant" in types
    assert types[-1] == "turn_done"
    assert events[-1]["reply"] == "完成"
    await engine.dispose()
