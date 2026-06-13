import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import DesktopAgentPage from "@/app/desktop-agent/page";

const mocks = vi.hoisted(() => ({
  desktop: true,
  getAgentWorkspace: vi.fn(),
  setAgentWorkspace: vi.fn(),
  openAgentWorkspaceDialog: vi.fn(),
  listAgentFiles: vi.fn(),
  readAgentFile: vi.fn(),
  runDesktopAgentTurn: vi.fn()
}));

vi.mock("@/lib/client-target", () => ({
  isDesktopClient: () => mocks.desktop
}));

vi.mock("@/lib/desktop-agent", () => ({
  getAgentWorkspace: mocks.getAgentWorkspace,
  setAgentWorkspace: mocks.setAgentWorkspace,
  openAgentWorkspaceDialog: mocks.openAgentWorkspaceDialog,
  listAgentFiles: mocks.listAgentFiles,
  readAgentFile: mocks.readAgentFile,
  runDesktopAgentTurn: mocks.runDesktopAgentTurn
}));

describe("desktop coding agent ui", () => {
  afterEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    mocks.desktop = true;
  });

  test("is gated outside the desktop client", () => {
    mocks.desktop = false;

    render(<DesktopAgentPage />);

    expect(screen.getByText("仅桌面客户端可用")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "打开项目" })).toBeNull();
  });

  test("opens a workspace, previews files, approves commands inline, and shows write diffs", async () => {
    mocks.getAgentWorkspace.mockResolvedValue(null);
    mocks.openAgentWorkspaceDialog.mockResolvedValue("/tmp/project");
    mocks.setAgentWorkspace.mockResolvedValue("/tmp/project");
    mocks.listAgentFiles.mockImplementation(async (path = "") => {
      if (path === "") return ["src/", "README.md"];
      if (path === "src") return ["main.ts"];
      return [];
    });
    mocks.readAgentFile.mockResolvedValue("# Demo\n");
    mocks.runDesktopAgentTurn.mockImplementation(async ({ approveCommand, onEvent }) => {
      onEvent({
        type: "tool_result",
        toolCallId: "call_list",
        name: "list_files",
        status: "success",
        title: ".",
        output: ["src/", "README.md"]
      });
      const allowed = await approveCommand({ toolCallId: "call_cmd", command: "python hello.py" });
      if (allowed) {
        onEvent({
          type: "tool_result",
          toolCallId: "call_cmd",
          name: "run_command",
          status: "success",
          title: "python hello.py",
          output: { exit_code: 0, stdout: "hello\n", stderr: "" }
        });
      }
      onEvent({
        type: "tool_result",
        toolCallId: "call_write",
        name: "write_file",
        status: "success",
        title: "hello.py",
        diff: { path: "hello.py", before: "", after: "print('hello')\n" },
        output: { bytes: 15 }
      });
      return { messages: [], assistantText: "完成" };
    });

    render(<DesktopAgentPage />);

    expect(screen.getByText("项目 / 会话")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "对话" })).toBeTruthy();
    expect(screen.getByText("代码 / Diff")).toBeTruthy();
    expect(await screen.findByText("打开一个项目目录开始")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "打开项目" }));

    expect(await screen.findByText("/tmp/project")).toBeTruthy();
    expect(screen.getByText("README.md")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "README.md" }));

    expect(await screen.findByText("# Demo")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Agent 输入"), { target: { value: "建个 hello.py 并运行" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    expect(await screen.findByText("允许执行?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "允许执行 python hello.py" }));

    await waitFor(() => {
      expect(screen.getAllByText("hello.py").length).toBeGreaterThan(0);
      expect(screen.getAllByText("+ print('hello')").length).toBeGreaterThan(0);
      expect(screen.getAllByText(/hello/).length).toBeGreaterThan(0);
      expect(screen.getAllByText("完成").length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getByRole("button", { name: "查看 diff hello.py" }));
    expect(screen.getByLabelText("右侧 diff 视图").textContent).toContain("hello.py");

    const stored = JSON.parse(window.localStorage.getItem("agent-coder.sessions.v1") ?? "[]");
    expect(stored[0].title).toBe("建个 hello.py 并运行");
    expect(stored[0].chatItems.some((item: { kind?: string; content?: string }) => item.content === "建个 hello.py 并运行")).toBe(
      true
    );
  });

  test("switches between locally persisted coding sessions", async () => {
    window.localStorage.setItem(
      "agent-coder.sessions.v1",
      JSON.stringify([
        {
          id: "s_one",
          title: "修复 README",
          updatedAt: "2026-06-13T08:00:00.000Z",
          chatItems: [{ id: "u1", kind: "user", content: "修复 README" }],
          agentMessages: [{ role: "system", content: "system" }, { role: "user", content: "修复 README" }]
        },
        {
          id: "s_two",
          title: "新增测试",
          updatedAt: "2026-06-13T08:01:00.000Z",
          chatItems: [{ id: "u2", kind: "user", content: "新增测试" }],
          agentMessages: [{ role: "system", content: "system" }, { role: "user", content: "新增测试" }]
        }
      ])
    );
    mocks.getAgentWorkspace.mockResolvedValue("/tmp/project");
    mocks.listAgentFiles.mockResolvedValue([]);

    render(<DesktopAgentPage />);

    expect((await screen.findAllByText("修复 README")).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "会话 新增测试" }));
    expect(screen.getAllByText("新增测试").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "新对话" }));
    expect(screen.getAllByText("新对话").length).toBeGreaterThan(0);
    expect(screen.getByText("等待你的任务")).toBeTruthy();
  });

  test("can reject a command approval without running it", async () => {
    mocks.getAgentWorkspace.mockResolvedValue("/tmp/project");
    mocks.listAgentFiles.mockResolvedValue([]);
    mocks.runDesktopAgentTurn.mockImplementation(async ({ approveCommand, onEvent }) => {
      const allowed = await approveCommand({ toolCallId: "call_cmd", command: "rm -rf tmp" });
      onEvent({
        type: "tool_result",
        toolCallId: "call_cmd",
        name: "run_command",
        status: allowed ? "success" : "denied",
        title: "rm -rf tmp",
        output: allowed ? { exit_code: 0, stdout: "", stderr: "" } : { error: "用户拒绝" }
      });
      return { messages: [], assistantText: "已拒绝" };
    });

    render(<DesktopAgentPage />);

    expect(await screen.findByText("/tmp/project")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Agent 输入"), { target: { value: "删除 tmp" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    expect(await screen.findByText("允许执行?")).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "拒绝执行 rm -rf tmp" }));
    });

    expect(await screen.findByText("用户拒绝")).toBeTruthy();
    expect(screen.getAllByText("已拒绝").length).toBeGreaterThan(0);
  });

  test("renders local tool error codes such as path_denied", async () => {
    mocks.getAgentWorkspace.mockResolvedValue("/tmp/project");
    mocks.listAgentFiles.mockResolvedValue([]);
    mocks.runDesktopAgentTurn.mockImplementation(async ({ onEvent }) => {
      onEvent({
        type: "tool_result",
        toolCallId: "call_read",
        name: "read_file",
        status: "error",
        title: "../secret.txt",
        output: { error: "路径不在工作区目录内", code: "path_denied", status: 403 }
      });
      return { messages: [], assistantText: "读取失败" };
    });

    render(<DesktopAgentPage />);

    expect(await screen.findByText("/tmp/project")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Agent 输入"), { target: { value: "读 ../secret.txt" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    expect(await screen.findByText("path_denied")).toBeTruthy();
    expect(screen.getByText("路径不在工作区目录内")).toBeTruthy();
  });
});
