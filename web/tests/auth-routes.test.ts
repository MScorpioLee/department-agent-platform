import { NextRequest } from "next/server";
import { afterEach, describe, expect, test, vi } from "vitest";

import { POST as loginRoute } from "@/app/api/auth/login/route";
import { POST as registerRoute } from "@/app/api/register/route";
import { GET as meRoute } from "@/app/api/auth/me/route";
import { POST as logoutRoute } from "@/app/api/auth/logout/route";
import { GET as setupStatusRoute } from "@/app/api/auth/setup-status/route";
import { DELETE as proxyDelete } from "@/app/api/proxy/[...path]/route";
import { GET as proxyGet } from "@/app/api/proxy/[...path]/route";
import { PATCH as proxyPatch } from "@/app/api/proxy/[...path]/route";
import { PUT as proxyPut } from "@/app/api/proxy/[...path]/route";

function request(url: string, init: RequestInit = {}) {
  return new NextRequest(url, init);
}

describe("auth route handlers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.MOCK_API;
    delete process.env.MOCK_NEEDS_SETUP;
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

  test("mock register returns pending without setting a token", async () => {
    process.env.MOCK_API = "1";

    const response = await registerRoute(
      request("http://localhost/api/register", {
        method: "POST",
        body: JSON.stringify({
          username: "pending-user",
          password: "secret1",
          display_name: "Pending User",
          note: "请审批"
        }),
        headers: { "content-type": "application/json" }
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "pending",
      username: "pending-user",
      message: "注册已提交,等待管理员审批,通过后即可登录"
    });
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  test("mock setup status defaults to non-bootstrap mode", async () => {
    process.env.MOCK_API = "1";

    const response = await setupStatusRoute(request("http://localhost/api/auth/setup-status"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      needs_setup: false,
      allow_registration: true
    });
  });

  test("mock setup status can preview bootstrap registration without setting a token", async () => {
    process.env.MOCK_API = "1";
    process.env.MOCK_NEEDS_SETUP = "1";

    const status = await setupStatusRoute(request("http://localhost/api/auth/setup-status"));
    expect(status.status).toBe(200);
    await expect(status.json()).resolves.toEqual({
      needs_setup: true,
      allow_registration: true
    });

    const response = await registerRoute(
      request("http://localhost/api/register", {
        method: "POST",
        body: JSON.stringify({
          username: "root",
          password: "secret1",
          display_name: "Root"
        }),
        headers: { "content-type": "application/json" }
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "active",
      username: "root",
      role: "admin",
      bootstrap: true,
      message: "管理员账号已创建"
    });
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  test("mock pending account login returns pending_approval without a token", async () => {
    process.env.MOCK_API = "1";

    const response = await loginRoute(
      request("http://localhost/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username: "pending", password: "secret" }),
        headers: { "content-type": "application/json" }
      })
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: { code: "pending_approval", message: "账号待管理员审批,请等待通过后再登录" }
    });
    expect(response.headers.get("set-cookie")).toBeNull();
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

  test("proxy supports PUT and PATCH requests for skill management in mock mode", async () => {
    process.env.MOCK_API = "1";

    const putResponse = await proxyPut(
      request("http://localhost/api/proxy/skills/skill_mock_review/enabled", {
        method: "PUT",
        body: JSON.stringify({ enabled: false }),
        headers: { cookie: "agent_token=mock%3Aadmin", "content-type": "application/json" }
      }),
      { params: { path: ["skills", "skill_mock_review", "enabled"] } }
    );
    expect(putResponse.status).toBe(200);
    await expect(putResponse.json()).resolves.toMatchObject({ id: "skill_mock_review", enabled: false });

    const patchResponse = await proxyPatch(
      request("http://localhost/api/proxy/admin/skills/skill_mock_review", {
        method: "PATCH",
        body: JSON.stringify({ prompt: "Updated prompt" }),
        headers: { cookie: "agent_token=mock%3Aadmin", "content-type": "application/json" }
      }),
      { params: { path: ["admin", "skills", "skill_mock_review"] } }
    );
    expect(patchResponse.status).toBe(200);
    await expect(patchResponse.json()).resolves.toMatchObject({ id: "skill_mock_review", prompt: "Updated prompt" });
  });
});
