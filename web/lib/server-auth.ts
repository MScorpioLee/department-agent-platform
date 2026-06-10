import { NextRequest, NextResponse } from "next/server";

import type { ApiErrorBody, User } from "@/lib/types";

export const AUTH_COOKIE_NAME = "agent_token";
const COOKIE_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

export function getTokenFromRequest(request: NextRequest): string | null {
  return request.cookies.get(AUTH_COOKIE_NAME)?.value ?? null;
}

export function setTokenCookie(response: NextResponse, token: string) {
  response.cookies.set(AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: COOKIE_MAX_AGE_SECONDS
  });
}

export function clearTokenCookie(response: NextResponse) {
  response.cookies.set(AUTH_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
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
