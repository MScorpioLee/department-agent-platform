"use client";

import {
  Bot,
  BookOpen,
  ClipboardList,
  Code2,
  KeyRound,
  LogOut,
  MessageSquare,
  Plug,
  Server,
  Settings,
  ShieldCheck,
  TerminalSquare,
  UserCircle,
  Users
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import React from "react";
import { useEffect, useState } from "react";

import { getMe, logout } from "@/lib/api-client";
import { isCoderProfile, isDesktopClient } from "@/lib/client-target";
import { cn } from "@/lib/cn";
import type { User } from "@/lib/types";

const navItems = [
  { href: "/chat", label: "对话", icon: MessageSquare, section: "workspace" },
  { href: "/desktop-agent", label: "编码 Agent", icon: Code2, desktopOnly: true, section: "workspace" },
  { href: "/skills", label: "技能", icon: BookOpen, section: "workspace" },
  { href: "/api-access", label: "API 接入", icon: KeyRound, section: "workspace" },
  { href: "/my-models", label: "模型登录", icon: Bot, section: "workspace" },
  { href: "/approvals", label: "审批", icon: ShieldCheck, section: "workspace" },
  { href: "/machines", label: "机器", icon: Server, section: "developer" },
  { href: "/console", label: "控制台", icon: TerminalSquare, section: "developer" },
  { href: "/settings", label: "设置", icon: Settings, desktopOnly: true, section: "developer" },
  { href: "/admin/users", label: "用户", icon: Users, adminOnly: true, section: "admin" },
  { href: "/admin/onboarding", label: "上线", icon: KeyRound, adminOnly: true, section: "admin" },
  { href: "/admin/models", label: "模型", icon: Bot, adminOnly: true, section: "admin" },
  { href: "/admin/connectors", label: "连接器", icon: Plug, adminOnly: true, section: "admin" },
  { href: "/audit", label: "审计", icon: ClipboardList, adminOnly: true, section: "admin" }
];

const navSections = [
  { id: "workspace", label: "工作台" },
  { id: "developer", label: "开发者端" },
  { id: "admin", label: "管理端" }
];

function normalizePathname(pathname: string) {
  return pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
}

function uiModeForPathname(pathname: string) {
  if (
    pathname.startsWith("/admin") ||
    pathname === "/audit" ||
    pathname.startsWith("/machines") ||
    pathname === "/console" ||
    pathname === "/settings"
  ) {
    return "developer";
  }
  return "user";
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const normalizedPathname = normalizePathname(pathname);
  const isLoginPage = normalizedPathname === "/login";
  const desktopClient = isDesktopClient();
  const coderProfile = isCoderProfile();
  const uiMode = uiModeForPathname(normalizedPathname);
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

  useEffect(() => {
    if (!coderProfile || isLoginPage || checkingAuth) return;
    if (normalizedPathname !== "/desktop-agent") {
      router.replace("/desktop-agent");
    }
  }, [checkingAuth, coderProfile, isLoginPage, normalizedPathname, router]);

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
      <main data-ui-mode="user" className="min-h-screen bg-slate-100 px-4 py-8 text-slate-950">
        <div className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-md items-center">
          {children}
        </div>
      </main>
    );
  }

  if (coderProfile) {
    const shouldShowCoderWorkspace = !checkingAuth && normalizedPathname === "/desktop-agent";
    return (
      <div data-ui-mode="coder" className="min-h-screen bg-slate-950 text-slate-950">
        <header className="flex h-12 items-center justify-between border-b border-slate-800 bg-slate-950 px-4 text-white">
          <div className="inline-flex min-w-0 items-center gap-2">
            <Code2 aria-hidden="true" className="h-4 w-4 text-slate-400" />
            <span className="truncate text-sm font-semibold">Agent Coder</span>
          </div>
          <div className="flex min-w-0 items-center gap-3">
            {user ? (
              <div className="inline-flex min-w-0 items-center gap-2 text-sm text-slate-300">
                <UserCircle aria-hidden="true" className="h-4 w-4 shrink-0 text-slate-500" />
                <span className="truncate font-medium">{user.display_name || user.username}</span>
              </div>
            ) : null}
            <button
              type="button"
              onClick={() => void handleLogout()}
              disabled={loggingOut}
              className="inline-flex h-8 items-center gap-2 rounded-md border border-slate-700 bg-slate-900 px-3 text-xs font-medium text-slate-200 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <LogOut aria-hidden="true" className="h-4 w-4" />
              登出
            </button>
          </div>
        </header>
        <main className="h-[calc(100vh-3rem)] min-h-0 overflow-hidden bg-slate-100">
          {shouldShowCoderWorkspace ? children : <div className="p-4 text-sm text-slate-500">加载中</div>}
        </main>
      </div>
    );
  }

  const visibleNavItems = navItems.filter((item) => {
    if (item.adminOnly && user?.role !== "admin") return false;
    if (item.desktopOnly && !desktopClient) return false;
    return true;
  });

  return (
    <div data-ui-mode={uiMode} className="app-shell-root min-h-screen bg-slate-100 text-slate-950 lg:flex">
      <aside className="app-sidebar border-b border-slate-200 bg-white lg:fixed lg:inset-y-0 lg:left-0 lg:w-64 lg:border-b-0 lg:border-r">
        <div className="app-brand flex h-16 items-center border-b border-slate-200 px-5">
          <div className="app-brand-mark" aria-hidden="true" />
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-slate-950">Agent 控制台</div>
            <div className="truncate text-xs text-slate-500">
              {uiMode === "developer" ? "开发管理" : "AI 工作台"}
            </div>
          </div>
        </div>
        <nav className="app-nav flex gap-2 overflow-x-auto p-3 lg:block lg:space-y-5 lg:overflow-visible">
          {navSections.map((section) => {
            const sectionItems = visibleNavItems.filter((item) => item.section === section.id);
            if (sectionItems.length === 0) return null;
            return (
              <div key={section.id} className="app-nav-section lg:space-y-1">
                <div className="app-nav-section-label hidden px-3 pb-1 text-[11px] font-semibold uppercase text-slate-400 lg:block">
                  {section.label}
                </div>
                <div className="flex gap-2 lg:block lg:space-y-1">
                  {sectionItems.map((item) => {
                    const active = normalizedPathname === item.href || normalizedPathname.startsWith(`${item.href}/`);
                    const Icon = item.icon;
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={cn(
                          "app-nav-link inline-flex h-10 items-center gap-2 rounded-md px-3 text-sm font-medium transition",
                          active
                            ? "app-nav-link-active bg-slate-900 text-white"
                            : "text-slate-600 hover:bg-slate-100 hover:text-slate-950"
                        )}
                      >
                        <Icon aria-hidden="true" className="h-4 w-4" />
                        <span>{item.label}</span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>
      </aside>
      <main className="min-w-0 flex-1 lg:pl-64">
        <header className="app-topbar border-b border-slate-200 bg-white">
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
