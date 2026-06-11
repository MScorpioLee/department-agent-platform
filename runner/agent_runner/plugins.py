"""Runner 插件系统:工具按插件分组,schema 由 Runner 声明并上报给服务器。

安全不变量(docs/security.md):插件只来自 **Runner 本地配置**,服务器不能远程启用。
内置插件 exec/file 默认启用;可选插件(如 sysinfo)需在 config.yaml 的 plugins 里显式列出。
"""

import os
import platform
import socket
from dataclasses import dataclass
from typing import Callable

from . import tools


@dataclass
class Tool:
    name: str
    description: str
    parameters: dict  # OpenAI function 的 JSON schema
    kind: str  # "exec"(流式,handler 为协程 (policy,payload,emit,cancel)->(status,result))| "sync"(handler(policy,payload)->result)
    handler: Callable

    def schema(self) -> dict:
        return {"name": self.name, "description": self.description, "parameters": self.parameters}


# ---------- 示例可选插件:sysinfo ----------

def _sysinfo(policy, payload) -> dict:
    return {
        "os": platform.system(),
        "release": platform.release(),
        "machine": platform.machine(),
        "python": platform.python_version(),
        "hostname": socket.gethostname(),
        "cpu_count": os.cpu_count(),
    }


# ---------- 插件注册表(插件名 → 工具列表)----------

PLUGINS: dict[str, list[Tool]] = {
    "exec": [
        Tool(
            "remote_exec",
            "在目标机器的工作目录内执行一条 shell 命令,返回 exit_code 与 stdout/stderr。",
            {
                "type": "object",
                "properties": {
                    "workdir": {"type": "string", "description": "工作目录,必须在 allowed_roots 内"},
                    "command": {"type": "string", "description": "要执行的命令"},
                    "timeout_seconds": {"type": "number", "description": "超时秒数,默认 60,上限 600"},
                },
                "required": ["workdir", "command"],
            },
            "exec",
            tools.remote_exec,
        ),
    ],
    "file": [
        Tool(
            "remote_read_file",
            "读取目标机器上某个文本文件的内容(按行 offset/limit 分页)。",
            {
                "type": "object",
                "properties": {
                    "path": {"type": "string"},
                    "offset": {"type": "integer", "description": "起始行,从 1 开始"},
                    "limit": {"type": "integer", "description": "读取行数,默认 500"},
                },
                "required": ["path"],
            },
            "sync",
            tools.remote_read_file,
        ),
        Tool(
            "remote_write_file",
            "把内容写入目标机器上的文件(覆盖)。返回写入字节数与前后哈希。",
            {
                "type": "object",
                "properties": {"path": {"type": "string"}, "content": {"type": "string"}},
                "required": ["path", "content"],
            },
            "sync",
            tools.remote_write_file,
        ),
        Tool(
            "remote_patch_file",
            "在目标文件中把 old_string 替换为 new_string。old_string 必须唯一,除非 replace_all=true。",
            {
                "type": "object",
                "properties": {
                    "path": {"type": "string"},
                    "old_string": {"type": "string"},
                    "new_string": {"type": "string"},
                    "replace_all": {"type": "boolean"},
                },
                "required": ["path", "old_string", "new_string"],
            },
            "sync",
            tools.remote_patch_file,
        ),
        Tool(
            "remote_list_files",
            "列出目标机器某目录下的条目(名称、类型、大小)。",
            {
                "type": "object",
                "properties": {"path": {"type": "string"}, "max_entries": {"type": "integer"}},
                "required": ["path"],
            },
            "sync",
            tools.remote_list_files,
        ),
    ],
    "sysinfo": [
        Tool(
            "remote_sysinfo",
            "返回目标机器的系统信息(OS、CPU 数、主机名、Python 版本等)。",
            {"type": "object", "properties": {}},
            "sync",
            _sysinfo,
        ),
    ],
}

DEFAULT_PLUGINS = ["exec", "file"]


def build_registry(enabled: list[str] | None) -> dict[str, Tool]:
    """按启用的插件名构建 工具名 → Tool 的注册表。未知插件名忽略。"""
    names = enabled if enabled else DEFAULT_PLUGINS
    registry: dict[str, Tool] = {}
    for plugin in names:
        for tool in PLUGINS.get(plugin, []):
            registry[tool.name] = tool
    return registry
