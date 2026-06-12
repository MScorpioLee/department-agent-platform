"use client";

import { Clipboard, KeyRound, Loader2, Trash2 } from "lucide-react";
import React, { FormEvent, useEffect, useState } from "react";

import {
  createPersonalApiKey,
  deletePersonalApiKey,
  listPersonalApiKeys
} from "@/lib/api-client";
import type { CreatePersonalApiKeyResponse, PersonalApiKey } from "@/lib/types";

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "请求失败";
}

function appendV1(url: string) {
  const trimmed = url.trim().replace(/\/+$/, "");
  return trimmed.endsWith("/v1") ? trimmed : `${trimmed}/v1`;
}

function defaultBaseUrl() {
  const configured = process.env.NEXT_PUBLIC_AGENT_SERVER_URL;
  if (configured?.trim()) return appendV1(configured);
  if (typeof window === "undefined") return "http://127.0.0.1:8700/v1";
  const protocol = window.location.protocol || "http:";
  const hostname = window.location.hostname || "127.0.0.1";
  return `${protocol}//${hostname}:8700/v1`;
}

async function copyText(value: string) {
  try {
    await navigator.clipboard?.writeText(value);
  } catch {
    // The value remains visible for manual selection when clipboard is unavailable.
  }
}

function formatTime(value: string | null) {
  if (!value) return "-";
  return new Date(value).toLocaleString();
}

