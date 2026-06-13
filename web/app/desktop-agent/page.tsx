"use client";

import {
  AlertTriangle,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  Code2,
  File,
  FileDiff,
  Folder,
  FolderOpen,
  Loader2,
  Play,
  Send,
  Square,
  TerminalSquare,
  X
} from "lucide-react";
import React, { useEffect, useMemo, useRef, useState } from "react";

import { isDesktopClient } from "@/lib/client-target";
import { cn } from "@/lib/cn";
import {
  getAgentWorkspace,
  listAgentFiles,
  openAgentWorkspaceDialog,
  readAgentFile,
  runDesktopAgentTurn,
  setAgentWorkspace,
  type AgentChatMessage,
  type CommandApprovalRequest,
  type DesktopAgentEvent,
  type DesktopToolName,
  type ToolStatus,
  type WriteDiff
} from "@/lib/desktop-agent";

type ApprovalStatus = "pending" | "allowed" | "denied";

type ChatItem =
  | { id: string; kind: "user" | "assistant"; content: string }
  | {
      id: string;
      kind: "approval";
      toolCallId: string;
      command: string;
      status: ApprovalStatus;
    }
  | {
      id: string;
      kind: "tool";
      toolCallId: string;
      name: DesktopToolName;
      title: string;
      status: ToolStatus;
      output?: unknown;
      diff?: WriteDiff;
    };

function getErrorMessage(error: unknown): string {
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message?: unknown }).message);
  }
  return error instanceof Error ? error.message : String(error);
}

function makeId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function joinPath(parent: string, child: string) {
  return parent ? `${parent}/${child}` : child;
}

function trimDirectoryName(entry: string) {
  return entry.endsWith("/") ? entry.slice(0, -1) : entry;
}

function statusLabel(status: ToolStatus) {
  if (status === "running") return "执行中";
  if (status === "success") return "完成";
  if (status === "denied") return "已拒绝";
  return "失败";
}

function statusClass(status: ToolStatus) {
  if (status === "success") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "denied") return "border-amber-200 bg-amber-50 text-amber-700";
  if (status === "error") return "border-rose-200 bg-rose-50 text-rose-700";
  return "border-sky-200 bg-sky-50 text-sky-700";
}

