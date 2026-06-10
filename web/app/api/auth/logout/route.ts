import { NextRequest, NextResponse } from "next/server";

import { clearTokenCookie } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

export async function POST(_request: NextRequest): Promise<Response> {
  const response = NextResponse.json({ ok: true });
  clearTokenCookie(response);
  return response;
}
