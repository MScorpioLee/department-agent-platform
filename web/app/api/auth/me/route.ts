import { NextRequest, NextResponse } from "next/server";

import {
  agentApiUrl,
  getTokenFromRequest,
  mockUserFromToken,
  readResponseBody,
  unauthorized
} from "@/lib/server-auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  const token = getTokenFromRequest(request);
  if (!token) return unauthorized();

  if (process.env.MOCK_API === "1") {
    const user = mockUserFromToken(token);
    return user ? NextResponse.json(user) : unauthorized();
  }

  const upstream = await fetch(agentApiUrl("/auth/me"), {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`
    },
    cache: "no-store"
  });
  const body = await readResponseBody(upstream);
  return NextResponse.json(body, { status: upstream.status });
}
