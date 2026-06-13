import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import delete, func, select

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
    Approval,
    AuthToken,
    EnrollmentToken,
    Machine,
    MachineGrant,
    Message,
    Session,
    Task,
    ToolCall,
    User,
    iso_utc,
    new_id,
    utcnow,
)
from .risk import evaluate_risk
from .schemas import (
    AssignMachineIn,
    EnrollIn,
    EnrollmentTokenIn,
    GrantIn,
    LoginIn,
    MessageIn,
    RegisterIn,
    SessionIn,
    TaskIn,
    UserCreateIn,
)
from .services import create_approval, dispatch_no_wait, run_session_turn

router = APIRouter()

_iso = iso_utc


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
    return {
        "id": u.id,
        "username": u.username,
        "display_name": u.display_name,
        "role": u.role,
        "status": u.status,
        "note": u.note,
        "created_at": _iso(u.created_at),
    }


def _grant_active(g: MachineGrant) -> bool:
    if g.expires_at is None:
        return True
    exp = g.expires_at
    if exp.tzinfo is None:  # SQLite 读出为 naive,按 UTC 解释
        exp = exp.replace(tzinfo=timezone.utc)
    return exp >= utcnow()


def _owner_or_admin(machine: Machine | None, principal: Principal) -> bool:
    """严格归属:仅机器所有者或管理员(用于授权管理、审批裁决,不含被授权人)。"""
    if principal.is_admin:
        return True
    return machine is not None and machine.owner_user_id == principal.user_id


async def _has_access(session, machine: Machine | None, principal: Principal) -> bool:
    """使用机器的权限:所有者 / 管理员 / 持有有效跨机器授权的被授权人。"""
    if _owner_or_admin(machine, principal):
        return True
    if machine is None or principal.user_id is None:
        return False
    grants = (
        await session.execute(
            select(MachineGrant).where(
                MachineGrant.machine_id == machine.id,
                MachineGrant.grantee_user_id == principal.user_id,
            )
        )
    ).scalars().all()
    return any(_grant_active(g) for g in grants)


async def _machine_or_403(session, machine_id: str, principal: Principal) -> Machine:
    machine = await session.get(Machine, machine_id)
    if machine is None:
        raise HTTPException(404, {"code": "machine_not_found", "message": "机器不存在"})
    if not await _has_access(session, machine, principal):
        raise HTTPException(403, {"code": "forbidden", "message": "无权访问该机器/资源"})
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
        if user.status == "pending":
            raise HTTPException(403, {"code": "pending_approval", "message": "账号待管理员审批,通过后可登录"})
        if user.status != "active":
            raise HTTPException(403, {"code": "account_disabled", "message": "账号不可用,请联系管理员"})
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


@router.post("/api/auth/logout")
async def logout(request: Request, user: User = Depends(require_user)) -> dict:
    """服务端吊销当前 token(删除 auth_tokens 记录),登出后该 token 立即失效。"""
    token = request.headers.get("authorization", "").removeprefix("Bearer ").strip()
    async with request.app.state.sessionmaker() as session:
        await session.execute(delete(AuthToken).where(AuthToken.token_hash == hash_token(token)))
        await session.commit()
    return {"ok": True}


@router.post("/api/ws-ticket")
async def ws_ticket(request: Request, principal: Principal = Depends(require_principal)) -> dict:
    """换取一次性短时票据,用于打开 /ws/client 实时通道(浏览器 cookie 鉴权的桥接)。"""
    ticket = request.app.state.tickets.issue(principal.user_id or "default")
    return {"ticket": ticket}


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


# ---------- 自助注册 + 管理员审批 ----------


@router.get("/api/auth/setup-status")
async def setup_status(request: Request) -> dict:
    """首次启动引导:空库(无任何用户)时 needs_setup=True,首个注册者将成为管理员。"""
    async with request.app.state.sessionmaker() as session:
        count = (await session.execute(select(func.count(User.id)))).scalar_one()
    return {
        "needs_setup": count == 0,
        "allow_registration": bool(getattr(request.app.state.settings, "allow_registration", True)),
    }


