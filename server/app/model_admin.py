"""模型管理(M8):DB 化模型后端 + 用户路由 + 加密密钥 + admin API + 热生效。

网关从 DB 构建;任何改动后调 rebuild_gateway() 即时生效,无需重启。
首次启动若 DB 为空且配置了 models.yaml,自动导入为初始数据。
"""

import pathlib

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import func, select

from .auth import require_admin
from .model_gateway import ModelBackend, ModelGateway
from .models import iso_utc, ModelBackendRow, User, UserModelRoute, new_id
from .schemas import ModelBackendIn, ModelBackendPatch, ModelDiscoverIn, ModelRouteIn
from .secret import decrypt, encrypt, redact_secret

router = APIRouter(prefix="/api/admin", dependencies=[Depends(require_admin)])


_iso = iso_utc


async def load_gateway_from_db(sessionmaker, secret_key: str) -> ModelGateway:
    async with sessionmaker() as session:
        rows = (
            await session.execute(select(ModelBackendRow).where(ModelBackendRow.enabled.is_(True)))
        ).scalars().all()
        routes = (await session.execute(select(UserModelRoute))).scalars().all()
    backends = [
        ModelBackend(
            id=r.id,
            base_url=r.base_url,
            model=r.model,
            api_key=(decrypt(r.api_key_enc, secret_key) if r.api_key_enc else "x") or "x",
            max_concurrency=r.max_concurrency,
        )
        for r in rows
    ]
    default_row = next((r for r in rows if r.is_default), rows[0] if rows else None)
    user_routes = {ur.user_id: ur.backend_id for ur in routes}
    return ModelGateway(backends, user_routes, default_row.id if default_row else None)


async def rebuild_gateway(app) -> None:
    """改动后热加载网关。"""
    app.state.gateway = await load_gateway_from_db(
        app.state.sessionmaker, app.state.settings.secret_key
    )


async def bootstrap_models(app, settings) -> None:
    """DB 为空且有 models.yaml 时,导入为初始数据(仅一次)。"""
    async with app.state.sessionmaker() as session:
        count = (await session.execute(select(func.count(ModelBackendRow.id)))).scalar_one()
        if count or not settings.models_config_path:
            return
        import yaml

        text = pathlib.Path(settings.models_config_path).read_text(encoding="utf-8")
        import os

        cfg = yaml.safe_load(os.path.expandvars(text)) or {}
        default = cfg.get("default_backend_id")
        name_to_id: dict[str, str] = {}
        for b in cfg.get("backends", []):
            rid = new_id("mb")
            name_to_id[b["id"]] = rid
            session.add(
                ModelBackendRow(
                    id=rid,
                    name=b["id"],
                    base_url=b["base_url"],
                    model=b["model"],
                    api_key_enc=encrypt(str(b.get("api_key") or "x"), settings.secret_key),
                    max_concurrency=int(b.get("max_concurrency") or 2),
                    is_default=(b["id"] == default),
                )
            )
        for uid, bid in (cfg.get("user_routes") or {}).items():
            if bid in name_to_id:
                session.add(UserModelRoute(user_id=uid, backend_id=name_to_id[bid]))
        await session.commit()


def _backend_out(r: ModelBackendRow, secret_key: str) -> dict:
    return {
        "id": r.id,
        "name": r.name,
        "base_url": r.base_url,
        "model": r.model,
        "api_key": redact_secret(decrypt(r.api_key_enc, secret_key) if r.api_key_enc else ""),  # 永不回显明文
        "max_concurrency": r.max_concurrency,
        "enabled": r.enabled,
        "is_default": r.is_default,
        "created_at": _iso(r.created_at),
    }


async def _clear_default(session) -> None:
    for row in (await session.execute(select(ModelBackendRow).where(ModelBackendRow.is_default.is_(True)))).scalars():
        row.is_default = False


@router.get("/model-providers")
async def list_providers() -> list[dict]:
    """预设 Provider 目录,供"添加 Provider"选择(选后自动填 base_url/model)。"""
    from .model_providers import PRESET_PROVIDERS

    return PRESET_PROVIDERS


