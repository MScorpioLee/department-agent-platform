import hashlib
import secrets

from fastapi import HTTPException, Request


def hash_token(token: str) -> str:
    # runner_token 本身是高熵随机串,sha256 即可,无需加盐慢哈希
    return hashlib.sha256(token.encode()).hexdigest()


def new_runner_token() -> str:
    return "rt_" + secrets.token_urlsafe(32)


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
