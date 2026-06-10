"""高风险操作识别。

⚠ 重要(docs/security.md §0、CLAUDE.md 不变量 #5):
这只是**审计与审批触发层**,不是安全边界。模式匹配可被轻易绕过(rm -fr、写脚本再执行、
base64 解码、python -c 等),绝不能依赖它阻止恶意命令。真正的边界是 Server 侧授权 + Runner
低权限账号运行 + 路径校验。本模块的作用仅是:标记风险、触发人工审批、留痕。
"""

import re

# (规则名, 正则)。命中任一即标记为高风险,需人工审批。
_COMMAND_RULES: list[tuple[str, re.Pattern]] = [
    ("recursive_force_delete", re.compile(r"\brm\s+(-\w*\s+)*-\w*[rf]\w*", re.I)),
    ("windows_del_recursive", re.compile(r"\bdel\b.*/[sq]", re.I)),
    ("format_or_partition", re.compile(r"\b(format|diskpart|mkfs\w*)\b", re.I)),
    ("disk_dd", re.compile(r"\bdd\s+if=", re.I)),
    ("registry_delete", re.compile(r"\breg\s+delete\b", re.I)),
    ("encoded_powershell", re.compile(r"powershell.*-enc(odedcommand)?\b", re.I)),
    ("pipe_to_shell", re.compile(r"(curl|wget)\b[^|]*\|\s*(sudo\s+)?(ba)?sh", re.I)),
    ("iex_download", re.compile(r"(Invoke-WebRequest|iwr|wget).*\|\s*iex|iex\s*\(", re.I)),
    ("fork_bomb", re.compile(r":\(\)\s*\{\s*:\|:", re.I)),
    ("shutdown_reboot", re.compile(r"\b(shutdown|reboot|halt|poweroff)\b", re.I)),
    ("chmod_world_recursive", re.compile(r"\bchmod\s+(-\w*\s+)*777", re.I)),
    ("read_sensitive", re.compile(r"(\.ssh/|id_rsa|\.aws/credentials|\.env\b|cookies\.sqlite)", re.I)),
]

# 涉敏感路径的文件读取也触发审批
_SENSITIVE_PATH = re.compile(r"(\.ssh/|id_rsa|\.aws/credentials|\.env\b|cookies\.sqlite|/etc/shadow)", re.I)


def classify_command(command: str | None) -> str | None:
    if not command:
        return None
    for name, pattern in _COMMAND_RULES:
        if pattern.search(command):
            return name
    return None


def evaluate_risk(tool: str, payload: dict) -> str | None:
    """返回命中的高风险规则名;无风险返回 None。"""
    payload = payload or {}
    if tool == "remote_exec":
        return classify_command(payload.get("command"))
    if tool in ("remote_read_file", "remote_write_file", "remote_patch_file", "remote_list_files"):
        path = str(payload.get("path") or "")
        if _SENSITIVE_PATH.search(path):
            return "sensitive_path"
    return None
