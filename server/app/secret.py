"""对称加密:模型/连接器等的密钥在 DB 加密存储,API 永不回显明文。

主密钥来自 AGENT_SECRET_KEY(生产必须设强随机值)。用 Fernet(AES-128-CBC + HMAC)。
"""

import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken


def _fernet(secret_key: str) -> Fernet:
    # 把任意字符串主密钥派生成 Fernet 需要的 32 字节 urlsafe-base64 key
    digest = hashlib.sha256(secret_key.encode()).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def encrypt(plaintext: str, secret_key: str) -> str:
    return _fernet(secret_key).encrypt(plaintext.encode()).decode()


def decrypt(ciphertext: str, secret_key: str) -> str | None:
    try:
        return _fernet(secret_key).decrypt(ciphertext.encode()).decode()
    except (InvalidToken, ValueError):
        return None


def redact_secret(plaintext: str | None) -> str:
    """给 API 回显用的脱敏形式,如 sk-…cdef。"""
    if not plaintext:
        return ""
    if len(plaintext) <= 8:
        return "••••"
    return f"{plaintext[:3]}…{plaintext[-4:]}"
