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
from .schemas import ModelBackendIn, ModelBackendPatch, ModelDiscoverIn, ModelRouteIn, OAuthCallbackIn
from .secret import decrypt, encrypt, redact_secret

router = APIRouter(prefix="/api/admin", dependencies=[Depends(require_admin)])


_iso = iso_utc


async def _oauth_access_token(session, row, secret_key: str) -> str:
    """OAuth 后端:取 access_token,临近过期则用 refresh_token 刷新并持久化。未授权返回占位 'x'。"""
    import json

    from . import oauth as oauth_mod

    cfg = json.loads(decrypt(row.oauth_enc, secret_key) or "{}") if row.oauth_enc else {}
    access = cfg.get("access_token")
    if not access:
        return "x"  # 尚未完成授权
    if oauth_mod.token_expired(cfg) and cfg.get("refresh_token"):
        try:
            tok = await oauth_mod.refresh_tokens(cfg, cfg["refresh_token"])
            cfg.update(tok)
            row.oauth_enc = encrypt(json.dumps(cfg), secret_key)
            await session.commit()
            access = cfg.get("access_token") or access
        except Exception:  # 刷新失败用旧 token,上游 401 会暴露,不阻断启动
            pass
    return access or "x"


async def load_gateway_from_db(sessionmaker, secret_key: str) -> ModelGateway:
    async with sessionmaker() as session:
        rows = (
            await session.execute(select(ModelBackendRow).where(ModelBackendRow.enabled.is_(True)))
        ).scalars().all()
        routes = (await session.execute(select(UserModelRoute))).scalars().all()
        backends = []
        for r in rows:
            import json as _json

            requires_user_auth = (r.auth_scope == "per_user")
            extra_headers = None
            if r.auth_type == "oauth":
                cfg = _json.loads(decrypt(r.oauth_enc, secret_key) or "{}") if r.oauth_enc else {}
                extra_headers = cfg.get("extra_headers")
                # per_user 的令牌在调用时按用户解析,快照里占位
                api_key = "x" if requires_user_auth else await _oauth_access_token(session, r, secret_key)
            else:
                api_key = (decrypt(r.api_key_enc, secret_key) if r.api_key_enc else "x") or "x"
            backends.append(ModelBackend(
                id=r.id, base_url=r.base_url, model=r.model, api_key=api_key,
                max_concurrency=r.max_concurrency, runtime=r.runtime,
                extra_headers=extra_headers, requires_user_auth=requires_user_auth))
    default_row = next((r for r in rows if r.is_default), rows[0] if rows else None)
    user_routes = {ur.user_id: ur.backend_id for ur in routes}
    return ModelGateway(backends, user_routes, default_row.id if default_row else None)


async def rebuild_gateway(app) -> None:
    """改动后热加载网关。"""
    app.state.gateway = await load_gateway_from_db(
        app.state.sessionmaker, app.state.settings.secret_key
    )


async def resolve_backend_for_user(app, user_id: str):
    """解析该用户实际要打的后端。per_user 后端用该用户自己的订阅令牌(临近过期则刷新)。"""
    import json

    from . import oauth as oauth_mod
    from .models import ModelBackendRow, UserModelCredential, utcnow

    backend = app.state.gateway.resolve(user_id)  # 路由决策 + 共享后端直接可用
    if not getattr(backend, "requires_user_auth", False):
        return backend
    sk = app.state.settings.secret_key
    async with app.state.sessionmaker() as session:
        row = await session.get(ModelBackendRow, backend.id)
        cred = await session.get(UserModelCredential, (user_id, backend.id))
        if cred is None or not cred.oauth_enc:
            from .model_gateway import ModelError

            raise ModelError("oauth_login_required", "请先用你的订阅登录该 Provider(我的模型登录)")
        app_cfg = json.loads(decrypt(row.oauth_enc, sk) or "{}") if (row and row.oauth_enc) else {}
        tok_cfg = json.loads(decrypt(cred.oauth_enc, sk) or "{}")
        merged = {**app_cfg, **tok_cfg}  # 端点来自后端配置,令牌来自用户凭据
        if oauth_mod.token_expired(merged) and merged.get("refresh_token"):
            try:
                tok = await oauth_mod.refresh_tokens(merged, merged["refresh_token"])
                tok_cfg.update(tok)
                cred.oauth_enc = encrypt(json.dumps(tok_cfg), sk)
                cred.updated_at = utcnow()
                await session.commit()
                merged.update(tok)
            except Exception:
                pass
        token = merged.get("access_token") or "x"
        extra = app_cfg.get("extra_headers")
    from .model_gateway import ModelBackend

    return ModelBackend(
        id=backend.id, base_url=backend.base_url, model=backend.model, api_key=token,
        max_concurrency=backend.max_concurrency, runtime=backend.runtime, extra_headers=extra)


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


