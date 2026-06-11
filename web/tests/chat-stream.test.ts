import { describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createWsTicket: vi.fn()
}));

vi.mock("@/lib/api-client", () => ({
  createWsTicket: mocks.createWsTicket
}));

import {
  applyChatStreamEvent,
  connectChatStream,
  createStreamingTurn,
  startMockChatStream
} from "@/lib/chat-stream";

describe("chat stream state", () => {
  test("waits for subscribed before resolving the websocket stream", async () => {
    mocks.createWsTicket.mockResolvedValue({ ticket: "wst_test" });
    const originalWsUrl = process.env.NEXT_PUBLIC_AGENT_WS_URL;
    process.env.NEXT_PUBLIC_AGENT_WS_URL = "http://agent.example.test:8700";
    const sent: string[] = [];
    let socket:
      | {
          url: string;
          onopen?: () => void;
          onmessage?: (message: { data: string }) => void;
          onclose?: () => void;
          send: (data: string) => void;
          close: () => void;
        }
      | undefined;

    class FakeWebSocket {
      url: string;
      onopen?: () => void;
      onmessage?: (message: { data: string }) => void;
      onclose?: () => void;

      constructor(url: string) {
        this.url = url;
        socket = this;
      }

      send(data: string) {
        sent.push(data);
      }

      close() {
        this.onclose?.();
      }
    }

    vi.stubGlobal("WebSocket", FakeWebSocket);
    const resolved = vi.fn();
    const stream = connectChatStream("s_1", { onEvent: vi.fn() }).then((connection) => {
      resolved(connection);
      return connection;
    });

    await vi.waitFor(() => expect(socket).toBeDefined());
    socket?.onopen?.();
    expect(sent).toEqual([JSON.stringify({ type: "subscribe", session_id: "s_1" })]);
    expect(resolved).not.toHaveBeenCalled();

    socket?.onmessage?.({ data: JSON.stringify({ type: "subscribed", session_id: "s_1" }) });
    const connection = await stream;
    expect(resolved).toHaveBeenCalledWith(connection);
    expect(socket?.url).toBe("ws://agent.example.test:8700/ws/client?ticket=wst_test");
    connection.close();
    vi.unstubAllGlobals();
    process.env.NEXT_PUBLIC_AGENT_WS_URL = originalWsUrl;
  });

  test("appends tool output chunks to the same terminal panel", () => {
    const initial = createStreamingTurn("帮我检查", "2026-06-10T12:00:00Z");
    const withCall = applyChatStreamEvent(initial, {
      type: "tool_call",
      tool: "remote_exec",
      arguments: { command: "pwd" }
    });
    const withFirstOutput = applyChatStreamEvent(withCall, {
      type: "tool_output",
      task_id: "t_1",
      stream: "stdout",
      data: "hello\n"
    });
    const withSecondOutput = applyChatStreamEvent(withFirstOutput, {
      type: "tool_output",
      task_id: "t_1",
      stream: "stdout",
      data: "world\n"
    });

    expect(withSecondOutput.items).toEqual([
      expect.objectContaining({ kind: "user", content: "帮我检查" }),
      expect.objectContaining({
        kind: "tool",
        tool: "remote_exec",
        taskId: "t_1",
        stdout: "hello\nworld\n",
        stderr: ""
      })
    ]);
  });

  test("records approval prompts and final replies", () => {
    const initial = createStreamingTurn("执行危险命令", "2026-06-10T12:00:00Z");
    const withApproval = applyChatStreamEvent(initial, {
      type: "approval_required",
      approval_id: "ap_1",
      risk_rule: "rm -rf"
    });
    const done = applyChatStreamEvent(withApproval, {
      type: "turn_done",
      reply: "已提交审批",
      stopped: null
    });

    expect(done.status).toBe("done");
    expect(done.items).toEqual([
      expect.objectContaining({ kind: "user" }),
      expect.objectContaining({ kind: "approval", approvalId: "ap_1", riskRule: "rm -rf" }),
      expect.objectContaining({ kind: "assistant", content: "已提交审批" })
    ]);
  });

  test("mock stream emits incremental output before turn_done", () => {
    vi.useFakeTimers();
    const events: string[] = [];
    const connection = startMockChatStream({
      onEvent(event) {
        events.push(event.type === "tool_output" ? `${event.type}:${event.data}` : event.type);
      }
    });

    vi.advanceTimersByTime(150);
    expect(events).toContain("tool_call");
    expect(events).toContain("tool_output:准备执行命令...\n");
    expect(events).not.toContain("turn_done");

    vi.runAllTimers();
    expect(events).toContain("tool_output:mock stdout: hello from runner\n");
    expect(events).toContain("turn_done");
    connection.close();
    vi.useRealTimers();
  });
});
