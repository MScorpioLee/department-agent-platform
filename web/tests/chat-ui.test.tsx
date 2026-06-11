import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import ChatPage from "@/app/chat/page";

const mocks = vi.hoisted(() => ({
  listMachines: vi.fn(),
  createSession: vi.fn(),
  sendSessionMessage: vi.fn(),
  getSessionMessages: vi.fn(),
  connectChatStream: vi.fn()
}));

vi.mock("@/lib/api-client", () => ({
  listMachines: mocks.listMachines,
  createSession: mocks.createSession,
  sendSessionMessage: mocks.sendSessionMessage,
  getSessionMessages: mocks.getSessionMessages
}));

vi.mock("@/lib/chat-stream", async () => {
  const actual = await vi.importActual<typeof import("@/lib/chat-stream")>("@/lib/chat-stream");
  return {
    ...actual,
    connectChatStream: mocks.connectChatStream
  };
});

describe("chat ui", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  test("creates a session, falls back to sync send, and renders tool approval timeline", async () => {
    mocks.listMachines.mockResolvedValue([
      {
        machine_id: "m_1",
        machine_name: "alice-laptop",
        os: "darwin",
        status: "online",
        last_seen_at: "2026-06-10T12:00:00Z",
        capabilities: ["remote_exec"]
      }
    ]);
    mocks.createSession.mockResolvedValue({ session_id: "s_1", machine_id: "m_1", status: "active" });
    mocks.connectChatStream.mockRejectedValue(new Error("ws unavailable"));
    mocks.sendSessionMessage.mockResolvedValue({ reply: "已完成", steps: [], stopped: null });
    mocks.getSessionMessages.mockResolvedValue([
      { seq: 1, role: "user", content: "帮我检查", tool_calls: null, created_at: "2026-06-10T12:00:00Z" },
      {
        seq: 2,
        role: "assistant",
        content: "",
        tool_calls: [{ id: "call_1", name: "remote_exec", arguments: { command: "rm -rf [redacted]" } }],
        created_at: "2026-06-10T12:00:01Z"
      },
      {
        seq: 3,
        role: "tool",
        content: JSON.stringify({ needs_approval: true, approval_id: "ap_1" }),
        tool_call_id: "call_1",
        tool_calls: null,
        created_at: "2026-06-10T12:00:02Z"
      },
      { seq: 4, role: "assistant", content: "已提交审批", tool_calls: null, created_at: "2026-06-10T12:00:03Z" }
    ]);

    render(<ChatPage />);

    expect(await screen.findByText("alice-laptop")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("标题"), { target: { value: "检查" } });
    fireEvent.click(screen.getByRole("button", { name: "新建会话" }));

    await waitFor(() => expect(mocks.createSession).toHaveBeenCalledWith({ machine_id: "m_1", title: "检查" }));

    fireEvent.change(screen.getByLabelText("消息内容"), { target: { value: "帮我检查" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() => {
      expect(mocks.sendSessionMessage).toHaveBeenCalledWith("s_1", "帮我检查");
      expect(screen.getByText("remote_exec")).toBeTruthy();
      expect(screen.getByText("该操作需审批")).toBeTruthy();
      expect(screen.getByRole("link", { name: "去审批" })).toBeTruthy();
      expect(screen.getByText("已提交审批")).toBeTruthy();
    });
  });

  test("streams tool calls, incremental output, approvals, and final reply", async () => {
    let handlers: Parameters<typeof import("@/lib/chat-stream").connectChatStream>[1] | undefined;
    const close = vi.fn();
    mocks.listMachines.mockResolvedValue([
      {
        machine_id: "m_1",
        machine_name: "alice-laptop",
        os: "darwin",
        status: "online",
        last_seen_at: "2026-06-10T12:00:00Z",
        capabilities: ["remote_exec"]
      }
    ]);
    mocks.createSession.mockResolvedValue({ session_id: "s_1", machine_id: "m_1", status: "active" });
    mocks.connectChatStream.mockImplementation(async (_sessionId, nextHandlers) => {
      handlers = nextHandlers;
      return { close };
    });
    mocks.sendSessionMessage.mockResolvedValue({ reply: "完成", steps: [], stopped: null });

    render(<ChatPage />);

    expect(await screen.findByText("alice-laptop")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "新建会话" }));
    await waitFor(() => expect(mocks.createSession).toHaveBeenCalledWith({ machine_id: "m_1" }));

    fireEvent.change(screen.getByLabelText("消息内容"), { target: { value: "帮我检查" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() => expect(mocks.connectChatStream).toHaveBeenCalledWith("s_1", expect.any(Object)));

    await act(async () => {
      handlers?.onEvent({ type: "turn_started" });
      handlers?.onEvent({ type: "tool_call", tool: "remote_exec", arguments: { command: "pwd" } });
      handlers?.onEvent({ type: "tool_output", task_id: "t_1", stream: "stdout", data: "hello\n" });
      handlers?.onEvent({ type: "tool_output", task_id: "t_1", stream: "stdout", data: "world\n" });
      handlers?.onEvent({ type: "approval_required", approval_id: "ap_1", risk_rule: "rm -rf" });
      handlers?.onEvent({ type: "turn_done", reply: "已完成", stopped: null });
    });

    expect(screen.getByText("正在执行 remote_exec")).toBeTruthy();
    expect(screen.getByText(/hello\s+world/)).toBeTruthy();
    expect(screen.getByText("该操作需审批")).toBeTruthy();
    expect(screen.getByRole("link", { name: "去审批" })).toBeTruthy();
    expect(screen.getByText("已完成")).toBeTruthy();
    expect(close).toHaveBeenCalled();
    expect(mocks.getSessionMessages).not.toHaveBeenCalled();
  });
});
