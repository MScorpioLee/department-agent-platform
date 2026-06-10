"use client";

import { ClipboardList, LogOut, MessageSquare, Server, ShieldCheck, TerminalSquare, UserCircle } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import React from "react";
import { useEffect, useState } from "react";

import { getMe, logout } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import type { User } from "@/lib/types";

const navItems = [
  { href: "/machines", label: "机器", icon: Server },
  { href: "/console", label: "控制台", icon: TerminalSquare },
  { href: "/chat", label: "对话", icon: MessageSquare },
  { href: "/approvals", label: "审批", icon: ShieldCheck },
  { href: "/audit", label: "审计", icon: ClipboardList, adminOnly: true }
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const isLoginPage = pathname === "/login";
  const [user, setUser] = useState<User | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(!isLoginPage);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    if (isLoginPage) {
      setUser(null);
      setCheckingAuth(false);
      return;
    }

    let cancelled = false;
    setCheckingAuth(true);

    getMe()
      .then((currentUser) => {
        if (!cancelled) {
          setUser(currentUser);
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const status = typeof error === "object" && error !== null ? (error as { status?: number }).status : undefined;
        if (status === 401) {
          router.replace("/login");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setCheckingAuth(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isLoginPage, pathname, router]);

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await logout();
      setUser(null);
      router.replace("/login");
    } finally {
      setLoggingOut(false);
    }
  }

  if (isLoginPage) {
    return (
      <main className="min-h-screen bg-slate-100 px-4 py-8 text-slate-950">
        <div className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-md items-center">
          {children}
        </div>
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 text-slate-950 lg:flex">
      <aside className="border-b border-slate-200 bg-white lg:fixed lg:inset-y-0 lg:left-0 lg:w-64 lg:border-b-0 lg:border-r">
        <div className="flex h-16 items-center border-b border-slate-200 px-5">
          <div>
            <div className="text-sm font-semibold text-slate-950">Agent 控制台</div>
            <div className="text-xs text-slate-500">运维调试</div>
          </div>
        </div>
        <nav className="flex gap-2 p-3 lg:block lg:space-y-1">
          {navItems.filter((item) => !item.adminOnly || user?.role === "admin").map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "inline-flex h-10 items-center gap-2 rounded-md px-3 text-sm font-medium transition",
                  active
                    ? "bg-slate-900 text-white"
                    : "text-slate-600 hover:bg-slate-100 hover:text-slate-950"
                )}
              >
                <Icon aria-hidden="true" className="h-4 w-4" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </aside>
      <main className="min-w-0 flex-1 lg:pl-64">
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex h-14 w-full max-w-7xl items-center justify-end gap-3 px-4 sm:px-6 lg:px-8">
            {user ? (
              <div className="inline-flex min-w-0 items-center gap-2 text-sm text-slate-700">
                <UserCircle aria-hidden="true" className="h-4 w-4 shrink-0 text-slate-500" />
                <span className="truncate font-medium">{user.display_name || user.username}</span>
              </div>
            ) : null}
            <button
              type="button"
              onClick={() => void handleLogout()}
              disabled={loggingOut}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <LogOut aria-hidden="true" className="h-4 w-4" />
              登出
            </button>
          </div>
        </header>
        <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          {checkingAuth ? <div className="text-sm text-slate-500">加载中</div> : children}
        </div>
      </main>
    </div>
  );
}