export default function DesktopAgentPage() {
  const desktopClient = isDesktopClient();
  const [workspace, setWorkspace] = useState<string | null>(null);
  const [workspaceLoading, setWorkspaceLoading] = useState(desktopClient);
  const [treeLoading, setTreeLoading] = useState(false);
  const [childrenByPath, setChildrenByPath] = useState<Record<string, string[]>>({});
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => new Set([""]));
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [filePreview, setFilePreview] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [chatItems, setChatItems] = useState<ChatItem[]>([]);
  const [agentMessages, setAgentMessages] = useState<AgentChatMessage[]>([
    {
      role: "system",
      content:
        "你是桌面编码 Agent。只能通过工具访问当前工作区。写文件前优先读取现有文件。运行命令前等待用户审批。"
    }
  ]);
  const [input, setInput] = useState("");
  const [autoApprove, setAutoApprove] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const approvalResolvers = useRef(new Map<string, (allowed: boolean) => void>());
  const stopRequestedRef = useRef(false);
  const transcriptRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!desktopClient) return;
    let cancelled = false;
    setWorkspaceLoading(true);
    getAgentWorkspace()
      .then(async (currentWorkspace) => {
        if (cancelled) return;
        setWorkspace(currentWorkspace);
        if (currentWorkspace) {
          await refreshDirectory("");
        }
      })
      .catch((requestError: unknown) => {
        if (!cancelled) setError(getErrorMessage(requestError));
      })
      .finally(() => {
        if (!cancelled) setWorkspaceLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [desktopClient]);

  useEffect(() => {
    if (!sending) return;
    function handleKeydown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        stopRequestedRef.current = true;
      }
    }
    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  }, [sending]);

  useEffect(() => {
    const transcript = transcriptRef.current;
    if (!transcript) return;
    if (typeof transcript.scrollTo === "function") {
      transcript.scrollTo({ top: transcript.scrollHeight });
    } else {
      transcript.scrollTop = transcript.scrollHeight;
    }
  }, [chatItems]);

  const rootEntries = childrenByPath[""] ?? [];
  const hasWorkspace = Boolean(workspace);

  async function refreshDirectory(path: string) {
    setTreeLoading(true);
    try {
      const entries = await listAgentFiles(path);
      setChildrenByPath((current) => ({ ...current, [path]: entries }));
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setTreeLoading(false);
    }
  }

  async function handleOpenWorkspace() {
    setError(null);
    try {
      const selected = await openAgentWorkspaceDialog();
      if (!selected) return;
      const normalized = await setAgentWorkspace(selected);
      setWorkspace(normalized);
      setSelectedFile(null);
      setFilePreview("");
      setChildrenByPath({});
      setExpandedPaths(new Set([""]));
      await refreshDirectory("");
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    }
  }

  async function toggleDirectory(path: string) {
    const nextExpanded = new Set(expandedPaths);
    if (nextExpanded.has(path)) {
      nextExpanded.delete(path);
      setExpandedPaths(nextExpanded);
      return;
    }
    nextExpanded.add(path);
    setExpandedPaths(nextExpanded);
    if (!childrenByPath[path]) {
      await refreshDirectory(path);
    }
  }

  async function openFile(path: string) {
    setSelectedFile(path);
    setPreviewLoading(true);
    setError(null);
    try {
      const content = await readAgentFile(path);
      setFilePreview(content);
    } catch (requestError) {
      setFilePreview("");
      setError(getErrorMessage(requestError));
    } finally {
      setPreviewLoading(false);
    }
  }

  function upsertToolEvent(event: Extract<DesktopAgentEvent, { type: "tool_pending" | "tool_result" }>) {
    setChatItems((current) => {
      const index = current.findIndex((item) => item.kind === "tool" && item.toolCallId === event.toolCallId);
      const nextTool: ChatItem =
        event.type === "tool_pending"
          ? {
              id: `tool_${event.toolCallId}`,
              kind: "tool",
              toolCallId: event.toolCallId,
              name: event.name,
              title: event.title,
              status: "running"
            }
          : {
              id: `tool_${event.toolCallId}`,
              kind: "tool",
              toolCallId: event.toolCallId,
              name: event.name,
              title: event.title,
              status: event.status,
              output: event.output,
              diff: event.diff
            };
      if (index === -1) return [...current, nextTool];
      const next = [...current];
      next[index] = nextTool;
      return next;
    });
  }

  function requestCommandApproval(request: CommandApprovalRequest): Promise<boolean> {
    if (autoApprove) return Promise.resolve(true);
    setChatItems((current) => [
      ...current,
      {
        id: `approval_${request.toolCallId}`,
        kind: "approval",
        toolCallId: request.toolCallId,
        command: request.command,
        status: "pending"
      }
    ]);
    return new Promise((resolve) => {
      approvalResolvers.current.set(request.toolCallId, resolve);
    });
  }

  function resolveApproval(toolCallId: string, allowed: boolean) {
    const resolver = approvalResolvers.current.get(toolCallId);
    if (!resolver) return;
    approvalResolvers.current.delete(toolCallId);
    setChatItems((current) =>
      current.map((item) =>
        item.kind === "approval" && item.toolCallId === toolCallId
          ? { ...item, status: allowed ? "allowed" : "denied" }
          : item
      )
    );
    resolver(allowed);
  }

  async function handleSend(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = input.trim();
    if (!text || !workspace || sending) return;

    setInput("");
    setError(null);
    setSending(true);
    stopRequestedRef.current = false;
    let emittedAssistantText = "";
    setChatItems((current) => [...current, { id: makeId("user"), kind: "user", content: text }]);

    try {
      const result = await runDesktopAgentTurn({
        messages: agentMessages,
        userInput: text,
        autoApproveCommands: autoApprove,
        approveCommand: requestCommandApproval,
        shouldStop: () => stopRequestedRef.current,
        onEvent: (agentEvent) => {
          if (agentEvent.type === "assistant_message") {
            emittedAssistantText = agentEvent.content;
            setChatItems((current) => [
              ...current,
              { id: makeId("assistant"), kind: "assistant", content: agentEvent.content }
            ]);
          } else {
            upsertToolEvent(agentEvent);
          }
        }
      });
      setAgentMessages(result.messages);
      if (result.assistantText && result.assistantText !== emittedAssistantText) {
        setChatItems((current) => [
          ...current,
          { id: makeId("assistant"), kind: "assistant", content: result.assistantText }
        ]);
      }
      if (result.stopped === "max_steps") {
        setError("Agent Loop 已达到步数上限");
      } else if (result.stopped === "user") {
        setError("本轮已请求中止");
      }
      if (result.messages.some((message) => message.role === "tool" && message.name === "write_file")) {
        void refreshDirectory("");
      }
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setSending(false);
    }
  }

  if (!desktopClient) {
    return (
      <section className="rounded-md border border-slate-200 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-md bg-slate-100 text-slate-500">
          <Code2 aria-hidden="true" className="h-6 w-6" />
        </div>
        <h1 className="mt-4 text-xl font-semibold text-slate-950">仅桌面客户端可用</h1>
        <p className="mt-2 text-sm text-slate-500">本页需要 Tauri 本地工具命令,Web 端不会显示入口。</p>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 rounded-md border border-slate-200 bg-white p-4 shadow-sm lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-950">
            <Code2 aria-hidden="true" className="h-4 w-4 text-slate-500" />
            桌面编码 Agent
          </div>
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2 text-sm text-slate-500">
            <span className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700">
              <Check aria-hidden="true" className="h-3.5 w-3.5" />
              桌面登录已接入
            </span>
            <span className="truncate font-mono">{workspaceLoading ? "读取项目目录..." : workspace ?? "未选择项目"}</span>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void handleOpenWorkspace()}
          className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-slate-900 px-3 text-sm font-semibold text-white shadow-sm hover:bg-slate-700"
        >
          <FolderOpen aria-hidden="true" className="h-4 w-4" />
          打开项目
        </button>
      </div>

      {error ? (
        <div className="flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      {!hasWorkspace ? (
        <div className="grid min-h-[520px] place-items-center rounded-md border border-dashed border-slate-300 bg-white p-8 text-center">
          <div>
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-md bg-slate-100 text-slate-500">
              <FolderOpen aria-hidden="true" className="h-6 w-6" />
            </div>
            <h2 className="mt-4 text-lg font-semibold text-slate-950">打开一个项目目录开始</h2>
            <p className="mt-2 text-sm text-slate-500">Agent 的文件和命令工具会被 Rust 锁定在这个目录内。</p>
          </div>
        </div>
      ) : (
        <div className="grid min-h-[calc(100vh-13rem)] gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
          <aside className="flex min-h-[520px] flex-col rounded-md border border-slate-200 bg-white shadow-sm">
            <div className="flex h-11 items-center justify-between border-b border-slate-200 px-3">
              <div className="inline-flex items-center gap-2 text-sm font-semibold text-slate-950">
                <Folder aria-hidden="true" className="h-4 w-4 text-slate-500" />
                文件
              </div>
              {treeLoading ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin text-slate-400" /> : null}
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-2">
              {rootEntries.length === 0 ? (
                <div className="px-2 py-6 text-sm text-slate-500">暂无文件</div>
              ) : (
                <FileTree
                  entries={rootEntries}
                  parentPath=""
                  childrenByPath={childrenByPath}
                  expandedPaths={expandedPaths}
                  selectedFile={selectedFile}
                  onToggleDirectory={(path) => void toggleDirectory(path)}
                  onOpenFile={(path) => void openFile(path)}
                />
              )}
            </div>
            <div className="border-t border-slate-200">
              <div className="flex h-10 items-center gap-2 px-3 text-sm font-semibold text-slate-950">
                <File aria-hidden="true" className="h-4 w-4 text-slate-500" />
                预览
              </div>
              <div className="max-h-56 overflow-auto border-t border-slate-100 bg-slate-950 p-3 text-xs text-slate-100">
                {previewLoading ? (
                  <div className="text-slate-400">读取中</div>
                ) : selectedFile ? (
                  <>
                    <div className="mb-2 font-mono text-slate-400">{selectedFile}</div>
                    <pre className="whitespace-pre-wrap break-words">{filePreview}</pre>
                  </>
                ) : (
                  <div className="text-slate-400">选择文件查看内容</div>
                )}
              </div>
            </div>
          </aside>

          <main className="flex min-h-[520px] min-w-0 flex-col rounded-md border border-slate-200 bg-white shadow-sm">
            <div className="flex h-11 items-center justify-between border-b border-slate-200 px-4">
              <div className="inline-flex items-center gap-2 text-sm font-semibold text-slate-950">
                <Bot aria-hidden="true" className="h-4 w-4 text-slate-500" />
                对话
              </div>
              <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-600">
                <input
                  type="checkbox"
                  checked={autoApprove}
                  onChange={(event) => setAutoApprove(event.target.checked)}
                  className="h-4 w-4 rounded border-slate-300"
                />
                本会话自动允许命令
              </label>
            </div>

            <div ref={transcriptRef} className="min-h-0 flex-1 space-y-3 overflow-auto bg-slate-50 p-4">
              {chatItems.length === 0 ? (
                <div className="grid h-full min-h-[300px] place-items-center text-center">
                  <div>
                    <TerminalSquare aria-hidden="true" className="mx-auto h-8 w-8 text-slate-400" />
                    <div className="mt-3 text-sm font-semibold text-slate-700">等待你的任务</div>
                  </div>
                </div>
              ) : (
                chatItems.map((item) => (
                  <ChatTimelineItem key={item.id} item={item} onResolveApproval={resolveApproval} />
                ))
              )}
              {sending ? (
                <div className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-500">
                  <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
                  Agent Loop 运行中
                </div>
              ) : null}
            </div>

            <form onSubmit={(event) => void handleSend(event)} className="border-t border-slate-200 p-3">
              <label htmlFor="desktop-agent-input" className="sr-only">
                Agent 输入
              </label>
              <div className="flex gap-2">
                <textarea
                  id="desktop-agent-input"
                  aria-label="Agent 输入"
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  disabled={sending}
                  rows={2}
                  className="min-h-12 flex-1 resize-none rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200 disabled:cursor-not-allowed disabled:bg-slate-100"
                  placeholder="例如: 建个 hello.py 并运行"
                />
                {sending ? (
                  <button
                    type="button"
                    onClick={() => {
                      stopRequestedRef.current = true;
                    }}
                    className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-md border border-slate-300 text-slate-700 hover:bg-slate-50"
                    aria-label="中止本轮"
                  >
                    <Square aria-hidden="true" className="h-4 w-4" />
                  </button>
                ) : (
                  <button
                    type="submit"
                    disabled={!input.trim()}
                    className="inline-flex h-12 items-center justify-center gap-2 rounded-md bg-slate-900 px-4 text-sm font-semibold text-white shadow-sm hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <Send aria-hidden="true" className="h-4 w-4" />
                    发送
                  </button>
                )}
              </div>
            </form>
          </main>
        </div>
      )}
    </section>
  );
}