@router.post("/api/register")
async def register(body: RegisterIn, request: Request) -> dict:
    """自助注册。**首次(空库)注册者直接成为管理员**(active,无需审批);

    之后注册为普通用户(status=pending,需管理员审批)。bootstrap 始终允许,
    不受 allow_registration 限制(否则空库 + 关闭注册将永远没有管理员)。
    """
    settings = request.app.state.settings
    async with request.app.state.sessionmaker() as session:
        count = (await session.execute(select(func.count(User.id)))).scalar_one()
        is_bootstrap = count == 0
        if not is_bootstrap and not getattr(settings, "allow_registration", True):
            raise HTTPException(403, {"code": "registration_disabled", "message": "本服务器未开放自助注册,请联系管理员建号"})
        exists = (
            await session.execute(select(User).where(User.username == body.username))
        ).scalar_one_or_none()
        if exists is not None:
            raise HTTPException(409, {"code": "user_exists", "message": "用户名已被占用"})
        user = User(
            id=new_id("u"),
            username=body.username,
            display_name=body.display_name or body.username,
            role="admin" if is_bootstrap else "user",
            status="active" if is_bootstrap else "pending",
            note=body.note,
            password_hash=hash_password(body.password),
        )
        session.add(user)
        await session.commit()
    if is_bootstrap:
        # 首位 = 管理员,直接可用(前端拿到后自动登录)
        return {"status": "active", "role": "admin", "bootstrap": True,
                "username": body.username, "message": "管理员账号已创建,可直接登录"}
    return {"status": "pending", "username": body.username, "message": "注册已提交,等待管理员审批"}


@router.get("/api/admin/registrations", dependencies=[Depends(require_admin)])
async def list_registrations(request: Request) -> list[dict]:
    """待审批的注册申请(status=pending)。"""
    async with request.app.state.sessionmaker() as session:
        rows = (
            await session.execute(
                select(User).where(User.status == "pending").order_by(User.created_at)
            )
        ).scalars().all()
    return [_user_out(u) for u in rows]


@router.post("/api/admin/registrations/{user_id}/approve")
async def approve_registration(user_id: str, request: Request, _admin: User = Depends(require_admin)) -> dict:
    async with request.app.state.sessionmaker() as session:
        user = await session.get(User, user_id)
        if user is None:
            raise HTTPException(404, {"code": "user_not_found", "message": "用户不存在"})
        if user.status != "pending":
            raise HTTPException(409, {"code": "not_pending", "message": "该申请已被处理"})
        user.status = "active"
        await session.commit()
        out = _user_out(user)
    return out


@router.post("/api/admin/registrations/{user_id}/reject")
async def reject_registration(user_id: str, request: Request, _admin: User = Depends(require_admin)) -> dict:
    """拒绝:删除该待审批注册(用户名随之释放)。"""
    async with request.app.state.sessionmaker() as session:
        user = await session.get(User, user_id)
        if user is None:
            raise HTTPException(404, {"code": "user_not_found", "message": "用户不存在"})
        if user.status != "pending":
            raise HTTPException(409, {"code": "not_pending", "message": "该申请已被处理"})
        await session.delete(user)
        await session.commit()
    return {"rejected": user_id}


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


def _grant_out(g: MachineGrant) -> dict:
    return {
        "grant_id": g.id,
        "machine_id": g.machine_id,
        "grantee_user_id": g.grantee_user_id,
        "granted_by_user_id": g.granted_by_user_id,
        "expires_at": _iso(g.expires_at),
        "created_at": _iso(g.created_at),
    }


