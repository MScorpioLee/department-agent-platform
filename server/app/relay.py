"""OpenAI 兼容中转端点(M13):把模型网关暴露为标准 /v1 API,服务端即"API 中转站"。

任意 OpenAI 兼容客户端(本平台 `agent code` 本地 Agent、第三方工具)把 base_url 指到
本服务即可用:认证用个人 API Key(ak_…,哈希存储)或登录 token;按用户路由 backend;
用量计入 ModelUsage(session_id=api_relay)审计。仅转发 messages/tools,模型由路由决定
(客户端传的 model 字段忽略);暂不支持 stream。
"""

import secrets

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select

from .auth import hash_token, require_user
from .model_gateway import ModelError
from .models import ModelUsage, User, UserApiKey, new_id, utcnow

router = APIRouter()

RELAY_SESSION = "api_relay"  # ModelUsage.session_id 占位:区分中转调用与平台会话


async def _relay_user(request: Request) -> User:
    """中转认证:个人 API Key(ak_…)优先,否则按登录 token。"""
    token = request.headers.get("authorization", "").removeprefix("Bearer ").strip()
    if token.startswith("ak_"):
        async with request.app.state.sessionmaker() as session:
            row = (
                await session.execute(select(UserApiKey).where(UserApiKey.key_hash == hash_token(token)))
            ).scalar_one_or_none()
            if row is None:
                raise HTTPException(401, {"code": "unauthorized", "message": "API Key 无效"})
            row.last_used_at = utcnow()
            user = await session.get(User, row.user_id)
            await session.commit()
        if user is None:
            raise HTTPException(401, {"code": "unauthorized", "message": "用户不存在"})
        return user
    return await require_user(request)


# ---------- 个人 API Key 管理(登录用户自助) ----------


@router.post("/api/me/api-keys")
async def create_api_key(request: Request, user: User = Depends(require_user)) -> dict:
    body = {}
    try:
        body = await request.json()
    except Exception:
        pass
    name = str((body or {}).get("name") or "")[:64]
    plain = "ak_" + secrets.token_urlsafe(32)
    row = UserApiKey(
        id=new_id("akey"), user_id=user.id, name=name,
        key_hash=hash_token(plain), prefix=plain[:11] + "…",
    )
    async with request.app.state.sessionmaker() as session:
        session.add(row)
        await session.commit()
    # 明文仅此一次返回
    return {"id": row.id, "name": name, "prefix": row.prefix, "api_key": plain}


@router.get("/api/me/api-keys")
async def list_api_keys(request: Request, user: User = Depends(require_user)) -> list[dict]:
    async with request.app.state.sessionmaker() as session:
        rows = (
            await session.execute(
                select(UserApiKey).where(UserApiKey.user_id == user.id).order_by(UserApiKey.created_at)
            )
        ).scalars().all()
    from .models import iso_utc

    return [
        {"id": r.id, "name": r.name, "prefix": r.prefix,
         "created_at": iso_utc(r.created_at), "last_used_at": iso_utc(r.last_used_at)}
        for r in rows
    ]


@router.delete("/api/me/api-keys/{key_id}")
async def revoke_api_key(key_id: str, request: Request, user: User = Depends(require_user)) -> dict:
    async with request.app.state.sessionmaker() as session:
        row = await session.get(UserApiKey, key_id)
        if row is None or row.user_id != user.id:
            raise HTTPException(404, {"code": "key_not_found", "message": "API Key 不存在"})
        await session.delete(row)
        await session.commit()
    return {"deleted": key_id}


# ---------- OpenAI 兼容 /v1 ----------


@router.get("/v1/models")
async def v1_models(request: Request, user: User = Depends(_relay_user)) -> dict:
    try:
        backend = request.app.state.gateway.resolve(user.id)
    except ModelError as exc:
        raise HTTPException(503, {"code": exc.code, "message": exc.message})
    return {"object": "list", "data": [{"id": backend.model, "object": "model", "owned_by": backend.id}]}


@router.post("/v1/chat/completions")
async def v1_chat_completions(request: Request, user: User = Depends(_relay_user)) -> dict:
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(422, {"code": "payload_invalid", "message": "请求体须为 JSON"})
    messages = body.get("messages")
    if not isinstance(messages, list) or not messages:
        raise HTTPException(422, {"code": "payload_invalid", "message": "messages 不能为空"})
    if body.get("stream"):
        raise HTTPException(400, {"code": "stream_unsupported", "message": "暂不支持 stream,请去掉该参数"})

    gateway = request.app.state.gateway
    try:
        backend = gateway.resolve(user.id)
        completion = await gateway.chat(backend, messages, body.get("tools") or None)
    except ModelError as exc:
        raise HTTPException(503, {"code": exc.code, "message": exc.message})

    usage = completion.get("usage") or {}
    if usage.get("total_tokens") or usage.get("prompt_tokens"):
        async with request.app.state.sessionmaker() as session:
            session.add(
                ModelUsage(
                    id=new_id("mu"),
                    session_id=RELAY_SESSION,
                    user_id=user.id,
                    backend_id=backend.id,
                    model=backend.model,
                    prompt_tokens=int(usage.get("prompt_tokens") or 0),
                    completion_tokens=int(usage.get("completion_tokens") or 0),
                    total_tokens=int(usage.get("total_tokens") or 0),
                )
            )
            await session.commit()
    return completion
