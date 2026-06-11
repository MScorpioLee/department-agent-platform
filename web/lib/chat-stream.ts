import { createWsTicket } from "@/lib/api-client";
import { isDesktopClient } from "@/lib/client-target";
import { getDesktopServerUrl } from "@/lib/desktop-bridge";
import type { ToolCall } from "@/lib/types";

export type ChatStreamEvent =
  | { type: "turn_started"; session_id?: string }
  | { type: "assistant"; content?: string; tool_calls?: ToolCall[] | null }
  | { type: "tool_call"; tool: string; arguments: Record<string, unknown> }
  | { type: "tool_output"; task_id: string; stream: "stdout" | "stderr"; data: string }
  | { type: "tool_result"; tool: string; status: string }
  | { type: "approval_required"; approval_id?: string; risk_rule?: string }
  | { type: "turn_done"; reply: string; stopped: unknown }
  | { type: "turn_error"; code: string; message: string };

export type StreamingItem =
  | { id: string; kind: "user"; content: string; createdAt: string }
  | { id: string; kind: "assistant"; content: string; toolCalls?: ToolCall[] | null; createdAt: string }
  | {
      id: string;
      kind: "tool";
      tool: string;
      arguments: Record<string, unknown>;
      taskId?: string;
      stdout: string;
      stderr: string;
      status: "running" | "completed" | "failed";
      createdAt: string;
    }
  | { id: string; kind: "approval"; approvalId?: string; riskRule?: string; createdAt: string }
  | { id: string; kind: "error"; code: string; message: string; createdAt: string };

export interface StreamingTurn {
  status: "idle" | "streaming" | "done" | "error";
  items: StreamingItem[];
}

export interface ChatStreamHandlers {
  onEvent: (event: ChatStreamEvent) => void;
  onError?: (error: Error) => void;
  onClose?: () => void;
}

export interface ChatStreamConnection {
  close: () => void;
}

function nowIso() {
  return new Date().toISOString();
}

function httpToWs(url: string) {
  return url.replace(/^http:/, "ws:").replace(/^https:/, "wss:").replace(/\/+$/, "");
}

function makeId(prefix: string, count: number) {
  return `${prefix}_${count + 1}`;
}

function latestToolIndex(items: StreamingItem[], taskId?: string) {
  if (taskId) {
    const matched = items.findIndex((item) => item.kind === "tool" && item.taskId === taskId);
    if (matched >= 0) return matched;
  }

  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (items[index].kind === "tool") return index;
  }
  return -1;
}

export function createStreamingTurn(content: string, createdAt = nowIso()): StreamingTurn {
  return {
    status: "streaming",
    items: [{ id: "user_1", kind: "user", content, createdAt }]
  };
}

export function applyChatStreamEvent(turn: StreamingTurn, event: ChatStreamEvent): StreamingTurn {
  if (event.type === "turn_started") {
    return { ...turn, status: "streaming" };
  }

  if (event.type === "assistant" && (event.content || event.tool_calls?.length)) {
    return {
      ...turn,
      items: [
        ...turn.items,
        {
          id: makeId("assistant", turn.items.length),
          kind: "assistant",
          content: event.content ?? "",
          toolCalls: event.tool_calls ?? null,
          createdAt: nowIso()
        }
      ]
    };
  }

  if (event.type === "tool_call") {
    return {
      ...turn,
      items: [
        ...turn.items,
        {
          id: makeId("tool", turn.items.length),
          kind: "tool",
          tool: event.tool,
          arguments: event.arguments,
          stdout: "",
          stderr: "",
          status: "running",
          createdAt: nowIso()
        }
      ]
    };
  }

  if (event.type === "tool_output") {
    const index = latestToolIndex(turn.items, event.task_id);
    const items = [...turn.items];
    if (index < 0) {
      items.push({
        id: makeId("tool", items.length),
        kind: "tool",
        tool: "remote_exec",
        arguments: {},
        taskId: event.task_id,
        stdout: event.stream === "stdout" ? event.data : "",
        stderr: event.stream === "stderr" ? event.data : "",
        status: "running",
        createdAt: nowIso()
      });
      return { ...turn, items };
    }

    const item = items[index];
    if (item.kind !== "tool") return turn;
    items[index] = {
      ...item,
      taskId: item.taskId ?? event.task_id,
      stdout: event.stream === "stdout" ? item.stdout + event.data : item.stdout,
      stderr: event.stream === "stderr" ? item.stderr + event.data : item.stderr
    };
    return { ...turn, items };
  }

  if (event.type === "tool_result") {
    const index = latestToolIndex(turn.items);
    if (index < 0) return turn;
    const items = [...turn.items];
    const item = items[index];
    if (item.kind !== "tool") return turn;
    items[index] = {
      ...item,
      status: event.status === "completed" ? "completed" : "failed"
    };
    return { ...turn, items };
  }

  if (event.type === "approval_required") {
    return {
      ...turn,
      items: [
        ...turn.items,
        {
          id: makeId("approval", turn.items.length),
          kind: "approval",
          approvalId: event.approval_id,
          riskRule: event.risk_rule,
          createdAt: nowIso()
        }
      ]
    };
  }

  if (event.type === "turn_done") {
    return {
      status: "done",
      items: [
        ...turn.items,
        {
          id: makeId("assistant", turn.items.length),
          kind: "assistant",
          content: event.reply,
          toolCalls: null,
          createdAt: nowIso()
        }
      ]
    };
  }

  if (event.type === "turn_error") {
    return {
      status: "error",
      items: [
        ...turn.items,
        {
          id: makeId("error", turn.items.length),
          kind: "error",
          code: event.code,
          message: event.message,
          createdAt: nowIso()
        }
      ]
    };
  }

  return turn;
}

