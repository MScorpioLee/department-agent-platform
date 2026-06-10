"""管理员审计查询 API(全部 require_admin)。读路径对凭据形态脱敏。

设计:功能性输出(资源所有者看自己机器 stdout)保留原文;此处面向管理员跨用户审阅,统一脱敏。
"""

from fastapi import APIRouter, Depends, Request
from sqlalchemy import func, select

from .auth import require_admin
from .models import Machine, Message, ModelUsage, Session, Task, ToolCall
from .redaction import redact, redact_obj

router = APIRouter(prefix="/api/audit", dependencies=[Depends(require_admin)])


def _iso(dt):
    return dt.isoformat() if dt else None


@router.get("/usage")
async def usage(request: Request, user_id: str | None = None) -> dict:
    """按用户与 backend 聚合 token 用量(支撑共享订阅的配额观察)。"""
    async with request.app.state.sessionmaker() as session:
        stmt = select(
            ModelUsage.user_id,
            ModelUsage.backend_id,
            func.sum(ModelUsage.prompt_tokens),
            func.sum(ModelUsage.completion_tokens),
            func.sum(ModelUsage.total_tokens),
            func.count(ModelUsage.id),
        ).group_by(ModelUsage.user_id, ModelUsage.backend_id)
        if user_id:
            stmt = stmt.where(ModelUsage.user_id == user_id)
        rows = (await session.execute(stmt)).all()
        total = (await session.execute(select(func.coalesce(func.sum(ModelUsage.total_tokens), 0)))).scalar_one()
    return {
        "total_tokens": int(total),
        "by_user_backend": [
            {
                "user_id": r[0],
                "backend_id": r[1],
                "prompt_tokens": int(r[2] or 0),
                "completion_tokens": int(r[3] or 0),
                "total_tokens": int(r[4] or 0),
                "turns": int(r[5] or 0),
            }
            for r in rows
        ],
    }


@router.get("/sessions")
async def sessions(request: Request, user_id: str | None = None, limit: int = 50) -> list[dict]:
    limit = max(1, min(limit, 200))
    async with request.app.state.sessionmaker() as session:
        stmt = select(Session).order_by(Session.created_at.desc()).limit(limit)
        if user_id:
            stmt = stmt.where(Session.user_id == user_id)
        rows = (await session.execute(stmt)).scalars().all()
        out = []
        for s in rows:
            msg_count = (
                await session.execute(
                    select(func.count(Message.id)).where(Message.session_id == s.id)
                )
            ).scalar_one()
            out.append(
                {
                    "session_id": s.id,
                    "user_id": s.user_id,
                    "machine_id": s.machine_id,
                    "title": s.title,
                    "status": s.status,
                    "message_count": int(msg_count),
                    "created_at": _iso(s.created_at),
                }
            )
    return out


@router.get("/tool-calls")
async def tool_calls(
    request: Request, session_id: str | None = None, machine_id: str | None = None, limit: int = 100
) -> list[dict]:
    limit = max(1, min(limit, 500))
    async with request.app.state.sessionmaker() as session:
        stmt = select(ToolCall).order_by(ToolCall.created_at.desc()).limit(limit)
        if session_id:
            stmt = stmt.where(ToolCall.session_id == session_id)
        if machine_id:
            stmt = stmt.where(ToolCall.machine_id == machine_id)
        rows = (await session.execute(stmt)).scalars().all()
    return [
        {
            "id": t.id,
            "session_id": t.session_id,
            "machine_id": t.machine_id,
            "tool_name": t.tool_name,
            "arguments": redact_obj(t.arguments_json),
            "result": redact_obj(t.result_json),
            "status": t.status,
            "created_at": _iso(t.created_at),
        }
        for t in rows
    ]


@router.get("/commands")
async def commands(request: Request, machine_id: str | None = None, limit: int = 100) -> list[dict]:
    """remote_exec 命令审计(命令与输出脱敏)。"""
    limit = max(1, min(limit, 500))
    async with request.app.state.sessionmaker() as session:
        stmt = (
            select(Task)
            .where(Task.tool == "remote_exec")
            .order_by(Task.created_at.desc())
            .limit(limit)
        )
        if machine_id:
            stmt = stmt.where(Task.machine_id == machine_id)
        rows = (await session.execute(stmt)).scalars().all()
    return [
        {
            "task_id": t.id,
            "machine_id": t.machine_id,
            "command": redact((t.payload or {}).get("command")),
            "status": t.status,
            "exit_code": (t.result or {}).get("exit_code"),
            "stdout": redact(t.stdout),
            "stderr": redact(t.stderr),
            "created_at": _iso(t.created_at),
        }
        for t in rows
    ]