function FileTree({
  entries,
  parentPath,
  childrenByPath,
  expandedPaths,
  selectedFile,
  onToggleDirectory,
  onOpenFile
}: {
  entries: string[];
  parentPath: string;
  childrenByPath: Record<string, string[]>;
  expandedPaths: Set<string>;
  selectedFile: string | null;
  onToggleDirectory: (path: string) => void;
  onOpenFile: (path: string) => void;
}) {
  return (
    <ul className={cn("space-y-0.5", parentPath ? "ml-4 border-l border-slate-100 pl-2" : "")}>
      {entries.map((entry) => {
        const isDirectory = entry.endsWith("/");
        const name = trimDirectoryName(entry);
        const path = joinPath(parentPath, name);
        const expanded = expandedPaths.has(path);
        return (
          <li key={path}>
            {isDirectory ? (
              <>
                <button
                  type="button"
                  onClick={() => onToggleDirectory(path)}
                  aria-label={expanded ? `收起 ${name}` : `展开 ${name}`}
                  className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm text-slate-700 hover:bg-slate-100"
                >
                  {expanded ? (
                    <ChevronDown aria-hidden="true" className="h-4 w-4 text-slate-400" />
                  ) : (
                    <ChevronRight aria-hidden="true" className="h-4 w-4 text-slate-400" />
                  )}
                  <Folder aria-hidden="true" className="h-4 w-4 text-slate-500" />
                  <span className="truncate">{name}</span>
                </button>
                {expanded && childrenByPath[path] ? (
                  <FileTree
                    entries={childrenByPath[path]}
                    parentPath={path}
                    childrenByPath={childrenByPath}
                    expandedPaths={expandedPaths}
                    selectedFile={selectedFile}
                    onToggleDirectory={onToggleDirectory}
                    onOpenFile={onOpenFile}
                  />
                ) : null}
              </>
            ) : (
              <button
                type="button"
                onClick={() => onOpenFile(path)}
                className={cn(
                  "flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-slate-100",
                  selectedFile === path ? "bg-slate-900 text-white hover:bg-slate-800" : "text-slate-700"
                )}
              >
                <span className="w-4" aria-hidden="true" />
                <File aria-hidden="true" className="h-4 w-4 shrink-0" />
                <span className="truncate">{name}</span>
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function ChatTimelineItem({
  item,
  onResolveApproval
}: {
  item: ChatItem;
  onResolveApproval: (toolCallId: string, allowed: boolean) => void;
}) {
  if (item.kind === "user" || item.kind === "assistant") {
    const isUser = item.kind === "user";
    return (
      <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
        <div
          className={cn(
            "max-w-[80%] rounded-md px-3 py-2 text-sm shadow-sm",
            isUser ? "bg-slate-900 text-white" : "border border-slate-200 bg-white text-slate-800"
          )}
        >
          <div className="whitespace-pre-wrap break-words">{item.content}</div>
        </div>
      </div>
    );
  }

  if (item.kind === "approval") {
    return (
      <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="font-semibold">允许执行?</div>
            <code className="mt-1 block truncate rounded-md bg-white/70 px-2 py-1 font-mono text-xs text-amber-950">
              {item.command}
            </code>
          </div>
          {item.status === "pending" ? (
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                onClick={() => onResolveApproval(item.toolCallId, true)}
                aria-label={`允许执行 ${item.command}`}
                className="inline-flex h-8 items-center gap-1 rounded-md bg-emerald-600 px-2 text-xs font-semibold text-white hover:bg-emerald-700"
              >
                <Play aria-hidden="true" className="h-3.5 w-3.5" />
                允许
              </button>
              <button
                type="button"
                onClick={() => onResolveApproval(item.toolCallId, false)}
                aria-label={`拒绝执行 ${item.command}`}
                className="inline-flex h-8 items-center gap-1 rounded-md border border-amber-300 bg-white px-2 text-xs font-semibold text-amber-800 hover:bg-amber-100"
              >
                <X aria-hidden="true" className="h-3.5 w-3.5" />
                拒绝
              </button>
            </div>
          ) : (
            <span className="shrink-0 rounded-md border border-amber-200 bg-white px-2 py-1 text-xs font-semibold">
              {item.status === "allowed" ? "已允许" : "已拒绝"}
            </span>
          )}
        </div>
      </div>
    );
  }

  const toolItem = item as Extract<ChatItem, { kind: "tool" }>;

  return (
    <details open className="rounded-md border border-slate-200 bg-white text-sm shadow-sm">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2">
        <div className="inline-flex min-w-0 items-center gap-2">
          {toolItem.name === "run_command" ? (
            <TerminalSquare aria-hidden="true" className="h-4 w-4 shrink-0 text-slate-500" />
          ) : toolItem.name === "write_file" ? (
            <FileDiff aria-hidden="true" className="h-4 w-4 shrink-0 text-slate-500" />
          ) : (
            <File aria-hidden="true" className="h-4 w-4 shrink-0 text-slate-500" />
          )}
          <span className="font-medium text-slate-800">{toolLabel(toolItem.name)}</span>
          <span className="truncate font-mono text-xs text-slate-500">{toolItem.title}</span>
        </div>
        <span className={cn("shrink-0 rounded-md border px-2 py-1 text-xs font-semibold", statusClass(toolItem.status))}>
          {statusLabel(toolItem.status)}
        </span>
      </summary>
      <div className="space-y-3 border-t border-slate-100 p-3">
        {toolItem.diff ? <DiffView diff={toolItem.diff} /> : null}
        {toolItem.output !== undefined ? <ToolOutput output={toolItem.output} /> : null}
      </div>
    </details>
  );
}

function toolLabel(name: DesktopToolName) {
  if (name === "run_command") return "命令";
  if (name === "write_file") return "写文件";
  if (name === "read_file") return "读文件";
  return "列文件";
}

function ToolOutput({ output }: { output: unknown }) {
  if (typeof output === "string") {
    return <pre className="whitespace-pre-wrap break-words rounded-md bg-slate-950 p-3 text-xs text-slate-100">{output}</pre>;
  }
  if (isCommandOutput(output)) {
    return (
      <div className="space-y-2">
        <div className="font-mono text-xs text-slate-500">exit_code: {output.exit_code}</div>
        {output.stdout ? (
          <pre className="whitespace-pre-wrap break-words rounded-md bg-slate-950 p-3 text-xs text-slate-100">
            {output.stdout}
          </pre>
        ) : null}
        {output.stderr ? (
          <pre className="whitespace-pre-wrap break-words rounded-md bg-rose-950 p-3 text-xs text-rose-50">
            {output.stderr}
          </pre>
        ) : null}
      </div>
    );
  }
  if (isErrorOutput(output)) {
    return (
      <div className="space-y-2 rounded-md bg-amber-100 px-3 py-2 text-sm text-amber-900">
        {output.code ? <div className="font-mono text-xs font-semibold">{output.code}</div> : null}
        <div>{output.error}</div>
        {typeof output.status === "number" ? <div className="font-mono text-xs">status: {output.status}</div> : null}
      </div>
    );
  }
  return (
    <pre className="whitespace-pre-wrap break-words rounded-md bg-slate-950 p-3 text-xs text-slate-100">
      {JSON.stringify(output, null, 2)}
    </pre>
  );
}

function isCommandOutput(output: unknown): output is { exit_code: number; stdout: string; stderr: string } {
  return (
    typeof output === "object" &&
    output !== null &&
    "exit_code" in output &&
    "stdout" in output &&
    "stderr" in output
  );
}

function isErrorOutput(output: unknown): output is { error: string; code?: string; status?: number } {
  return typeof output === "object" && output !== null && "error" in output;
}

function DiffView({ diff }: { diff: WriteDiff }) {
  const rows = useMemo(() => buildDiffRows(diff), [diff]);
  return (
    <div className="overflow-hidden rounded-md border border-slate-200">
      <div className="border-b border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs text-slate-600">
        {diff.path}
      </div>
      <pre className="max-h-72 overflow-auto bg-slate-950 p-3 text-xs leading-5 text-slate-100">
        {rows.map((row, index) => (
          <div
            key={`${row.kind}_${index}_${row.text}`}
            className={cn(
              row.kind === "add" ? "text-emerald-300" : row.kind === "remove" ? "text-rose-300" : "text-slate-300"
            )}
          >
            {row.prefix} {row.text}
          </div>
        ))}
      </pre>
    </div>
  );
}

function buildDiffRows(diff: WriteDiff): Array<{ kind: "add" | "remove" | "same"; prefix: string; text: string }> {
  const beforeLines = diff.before.split("\n").filter((line, index, lines) => line.length > 0 || index < lines.length - 1);
  const afterLines = diff.after.split("\n").filter((line, index, lines) => line.length > 0 || index < lines.length - 1);
  if (diff.before === diff.after) {
    return afterLines.map((line) => ({ kind: "same", prefix: " ", text: line }));
  }
  return [
    ...beforeLines.map((line) => ({ kind: "remove" as const, prefix: "-", text: line })),
    ...afterLines.map((line) => ({ kind: "add" as const, prefix: "+", text: line }))
  ];
}
