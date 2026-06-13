"use client";

import { Check, Loader2, RefreshCw, UserPlus, X } from "lucide-react";
import React, { FormEvent, useCallback, useEffect, useState } from "react";

import { AdminGuard } from "@/components/admin-guard";
import {
  approveRegistration,
  createUser,
  listRegistrations,
  listUsers,
  rejectRegistration
} from "@/lib/api-client";
import type { Registration, User } from "@/lib/types";

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return "请求失败";
}

function AdminUsersContent() {
  const [users, setUsers] = useState<User[]>([]);
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [registrationAction, setRegistrationAction] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<"user" | "admin">("user");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refreshUsers = useCallback(async () => {
    try {
      const [items, pendingItems] = await Promise.all([listUsers(), listRegistrations()]);
      setUsers(items);
      setRegistrations(pendingItems);
      setError(null);
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshUsers();
  }, [refreshUsers]);

  async function submitUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setMessage(null);
    try {
      await createUser({
        username: username.trim(),
        password,
        display_name: displayName.trim(),
        role
      });
      setUsername("");
      setPassword("");
      setDisplayName("");
      setRole("user");
      setMessage("用户已创建");
      await refreshUsers();
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRegistration(registration: Registration, action: "approve" | "reject") {
    setRegistrationAction(`${registration.id}:${action}`);
    setError(null);
    setMessage(null);
    try {
      if (action === "approve") {
        await approveRegistration(registration.id);
        setMessage("注册已通过");
      } else {
        await rejectRegistration(registration.id);
        setMessage("注册已拒绝");
      }
      await refreshUsers();
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setRegistrationAction(null);
    }
  }

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-normal text-slate-950">用户管理</h1>
          <p className="mt-1 text-sm text-slate-500">创建平台账号并查看现有用户</p>
        </div>
        <button
          type="button"
          onClick={() => void refreshUsers()}
          className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
        >
          <RefreshCw aria-hidden="true" className="h-4 w-4" />
          刷新
        </button>
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

      <section className="overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <div>
            <h2 className="text-base font-semibold text-slate-950">待审批注册</h2>
            <p className="mt-0.5 text-xs text-slate-500">通过后账号会进入用户列表</p>
          </div>
          <span className="inline-flex min-w-7 items-center justify-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
            {registrations.length}
          </span>
        </div>

        {loading ? (
          <div className="px-4 py-8 text-sm text-slate-500">加载中</div>
        ) : registrations.length === 0 ? (
          <div className="px-4 py-8 text-sm text-slate-500">暂无待审批注册</div>
        ) : (
          <div className="divide-y divide-slate-100">
            {registrations.map((registration) => {
              const approving = registrationAction === `${registration.id}:approve`;
              const rejecting = registrationAction === `${registration.id}:reject`;
              return (
                <div
                  key={registration.id}
                  className="grid gap-3 px-4 py-4 md:grid-cols-[minmax(160px,1fr)_minmax(180px,1.3fr)_auto] md:items-center"
                >
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-slate-950">{registration.username}</span>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                        pending
                      </span>
                    </div>
                    <div className="mt-1 text-sm text-slate-500">
                      {registration.display_name || "-"}
                    </div>
                  </div>
                  <div className="text-sm text-slate-600">
                    <div>{registration.note || "未填写申请说明"}</div>
                    <div className="mt-1 text-xs text-slate-400">{registration.created_at}</div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      aria-label={`通过 ${registration.username}`}
                      disabled={registrationAction !== null}
                      onClick={() => void handleRegistration(registration, "approve")}
                      className="inline-flex h-9 items-center gap-1.5 rounded-md bg-emerald-600 px-3 text-sm font-medium text-white shadow-sm hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {approving ? (
                        <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
                      ) : (
                        <Check aria-hidden="true" className="h-4 w-4" />
                      )}
                      通过
                    </button>
                    <button
                      type="button"
                      aria-label={`拒绝 ${registration.username}`}
                      disabled={registrationAction !== null}
                      onClick={() => void handleRegistration(registration, "reject")}
                      className="inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {rejecting ? (
                        <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
                      ) : (
                        <X aria-hidden="true" className="h-4 w-4" />
                      )}
                      拒绝
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <div className="grid gap-5 xl:grid-cols-[360px_1fr]">
        <form onSubmit={(event) => void submitUser(event)} className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2 text-base font-semibold text-slate-950">
            <UserPlus aria-hidden="true" className="h-5 w-5 text-slate-500" />
            新建用户
          </div>
          <div className="mt-4 space-y-3">
            <label className="block space-y-1.5">
              <span className="text-sm font-medium text-slate-700">用户名</span>
              <input
                required
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 shadow-sm outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200"
              />
            </label>
            <label className="block space-y-1.5">
              <span className="text-sm font-medium text-slate-700">密码</span>
              <input
                required
                minLength={6}
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 shadow-sm outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200"
              />
            </label>
            <label className="block space-y-1.5">
              <span className="text-sm font-medium text-slate-700">显示名</span>
              <input
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 shadow-sm outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200"
              />
            </label>
            <label className="block space-y-1.5">
              <span className="text-sm font-medium text-slate-700">角色</span>
              <select
                value={role}
                onChange={(event) => setRole(event.target.value as "user" | "admin")}
                className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 shadow-sm outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200"
              >
                <option value="user">user</option>
                <option value="admin">admin</option>
              </select>
            </label>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-slate-900 px-4 text-sm font-semibold text-white shadow-sm hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : null}
              新建用户
            </button>
          </div>
        </form>

        <section className="overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-4 py-3">
            <h2 className="text-base font-semibold text-slate-950">用户列表</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">用户名</th>
                  <th className="px-4 py-3">显示名</th>
                  <th className="px-4 py-3">角色</th>
                  <th className="px-4 py-3">状态</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td className="px-4 py-8 text-center text-slate-500" colSpan={4}>
                      加载中
                    </td>
                  </tr>
                ) : users.length === 0 ? (
                  <tr>
                    <td className="px-4 py-8 text-center text-slate-500" colSpan={4}>
                      暂无用户
                    </td>
                  </tr>
                ) : (
                  users.map((user) => (
                    <tr key={user.id} className="hover:bg-slate-50">
                      <td className="whitespace-nowrap px-4 py-4 font-medium text-slate-950">{user.username}</td>
                      <td className="whitespace-nowrap px-4 py-4 text-slate-600">{user.display_name || "-"}</td>
                      <td className="whitespace-nowrap px-4 py-4 text-slate-600">{user.role}</td>
                      <td className="whitespace-nowrap px-4 py-4">
                        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                          {user.status || "active"}
                        </span>
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

export default function AdminUsersPage() {
  return (
    <AdminGuard>
      <AdminUsersContent />
    </AdminGuard>
  );
}
