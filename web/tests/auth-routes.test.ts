import { NextRequest } from "next/server";
import { afterEach, describe, expect, test, vi } from "vitest";

import { POST as loginRoute } from "@/app/api/auth/login/route";
import { GET as meRoute } from "@/app/api/auth/me/route";
import { POST as logoutRoute } from "@/app/api/auth/logout/route";
import { DELETE as proxyDelete } from "@/app/api/proxy/[...path]/route";
import { GET as proxyGet } from "@/app/api/proxy/[...path]/route";

function request(url: string, init: RequestInit = {}) {
  return new NextRequest(url, init);
}

describe("auth route handlers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.MOCK_API;
    delete process.env.AGENT_API_BASE;
  });

  test("mock login stores the token in an httpOnly cookie and omits it from JSON", async () => {
    process.env.MOCK_API = "1";

    const response = await loginRoute(
      request("http://localhost/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username: "alice", password: "secret" }),
        headers: { "content-type": "application/json" }
      })
    );

    await expect(response.json()).resolves.toEqual({
      user: { id: "u_mock", username: "alice", display_name: "alice", role: "user" }
    });
    expect(response.headers.get("set-cookie")).toContain("agent_token=");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
  });

  test("mock me returns the user from the httpOnly cookie and logout clears it", async () => {
    process.env.MOCK_API = "1";

    const me = await meRoute(
      request("http://localhost/api/auth/me", {
        headers: { cookie: "agent_token=mock%3Aalice" }
      })
    );
    await expect(me.json()).resolves.toMatchObject({
      username: "alice",
      display_name: "alice",
      role: "admin"
    });

    const logout = await logoutRoute(request("http://localhost/api/auth/logout", { method: "POST" }));
    expect(logout.headers.get("set-cookie")).toContain("agent_token=");
    expect(logout.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  test("proxy rejects protected requests without a token cookie in mock mode", async () => {
    process.env.MOCK_API = "1";

    const response = await proxyGet(request("http://localhost/api/proxy/machines"), {
      params: { path: ["machines"] }
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: { code: "unauthorized", message: "请先登录" }
    });
  });

  test("proxy injects Authorization from cookie and never injects X-API-Key", async () => {
    process.env.AGENT_API_BASE = "http://agent.test";
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await proxyGet(
      request("http://localhost/api/proxy/machines", {
        headers: { cookie: "agent_token=at_secret" }
      }),
      { params: { path: ["machines"] } }
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://agent.test/api/machines",
      expect.objectContaining({
        headers: expect.any(Headers)
      })
    );
    const headers = fetchMock.mock.calls[0][1].headers as Headers;
    expect(headers.get("Authorization")).toBe("Bearer at_secret");
    expect(headers.has("X-API-Key")).toBe(false);
  });

  test("proxy supports DELETE requests for grant revocation", async () => {
    process.env.MOCK_API = "1";

    const response = await proxyDelete(
      request("http://localhost/api/proxy/grants/g_mock_seed", {
        method: "DELETE",
        headers: { cookie: "agent_token=mock%3Aadmin" }
      }),
      { params: { path: ["grants", "g_mock_seed"] } }
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ revoked: true });
  });
});
