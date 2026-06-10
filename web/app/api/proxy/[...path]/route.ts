import { NextRequest, NextResponse } from "next/server";

import { createMockApi } from "@/lib/mock-api";

export const dynamic = "force-dynamic";

const mockApi = createMockApi();

type RouteContext = {
  params: {
    path?: string[];
  };
};

async function readJsonBody(request: NextRequest): Promise<unknown> {
  if (request.method === "GET" || request.method === "HEAD") return undefined;

  const text = await request.text();
  if (!text) return undefined;

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return {};
  }
}

function buildUpstreamUrl(request: NextRequest, path: string[]): string {
  const base = process.env.AGENT_API_BASE ?? "http://127.0.0.1:8700";
  const trimmedBase = base.replace(/\/+$/, "");
  const encodedPath = path.map((segment) => encodeURIComponent(segment)).join("/");
  const incomingUrl = new URL(request.url);
  return `${trimmedBase}/api/${encodedPath}${incomingUrl.search}`;
}

async function proxyToAgentServer(request: NextRequest, path: string[]): Promise<Response> {
  const apiKey = process.env.AGENT_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: { code: "missing_api_key", message: "服务端未配置 AGENT_API_KEY" } },
      { status: 500 }
    );
  }

  const headers = new Headers();
  headers.set("Accept", "application/json");
  headers.set("X-API-Key", apiKey);

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
    return await proxyToAgentServer(request, path);
  } catch {
    return NextResponse.json(
      { error: { code: "upstream_unavailable", message: "无法连接 Agent Server" } },
      { status: 502 }
    );
  }
}

export const GET = handle;
export const POST = handle;
