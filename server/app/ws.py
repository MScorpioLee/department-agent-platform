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


async def mark_machine_lost(app, machine_id: str) -> None:
    """机器断线:状态置 offline,该机所有非终态任务置 lost(不自动重试,见 protocol.md §3.1)。"""
    async with app.state.sessionmaker() as session:
        await session.execute(update(Machine).where(Machine.id == machine_id).values(status="offline"))
        await session.execute(
            update(Task)
            .where(Task.machine_id == machine_id, Task.status.in_(ACTIVE_TASK_STATUSES))
            .values(status="lost", finished_at=utcnow())
        )
        await session.commit()


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
                buf = hub.buffer(frame.get("task_id"))
                if buf is not None:
                    buf.add(frame.get("stream", "stdout"), int(frame.get("seq", 0)), str(frame.get("data", "")))

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

            else:
                log.warning("机器 %s 发来未知帧类型: %s", machine.id, ftype)
    except WebSocketDisconnect:
        pass
    finally:
        hub.detach(machine.id, ws)
        # shield:连接被取消(如进程收尾)时,断线清理仍要完整落库
        with contextlib.suppress(asyncio.CancelledError):
            await asyncio.shield(mark_machine_lost(app, machine.id))
