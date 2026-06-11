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
  listConnectors: vi.fn(),
  listModelBackends: vi.fn(),
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
  listConnectors: mocks.listConnectors,
  listModelBackends: mocks.listModelBackends,
  listModelRoutes: mocks.listModelRoutes,
  listUsers: mocks.listUsers,
  putConnectorScope: mocks.putConnectorScope,
  putModelRoute: mocks.putModelRoute,
  updateConnector: mocks.updateConnector,
  updateModelBackend: mocks.updateModelBackend
}));

describe("admin model and connector pages", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  test("admin creates, edits, defaults, and routes model backends without rendering plaintext keys", async () => {
    mocks.getMe.mockResolvedValue({ id: "u_admin", username: "admin", display_name: "管理员", role: "admin" });
    mocks.listUsers.mockResolvedValue([
      { id: "u_admin", username: "admin", display_name: "管理员", role: "admin" },
      { id: "u_alice", username: "alice", display_name: "Alice", role: "user" }
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

    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "OpenAI" } });
    fireEvent.change(screen.getByLabelText("Base URL"), { target: { value: "https://api.openai.com/v1" } });
    fireEvent.change(screen.getByLabelText("模型"), { target: { value: "gpt-4.1" } });
    fireEvent.change(screen.getByLabelText("API Key"), { target: { value: "sk-live-secret" } });
    fireEvent.change(screen.getByLabelText("最大并发"), { target: { value: "3" } });
    fireEvent.click(screen.getByLabelText("设为默认"));
    fireEvent.click(screen.getByRole("button", { name: "创建后端" }));

    await waitFor(() => {
      expect(mocks.createModelBackend).toHaveBeenCalledWith({
        name: "OpenAI",
        base_url: "https://api.openai.com/v1",
        model: "gpt-4.1",
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
          scope_all: false,
          scopes: ["u_alice"],
          status: "connected",
          tool_count: 8,
          created_at: "2026-06-11T00:00:00Z"
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
    expect(screen.getByText("GITHUB_TOKEN")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("连接器名称"), { target: { value: "Slack MCP" } });
    fireEvent.change(screen.getByLabelText("传输"), { target: { value: "http" } });
    fireEvent.change(screen.getByLabelText("URL"), { target: { value: "https://mcp.example.test" } });
    fireEvent.change(screen.getByLabelText("Env"), { target: { value: "SLACK_TOKEN=xoxb-live-secret" } });
    fireEvent.click(screen.getByLabelText("全员可用"));
    fireEvent.click(screen.getByRole("button", { name: "新建连接器" }));

    await waitFor(() => {
      expect(mocks.createConnector).toHaveBeenCalledWith({
        name: "Slack MCP",
        transport: "http",
        url: "https://mcp.example.test",
        env: { SLACK_TOKEN: "xoxb-live-secret" },
        scope_all: true,
        enabled: true
      });
    });
    expect(screen.queryByText("xoxb-live-secret")).toBeNull();

    fireEvent.change(screen.getByLabelText("作用域连接器"), { target: { value: "conn_1" } });
    fireEvent.change(screen.getByLabelText("授权用户"), { target: { value: "u_alice" } });
    fireEvent.click(screen.getByRole("button", { name: "保存作用域" }));

    await waitFor(() => expect(mocks.putConnectorScope).toHaveBeenCalledWith("conn_1", ["u_alice"]));
  });

  test("non-admin users cannot access the model admin page", async () => {
    mocks.getMe.mockResolvedValue({ id: "u_user", username: "alice", display_name: "Alice", role: "user" });

    render(<ModelsPage />);

    expect(await screen.findByText("无权限")).toBeTruthy();
    expect(mocks.listModelBackends).not.toHaveBeenCalled();
  });
});
