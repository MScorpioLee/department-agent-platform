"use client";

import React, { FormEvent, Fragment, useCallback, useEffect, useState } from "react";
import { ChevronDown, RefreshCw, ShieldAlert } from "lucide-react";

import {
  getAuditCommands,
  getAuditSessions,
  getAuditToolCalls,
  getAuditUsage,
  getMe
} from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { formatRelativeTime } from "@/lib/format";
import type { AuditCommand, AuditSession, AuditToolCall, AuditUsage, User } from "@/lib/types";

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "请求失败";
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function JsonBlock({ value }: { value: unknown }) {
  return (
    <pre className="max-h-44 overflow-auto rounded-md bg-slate-950 p-3 font-mono text-xs leading-5 text-slate-100">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function OutputDetails({ title, children }: { title: string; children: string }) {
  return (
    <details className="rounded-md border border-slate-200 bg-slate-50">
      <summary className="cursor-pointer px-3 py-2 text-xs font-semibold uppercase text-slate-500">
        {title}
      </summary>
      <pre className="max-h-44 overflow-auto border-t border-slate-200 bg-slate-950 p-3 font-mono text-xs leading-5 text-slate-100">
        {children || " "}
      </pre>
    </details>
  );
}

export default function AuditPage() {
  const [user, setUser] = useState<User | null>(null);
  const [checkingRole, setCheckingRole] = useState(true);
  const [usage, setUsage] = useState<AuditUsage | null>(null);
  const [sessions, setSessions] = useState<AuditSession[]>([]);
  const [commands, setCommands] = useState<AuditCommand[]>([]);
  const [toolCallsBySession, setToolCallsBySession] = useState<Record<string, AuditToolCall[]>>({});
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null);
  const [userFilter, setUserFilter] = useState("");
  const [machineFilter, setMachineFilter] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toolCallError, setToolCallError] = useState<string | null>(null);

  const isAdmin = user?.role === "admin";

  const refreshAuditData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [usageData, sessionData, commandData] = await Promise.all([
        getAuditUsage(userFilter.trim() || undefined),
        getAuditSessions({ userId: userFilter.trim() || undefined, limit: 50 }),
        getAuditCommands({ machineId: machineFilter.trim() || undefined, limit: 50 })
      ]);
      setUsage(usageData);
      setSessions(sessionData);
      setCommands(commandData);
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }, [machineFilter, userFilter]);

  useEffect(() => {
    let cancelled = false;

    getMe()
      .then((currentUser) => {
        if (cancelled) return;
        setUser(currentUser);
        if (currentUser.role === "admin") {
          void refreshAuditData();
        }
      })
      .catch((requestError) => {
        if (!cancelled) {
          setError(getErrorMessage(requestError));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setCheckingRole(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [refreshAuditData]);

  async function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setExpandedSessionId(null);
    setToolCallsBySession({});
    await refreshAuditData();
  }

  async function toggleSession(sessionId: string) {
    if (expandedSessionId === sessionId) {
      setExpandedSessionId(null);
      return;
    }

    setExpandedSessionId(sessionId);
    setToolCallError(null);

    if (toolCallsBySession[sessionId]) return;

    try {
      const toolCalls = await getAuditToolCalls({ sessionId, limit: 50 });
      setToolCallsBySession((current) => ({ ...current, [sessionId]: toolCalls }));
    } catch (requestError) {
      setToolCallError(getErrorMessage(requestError));
    }
  }

  if (checkingRole) {
    return <div className="text-sm text-slate-500">加载中</div>;
  }

  if (!isAdmin) {
    return (
      <section className="rounded-md border border-amber-200 bg-amber-50 p-5 text-amber-800">
        <div className="flex items-center gap-2 text-base font-semibold">
          <ShieldAlert aria-hidden="true" className="h-5 w-5" />
          需要管理员权限
        </div>
        <p className="mt-2 text-sm">当前账号没有访问审计后台的权限。</p>
      </section>
    );
  }

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-normal text-slate-950">审计后台</h1>
          <p className="mt-1 text-sm text-slate-500">用量、会话、工具调用与命令记录</p>
        </div>
        <button
          type="button"
          onClick={() => void refreshAuditData()}
          className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
        >
          <RefreshCw aria-hidden="true" className={cn("h-4 w-4", loading && "animate-spin")} />
          刷新
        </button>
      </div>

      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <form
        onSubmit={(event) => void applyFilters(event)}
        className="grid gap-3 rounded-md border border-slate-200 bg-white p-4 shadow-sm md:grid-cols-[1fr_1fr_auto]"
      >
        <label className="block space-y-1.5">
          <span className="text-sm font-medium text-slate-700">user_id</span>
          <input
            value={userFilter}
            onChange={(event) => setUserFilter(event.target.value)}
            placeholder="全部用户"
            className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-slate-900 focus:ring-2 focus:ring-slate-200"
          />
        </label>
        <label className="block space-y-1.5">
          <span className="text-sm font-medium text-slate-700">machine_id</span>
          <input
            value={machineFilter}
            onChange={(event) => setMachineFilter(event.target.value)}
            placeholder="全部机器"
            className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-slate-900 focus:ring-2 focus:ring-slate-200"
          />
        </label>
        <button
          type="submit"
          className="inline-flex h-10 items-center justify-center gap-2 self-end rounded-md bg-slate-900 px-4 text-sm font-semibold text-white shadow-sm hover:bg-slate-700"
        >
          应用过滤
        </button>
      </form>

      <div className="grid gap-5 xl:grid-cols-[0.8fr_1.2fr]">
        <section className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-sm font-semibold text-slate-950">Token 用量</div>
          <div className="mt-3 text-3xl font-semibold text-slate-950">
            {formatNumber(usage?.total_tokens ?? 0)}
          </div>
          <div className="mt-1 text-xs text-slate-500">total_tokens</div>

          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">User</th>
                  <th className="px-3 py-2">Backend</th>
                  <th className="px-3 py-2 text-right">Prompt</th>
                  <th className="px-3 py-2 text-right">Completion</th>
                  <th className="px-3 py-2 text-right">Total</th>
                  <th className="px-3 py-2 text-right">Turns</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(usage?.by_user_backend ?? []).map((row) => (
                  <tr key={`${row.user_id}-${row.backend_id}`}>
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-slate-700">
                      {row.user_id}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-slate-700">{row.backend_id}</td>
                    <td className="px-3 py-2 text-right text-slate-600">
                      {formatNumber(row.prompt_tokens)}
                    </td>
                    <td className="px-3 py-2 text-right text-slate-600">
                      {formatNumber(row.completion_tokens)}
                    </td>
                    <td className="px-3 py-2 text-right font-medium text-slate-900">
                      {formatNumber(row.total_tokens)}
                    </td>
                    <td className="px-3 py-2 text-right text-slate-600">{formatNumber(row.turns)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-4 py-3">
            <h2 className="text-base font-semibold text-slate-950">会话</h2>
            <p className="mt-1 text-xs text-slate-500">点击会话查看工具调用</p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Title</th>
                  <th className="px-4 py-3">User</th>
                  <th className="px-4 py-3">Machine</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Messages</th>
                  <th className="px-4 py-3">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sessions.map((session) => (
                  <Fragment key={session.session_id}>
                    <tr
                      className="cursor-pointer hover:bg-slate-50"
                      onClick={() => void toggleSession(session.session_id)}
                    >
                      <td className="min-w-48 px-4 py-3">
                        <div className="flex items-center gap-2 font-medium text-slate-900">
                          <ChevronDown
                            aria-hidden="true"
                            className={cn(
                              "h-4 w-4 text-slate-400 transition",
                              expandedSessionId === session.session_id && "rotate-180"
                            )}
                          />
                          {session.title}
                        </div>
                        <div className="mt-1 font-mono text-xs text-slate-500">
                          {session.session_id}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-slate-600">
                        {session.user_id}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-slate-600">
                        {session.machine_id}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-600">{session.status}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                        {session.message_count}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                        {formatRelativeTime(session.created_at)}
                      </td>
                    </tr>
                    {expandedSessionId === session.session_id ? (
                      <tr>
                        <td className="bg-slate-50 px-4 py-4" colSpan={6}>
                          {toolCallError ? (
                            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                              {toolCallError}
                            </div>
                          ) : (
                            <div className="grid gap-3">
                              {(toolCallsBySession[session.session_id] ?? []).map((call) => (
                                <div
                                  key={call.id}
                                  className="grid gap-3 rounded-md border border-slate-200 bg-white p-3 lg:grid-cols-[0.8fr_1fr_1fr]"
                                >
                                  <div>
                                    <div className="font-medium text-slate-900">{call.tool_name}</div>
                                    <div className="mt-1 text-xs text-slate-500">
                                      {call.status} / {formatRelativeTime(call.created_at)}
                                    </div>
                                  </div>
                                  <JsonBlock value={call.arguments} />
                                  <JsonBlock value={call.result} />
                                </div>
                              ))}
                              {(toolCallsBySession[session.session_id] ?? []).length === 0 ? (
                                <div className="text-sm text-slate-500">暂无工具调用</div>
                              ) : null}
                            </div>
                          )}
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <section className="overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-4 py-3">
          <h2 className="text-base font-semibold text-slate-950">命令执行</h2>
          <p className="mt-1 text-xs text-slate-500">remote_exec 审计记录</p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Task</th>
                <th className="px-4 py-3">Machine</th>
                <th className="px-4 py-3">Command</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Exit</th>
                <th className="px-4 py-3">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {commands.map((command) => (
                <tr key={command.task_id} className="align-top">
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-slate-700">
                    {command.task_id}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-slate-600">
                    {command.machine_id}
                  </td>
                  <td className="min-w-72 px-4 py-3">
                    <div className="font-mono text-xs text-slate-900">{command.command}</div>
                    <div className="mt-2 grid gap-2">
                      <OutputDetails title="stdout">{command.stdout}</OutputDetails>
                      <OutputDetails title="stderr">{command.stderr}</OutputDetails>
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-600">{command.status}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                    {command.exit_code ?? "-"}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                    {formatRelativeTime(command.created_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}
