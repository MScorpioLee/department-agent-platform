"""敏感信息脱敏。用于审计读路径:管理员跨用户审阅日志时,常见凭据形态打码。

注意:功能性输出(资源所有者在控制台看自己机器的 stdout)保留原文;
本模块只作用于面向管理员的审计接口返回(见 docs/security.md §4)。
脱敏是尽力而为的纵深防御,不能替代「不读敏感路径 + 低权限账号运行 Runner」等前置控制。
"""

import re

_PATTERNS = [
    # 私钥块
    (re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----.*?-----END [A-Z ]*PRIVATE KEY-----", re.DOTALL), "«REDACTED-PRIVATE-KEY»"),
    # Authorization: Bearer xxx
    (re.compile(r"(?i)(bearer\s+)[A-Za-z0-9\-._~+/]{12,}=*"), r"\1«REDACTED»"),
    # 常见 key 前缀(OpenAI/DeepSeek/Anthropic/runner/enroll/auth token 等)
    (re.compile(r"\b(sk|rt|at|et|xoxb|ghp|gho|AKIA)[-_][A-Za-z0-9\-_]{8,}"), "«REDACTED-TOKEN»"),
    (re.compile(r"\bsk-[A-Za-z0-9]{16,}"), "«REDACTED-TOKEN»"),
    # key=value / "password": "..." 形态(兼容 JSON 的引号与 = / : 分隔)
    (re.compile(r"(?i)(\"?\b(?:password|passwd|secret|api[_-]?key|token|access[_-]?key)\b\"?\s*[:=]\s*\"?)([^\s\"',]{6,})"), r"\1«REDACTED»"),
]


def redact(text: str | None) -> str | None:
    if not text:
        return text
    out = text
    for pattern, repl in _PATTERNS:
        out = pattern.sub(repl, out)
    return out


def redact_obj(value):
    """递归脱敏 dict/list/str(用于工具调用参数与结果的审计展示)。"""
    if isinstance(value, str):
        return redact(value)
    if isinstance(value, dict):
        return {k: redact_obj(v) for k, v in value.items()}
    if isinstance(value, list):
        return [redact_obj(v) for v in value]
    return value