@router.post("/model-providers/discover")
async def discover_models(body: ModelDiscoverIn) -> dict:
    """拉取端点的真实模型列表(GET /models),同时校验地址与 key(对标 Hermes)。

    key 仅本次探测使用,不落库;创建仍走 POST /models。
    """
    from . import model_providers

    try:
        models = await model_providers.list_models_from_endpoint(body.base_url, body.api_key)
    except Exception as exc:
        status = getattr(getattr(exc, "response", None), "status_code", None)
        if status in (401, 403):
            msg = "API Key 无效或无权限"
        elif status is not None:
            msg = f"端点返回 {status}"
        else:
            msg = f"无法连接端点: {exc}"
        raise HTTPException(502, {"code": "discover_failed", "message": msg})
    return {"models": models, "count": len(models)}


@router.get("/models")
async def list_models(request: Request) -> list[dict]:
    sk = request.app.state.settings.secret_key
    async with request.app.state.sessionmaker() as session:
        rows = (await session.execute(select(ModelBackendRow).order_by(ModelBackendRow.created_at))).scalars().all()
    return [_backend_out(r, sk) for r in rows]


@router.post("/models")
async def create_model(body: ModelBackendIn, request: Request) -> dict:
    sk = request.app.state.settings.secret_key
    async with request.app.state.sessionmaker() as session:
        exists = (
            await session.execute(select(ModelBackendRow).where(ModelBackendRow.name == body.name))
        ).scalar_one_or_none()
        if exists is not None:
            raise HTTPException(409, {"code": "name_exists", "message": "同名模型后端已存在"})
        if body.is_default:
            await _clear_default(session)
        row = ModelBackendRow(
            id=new_id("mb"),
            name=body.name,
            base_url=body.base_url,
            model=body.model,
            api_key_enc=encrypt(body.api_key, sk) if body.api_key else None,
            max_concurrency=body.max_concurrency,
            is_default=body.is_default,
        )
        session.add(row)
        await session.commit()
        out = _backend_out(row, sk)
    await rebuild_gateway(request.app)
    return out


@router.patch("/models/{backend_id}")
async def update_model(backend_id: str, body: ModelBackendPatch, request: Request) -> dict:
    sk = request.app.state.settings.secret_key
    async with request.app.state.sessionmaker() as session:
        row = await session.get(ModelBackendRow, backend_id)
        if row is None:
            raise HTTPException(404, {"code": "model_not_found", "message": "模型后端不存在"})
        if body.name is not None:
            row.name = body.name
        if body.base_url is not None:
            row.base_url = body.base_url
        if body.model is not None:
            row.model = body.model
        if body.api_key is not None:  # 提供才改;空串=清空
            row.api_key_enc = encrypt(body.api_key, sk) if body.api_key else None
        if body.max_concurrency is not None:
            row.max_concurrency = body.max_concurrency
        if body.enabled is not None:
            row.enabled = body.enabled
        if body.is_default is True:
            await _clear_default(session)
            row.is_default = True
        await session.commit()
        out = _backend_out(row, sk)
    await rebuild_gateway(request.app)
    return out


@router.delete("/models/{backend_id}")
async def delete_model(backend_id: str, request: Request) -> dict:
    async with request.app.state.sessionmaker() as session:
        row = await session.get(ModelBackendRow, backend_id)
        if row is None:
            raise HTTPException(404, {"code": "model_not_found", "message": "模型后端不存在"})
        await session.delete(row)
        await session.commit()
    await rebuild_gateway(request.app)
    return {"deleted": backend_id}


@router.get("/model-routes")
async def list_routes(request: Request) -> list[dict]:
    async with request.app.state.sessionmaker() as session:
        rows = (await session.execute(select(UserModelRoute))).scalars().all()
    return [{"user_id": r.user_id, "backend_id": r.backend_id} for r in rows]


@router.put("/model-routes")
async def set_route(body: ModelRouteIn, request: Request) -> dict:
    async with request.app.state.sessionmaker() as session:
        existing = await session.get(UserModelRoute, body.user_id)
        if body.backend_id is None:
            if existing is not None:
                await session.delete(existing)
        elif existing is not None:
            existing.backend_id = body.backend_id
        else:
            session.add(UserModelRoute(user_id=body.user_id, backend_id=body.backend_id))
        await session.commit()
    await rebuild_gateway(request.app)
    return {"user_id": body.user_id, "backend_id": body.backend_id}
