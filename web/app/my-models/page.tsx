"use client";

import { Bot, Clipboard, Loader2, LogOut } from "lucide-react";
import React, { useEffect, useState } from "react";

import {
  deleteMyModelLogin,
  listMyModelLogins,
  pollMyModelLoginDevice,
  startMyModelLoginDevice
} from "@/lib/api-client";
import { cn } from "@/lib/cn";
import type { MyModelLogin } from "@/lib/types";

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "请求失败";
}

async function copyText(value: string) {
  try {
    await navigator.clipboard?.writeText(value);
  } catch {
    // Visible code remains available for manual copy.
  }
}

function formatTime(value: string | null) {
  if (!value) return "-";
  return new Date(value).toLocaleString();
}

type LoginDialog = {
  backendId: string;
  backendName: string;
  verificationUri: string;
  userCode: string;
  status: "pending" | "authorized";
};

export default function MyModelsPage() {
  const [logins, setLogins] = useState<MyModelLogin[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyBackendId, setBusyBackendId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<LoginDialog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function refresh() {
    try {
      const nextLogins = await listMyModelLogins();
      setLogins(nextLogins);
      setError(null);
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function pollUntilAuthorized(backendId: string) {
    try {
      for (let attempt = 0; attempt < 30; attempt += 1) {
        const response = await pollMyModelLoginDevice(backendId);
        if (response.status === "authorized") {
          setDialog((current) =>
            current?.backendId === backendId ? { ...current, status: "authorized" } : current
          );
          setMessage("模型登录已完成");
          await refresh();
          return;
        }
        await new Promise((resolve) => window.setTimeout(resolve, attempt === 0 ? 0 : 1000));
      }
      setError("模型登录超时，请稍后重试");
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    }
  }

  async function startLogin(login: MyModelLogin) {
    setBusyBackendId(login.backend_id);
    setError(null);
    setMessage(null);
    try {
      const response = await startMyModelLoginDevice(login.backend_id);
      setDialog({
        backendId: login.backend_id,
        backendName: login.name,
        verificationUri: response.verification_uri,
        userCode: response.user_code,
        status: "pending"
      });
      void pollUntilAuthorized(login.backend_id);
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setBusyBackendId(null);
    }
  }

  async function logout(login: MyModelLogin) {
    setBusyBackendId(login.backend_id);
    setError(null);
    setMessage(null);
    try {
      await deleteMyModelLogin(login.backend_id);
      setMessage("模型登录已注销");
      await refresh();
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setBusyBackendId(null);
    }
  }

  return (
    <section className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-normal text-slate-950">我的模型登录</h1>
        <p className="mt-1 text-sm text-slate-500">用你自己的订阅，只用于你自己的会话</p>
      </div>

      {error ? <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
      {message ? <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">{message}</div> : null}

      <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        per_user 表示个人使用自己的订阅；不要把一个订阅账号做成全员共用。
      </div>

      <section className="overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-4 py-3">
          <h2 className="text-base font-semibold text-slate-950">可登录模型</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">名称</th>
                <th className="px-4 py-3">model</th>
                <th className="px-4 py-3">runtime</th>
                <th className="px-4 py-3">状态</th>
                <th className="px-4 py-3">更新时间</th>
                <th className="px-4 py-3">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-500">加载中</td>
                </tr>
              ) : logins.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-500">暂无需要个人登录的模型</td>
                </tr>
              ) : (
                logins.map((login) => (
                  <tr key={login.backend_id} className="hover:bg-slate-50">
                    <td className="whitespace-nowrap px-4 py-4 font-medium text-slate-950">
                      <span className="inline-flex items-center gap-2">
                        <Bot aria-hidden="true" className="h-4 w-4 text-slate-500" />
                        {login.name}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-4 font-mono text-xs text-slate-600">{login.model}</td>
                    <td className="whitespace-nowrap px-4 py-4 font-mono text-xs text-slate-600">{login.runtime}</td>
                    <td className="whitespace-nowrap px-4 py-4">
                      <span className={cn("rounded-md border px-2 py-1 text-xs font-medium", login.logged_in ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-700")}>
                        {login.logged_in ? "已登录" : "未登录"}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-4 text-slate-600">{formatTime(login.updated_at)}</td>
                    <td className="whitespace-nowrap px-4 py-4">
                      {login.logged_in ? (
                        <button type="button" onClick={() => void logout(login)} disabled={busyBackendId === login.backend_id} className="inline-flex h-8 items-center gap-2 rounded-md border border-slate-300 px-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60">
                          <LogOut aria-hidden="true" className="h-3.5 w-3.5" />
                          注销 {login.name}
                        </button>
                      ) : (
                        <button type="button" onClick={() => void startLogin(login)} disabled={busyBackendId === login.backend_id} className="inline-flex h-8 items-center gap-2 rounded-md bg-slate-900 px-3 text-xs font-semibold text-white shadow-sm hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60">
                          {busyBackendId === login.backend_id ? <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" /> : null}
                          用我的订阅登录 {login.name}
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {dialog ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
          <div className="w-full max-w-lg rounded-md border border-slate-200 bg-white p-5 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-950">用我的订阅登录 {dialog.backendName}</h2>
                <p className="mt-1 text-sm text-slate-500">在浏览器打开验证地址并输入此码</p>
              </div>
              <button type="button" onClick={() => setDialog(null)} className="rounded-md border border-slate-300 px-2 py-1 text-sm text-slate-700 hover:bg-slate-50">
                关闭
              </button>
            </div>
            <div className="mt-4 space-y-3">
              <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                <div className="text-xs font-medium uppercase text-slate-500">verification_uri</div>
                <div className="mt-1 break-all font-mono text-sm text-slate-900">{dialog.verificationUri}</div>
                <button type="button" onClick={() => void copyText(dialog.verificationUri)} className="mt-2 inline-flex h-8 items-center gap-2 rounded-md border border-slate-300 bg-white px-2 text-xs font-medium text-slate-700 hover:bg-slate-50">
                  <Clipboard aria-hidden="true" className="h-3.5 w-3.5" />
                  复制地址
                </button>
              </div>
              <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                <div className="text-xs font-medium uppercase text-slate-500">user_code</div>
                <div className="mt-1 font-mono text-lg font-semibold text-slate-950">{dialog.userCode}</div>
                <button type="button" onClick={() => void copyText(dialog.userCode)} className="mt-2 inline-flex h-8 items-center gap-2 rounded-md border border-slate-300 bg-white px-2 text-xs font-medium text-slate-700 hover:bg-slate-50">
                  <Clipboard aria-hidden="true" className="h-3.5 w-3.5" />
                  复制 code
                </button>
              </div>
              <div className={cn("rounded-md border px-3 py-2 text-sm font-medium", dialog.status === "authorized" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-700")}>
                {dialog.status === "authorized" ? "已登录" : "等待登录"}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
