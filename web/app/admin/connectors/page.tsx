"use client";

import { Loader2, Plug, RefreshCw, ShieldAlert, Trash2 } from "lucide-react";
import React, { FormEvent, useCallback, useEffect, useState } from "react";

import { AdminGuard } from "@/components/admin-guard";
import {
  createConnector,
  deleteConnector,
  listConnectors,
  listUsers,
  putConnectorScope,
  updateConnector
} from "@/lib/api-client";
import { cn } from "@/lib/cn";
import type { Connector, ConnectorTransport, UpdateConnectorRequest, User } from "@/lib/types";

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "请求失败";
}

function parseLines(value: string) {
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseEnv(value: string) {
  return Object.fromEntries(
    parseLines(value)
      .map((line) => {
        const index = line.indexOf("=");
        if (index <= 0) return null;
        return [line.slice(0, index).trim(), line.slice(index + 1)] as const;
      })
      .filter((entry): entry is readonly [string, string] => Boolean(entry?.[0]))
  );
}

function statusClass(status: string) {
  if (status === "connected") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status.startsWith("error")) return "border-red-200 bg-red-50 text-red-700";
  if (status === "disabled") return "border-slate-200 bg-slate-50 text-slate-500";
  return "border-amber-200 bg-amber-50 text-amber-700";
}

function scopeLabel(connector: Connector) {
  return connector.scope_all ? "全员" : `${connector.scopes.length} 个用户`;
}

