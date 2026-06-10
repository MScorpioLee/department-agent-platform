import React from "react";

import { cn } from "@/lib/cn";
import { STATUS_LABELS } from "@/lib/tooling";
import type { MachineStatus, TaskStatus } from "@/lib/types";

const taskClasses: Record<TaskStatus, string> = {
  queued: "border-sky-200 bg-sky-50 text-sky-700",
  dispatched: "border-cyan-200 bg-cyan-50 text-cyan-700",
  running: "border-amber-200 bg-amber-50 text-amber-700",
  completed: "border-emerald-200 bg-emerald-50 text-emerald-700",
  failed: "border-red-200 bg-red-50 text-red-700",
  timeout: "border-orange-200 bg-orange-50 text-orange-700",
  cancelled: "border-slate-200 bg-slate-50 text-slate-600",
  lost: "border-zinc-300 bg-zinc-100 text-zinc-700"
};

export function MachineStatusBadge({ status }: { status: MachineStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-1 text-xs font-medium",
        status === "online"
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : "border-slate-200 bg-slate-50 text-slate-500"
      )}
    >
      {status === "online" ? "在线" : "离线"}
    </span>
  );
}

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-1 text-xs font-medium",
        taskClasses[status]
      )}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}
