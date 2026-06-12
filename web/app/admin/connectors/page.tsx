"use client";

import { Download, Loader2, Plug, Plus, RefreshCw, Search, ShieldAlert, Trash2 } from "lucide-react";
import React, { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import { AdminGuard } from "@/components/admin-guard";
import {
  createConnector,
  deleteConnector,
  listConnectorPresets,
  listConnectorRegistry,
  listConnectors,
  listUsers,
  putConnectorScope,
  updateConnector
} from "@/lib/api-client";
import { cn } from "@/lib/cn";
import type {
  Connector,
  ConnectorPreset,
  ConnectorRegistryEntry,
  ConnectorTransport,
  UpdateConnectorRequest,
  User
} from "@/lib/types";

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

function hasPlaceholder(value: string) {
  return value.includes("/path/to/") || value.includes("postgresql://");
}

function registryErrorMessage(error: unknown) {
  const status = typeof error === "object" && error !== null ? (error as { status?: number }).status : undefined;
  const code = typeof error === "object" && error !== null ? (error as { code?: string }).code : undefined;
  if (status === 502 || code === "registry_unavailable") {
    return "连接器市场暂时不可用，请稍后重试；本地连接器列表不受影响";
  }
  return getErrorMessage(error);
}

function defaultConnectorName(registryName: string) {
  const segments = registryName.split(/[/:]/).filter(Boolean);
  return segments[segments.length - 1] || registryName;
}

function AdminConnectorsContent() {
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [presets, setPresets] = useState<ConnectorPreset[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showConnectorForm, setShowConnectorForm] = useState(false);
  const [selectedPresetId, setSelectedPresetId] = useState("");
  const [name, setName] = useState("");
  const [transport, setTransport] = useState<ConnectorTransport>("stdio");
  const [command, setCommand] = useState("");
  const [argsText, setArgsText] = useState("");
  const [url, setUrl] = useState("");
  const [envText, setEnvText] = useState("");
  const [presetEnvValues, setPresetEnvValues] = useState<Record<string, string>>({});
  const [enabled, setEnabled] = useState(true);
  const [requireApproval, setRequireApproval] = useState(false);
  const [scopeAll, setScopeAll] = useState(false);
  const [scopeConnectorId, setScopeConnectorId] = useState("");
  const [scopeUserId, setScopeUserId] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [transportFilter, setTransportFilter] = useState("all");
  const [registryQuery, setRegistryQuery] = useState("");
  const [registryResults, setRegistryResults] = useState<ConnectorRegistryEntry[]>([]);
  const [registrySearched, setRegistrySearched] = useState(false);
  const [registryLoading, setRegistryLoading] = useState(false);
  const [registryError, setRegistryError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const selectedPreset = useMemo(
    () => presets.find((preset) => preset.id === selectedPresetId) ?? null,
    [presets, selectedPresetId]
  );

  const stats = useMemo(
    () => ({
      total: connectors.length,
      connected: connectors.filter((connector) => connector.status === "connected").length,
      error: connectors.filter((connector) => connector.status.startsWith("error")).length,
      disabled: connectors.filter((connector) => !connector.enabled).length
    }),
    [connectors]
  );

  const filteredConnectors = useMemo(() => {
    const query = search.trim().toLowerCase();
    return connectors
      .filter((connector) => !query || connector.name.toLowerCase().includes(query))
      .filter((connector) => {
        if (statusFilter === "all") return true;
        if (statusFilter === "error") return connector.status.startsWith("error");
        if (statusFilter === "disabled") return !connector.enabled;
        return connector.status === statusFilter;
      })
      .filter((connector) => transportFilter === "all" || connector.transport === transportFilter);
  }, [connectors, search, statusFilter, transportFilter]);

  const refresh = useCallback(async () => {
    try {
      const [nextConnectors, nextUsers, nextPresets] = await Promise.all([
        listConnectors(),
        listUsers(),
        listConnectorPresets()
      ]);
      setConnectors(nextConnectors);
      setUsers(nextUsers);
      setPresets(nextPresets);
      setScopeConnectorId((current) => current || nextConnectors[0]?.id || "");
      setScopeUserId((current) => current || nextUsers[0]?.id || "");
      setSelectedPresetId((current) => current || nextPresets[0]?.id || "");
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

  function applyPreset(presetId: string) {
    setSelectedPresetId(presetId);
    const preset = presets.find((item) => item.id === presetId);
    if (!preset) return;
    setName(preset.id === "custom" ? "" : preset.name);
    setTransport(preset.transport);
    setCommand(preset.command ?? "");
    setArgsText((preset.args ?? []).join("\n"));
    setUrl(preset.url ?? "");
    setEnvText("");
    setPresetEnvValues(Object.fromEntries(preset.env_keys.map((key) => [key, ""])));
    setRequireApproval(false);
  }

  function resetForm() {
    setEditingId(null);
    setShowConnectorForm(false);
    setSelectedPresetId(presets[0]?.id || "");
    setName("");
    setTransport("stdio");
    setCommand("");
    setArgsText("");
    setUrl("");
    setEnvText("");
    setPresetEnvValues({});
    setEnabled(true);
    setRequireApproval(false);
    setScopeAll(false);
  }

  function openConnectorForm() {
    setEditingId(null);
    setShowConnectorForm(true);
    const presetId = selectedPresetId || presets[0]?.id || "";
    if (presetId) {
      applyPreset(presetId);
    }
    setMessage(null);
  }

  function startEdit(connector: Connector) {
    setEditingId(connector.id);
    setShowConnectorForm(true);
    setSelectedPresetId("custom");
    setName(connector.name);
    setTransport(connector.transport);
    setCommand(connector.command ?? "");
    setArgsText((connector.args ?? []).join("\n"));
    setUrl(connector.url ?? "");
    setEnvText("");
    setPresetEnvValues({});
    setEnabled(connector.enabled);
    setRequireApproval(connector.require_approval);
    setScopeAll(connector.scope_all);
    setMessage(null);
  }

  function presetEnv() {
    return Object.fromEntries(
      Object.entries(presetEnvValues)
        .map(([key, value]) => [key, value.trim()] as const)
        .filter(([, value]) => value)
    );
  }

  async function searchRegistry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRegistryLoading(true);
    setRegistryError(null);
    setRegistrySearched(true);
    try {
      const results = await listConnectorRegistry(registryQuery.trim(), 20);
      setRegistryResults(results);
    } catch (requestError) {
      setRegistryResults([]);
      setRegistryError(registryErrorMessage(requestError));
    } finally {
      setRegistryLoading(false);
    }
  }

  function importRegistryConnector(entry: ConnectorRegistryEntry) {
    if (!entry.install) return;
    setEditingId(null);
    setShowConnectorForm(true);
    setSelectedPresetId("custom");
    setName(defaultConnectorName(entry.name));
    setTransport(entry.install.transport);
    setCommand(entry.install.command ?? "");
    setArgsText((entry.install.args ?? []).join("\n"));
    setUrl(entry.install.url ?? "");
    setEnvText("");
    setPresetEnvValues(Object.fromEntries(entry.install.env_keys.map((key) => [key, ""])));
    setEnabled(true);
    setRequireApproval(true);
    setScopeAll(false);
    setMessage(`已从市场预填 ${entry.title || entry.name}`);
    setError(null);
  }

  async function submitConnector(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsedEnv = !editingId && Object.keys(presetEnvValues).length > 0 ? presetEnv() : parseEnv(envText);
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
          require_approval: requireApproval,
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
          enabled,
          require_approval: requireApproval
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

  const argsNeedReplacement = parseLines(argsText).some(hasPlaceholder);
  const credentialKeys = Object.keys(presetEnvValues);

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-normal text-slate-950">连接器管理</h1>
          <p className="mt-1 text-sm text-slate-500">配置 MCP server、状态和授权作用域</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={openConnectorForm}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-slate-900 px-3 text-sm font-semibold text-white shadow-sm hover:bg-slate-700"
          >
            <Plus aria-hidden="true" className="h-4 w-4" />
            添加连接器
          </button>
          <button
            type="button"
            onClick={() => void refresh()}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
          >
            <RefreshCw aria-hidden="true" className={cn("h-4 w-4", loading && "animate-spin")} />
            刷新
          </button>
        </div>
      </div>

      <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <div className="flex items-center gap-2 font-semibold">
          <ShieldAlert aria-hidden="true" className="h-4 w-4" />
          连接器会在服务端运行你提供的第三方程序，仅管理员可配置，请确认来源可信
        </div>
      </div>

      <section className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-950">连接器市场</h2>
            <p className="mt-1 text-sm text-slate-500">
              导入即在服务端运行第三方代码，请确认来源可信；版本已钉死，不会自动更新
            </p>
          </div>
        </div>
        <form onSubmit={(event) => void searchRegistry(event)} className="mt-4 grid gap-2 md:grid-cols-[1fr_auto]">
          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-slate-700">搜索市场</span>
            <input
              value={registryQuery}
              onChange={(event) => setRegistryQuery(event.target.value)}
              placeholder="fetch、github、browser"
              className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 shadow-sm outline-none placeholder:text-slate-400 focus:border-slate-900 focus:ring-2 focus:ring-slate-200"
            />
          </label>
          <div className="flex items-end">
            <button
              type="submit"
              disabled={registryLoading}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-slate-900 px-4 text-sm font-semibold text-white shadow-sm hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {registryLoading ? (
                <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
              ) : (
                <Search aria-hidden="true" className="h-4 w-4" />
              )}
              搜索市场
            </button>
          </div>
        </form>
        {registryError ? (
          <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {registryError}
          </div>
        ) : null}
        {registrySearched && !registryLoading && registryResults.length === 0 && !registryError ? (
          <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500">
            未找到匹配的连接器
          </div>
        ) : null}
        {registryResults.length > 0 ? (
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            {registryResults.map((entry) => {
              const canImport = entry.installable && entry.install;
              return (
                <article key={entry.name} className="rounded-md border border-slate-200 bg-slate-50 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-sm font-semibold text-slate-950">{entry.title || entry.name}</h3>
                        <span className="rounded-md border border-slate-200 bg-white px-2 py-1 font-mono text-xs text-slate-500">
                          {entry.version}
                        </span>
                      </div>
                      <div className="mt-1 truncate font-mono text-xs text-slate-500">{entry.name}</div>
                      <p className="mt-2 text-sm leading-5 text-slate-600">{entry.description}</p>
                      {entry.install ? (
                        <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500">
                          <span>transport: {entry.install.transport}</span>
                          {entry.install.command ? <span>command: {entry.install.command}</span> : null}
                          {entry.install.url ? <span>url: {entry.install.url}</span> : null}
                          <span>
                            env_keys: {entry.install.env_keys.length > 0 ? entry.install.env_keys.join(", ") : "-"}
                          </span>
                        </div>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      aria-label={
                        canImport
                          ? `导入 ${entry.title || entry.name}`
                          : `暂不支持一键导入 ${entry.title || entry.name}`
                      }
                      disabled={!canImport}
                      onClick={() => importRegistryConnector(entry)}
                      className="inline-flex h-9 shrink-0 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <Download aria-hidden="true" className="h-4 w-4" />
                      {canImport ? "导入" : "暂不支持一键导入"}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        ) : null}
      </section>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ["总数", stats.total],
          ["已连接", stats.connected],
          ["异常", stats.error],
          ["已禁用", stats.disabled]
        ].map(([label, value]) => (
          <div key={label} className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
            <div className="text-xs font-medium text-slate-500">{label}</div>
            <div className="mt-2 text-2xl font-semibold text-slate-950">{value}</div>
          </div>
        ))}
      </div>

      {error ? <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
      {message ? <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">{message}</div> : null}

      <div className="grid gap-5 xl:grid-cols-[380px_1fr]">
        <aside className="space-y-5">
          {showConnectorForm ? (
            <form onSubmit={(event) => void submitConnector(event)} className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center gap-2 text-base font-semibold text-slate-950">
                <Plug aria-hidden="true" className="h-5 w-5 text-slate-500" />
                {editingId ? "编辑连接器" : "添加连接器"}
              </div>
              <div className="mt-4 space-y-3">
                {!editingId ? (
                  <>
                    <label className="block space-y-1.5">
                      <span className="text-sm font-medium text-slate-700">连接器预设</span>
                      <select value={selectedPresetId} onChange={(event) => applyPreset(event.target.value)} className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 shadow-sm outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200">
                        {presets.map((preset) => (
                          <option key={preset.id} value={preset.id}>
                            {preset.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    {selectedPreset?.note ? (
                      <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                        {selectedPreset.note}
                      </div>
                    ) : null}
                  </>
                ) : null}
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
                    {argsNeedReplacement ? (
                      <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                        请替换为真实路径/连接串
                      </div>
                    ) : null}
                  </>
                ) : (
                  <label className="block space-y-1.5">
                    <span className="text-sm font-medium text-slate-700">URL</span>
                    <input required value={url} onChange={(event) => setUrl(event.target.value)} className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 shadow-sm outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200" />
                  </label>
                )}
                {!editingId && credentialKeys.length > 0 ? (
                  <div className="space-y-3">
                    {credentialKeys.map((key) => (
                      <label key={key} className="block space-y-1.5">
                        <span className="text-sm font-medium text-slate-700">{key}</span>
                        <input
                          type="password"
                          value={presetEnvValues[key] ?? ""}
                          onChange={(event) =>
                            setPresetEnvValues((current) => ({ ...current, [key]: event.target.value }))
                          }
                          className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 shadow-sm outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200"
                        />
                      </label>
                    ))}
                  </div>
                ) : (
                  <label className="block space-y-1.5">
                    <span className="text-sm font-medium text-slate-700">Env</span>
                    <textarea value={envText} onChange={(event) => setEnvText(event.target.value)} rows={3} placeholder={editingId ? "留空保持原 env" : "KEY=value"} className="w-full resize-y rounded-md border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-950 shadow-sm outline-none placeholder:text-slate-400 focus:border-slate-900 focus:ring-2 focus:ring-slate-200" />
                  </label>
                )}
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} className="h-4 w-4 rounded border-slate-300" />
                  启用
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" checked={requireApproval} onChange={(event) => setRequireApproval(event.target.checked)} className="h-4 w-4 rounded border-slate-300" />
                  每次调用需审批
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" checked={scopeAll} onChange={(event) => setScopeAll(event.target.checked)} className="h-4 w-4 rounded border-slate-300" />
                  全员可用
                </label>
                <div className="flex gap-2">
                  <button type="submit" disabled={submitting} className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-md bg-slate-900 px-4 text-sm font-semibold text-white shadow-sm hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60">
                    {submitting ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : null}
                    {editingId ? "保存连接器" : "创建连接器"}
                  </button>
                  <button type="button" onClick={resetForm} className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50">
                    取消
                  </button>
                </div>
              </div>
            </form>
          ) : null}

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
          <div className="space-y-3 border-b border-slate-200 px-4 py-3">
            <h2 className="text-base font-semibold text-slate-950">连接器</h2>
            <div className="grid gap-2 md:grid-cols-[1fr_160px_160px]">
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-slate-500">搜索连接器</span>
                <input value={search} onChange={(event) => setSearch(event.target.value)} className="h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 shadow-sm outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200" />
              </label>
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-slate-500">状态过滤</span>
                <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 shadow-sm outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200">
                  <option value="all">全部</option>
                  <option value="connected">connected</option>
                  <option value="error">error</option>
                  <option value="disabled">disabled</option>
                </select>
              </label>
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-slate-500">传输过滤</span>
                <select value={transportFilter} onChange={(event) => setTransportFilter(event.target.value)} className="h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 shadow-sm outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200">
                  <option value="all">全部</option>
                  <option value="stdio">stdio</option>
                  <option value="http">http</option>
                </select>
              </label>
            </div>
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
                ) : filteredConnectors.length === 0 ? (
                  <tr>
                    <td className="px-4 py-8 text-center text-slate-500" colSpan={8}>
                      暂无连接器
                    </td>
                  </tr>
                ) : (
                  filteredConnectors.map((connector) => (
                    <tr key={connector.id} className="hover:bg-slate-50">
                      <td className="whitespace-nowrap px-4 py-4">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-slate-950">{connector.name}</span>
                          {connector.require_approval ? (
                            <span className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800">
                              需审批
                            </span>
                          ) : null}
                        </div>
                      </td>
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
