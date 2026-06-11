"use client";

import React, { Suspense } from "react";
import { useSearchParams } from "next/navigation";

import { MachineAccessClient } from "@/app/machines/[id]/access/machine-access-client";

function MachineAccessFromQuery() {
  const searchParams = useSearchParams();
  const machineId = searchParams.get("machine_id") ?? "";

  if (!machineId) {
    return (
      <section className="rounded-md border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800">
        缺少 machine_id
      </section>
    );
  }

  return <MachineAccessClient machineId={machineId} />;
}

export default function StaticMachineAccessPage() {
  return (
    <Suspense fallback={<div className="text-sm text-slate-500">加载中</div>}>
      <MachineAccessFromQuery />
    </Suspense>
  );
}
