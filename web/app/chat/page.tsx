"use client";

import { Loader2, MessageSquareText, RefreshCw, Send, ShieldAlert } from "lucide-react";
import Link from "next/link";
import React, { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import {
  createSession,
  getSessionMessages,
  listMachines,
  sendSessionMessage
} from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { formatDateTime, formatRelativeTime } from "@/lib/format";
import type { ChatMessage, CreateSessionResponse, Machine, ToolCall } from "@/lib/types";
import { MachineStatusBadge } from "@/components/status-badge";

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "请求失败";
}

function JsonBlock({ value }: { value: unknown }) {
  return (
    <pre className="max-h-56 overflow-auto rounded-md bg-slate-950 p-3 font-mono text-xs leading-5 text-slate-100">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function isApprovalResult(value: unknown): value is { needs_approval: true; approval_id?: string; risk_rule?: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { needs_approval?: unknown }).needs_approval === true
  );
}

function ToolCallPanel({ call }: { call: ToolCall }) {
  return (
    <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="font-mono text-sm font-semibold text-slate-950">{call.name}</div>
        <div className="font-mono text-xs text-slate-500">{call.id}</div>
      </div>
      <JsonBlock value={call.arguments} />
    </div>
  );
}

function ToolResult({ message }: { message: ChatMessage }) {
  const parsed = parseJson(message.content);
  const approval = isApprovalResult(parsed) ? parsed : null;

  return (
    <div className="rounded-md border border-slate-200 bg-white p-3 shadow-sm">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="font-mono text-xs font-semibold uppercase text-slate-500">
          tool result {message.tool_call_id ? `· ${message.tool_call_id}` : ""}
        </div>
        <time className="text-xs text-slate-400" dateTime={message.created_at}>
          {formatDateTime(message.created_at)}
        </time>
      </div>
      {approval ? (
        <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <div className="flex items-center gap-2 font-semibold">
            <ShieldAlert aria-hidden="true" className="h-4 w-4" />
            该操作需审批
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
            {approval.approval_id ? <span>approval_id: {approval.approval_id}</span> : null}
            {approval.risk_rule ? <span>risk_rule: {approval.risk_rule}</span> : null}
            <Link href="/approvals" className="font-semibold text-amber-950 underline underline-offset-2">
              去审批
            </Link>
          </div>
        </div>
      ) : null}
      <details className="rounded-md border border-slate-200 bg-slate-50">
        <summary className="cursor-pointer px-3 py-2 text-xs font-semibold uppercase text-slate-500">
          JSON
        </summary>
        <pre className="max-h-56 overflow-auto border-t border-slate-200 bg-slate-950 p-3 font-mono text-xs leading-5 text-slate-100">
          {parsed === null ? message.content : JSON.stringify(parsed, null, 2)}
        </pre>
      </details>
    </div>
  );
}

function ChatBubble({ message }: { message: ChatMessage }) {
  if (message.role === "tool") {
    return (
      <div className="flex justify-center">
        <div className="w-full max-w-3xl">
          <ToolResult message={message} />
        </div>
      </div>
    );
  }

  const isUser = message.role === "user";

  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-3xl rounded-md border px-4 py-3 shadow-sm",
          isUser
            ? "border-slate-900 bg-slate-900 text-white"
            : "border-slate-200 bg-white text-slate-900"
        )}
      >
        <div className="mb-1 flex items-center justify-between gap-3 text-xs">
          <span className={cn("font-semibold uppercase", isUser ? "text-slate-200" : "text-slate-500")}>
            {isUser ? "user" : "assistant"}
          </span>
          <time className={cn(isUser ? "text-slate-300" : "text-slate-400")} dateTime={message.created_at}>
            {formatDateTime(message.created_at)}
          </time>
        </div>
        {message.content ? (
          <div className="whitespace-pre-wrap text-sm leading-6">{message.content}</div>
        ) : null}
        {message.tool_calls?.map((call) => <ToolCallPanel key={call.id} call={call} />)}
      </div>
    </div>
  );
}

