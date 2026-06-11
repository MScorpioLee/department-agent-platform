"use client";

import { Loader2, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import React, { FormEvent, useCallback, useEffect, useState } from "react";

import {
  createMachineGrant,
  listMachineGrants,
  listUsers,
  revokeGrant
} from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { formatDateTime, formatRelativeTime } from "@/lib/format";
import type { MachineGrant, User } from "@/lib/types";

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "请求失败";
}

function getStatus(error: unknown): number | undefined {
  return typeof error === "object" && error !== null ? (error as { status?: number }).status : undefined;
}

export function MachineAccessClient({ machineId }: { machineId: string }) {
  const [grants, setGrants] = useState<MachineGrant[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [granteeUserId, setGranteeUserId] = useState("");
  const [expiresInHours, setExpiresInHours] = useState("24");
  const [loading, setLoading] = useState(true);
  const [usersLoading, setUsersLoading] = useState(true);
  const [usersUnavailable, setUsersUnavailable] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [userError, setUserError] = useState<string | null>(null);

  const refreshGrants = useCallback(async () => {
    try {
      const items = await listMachineGrants(machineId);
      setGrants(items);
      setError(null);
    } catch (requestError) {
      const message = getErrorMessage(requestError);
      setError(getStatus(requestError) === 403 ? `无权管理该机器授权：${message}` : message);
    } finally {
      setLoading(false);
    }
  }, [machineId]);

  useEffect(() => {
    void refreshGrants();
  }, [refreshGrants]);

  useEffect(() => {
    let cancelled = false;

    listUsers()
      .then((items) => {
        if (cancelled) return;
        setUsers(items);
        if (!granteeUserId && items[0]) {
          setGranteeUserId(items[0].id);
        }
      })
      .catch((requestError) => {
        if (cancelled) return;
        setUsersUnavailable(true);
        setUserError(
          getStatus(requestError) === 403
            ? "当前账号不能读取用户列表，可手动输入 user_id。"
            : getErrorMessage(requestError)
        );
      })
      .finally(() => {
        if (!cancelled) {
          setUsersLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [granteeUserId]);

  async function handleCreateGrant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedUserId = granteeUserId.trim();
    const hours = Number(expiresInHours);
    if (!normalizedUserId || !Number.isFinite(hours) || hours <= 0) return;

    setSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      const created = await createMachineGrant(machineId, {
        grantee_user_id: normalizedUserId,
        expires_in_hours: hours
      });
      const normalizedGrant: MachineGrant = {
        grant_id: created.grant_id,
        grantee_user_id: created.grantee_user_id ?? normalizedUserId,
        granted_by_user_id: created.granted_by_user_id ?? "current_user",
        expires_at: created.expires_at,
        created_at: created.created_at ?? new Date().toISOString()
      };
      setGrants((current) => [normalizedGrant, ...current]);
      setSuccess("授权已创建");
    } catch (requestError) {
      const message = getErrorMessage(requestError);
      setError(getStatus(requestError) === 403 ? `无权创建授权：${message}` : message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRevoke(grantId: string) {
    setRevokingId(grantId);
    setError(null);
    setSuccess(null);
    try {
      await revokeGrant(grantId);
      setGrants((current) => current.filter((grant) => grant.grant_id !== grantId));
      setSuccess("授权已撤销");
    } catch (requestError) {
      const message = getErrorMessage(requestError);
      setError(getStatus(requestError) === 403 ? `无权撤销授权：${message}` : message);
    } finally {
      setRevokingId(null);
    }
  }

  const showManualUserInput = usersUnavailable || users.length === 0;

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-normal text-slate-950">机器授权</h1>
          <p className="mt-1 font-mono text-sm text-slate-500">{machineId}</p>
        </div>
        <button
          type="button"
          onClick={() => void refreshGrants()}
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

      {success ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
          {success}
        </div>
      ) : null}

      {userError ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {userError}
        </div>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[360px_1fr]">
        <form
          onSubmit={(event) => void handleCreateGrant(event)}
          className="rounded-md border border-slate-200 bg-white p-4 shadow-sm"
        >
          <div className="flex items-center gap-2 text-base font-semibold text-slate-950">
            <ShieldCheck aria-hidden="true" className="h-5 w-5 text-slate-500" />
            新增授权
          </div>
          <div className="mt-4 space-y-3">
            <label className="block space-y-1.5">
              <span className="text-sm font-medium text-slate-700">被授权用户</span>
              {showManualUserInput ? (
                <input
                  value={granteeUserId}
                  onChange={(event) => setGranteeUserId(event.target.value)}
                  placeholder="user_id"
                  className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-slate-900 focus:ring-2 focus:ring-slate-200"
                />
              ) : (
                <select
                  value={granteeUserId}
                  onChange={(event) => setGranteeUserId(event.target.value)}
                  disabled={usersLoading}
                  className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 shadow-sm outline-none transition focus:border-slate-900 focus:ring-2 focus:ring-slate-200 disabled:cursor-not-allowed disabled:bg-slate-100"
                >
                  {users.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.display_name || user.username} ({user.id})
                    </option>
                  ))}
                </select>
              )}
            </label>
            <label className="block space-y-1.5">
              <span className="text-sm font-medium text-slate-700">有效小时数</span>
              <input
                type="number"
                min={1}
                value={expiresInHours}
                onChange={(event) => setExpiresInHours(event.target.value)}
                className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 shadow-sm outline-none transition focus:border-slate-900 focus:ring-2 focus:ring-slate-200"
              />
            </label>
            <button
              type="submit"
              disabled={submitting || !granteeUserId.trim()}
              className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-slate-900 px-4 text-sm font-semibold text-white shadow-sm hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : null}
              新增授权
            </button>
          </div>
        </form>

        <section className="overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-4 py-3">
            <h2 className="text-base font-semibold text-slate-950">授权列表</h2>
            <p className="mt-1 text-xs text-slate-500">可撤销仍在有效期内的机器访问授权</p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Grant</th>
                  <th className="px-4 py-3">Grantee</th>
                  <th className="px-4 py-3">Granted By</th>
                  <th className="px-4 py-3">Expires</th>
                  <th className="px-4 py-3 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td className="px-4 py-8 text-center text-slate-500" colSpan={5}>
                      加载中
                    </td>
                  </tr>
                ) : grants.length === 0 ? (
                  <tr>
                    <td className="px-4 py-8 text-center text-slate-500" colSpan={5}>
                      暂无授权
                    </td>
                  </tr>
                ) : (
                  grants.map((grant) => (
                    <tr key={grant.grant_id} className="hover:bg-slate-50">
                      <td className="whitespace-nowrap px-4 py-4 font-mono text-xs text-slate-700">
                        {grant.grant_id}
                      </td>
                      <td className="whitespace-nowrap px-4 py-4 font-mono text-xs text-slate-700">
                        {grant.grantee_user_id}
                      </td>
                      <td className="whitespace-nowrap px-4 py-4 font-mono text-xs text-slate-600">
                        {grant.granted_by_user_id}
                      </td>
                      <td className="whitespace-nowrap px-4 py-4 text-slate-600">
                        <div>{formatRelativeTime(grant.expires_at)}</div>
                        <div className="text-xs text-slate-400">{formatDateTime(grant.expires_at)}</div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-4 text-right">
                        <button
                          type="button"
                          aria-label={`撤销 ${grant.grant_id}`}
                          onClick={() => void handleRevoke(grant.grant_id)}
                          disabled={revokingId !== null}
                          className="inline-flex h-9 items-center gap-2 rounded-md border border-red-200 bg-white px-3 text-sm font-medium text-red-700 shadow-sm hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {revokingId === grant.grant_id ? (
                            <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
                          ) : (
                            <Trash2 aria-hidden="true" className="h-4 w-4" />
                          )}
                          撤销
                        </button>
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
