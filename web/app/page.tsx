"use client";

import React, { useEffect } from "react";
import { useRouter } from "next/navigation";

import { isCoderProfile } from "@/lib/client-target";

export default function HomePage() {
  const router = useRouter();
  const coderProfile = isCoderProfile();

  useEffect(() => {
    router.replace(coderProfile ? "/desktop-agent" : "/machines");
  }, [coderProfile, router]);

  return <div className="text-sm text-slate-500">加载中</div>;
}