export function startMockChatStream(handlers: ChatStreamHandlers): ChatStreamConnection {
  const events: ChatStreamEvent[] = [
    { type: "turn_started" },
    { type: "tool_call", tool: "remote_exec", arguments: { command: "printf hello" } },
    { type: "tool_output", task_id: "t_mock_stream", stream: "stdout", data: "准备执行命令...\n" },
    { type: "tool_output", task_id: "t_mock_stream", stream: "stdout", data: "mock stdout: hello from runner\n" },
    { type: "tool_result", tool: "remote_exec", status: "completed" },
    { type: "assistant", content: "mock 已收到工具输出。", tool_calls: null },
    { type: "turn_done", reply: "已完成", stopped: null }
  ];

  const timers = events.map((event, index) =>
    window.setTimeout(() => handlers.onEvent(event), (index + 1) * 50)
  );

  return {
    close() {
      timers.forEach((timer) => window.clearTimeout(timer));
      handlers.onClose?.();
    }
  };
}

async function resolveAgentWsBaseUrl() {
  if (isDesktopClient()) {
    return httpToWs(await getDesktopServerUrl());
  }

  if (process.env.NEXT_PUBLIC_AGENT_WS_URL) {
    return httpToWs(process.env.NEXT_PUBLIC_AGENT_WS_URL);
  }

  if (typeof window !== "undefined") {
    return httpToWs(window.location.origin);
  }

  return "ws://127.0.0.1:8700";
}

function isChatStreamEvent(value: unknown): value is ChatStreamEvent {
  return typeof value === "object" && value !== null && typeof (value as { type?: unknown }).type === "string";
}

export async function connectChatStream(
  sessionId: string,
  handlers: ChatStreamHandlers
): Promise<ChatStreamConnection> {
  const ticket = await createWsTicket();
  if (ticket.ticket.startsWith("mock_ws_ticket_")) {
    return startMockChatStream(handlers);
  }

  const baseUrl = await resolveAgentWsBaseUrl();
  const ws = new WebSocket(`${baseUrl}/ws/client?ticket=${encodeURIComponent(ticket.ticket)}`);

  return new Promise((resolve, reject) => {
    let subscribed = false;
    const timer = window.setTimeout(() => {
      if (!subscribed) {
        subscribed = true;
        ws.close();
        reject(new Error("实时通道连接超时"));
      }
    }, 5000);

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "subscribe", session_id: sessionId }));
    };

    ws.onerror = () => {
      window.clearTimeout(timer);
      const error = new Error("实时通道不可用");
      if (!subscribed) {
        subscribed = true;
        reject(error);
        return;
      }
      handlers.onError?.(error);
    };

    ws.onmessage = (message) => {
      try {
        const event = JSON.parse(String(message.data)) as unknown;
        if (typeof event === "object" && event !== null && (event as { type?: unknown }).type === "subscribed") {
          if (!subscribed) {
            subscribed = true;
            window.clearTimeout(timer);
            resolve({
              close() {
                ws.close();
              }
            });
          }
          return;
        }
        if (isChatStreamEvent(event)) {
          handlers.onEvent(event);
        }
      } catch (error) {
        handlers.onError?.(error instanceof Error ? error : new Error(String(error)));
      }
    };

    ws.onclose = () => {
      window.clearTimeout(timer);
      if (!subscribed) {
        subscribed = true;
        reject(new Error("实时通道已断开"));
        return;
      }
      handlers.onClose?.();
    };
  });
}
