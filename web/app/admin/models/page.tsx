"use client";

import { Bot, Loader2, RefreshCw, Trash2 } from "lucide-react";
import React, { FormEvent, useCallback, useEffect, useState } from "react";

import { AdminGuard } from "@/components/admin-guard";
import {
  createModelBackend,
  deleteModelBackend,
  listModelBackends,
  listModelRoutes,
  listUsers,
  putModelRoute,
  updateModelBackend
} from "@/lib/api-client";
import { cn } from "@/lib/cn";
import type { ModelBackend, ModelRoute, UpdateModelBackendRequest, User } from "@/lib/types";

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "请求失败";
}

function routeLabel(routes: ModelRoute[], users: User[], backendId: string) {
  const names = routes
    .filter((route) => route.backend_id === backendId)
    .map((route) => users.find((user) => user.id === route.user_id)?.username ?? route.user_id);
  return names.length > 0 ? names.join(", ") : "-";
}

function AdminModelsContent() {
  const [backends, setBackends] = useState<ModelBackend[]>([]);
  const [routes, setRoutes] = useState<ModelRoute[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [maxConcurrency, setMaxConcurrency] = useState("2");
  const [enabled, setEnabled] = useState(true);
  const [isDefault, setIsDefault] = useState(false);
  const [routeUserId, setRouteUserId] = useState("");
  const [routeBackendId, setRouteBackendId] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [nextBackends, nextRoutes, nextUsers] = await Promise.all([
        listModelBackends(),
        listModelRoutes(),
        listUsers()
      ]);
      setBackends(nextBackends);
      setRoutes(nextRoutes);
      setUsers(nextUsers);
      setRouteUserId((current) => current || nextUsers[0]?.id || "");
      setRouteBackendId((current) => (current === "" ? "" : current || nextBackends[0]?.id || ""));
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
    setBaseUrl("");
    setModel("");
    setApiKey("");
    setMaxConcurrency("2");
    setEnabled(true);
    setIsDefault(false);
  }

  function startEdit(backend: ModelBackend) {
    setEditingId(backend.id);
    setName(backend.name);
    setBaseUrl(backend.base_url);
    setModel(backend.model);
    setApiKey("");
    setMaxConcurrency(String(backend.max_concurrency));
    setEnabled(backend.enabled);
    setIsDefault(backend.is_default);
    setMessage(null);
  }

  async function submitBackend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedConcurrency = Number(maxConcurrency);
    if (!Number.isFinite(normalizedConcurrency) || normalizedConcurrency <= 0) return;

    setSubmitting(true);
    setError(null);
    setMessage(null);
    try {
      if (editingId) {
        const payload: UpdateModelBackendRequest = {
          name: name.trim(),
          base_url: baseUrl.trim(),
          model: model.trim(),
          max_concurrency: normalizedConcurrency,
          enabled,
          is_default: isDefault
        };
        if (apiKey.trim()) payload.api_key = apiKey.trim();
        await updateModelBackend(editingId, payload);
        setMessage("后端已保存");
      } else {
        await createModelBackend({
          name: name.trim(),
          base_url: baseUrl.trim(),
          model: model.trim(),
          api_key: apiKey.trim(),
          max_concurrency: normalizedConcurrency,
          is_default: isDefault
        });
        setMessage("后端已创建");
      }
      resetForm();
      await refresh();
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setSubmitting(false);
    }
  }

  async function setDefaultBackend(backend: ModelBackend) {
    setError(null);
    setMessage(null);
    try {
      await updateModelBackend(backend.id, { is_default: true });
      setMessage("默认后端已更新");
      await refresh();
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    }
  }

  async function toggleBackend(backend: ModelBackend) {
    setError(null);
    setMessage(null);
    try {
      await updateModelBackend(backend.id, { enabled: !backend.enabled });
      await refresh();
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    }
  }

  async function removeBackend(backend: ModelBackend) {
    setError(null);
    setMessage(null);
    try {
      await deleteModelBackend(backend.id);
      setMessage("后端已删除");
      await refresh();
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    }
  }

  async function saveRoute(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!routeUserId) return;
    setError(null);
    setMessage(null);
    try {
      await putModelRoute(routeUserId, routeBackendId || null);
      setMessage("路由已保存");
      await refresh();
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    }
  }

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-normal text-slate-950">模型管理</h1>
          <p className="mt-1 text-sm text-slate-500">管理 LLM 后端、默认模型和用户路由</p>
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

      {error ? <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
      {message ? <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">{message}</div> : null}

      <div className="grid gap-5 xl:grid-cols-[380px_1fr]">
        <aside className="space-y-5">
          <form onSubmit={(event) => void submitBackend(event)} className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-2 text-base font-semibold text-slate-950">
              <Bot aria-hidden="true" className="h-5 w-5 text-slate-500" />
              {editingId ? "编辑后端" : "新建后端"}
            </div>
            <div className="mt-4 space-y-3">
              <label className="block space-y-1.5">
                <span className="text-sm font-medium text-slate-700">名称</span>
                <input required value={name} onChange={(event) => setName(event.target.value)} className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 shadow-sm outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200" />
              </label>
              <label className="block space-y-1.5">
                <span className="text-sm font-medium text-slate-700">Base URL</span>
                <input required value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 shadow-sm outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200" />
              </label>
              <label className="block space-y-1.5">
                <span className="text-sm font-medium text-slate-700">模型</span>
                <input required value={model} onChange={(event) => setModel(event.target.value)} className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 shadow-sm outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200" />
              </label>
              <label className="block space-y-1.5">
                <span className="text-sm font-medium text-slate-700">API Key</span>
                <input
                  required={!editingId}
                  type="password"
                  value={apiKey}
                  placeholder={editingId ? "留空保持原 key" : ""}
                  onChange={(event) => setApiKey(event.target.value)}
                  className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 shadow-sm outline-none placeholder:text-slate-400 focus:border-slate-900 focus:ring-2 focus:ring-slate-200"
                />
              </label>
              <label className="block space-y-1.5">
                <span className="text-sm font-medium text-slate-700">最大并发</span>
                <input required min={1} type="number" value={maxConcurrency} onChange={(event) => setMaxConcurrency(event.target.value)} className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 shadow-sm outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200" />
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} className="h-4 w-4 rounded border-slate-300" />
                启用
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={isDefault} onChange={(event) => setIsDefault(event.target.checked)} className="h-4 w-4 rounded border-slate-300" />
                设为默认
              </label>
              <div className="flex gap-2">
                <button type="submit" disabled={submitting} className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-md bg-slate-900 px-4 text-sm font-semibold text-white shadow-sm hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60">
                  {submitting ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : null}
                  {editingId ? "保存后端" : "创建后端"}
                </button>
                {editingId ? (
                  <button type="button" onClick={resetForm} className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50">
                    取消
                  </button>
                ) : null}
              </div>
            </div>
          </form>

          <form onSubmit={(event) => void saveRoute(event)} className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-base font-semibold text-slate-950">用户路由</h2>
            <p className="mt-1 text-sm text-slate-500">未分配的用户使用默认后端</p>
            <div className="mt-4 space-y-3">
              <label className="block space-y-1.5">
                <span className="text-sm font-medium text-slate-700">路由用户</span>
                <select value={routeUserId} onChange={(event) => setRouteUserId(event.target.value)} className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 shadow-sm outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200">
                  {users.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.display_name || user.username} ({user.id})
                    </option>
                  ))}
                </select>
              </label>
              <label className="block space-y-1.5">
                <span className="text-sm font-medium text-slate-700">路由后端</span>
                <select value={routeBackendId} onChange={(event) => setRouteBackendId(event.target.value)} className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 shadow-sm outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200">
                  <option value="">默认后端</option>
                  {backends.map((backend) => (
                    <option key={backend.id} value={backend.id}>
                      {backend.name}
                    </option>
                  ))}
                </select>
              </label>
              <button type="submit" className="inline-flex h-10 w-full items-center justify-center rounded-md bg-slate-900 px-4 text-sm font-semibold text-white shadow-sm hover:bg-slate-700">
                保存路由
              </button>
            </div>
          </form>
        </aside>

        <section className="overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-4 py-3">
            <h2 className="text-base font-semibold text-slate-950">模型后端</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">名称</th>
                  <th className="px-4 py-3">base_url</th>
                  <th className="px-4 py-3">model</th>
                  <th className="px-4 py-3">key</th>
                  <th className="px-4 py-3">并发</th>
                  <th className="px-4 py-3">状态</th>
                  <th className="px-4 py-3">路由用户</th>
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
                ) : backends.length === 0 ? (
                  <tr>
                    <td className="px-4 py-8 text-center text-slate-500" colSpan={8}>
                      暂无后端
                    </td>
                  </tr>
                ) : (
                  backends.map((backend) => (
                    <tr key={backend.id} className="hover:bg-slate-50">
                      <td className="whitespace-nowrap px-4 py-4 font-medium text-slate-950">
                        <div className="flex items-center gap-2">
                          {backend.name}
                          {backend.is_default ? <span className="rounded-md bg-slate-900 px-2 py-0.5 text-xs text-white">默认</span> : null}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-4 font-mono text-xs text-slate-600">{backend.base_url}</td>
                      <td className="whitespace-nowrap px-4 py-4 font-mono text-xs text-slate-600">{backend.model}</td>
                      <td className="whitespace-nowrap px-4 py-4 font-mono text-xs text-slate-600">{backend.api_key}</td>
                      <td className="whitespace-nowrap px-4 py-4 text-slate-600">{backend.max_concurrency}</td>
                      <td className="whitespace-nowrap px-4 py-4">
                        <button type="button" onClick={() => void toggleBackend(backend)} className={cn("rounded-md border px-2 py-1 text-xs", backend.enabled ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-50 text-slate-500")}>
                          {backend.enabled ? "enabled" : "disabled"}
                        </button>
                      </td>
                      <td className="whitespace-nowrap px-4 py-4 text-slate-600">{routeLabel(routes, users, backend.id)}</td>
                      <td className="whitespace-nowrap px-4 py-4">
                        <div className="flex flex-wrap gap-2">
                          <button type="button" onClick={() => startEdit(backend)} className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50">
                            编辑 {backend.name}
                          </button>
                          {!backend.is_default ? (
                            <button type="button" onClick={() => void setDefaultBackend(backend)} className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50">
                              设为默认
                            </button>
                          ) : null}
                          <button type="button" onClick={() => void removeBackend(backend)} aria-label={`删除 ${backend.name}`} className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-red-200 text-red-600 hover:bg-red-50">
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

export default function ModelsPage() {
  return (
    <AdminGuard>
      <AdminModelsContent />
    </AdminGuard>
  );
}