@router.post("/api/machines/{machine_id}/grants")
async def create_grant(
    machine_id: str, body: GrantIn, request: Request, principal: Principal = Depends(require_principal)
) -> dict:
    """机器所有者把临时访问授权给另一个用户(有效期内)。"""
    async with request.app.state.sessionmaker() as session:
        machine = await session.get(Machine, machine_id)
        if machine is None:
            raise HTTPException(404, {"code": "machine_not_found", "message": "机器不存在"})
        if not _owner_or_admin(machine, principal):
            raise HTTPException(403, {"code": "forbidden", "message": "仅机器所有者或管理员可授权"})
        if await session.get(User, body.grantee_user_id) is None:
            raise HTTPException(404, {"code": "user_not_found", "message": "grantee_user_id 不存在"})
        grant = MachineGrant(
            id=new_id("grant"),
            machine_id=machine_id,
            grantee_user_id=body.grantee_user_id,
            granted_by_user_id=principal.user_id,
            expires_at=utcnow() + timedelta(hours=body.expires_in_hours),
        )
        session.add(grant)
        await session.commit()
        out = _grant_out(grant)
    return out


@router.get("/api/machines/{machine_id}/grants")
async def list_grants(
    machine_id: str, request: Request, principal: Principal = Depends(require_principal)
) -> list[dict]:
    async with request.app.state.sessionmaker() as session:
        machine = await session.get(Machine, machine_id)
        if machine is None:
            raise HTTPException(404, {"code": "machine_not_found", "message": "机器不存在"})
        if not _owner_or_admin(machine, principal):
            raise HTTPException(403, {"code": "forbidden", "message": "仅机器所有者或管理员可查看授权"})
        rows = (
            await session.execute(select(MachineGrant).where(MachineGrant.machine_id == machine_id))
        ).scalars().all()
    return [_grant_out(g) for g in rows if _grant_active(g)]


@router.delete("/api/grants/{grant_id}")
async def revoke_grant(
    grant_id: str, request: Request, principal: Principal = Depends(require_principal)
) -> dict:
    async with request.app.state.sessionmaker() as session:
        grant = await session.get(MachineGrant, grant_id)
        if grant is None:
            raise HTTPException(404, {"code": "grant_not_found", "message": "授权不存在"})
        machine = await session.get(Machine, grant.machine_id)
        if not _owner_or_admin(machine, principal):
            raise HTTPException(403, {"code": "forbidden", "message": "仅机器所有者或管理员可撤销授权"})
        await session.delete(grant)
        await session.commit()
    return {"revoked": grant_id}


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
        rows = (await session.execute(select(Machine).order_by(Machine.created_at))).scalars().all()
        if not principal.is_admin:
            grants = (
                await session.execute(
                    select(MachineGrant).where(MachineGrant.grantee_user_id == principal.user_id)
                )
            ).scalars().all()
            granted_ids = {g.machine_id for g in grants if _grant_active(g)}
            rows = [m for m in rows if m.owner_user_id == principal.user_id or m.id in granted_ids]
    return [_machine_out(m, hub.is_online(m.id)) for m in rows]


@router.post("/api/tasks")
async def create_task(
    body: TaskIn, request: Request, principal: Principal = Depends(require_principal)
) -> dict:
    hub = request.app.state.hub
    async with request.app.state.sessionmaker() as session:
        machine = await _machine_or_403(session, body.machine_id, principal)
        machine_caps = machine.capabilities or []
    if not hub.is_online(body.machine_id):
        raise HTTPException(409, {"code": "machine_offline", "message": "目标机器不在线"})
    # 工具有效性按机器上报的能力判断(动态,不再用服务端写死列表;未上报时放行,Runner 兜底)
    if machine_caps and body.tool not in machine_caps:
        raise HTTPException(409, {"code": "tool_not_supported", "message": "目标机器未启用该工具"})

    # 高风险操作转审批,不直接下发
    rule = evaluate_risk(body.tool, body.payload)
    if rule:
        approval_id = await create_approval(
            request.app, body.machine_id, None, principal.user_id, body.tool, body.payload, rule
        )
        return {"status": "needs_approval", "approval_id": approval_id, "risk_rule": rule}

    task = await dispatch_no_wait(request.app, body.machine_id, body.tool, body.payload)
    if task.status == "lost":
        raise HTTPException(409, {"code": "machine_offline", "message": "下发失败,机器已断线"})
    return {"task_id": task.id, "status": task.status}


