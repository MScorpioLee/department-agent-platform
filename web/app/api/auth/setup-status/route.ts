import { NextRequest, NextResponse } from "next/server";

import { agentApiUrl, readResponseBody } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

function mockNeedsSetup(request: NextRequest) {
  return (
    process.env.MOCK_NEEDS_SETUP === "1" ||
    request.nextUrl.searchParams.get("setup") === "1" ||
    request.nextUrl.searchParams.get("mock_setup") === "1"
  );
}

export async function GET(request: NextRequest): Promise<Response> {
  if (process.env.MOCK_API === "1") {
    return NextResponse.json({
      needs_setup: mockNeedsSetup(request),
      allow_registration: true
    });
  }

  const upstream = await fetch(agentApiUrl("/auth/setup-status"), {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store"
  });
  const body = await readResponseBody(upstream);
  return NextResponse.json(body, { status: upstream.status });
}
