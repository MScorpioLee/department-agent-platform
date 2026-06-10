from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select

from .auth import (
    check_enrollment_token,
    hash_password,
    hash_token,
    new_auth_token,
    new_runner_token,
    require_admin,
    require_api_key,
    require_user,
    verify_password,
)
from .models import AuthToken, Machine, Message, Session, Task, User, new_id, utcnow
from .schemas import EnrollIn, LoginIn, MessageIn, SessionIn, TaskIn, UserCreateIn
from .services import run_session_turn

router = APIRouter()

SUPPORTED_TOOLS = {
    "remote_exec",
    "remote_read_file",
    "remote_write_file",
    "remote_patch_file",
    "remote_list_files",
}


def _iso(dt: datetime | None) -> str | None:
    return dt.isoformat() if dt else None


def _machine_out(m: Machine, online: bool) -> dict:
    return {
        "machine_id": m.id,
        "machine_name": m.machine_name,
        "os": m.os,
        "status": "online" if online else "offline",
        "last_seen_at": _iso(m.last_seen_at),
        "capabilities": m.capabilities or [],
    }


def _task_out(t: Task) -> dict:
    return {
        "task_id": t.id,
        "machine_id": t.machine_id,
        "tool": t.tool,
        "payload": t.payload,
        "status": t.status,
        "result": t.result,
        "created_at": _iso(t.created_at),
        "finished_at": _iso(t.finished_at),
    }


def _user_out(u: User) -> dict:
    return {"id": u.id, "username": u.username, "display_name": u.display_name, "role": u.role}


@router.post("/api/auth/login")
async def login(body: LoginIn, request: Request) -> dict:
    async with request.app.state.sessionmaker() as session:
        user = (
            await session.execute(select(User).where(User.username == body.username))
        ).scalar_one_or_none()
        if user is None or not verify_password(body.password, user.password_hash):
            raise HTTPException(401, {"code": "invalid_credentials", "message": "用户名或密码错误"})
        token = new_auth_token()
        ttl_days = request.app.state.settings.auth_token_ttl_days
        session.add(
            AuthToken(
                id=new_id("tok"),
                user_id=user.id,
                token_hash=hash_token(token),
                expires_at=utcnow() + timedelta(days=ttl_days),
            )
        )
        await session.commit()
        out = _user_out(user)
    return {"token": token, "user": out}


@router.get("/api/auth/me")
async def whoami(user: User = Depends(require_user)) -> dict:
    return _user_out(user)


@router.post("/api/users")
async def create_user(body: UserCreateIn, request: Request, _admin: User = Depends(require_admin)) -> dict:
    async with request.app.state.sessionmaker() as session:
        exists = (
            await session.execute(select(User).where(User.username == body.username))
        ).scalar_one_or_none()
        if exists is not None:
            raise HTTPException(409, {"code": "user_exists", "message": "用户名已存在"})
        user = User(
            id=new_id("u"),
            username=body.username,
            display_name=body.display_name or body.username,
            role=body.role,
            password_hash=hash_password(body.password),
        )
        session.add(user)
        await session.commit()
        out = _user_out(user)
    return out


@router.get("/api/users", dependencies=[Depends(require_admin)])
async def list_users(request: Request) -> list[dict]:
    async with request.app.state.sessionmaker() as session:
        rows = (await session.execute(select(User).order_by(User.created_at))).scalars().all()
    return [_user_out(u) for u in rows]


@router.post("/api/runners/enroll")
async def enroll(body: EnrollIn, request: Request) -> dict:
    check_enrollment_token(request)
    token = new_runner_token()
    machine = Machine(
        id=new_id("m"),
        machine_name=body.machine_name,
        os=body.os,
        arch=body.arch,
        runner_version=body.runner_version,
        token_hash=hash_token(token),
    )
    async with request.app.state.sessionmaker() as session:
        session.add(machine)
        await session.commit()
    # runner_token 仅此一次下发,服务器只存哈希
    return {"machine_id": machine.id, "runner_token": token}


@router.get("/api/machines", dependencies=[Depends(require_api_key)])
async def list_machines(request: Request) -> list[dict]:
    hub = request.app.state.hub
    async with request.app.state.sessionmaker() as session:
        rows = (await session.execute(select(Machine).order_by(Machine.created_at))).scalars().all()
    return [_machine_out(m, hub.is_online(m.id)) for m in rows]