def _approval_out(ap: Approval) -> dict:
    return {
        "approval_id": ap.id,
        "machine_id": ap.machine_id,
        "session_id": ap.session_id,
        "requested_by_user_id": ap.requested_by_user_id,
        "tool": ap.tool,
        "payload": ap.payload,
        "risk_rule": ap.risk_rule,
        "status": ap.status,
        "task_id": ap.task_id,
        "created_at": _iso(ap.created_at),
        "decided_at": _iso(ap.decided_at),
    }


@router.get("/api/approvals")
async def list_approvals(
    request: Request, principal: Principal = Depends(require_principal), status: str = "pending"
) -> list[dict]:
    """列出当前用户有权审批的请求(自己名下机器;admin 看全部)。"""
    async with request.app.state.sessionmaker() as session:
        rows = (
            await session.execute(
                select(Approval).where(Approval.status == status).order_by(Approval.created_at.desc()).limit(200)
            )
        ).scalars().all()
        out = []
        for ap in rows:
            machine = await session.get(Machine, ap.machine_id)
            if principal.is_admin or (machine is not None and machine.owner_user_id == principal.user_id):
                out.append(_approval_out(ap))
    return out


async def _approval_for_decision(session, approval_id: str, principal: Principal) -> Approval:
    ap = await session.get(Approval, approval_id)
    if ap is None:
        raise HTTPException(404, {"code": "approval_not_found", "message": "审批不存在"})
    # 只有机器所有者或管理员可裁决;被授权人(grantee)不能自批
    machine = await session.get(Machine, ap.machine_id)
    if not _owner_or_admin(machine, principal):
        raise HTTPException(403, {"code": "forbidden", "message": "仅机器所有者或管理员可裁决审批"})
    if ap.status != "pending":
        raise HTTPException(409, {"code": "already_decided", "message": f"审批已处理: {ap.status}"})
    return ap


@router.post("/api/approvals/{approval_id}/approve")
async def approve(approval_id: str, request: Request, principal: Principal = Depends(require_principal)) -> dict:
    async with request.app.state.sessionmaker() as session:
        ap = await _approval_for_decision(session, approval_id, principal)
        ap.status = "approved"
        ap.decided_by_user_id = principal.user_id
        ap.decided_at = utcnow()
        await session.commit()
        tool, payload, machine_id = ap.tool, ap.payload, ap.machine_id
        ap_session_id = ap.session_id

    # 连接器(MCP)工具:批准后在服务端执行,不下发机器;结果落 ToolCall 审计
    if tool.startswith("mcp__"):
        result = await request.app.state.connectors.call(tool, payload or {})
        status = "failed" if isinstance(result, dict) and result.get("error_code") else "completed"
        if ap_session_id:  # 连接器审批均来自会话;落 ToolCall 审计
            async with request.app.state.sessionmaker() as session:
                session.add(
                    ToolCall(
                        id=new_id("tc"),
                        session_id=ap_session_id,
                        machine_id=machine_id,
                        tool_name=tool,
                        arguments_json=payload,
                        result_json=result,
                        status=status,
                    )
                )
                await session.commit()
        return {"approval_id": approval_id, "status": "approved", "result": result, "tool_status": status}

    if not request.app.state.hub.is_online(machine_id):
        raise HTTPException(409, {"code": "machine_offline", "message": "机器不在线,已批准但暂无法执行"})
    task = await dispatch_no_wait(request.app, machine_id, tool, payload)
    async with request.app.state.sessionmaker() as session:
        ap = await session.get(Approval, approval_id)
        ap.task_id = task.id
        await session.commit()
    return {"approval_id": approval_id, "status": "approved", "task_id": task.id, "task_status": task.status}


@router.post("/api/approvals/{approval_id}/reject")
async def reject(approval_id: str, request: Request, principal: Principal = Depends(require_principal)) -> dict:
    async with request.app.state.sessionmaker() as session:
        ap = await _approval_for_decision(session, approval_id, principal)
        ap.status = "rejected"
        ap.decided_by_user_id = principal.user_id
        ap.decided_at = utcnow()
        await session.commit()
    return {"approval_id": approval_id, "status": "rejected"}


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
    if not await _has_access(session, machine, principal):
        raise HTTPException(403, {"code": "forbidden", "message": "无权访问该任务"})
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
