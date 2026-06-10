import hashlib
import hmac
import os
import secrets
from dataclasses import dataclass
from datetime import timezone

from fastapi import HTTPException, Request
from sqlalchemy import select

from .models import AuthToken, EnrollmentToken, User, utcnow

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


@dataclass
class Principal:
    """统一的调用主体。via=api_key 时是管理/服务通道(看全部);via=user 时按归属受限。"""

    user_id: str | None
    is_admin: bool
    via: str  # "user" | "api_key"


async def require_principal(request: Request) -> Principal:
    """双认证:X-API-Key(管理通道)优先,否则用户 token。供 machines/tasks/sessions 端点使用。"""
    api_key = request.headers.get("x-api-key")
    if api_key:
        if secrets.compare_digest(api_key, request.app.state.settings.api_key):
            return Principal(user_id=None, is_admin=True, via="api_key")
        raise HTTPException(401, {"code": "unauthorized", "message": "X-API-Key 无效"})
    user = await require_user(request)
    return Principal(user_id=user.id, is_admin=(user.role == "admin"), via="user")


async def consume_enrollment_token(session, settings, token: str) -> tuple[bool, str | None]:
    """校验并消费 enrollment token,返回 (是否有效, 机器归属的 user_id)。

    优先查表(可绑定 owner、限次限期);回退到 settings 里的静态 token(无主,兼容现有部署)。
    """
    if not token:
        return False, None
    row = (
        await session.execute(select(EnrollmentToken).where(EnrollmentToken.token_hash == hash_token(token)))
    ).scalar_one_or_none()
    if row is not None:
        if _expired(row.expires_at):
            return False, None
        if row.max_uses and row.used_count >= row.max_uses:
            return False, None
        row.used_count += 1
        return True, row.owner_user_id
    if settings.enrollment_token and secrets.compare_digest(token, settings.enrollment_token):
        return True, None
    return False, None


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
