import asyncio
import contextlib
import logging
import time

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from sqlalchemy import select, update

from .auth import hash_token
from .models import ACTIVE_TASK_STATUSES, RESULT_STATUSES, Machine, Task, utcnow

router = APIRouter()
log = logging.getLogger(__name__)

# 服务端支持的协议大版本。无法同时升级所有 Runner,故对旧版需向后兼容;
# 仅当 Runner 协议大版本不在此集合时拒绝连接并提示升级(见 docs/packaging.md)。
SUPPORTED_PROTOCOL_VERSIONS = {1}
WS_CLOSE_PROTOCOL_INCOMPATIBLE = 4426


async def mark_machine_lost(app, machine_id: str) -> None:
    """机器断线:状态置 offline,该机所有非终态任务置 lost(不自动重试,见 protocol.md §3.1)。"""
    async with app.state.sessionmaker() as session:
        lost_ids = (
            await session.execute(
                select(Task.id).where(
                    Task.machine_id == machine_id, Task.status.in_(ACTIVE_TASK_STATUSES)
                )
            )
        ).scalars().all()
        await session.execute(update(Machine).where(Machine.id == machine_id).values(status="offline"))
        await session.execute(
            update(Task)
            .where(Task.machine_id == machine_id, Task.status.in_(ACTIVE_TASK_STATUSES))
            .values(status="lost", finished_at=utcnow())
        )
        await session.commit()
    # 唤醒所有在等这些任务的 Agent Loop,避免永久挂起
    for tid in lost_ids:
        app.state.hub.resolve(tid)


@router.websocket("/ws/runner")
async def runner_ws(ws: WebSocket) -> None:
    app = ws.app
    token = ws.headers.get("authorization", "").removeprefix("Bearer ").strip()
    machine = None
    if token:
        async with app.state.sessionmaker() as session:
            machine = (
                await session.execute(select(Machine).where(Machine.token_hash == hash_token(token)))
            ).scalar_one_or_none()

    await ws.accept()
    if machine is None:
        await ws.close(code=4401)
        return

    try:
        hello = await ws.receive_json()
    except WebSocketDisconnect:
        return
    if hello.get("type") != "hello" or hello.get("machine_id") != machine.id:
        await ws.close(code=4400)
        return

    # 协议版本校验:大版本不兼容直接拒绝,附带原因便于 Runner 提示升级
    try:
        proto = int(hello.get("protocol_version", 1))
    except (TypeError, ValueError):
        proto = -1
    if proto not in SUPPORTED_PROTOCOL_VERSIONS:
        log.warning("机器 %s 协议版本 %s 不受支持,拒绝连接", machine.id, proto)
        await ws.close(
            code=WS_CLOSE_PROTOCOL_INCOMPATIBLE,
            reason=f"protocol_version {proto} 不受支持(服务端支持 {sorted(SUPPORTED_PROTOCOL_VERSIONS)}),请升级 Runner",
        )
        return

    hub = app.state.hub
    conn = await hub.attach(machine.id, ws)
    async with app.state.sessionmaker() as session:
        await session.execute(
            update(Machine)
            .where(Machine.id == machine.id)
            .values(
                status="online",
                last_seen_at=utcnow(),
                runner_version=hello.get("runner_version"),
                capabilities=hello.get("capabilities"),
                tools=hello.get("tools"),
                allowed_roots=hello.get("allowed_roots"),
            )
        )
        await session.commit()
    await ws.send_json(
        {
            "protocol_version": 1,
            "type": "hello_ack",
            "machine_id": machine.id,
            "server_time": utcnow().isoformat(),
        }
    )

    try:
        while True:
            frame = await ws.receive_json()
            ftype = frame.get("type")

            if ftype == "heartbeat":
                conn.last_heartbeat = time.monotonic()
                conn.status = frame.get("status", "idle")
                async with app.state.sessionmaker() as session:
                    await session.execute(
                        update(Machine).where(Machine.id == machine.id).values(last_seen_at=utcnow())
                    )
                    await session.commit()

            elif ftype == "task_accepted":
                async with app.state.sessionmaker() as session:
                    await session.execute(
                        update(Task)
                        .where(Task.id == frame.get("task_id"), Task.status == "dispatched")
                        .values(status="running")
                    )
                    await session.commit()

            elif ftype == "task_output":
                task_id = frame.get("task_id")
                buf = hub.buffer(task_id)
                if buf is not None:
                    buf.add(frame.get("stream", "stdout"), int(frame.get("seq", 0)), str(frame.get("data", "")))
                # 实时转发到该任务所属会话的订阅者(若有)
                sid = app.state.task_sessions.get(task_id)
                if sid:
                    await app.state.events.publish(
                        sid,
                        {
                            "type": "tool_output",
                            "task_id": task_id,
                            "stream": frame.get("stream", "stdout"),
                            "data": str(frame.get("data", "")),
                        },
                    )

            elif ftype == "task_result":
                task_id = frame.get("task_id")
                status = frame.get("status")
                if status not in RESULT_STATUSES:
                    status = "failed"
                result = frame.get("result") or {}
                buf = hub.close_buffer(task_id)
                async with app.state.sessionmaker() as session:
                    await session.execute(
                        update(Task)
                        .where(Task.id == task_id, Task.status.in_(ACTIVE_TASK_STATUSES))
                        .values(
                            status=status,
                            result=result,
                            stdout=buf.text("stdout"),
                            stderr=buf.text("stderr"),
                            truncated=buf.truncated or bool(result.get("truncated")),
                            finished_at=utcnow(),
                        )
                    )
                    await session.commit()
                hub.resolve(task_id)  # 唤醒等待该任务的 Agent Loop

            else:
                log.warning("机器 %s 发来未知帧类型: %s", machine.id, ftype)
    except WebSocketDisconnect:
        pass
    finally:
        hub.detach(machine.id, ws)
        # shield:连接被取消(如进程收尾)时,断线清理仍要完整落库
        with contextlib.suppress(asyncio.CancelledError):
            await asyncio.shield(mark_machine_lost(app, machine.id))
