import { NextRequest, NextResponse } from "next/server";

import { createMockApi } from "@/lib/mock-api";
import {
  agentApiUrl,
  getTokenFromRequest,
  readJsonBody,
  unauthorized
} from "@/lib/server-auth";

export const dynamic = "force-dynamic";

const mockApi = createMockApi();

type RouteContext = {
  params: {
    path?: string[];
  };
};

function buildUpstreamUrl(request: NextRequest, path: string[]): string {
  const encodedPath = path.map((segment) => encodeURIComponent(segment)).join("/");
  const incomingUrl = new URL(request.url);
  return agentApiUrl(`/${encodedPath}`, incomingUrl.search);
}

async function proxyToAgentServer(
  request: NextRequest,
  path: string[],
  token: string
): Promise<Response> {
  const headers = new Headers();
  headers.set("Accept", "application/json");
  headers.set("Authorization", `Bearer ${token}`);

  const body =
    request.method === "GET" || request.method === "HEAD" ? undefined : await request.text();
  if (body !== undefined) {
    headers.set("Content-Type", request.headers.get("content-type") ?? "application/json");
  }

  const upstream = await fetch(buildUpstreamUrl(request, path), {
    method: request.method,
    headers,
    body,
    cache: "no-store"
  });

  const responseBody = await upstream.text();
  return new NextResponse(responseBody || null, {
    status: upstream.status,
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "application/json"
    }
  });
}

async function handle(request: NextRequest, context: RouteContext): Promise<Response> {
  const path = context.params.path ?? [];
  const token = getTokenFromRequest(request);

  if (!token) {
    return unauthorized();
  }

  if (process.env.MOCK_API === "1") {
    const body = await readJsonBody(request);
    const response = await mockApi.handle(
      request.method,
      path,
      body,
      new URL(request.url).searchParams
    );
    return NextResponse.json(response.body, { status: response.status });
  }

  try {
    return await proxyToAgentServer(request, path, token);
  } catch {
    return NextResponse.json(
      { error: { code: "upstream_unavailable", message: "无法连接 Agent Server" } },
      { status: 502 }
    );
  }
}

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
