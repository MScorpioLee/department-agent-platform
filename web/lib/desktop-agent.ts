import { invokeDesktop } from "@/lib/desktop-bridge";

export type AgentRole = "system" | "user" | "assistant" | "tool";
export type DesktopToolName = "run_command" | "read_file" | "write_file" | "list_files";
export type ToolStatus = "running" | "success" | "error" | "denied";

export interface AgentChatMessage {
  role: AgentRole;
  content?: string | null;
  tool_calls?: AgentToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface AgentToolCall {
  id: string;
  type?: "function";
  function?: {
    name?: string;
    arguments?: string | Record<string, unknown>;
  };
}

export interface CommandResult {
  exit_code: number;
  stdout: string;
  stderr: string;
}

export interface WriteDiff {
  path: string;
  before: string;
  after: string;
}

export interface CommandApprovalRequest {
  toolCallId: string;
  command: string;
}

export type DesktopAgentEvent =
  | {
      type: "assistant_message";
      content: string;
    }
  | {
      type: "tool_pending";
      toolCallId: string;
      name: DesktopToolName;
      title: string;
    }
  | {
      type: "tool_result";
      toolCallId: string;
      name: DesktopToolName;
      title: string;
      status: ToolStatus;
      output: unknown;
      diff?: WriteDiff;
    };

export interface RunDesktopAgentOptions {
  messages: AgentChatMessage[];
  userInput: string;
  autoApproveCommands?: boolean;
  approveCommand?: (request: CommandApprovalRequest) => Promise<boolean>;
  onEvent?: (event: DesktopAgentEvent) => void;
  shouldStop?: () => boolean;
  maxSteps?: number;
}

export interface RunDesktopAgentResult {
  messages: AgentChatMessage[];
  assistantText: string;
  stopped: "user" | "max_steps" | null;
}

interface ModelChatResponse {
  choices?: Array<{
    message?: AgentChatMessage;
  }>;
  message?: AgentChatMessage;
}

const MAX_STEPS = 12;

export const DESKTOP_AGENT_TOOLS = [
  {
    type: "function",
    function: {
      name: "run_command",
      description: "在当前工作区内执行 shell 命令。命令执行前需要用户审批。",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "要执行的命令" }
        },
        required: ["command"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "读取当前工作区内的文件内容。",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "相对工作区的文件路径" }
        },
        required: ["path"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description: "写入当前工作区内的文件内容。",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "相对工作区的文件路径" },
          content: { type: "string", description: "完整文件内容" }
        },
        required: ["path", "content"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "list_files",
      description: "列出当前工作区内某个目录的文件和子目录。",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "相对工作区目录, 空字符串表示根目录" }
        }
      }
    }
  }
] as const;

export async function openAgentWorkspaceDialog(): Promise<string | null> {
  const dialog = await import("@tauri-apps/plugin-dialog");
  const selected = await dialog.open({
    directory: true,
    multiple: false,
    title: "选择项目目录"
  });

  if (Array.isArray(selected)) return selected[0] ?? null;
  return typeof selected === "string" ? selected : null;
}

export async function setAgentWorkspace(path: string): Promise<string> {
  return invokeDesktop<string>("agent_set_workspace", { path });
}

export async function getAgentWorkspace(): Promise<string | null> {
  return invokeDesktop<string | null>("agent_get_workspace", {});
}

export async function listAgentFiles(path = ""): Promise<string[]> {
  return invokeDesktop<string[]>("agent_list_files", { path });
}

export async function readAgentFile(path: string): Promise<string> {
  return invokeDesktop<string>("agent_read_file", { path });
}

export async function writeAgentFile(path: string, content: string): Promise<number> {
  return invokeDesktop<number>("agent_write_file", { path, content });
}

export async function runAgentCommand(command: string): Promise<CommandResult> {
  return invokeDesktop<CommandResult>("agent_run_command", { command });
}

export async function chatAgentModel(messages: AgentChatMessage[], tools = DESKTOP_AGENT_TOOLS): Promise<ModelChatResponse> {
  return invokeDesktop<ModelChatResponse>("agent_model_chat", { messages, tools });
}

export async function runDesktopAgentTurn(options: RunDesktopAgentOptions): Promise<RunDesktopAgentResult> {
  const messages: AgentChatMessage[] = [
    ...options.messages,
    { role: "user", content: options.userInput }
  ];
  const maxSteps = options.maxSteps ?? MAX_STEPS;
  let assistantText = "";

  for (let step = 0; step < maxSteps; step += 1) {
    if (options.shouldStop?.()) {
      return { messages, assistantText, stopped: "user" };
    }

    const response = await chatAgentModel(messages);
    const assistantMessage = normalizeAssistantMessage(response);
    messages.push(assistantMessage);

    const content = contentToText(assistantMessage.content);
    if (content) {
      assistantText = content;
      options.onEvent?.({ type: "assistant_message", content });
    }

    const toolCalls = assistantMessage.tool_calls ?? [];
    if (toolCalls.length === 0) {
      return { messages, assistantText, stopped: null };
    }

    for (const toolCall of toolCalls) {
      if (options.shouldStop?.()) {
        return { messages, assistantText, stopped: "user" };
      }
      const toolResult = await executeToolCall(toolCall, options);
      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        name: toolResult.name,
        content: JSON.stringify(toolResult.content)
      });
    }
  }

  return { messages, assistantText, stopped: "max_steps" };
}

