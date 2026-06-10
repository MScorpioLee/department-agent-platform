import secrets
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select

from .auth import (
    Principal,
    consume_enrollment_token,
    hash_password,
    hash_token,
    new_auth_token,
    new_runner_token,
    require_admin,
    require_principal,
    require_user,
    verify_password,
)
from .models import (
    AuthToken,
    EnrollmentToken,
    Machine,
    Message,
    Session,
    Task,
    User,
    new_id,
    utcnow,
)
from .schemas import (
    AssignMachineIn,
    EnrollIn,
    EnrollmentTokenIn,
    LoginIn,
    MessageIn,
    SessionIn,
    TaskIn,
    UserCreateIn,
)
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
        "owner_user_id": m.owner_user_id,
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


def _check_owner(owner_user_id: str | None, principal: Principal) -> None:
    """非管理员只能访问归属自己的资源(无主机器也拒绝,需先由管理员分配)。"""
    if principal.is_admin:
        return
    if owner_user_id is None or owner_user_id != principal.user_id:
        raise HTTPException(403, {"code": "forbidden", "message": "无权访问该机器/资源"})


async def _machine_or_403(session, machine_id: str, principal: Principal) -> Machine:
    machine = await session.get(Machine, machine_id)
    if machine is None:
        raise HTTPException(404, {"code": "machine_not_found", "message": "机器不存在"})
    _check_owner(machine.owner_user_id, principal)
    return machine


# ---------- 认证 ----------


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


# ---------- 机器注册与归属(管理) ----------


@router.post("/api/enrollment-tokens")
async def create_enrollment_token(
    body: EnrollmentTokenIn, request: Request, _admin: User = Depends(require_admin)
) -> dict:
    token = "et_" + secrets.token_urlsafe(24)
    async with request.app.state.sessionmaker() as session:
        if body.owner_user_id is not None:
            if await session.get(User, body.owner_user_id) is None:
                raise HTTPException(404, {"code": "user_not_found", "message": "owner_user_id 不存在"})
        session.add(
            EnrollmentToken(
                id=new_id("et"),
                token_hash=hash_token(token),
                owner_user_id=body.owner_user_id,
                max_uses=body.max_uses,
                expires_at=utcnow() + timedelta(days=body.expires_in_days),
            )
        )
        await session.commit()
    # 明文 token 仅此一次返回
    return {"enrollment_token": token, "owner_user_id": body.owner_user_id, "max_uses": body.max_uses}


@router.post("/api/machines/{machine_id}/assign")
async def assign_machine(
    machine_id: str, body: AssignMachineIn, request: Request, _admin: User = Depends(require_admin)
) -> dict:
    async with request.app.state.sessionmaker() as session:
        machine = await session.get(Machine, machine_id)
        if machine is None:
            raise HTTPException(404, {"code": "machine_not_found", "message": "机器不存在"})
        if body.user_id is not None and await session.get(User, body.user_id) is None:
            raise HTTPException(404, {"code": "user_not_found", "message": "user_id 不存在"})
        machine.owner_user_id = body.user_id
        await session.commit()
    return {"machine_id": machine_id, "owner_user_id": body.user_id}


@router.post("/api/runners/enroll")
async def enroll(body: EnrollIn, request: Request) -> dict:
    token_in = request.headers.get("authorization", "").removeprefix("Bearer ").strip()
    runner_token = new_runner_token()
    async with request.app.state.sessionmaker() as session:
        valid, owner_user_id = await consume_enrollment_token(
            session, request.app.state.settings, token_in
        )
        if not valid:
            raise HTTPException(401, {"code": "unauthorized", "message": "enrollment token 无效"})
        machine = Machine(
            id=new_id("m"),
            machine_name=body.machine_name,
            owner_user_id=owner_user_id,
            os=body.os,
            arch=body.arch,
            runner_version=body.runner_version,
            token_hash=hash_token(runner_token),
        )
        session.add(machine)
        await session.commit()
        machine_id = machine.id
    return {"machine_id": machine_id, "runner_token": runner_token}


# ---------- 机器与任务 ----------


@router.get("/api/machines")
async def list_machines(request: Request, principal: Principal = Depends(require_principal)) -> list[dict]:
    hub = request.app.state.hub
    async with request.app.state.sessionmaker() as session:
        stmt = select(Machine).order_by(Machine.created_at)
        if not principal.is_admin:
            stmt = stmt.where(Machine.owner_user_id == principal.user_id)
        rows = (await session.execute(stmt)).scalars().all()
    return [_machine_out(m, hub.is_online(m.id)) for m in rows]


