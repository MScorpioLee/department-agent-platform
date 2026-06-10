"use client";

import { RefreshCw, Send, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { listMachines } from "@/lib/api-client";
import { formatRelativeTime } from "@/lib/format";
import type { Machine } from "@/lib/types";
import { MachineStatusBadge } from "@/components/status-badge";

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "请求失败";
}

export default function MachinesPage() {
  const [machines, setMachines] = useState<Machine[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const items = await listMachines();
      setMachines(items);
      setError(null);
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), 5000);
    return () => window.clearInterval(interval);
  }, [refresh]);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-normal text-slate-950">机器列表</h1>
          <p className="mt-1 text-sm text-slate-500">Runner 在线状态与工具能力</p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
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

      <div className="overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">机器名</th>
                <th className="px-4 py-3">OS</th>
                <th className="px-4 py-3">状态</th>
                <th className="px-4 py-3">最后心跳</th>
                <th className="px-4 py-3">Capabilities</th>
                <th className="px-4 py-3 text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td className="px-4 py-8 text-center text-slate-500" colSpan={6}>
                    加载中
                  </td>
                </tr>
              ) : machines.length === 0 ? (
                <tr>
                  <td className="px-4 py-8 text-center text-slate-500" colSpan={6}>
                    暂无机器
                  </td>
                </tr>
              ) : (
                machines.map((machine) => (
                  <tr key={machine.machine_id} className="hover:bg-slate-50">
                    <td className="whitespace-nowrap px-4 py-4">
                      <div className="font-medium text-slate-950">{machine.machine_name}</div>
                      <div className="text-xs text-slate-500">{machine.machine_id}</div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-4 text-slate-600">{machine.os}</td>
                    <td className="whitespace-nowrap px-4 py-4">
                      <MachineStatusBadge status={machine.status} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-4 text-slate-600">
                      {formatRelativeTime(machine.last_seen_at)}
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex max-w-xl flex-wrap gap-1.5">
                        {machine.capabilities.map((capability) => (
                          <span
                            key={capability}
                            className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-600"
                          >
                            {capability}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-4 text-right">
                      <div className="inline-flex items-center gap-2">
                        <Link
                          href={`/machines/${encodeURIComponent(machine.machine_id)}/access`}
                          className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
                        >
                          <ShieldCheck aria-hidden="true" className="h-4 w-4" />
                          授权
                        </Link>
                        <Link
                          href={`/console?machine_id=${encodeURIComponent(machine.machine_id)}`}
                          className="inline-flex h-9 items-center gap-2 rounded-md bg-slate-900 px-3 text-sm font-medium text-white hover:bg-slate-700"
                        >
                          <Send aria-hidden="true" className="h-4 w-4" />
                          去下发任务
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