def _oauth_status(r: ModelBackendRow, secret_key: str) -> dict | None:
    """OAuth 后端的脱敏状态:只回 client_id/endpoints 是否就绪 + 是否已授权,绝不回 secret/token。"""
    if r.auth_type != "oauth":
        return None
    import json

    from . import oauth as oauth_mod

    cfg = json.loads(decrypt(r.oauth_enc, secret_key) or "{}") if r.oauth_enc else {}
    if not cfg.get("client_id"):
        state = "unconfigured"
    elif not cfg.get("access_token"):
        state = "pending"  # 已配置,待授权
    elif oauth_mod.token_expired(cfg) and not cfg.get("refresh_token"):
        state = "expired"
    else:
        state = "authorized"
    return {
        "status": state,
        "client_id": cfg.get("client_id", ""),
        "scope": cfg.get("scope", ""),
        "has_device_flow": bool(cfg.get("device_authorization_url")),
        "has_auth_code_flow": bool(cfg.get("authorization_url")),
        "expires_at": cfg.get("expires_at"),
    }


def _backend_out(r: ModelBackendRow, secret_key: str) -> dict:
    return {
        "id": r.id,
        "name": r.name,
        "base_url": r.base_url,
        "model": r.model,
        "auth_type": r.auth_type,
        "auth_scope": r.auth_scope,
        "runtime": r.runtime,
        "api_key": redact_secret(decrypt(r.api_key_enc, secret_key) if r.api_key_enc else ""),  # 永不回显明文
        "oauth": _oauth_status(r, secret_key),
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
        if body.auth_type == "oauth":
            if body.oauth is None:
                raise HTTPException(422, {"code": "oauth_config_required", "message": "OAuth 后端需提供 oauth 配置"})
            import json

            oauth_enc = encrypt(json.dumps(body.oauth.model_dump()), sk)
        else:
            oauth_enc = None
        row = ModelBackendRow(
            id=new_id("mb"),
            name=body.name,
            base_url=body.base_url,
            model=body.model,
            auth_type=body.auth_type,
            auth_scope=body.auth_scope,
            runtime=body.runtime,
            api_key_enc=encrypt(body.api_key, sk) if (body.auth_type == "api_key" and body.api_key) else None,
            oauth_enc=oauth_enc,
            max_concurrency=body.max_concurrency,
            is_default=body.is_default,
        )
        session.add(row)
        await session.commit()
        out = _backend_out(row, sk)
    await rebuild_gateway(request.app)
    return out


# ---------- OAuth 流程(设备码 + 授权码 PKCE + 刷新)----------


async def _load_oauth_cfg(session, backend_id: str, secret_key: str):
    """返回 (row, cfg dict);非 oauth 或不存在则抛 HTTP 错误。"""
    import json

    row = await session.get(ModelBackendRow, backend_id)
    if row is None:
        raise HTTPException(404, {"code": "model_not_found", "message": "模型后端不存在"})
    if row.auth_type != "oauth":
        raise HTTPException(409, {"code": "not_oauth", "message": "该后端不是 OAuth 认证"})
    cfg = json.loads(decrypt(row.oauth_enc, secret_key) or "{}") if row.oauth_enc else {}
    return row, cfg


async def _save_oauth_cfg(session, row, cfg: dict, secret_key: str) -> None:
    import json

    row.oauth_enc = encrypt(json.dumps(cfg), secret_key)
    await session.commit()


@router.post("/models/{backend_id}/oauth/device/start")
async def oauth_device_start(backend_id: str, request: Request) -> dict:
    """发起设备码授权:返回 verification_uri + user_code,管理员浏览器授权后再 poll。"""
    from . import oauth as oauth_mod

    sk = request.app.state.settings.secret_key
    async with request.app.state.sessionmaker() as session:
        row, cfg = await _load_oauth_cfg(session, backend_id, sk)
        if not cfg.get("device_authorization_url"):
            raise HTTPException(409, {"code": "no_device_flow", "message": "该 Provider 未配置设备码端点"})
        try:
            resp = await oauth_mod.start_device_flow(cfg)
        except oauth_mod.OAuthError as exc:
            raise HTTPException(502, {"code": "oauth_failed", "message": exc.message or exc.code})
        cfg["pending_device_code"] = resp.get("device_code")
        await _save_oauth_cfg(session, row, cfg, sk)
    return {
        "verification_uri": resp.get("verification_uri_complete") or resp.get("verification_uri"),
        "user_code": resp.get("user_code"),
        "expires_in": resp.get("expires_in"),
        "interval": resp.get("interval", 5),
    }


@router.post("/models/{backend_id}/oauth/device/poll")
async def oauth_device_poll(backend_id: str, request: Request) -> dict:
    """轮询设备令牌:pending=等待授权;authorized=已拿到令牌(已落库+热加载网关)。"""
    from . import oauth as oauth_mod

    sk = request.app.state.settings.secret_key
    async with request.app.state.sessionmaker() as session:
        row, cfg = await _load_oauth_cfg(session, backend_id, sk)
        device_code = cfg.get("pending_device_code")
        if not device_code:
            raise HTTPException(409, {"code": "no_pending_device", "message": "请先发起设备码授权"})
        try:
            tok = await oauth_mod.poll_device_token(cfg, device_code)
        except oauth_mod.OAuthError as exc:
            raise HTTPException(502, {"code": "oauth_failed", "message": exc.message or exc.code})
        if tok.get("pending"):
            return {"status": "pending"}
        cfg.update(tok)
        cfg.pop("pending_device_code", None)
        await _save_oauth_cfg(session, row, cfg, sk)
    await rebuild_gateway(request.app)
    return {"status": "authorized"}


@router.get("/models/{backend_id}/oauth/authorize-url")
async def oauth_authorize_url(backend_id: str, request: Request) -> dict:
    """授权码 PKCE:返回浏览器授权 URL + state,管理员授权后回调 /oauth/callback。"""
    import secrets as _secrets

    from . import oauth as oauth_mod

    sk = request.app.state.settings.secret_key
    async with request.app.state.sessionmaker() as session:
        row, cfg = await _load_oauth_cfg(session, backend_id, sk)
        if not cfg.get("authorization_url"):
            raise HTTPException(409, {"code": "no_auth_code_flow", "message": "该 Provider 未配置授权端点"})
        verifier, challenge = oauth_mod.pkce_pair()
        state = _secrets.token_urlsafe(16)
        cfg["pending_verifier"] = verifier
        cfg["pending_state"] = state
        url = oauth_mod.build_authorize_url(cfg, state, challenge)
        await _save_oauth_cfg(session, row, cfg, sk)
    return {"authorize_url": url, "state": state}


@router.post("/models/{backend_id}/oauth/callback")
async def oauth_callback(backend_id: str, body: OAuthCallbackIn, request: Request) -> dict:
    """授权码回调:用 code 换取令牌(校验 state)。"""
    from . import oauth as oauth_mod

    sk = request.app.state.settings.secret_key
    async with request.app.state.sessionmaker() as session:
        row, cfg = await _load_oauth_cfg(session, backend_id, sk)
        if body.state and cfg.get("pending_state") and body.state != cfg["pending_state"]:
            raise HTTPException(400, {"code": "state_mismatch", "message": "state 不匹配,疑似 CSRF"})
        verifier = cfg.get("pending_verifier", "")
        try:
            tok = await oauth_mod.exchange_code(cfg, body.code, verifier)
        except oauth_mod.OAuthError as exc:
            raise HTTPException(502, {"code": "oauth_failed", "message": exc.message or exc.code})
        cfg.update(tok)
        cfg.pop("pending_verifier", None)
        cfg.pop("pending_state", None)
        await _save_oauth_cfg(session, row, cfg, sk)
    await rebuild_gateway(request.app)
    return {"status": "authorized"}


@router.post("/models/{backend_id}/oauth/refresh")
async def oauth_refresh(backend_id: str, request: Request) -> dict:
    """手动刷新令牌(到期自动刷新已在网关构建时进行,此处供主动触发)。"""
    from . import oauth as oauth_mod

    sk = request.app.state.settings.secret_key
    async with request.app.state.sessionmaker() as session:
        row, cfg = await _load_oauth_cfg(session, backend_id, sk)
        if not cfg.get("refresh_token"):
            raise HTTPException(409, {"code": "no_refresh_token", "message": "无 refresh_token,需重新授权"})
        try:
            tok = await oauth_mod.refresh_tokens(cfg, cfg["refresh_token"])
        except oauth_mod.OAuthError as exc:
            raise HTTPException(502, {"code": "oauth_failed", "message": exc.message or exc.code})
        cfg.update(tok)
        await _save_oauth_cfg(session, row, cfg, sk)
    await rebuild_gateway(request.app)
    return {"status": "refreshed"}


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
