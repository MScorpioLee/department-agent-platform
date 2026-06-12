"""连接器管理 admin API(M10)。⚠ 创建连接器=配置在服务端运行第三方代码:仅管理员。

env 加密存、API 不回显值(只回 key 名);改动后热加载连接器管理器。
完整 OS 沙箱属部署层(见 docs/management.md)。
"""

import json

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import delete, select

from .auth import require_admin
from .models import iso_utc, Connector, ConnectorScope, new_id
from .schemas import ConnectorIn, ConnectorPatch, ConnectorScopeIn
from .secret import decrypt, encrypt

router = APIRouter(prefix="/api/admin", dependencies=[Depends(require_admin)])


_iso = iso_utc


async def _reload(request: Request) -> None:
    await request.app.state.connectors.reload(
        request.app.state.sessionmaker, request.app.state.settings.secret_key
    )


def _out(row: Connector, secret_key: str, manager, scopes: list[str]) -> dict:
    env = json.loads(decrypt(row.env_enc, secret_key) or "{}") if row.env_enc else {}
    tool_count = sum(1 for t in manager.tools.values() if t.connector_id == row.id)
    return {
        "id": row.id,
        "name": row.name,
        "transport": row.transport,
        "command": row.command,
        "args": row.args or [],
        "url": row.url,
        "env_keys": sorted(env.keys()),  # 只回 key 名,不回值
        "enabled": row.enabled,
        "scope_all": row.scope_all,
        "require_approval": row.require_approval,
        "scopes": scopes,
        "status": manager.status.get(row.id, "disabled" if not row.enabled else "unknown"),
        "tool_count": tool_count,
        "created_at": _iso(row.created_at),
    }


@router.get("/connector-presets")
async def list_connector_presets() -> list[dict]:
    """预设连接器目录(常用 MCP server),供"添加连接器"选择后自动填 command/args。"""
    from .connector_providers import CONNECTOR_PRESETS

    return CONNECTOR_PRESETS


@router.get("/connectors")
async def list_connectors(request: Request) -> list[dict]:
    sk = request.app.state.settings.secret_key
    mgr = request.app.state.connectors
    async with request.app.state.sessionmaker() as session:
        rows = (await session.execute(select(Connector).order_by(Connector.created_at))).scalars().all()
        scope_rows = (await session.execute(select(ConnectorScope))).scalars().all()
    scopes: dict[str, list[str]] = {}
    for s in scope_rows:
        scopes.setdefault(s.connector_id, []).append(s.user_id)
    return [_out(r, sk, mgr, scopes.get(r.id, [])) for r in rows]


@router.post("/connectors")
async def create_connector(body: ConnectorIn, request: Request) -> dict:
    sk = request.app.state.settings.secret_key
    async with request.app.state.sessionmaker() as session:
        if (await session.execute(select(Connector).where(Connector.name == body.name))).scalar_one_or_none():
            raise HTTPException(409, {"code": "name_exists", "message": "同名连接器已存在"})
        row = Connector(
            id=new_id("conn"),
            name=body.name,
            transport=body.transport,
            command=body.command,
            args=body.args,
            url=body.url,
            env_enc=encrypt(json.dumps(body.env), sk) if body.env else None,
            scope_all=body.scope_all,
            require_approval=body.require_approval,
        )
        session.add(row)
        await session.commit()
        rid = row.id
    await _reload(request)
    async with request.app.state.sessionmaker() as session:
        row = await session.get(Connector, rid)
    return _out(row, sk, request.app.state.connectors, [])


@router.patch("/connectors/{connector_id}")
async def update_connector(connector_id: str, body: ConnectorPatch, request: Request) -> dict:
    sk = request.app.state.settings.secret_key
    async with request.app.state.sessionmaker() as session:
        row = await session.get(Connector, connector_id)
        if row is None:
            raise HTTPException(404, {"code": "connector_not_found", "message": "连接器不存在"})
        if body.name is not None:
            row.name = body.name
        if body.command is not None:
            row.command = body.command
        if body.args is not None:
            row.args = body.args
        if body.url is not None:
            row.url = body.url
        if body.env is not None:
            row.env_enc = encrypt(json.dumps(body.env), sk) if body.env else None
        if body.enabled is not None:
            row.enabled = body.enabled
        if body.scope_all is not None:
            row.scope_all = body.scope_all
        if body.require_approval is not None:
            row.require_approval = body.require_approval
        await session.commit()
    await _reload(request)
    async with request.app.state.sessionmaker() as session:
        row = await session.get(Connector, connector_id)
        scopes = [s.user_id for s in (await session.execute(
            select(ConnectorScope).where(ConnectorScope.connector_id == connector_id))).scalars()]
    return _out(row, sk, request.app.state.connectors, scopes)


@router.delete("/connectors/{connector_id}")
async def delete_connector(connector_id: str, request: Request) -> dict:
    async with request.app.state.sessionmaker() as session:
        row = await session.get(Connector, connector_id)
        if row is None:
            raise HTTPException(404, {"code": "connector_not_found", "message": "连接器不存在"})
        await session.execute(delete(ConnectorScope).where(ConnectorScope.connector_id == connector_id))
        await session.delete(row)
        await session.commit()
    await _reload(request)
    return {"deleted": connector_id}


@router.put("/connectors/{connector_id}/scope")
async def set_scope(connector_id: str, body: ConnectorScopeIn, request: Request) -> dict:
    async with request.app.state.sessionmaker() as session:
        if await session.get(Connector, connector_id) is None:
            raise HTTPException(404, {"code": "connector_not_found", "message": "连接器不存在"})
        await session.execute(delete(ConnectorScope).where(ConnectorScope.connector_id == connector_id))
        for uid in set(body.user_ids):
            session.add(ConnectorScope(connector_id=connector_id, user_id=uid))
        await session.commit()
    await _reload(request)
    return {"connector_id": connector_id, "user_ids": body.user_ids}
