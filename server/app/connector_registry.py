"""MCP 官方注册表(registry.modelcontextprotocol.io)搜索 → 一键导入配置翻译。

安全口径:注册表是**社区目录**,导入仍是"在服务端跑第三方代码"的显式信任动作(仅管理员)。
翻译时**钉死版本**(npm `pkg@1.2.3` / pypi `pkg==1.2.3`),防 latest 被投毒;凭据只进连接器自身 env。
只翻译 stdio(npm/pypi)与 streamable-http remote;oci/docker 等跳过(服务端容器内无 docker)。
"""

import httpx

REGISTRY_BASE = "https://registry.modelcontextprotocol.io"


def _flatten_args(pkg: dict) -> list[str]:
    out: list[str] = []
    for a in (pkg.get("runtimeArguments") or []) + (pkg.get("packageArguments") or []):
        name, value = a.get("name"), a.get("value")
        if a.get("type") == "named" and name:
            out.append(str(name))
            if value not in (None, ""):
                out.append(str(value))
        elif value not in (None, ""):
            out.append(str(value))
    return out


def entry_to_connector(server: dict) -> dict | None:
    """注册表 server 条目 → 可直接 POST /api/admin/connectors 的配置;不可安装返回 None。"""
    for pkg in server.get("packages") or []:
        if (pkg.get("transport") or {}).get("type") not in (None, "stdio"):
            continue
        rt, ident, ver = pkg.get("registryType"), pkg.get("identifier") or "", pkg.get("version")
        if rt == "npm":
            spec = f"{ident}@{ver}" if ver else ident
            launch = {"transport": "stdio", "command": "npx", "args": ["-y", spec, *_flatten_args(pkg)]}
        elif rt == "pypi":
            spec = f"{ident}=={ver}" if ver else ident
            launch = {"transport": "stdio", "command": "uvx", "args": [spec, *_flatten_args(pkg)]}
        else:
            continue
        launch["env_keys"] = [e["name"] for e in pkg.get("environmentVariables") or [] if e.get("name")]
        return launch
    for r in server.get("remotes") or []:
        if r.get("type") == "streamable-http" and r.get("url"):
            return {"transport": "http", "url": r["url"], "env_keys": []}
    return None


async def fetch_registry(query: str, limit: int, base_url: str = REGISTRY_BASE) -> dict:
    """调注册表搜索 API(独立函数,便于测试替换)。"""
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(
            f"{base_url}/v0/servers",
            params={"search": query, "limit": limit, "version": "latest"},
        )
        resp.raise_for_status()
        return resp.json()


async def search_registry(query: str, limit: int = 20, base_url: str = REGISTRY_BASE) -> list[dict]:
    """搜索注册表,返回带现成连接器配置的条目(installable=False 的仅供展示)。"""
    data = await fetch_registry(query, limit, base_url)
    out = []
    for item in data.get("servers") or []:
        server = item.get("server") or {}
        install = entry_to_connector(server)
        out.append({
            "name": server.get("name") or "",
            "title": server.get("title") or "",
            "description": server.get("description") or "",
            "version": server.get("version") or "",
            "installable": install is not None,
            "install": install,  # {transport,command?,args?,url?,env_keys}
        })
    return out
