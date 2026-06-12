"""per-user 模型登录(M15):每个用户用**自己的**订阅 OAuth 登录 per_user 后端。

留在"个人用自己订阅"的合规区——不做账号合用。后端的 OAuth 应用配置(client_id/endpoints)
由管理员建后端时填(M14 路径);本路由让每个用户跑设备码流程拿**自己的**令牌,各自加密隔离存。
"""

import json

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select

from .auth import require_user
from .models import ModelBackendRow, User, UserModelCredential, iso_utc, utcnow
from .secret import decrypt, encrypt

router = APIRouter()


async def _per_user_backend(session, backend_id: str, secret_key: str):
    row = await session.get(ModelBackendRow, backend_id)
    if row is None:
        raise HTTPException(404, {"code": "model_not_found", "message": "模型后端不存在"})
    if row.auth_scope != "per_user":
        raise HTTPException(409, {"code": "not_per_user", "message": "该后端非按用户登录"})
    cfg = json.loads(decrypt(row.oauth_enc, secret_key) or "{}") if row.oauth_enc else {}
    return row, cfg


@router.get("/api/me/model-logins")
async def list_model_logins(request: Request, user: User = Depends(require_user)) -> list[dict]:
    """列出需要"我用自己订阅登录"的后端,以及我是否已登录。"""
    sk = request.app.state.settings.secret_key
    async with request.app.state.sessionmaker() as session:
        rows = (
            await session.execute(
                select(ModelBackendRow).where(
                    ModelBackendRow.auth_scope == "per_user", ModelBackendRow.enabled.is_(True)
                )
            )
        ).scalars().all()
        creds = {
            c.backend_id: c
            for c in (
                await session.execute(
                    select(UserModelCredential).where(UserModelCredential.user_id == user.id)
                )
            ).scalars()
        }
    out = []
    for r in rows:
        cred = creds.get(r.id)
        tok = json.loads(decrypt(cred.oauth_enc, sk) or "{}") if (cred and cred.oauth_enc) else {}
        out.append({
            "backend_id": r.id, "name": r.name, "model": r.model, "runtime": r.runtime,
            "logged_in": bool(tok.get("access_token")),
            "updated_at": iso_utc(cred.updated_at) if cred else None,
        })
    return out


@router.post("/api/me/model-logins/{backend_id}/device/start")
async def my_device_start(backend_id: str, request: Request, user: User = Depends(require_user)) -> dict:
    """用我自己的订阅发起设备码授权。"""
    from . import oauth as oauth_mod

    sk = request.app.state.settings.secret_key
    async with request.app.state.sessionmaker() as session:
        _row, cfg = await _per_user_backend(session, backend_id, sk)
        if not cfg.get("device_authorization_url"):
            raise HTTPException(409, {"code": "no_device_flow", "message": "该后端未配置设备码端点"})
        try:
            resp = await oauth_mod.start_device_flow(cfg)
        except oauth_mod.OAuthError as exc:
            raise HTTPException(502, {"code": "oauth_failed", "message": exc.message or exc.code})
        # 把 pending device_code 暂存到该用户的凭据(加密),poll 时取
        cred = await session.get(UserModelCredential, (user.id, backend_id))
        pend = {"pending_device_code": resp.get("device_code")}
        if cred is None:
            session.add(UserModelCredential(user_id=user.id, backend_id=backend_id,
                                            oauth_enc=encrypt(json.dumps(pend), sk), updated_at=utcnow()))
        else:
            cur = json.loads(decrypt(cred.oauth_enc, sk) or "{}") if cred.oauth_enc else {}
            cur["pending_device_code"] = resp.get("device_code")
            cred.oauth_enc = encrypt(json.dumps(cur), sk)
            cred.updated_at = utcnow()
        await session.commit()
    return {
        "verification_uri": resp.get("verification_uri_complete") or resp.get("verification_uri"),
        "user_code": resp.get("user_code"),
        "expires_in": resp.get("expires_in"),
        "interval": resp.get("interval", 5),
    }


@router.post("/api/me/model-logins/{backend_id}/device/poll")
async def my_device_poll(backend_id: str, request: Request, user: User = Depends(require_user)) -> dict:
    from . import oauth as oauth_mod

    sk = request.app.state.settings.secret_key
    async with request.app.state.sessionmaker() as session:
        _row, cfg = await _per_user_backend(session, backend_id, sk)
        cred = await session.get(UserModelCredential, (user.id, backend_id))
        cur = json.loads(decrypt(cred.oauth_enc, sk) or "{}") if (cred and cred.oauth_enc) else {}
        device_code = cur.get("pending_device_code")
        if not device_code:
            raise HTTPException(409, {"code": "no_pending_device", "message": "请先发起设备码授权"})
        try:
            tok = await oauth_mod.poll_device_token({**cfg, **cur}, device_code)
        except oauth_mod.OAuthError as exc:
            raise HTTPException(502, {"code": "oauth_failed", "message": exc.message or exc.code})
        if tok.get("pending"):
            return {"status": "pending"}
        cur.update(tok)
        cur.pop("pending_device_code", None)
        cred.oauth_enc = encrypt(json.dumps(cur), sk)
        cred.updated_at = utcnow()
        await session.commit()
    return {"status": "authorized"}


@router.delete("/api/me/model-logins/{backend_id}")
async def my_logout(backend_id: str, request: Request, user: User = Depends(require_user)) -> dict:
    async with request.app.state.sessionmaker() as session:
        cred = await session.get(UserModelCredential, (user.id, backend_id))
        if cred is not None:
            await session.delete(cred)
            await session.commit()
    return {"logged_out": backend_id}
