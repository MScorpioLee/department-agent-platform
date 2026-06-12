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
    assert body["tool_count"] == 2  # echo + slow
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


# ---------- M10 加固:超时 / 输出上限 / 每连接器审批 ----------


async def _manager_with_echo(tmp_path, **mgr_kwargs):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path}/h.db")
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.create_all)
    sm = async_sessionmaker(engine, expire_on_commit=False)
    async with sm() as s:
        s.add(Connector(id=new_id("conn"), name="echotest", transport="stdio",
                        command=sys.executable, args=[SERVER], scope_all=True))
        await s.commit()
    mgr = ConnectorManager(**mgr_kwargs)
    await mgr.reload(sm, "secret-key")
    return mgr, engine


async def test_connector_call_timeout(tmp_path):
    mgr, engine = await _manager_with_echo(tmp_path, call_timeout=1.0)
    result = await mgr.call("mcp__echotest__slow", {"seconds": 10})
    assert result["error_code"] == "connector_timeout"
    await engine.dispose()


async def test_connector_output_truncated(tmp_path):
    mgr, engine = await _manager_with_echo(tmp_path, output_cap=10)
    result = await mgr.call("mcp__echotest__echo", {"text": "x" * 100})
    assert result.get("truncated") is True
    assert len(result["content"].encode()) <= 10
    await engine.dispose()


# ---------- 注册表搜索/一键导入翻译 ----------


def test_registry_entry_to_connector():
    from app.connector_registry import entry_to_connector

    npm = {"packages": [{"registryType": "npm", "identifier": "@scope/mcp-x", "version": "1.2.3",
                         "transport": {"type": "stdio"},
                         "environmentVariables": [{"name": "X_TOKEN", "isRequired": True}]}]}
    c = entry_to_connector(npm)
    assert c["command"] == "npx" and c["args"][:2] == ["-y", "@scope/mcp-x@1.2.3"]  # 版本钉死
    assert c["env_keys"] == ["X_TOKEN"]

    pypi = {"packages": [{"registryType": "pypi", "identifier": "mcp-y", "version": "0.5.0",
                          "packageArguments": [{"type": "positional", "value": "serve"},
                                               {"type": "named", "name": "--port", "value": "80"}]}]}
    c = entry_to_connector(pypi)
    assert c["command"] == "uvx" and c["args"] == ["mcp-y==0.5.0", "serve", "--port", "80"]

    remote = {"remotes": [{"type": "streamable-http", "url": "https://x.example/mcp"}]}
    c = entry_to_connector(remote)
    assert c["transport"] == "http" and c["url"] == "https://x.example/mcp"

    assert entry_to_connector({"packages": [{"registryType": "oci", "identifier": "img"}]}) is None


def test_registry_search_endpoint(client, monkeypatch):
    from app import connector_registry

    async def fake_fetch(query, limit, base_url=None):
        return {"servers": [{"server": {
            "name": "io.github.x/fetch", "title": "Fetch", "description": "抓网页", "version": "1.0.0",
            "packages": [{"registryType": "pypi", "identifier": "mcp-server-fetch", "version": "1.0.0"}],
        }}]}

    monkeypatch.setattr(connector_registry, "fetch_registry", fake_fetch)
    rows = client.get("/api/admin/connector-registry?q=fetch", headers=admin_h(client)).json()
    assert rows[0]["installable"] is True
    assert rows[0]["install"]["args"] == ["mcp-server-fetch==1.0.0"]

    # 非管理员 403
    client.post("/api/users", headers=admin_h(client), json={"username": "u2", "password": "pass1234"})
    utok = client.post("/api/auth/login", json={"username": "u2", "password": "pass1234"}).json()["token"]
    assert client.get("/api/admin/connector-registry?q=x",
                      headers={"Authorization": f"Bearer {utok}"}).status_code == 403


def test_require_approval_flow(client):
    """标记 require_approval 的连接器:模型调用→生成审批;批准→服务端执行并返回结果。"""
    from types import SimpleNamespace
    import json as _json

    h = admin_h(client)
    r = client.post(
        "/api/admin/connectors", headers=h,
        json={"name": "echotest", "transport": "stdio", "command": sys.executable,
              "args": [SERVER], "scope_all": True, "require_approval": True},
    )
    assert r.status_code == 200 and r.json()["require_approval"] is True

    mid = client.post("/api/runners/enroll", headers={"Authorization": "Bearer test-enroll"},
                      json={"machine_name": "m1", "os": "darwin"}).json()["machine_id"]
    sess_id = client.post("/api/sessions", headers={"X-API-Key": "test-key"},
                          json={"machine_id": mid}).json()["session_id"]

    class FakeGateway:
        calls = 0

        def resolve(self, user_id=None):
            return SimpleNamespace(id="fake", model="fake")

        async def chat(self, backend, messages, tools=None, **kw):
            FakeGateway.calls += 1
            if FakeGateway.calls == 1:
                return {"choices": [{"message": {"role": "assistant", "content": "", "tool_calls": [
                    {"id": "c1", "type": "function", "function": {
                        "name": "mcp__echotest__echo", "arguments": _json.dumps({"text": "hi"})}}
                ]}}], "usage": {}}
            return {"choices": [{"message": {"role": "assistant", "content": "已提交审批"}}], "usage": {}}

    client.app.state.gateway = FakeGateway()
    r = client.post(f"/api/sessions/{sess_id}/messages", headers={"X-API-Key": "test-key"},
                    json={"content": "调一下 echo"})
    assert r.status_code == 200, r.text

    # 产生了 pending 审批,规则为 connector_requires_approval
    approvals = client.get("/api/approvals", headers={"X-API-Key": "test-key"}).json()
    ap = next(a for a in approvals if a["tool"] == "mcp__echotest__echo")
    assert ap["risk_rule"] == "connector_requires_approval"

    # 批准 → 服务端直接执行连接器(无需机器在线),返回执行结果
    r2 = client.post(f"/api/approvals/{ap['approval_id']}/approve", headers={"X-API-Key": "test-key"})
    assert r2.status_code == 200, r2.text
    body = r2.json()
    assert body["tool_status"] == "completed"
    assert "echo: hi" in body["result"]["content"]
