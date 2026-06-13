"use client";

import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  FolderOpen,
  Loader2,
  Play,
  RefreshCw,
  Save,
  Square,
  Wifi
} from "lucide-react";
import React, { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import { isDesktopClient } from "@/lib/client-target";
import {
  chooseServerDirectory,
  serverGetConfig,
  serverSetConfig,
  serverStart,
  serverStatus,
  serverStop
} from "@/lib/desktop-bridge";
import type { LocalServerConfig, LocalServerStatus } from "@/lib/types";

const DEFAULT_PORT = 8700;

function getServerErrorMessage(error: unknown): string {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? (error as { code?: unknown }).code
      : undefined;
  if (code === "not_configured") return "请先在设置里填写 server 目录。";
  if (code === "port_in_use") return "端口已被占用,请换一个端口或停掉占用进程。";
  if (code === "bad_server_dir") return "server 目录无效,请确认目录里有后端源码。";

  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return "服务器操作失败";
}

function displayStatus(status: LocalServerStatus | null) {
  if (!status) return "读取中";
  if (status.running || status.reachable) {
    const port = status.port ? `端口 ${status.port}` : "端口未知";
    const pid = status.pid ? `PID ${status.pid}` : status.running ? "PID 未知" : "外部进程";
    return `运行中 · ${port} · ${pid}`;
  }
  return "已停止";
}

function normalizeStartStopStatus(
  nextStatus: Partial<LocalServerStatus>,
  previousStatus: LocalServerStatus | null
): LocalServerStatus {
  const running = nextStatus.running ?? previousStatus?.running ?? false;
  const reachable = nextStatus.reachable ?? (running || previousStatus?.reachable === true);
  return {
    running,
    reachable,
    pid: nextStatus.pid ?? null,
    port: nextStatus.port ?? previousStatus?.port ?? DEFAULT_PORT,
    configured: nextStatus.configured ?? previousStatus?.configured ?? true
  };
}

export default function ServerPage() {
  const desktopClient = isDesktopClient();
  const [config, setConfig] = useState<LocalServerConfig | null>(null);
  const [status, setStatus] = useState<LocalServerStatus | null>(null);
  const [serverDir, setServerDir] = useState("");
  const [port, setPort] = useState(String(DEFAULT_PORT));
  const [databaseUrl, setDatabaseUrl] = useState("");
  const [modelsConfigPath, setModelsConfigPath] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [loading, setLoading] = useState(desktopClient);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const serverOnline = Boolean(status?.running || status?.reachable);
  const statusText = useMemo(() => displayStatus(status), [status]);

  function applyConfig(nextConfig: LocalServerConfig) {
    setConfig(nextConfig);
    setServerDir(nextConfig.server_dir ?? "");
    setPort(String(nextConfig.port || DEFAULT_PORT));
    setDatabaseUrl(nextConfig.database_url ?? "");
    setModelsConfigPath(nextConfig.models_config_path ?? "");
  }

  const refreshStatus = useCallback(async (showSpinner = false) => {
    if (!desktopClient) return;
    if (showSpinner) setRefreshing(true);
    try {
      const nextStatus = await serverStatus();
      setStatus(nextStatus);
      if (!nextStatus.configured) {
        setSettingsOpen(true);
      }
    } catch (requestError) {
      setError(getServerErrorMessage(requestError));
    } finally {
      if (showSpinner) setRefreshing(false);
    }
  }, [desktopClient]);

  useEffect(() => {
    if (!desktopClient) return;
    let cancelled = false;

    async function loadServerState() {
      setLoading(true);
      setError(null);
      try {
        const [nextConfig, nextStatus] = await Promise.all([serverGetConfig(), serverStatus()]);
        if (cancelled) return;
        applyConfig(nextConfig);
        setStatus(nextStatus);
        if (!nextStatus.configured) {
          setSettingsOpen(true);
        }
      } catch (requestError) {
        if (!cancelled) {
          setError(getServerErrorMessage(requestError));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadServerState();
    return () => {
      cancelled = true;
    };
  }, [desktopClient]);

  useEffect(() => {
    if (!desktopClient) return;
    const interval = window.setInterval(() => {
      void refreshStatus(false);
    }, 3000);
    return () => window.clearInterval(interval);
  }, [desktopClient, refreshStatus]);

  async function pickServerDirectory() {
    setError(null);
    const selected = await chooseServerDirectory();
    if (selected) {
      setServerDir(selected);
    }
  }

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      const saved = await serverSetConfig({
        serverDir: serverDir.trim(),
        port: Number(port) || DEFAULT_PORT,
        databaseUrl: databaseUrl.trim(),
        modelsConfigPath: modelsConfigPath.trim()
      });
      applyConfig(saved);
      setMessage("设置已保存");
      await refreshStatus(false);
    } catch (requestError) {
      setError(getServerErrorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  async function toggleServer() {
    setSwitching(true);
    setError(null);
    setMessage(null);

    try {
      if (serverOnline) {
        const stopped = await serverStop();
        setStatus(normalizeStartStopStatus(stopped, status));
        setMessage("服务器已停止");
      } else {
        const started = await serverStart();
        setStatus(normalizeStartStopStatus(started, status));
        setMessage("服务器已启动");
      }
    } catch (requestError) {
      setError(getServerErrorMessage(requestError));
    } finally {
      setSwitching(false);
    }
  }

  if (!desktopClient) {
    return (
      <section className="rounded-md border border-slate-200 bg-white p-5 text-sm text-slate-600 shadow-sm">
        服务器面板仅在桌面客户端中可用。
      </section>
    );
  }

  return (
    <section className="max-w-4xl space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-normal text-slate-950">服务器</h1>
        <p className="mt-1 text-sm text-slate-500">
          这是把本机当服务器主机;启动后本机/同局域网的客户端都连它。
        </p>
      </div>

      {error ? (
        <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertCircle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      {message ? (
        <div className="flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
          <CheckCircle2 aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{message}</span>
        </div>
      ) : null}

      <div className="rounded-md border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-semibold ${
                  serverOnline
                    ? "border border-emerald-200 bg-emerald-50 text-emerald-800"
                    : "border border-slate-200 bg-slate-100 text-slate-600"
                }`}
              >
                <Wifi aria-hidden="true" className="h-4 w-4" />
                {statusText}
              </span>
              {status && !status.configured ? (
                <span className="inline-flex rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 text-sm font-semibold text-amber-800">
                  未配置
                </span>
              ) : null}
            </div>
            <p className="text-sm text-slate-500">
              关掉 app 后 server 仍在跑,要停就点「停止」。
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void refreshStatus(true)}
              disabled={loading || refreshing || switching}
              className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <RefreshCw aria-hidden="true" className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
              刷新
            </button>
            <button
              type="button"
              onClick={() => void toggleServer()}
              disabled={loading || switching}
              className={`inline-flex h-10 items-center gap-2 rounded-md px-4 text-sm font-semibold text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-60 ${
                serverOnline ? "bg-slate-800 hover:bg-slate-700" : "bg-emerald-700 hover:bg-emerald-600"
              }`}
            >
              {switching ? (
                <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
              ) : serverOnline ? (
                <Square aria-hidden="true" className="h-4 w-4" />
              ) : (
                <Play aria-hidden="true" className="h-4 w-4" />
              )}
              {serverOnline ? "停止" : "启动"}
            </button>
          </div>
        </div>
      </div>

      <div className="rounded-md border border-slate-200 bg-white shadow-sm">
        <button
          type="button"
          onClick={() => setSettingsOpen((value) => !value)}
          className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
        >
          <div>
            <div className="text-sm font-semibold text-slate-950">设置</div>
            <div className="mt-1 text-sm text-slate-500">server 目录、端口和可选配置路径</div>
          </div>
          <ChevronDown
            aria-hidden="true"
            className={`h-4 w-4 shrink-0 text-slate-500 transition ${settingsOpen ? "rotate-180" : ""}`}
          />
        </button>

        {settingsOpen ? (
          <form onSubmit={(event) => void saveSettings(event)} className="space-y-4 border-t border-slate-200 p-5">
            <label className="block space-y-1.5">
              <span className="text-sm font-medium text-slate-700">server 目录</span>
              <div className="flex gap-2">
                <input
                  required
                  value={serverDir}
                  disabled={loading || saving}
                  onChange={(event) => setServerDir(event.target.value)}
                  className="h-10 min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-slate-900 focus:ring-2 focus:ring-slate-200 disabled:cursor-not-allowed disabled:bg-slate-100"
                />
                <button
                  type="button"
                  onClick={() => void pickServerDirectory()}
                  disabled={loading || saving}
                  className="inline-flex h-10 shrink-0 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <FolderOpen aria-hidden="true" className="h-4 w-4" />
                  选择目录
                </button>
              </div>
            </label>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block space-y-1.5">
                <span className="text-sm font-medium text-slate-700">端口</span>
                <input
                  required
                  min={1}
                  max={65535}
                  type="number"
                  value={port}
                  disabled={loading || saving}
                  onChange={(event) => setPort(event.target.value)}
                  className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-slate-900 focus:ring-2 focus:ring-slate-200 disabled:cursor-not-allowed disabled:bg-slate-100"
                />
              </label>

              <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                <div className="font-medium text-slate-700">Secret Key</div>
                <div className="mt-1">{config?.secret_key_set ? "已自动生成" : "保存配置后自动生成"}</div>
              </div>
            </div>

            <label className="block space-y-1.5">
              <span className="text-sm font-medium text-slate-700">database_url</span>
              <input
                value={databaseUrl}
                disabled={loading || saving}
                onChange={(event) => setDatabaseUrl(event.target.value)}
                placeholder="可选,留空使用默认 sqlite"
                className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-slate-900 focus:ring-2 focus:ring-slate-200 disabled:cursor-not-allowed disabled:bg-slate-100"
              />
            </label>

            <label className="block space-y-1.5">
              <span className="text-sm font-medium text-slate-700">models_config_path</span>
              <input
                value={modelsConfigPath}
                disabled={loading || saving}
                onChange={(event) => setModelsConfigPath(event.target.value)}
                placeholder="可选,模型配置文件路径"
                className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-slate-900 focus:ring-2 focus:ring-slate-200 disabled:cursor-not-allowed disabled:bg-slate-100"
              />
            </label>

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={loading || saving}
                className="inline-flex h-10 items-center gap-2 rounded-md bg-slate-900 px-4 text-sm font-semibold text-white shadow-sm hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving ? (
                  <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
                ) : (
                  <Save aria-hidden="true" className="h-4 w-4" />
                )}
                保存设置
              </button>
            </div>
          </form>
        ) : null}
      </div>
    </section>
  );
}
