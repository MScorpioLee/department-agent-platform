"use client";

import { KeyRound, Loader2 } from "lucide-react";
import React, { FormEvent, useEffect, useMemo, useState } from "react";

import { AdminGuard } from "@/components/admin-guard";
import { createEnrollmentToken, listUsers } from "@/lib/api-client";
import { isDesktopClient } from "@/lib/client-target";
import { getDesktopServerUrl } from "@/lib/desktop-bridge";
import type { EnrollmentTokenResponse, User } from "@/lib/types";

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "请求失败";
}

function AdminOnboardingContent() {
  const [users, setUsers] = useState<User[]>([]);
  const [ownerUserId, setOwnerUserId] = useState("");
  const [maxUses, setMaxUses] = useState("1");
  const [expiresInDays, setExpiresInDays] = useState("7");
  const [serverUrl, setServerUrl] = useState("http://127.0.0.1:8700");
  const [result, setResult] = useState<EnrollmentTokenResponse | null>(null);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listUsers()
      .then((items) => {
        if (!cancelled) {
          setUsers(items);
        }
      })
      .catch((requestError) => {
        if (!cancelled) {
          setError(getErrorMessage(requestError));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingUsers(false);
        }
      });

    if (isDesktopClient()) {
      getDesktopServerUrl()
        .then((value) => {
          if (!cancelled && value) {
            setServerUrl(value);
          }
        })
        .catch(() => undefined);
    } else if (process.env.NEXT_PUBLIC_AGENT_SERVER_URL) {
      setServerUrl(process.env.NEXT_PUBLIC_AGENT_SERVER_URL);
    }

    return () => {
      cancelled = true;
    };
  }, []);

  const runnerConfig = useMemo(() => {
    const token = result?.enrollment_token ?? "<签发后自动填入>";
    return [
      "# runner/config.yaml",
      `server_url: ${serverUrl}`,
      "machine_name: <本机名>",
      `enrollment_token: ${token}`,
      "allowed_roots:",
      "  - <填写本机可被操作的目录>"
    ].join("\n");
  }, [result?.enrollment_token, serverUrl]);

  async function submitToken(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedMaxUses = Number(maxUses);
    const normalizedExpiresInDays = Number(expiresInDays);
    if (!Number.isFinite(normalizedMaxUses) || normalizedMaxUses <= 0) return;
    if (!Number.isFinite(normalizedExpiresInDays) || normalizedExpiresInDays <= 0) return;

    setSubmitting(true);
    setError(null);
    setResult(null);
    try {
      const created = await createEnrollmentToken({
        owner_user_id: ownerUserId || undefined,
        max_uses: normalizedMaxUses,
        expires_in_days: normalizedExpiresInDays
      });
      setResult(created);
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-normal text-slate-950">上线引导</h1>
        <p className="mt-1 text-sm text-slate-500">签发 enrollment token 并生成 Runner 配置片段</p>
      </div>

      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[360px_1fr]">
        <form onSubmit={(event) => void submitToken(event)} className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2 text-base font-semibold text-slate-950">
            <KeyRound aria-hidden="true" className="h-5 w-5 text-slate-500" />
            签发 enrollment token
          </div>
          <div className="mt-4 space-y-3">
            <label className="block space-y-1.5">
              <span className="text-sm font-medium text-slate-700">归属用户</span>
              <select
                value={ownerUserId}
                disabled={loadingUsers}
                onChange={(event) => setOwnerUserId(event.target.value)}
                className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 shadow-sm outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200 disabled:cursor-not-allowed disabled:bg-slate-100"
              >
                <option value="">无主</option>
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.display_name || user.username} ({user.id})
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1.5">
              <span className="text-sm font-medium text-slate-700">max_uses</span>
              <input
                required
                min={1}
                type="number"
                value={maxUses}
                onChange={(event) => setMaxUses(event.target.value)}
                className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 shadow-sm outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200"
              />
            </label>
            <label className="block space-y-1.5">
              <span className="text-sm font-medium text-slate-700">有效天数</span>
              <input
                required
                min={1}
                type="number"
                value={expiresInDays}
                onChange={(event) => setExpiresInDays(event.target.value)}
                className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 shadow-sm outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200"
              />
            </label>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-slate-900 px-4 text-sm font-semibold text-white shadow-sm hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : null}
              签发 token
            </button>
          </div>
        </form>

        <section className="space-y-4">
          {result ? (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-4">
              <div className="text-sm font-semibold text-amber-900">仅此一次，请立即复制</div>
              <div className="mt-2 break-all rounded-md bg-white px-3 py-2 font-mono text-sm text-slate-950">
                {result.enrollment_token}
              </div>
            </div>
          ) : null}

          <div className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-base font-semibold text-slate-950">Runner 上线指引</h2>
            <pre className="mt-3 overflow-auto rounded-md bg-slate-950 p-3 font-mono text-xs leading-5 text-slate-100">
              {runnerConfig}
            </pre>
            <p className="mt-3 text-sm text-slate-600">
              装好 Runner 后执行 <code className="font-mono">python -m agent_runner --config config.yaml</code> 自动注册。
            </p>
          </div>
        </section>
      </div>
    </section>
  );
}

export default function OnboardingPage() {
  return (
    <AdminGuard>
      <AdminOnboardingContent />
    </AdminGuard>
  );
}
