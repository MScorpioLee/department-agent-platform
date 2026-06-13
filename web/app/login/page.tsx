"use client";

import { CheckCircle2, Loader2, LogIn, UserPlus } from "lucide-react";
import React from "react";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

import { login, registerUser } from "@/lib/api-client";
import { isCoderProfile, isDesktopClient } from "@/lib/client-target";

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return "登录失败";
}

export default function LoginPage() {
  const router = useRouter();
  const desktopClient = isDesktopClient();
  const coderProfile = isCoderProfile();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [serverUrl, setServerUrl] = useState("http://127.0.0.1:8700");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function switchMode(nextMode: "login" | "register") {
    setMode(nextMode);
    setError(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    setSubmitting(true);

    try {
      if (mode === "register") {
        const response = await registerUser(
          {
            username: username.trim(),
            password,
            display_name: displayName.trim(),
            note: note.trim()
          },
          desktopClient ? { serverUrl } : {}
        );
        setPassword("");
        setDisplayName("");
        setNote("");
        setSuccess(response.message);
        setMode("login");
      } else {
        if (desktopClient) {
          await login(username, password, { serverUrl });
        } else {
          await login(username, password);
        }
        router.replace(coderProfile ? "/desktop-agent" : "/machines");
      }
    } catch (loginError) {
      setError(getErrorMessage(loginError));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="w-full rounded-md border border-slate-200 bg-white p-6 shadow-sm">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-normal text-slate-950">
          {mode === "login" ? "登录" : "注册"}
        </h1>
        <p className="mt-1 text-sm text-slate-500">Agent 控制台</p>
      </div>

      <div
        role="tablist"
        aria-label="认证方式"
        className="mb-5 grid grid-cols-2 rounded-md bg-slate-100 p-1 text-sm font-medium text-slate-600"
      >
        <button
          role="tab"
          type="button"
          aria-selected={mode === "login"}
          onClick={() => switchMode("login")}
          className={`h-9 rounded-md transition ${
            mode === "login" ? "bg-white text-slate-950 shadow-sm" : "hover:text-slate-950"
          }`}
        >
          登录
        </button>
        <button
          role="tab"
          type="button"
          aria-selected={mode === "register"}
          onClick={() => switchMode("register")}
          className={`h-9 rounded-md transition ${
            mode === "register" ? "bg-white text-slate-950 shadow-sm" : "hover:text-slate-950"
          }`}
        >
          注册
        </button>
      </div>

      <form onSubmit={(event) => void handleSubmit(event)} className="space-y-4">
        {desktopClient ? (
          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-slate-700">Server 地址</span>
            <input
              required
              type="url"
              value={serverUrl}
              onChange={(event) => setServerUrl(event.target.value)}
              className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-slate-900 focus:ring-2 focus:ring-slate-200"
            />
          </label>
        ) : null}

        <label className="block space-y-1.5">
          <span className="text-sm font-medium text-slate-700">用户名</span>
          <input
            required
            autoComplete={mode === "login" ? "username" : "new-username"}
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-slate-900 focus:ring-2 focus:ring-slate-200"
          />
        </label>

        <label className="block space-y-1.5">
          <span className="text-sm font-medium text-slate-700">密码</span>
          <input
            required
            minLength={mode === "register" ? 6 : undefined}
            type="password"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-slate-900 focus:ring-2 focus:ring-slate-200"
          />
        </label>

        {mode === "register" ? (
          <>
            <label className="block space-y-1.5">
              <span className="text-sm font-medium text-slate-700">显示名</span>
              <input
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-slate-900 focus:ring-2 focus:ring-slate-200"
              />
            </label>

            <label className="block space-y-1.5">
              <span className="text-sm font-medium text-slate-700">申请说明</span>
              <textarea
                rows={3}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                className="w-full resize-none rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-slate-900 focus:ring-2 focus:ring-slate-200"
              />
            </label>
          </>
        ) : null}

        {success ? (
          <div className="flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800">
            <CheckCircle2 aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{success}</span>
          </div>
        ) : null}

        {error ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        <button
          type="submit"
          disabled={submitting}
          className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-slate-900 px-4 text-sm font-semibold text-white shadow-sm hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {submitting ? (
            <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
          ) : mode === "register" ? (
            <UserPlus aria-hidden="true" className="h-4 w-4" />
          ) : (
            <LogIn aria-hidden="true" className="h-4 w-4" />
          )}
          {mode === "register" ? "提交注册" : "登录"}
        </button>
      </form>
    </section>
  );
}
