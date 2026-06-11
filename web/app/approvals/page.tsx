"use client";

import { CheckCircle2, Loader2, RefreshCw, ShieldAlert, XCircle } from "lucide-react";
import React, { useCallback, useEffect, useState } from "react";

import { approveApproval, listApprovals, rejectApproval } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { isDesktopClient } from "@/lib/client-target";
import { notifyDesktop } from "@/lib/desktop-bridge";
import { formatDateTime, formatRelativeTime } from "@/lib/format";
import type { Approval } from "@/lib/types";

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "请求失败";
}

function JsonBlock({ value }: { value: unknown }) {
  return (
    <pre className="max-h-44 overflow-auto rounded-md bg-slate-950 p-3 font-mono text-xs leading-5 text-slate-100">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

export default function ApprovalsPage() {
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionId, setActionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const items = await listApprovals("pending");
      setApprovals(items);
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

  async function handleApprove(approvalId: string) {
    setActionId(approvalId);
    setActionMessage(null);
    setError(null);
    try {
      const response = await approveApproval(approvalId);
      setActionMessage(`已批准，task_id: ${response.task_id}`);
      if (isDesktopClient()) {
        void notifyDesktop("审批已批准", `task_id: ${response.task_id}`);
      }
      await refresh();
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setActionId(null);
    }
  }

  async function handleReject(approvalId: string) {
    setActionId(approvalId);
    setActionMessage(null);
    setError(null);
    try {
      const response = await rejectApproval(approvalId);
      setActionMessage(`已拒绝，approval_id: ${response.approval_id}`);
      if (isDesktopClient()) {
        void notifyDesktop("审批已拒绝", response.approval_id);
      }
      await refresh();
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setActionId(null);
    }
  }

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-normal text-slate-950">审批</h1>
          <p className="mt-1 text-sm text-slate-500">高风险工具调用待处理队列</p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
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

      {actionMessage ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
          {actionMessage}
        </div>
      ) : null}

      <div className="overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-4 py-3">
          <div className="flex items-center gap-2 text-base font-semibold text-slate-950">
            <ShieldAlert aria-hidden="true" className="h-5 w-5 text-amber-500" />
            待审批
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 px-4 py-10 text-sm text-slate-500">
            <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
            加载中
          </div>
        ) : approvals.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-slate-500">暂无待审批项</div>
        ) : (
          <div className="divide-y divide-slate-100">
            {approvals.map((approval) => (
              <article key={approval.approval_id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-semibold text-slate-950">{approval.tool}</span>
                      <span className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800">
                        {approval.risk_rule}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                      <span>approval_id: {approval.approval_id}</span>
                      <span>machine_id: {approval.machine_id}</span>
                      <span>requested_by: {approval.requested_by_user_id}</span>
                      <span title={formatDateTime(approval.created_at)}>
                        {formatRelativeTime(approval.created_at)}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      aria-label={`拒绝 ${approval.approval_id}`}
                      onClick={() => void handleReject(approval.approval_id)}
                      disabled={actionId !== null}
                      className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <XCircle aria-hidden="true" className="h-4 w-4" />
                      拒绝
                    </button>
                    <button
                      type="button"
                      aria-label={`批准 ${approval.approval_id}`}
                      onClick={() => void handleApprove(approval.approval_id)}
                      disabled={actionId !== null}
                      className="inline-flex h-9 items-center gap-2 rounded-md bg-slate-900 px-3 text-sm font-semibold text-white shadow-sm hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {actionId === approval.approval_id ? (
                        <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
                      ) : (
                        <CheckCircle2 aria-hidden="true" className="h-4 w-4" />
                      )}
                      批准
                    </button>
                  </div>
                </div>
                <div className="mt-3">
                  <JsonBlock value={approval.payload} />
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
