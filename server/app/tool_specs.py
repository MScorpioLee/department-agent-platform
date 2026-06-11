"""把 5 个 remote tool 暴露成 OpenAI function-calling schema。

工具的真实执行在 Runner;这里只声明给模型看的接口。参数与 docs/protocol.md §4 对齐。
"""

TOOL_SPECS = [
    {
        "type": "function",
        "function": {
            "name": "remote_exec",
            "description": "在目标机器的工作目录内执行一条 shell 命令,返回 exit_code 与 stdout/stderr。",
            "parameters": {
                "type": "object",
                "properties": {
                    "workdir": {"type": "string", "description": "工作目录,必须在机器 allowed_roots 内"},
                    "command": {"type": "string", "description": "要执行的命令"},
                    "timeout_seconds": {"type": "number", "description": "超时秒数,默认 60,上限 600"},
                },
                "required": ["workdir", "command"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "remote_read_file",
            "description": "读取目标机器上某个文本文件的内容(按行 offset/limit 分页)。",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string"},
                    "offset": {"type": "integer", "description": "起始行,从 1 开始"},
                    "limit": {"type": "integer", "description": "读取行数,默认 500"},
                },
                "required": ["path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "remote_write_file",
            "description": "把内容写入目标机器上的文件(覆盖)。返回写入字节数与前后哈希。",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string"},
                    "content": {"type": "string"},
                },
                "required": ["path", "content"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "remote_patch_file",
            "description": "在目标文件中把 old_string 替换为 new_string。old_string 必须唯一,除非 replace_all=true。",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string"},
                    "old_string": {"type": "string"},
                    "new_string": {"type": "string"},
                    "replace_all": {"type": "boolean"},
                },
                "required": ["path", "old_string", "new_string"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "remote_list_files",
            "description": "列出目标机器某目录下的条目(名称、类型、大小)。",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string"},
                    "max_entries": {"type": "integer"},
                },
                "required": ["path"],
            },
        },
    },
]

TOOL_NAMES = {spec["function"]["name"] for spec in TOOL_SPECS}


def specs_for(capabilities: list[str] | None) -> list[dict]:
    """按目标机器上报的 capabilities 裁剪内置工具列表(旧 Runner 回退用)。"""
    if not capabilities:
        return list(TOOL_SPECS)
    allowed = set(capabilities)
    return [s for s in TOOL_SPECS if s["function"]["name"] in allowed]


def build_specs(reported_tools: list[dict] | None, capabilities: list[str] | None) -> list[dict]:
    """优先用 Runner 上报的工具 schema(M9 插件化);旧 Runner 未上报则回退到内置裁剪。"""
    if reported_tools:
        return [
            {
                "type": "function",
                "function": {
                    "name": t.get("name"),
                    "description": t.get("description", ""),
                    "parameters": t.get("parameters") or {"type": "object", "properties": {}},
                },
            }
            for t in reported_tools
            if t.get("name")
        ]
    return specs_for(capabilities)
