import { afterEach, describe, expect, test, vi } from "vitest";

import { runDesktopAgentTurn } from "@/lib/desktop-agent";

const invokeMock = vi.fn();

function installTauriInvoke() {
  (globalThis as typeof globalThis & { __TAURI__?: unknown }).__TAURI__ = {
    core: {
      invoke: invokeMock
    }
  };
}

function modelResponse(message: Record<string, unknown>) {
  return {
    choices: [
      {
        message
      }
    ]
  };
}

describe("desktop agent loop", () => {
  afterEach(() => {
    vi.clearAllMocks();
    delete (globalThis as typeof globalThis & { __TAURI__?: unknown }).__TAURI__;
  });

  test("asks before running a command and returns a denied tool result to the model", async () => {
    installTauriInvoke();
    invokeMock
      .mockResolvedValueOnce(
        modelResponse({
          role: "assistant",
          content: "",
          tool_calls: [
            {
              id: "call_cmd",
              type: "function",
              function: {
                name: "run_command",
                arguments: JSON.stringify({ command: "npm test" })
              }
            }
          ]
        })
      )
      .mockResolvedValueOnce(modelResponse({ role: "assistant", content: "已取消执行命令" }));
    const events: unknown[] = [];

    const result = await runDesktopAgentTurn({
      messages: [{ role: "system", content: "你是桌面编码 Agent" }],
      userInput: "跑一下测试",
      approveCommand: async ({ command }) => command !== "npm test",
      onEvent: (event) => events.push(event)
    });

    expect(result.assistantText).toBe("已取消执行命令");
    expect(invokeMock).not.toHaveBeenCalledWith("agent_run_command", expect.anything());
    expect(invokeMock).toHaveBeenNthCalledWith(
      2,
      "agent_model_chat",
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: "tool",
            tool_call_id: "call_cmd",
            content: expect.stringContaining("用户拒绝")
          })
        ])
      })
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool_result",
        name: "run_command",
        status: "denied",
        toolCallId: "call_cmd"
      })
    );
  });

  test("writes files through local tools and emits a diff event", async () => {
    installTauriInvoke();
    invokeMock.mockImplementation(async (command: string, args: Record<string, unknown> = {}) => {
      if (command === "agent_model_chat") {
        const messages = args.messages as Array<{ role: string }>;
        if (!messages.some((message) => message.role === "tool")) {
          return modelResponse({
            role: "assistant",
            content: "",
            tool_calls: [
              {
                id: "call_write",
                type: "function",
                function: {
                  name: "write_file",
                  arguments: JSON.stringify({ path: "hello.py", content: "print('hello')\n" })
                }
              }
            ]
          });
        }
        return modelResponse({ role: "assistant", content: "已写入 hello.py" });
      }
      if (command === "agent_read_file") {
        return "print('old')\n";
      }
      if (command === "agent_write_file") {
        return 15;
      }
      throw new Error(`unexpected command ${command}`);
    });
    const events: unknown[] = [];

    const result = await runDesktopAgentTurn({
      messages: [],
      userInput: "创建 hello.py",
      approveCommand: async () => true,
      onEvent: (event) => events.push(event)
    });

    expect(result.assistantText).toBe("已写入 hello.py");
    expect(invokeMock).toHaveBeenCalledWith("agent_read_file", { path: "hello.py" });
    expect(invokeMock).toHaveBeenCalledWith("agent_write_file", {
      path: "hello.py",
      content: "print('hello')\n"
    });
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool_result",
        name: "write_file",
        status: "success",
        diff: {
          path: "hello.py",
          before: "print('old')\n",
          after: "print('hello')\n"
        }
      })
    );
  });
});
