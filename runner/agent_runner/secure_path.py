"""路径安全校验:先 realpath 规范化,再比对 allowed_roots / blocked_paths。

这是 Runner 的安全不变量之一(docs/security.md §2):
- 符号链接、`..`、Windows 8.3 短名都在 realpath 阶段解析掉,绝不直接比对原始字符串
- allowed_roots / blocked_paths 只来自本地配置,不接受服务器远程修改
"""

import os
import sys
from pathlib import Path

# Windows 与 macOS 默认文件系统大小写不敏感
_CASE_INSENSITIVE = sys.platform in ("win32", "darwin")


class PathDenied(Exception):
    pass


def _fold(p: str) -> str:
    return p.lower() if _CASE_INSENSITIVE else p


def _canon(p: str) -> str:
    return _fold(os.path.realpath(os.path.abspath(os.path.expanduser(p))))


def _is_within(child: str, parent: str) -> bool:
    parent = parent.rstrip(os.sep)
    return child == parent or child.startswith(parent + os.sep)


class PathPolicy:
    def __init__(self, allowed_roots: list[str], blocked_paths: list[str] | None = None) -> None:
        if not allowed_roots:
            raise ValueError("allowed_roots 不能为空")
        self.allowed = [_canon(p) for p in allowed_roots]
        self.blocked = [_canon(p) for p in blocked_paths or []]

    def resolve(self, path: str, for_write: bool = False) -> Path:
        """校验并返回规范化后的真实路径;违规抛 PathDenied。

        realpath 会解析路径中已存在前缀里的符号链接;尚不存在的尾部组件不可能是符号链接,
        因此对写入新文件的场景同样安全。
        """
        raw = os.path.abspath(os.path.expanduser(str(path)))
        target = os.path.realpath(raw)
        if not for_write and not os.path.exists(target):
            raise PathDenied(f"路径不存在: {path}")
        check = _fold(target)
        if not any(_is_within(check, root) for root in self.allowed):
            raise PathDenied(f"路径不在 allowed_roots 内: {path}")
        if any(_is_within(check, b) for b in self.blocked):
            raise PathDenied(f"路径命中 blocked_paths: {path}")
        return Path(target)
