import hashlib
import hmac
import os
import secrets
from datetime import timezone

from fastapi import HTTPException, Request
from sqlalchemy import select

from .models import AuthToken, User, utcnow

PBKDF2_ITERATIONS = 200_000


def hash_token(token: str) -> str:
    # runner_token / auth_token 本身是高熵随机串,sha256 即可,无需加盐慢哈希
    return hashlib.sha256(token.encode()).hexdigest()


def new_runner_token() -> str:
    return "rt_" + secrets.token_urlsafe(32)


def new_auth_token() -> str:
    return "at_" + secrets.token_urlsafe(32)


def hash_password(password: str) -> str:
    """密码是低熵,必须加盐 + 慢哈希(pbkdf2)。格式:pbkdf2_sha256$iters$salt$hash。"""
    salt = os.urandom(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, PBKDF2_ITERATIONS)
    return f"pbkdf2_sha256${PBKDF2_ITERATIONS}${salt.hex()}${dk.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, iters, salt_hex, hash_hex = stored.split("$")
        if algo != "pbkdf2_sha256":
            return False
        dk = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt_hex), int(iters))
        return hmac.compare_digest(dk.hex(), hash_hex)
    except (ValueError, TypeError):
        return False


def _expired(expires_at) -> bool:
    if expires_at is None:
        return False
    # SQLite 读出的 datetime 为 naive,按 UTC 解释后再比较
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    return expires_at < utcnow()


async def require_user(request: Request) -> User:
    token = request.headers.get("authorization", "").removeprefix("Bearer ").strip()
    if not token:
        raise HTTPException(401, {"code": "unauthorized", "message": "缺少认证 token"})
    async with request.app.state.sessionmaker() as session:
        row = (
            await session.execute(select(AuthToken).where(AuthToken.token_hash == hash_token(token)))
        ).scalar_one_or_none()
        if row is None or _expired(row.expires_at):
            raise HTTPException(401, {"code": "unauthorized", "message": "token 无效或已过期"})
        user = await session.get(User, row.user_id)
    if user is None:
        raise HTTPException(401, {"code": "unauthorized", "message": "用户不存在"})
    return user


async def require_admin(request: Request) -> User:
    user = await require_user(request)
    if user.role != "admin":
        raise HTTPException(403, {"code": "forbidden", "message": "需要管理员权限"})
    return user


def require_api_key(request: Request) -> None:
    expected = request.app.state.settings.api_key
    provided = request.headers.get("x-api-key", "")
    if not secrets.compare_digest(provided, expected):
        raise HTTPException(401, {"code": "unauthorized", "message": "X-API-Key 无效"})


def check_enrollment_token(request: Request) -> None:
    auth = request.headers.get("authorization", "")
    token = auth.removeprefix("Bearer ").strip()
    expected = request.app.state.settings.enrollment_token
    if not token or not secrets.compare_digest(token, expected):
        raise HTTPException(401, {"code": "unauthorized", "message": "enrollment token 无效"})