export default function ChatPage() {
  const [machines, setMachines] = useState<Machine[]>([]);
  const [selectedMachineId, setSelectedMachineId] = useState("");
  const [title, setTitle] = useState("");
  const [messageContent, setMessageContent] = useState("");
  const [session, setSession] = useState<CreateSessionResponse | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadingMachines, setLoadingMachines] = useState(true);
  const [creatingSession, setCreatingSession] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onlineMachines = useMemo(
    () => machines.filter((machine) => machine.status === "online"),
    [machines]
  );
  const selectedMachine = machines.find((machine) => machine.machine_id === selectedMachineId);

  const refreshMachines = useCallback(async () => {
    try {
      const items = await listMachines();
      setMachines(items);
      setError(null);
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setLoadingMachines(false);
    }
  }, []);

  useEffect(() => {
    void refreshMachines();
    const interval = window.setInterval(() => void refreshMachines(), 5000);
    return () => window.clearInterval(interval);
  }, [refreshMachines]);

  useEffect(() => {
    if (onlineMachines.length === 0) {
      setSelectedMachineId("");
      return;
    }
    if (onlineMachines.some((machine) => machine.machine_id === selectedMachineId)) return;
    setSelectedMachineId(onlineMachines[0].machine_id);
  }, [onlineMachines, selectedMachineId]);

  async function handleCreateSession(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedMachineId) return;

    setCreatingSession(true);
    setError(null);
    try {
      const created = await createSession({
        machine_id: selectedMachineId,
        ...(title.trim() ? { title: title.trim() } : {})
      });
      setSession(created);
      setMessages([]);
      setMessageContent("");
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setCreatingSession(false);
    }
  }

  async function handleSendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session || !messageContent.trim()) return;

    const content = messageContent.trim();
    setSending(true);
    setError(null);
    try {
      await sendSessionMessage(session.session_id, content);
      const nextMessages = await getSessionMessages(session.session_id);
      setMessages(nextMessages);
      setMessageContent("");
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-normal text-slate-950">对话</h1>
          <p className="mt-1 text-sm text-slate-500">选择在线机器后发起模型会话并查看工具执行过程</p>
        </div>
        <button
          type="button"
          onClick={() => void refreshMachines()}
          className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
        >
          <RefreshCw aria-hidden="true" className={cn("h-4 w-4", loadingMachines && "animate-spin")} />
          刷新机器
        </button>
      </div>

      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[360px_1fr]">
        <aside className="space-y-4">
          <form
            onSubmit={(event) => void handleCreateSession(event)}
            className="rounded-md border border-slate-200 bg-white p-4 shadow-sm"
          >
            <div className="flex items-center gap-2 text-base font-semibold text-slate-950">
              <MessageSquareText aria-hidden="true" className="h-5 w-5 text-slate-500" />
              新建会话
            </div>
            <div className="mt-4 space-y-3">
              <label className="block space-y-1.5">
                <span className="text-sm font-medium text-slate-700">机器</span>
                <select
                  value={selectedMachineId}
                  onChange={(event) => setSelectedMachineId(event.target.value)}
                  disabled={onlineMachines.length === 0}
                  className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 shadow-sm outline-none transition focus:border-slate-900 focus:ring-2 focus:ring-slate-200 disabled:cursor-not-allowed disabled:bg-slate-100"
                >
                  {onlineMachines.length === 0 ? (
                    <option value="">暂无在线机器</option>
                  ) : (
                    onlineMachines.map((machine) => (
                      <option key={machine.machine_id} value={machine.machine_id}>
                        {machine.machine_name} ({machine.machine_id})
                      </option>
                    ))
                  )}
                </select>
              </label>
              <label className="block space-y-1.5">
                <span className="text-sm font-medium text-slate-700">标题</span>
                <input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="可选"
                  className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-slate-900 focus:ring-2 focus:ring-slate-200"
                />
              </label>
              <button
                type="submit"
                disabled={!selectedMachineId || creatingSession}
                className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-slate-900 px-4 text-sm font-semibold text-white shadow-sm hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {creatingSession ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : null}
                新建会话
              </button>
            </div>
          </form>

          <div className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
            <div className="text-sm font-semibold text-slate-950">当前机器</div>
            {selectedMachine ? (
              <div className="mt-3 space-y-2 text-sm">
                <div className="font-medium text-slate-950">{selectedMachine.machine_name}</div>
                <div className="font-mono text-xs text-slate-500">{selectedMachine.machine_id}</div>
                <div className="flex items-center gap-2">
                  <MachineStatusBadge status={selectedMachine.status} />
                  <span className="text-xs text-slate-500">{formatRelativeTime(selectedMachine.last_seen_at)}</span>
                </div>
              </div>
            ) : (
              <div className="mt-3 text-sm text-slate-500">暂无在线机器</div>
            )}
          </div>
        </aside>

        <section className="min-h-[620px] rounded-md border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-base font-semibold text-slate-950">会话时间线</h2>
                <p className="mt-1 text-xs text-slate-500">
                  {session ? `session_id: ${session.session_id}` : "请先新建会话"}
                </p>
              </div>
              {session ? (
                <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-600">
                  {session.status}
                </span>
              ) : null}
            </div>
          </div>

          <div className="flex min-h-[470px] flex-col gap-4 px-4 py-5">
            {messages.length === 0 ? (
              <div className="flex flex-1 items-center justify-center rounded-md border border-dashed border-slate-200 bg-slate-50 p-8 text-center text-sm text-slate-500">
                {session ? "发送第一条消息后，这里会展示 user / assistant / tool 时间线。" : "等待创建会话"}
              </div>
            ) : (
              messages.map((message) => <ChatBubble key={`${message.seq}-${message.role}`} message={message} />)
            )}
          </div>

          <form onSubmit={(event) => void handleSendMessage(event)} className="border-t border-slate-200 p-4">
            <label className="block space-y-1.5">
              <span className="text-sm font-medium text-slate-700">消息内容</span>
              <textarea
                value={messageContent}
                onChange={(event) => setMessageContent(event.target.value)}
                rows={3}
                placeholder="输入要让模型执行的任务"
                className="w-full resize-y rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-slate-900 focus:ring-2 focus:ring-slate-200"
              />
            </label>
            <div className="mt-3 flex justify-end">
              <button
                type="submit"
                disabled={!session || !messageContent.trim() || sending}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-slate-900 px-4 text-sm font-semibold text-white shadow-sm hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {sending ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : <Send aria-hidden="true" className="h-4 w-4" />}
                {sending ? "模型执行中…" : "发送"}
              </button>
            </div>
          </form>
        </section>
      </div>
    </section>
  );
}
