import { NextRequest, NextResponse } from "next/server";

import {
  agentApiUrl,
  isRecord,
  readJsonBody,
  readResponseBody,
  setTokenCookie
} from "@/lib/server-auth";
import type { User } from "@/lib/types";

export const dynamic = "force-dynamic";

function invalidCredentials(message = "用户名或密码错误") {
  return NextResponse.json(
    { error: { code: "invalid_credentials", message } },
    { status: 401 }
  );
}

function readCredentials(body: unknown) {
  if (!isRecord(body)) return null;
  const username = typeof body.username === "string" ? body.username.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!username || !password) return null;
  return { username, password };
}

export async function POST(request: NextRequest): Promise<Response> {
  const credentials = readCredentials(await readJsonBody(request));
  if (!credentials) {
    return invalidCredentials("用户名和密码不能为空");
  }

  if (process.env.MOCK_API === "1") {
    const user: User = {
      id: "u_mock",
      username: credentials.username,
      display_name: credentials.username,
      role: "user"
    };
    const response = NextResponse.json({ user });
    setTokenCookie(response, `mock:${credentials.username}`, request);
    return response;
  }

  const upstream = await fetch(agentApiUrl("/auth/login"), {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(credentials),
    cache: "no-store"
  });
  const body = await readResponseBody(upstream);

  if (!upstream.ok) {
    return NextResponse.json(body, { status: upstream.status });
  }

  if (
    !isRecord(body) ||
    typeof body.token !== "string" ||
    !isRecord(body.user)
  ) {
    return NextResponse.json(
      { error: { code: "bad_upstream_response", message: "登录响应格式不正确" } },
      { status: 502 }
    );
  }

  const response = NextResponse.json({ user: body.user });
  setTokenCookie(response, body.token, request);
  return response;
}
