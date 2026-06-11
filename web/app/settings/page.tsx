"use client";

import { Save } from "lucide-react";
import React, { FormEvent, useEffect, useState } from "react";

import { isDesktopClient } from "@/lib/client-target";
import { getDesktopServerUrl, setDesktopServerUrl } from "@/lib/desktop-bridge";

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "保存失败";
}

export default function SettingsPage() {
  const desktopClient = isDesktopClient();
  const [serverUrl, setServerUrl] = useState("http://127.0.0.1:8700");
  const [loading, setLoading] = useState(desktopClient);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!desktopClient) return;
    let cancelled = false;

    getDesktopServerUrl()
      .then((value) => {
        if (!cancelled && value) {
          setServerUrl(value);
        }
      })
      .catch((requestError) => {
        if (!cancelled) {
          setError(getErrorMessage(requestError));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [desktopClient]);

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      const saved = await setDesktopServerUrl(serverUrl);
      setServerUrl(saved);
      setMessage("设置已保存");
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  if (!desktopClient) {
    return (
      <section className="rounded-md border border-slate-200 bg-white p-5 text-sm text-slate-600 shadow-sm">
        设置仅在桌面客户端中可用。
      </section>
    );
  }

  return (
    <section className="max-w-2xl space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-normal text-slate-950">设置</h1>
        <p className="mt-1 text-sm text-slate-500">桌面客户端直连的 Agent Server 地址</p>
      </div>

      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {message ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
          {message}
        </div>
      ) : null}

      <form onSubmit={(event) => void saveSettings(event)} className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
        <label className="block space-y-1.5">
          <span className="text-sm font-medium text-slate-700">Server 地址</span>
          <input
            required
            type="url"
            value={serverUrl}
            disabled={loading}
            onChange={(event) => setServerUrl(event.target.value)}
            className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-slate-900 focus:ring-2 focus:ring-slate-200 disabled:cursor-not-allowed disabled:bg-slate-100"
          />
        </label>
        <div className="mt-4 flex justify-end">
          <button
            type="submit"
            disabled={loading || saving}
            className="inline-flex h-10 items-center gap-2 rounded-md bg-slate-900 px-4 text-sm font-semibold text-white shadow-sm hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Save aria-hidden="true" className="h-4 w-4" />
            保存
          </button>
        </div>
      </form>
    </section>
  );
}