@router.post("/api/tasks", dependencies=[Depends(require_api_key)])
async def create_task(body: TaskIn, request: Request) -> dict:
    if body.tool not in SUPPORTED_TOOLS:
        raise HTTPException(422, {"code": "tool_unknown", "message": f"不支持的工具: {body.tool}"})
    hub = request.app.state.hub
    async with request.app.state.sessionmaker() as session:
        machine = await session.get(Machine, body.machine_id)
        if machine is None:
            raise HTTPException(404, {"code": "machine_not_found", "message": "机器不存在"})
        if machine.capabilities and body.tool not in machine.capabilities:
            raise HTTPException(409, {"code": "tool_not_supported", "message": "目标机器未上报该工具能力"})
        if not hub.is_online(body.machine_id):
            raise HTTPException(409, {"code": "machine_offline", "message": "目标机器不在线"})

        task = Task(id=new_id("t"), machine_id=body.machine_id, tool=body.tool, payload=body.payload)
        session.add(task)
        await session.commit()

        hub.open_buffer(task.id)
        sent = await hub.send(
            body.machine_id,
            {"protocol_version": 1, "type": "task", "task_id": task.id, "tool": task.tool, "payload": task.payload},
        )
        if not sent:
            hub.close_buffer(task.id)
            task.status = "lost"
            task.finished_at = utcnow()
            await session.commit()
            raise HTTPException(409, {"code": "machine_offline", "message": "下发失败,机器已断线"})
        task.status = "dispatched"
        task.dispatched_at = utcnow()
        await session.commit()
    return {"task_id": task.id, "status": task.status}


@router.get("/api/tasks", dependencies=[Depends(require_api_key)])
async def list_tasks(request: Request, machine_id: str | None = None, limit: int = 50) -> list[dict]:
    stmt = select(Task).order_by(Task.created_at.desc()).limit(max(1, min(limit, 200)))
    if machine_id:
        stmt = stmt.where(Task.machine_id == machine_id)
    async with request.app.state.sessionmaker() as session:
        rows = (await session.execute(stmt)).scalars().all()
    return [_task_out(t) for t in rows]


@router.get("/api/tasks/{task_id}", dependencies=[Depends(require_api_key)])
async def get_task(task_id: str, request: Request) -> dict:
    async with request.app.state.sessionmaker() as session:
        task = await session.get(Task, task_id)
    if task is None:
        raise HTTPException(404, {"code": "task_not_found", "message": "任务不存在"})
    return _task_out(task)


@router.get("/api/tasks/{task_id}/output", dependencies=[Depends(require_api_key)])
async def get_task_output(task_id: str, request: Request) -> dict:
    # 运行中的任务从内存缓冲读,已结束的从库里读
    buf = request.app.state.hub.buffer(task_id)
    if buf is not None:
        return {"stdout": buf.text("stdout"), "stderr": buf.text("stderr"), "truncated": buf.truncated}
    async with request.app.state.sessionmaker() as session:
        task = await session.get(Task, task_id)
    if task is None:
        raise HTTPException(404, {"code": "task_not_found", "message": "任务不存在"})
    return {"stdout": task.stdout, "stderr": task.stderr, "truncated": task.truncated}


@router.post("/api/sessions", dependencies=[Depends(require_api_key)])
async def create_session(body: SessionIn, request: Request) -> dict:
    async with request.app.state.sessionmaker() as session:
        machine = await session.get(Machine, body.machine_id)
        if machine is None:
            raise HTTPException(404, {"code": "machine_not_found", "message": "机器不存在"})
        sess = Session(id=new_id("s"), user_id=body.user_id, machine_id=body.machine_id, title=body.title)
        session.add(sess)
        await session.commit()
    return {"session_id": sess.id, "machine_id": sess.machine_id, "status": sess.status}


@router.post("/api/sessions/{session_id}/messages", dependencies=[Depends(require_api_key)])
async def post_message(session_id: str, body: MessageIn, request: Request) -> dict:
    # run_session_turn 内部已校验会话存在并处理 ModelError
    return await run_session_turn(request.app, session_id, body.content)


@router.get("/api/sessions/{session_id}/messages", dependencies=[Depends(require_api_key)])
async def list_messages(session_id: str, request: Request) -> list[dict]:
    async with request.app.state.sessionmaker() as session:
        sess = await session.get(Session, session_id)
        if sess is None:
            raise HTTPException(404, {"code": "session_not_found", "message": "会话不存在"})
        rows = (
            await session.execute(
                select(Message).where(Message.session_id == session_id).order_by(Message.seq)
            )
        ).scalars().all()
    return [
        {
            "seq": m.seq,
            "role": m.role,
            "content": m.content,
            "tool_calls": m.tool_calls,
            "tool_call_id": m.tool_call_id,
            "created_at": _iso(m.created_at),
        }
        for m in rows
    ]


@router.post("/api/tasks/{task_id}/cancel", dependencies=[Depends(require_api_key)])
async def cancel_task(task_id: str, request: Request) -> dict:
    async with request.app.state.sessionmaker() as session:
        task = await session.get(Task, task_id)
    if task is None:
        raise HTTPException(404, {"code": "task_not_found", "message": "任务不存在"})
    if task.status not in ("queued", "dispatched", "running"):
        raise HTTPException(409, {"code": "already_finished", "message": f"任务已是终态: {task.status}"})
    await request.app.state.hub.send(
        task.machine_id, {"protocol_version": 1, "type": "task_cancel", "task_id": task.id}
    )
    # 状态仍由 Runner 回传的 task_result(status=cancelled)推进
    return {"task_id": task.id, "status": task.status}