@router.post("/api/tasks")
async def create_task(
    body: TaskIn, request: Request, principal: Principal = Depends(require_principal)
) -> dict:
    if body.tool not in SUPPORTED_TOOLS:
        raise HTTPException(422, {"code": "tool_unknown", "message": f"不支持的工具: {body.tool}"})
    hub = request.app.state.hub
    async with request.app.state.sessionmaker() as session:
        machine = await _machine_or_403(session, body.machine_id, principal)
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


@router.get("/api/tasks")
async def list_tasks(
    request: Request,
    principal: Principal = Depends(require_principal),
    machine_id: str | None = None,
    limit: int = 50,
) -> list[dict]:
    async with request.app.state.sessionmaker() as session:
        stmt = select(Task).order_by(Task.created_at.desc()).limit(max(1, min(limit, 200)))
        if machine_id:
            await _machine_or_403(session, machine_id, principal)
            stmt = stmt.where(Task.machine_id == machine_id)
        elif not principal.is_admin:
            owned = select(Machine.id).where(Machine.owner_user_id == principal.user_id)
            stmt = stmt.where(Task.machine_id.in_(owned))
        rows = (await session.execute(stmt)).scalars().all()
    return [_task_out(t) for t in rows]


async def _task_or_403(session, task_id: str, principal: Principal) -> Task:
    task = await session.get(Task, task_id)
    if task is None:
        raise HTTPException(404, {"code": "task_not_found", "message": "任务不存在"})
    machine = await session.get(Machine, task.machine_id)
    _check_owner(machine.owner_user_id if machine else None, principal)
    return task


@router.get("/api/tasks/{task_id}")
async def get_task(task_id: str, request: Request, principal: Principal = Depends(require_principal)) -> dict:
    async with request.app.state.sessionmaker() as session:
        task = await _task_or_403(session, task_id, principal)
        return _task_out(task)


@router.get("/api/tasks/{task_id}/output")
async def get_task_output(
    task_id: str, request: Request, principal: Principal = Depends(require_principal)
) -> dict:
    buf = request.app.state.hub.buffer(task_id)
    async with request.app.state.sessionmaker() as session:
        task = await _task_or_403(session, task_id, principal)
        if buf is not None:
            return {"stdout": buf.text("stdout"), "stderr": buf.text("stderr"), "truncated": buf.truncated}
        return {"stdout": task.stdout, "stderr": task.stderr, "truncated": task.truncated}


@router.post("/api/tasks/{task_id}/cancel")
async def cancel_task(
    task_id: str, request: Request, principal: Principal = Depends(require_principal)
) -> dict:
    async with request.app.state.sessionmaker() as session:
        task = await _task_or_403(session, task_id, principal)
        if task.status not in ("queued", "dispatched", "running"):
            raise HTTPException(409, {"code": "already_finished", "message": f"任务已是终态: {task.status}"})
        machine_id = task.machine_id
    await request.app.state.hub.send(
        machine_id, {"protocol_version": 1, "type": "task_cancel", "task_id": task_id}
    )
    return {"task_id": task_id, "status": task.status}


# ---------- 会话 ----------


@router.post("/api/sessions")
async def create_session(
    body: SessionIn, request: Request, principal: Principal = Depends(require_principal)
) -> dict:
    async with request.app.state.sessionmaker() as session:
        await _machine_or_403(session, body.machine_id, principal)
        # 会话归属当前用户;X-API-Key 管理通道用占位 user_id
        user_id = principal.user_id or "default"
        sess = Session(id=new_id("s"), user_id=user_id, machine_id=body.machine_id, title=body.title)
        session.add(sess)
        await session.commit()
    return {"session_id": sess.id, "machine_id": sess.machine_id, "status": sess.status}


async def _session_or_403(session, session_id: str, principal: Principal) -> Session:
    sess = await session.get(Session, session_id)
    if sess is None:
        raise HTTPException(404, {"code": "session_not_found", "message": "会话不存在"})
    if not principal.is_admin and sess.user_id != principal.user_id:
        raise HTTPException(403, {"code": "forbidden", "message": "无权访问该会话"})
    return sess


@router.post("/api/sessions/{session_id}/messages")
async def post_message(
    session_id: str, body: MessageIn, request: Request, principal: Principal = Depends(require_principal)
) -> dict:
    async with request.app.state.sessionmaker() as session:
        await _session_or_403(session, session_id, principal)
    return await run_session_turn(request.app, session_id, body.content)


@router.get("/api/sessions/{session_id}/messages")
async def list_messages(
    session_id: str, request: Request, principal: Principal = Depends(require_principal)
) -> list[dict]:
    async with request.app.state.sessionmaker() as session:
        await _session_or_403(session, session_id, principal)
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
