import { Suspense } from "react";

import { ConsoleClient } from "@/app/console/console-client";

export default function ConsolePage() {
  return (
    <Suspense fallback={<div className="text-sm text-slate-500">加载中</div>}>
      <ConsoleClient />
    </Suspense>
  );
}
