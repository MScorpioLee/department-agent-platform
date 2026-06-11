"use client";

import React, { useEffect, useState } from "react";

import { getMe } from "@/lib/api-client";
import type { User } from "@/lib/types";

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "权限检查失败";
}

export function AdminGuard({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    getMe()
      .then((currentUser) => {
        if (!cancelled) {
          setUser(currentUser);
          setError(null);
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
  }, []);

  if (loading) {
    return <div className="text-sm text-slate-500">加载中</div>;
  }

  if (error) {
    return (
      <section className="rounded-md border border-red-200 bg-red-50 p-5 text-sm text-red-700">
        {error}
      </section>
    );
  }

  if (user?.role !== "admin") {
    return (
      <section className="rounded-md border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800">
        无权限
      </section>
    );
  }

  return <>{children}</>;
}
