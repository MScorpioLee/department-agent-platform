"""外部 MCP 连接器管理(M10)。

把管理员配置的 MCP server(stdio 子进程 / 远程 http)的工具纳入 Agent 可用集。
安全:
- 子进程 **env 隔离**——只注入连接器自身配置的环境变量(+ PATH/HOME),绝不传平台密钥。
- 按操作开/关会话(列工具、调用各自一次),避免持久 stdio 会话的跨任务并发问题。
- 工具名加 `mcp__<连接器名>__<工具名>` 命名空间,与机器工具区分,Agent Loop 据此路由。
- 完整 OS 级沙箱(独立低权限账号/容器)属部署层,见 docs/management.md;本模块做应用层隔离。
"""

import json
import logging
import os
from contextlib import asynccontextmanager
from dataclasses import dataclass, field

from sqlalchemy import select

from .models import Connector, ConnectorScope
from .secret import decrypt

log = logging.getLogger("agent_runner.connectors")


@dataclass
class _Config:
    transport: str
    command: str | None
    args: list
    url: str | None
    env: dict
    scope_all: bool
    scopes: set = field(default_factory=set)


@dataclass
class _ToolInfo:
    namespaced: str
    connector_id: str
    real_name: str
    spec: dict  # OpenAI function spec


def _build_env(cfg_env: dict) -> dict:
    # 仅给子进程最小环境 + 连接器自身配置的 env,不泄漏平台密钥
    base = {"PATH": os.environ.get("PATH", ""), "HOME": os.environ.get("HOME", "")}
    base.update({str(k): str(v) for k, v in (cfg_env or {}).items()})
    return base


@asynccontextmanager
async def _open_session(cfg: _Config):
    from mcp import ClientSession, StdioServerParameters

    if cfg.transport == "http" and cfg.url:
        from mcp.client.streamable_http import streamablehttp_client

        async with streamablehttp_client(cfg.url) as (read, write, _):
            async with ClientSession(read, write) as session:
                await session.initialize()
                yield session
    else:
        from mcp.client.stdio import stdio_client

        params = StdioServerParameters(command=cfg.command or "", args=cfg.args or [], env=_build_env(cfg.env))
        async with stdio_client(params) as (read, write):
            async with ClientSession(read, write) as session:
                await session.initialize()
                yield session


def _extract(result) -> dict:
    parts = []
    for block in getattr(result, "content", []) or []:
        text = getattr(block, "text", None)
        if text is not None:
            parts.append(text)
    out = {"content": "\n".join(parts)}
    if getattr(result, "isError", False):
        out["error_code"] = "mcp_tool_error"
    return out


class ConnectorManager:
    def __init__(self) -> None:
        self.configs: dict[str, _Config] = {}  # connector_id -> 配置快照
        self.tools: dict[str, _ToolInfo] = {}  # namespaced -> ToolInfo
        self.status: dict[str, str] = {}  # connector_id -> connected | error:...

    def has_tool(self, name: str) -> bool:
        return name in self.tools

    def tools_for(self, user_id: str | None, is_admin: bool) -> list[dict]:
        """返回该用户有权使用的连接器工具的 OpenAI spec。"""
        out = []
        for info in self.tools.values():
            cfg = self.configs.get(info.connector_id)
            if cfg is None:
                continue
            if is_admin or cfg.scope_all or (user_id and user_id in cfg.scopes):
                out.append(info.spec)
        return out

    def can_use(self, name: str, user_id: str | None, is_admin: bool) -> bool:
        info = self.tools.get(name)
        if info is None:
            return False
        cfg = self.configs.get(info.connector_id)
        return bool(cfg and (is_admin or cfg.scope_all or (user_id and user_id in cfg.scopes)))

    async def reload(self, sessionmaker, secret_key: str) -> None:
        """从 DB 重建:连每个启用的连接器列出工具(只取元数据,不保持会话)。"""
        async with sessionmaker() as session:
            rows = (await session.execute(select(Connector).where(Connector.enabled.is_(True)))).scalars().all()
            scope_rows = (await session.execute(select(ConnectorScope))).scalars().all()
        scopes: dict[str, set] = {}
        for sr in scope_rows:
            scopes.setdefault(sr.connector_id, set()).add(sr.user_id)

        configs: dict[str, _Config] = {}
        tools: dict[str, _ToolInfo] = {}
        status: dict[str, str] = {}
        for row in rows:
            env = json.loads(decrypt(row.env_enc, secret_key) or "{}") if row.env_enc else {}
            cfg = _Config(row.transport, row.command, row.args or [], row.url, env, row.scope_all, scopes.get(row.id, set()))
            configs[row.id] = cfg
            try:
                async with _open_session(cfg) as mcp:
                    listed = await mcp.list_tools()
                for t in listed.tools:
                    ns = f"mcp__{row.name}__{t.name}"
                    tools[ns] = _ToolInfo(
                        ns, row.id, t.name,
                        {"type": "function", "function": {
                            "name": ns, "description": t.description or "",
                            "parameters": t.inputSchema or {"type": "object", "properties": {}},
                        }},
                    )
                status[row.id] = "connected"
            except Exception as exc:  # 单个连接器失败不影响其它
                log.warning("连接器 %s 连接失败: %r", row.name, exc)
                status[row.id] = f"error: {exc}"
        self.configs, self.tools, self.status = configs, tools, status

    async def call(self, name: str, arguments: dict) -> dict:
        info = self.tools.get(name)
        if info is None:
            return {"error_code": "connector_tool_unknown", "error_message": f"未知连接器工具: {name}"}
        cfg = self.configs.get(info.connector_id)
        if cfg is None:
            return {"error_code": "connector_unavailable", "error_message": "连接器不可用"}
        try:
            async with _open_session(cfg) as mcp:
                result = await mcp.call_tool(info.real_name, arguments or {})
            return _extract(result)
        except Exception as exc:
            return {"error_code": "connector_call_failed", "error_message": repr(exc)}
