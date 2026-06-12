import { NextRequest, NextResponse } from "next/server";

import type { ApiErrorBody, User } from "@/lib/types";

export const AUTH_COOKIE_NAME = "agent_token";
const COOKIE_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

export function getTokenFromRequest(request: NextRequest): string | null {
  return request.cookies.get(AUTH_COOKIE_NAME)?.value ?? null;
}

function isSecureRequest(request: NextRequest): boolean {
  // Secure cookie 跟随实际协议:https(或反代声明 https)才带 Secure。
  // 固定按 NODE_ENV 会让局域网 http 部署的浏览器直接丢弃 cookie,登录后立即被弹回。
  const forwardedProto = request.headers.get("x-forwarded-proto");
  if (forwardedProto) {
    return forwardedProto.split(",")[0]?.trim() === "https";
  }
  return request.nextUrl.protocol === "https:";
}

export function setTokenCookie(response: NextResponse, token: string, request: NextRequest) {
  response.cookies.set(AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isSecureRequest(request),
    path: "/",
    maxAge: COOKIE_MAX_AGE_SECONDS
  });
}

export function clearTokenCookie(response: NextResponse, request: NextRequest) {
  response.cookies.set(AUTH_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: isSecureRequest(request),
    path: "/",
    maxAge: 0
  });
}

export function unauthorized(message = "请先登录") {
  return NextResponse.json<ApiErrorBody>(
    { error: { code: "unauthorized", message } },
    { status: 401 }
  );
}

export async function readJsonBody(request: NextRequest): Promise<unknown> {
  if (request.method === "GET" || request.method === "HEAD") return undefined;

  const text = await request.text();
  if (!text) return undefined;

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return {};
  }
}

export async function readResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export function agentApiUrl(path: string, search = "") {
  const base = process.env.AGENT_API_BASE ?? "http://127.0.0.1:8700";
  return `${base.replace(/\/+$/, "")}/api${path}${search}`;
}

export function mockUserFromToken(token: string): User | null {
  if (!token.startsWith("mock:")) return null;
  const username = token.slice("mock:".length);
  if (!username) return null;
  return {
    id: "u_mock",
    username,
    display_name: username,
    role: "admin"
  };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
