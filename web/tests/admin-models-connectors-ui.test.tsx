import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import ConnectorsPage from "@/app/admin/connectors/page";
import ModelsPage from "@/app/admin/models/page";

const mocks = vi.hoisted(() => ({
  createConnector: vi.fn(),
  createModelBackend: vi.fn(),
  deleteConnector: vi.fn(),
  deleteModelBackend: vi.fn(),
  getMe: vi.fn(),
  listConnectorPresets: vi.fn(),
  listConnectorRegistry: vi.fn(),
  listConnectors: vi.fn(),
  listModelBackends: vi.fn(),
  listModelProviders: vi.fn(),
  listModelRoutes: vi.fn(),
  listUsers: vi.fn(),
  putConnectorScope: vi.fn(),
  putModelRoute: vi.fn(),
  updateConnector: vi.fn(),
  updateModelBackend: vi.fn()
}));

vi.mock("@/lib/api-client", () => ({
  createConnector: mocks.createConnector,
  createModelBackend: mocks.createModelBackend,
  deleteConnector: mocks.deleteConnector,
  deleteModelBackend: mocks.deleteModelBackend,
  getMe: mocks.getMe,
  listConnectorPresets: mocks.listConnectorPresets,
  listConnectorRegistry: mocks.listConnectorRegistry,
  listConnectors: mocks.listConnectors,
  listModelBackends: mocks.listModelBackends,
  listModelProviders: mocks.listModelProviders,
  listModelRoutes: mocks.listModelRoutes,
  listUsers: mocks.listUsers,
  putConnectorScope: mocks.putConnectorScope,
  putModelRoute: mocks.putModelRoute,
  updateConnector: mocks.updateConnector,
  updateModelBackend: mocks.updateModelBackend
}));

