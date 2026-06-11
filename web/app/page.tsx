"use client";

import React, { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function HomePage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/machines");
  }, [router]);

  return <div className="text-sm text-slate-500">加载中</div>;
}