function normalizeAssistantMessage(response: ModelChatResponse): AgentChatMessage {
  const message = response.choices?.[0]?.message ?? response.message;
  if (!message) {
    return { role: "assistant", content: "" };
  }
  return {
    role: "assistant",
    content: message.content ?? "",
    tool_calls: message.tool_calls ?? []
  };
}

function contentToText(content: AgentChatMessage["content"]): string {
  if (typeof content === "string") return content;
  if (content == null) return "";
  return String(content);
}

async function executeToolCall(
  toolCall: AgentToolCall,
  options: RunDesktopAgentOptions
): Promise<{ name: DesktopToolName; content: unknown }> {
  const name = normalizeToolName(toolCall.function?.name);
  const args = parseArguments(toolCall.function?.arguments);
  const title = titleForTool(name, args);
  options.onEvent?.({ type: "tool_pending", toolCallId: toolCall.id, name, title });

  try {
    if (name === "run_command") {
      const command = stringArg(args.command);
      if (!options.autoApproveCommands) {
        const approved = await options.approveCommand?.({ toolCallId: toolCall.id, command });
        if (!approved) {
          const denied = { error: "用户拒绝" };
          options.onEvent?.({
            type: "tool_result",
            toolCallId: toolCall.id,
            name,
            title: command,
            status: "denied",
            output: denied
          });
          return { name, content: denied };
        }
      }
      const output = await runAgentCommand(command);
      options.onEvent?.({
        type: "tool_result",
        toolCallId: toolCall.id,
        name,
        title: command,
        status: "success",
        output
      });
      return { name, content: output };
    }

    if (name === "read_file") {
      const path = stringArg(args.path);
      const output = await readAgentFile(path);
      options.onEvent?.({
        type: "tool_result",
        toolCallId: toolCall.id,
        name,
        title: path,
        status: "success",
        output
      });
      return { name, content: { path, content: output } };
    }

    if (name === "write_file") {
      const path = stringArg(args.path);
      const content = stringArg(args.content);
      let before = "";
      try {
        before = await readAgentFile(path);
      } catch {
        before = "";
      }
      const bytes = await writeAgentFile(path, content);
      const diff = { path, before, after: content };
      const output = { path, bytes };
      options.onEvent?.({
        type: "tool_result",
        toolCallId: toolCall.id,
        name,
        title: path,
        status: "success",
        output,
        diff
      });
      return { name, content: output };
    }

    const path = typeof args.path === "string" ? args.path : "";
    const output = await listAgentFiles(path);
    options.onEvent?.({
      type: "tool_result",
      toolCallId: toolCall.id,
      name,
      title: path || ".",
      status: "success",
      output
    });
    return { name, content: { path, entries: output } };
  } catch (error) {
    const output = errorToToolOutput(error);
    options.onEvent?.({
      type: "tool_result",
      toolCallId: toolCall.id,
      name,
      title,
      status: "error",
      output
    });
    return { name, content: output };
  }
}

function normalizeToolName(name: unknown): DesktopToolName {
  if (name === "run_command" || name === "read_file" || name === "write_file" || name === "list_files") {
    return name;
  }
  throw new Error(`未知工具: ${String(name)}`);
}

function parseArguments(input: string | Record<string, unknown> | undefined): Record<string, unknown> {
  if (!input) return {};
  if (typeof input === "object") return input;
  try {
    const parsed = JSON.parse(input);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function stringArg(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function titleForTool(name: DesktopToolName, args: Record<string, unknown>): string {
  if (name === "run_command") return stringArg(args.command);
  if (name === "list_files") return stringArg(args.path) || ".";
  return stringArg(args.path);
}

function errorToToolOutput(error: unknown): { error: string; code?: string; status?: number } {
  if (typeof error === "object" && error !== null) {
    const details = error as { message?: unknown; code?: unknown; status?: unknown };
    return {
      error: typeof details.message === "string" ? details.message : "工具调用失败",
      code: typeof details.code === "string" ? details.code : undefined,
      status: typeof details.status === "number" ? details.status : undefined
    };
  }
  return { error: error instanceof Error ? error.message : String(error) };
}