export default function ApiAccessPage() {
  const [keys, setKeys] = useState<PersonalApiKey[]>([]);
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("http://127.0.0.1:8700/v1");
  const [createdKey, setCreatedKey] = useState<CreatePersonalApiKeyResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function refresh() {
    try {
      const nextKeys = await listPersonalApiKeys();
      setKeys(nextKeys);
      setError(null);
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setBaseUrl(defaultBaseUrl());
    void refresh();
  }, []);

  async function createKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setMessage(null);
    try {
      const key = await createPersonalApiKey({ name: name.trim() || undefined });
      setCreatedKey(key);
      setName("");
      setMessage("API Key 已创建");
      await refresh();
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setSubmitting(false);
    }
  }

  async function revokeKey(key: PersonalApiKey) {
    if (!window.confirm(`确认吊销 ${key.name || key.prefix}？`)) return;
    setError(null);
    setMessage(null);
    try {
      await deletePersonalApiKey(key.id);
      setMessage("API Key 已吊销");
      await refresh();
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    }
  }

  const sdkExample = `import OpenAI from "openai";\n\nconst client = new OpenAI({\n  baseURL: "${baseUrl}",\n  apiKey: process.env.AGENT_API_KEY\n});`;
  const curlExample = `curl ${baseUrl}/chat/completions \\\n  -H "Authorization: Bearer <ak_...>" \\\n  -H "Content-Type: application/json" \\\n  -d '{"model":"default","messages":[{"role":"user","content":"hi"}]}'`;

  return (
    <section className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-normal text-slate-950">API 接入</h1>
        <p className="mt-1 text-sm text-slate-500">个人 API Key 与 OpenAI 兼容中转站用法</p>
      </div>

      {error ? <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
      {message ? <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">{message}</div> : null}

      <div className="grid gap-5 lg:grid-cols-[360px_1fr]">
        <aside className="space-y-5">
          <form onSubmit={(event) => void createKey(event)} className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-2 text-base font-semibold text-slate-950">
              <KeyRound aria-hidden="true" className="h-5 w-5 text-slate-500" />
              新建 Key
            </div>
            <label className="mt-4 block space-y-1.5">
              <span className="text-sm font-medium text-slate-700">用途名</span>
              <input value={name} onChange={(event) => setName(event.target.value)} placeholder="local agent / ci" className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 shadow-sm outline-none placeholder:text-slate-400 focus:border-slate-900 focus:ring-2 focus:ring-slate-200" />
            </label>
            <button type="submit" disabled={submitting} className="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-slate-900 px-4 text-sm font-semibold text-white shadow-sm hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60">
              {submitting ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : null}
              创建 Key
            </button>
          </form>

          <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 shadow-sm">
            Key 等同账号凭据，泄露后请立即吊销；服务端只存哈希，丢失只能重建。
          </div>
        </aside>

        <section className="space-y-5">
          <div className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-base font-semibold text-slate-950">我的 API Key</h2>
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3">name</th>
                    <th className="px-4 py-3">prefix</th>
                    <th className="px-4 py-3">created</th>
                    <th className="px-4 py-3">last used</th>
                    <th className="px-4 py-3">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {loading ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-slate-500">加载中</td>
                    </tr>
                  ) : keys.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-slate-500">暂无 Key</td>
                    </tr>
                  ) : (
                    keys.map((key) => (
                      <tr key={key.id} className="hover:bg-slate-50">
                        <td className="whitespace-nowrap px-4 py-4 font-medium text-slate-950">{key.name || "-"}</td>
                        <td className="whitespace-nowrap px-4 py-4 font-mono text-xs text-slate-600">{key.prefix}</td>
                        <td className="whitespace-nowrap px-4 py-4 text-slate-600">{formatTime(key.created_at)}</td>
                        <td className="whitespace-nowrap px-4 py-4 text-slate-600">{formatTime(key.last_used_at)}</td>
                        <td className="whitespace-nowrap px-4 py-4">
                          <button type="button" onClick={() => void revokeKey(key)} className="inline-flex h-8 items-center gap-2 rounded-md border border-red-200 px-2 text-xs font-medium text-red-700 hover:bg-red-50">
                            <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
                            吊销 {key.name || key.prefix}
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-base font-semibold text-slate-950">接入说明</h2>
            <label className="mt-4 block space-y-1.5">
              <span className="text-sm font-medium text-slate-700">Base URL</span>
              <div className="flex gap-2">
                <input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} className="h-10 min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-3 font-mono text-sm text-slate-950 shadow-sm outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200" />
                <button type="button" onClick={() => void copyText(baseUrl)} className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50">
                  <Clipboard aria-hidden="true" className="h-4 w-4" />
                  复制
                </button>
              </div>
            </label>
            <div className="mt-4 grid gap-3 xl:grid-cols-2">
              <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                <div className="mb-2 text-xs font-semibold uppercase text-slate-500">OpenAI SDK</div>
                <pre className="overflow-auto whitespace-pre-wrap text-xs text-slate-700">{sdkExample}</pre>
                <button type="button" onClick={() => void copyText(sdkExample)} className="mt-3 inline-flex h-8 items-center gap-2 rounded-md border border-slate-300 bg-white px-2 text-xs font-medium text-slate-700 hover:bg-slate-50">
                  <Clipboard aria-hidden="true" className="h-3.5 w-3.5" />
                  复制
                </button>
              </div>
              <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                <div className="mb-2 text-xs font-semibold uppercase text-slate-500">curl</div>
                <pre className="overflow-auto whitespace-pre-wrap text-xs text-slate-700">{curlExample}</pre>
                <button type="button" onClick={() => void copyText(curlExample)} className="mt-3 inline-flex h-8 items-center gap-2 rounded-md border border-slate-300 bg-white px-2 text-xs font-medium text-slate-700 hover:bg-slate-50">
                  <Clipboard aria-hidden="true" className="h-3.5 w-3.5" />
                  复制
                </button>
              </div>
            </div>
            <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
              agent code 登录 Web 后即可使用登录态；第三方工具请使用个人 API Key。
            </div>
          </div>
        </section>
      </div>

      {createdKey ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
          <div className="w-full max-w-lg rounded-md border border-slate-200 bg-white p-5 shadow-xl">
            <h2 className="text-lg font-semibold text-slate-950">关闭后无法再次查看</h2>
            <p className="mt-1 text-sm text-slate-500">请立即复制并保存在安全位置。</p>
            <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3 font-mono text-sm text-slate-950">
              {createdKey.api_key}
            </div>
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button type="button" onClick={() => void copyText(createdKey.api_key)} className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50">
                <Clipboard aria-hidden="true" className="h-4 w-4" />
                复制 Key
              </button>
              <button type="button" onClick={() => setCreatedKey(null)} className="inline-flex h-10 items-center rounded-md bg-slate-900 px-4 text-sm font-semibold text-white shadow-sm hover:bg-slate-700">
                关闭一次性明文
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
