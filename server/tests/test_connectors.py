"""M10 连接器:真实 MCP server 连接 + 工具路由 + 作用域 + admin API。"""

import sys
from pathlib import Path

from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.connectors import ConnectorManager, _Config, _ToolInfo
from app.db import Base
from app.models import Connector, new_id

SERVER = str(Path(__file__).parent / "_mcp_echo_server.py")


def admin_h(client):
    tok = client.post("/api/auth/login", json={"username": "admin", "password": "adminpass"}).json()["token"]
    return {"Authorization": f"Bearer {tok}"}


# ---------- 真实 MCP 连接 ----------


async def test_connector_lists_and_calls_real_mcp(tmp_path):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path}/c.db")
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.create_all)
    sm = async_sessionmaker(engine, expire_on_commit=False)
    async with sm() as s:
        s.add(Connector(id=new_id("conn"), name="echotest", transport="stdio",
                        command=sys.executable, args=[SERVER], scope_all=True))
        await s.commit()

    mgr = ConnectorManager()
    await mgr.reload(sm, "secret-key")
    assert "mcp__echotest__echo" in mgr.tools, mgr.status
    spec = mgr.tools["mcp__echotest__echo"].spec
    assert spec["function"]["name"] == "mcp__echotest__echo"

    result = await mgr.call("mcp__echotest__echo", {"text": "hi"})
    assert "echo: hi" in result["content"]
    await engine.dispose()


# ---------- 作用域逻辑(无需真实 MCP)----------


def test_scope_and_authorization():
    mgr = ConnectorManager()
    mgr.configs["c1"] = _Config("stdio", "x", [], None, {}, scope_all=False, scopes={"alice"})
    mgr.tools["mcp__c1__t"] = _ToolInfo(
        "mcp__c1__t", "c1", "t", {"type": "function", "function": {"name": "mcp__c1__t"}}
    )
    assert mgr.has_tool("mcp__c1__t")
    assert mgr.can_use("mcp__c1__t", "alice", False)
    assert not mgr.can_use("mcp__c1__t", "bob", False)
    assert mgr.can_use("mcp__c1__t", "bob", True)  # admin 放行
    assert [s["function"]["name"] for s in mgr.tools_for("alice", False)] == ["mcp__c1__t"]
    assert mgr.tools_for("bob", False) == []  # bob 无权 → 模型看不到该工具


# ---------- admin API + 热加载(真实 MCP)----------


def test_connector_admin_create_connects(client):
    h = admin_h(client)
    r = client.post(
        "/api/admin/connectors",
        headers=h,
        json={"name": "echotest", "transport": "stdio", "command": sys.executable,
              "args": [SERVER], "env": {"FOO": "bar"}, "scope_all": True},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "connected", body
    assert body["tool_count"] == 1
    # env 不回显值,只回 key 名
    assert body["env_keys"] == ["FOO"]
    assert "bar" not in str(body)
    # 管理器里工具就绪
    assert client.app.state.connectors.has_tool("mcp__echotest__echo")


def test_connector_admin_requires_admin(client):
    client.post("/api/users", headers=admin_h(client), json={"username": "u1", "password": "pass1234"})
    utok = client.post("/api/auth/login", json={"username": "u1", "password": "pass1234"}).json()["token"]
    assert client.get("/api/admin/connectors", headers={"Authorization": f"Bearer {utok}"}).status_code == 403


def test_connector_presets_catalog(client):
    rows = client.get("/api/admin/connector-presets", headers=admin_h(client)).json()
    ids = {r["id"] for r in rows}
    assert {"github", "filesystem", "custom"} <= ids
    gh = next(r for r in rows if r["id"] == "github")
    assert gh["transport"] == "stdio" and "GITHUB_PERSONAL_ACCESS_TOKEN" in gh["env_keys"]
