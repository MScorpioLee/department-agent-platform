"use client";

import { Bot, CheckCircle2, Copy, ExternalLink, Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";
import React, { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import { AdminGuard } from "@/components/admin-guard";
import {
  createModelBackend,
  deleteModelBackend,
  discoverModelProvider,
  getModelOAuthAuthorizeUrl,
  listModelBackends,
  listModelProviders,
  listModelRoutes,
  listUsers,
  pollModelOAuthDevice,
  putModelRoute,
  refreshModelOAuth,
  startModelOAuthDevice,
  submitModelOAuthCallback,
  updateModelBackend
} from "@/lib/api-client";
import { cn } from "@/lib/cn";
import type {
  ModelBackend,
  ModelAuthScope,
  ModelAuthType,
  ModelProvider,
  ModelRoute,
  ModelRuntime,
  OAuthDeviceStartResponse,
  UpdateModelBackendRequest,
  User
} from "@/lib/types";

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "请求失败";
}

function routeLabel(routes: ModelRoute[], users: User[], backendId: string) {
  const names = routes
    .filter((route) => route.backend_id === backendId)
    .map((route) => users.find((user) => user.id === route.user_id)?.username ?? route.user_id);
  return names.length > 0 ? names.join(", ") : "-";
}

function oauthStatusLabel(status?: string) {
  switch (status) {
    case "authorized":
      return "已授权";
    case "expired":
      return "已过期";
    case "pending":
      return "待授权";
    case "unconfigured":
      return "未配置";
    default:
      return "-";
  }
}

function oauthStatusClass(status?: string) {
  switch (status) {
    case "authorized":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "expired":
      return "border-red-200 bg-red-50 text-red-700";
    case "pending":
      return "border-amber-200 bg-amber-50 text-amber-700";
    default:
      return "border-slate-200 bg-slate-50 text-slate-600";
  }
}

function optionalValue(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

async function copyText(value: string) {
  try {
    await navigator.clipboard?.writeText(value);
  } catch {
    // Copy is a convenience action; auth flow state is still visible if clipboard is unavailable.
  }
}

type OAuthDialog =
  | {
      mode: "device";
      backendId: string;
      backendName: string;
      verificationUri: string;
      userCode: string;
      status: "pending" | "authorized";
    }
  | {
      mode: "auth_code";
      backendId: string;
      backendName: string;
      authorizeUrl: string;
      state: string;
      code: string;
    };

function AdminModelsContent() {
  const [backends, setBackends] = useState<ModelBackend[]>([]);
  const [providers, setProviders] = useState<ModelProvider[]>([]);
  const [routes, setRoutes] = useState<ModelRoute[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showProviderForm, setShowProviderForm] = useState(false);
  const [selectedProviderId, setSelectedProviderId] = useState("");
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [authType, setAuthType] = useState<ModelAuthType>("api_key");
  const [authScope, setAuthScope] = useState<ModelAuthScope>("shared");
  const [runtime, setRuntime] = useState<ModelRuntime>("openai_chat");
  const [oauthClientId, setOauthClientId] = useState("");
  const [oauthClientSecret, setOauthClientSecret] = useState("");
  const [oauthTokenUrl, setOauthTokenUrl] = useState("");
  const [oauthDeviceUrl, setOauthDeviceUrl] = useState("");
  const [oauthAuthorizationUrl, setOauthAuthorizationUrl] = useState("");
  const [oauthScope, setOauthScope] = useState("");
  const [oauthRedirectUri, setOauthRedirectUri] = useState("");
  const [discoveredModels, setDiscoveredModels] = useState<string[]>([]);
  const [useDiscoveredModels, setUseDiscoveredModels] = useState(false);
  const [discoveringModels, setDiscoveringModels] = useState(false);
  const [discoverSuccess, setDiscoverSuccess] = useState<string | null>(null);
  const [discoverError, setDiscoverError] = useState<string | null>(null);
  const [oauthDialog, setOauthDialog] = useState<OAuthDialog | null>(null);
  const [oauthSubmitting, setOauthSubmitting] = useState(false);
  const [maxConcurrency, setMaxConcurrency] = useState("2");
  const [enabled, setEnabled] = useState(true);
  const [isDefault, setIsDefault] = useState(false);
  const [routeUserId, setRouteUserId] = useState("");
  const [routeBackendId, setRouteBackendId] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const selectedProvider = useMemo(
    () => providers.find((provider) => provider.id === selectedProviderId) ?? null,
    [providers, selectedProviderId]
  );

  function clearDiscovery() {
    setDiscoveredModels([]);
    setUseDiscoveredModels(false);
    setDiscoverSuccess(null);
    setDiscoverError(null);
  }

  const refresh = useCallback(async () => {
    try {
      const [nextBackends, nextRoutes, nextUsers, nextProviders] = await Promise.all([
        listModelBackends(),
        listModelRoutes(),
        listUsers(),
        listModelProviders()
      ]);
      setBackends(nextBackends);
      setRoutes(nextRoutes);
      setUsers(nextUsers);
      setProviders(nextProviders);
      setRouteUserId((current) => current || nextUsers[0]?.id || "");
      setRouteBackendId((current) => (current === "" ? "" : current || nextBackends[0]?.id || ""));
      setSelectedProviderId((current) => current || nextProviders[0]?.id || "");
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

  useEffect(() => {
    if (!showProviderForm || editingId || providers.length === 0) return;
    if (name || baseUrl || model) return;
    const providerId = selectedProviderId || providers[0]?.id || "";
    const provider = providers.find((item) => item.id === providerId);
    if (!provider) return;
    setSelectedProviderId(providerId);
    setName(provider.id === "custom" ? "" : provider.name);
    setBaseUrl(provider.base_url);
    setModel(provider.models[0] ?? "");
    setApiKey("");
    setDiscoveredModels([]);
    setUseDiscoveredModels(false);
    setDiscoverSuccess(null);
    setDiscoverError(null);
  }, [baseUrl, editingId, model, name, providers, selectedProviderId, showProviderForm]);

  function applyProvider(providerId: string) {
    setSelectedProviderId(providerId);
    const provider = providers.find((item) => item.id === providerId);
    if (!provider) return;
    setName(provider.id === "custom" ? "" : provider.name);
    setBaseUrl(provider.base_url);
    setModel(provider.models[0] ?? "");
    setApiKey("");
    clearDiscovery();
  }

  function resetForm() {
    setEditingId(null);
    setShowProviderForm(false);
    setName("");
    setBaseUrl("");
    setModel("");
    setApiKey("");
    setAuthType("api_key");
    setAuthScope("shared");
    setRuntime("openai_chat");
    setOauthClientId("");
    setOauthClientSecret("");
    setOauthTokenUrl("");
    setOauthDeviceUrl("");
    setOauthAuthorizationUrl("");
    setOauthScope("");
    setOauthRedirectUri("");
    clearDiscovery();
    setMaxConcurrency("2");
    setEnabled(true);
    setIsDefault(false);
    setSelectedProviderId(providers[0]?.id || "");
  }

  function openProviderForm() {
    setEditingId(null);
    setShowProviderForm(true);
    const providerId = selectedProviderId || providers[0]?.id || "";
    if (providerId) {
      applyProvider(providerId);
    }
    setMessage(null);
  }

  function startEdit(backend: ModelBackend) {
    setEditingId(backend.id);
    setShowProviderForm(true);
    setSelectedProviderId("custom");
    setName(backend.name);
    setBaseUrl(backend.base_url);
    setModel(backend.model);
    setApiKey("");
    setAuthType(backend.auth_type ?? "api_key");
    setAuthScope(backend.auth_scope ?? "shared");
    setRuntime(backend.runtime ?? "openai_chat");
    setOauthClientId(backend.oauth?.client_id ?? "");
    setOauthClientSecret("");
    setOauthTokenUrl("");
    setOauthDeviceUrl(backend.oauth?.has_device_flow ? "已配置，保存时可替换" : "");
    setOauthAuthorizationUrl(backend.oauth?.has_auth_code_flow ? "已配置，保存时可替换" : "");
    setOauthScope(backend.oauth?.scope ?? "");
    setOauthRedirectUri("");
    clearDiscovery();
    setMaxConcurrency(String(backend.max_concurrency));
    setEnabled(backend.enabled);
    setIsDefault(backend.is_default);
    setMessage(null);
  }

  async function fetchModels() {
    setDiscoveringModels(true);
    setDiscoverError(null);
    setDiscoverSuccess(null);
    try {
      const response = await discoverModelProvider({
        base_url: baseUrl.trim(),
        ...(apiKey.trim() ? { api_key: apiKey.trim() } : {})
      });
      setDiscoveredModels(response.models);
      setUseDiscoveredModels(response.models.length > 0);
      if (response.models[0]) setModel(response.models[0]);
      setDiscoverSuccess(`连接成功，共 ${response.count} 个模型`);
    } catch (requestError) {
      setDiscoverError(getErrorMessage(requestError));
    } finally {
      setDiscoveringModels(false);
    }
  }

  function markOAuthAuthorized(backendId: string) {
    setBackends((current) =>
      current.map((backend) =>
        backend.id === backendId && backend.oauth
          ? { ...backend, oauth: { ...backend.oauth, status: "authorized" } }
          : backend
      )
    );
  }

  async function pollDeviceUntilAuthorized(backendId: string) {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const response = await pollModelOAuthDevice(backendId);
      if (response.status === "authorized") {
        markOAuthAuthorized(backendId);
        setOauthDialog((current) =>
          current?.mode === "device" && current.backendId === backendId
            ? { ...current, status: "authorized" }
            : current
        );
        setMessage("OAuth 已授权");
        return;
      }
      await new Promise((resolve) => window.setTimeout(resolve, attempt === 0 ? 0 : 1000));
    }
    setError("OAuth 授权超时，请稍后重试");
  }

  async function startOAuthLogin(backend: ModelBackend) {
    if (!backend.oauth) return;
    setError(null);
    setMessage(null);
    try {
      if (backend.oauth.has_device_flow) {
        const response: OAuthDeviceStartResponse = await startModelOAuthDevice(backend.id);
        setOauthDialog({
          mode: "device",
          backendId: backend.id,
          backendName: backend.name,
          verificationUri: response.verification_uri,
          userCode: response.user_code,
          status: "pending"
        });
        void pollDeviceUntilAuthorized(backend.id);
        return;
      }

      if (backend.oauth.has_auth_code_flow) {
        const response = await getModelOAuthAuthorizeUrl(backend.id);
        window.open(response.authorize_url, "_blank", "noopener,noreferrer");
        setOauthDialog({
          mode: "auth_code",
          backendId: backend.id,
          backendName: backend.name,
          authorizeUrl: response.authorize_url,
          state: response.state,
          code: ""
        });
      }
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    }
  }

  async function submitAuthorizationCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!oauthDialog || oauthDialog.mode !== "auth_code") return;
    setOauthSubmitting(true);
    setError(null);
    try {
      await submitModelOAuthCallback(oauthDialog.backendId, {
        code: oauthDialog.code.trim(),
        state: oauthDialog.state
      });
      markOAuthAuthorized(oauthDialog.backendId);
      setOauthDialog(null);
      setMessage("OAuth 已授权");
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setOauthSubmitting(false);
    }
  }

  async function refreshOAuthToken(backend: ModelBackend) {
    setError(null);
    setMessage(null);
    try {
      await refreshModelOAuth(backend.id);
      markOAuthAuthorized(backend.id);
      setMessage("OAuth 令牌已刷新");
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    }
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
        if (authType === "oauth") {
          payload.auth_type = "oauth";
          payload.auth_scope = authScope;
          payload.runtime = runtime;
          payload.oauth = {
            client_id: oauthClientId.trim(),
            ...(optionalValue(oauthClientSecret) ? { client_secret: oauthClientSecret.trim() } : {}),
            token_url: oauthTokenUrl.trim(),
            ...(optionalValue(oauthDeviceUrl) ? { device_authorization_url: oauthDeviceUrl.trim() } : {}),
            ...(optionalValue(oauthAuthorizationUrl) ? { authorization_url: oauthAuthorizationUrl.trim() } : {}),
            ...(optionalValue(oauthScope) ? { scope: oauthScope.trim() } : {}),
            ...(optionalValue(oauthRedirectUri) ? { redirect_uri: oauthRedirectUri.trim() } : {})
          };
        } else if (apiKey.trim()) {
          payload.auth_type = "api_key";
          payload.api_key = apiKey.trim();
        }
        await updateModelBackend(editingId, payload);
        setMessage("后端已保存");
      } else {
        const payload = {
          name: name.trim(),
          base_url: baseUrl.trim(),
          model: model.trim(),
          max_concurrency: normalizedConcurrency,
          is_default: isDefault
        };
        await createModelBackend(
          authType === "oauth"
            ? {
                ...payload,
                auth_type: "oauth",
                auth_scope: authScope,
                runtime,
                oauth: {
                  client_id: oauthClientId.trim(),
                  ...(optionalValue(oauthClientSecret) ? { client_secret: oauthClientSecret.trim() } : {}),
                  token_url: oauthTokenUrl.trim(),
                  ...(optionalValue(oauthDeviceUrl) ? { device_authorization_url: oauthDeviceUrl.trim() } : {}),
                  ...(optionalValue(oauthAuthorizationUrl) ? { authorization_url: oauthAuthorizationUrl.trim() } : {}),
                  ...(optionalValue(oauthScope) ? { scope: oauthScope.trim() } : {}),
                  ...(optionalValue(oauthRedirectUri) ? { redirect_uri: oauthRedirectUri.trim() } : {})
                }
              }
            : {
                ...payload,
                api_key: apiKey.trim()
              }
        );
        setMessage("Provider 已创建");
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
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={openProviderForm}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-slate-900 px-3 text-sm font-semibold text-white shadow-sm hover:bg-slate-700"
          >
            <Plus aria-hidden="true" className="h-4 w-4" />
            添加 Provider
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

      {error ? <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
      {message ? <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">{message}</div> : null}

      <div className="grid gap-5 xl:grid-cols-[380px_1fr]">
        <aside className="space-y-5">
          {showProviderForm ? (
            <form onSubmit={(event) => void submitBackend(event)} className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center gap-2 text-base font-semibold text-slate-950">
                <Bot aria-hidden="true" className="h-5 w-5 text-slate-500" />
                {editingId ? "编辑后端" : "添加 Provider"}
              </div>
              <div className="mt-4 space-y-3">
                {!editingId ? (
                  <>
                    <label className="block space-y-1.5">
                      <span className="text-sm font-medium text-slate-700">Provider</span>
                      <select value={selectedProviderId} onChange={(event) => applyProvider(event.target.value)} className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 shadow-sm outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200">
                        {providers.map((provider) => (
                          <option key={provider.id} value={provider.id}>
                            {provider.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    {selectedProvider?.note ? (
                      <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                        {selectedProvider.note}
                      </div>
                    ) : null}
                  </>
                ) : null}
                <label className="block space-y-1.5">
                  <span className="text-sm font-medium text-slate-700">认证方式</span>
                  <select
                    value={authType}
                    onChange={(event) => {
                      setAuthType(event.target.value as ModelAuthType);
                      setApiKey("");
                      setOauthClientSecret("");
                      clearDiscovery();
                    }}
                    className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 shadow-sm outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200"
                  >
                    <option value="api_key">API Key</option>
                    <option value="oauth">OAuth</option>
                  </select>
                </label>
                <label className="block space-y-1.5">
                  <span className="text-sm font-medium text-slate-700">名称</span>
                  <input required value={name} onChange={(event) => setName(event.target.value)} className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 shadow-sm outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200" />
                </label>
                <label className="block space-y-1.5">
                  <span className="text-sm font-medium text-slate-700">Base URL</span>
                  <input required value={baseUrl} onChange={(event) => {
                    setBaseUrl(event.target.value);
                    clearDiscovery();
                  }} className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 shadow-sm outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200" />
                </label>
                <div className="space-y-2">
                  <label className="block space-y-1.5">
                    <span className="text-sm font-medium text-slate-700">模型</span>
                    {discoveredModels.length > 0 && useDiscoveredModels ? (
                      <select
                        required
                        value={model}
                        onChange={(event) => setModel(event.target.value)}
                        className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 shadow-sm outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200"
                      >
                        {discoveredModels.map((candidate) => (
                          <option key={candidate} value={candidate}>
                            {candidate}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <>
                        <input required list="model-provider-candidates" value={model} onChange={(event) => setModel(event.target.value)} className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 shadow-sm outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200" />
                        <datalist id="model-provider-candidates">
                          {(selectedProvider?.models ?? []).map((candidate) => (
                            <option key={candidate} value={candidate} />
                          ))}
                        </datalist>
                      </>
                    )}
                  </label>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void fetchModels()}
                      disabled={discoveringModels || !baseUrl.trim()}
                      className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {discoveringModels ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : null}
                      获取模型列表
                    </button>
                    {discoveredModels.length > 0 ? (
                      <button
                        type="button"
                        onClick={() => setUseDiscoveredModels((current) => !current)}
                        className="inline-flex h-9 items-center rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
                      >
                        {useDiscoveredModels ? "切回手填" : "使用获取列表"}
                      </button>
                    ) : null}
                    {discoverSuccess ? (
                      <span className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
                        <CheckCircle2 aria-hidden="true" className="h-3.5 w-3.5" />
                        <span>{discoverSuccess}</span>
                      </span>
                    ) : null}
                  </div>
                  {discoverError ? (
                    <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                      {discoverError}
                    </div>
                  ) : null}
                </div>
                {authType === "api_key" ? (
                  <label className="block space-y-1.5">
                    <span className="text-sm font-medium text-slate-700">API Key</span>
                    <input
                      required={!editingId && selectedProvider?.needs_key !== false}
                      type="password"
                      value={apiKey}
                      placeholder={editingId ? "留空保持原 key" : selectedProvider?.needs_key === false ? "可留空" : ""}
                      onChange={(event) => {
                        setApiKey(event.target.value);
                        clearDiscovery();
                      }}
                      className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 shadow-sm outline-none placeholder:text-slate-400 focus:border-slate-900 focus:ring-2 focus:ring-slate-200"
                    />
                  </label>
                ) : (
                  <div className="space-y-3 rounded-md border border-slate-200 bg-slate-50 p-3">
                    <p className="text-xs text-slate-600">管理员填写厂商 OAuth 应用配置；平台不内置任何厂商 client_id。</p>
                    <label className="block space-y-1.5">
                      <span className="text-sm font-medium text-slate-700">client_id</span>
                      <input required value={oauthClientId} onChange={(event) => setOauthClientId(event.target.value)} className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 shadow-sm outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200" />
                    </label>
                    <label className="block space-y-1.5">
                      <span className="text-sm font-medium text-slate-700">client_secret</span>
                      <input type="password" value={oauthClientSecret} placeholder="PKCE/设备码可不填" onChange={(event) => setOauthClientSecret(event.target.value)} className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 shadow-sm outline-none placeholder:text-slate-400 focus:border-slate-900 focus:ring-2 focus:ring-slate-200" />
                    </label>
                    <label className="block space-y-1.5">
                      <span className="text-sm font-medium text-slate-700">token_url</span>
                      <input required type="url" value={oauthTokenUrl} onChange={(event) => setOauthTokenUrl(event.target.value)} className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 shadow-sm outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200" />
                    </label>
                    <label className="block space-y-1.5">
                      <span className="text-sm font-medium text-slate-700">device_authorization_url</span>
                      <input type="url" value={oauthDeviceUrl} onChange={(event) => setOauthDeviceUrl(event.target.value)} className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 shadow-sm outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200" />
                    </label>
                    <label className="block space-y-1.5">
                      <span className="text-sm font-medium text-slate-700">authorization_url</span>
                      <input type="url" value={oauthAuthorizationUrl} onChange={(event) => setOauthAuthorizationUrl(event.target.value)} className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 shadow-sm outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200" />
                    </label>
                    <label className="block space-y-1.5">
                      <span className="text-sm font-medium text-slate-700">scope</span>
                      <input value={oauthScope} onChange={(event) => setOauthScope(event.target.value)} className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 shadow-sm outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200" />
                    </label>
                    <label className="block space-y-1.5">
                      <span className="text-sm font-medium text-slate-700">redirect_uri</span>
                      <input type="url" value={oauthRedirectUri} onChange={(event) => setOauthRedirectUri(event.target.value)} className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 shadow-sm outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200" />
                    </label>
                    <label className="block space-y-1.5">
                      <span className="text-sm font-medium text-slate-700">令牌归属</span>
                      <select value={authScope} onChange={(event) => setAuthScope(event.target.value as ModelAuthScope)} className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 shadow-sm outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200">
                        <option value="shared">shared</option>
                        <option value="per_user">per_user</option>
                      </select>
                    </label>
                    <label className="block space-y-1.5">
                      <span className="text-sm font-medium text-slate-700">运行时</span>
                      <select value={runtime} onChange={(event) => setRuntime(event.target.value as ModelRuntime)} className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 shadow-sm outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200">
                        <option value="openai_chat">openai_chat</option>
                        <option value="codex_responses">codex_responses</option>
                      </select>
                    </label>
                    {authScope === "per_user" ? (
                      <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                        per_user 表示每个用户用自己的订阅登录，不是全员共用一个账号。
                      </div>
                    ) : null}
                  </div>
                )}
                <label className="block space-y-1.5">
                  <span className="text-sm font-medium text-slate-700">最大并发</span>
                  <input required min={1} type="number" value={maxConcurrency} onChange={(event) => setMaxConcurrency(event.target.value)} className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 shadow-sm outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200" />
                </label>
                {editingId ? (
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} className="h-4 w-4 rounded border-slate-300" />
                    启用
                  </label>
                ) : null}
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" checked={isDefault} onChange={(event) => setIsDefault(event.target.checked)} className="h-4 w-4 rounded border-slate-300" />
                  设为默认
                </label>
                <div className="flex gap-2">
                  <button type="submit" disabled={submitting} className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-md bg-slate-900 px-4 text-sm font-semibold text-white shadow-sm hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60">
                    {submitting ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : null}
                    {editingId ? "保存后端" : "创建 Provider"}
                  </button>
                  <button type="button" onClick={resetForm} className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50">
                    取消
                  </button>
                </div>
              </div>
            </form>
          ) : null}

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
                  <th className="px-4 py-3">认证</th>
                  <th className="px-4 py-3">scope/runtime</th>
                  <th className="px-4 py-3">key</th>
                  <th className="px-4 py-3">并发</th>
                  <th className="px-4 py-3">状态</th>
                  <th className="px-4 py-3">OAuth</th>
                  <th className="px-4 py-3">路由用户</th>
                  <th className="px-4 py-3">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td className="px-4 py-8 text-center text-slate-500" colSpan={11}>
                      加载中
                    </td>
                  </tr>
                ) : backends.length === 0 ? (
                  <tr>
                    <td className="px-4 py-8 text-center text-slate-500" colSpan={11}>
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
                      <td className="whitespace-nowrap px-4 py-4">
                        <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-medium text-slate-700">
                          {backend.auth_type ?? "api_key"}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-4">
                        <div className="flex flex-wrap gap-1">
                          <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-medium text-slate-700">
                            {backend.auth_scope ?? "shared"}
                          </span>
                          <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-medium text-slate-700">
                            {backend.runtime ?? "openai_chat"}
                          </span>
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-4 font-mono text-xs text-slate-600">
                        {(backend.auth_type ?? "api_key") === "oauth" ? "-" : backend.api_key}
                      </td>
                      <td className="whitespace-nowrap px-4 py-4 text-slate-600">{backend.max_concurrency}</td>
                      <td className="whitespace-nowrap px-4 py-4">
                        <button type="button" onClick={() => void toggleBackend(backend)} className={cn("rounded-md border px-2 py-1 text-xs", backend.enabled ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-50 text-slate-500")}>
                          {backend.enabled ? "enabled" : "disabled"}
                        </button>
                      </td>
                      <td className="whitespace-nowrap px-4 py-4">
                        {(backend.auth_type ?? "api_key") === "oauth" ? (
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={cn("rounded-md border px-2 py-1 text-xs font-medium", oauthStatusClass(backend.oauth?.status))}>
                              {oauthStatusLabel(backend.oauth?.status)}
                            </span>
                            {backend.oauth?.has_device_flow || backend.oauth?.has_auth_code_flow ? (
                              <button type="button" onClick={() => void startOAuthLogin(backend)} className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50">
                                OAuth 登录 {backend.name}
                              </button>
                            ) : null}
                            {backend.oauth?.status === "authorized" ? (
                              <button type="button" onClick={() => void refreshOAuthToken(backend)} className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50">
                                刷新令牌 {backend.name}
                              </button>
                            ) : null}
                          </div>
                        ) : (
                          "-"
                        )}
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

      {oauthDialog ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
          <div className="w-full max-w-lg rounded-md border border-slate-200 bg-white p-5 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-950">OAuth 登录 {oauthDialog.backendName}</h2>
                <p className="mt-1 text-sm text-slate-500">
                  {oauthDialog.mode === "device" ? "在浏览器打开验证地址并输入用户码" : "浏览器授权后把 code 粘贴回来"}
                </p>
              </div>
              <button type="button" onClick={() => setOauthDialog(null)} className="rounded-md border border-slate-300 px-2 py-1 text-sm text-slate-700 hover:bg-slate-50">
                关闭
              </button>
            </div>

            {oauthDialog.mode === "device" ? (
              <div className="mt-4 space-y-3">
                <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                  <div className="text-xs font-medium uppercase text-slate-500">verification_uri</div>
                  <div className="mt-1 break-all font-mono text-sm text-slate-900">{oauthDialog.verificationUri}</div>
                  <button type="button" onClick={() => void copyText(oauthDialog.verificationUri)} className="mt-2 inline-flex h-8 items-center gap-2 rounded-md border border-slate-300 bg-white px-2 text-xs font-medium text-slate-700 hover:bg-slate-50">
                    <Copy aria-hidden="true" className="h-3.5 w-3.5" />
                    复制地址
                  </button>
                </div>
                <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                  <div className="text-xs font-medium uppercase text-slate-500">user_code</div>
                  <div className="mt-1 font-mono text-lg font-semibold text-slate-950">{oauthDialog.userCode}</div>
                  <button type="button" onClick={() => void copyText(oauthDialog.userCode)} className="mt-2 inline-flex h-8 items-center gap-2 rounded-md border border-slate-300 bg-white px-2 text-xs font-medium text-slate-700 hover:bg-slate-50">
                    <Copy aria-hidden="true" className="h-3.5 w-3.5" />
                    复制 code
                  </button>
                </div>
                <div className={cn("rounded-md border px-3 py-2 text-sm font-medium", oauthStatusClass(oauthDialog.status))}>
                  {oauthDialog.status === "authorized" ? "已授权" : "等待授权"}
                </div>
              </div>
            ) : (
              <form onSubmit={(event) => void submitAuthorizationCode(event)} className="mt-4 space-y-3">
                <label className="block space-y-1.5">
                  <span className="text-sm font-medium text-slate-700">authorize_url</span>
                  <div className="flex gap-2">
                    <input readOnly value={oauthDialog.authorizeUrl} className="h-10 min-w-0 flex-1 rounded-md border border-slate-300 bg-slate-50 px-3 text-sm text-slate-950 shadow-sm outline-none" />
                    <a href={oauthDialog.authorizeUrl} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50">
                      <ExternalLink aria-hidden="true" className="h-4 w-4" />
                    </a>
                  </div>
                </label>
                <label className="block space-y-1.5">
                  <span className="text-sm font-medium text-slate-700">state</span>
                  <input readOnly value={oauthDialog.state} className="h-10 w-full rounded-md border border-slate-300 bg-slate-50 px-3 text-sm text-slate-950 shadow-sm outline-none" />
                </label>
                <label className="block space-y-1.5">
                  <span className="text-sm font-medium text-slate-700">授权码 code</span>
                  <input required value={oauthDialog.code} onChange={(event) => setOauthDialog({ ...oauthDialog, code: event.target.value })} className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 shadow-sm outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200" />
                </label>
                <button type="submit" disabled={oauthSubmitting} className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-slate-900 px-4 text-sm font-semibold text-white shadow-sm hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60">
                  {oauthSubmitting ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : null}
                  提交授权码
                </button>
              </form>
            )}
          </div>
        </div>
      ) : null}
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