describe("admin model and connector pages", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  test("admin creates, edits, defaults, and routes model backends without rendering plaintext keys", async () => {
    mocks.getMe.mockResolvedValue({ id: "u_admin", username: "admin", display_name: "管理员", role: "admin" });
    mocks.listUsers.mockResolvedValue([
      { id: "u_admin", username: "admin", display_name: "管理员", role: "admin" },
      { id: "u_alice", username: "alice", display_name: "Alice", role: "user" }
    ]);
    mocks.listModelProviders.mockResolvedValue([
      {
        id: "deepseek",
        name: "DeepSeek",
        base_url: "https://api.deepseek.com/v1",
        models: ["deepseek-chat", "deepseek-reasoner"],
        needs_key: true,
        note: "官方 API"
      },
      {
        id: "ollama",
        name: "Ollama",
        base_url: "http://127.0.0.1:11434/v1",
        models: ["llama3.1"],
        needs_key: false,
        note: "本地模型"
      },
      { id: "custom", name: "自定义", base_url: "", models: [], needs_key: true, note: "" }
    ]);
    mocks.listModelRoutes.mockResolvedValue([{ user_id: "u_alice", backend_id: "model_1" }]);
    mocks.listModelBackends
      .mockResolvedValueOnce([
        {
          id: "model_1",
          name: "DeepSeek",
          base_url: "https://api.deepseek.com",
          model: "deepseek-chat",
          api_key: "sk-…cdef",
          max_concurrency: 4,
          enabled: true,
          is_default: true,
          created_at: "2026-06-11T00:00:00Z"
        }
      ])
      .mockResolvedValue([
        {
          id: "model_1",
          name: "DeepSeek",
          base_url: "https://api.deepseek.com",
          model: "deepseek-chat",
          api_key: "sk-…cdef",
          max_concurrency: 4,
          enabled: true,
          is_default: false,
          created_at: "2026-06-11T00:00:00Z"
        },
        {
          id: "model_2",
          name: "OpenAI",
          base_url: "https://api.openai.com/v1",
          model: "gpt-4.1",
          api_key: "sk-…7890",
          max_concurrency: 3,
          enabled: true,
          is_default: true,
          created_at: "2026-06-11T00:01:00Z"
        }
      ]);
    mocks.createModelBackend.mockResolvedValue({ id: "model_2" });
    mocks.updateModelBackend.mockResolvedValue({ id: "model_1" });
    mocks.putModelRoute.mockResolvedValue({ user_id: "u_alice", backend_id: null });

    render(<ModelsPage />);

    expect(await screen.findByText("模型管理")).toBeTruthy();
    expect(await screen.findByText("sk-…cdef")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "添加 Provider" }));
    fireEvent.change(screen.getByLabelText("Provider"), { target: { value: "deepseek" } });
    expect(screen.getByLabelText("Base URL")).toHaveProperty("value", "https://api.deepseek.com/v1");
    expect(screen.getByLabelText("模型")).toHaveProperty("value", "deepseek-chat");
    fireEvent.change(screen.getByLabelText("API Key"), { target: { value: "sk-live-secret" } });
    fireEvent.change(screen.getByLabelText("最大并发"), { target: { value: "3" } });
    fireEvent.click(screen.getByLabelText("设为默认"));
    fireEvent.click(screen.getByRole("button", { name: "创建 Provider" }));

    await waitFor(() => {
      expect(mocks.createModelBackend).toHaveBeenCalledWith({
        name: "DeepSeek",
        base_url: "https://api.deepseek.com/v1",
        model: "deepseek-chat",
        api_key: "sk-live-secret",
        max_concurrency: 3,
        is_default: true
      });
    });
    expect(screen.queryByText("sk-live-secret")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "编辑 DeepSeek" }));
    expect(screen.getByLabelText("API Key")).toHaveProperty("value", "");
    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "DeepSeek 生产" } });
    fireEvent.click(screen.getByRole("button", { name: "保存后端" }));

    await waitFor(() => {
      expect(mocks.updateModelBackend).toHaveBeenCalledWith(
        "model_1",
        expect.not.objectContaining({ api_key: expect.anything() })
      );
    });

    fireEvent.change(screen.getByLabelText("路由用户"), { target: { value: "u_alice" } });
    fireEvent.change(screen.getByLabelText("路由后端"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "保存路由" }));

    await waitFor(() => expect(mocks.putModelRoute).toHaveBeenCalledWith("u_alice", null));
  });

  test("admin creates connectors and scopes users without rendering env values", async () => {
    mocks.getMe.mockResolvedValue({ id: "u_admin", username: "admin", display_name: "管理员", role: "admin" });
    mocks.listUsers.mockResolvedValue([
      { id: "u_admin", username: "admin", display_name: "管理员", role: "admin" },
      { id: "u_alice", username: "alice", display_name: "Alice", role: "user" }
    ]);
    mocks.listConnectorPresets.mockResolvedValue([
      {
        id: "github",
        name: "GitHub",
        transport: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-github"],
        env_keys: ["GITHUB_PERSONAL_ACCESS_TOKEN"],
        note: "需 GitHub PAT"
      },
      {
        id: "filesystem",
        name: "Filesystem",
        transport: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/dir"],
        env_keys: [],
        note: "把占位路径替换为工作目录"
      },
      { id: "custom", name: "自定义", transport: "stdio", args: [], env_keys: [], note: "" }
    ]);
    mocks.listConnectors
      .mockResolvedValueOnce([
        {
          id: "conn_1",
          name: "GitHub MCP",
          transport: "stdio",
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-github"],
          env_keys: ["GITHUB_TOKEN"],
          enabled: true,
          require_approval: true,
          scope_all: false,
          scopes: ["u_alice"],
          status: "connected",
          tool_count: 8,
          created_at: "2026-06-11T00:00:00Z"
        },
        {
          id: "conn_error",
          name: "Broken MCP",
          transport: "stdio",
          command: "node",
          args: ["server.js"],
          env_keys: [],
          enabled: true,
          require_approval: false,
          scope_all: true,
          scopes: [],
          status: "error: spawn failed",
          tool_count: 0,
          created_at: "2026-06-11T00:00:30Z"
        },
        {
          id: "conn_disabled",
          name: "Disabled HTTP",
          transport: "http",
          url: "https://disabled.example.test",
          env_keys: [],
          enabled: false,
          require_approval: false,
          scope_all: true,
          scopes: [],
          status: "disabled",
          tool_count: 0,
          created_at: "2026-06-11T00:00:45Z"
        }
      ])
      .mockResolvedValue([
        {
          id: "conn_1",
          name: "GitHub MCP",
          transport: "stdio",
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-github"],
          env_keys: ["GITHUB_TOKEN"],
          enabled: true,
          require_approval: true,
          scope_all: false,
          scopes: ["u_alice"],
          status: "connected",
          tool_count: 8,
          created_at: "2026-06-11T00:00:00Z"
        },
        {
          id: "conn_2",
          name: "Slack MCP",
          transport: "http",
          url: "https://mcp.example.test",
          env_keys: ["SLACK_TOKEN"],
          enabled: true,
          require_approval: true,
          scope_all: true,
          scopes: [],
          status: "connected",
          tool_count: 3,
          created_at: "2026-06-11T00:01:00Z"
        }
      ]);
    mocks.createConnector.mockResolvedValue({ id: "conn_2" });
    mocks.putConnectorScope.mockResolvedValue({ user_ids: ["u_alice"] });

    render(<ConnectorsPage />);

    expect(await screen.findByText("连接器管理")).toBeTruthy();
    expect(screen.getByText("连接器会在服务端运行你提供的第三方程序，仅管理员可配置，请确认来源可信")).toBeTruthy();
    expect(screen.getByText("总数")).toBeTruthy();
    expect(screen.getByText("已连接")).toBeTruthy();
    expect(screen.getByText("异常")).toBeTruthy();
    expect(screen.getByText("已禁用")).toBeTruthy();
    expect(screen.getByText("GITHUB_TOKEN")).toBeTruthy();
    expect(screen.getByText("需审批")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("搜索连接器"), { target: { value: "broken" } });
    expect(screen.getByRole("cell", { name: "Broken MCP" })).toBeTruthy();
    expect(screen.queryByRole("cell", { name: "GitHub MCP" })).toBeNull();
    fireEvent.change(screen.getByLabelText("搜索连接器"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("状态过滤"), { target: { value: "disabled" } });
    expect(screen.getByRole("cell", { name: "Disabled HTTP" })).toBeTruthy();
    expect(screen.queryByRole("cell", { name: "GitHub MCP" })).toBeNull();
    fireEvent.change(screen.getByLabelText("状态过滤"), { target: { value: "all" } });

    fireEvent.click(screen.getByRole("button", { name: "添加连接器" }));
    fireEvent.change(screen.getByLabelText("连接器预设"), { target: { value: "github" } });
    expect(screen.getByLabelText("Command")).toHaveProperty("value", "npx");
    expect(screen.getByLabelText("Args")).toHaveProperty(
      "value",
      "-y\n@modelcontextprotocol/server-github"
    );
    fireEvent.change(screen.getByLabelText("GITHUB_PERSONAL_ACCESS_TOKEN"), {
      target: { value: "ghp_live_secret" }
    });
    fireEvent.click(screen.getByLabelText("全员可用"));
    fireEvent.click(screen.getByLabelText("每次调用需审批"));
    fireEvent.click(screen.getByRole("button", { name: "创建连接器" }));

    await waitFor(() => {
      expect(mocks.createConnector).toHaveBeenCalledWith({
        name: "GitHub",
        transport: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-github"],
        env: { GITHUB_PERSONAL_ACCESS_TOKEN: "ghp_live_secret" },
        scope_all: true,
        enabled: true,
        require_approval: true
      });
    });
    expect(screen.queryByText("ghp_live_secret")).toBeNull();

    fireEvent.change(screen.getByLabelText("作用域连接器"), { target: { value: "conn_1" } });
    fireEvent.change(screen.getByLabelText("授权用户"), { target: { value: "u_alice" } });
    fireEvent.click(screen.getByRole("button", { name: "保存作用域" }));

    await waitFor(() => expect(mocks.putConnectorScope).toHaveBeenCalledWith("conn_1", ["u_alice"]));
  });

  test("imports an installable connector from the registry with approval enabled by default", async () => {
    mocks.getMe.mockResolvedValue({ id: "u_admin", username: "admin", display_name: "管理员", role: "admin" });
    mocks.listUsers.mockResolvedValue([{ id: "u_admin", username: "admin", display_name: "管理员", role: "admin" }]);
    mocks.listConnectorPresets.mockResolvedValue([
      { id: "custom", name: "自定义", transport: "stdio", args: [], env_keys: [], note: "" }
    ]);
    mocks.listConnectors
      .mockResolvedValueOnce([
        {
          id: "conn_1",
          name: "GitHub MCP",
          transport: "stdio",
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-github"],
          env_keys: ["GITHUB_TOKEN"],
          enabled: true,
          require_approval: true,
          scope_all: false,
          scopes: [],
          status: "connected",
          tool_count: 8,
          created_at: "2026-06-11T00:00:00Z"
        }
      ])
      .mockResolvedValue([
        {
          id: "conn_fetch",
          name: "fetch",
          transport: "stdio",
          command: "uvx",
          args: ["mcp-server-fetch==1.0.0"],
          env_keys: ["FETCH_TOKEN"],
          enabled: true,
          require_approval: true,
          scope_all: false,
          scopes: [],
          status: "connected",
          tool_count: 3,
          created_at: "2026-06-11T00:01:00Z"
        }
      ]);
    mocks.listConnectorRegistry.mockResolvedValue([
      {
        name: "io.modelcontextprotocol/fetch",
        title: "Fetch MCP",
        description: "Fetches web content with a pinned package.",
        version: "1.0.0",
        installable: true,
        install: {
          transport: "stdio",
          command: "uvx",
          args: ["mcp-server-fetch==1.0.0"],
          env_keys: ["FETCH_TOKEN"]
        }
      },
      {
        name: "io.modelcontextprotocol/legacy",
        title: "Legacy MCP",
        description: "Missing install metadata.",
        version: "0.3.0",
        installable: false,
        install: null
      }
    ]);
    mocks.createConnector.mockResolvedValue({ id: "conn_fetch" });

    render(<ConnectorsPage />);

    expect(await screen.findByText("连接器市场")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("搜索市场"), { target: { value: "fetch" } });
    fireEvent.click(screen.getByRole("button", { name: "搜索市场" }));

    await waitFor(() => expect(mocks.listConnectorRegistry).toHaveBeenCalledWith("fetch", 20));
    expect(await screen.findByText("Fetch MCP")).toBeTruthy();
    expect(screen.getByText("Legacy MCP")).toBeTruthy();
    expect(screen.getByRole("button", { name: "暂不支持一键导入 Legacy MCP" })).toHaveProperty("disabled", true);

    fireEvent.click(screen.getByRole("button", { name: "导入 Fetch MCP" }));

    expect(screen.getByLabelText("连接器名称")).toHaveProperty("value", "fetch");
    expect(screen.getByLabelText("Command")).toHaveProperty("value", "uvx");
    expect(screen.getByLabelText("Args")).toHaveProperty("value", "mcp-server-fetch==1.0.0");
    expect(screen.getByLabelText("每次调用需审批")).toHaveProperty("checked", true);
    fireEvent.change(screen.getByLabelText("FETCH_TOKEN"), { target: { value: "fetch_live_secret" } });
    fireEvent.click(screen.getByRole("button", { name: "创建连接器" }));

    await waitFor(() => {
      expect(mocks.createConnector).toHaveBeenCalledWith({
        name: "fetch",
        transport: "stdio",
        command: "uvx",
        args: ["mcp-server-fetch==1.0.0"],
        env: { FETCH_TOKEN: "fetch_live_secret" },
        scope_all: false,
        enabled: true,
        require_approval: true
      });
    });
    expect(screen.queryByText("fetch_live_secret")).toBeNull();
  });

  test("shows a friendly connector registry outage without hiding local connectors", async () => {
    mocks.getMe.mockResolvedValue({ id: "u_admin", username: "admin", display_name: "管理员", role: "admin" });
    mocks.listUsers.mockResolvedValue([{ id: "u_admin", username: "admin", display_name: "管理员", role: "admin" }]);
    mocks.listConnectorPresets.mockResolvedValue([
      { id: "custom", name: "自定义", transport: "stdio", args: [], env_keys: [], note: "" }
    ]);
    mocks.listConnectors.mockResolvedValue([
      {
        id: "conn_1",
        name: "GitHub MCP",
        transport: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-github"],
        env_keys: ["GITHUB_TOKEN"],
        enabled: true,
        require_approval: true,
        scope_all: false,
        scopes: [],
        status: "connected",
        tool_count: 8,
        created_at: "2026-06-11T00:00:00Z"
      }
    ]);
    const registryError = new Error("bad gateway") as Error & { status?: number; code?: string };
    registryError.status = 502;
    registryError.code = "registry_unavailable";
    mocks.listConnectorRegistry.mockRejectedValue(registryError);

    render(<ConnectorsPage />);

    await waitFor(() => expect(screen.getAllByText("GitHub MCP").length).toBeGreaterThan(0));
    fireEvent.change(screen.getByLabelText("搜索市场"), { target: { value: "fetch" } });
    fireEvent.click(screen.getByRole("button", { name: "搜索市场" }));

    expect(await screen.findByText("连接器市场暂时不可用，请稍后重试；本地连接器列表不受影响")).toBeTruthy();
    expect(screen.getAllByText("GitHub MCP").length).toBeGreaterThan(0);
  });

  test("non-admin users cannot access the model admin page", async () => {
    mocks.getMe.mockResolvedValue({ id: "u_user", username: "alice", display_name: "Alice", role: "user" });

    render(<ModelsPage />);

    expect(await screen.findByText("无权限")).toBeTruthy();
    expect(mocks.listModelBackends).not.toHaveBeenCalled();
  });
});
