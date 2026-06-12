"""标准 OAuth 2.0 流程(M14):设备码(RFC 8628)+ 授权码 PKCE(RFC 7636)+ 刷新令牌。

只实现**标准、厂商无关**的 OAuth——管理员填该厂商发的 client_id/endpoints,平台跑流程。
刻意不内置任何第一方(Claude Code/Codex CLI)的 client_id;那种"用订阅冒充官方客户端"
违反厂商 ToS,不进本代码库(用法见 docs/management.md:订阅走外部运行时代理 external_runtime 预设)。

httpx 调用经 client_factory 注入,便于用假端点完整测试,不依赖真实 IdP。
"""

import base64
import hashlib
import secrets
import time
from urllib.parse import urlencode

import httpx


class OAuthError(Exception):
    def __init__(self, code: str, message: str = "") -> None:
        self.code = code
        self.message = message
        super().__init__(f"{code}: {message}")


def pkce_pair() -> tuple[str, str]:
    """返回 (code_verifier, code_challenge[S256])。"""
    verifier = secrets.token_urlsafe(64)[:128]
    digest = hashlib.sha256(verifier.encode()).digest()
    challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode()
    return verifier, challenge


def build_authorize_url(cfg: dict, state: str, challenge: str) -> str:
    params = {
        "response_type": "code",
        "client_id": cfg["client_id"],
        "redirect_uri": cfg.get("redirect_uri", ""),
        "scope": cfg.get("scope", ""),
        "state": state,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
    }
    return cfg["authorization_url"] + ("&" if "?" in cfg["authorization_url"] else "?") + urlencode(params)


def _normalize_tokens(tok: dict) -> dict:
    out = {
        "access_token": tok.get("access_token"),
        "refresh_token": tok.get("refresh_token"),
        "token_type": tok.get("token_type") or "Bearer",
    }
    if tok.get("expires_in"):
        out["expires_at"] = time.time() + int(tok["expires_in"])
    return {k: v for k, v in out.items() if v is not None}


async def _token_request(url: str, data: dict, client_factory, *, allow_pending: bool = False) -> dict:
    async with client_factory(timeout=15) as http:
        resp = await http.post(url, data=data, headers={"Accept": "application/json"})
    if resp.status_code >= 400:
        body = {}
        try:
            body = resp.json()
        except Exception:
            pass
        err = body.get("error")
        if allow_pending and err in ("authorization_pending", "slow_down"):
            return {"pending": True, "error": err}
        raise OAuthError(err or f"http_{resp.status_code}",
                         body.get("error_description") or resp.text[:200])
    return _normalize_tokens(resp.json())


async def start_device_flow(cfg: dict, *, client_factory=httpx.AsyncClient) -> dict:
    """RFC 8628:返回 {device_code, user_code, verification_uri[/_complete], expires_in, interval}。"""
    data = {"client_id": cfg["client_id"], "scope": cfg.get("scope", "")}
    async with client_factory(timeout=15) as http:
        resp = await http.post(cfg["device_authorization_url"], data=data,
                               headers={"Accept": "application/json"})
    if resp.status_code >= 400:
        raise OAuthError(f"http_{resp.status_code}", resp.text[:200])
    return resp.json()


async def poll_device_token(cfg: dict, device_code: str, *, client_factory=httpx.AsyncClient) -> dict:
    """轮询设备令牌:未授权返回 {pending:True},成功返回标准 tokens。"""
    data = {
        "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
        "device_code": device_code,
        "client_id": cfg["client_id"],
    }
    if cfg.get("client_secret"):
        data["client_secret"] = cfg["client_secret"]
    return await _token_request(cfg["token_url"], data, client_factory, allow_pending=True)


async def exchange_code(cfg: dict, code: str, verifier: str, *, client_factory=httpx.AsyncClient) -> dict:
    data = {
        "grant_type": "authorization_code",
        "code": code,
        "client_id": cfg["client_id"],
        "redirect_uri": cfg.get("redirect_uri", ""),
        "code_verifier": verifier,
    }
    if cfg.get("client_secret"):
        data["client_secret"] = cfg["client_secret"]
    return await _token_request(cfg["token_url"], data, client_factory)


async def refresh_tokens(cfg: dict, refresh_token: str, *, client_factory=httpx.AsyncClient) -> dict:
    data = {
        "grant_type": "refresh_token",
        "refresh_token": refresh_token,
        "client_id": cfg["client_id"],
    }
    if cfg.get("client_secret"):
        data["client_secret"] = cfg["client_secret"]
    tok = await _token_request(cfg["token_url"], data, client_factory)
    # 有些 IdP 刷新时不回新 refresh_token,沿用旧的
    tok.setdefault("refresh_token", refresh_token)
    return tok


def token_expired(cfg: dict, *, skew: float = 60.0) -> bool:
    exp = cfg.get("expires_at")
    return bool(exp) and time.time() > (exp - skew)