function AdminConnectorsContent() {
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [transport, setTransport] = useState<ConnectorTransport>("stdio");
  const [command, setCommand] = useState("");
  const [argsText, setArgsText] = useState("");
  const [url, setUrl] = useState("");
  const [envText, setEnvText] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [scopeAll, setScopeAll] = useState(false);
  const [scopeConnectorId, setScopeConnectorId] = useState("");
  const [scopeUserId, setScopeUserId] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [nextConnectors, nextUsers] = await Promise.all([listConnectors(), listUsers()]);
      setConnectors(nextConnectors);
      setUsers(nextUsers);
      setScopeConnectorId((current) => current || nextConnectors[0]?.id || "");
      setScopeUserId((current) => current || nextUsers[0]?.id || "");
      setError(null);
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  function resetForm() {
    setEditingId(null);
    setName("");
    setTransport("stdio");
    setCommand("");
    setArgsText("");
    setUrl("");
    setEnvText("");
    setEnabled(true);
    setScopeAll(false);
  }

  function startEdit(connector: Connector) {
    setEditingId(connector.id);
    setName(connector.name);
    setTransport(connector.transport);
    setCommand(connector.command ?? "");
    setArgsText((connector.args ?? []).join("\n"));
    setUrl(connector.url ?? "");
    setEnvText("");
    setEnabled(connector.enabled);
    setScopeAll(connector.scope_all);
    setMessage(null);
  }

  async function submitConnector(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsedEnv = parseEnv(envText);
    const env = Object.keys(parsedEnv).length > 0 ? parsedEnv : undefined;

    setSubmitting(true);
    setError(null);
    setMessage(null);
    try {
      if (editingId) {
        const payload: UpdateConnectorRequest = {
          name: name.trim(),
          transport,
          enabled,
          scope_all: scopeAll
        };
        if (transport === "stdio") {
          payload.command = command.trim();
          payload.args = parseLines(argsText);
        } else {
          payload.url = url.trim();
        }
        if (env) payload.env = env;
        await updateConnector(editingId, payload);
        setMessage("连接器已保存");
      } else {
        await createConnector({
          name: name.trim(),
          transport,
          ...(transport === "stdio"
            ? { command: command.trim(), args: parseLines(argsText) }
            : { url: url.trim() }),
          ...(env ? { env } : {}),
          scope_all: scopeAll,
          enabled
        });
        setMessage("连接器已创建");
      }
      resetForm();
      await refresh();
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleConnector(connector: Connector) {
    setError(null);
    setMessage(null);
    try {
      await updateConnector(connector.id, { enabled: !connector.enabled });
      await refresh();
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    }
  }

  async function removeConnector(connector: Connector) {
    setError(null);
    setMessage(null);
    try {
      await deleteConnector(connector.id);
      setMessage("连接器已删除");
      await refresh();
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    }
  }

  async function saveScope(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!scopeConnectorId) return;
    setError(null);
    setMessage(null);
    try {
      await putConnectorScope(scopeConnectorId, scopeUserId ? [scopeUserId] : []);
      setMessage("作用域已保存");
      await refresh();
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    }
  }

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-normal text-slate-950">连接器管理</h1>
          <p className="mt-1 text-sm text-slate-500">配置 MCP server、状态和授权作用域</p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
        >
          <RefreshCw aria-hidden="true" className={cn("h-4 w-4", loading && "animate-spin")} />
          刷新
        </button>
      </div>

      <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <div className="flex items-center gap-2 font-semibold">
          <ShieldAlert aria-hidden="true" className="h-4 w-4" />
          连接器会在服务端运行你提供的第三方程序，仅管理员可配置，请确认来源可信
        </div>
      </div>

      {error ? <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
      {message ? <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">{message}</div> : null}

      <div className="grid gap-5 xl:grid-cols-[380px_1fr]">
        <aside className="space-y-5">
          <form onSubmit={(event) => void submitConnector(event)} className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-2 text-base font-semibold text-slate-950">
              <Plug aria-hidden="true" className="h-5 w-5 text-slate-500" />
              {editingId ? "编辑连接器" : "新建连接器"}
            </div>
            <div className="mt-4 space-y-3">
              <label className="block space-y-1.5">
                <span className="text-sm font-medium text-slate-700">连接器名称</span>
                <input required value={name} onChange={(event) => setName(event.target.value)} className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 shadow-sm outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200" />
              </label>
              <label className="block space-y-1.5">
                <span className="text-sm font-medium text-slate-700">传输</span>
                <select value={transport} onChange={(event) => setTransport(event.target.value as ConnectorTransport)} className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 shadow-sm outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200">
                  <option value="stdio">stdio</option>
                  <option value="http">http</option>
                </select>
              </label>
              {transport === "stdio" ? (
                <>
                  <label className="block space-y-1.5">
                    <span className="text-sm font-medium text-slate-700">Command</span>
                    <input required value={command} onChange={(event) => setCommand(event.target.value)} className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 shadow-sm outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200" />
                  </label>
                  <label className="block space-y-1.5">
                    <span className="text-sm font-medium text-slate-700">Args</span>
                    <textarea value={argsText} onChange={(event) => setArgsText(event.target.value)} rows={3} className="w-full resize-y rounded-md border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-950 shadow-sm outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200" />
                  </label>
                </>
              ) : (
                <label className="block space-y-1.5">
                  <span className="text-sm font-medium text-slate-700">URL</span>
                  <input required value={url} onChange={(event) => setUrl(event.target.value)} className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 shadow-sm outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200" />
                </label>
              )}
              <label className="block space-y-1.5">
                <span className="text-sm font-medium text-slate-700">Env</span>
                <textarea value={envText} onChange={(event) => setEnvText(event.target.value)} rows={3} placeholder={editingId ? "留空保持原 env" : "KEY=value"} className="w-full resize-y rounded-md border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-950 shadow-sm outline-none placeholder:text-slate-400 focus:border-slate-900 focus:ring-2 focus:ring-slate-200" />
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} className="h-4 w-4 rounded border-slate-300" />
                启用
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={scopeAll} onChange={(event) => setScopeAll(event.target.checked)} className="h-4 w-4 rounded border-slate-300" />
                全员可用
              </label>
              <div className="flex gap-2">
                <button type="submit" disabled={submitting} className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-md bg-slate-900 px-4 text-sm font-semibold text-white shadow-sm hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60">
                  {submitting ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : null}
                  {editingId ? "保存连接器" : "新建连接器"}
                </button>
                {editingId ? (
                  <button type="button" onClick={resetForm} className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50">
                    取消
                  </button>
                ) : null}
              </div>
            </div>
          </form>

          <form onSubmit={(event) => void saveScope(event)} className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-base font-semibold text-slate-950">作用域</h2>
            <div className="mt-4 space-y-3">
              <label className="block space-y-1.5">
                <span className="text-sm font-medium text-slate-700">作用域连接器</span>
                <select value={scopeConnectorId} onChange={(event) => setScopeConnectorId(event.target.value)} className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 shadow-sm outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200">
                  {connectors.map((connector) => (
                    <option key={connector.id} value={connector.id}>
                      {connector.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block space-y-1.5">
                <span className="text-sm font-medium text-slate-700">授权用户</span>
                <select value={scopeUserId} onChange={(event) => setScopeUserId(event.target.value)} className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 shadow-sm outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200">
                  <option value="">无指定用户</option>
                  {users.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.display_name || user.username} ({user.id})
                    </option>
                  ))}
                </select>
              </label>
              <button type="submit" className="inline-flex h-10 w-full items-center justify-center rounded-md bg-slate-900 px-4 text-sm font-semibold text-white shadow-sm hover:bg-slate-700">
                保存作用域
              </button>
            </div>
          </form>
        </aside>

        <section className="overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-4 py-3">
            <h2 className="text-base font-semibold text-slate-950">连接器</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">名称</th>
                  <th className="px-4 py-3">传输</th>
                  <th className="px-4 py-3">入口</th>
                  <th className="px-4 py-3">env_keys</th>
                  <th className="px-4 py-3">状态</th>
                  <th className="px-4 py-3">工具数</th>
                  <th className="px-4 py-3">作用域</th>
                  <th className="px-4 py-3">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td className="px-4 py-8 text-center text-slate-500" colSpan={8}>
                      加载中
                    </td>
                  </tr>
                ) : connectors.length === 0 ? (
                  <tr>
                    <td className="px-4 py-8 text-center text-slate-500" colSpan={8}>
                      暂无连接器
                    </td>
                  </tr>
                ) : (
                  connectors.map((connector) => (
                    <tr key={connector.id} className="hover:bg-slate-50">
                      <td className="whitespace-nowrap px-4 py-4 font-medium text-slate-950">{connector.name}</td>
                      <td className="whitespace-nowrap px-4 py-4 text-slate-600">{connector.transport}</td>
                      <td className="whitespace-nowrap px-4 py-4 font-mono text-xs text-slate-600">{connector.transport === "stdio" ? connector.command : connector.url}</td>
                      <td className="whitespace-nowrap px-4 py-4 font-mono text-xs text-slate-600">{connector.env_keys.length > 0 ? connector.env_keys.join(", ") : "-"}</td>
                      <td className="whitespace-nowrap px-4 py-4">
                        <span title={connector.status} className={cn("rounded-md border px-2 py-1 text-xs", statusClass(connector.status))}>
                          {connector.status}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-4 text-slate-600">{connector.tool_count}</td>
                      <td className="whitespace-nowrap px-4 py-4 text-slate-600">{scopeLabel(connector)}</td>
                      <td className="whitespace-nowrap px-4 py-4">
                        <div className="flex flex-wrap gap-2">
                          <button type="button" onClick={() => startEdit(connector)} className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50">
                            编辑 {connector.name}
                          </button>
                          <button type="button" onClick={() => void toggleConnector(connector)} className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50">
                            {connector.enabled ? "停用" : "启用"}
                          </button>
                          <button type="button" onClick={() => void removeConnector(connector)} aria-label={`删除 ${connector.name}`} className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-red-200 text-red-600 hover:bg-red-50">
                            <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </section>
  );
}

export default function ConnectorsPage() {
  return (
    <AdminGuard>
      <AdminConnectorsContent />
    </AdminGuard>
  );
}
