import { afterEach, describe, expect, test, vi } from "vitest";

import {
  ApiClientError,
  createTask,
  getMe,
  getAuditCommands,
  getAuditSessions,
  getAuditToolCalls,
  getAuditUsage,
  approveApproval,
  assignMachineOwner,
  cancelTask,
  createEnrollmentToken,
  createMachineGrant,
  createSession,
  createUser,
  listMachines,
  getSessionMessages,
  listApprovals,
  listMachineGrants,
  listUsers,
  login,
  logout,
  rejectApproval,
  revokeGrant,
  sendSessionMessage
} from "@/lib/api-client";

describe("api-client", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    delete (globalThis as typeof globalThis & { __TAURI__?: unknown }).__TAURI__;
  });

  test("routes browser calls through the Next proxy without exposing an API key", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify([
          {
            machine_id: "m_online",
            machine_name: "alice-laptop",
            os: "darwin",
            status: "online",
            last_seen_at: "2026-06-10T12:00:00Z",
            capabilities: ["remote_exec"]
          }
        ]),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const machines = await listMachines();

    expect(machines).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/proxy/machines",
      expect.objectContaining({
        headers: expect.not.objectContaining({
          "X-API-Key": expect.anything()
        })
      })
    );
  });

  test("sends task payloads as JSON to the proxy", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ task_id: "t_mock", status: "queued" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const task = await createTask({
      machine_id: "m_online",
      tool: "remote_exec",
      payload: {
        workdir: "/tmp",
        command: "pwd",
        timeout_seconds: 60
      }
    });

    expect(task).toEqual({ task_id: "t_mock", status: "queued" });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/proxy/tasks",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          machine_id: "m_online",
          tool: "remote_exec",
          payload: {
            workdir: "/tmp",
            command: "pwd",
            timeout_seconds: 60
          }
        })
      })
    );
  });

  test("surfaces server error messages", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            error: { code: "validation_error", message: "command 不能为空" }
          }),
          { status: 422, headers: { "content-type": "application/json" } }
        )
      )
    );

    await expect(
      createTask({
        machine_id: "m_online",
        tool: "remote_exec",
        payload: { workdir: "/tmp", command: "", timeout_seconds: 60 }
      })
    ).rejects.toMatchObject({
      name: "ApiClientError",
      status: 422,
      code: "validation_error",
      message: "command 不能为空"
    } satisfies Partial<ApiClientError>);
  });

  test("logs in through the auth route without exposing the returned token", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          user: {
            id: "u_1",
            username: "admin",
            display_name: "管理员",
            role: "admin"
          }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const user = await login("admin", "admin12345");

    expect(user).toEqual({
      id: "u_1",
      username: "admin",
      display_name: "管理员",
      role: "admin"
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/login",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ username: "admin", password: "admin12345" }),
        headers: expect.not.objectContaining({
          Authorization: expect.anything(),
          "X-API-Key": expect.anything()
        })
      })
    );
  });

  test("gets the current user and logs out through auth routes", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "u_1",
            username: "admin",
            display_name: "管理员",
            role: "admin"
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(getMe()).resolves.toMatchObject({ username: "admin" });
    await expect(logout()).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/auth/me",
      expect.objectContaining({
        headers: expect.not.objectContaining({
          Authorization: expect.anything(),
          "X-API-Key": expect.anything()
        })
      })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/auth/logout",
      expect.objectContaining({ method: "POST" })
    );
  });

  test("desktop mode logs in through Tauri and never calls browser fetch", async () => {
    vi.stubEnv("NEXT_PUBLIC_CLIENT_TARGET", "desktop");
    const fetchMock = vi.fn();
    const invokeMock = vi
      .fn()
      .mockResolvedValueOnce({
        id: "u_1",
        username: "admin",
        display_name: "管理员",
        role: "admin"
      })
      .mockResolvedValueOnce({
        id: "u_1",
        username: "admin",
        display_name: "管理员",
        role: "admin"
      })
      .mockResolvedValueOnce(undefined);
    vi.stubGlobal("fetch", fetchMock);
    (globalThis as typeof globalThis & { __TAURI__?: unknown }).__TAURI__ = {
      core: { invoke: invokeMock }
    };

    await expect(login("admin", "secret", { serverUrl: "http://agent.test" })).resolves.toMatchObject({
      username: "admin"
    });
    await expect(getMe()).resolves.toMatchObject({ username: "admin" });
    await expect(logout()).resolves.toBeUndefined();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(invokeMock).toHaveBeenNthCalledWith(1, "desktop_login", {
      serverUrl: "http://agent.test",
      username: "admin",
      password: "secret"
    });
    expect(invokeMock).toHaveBeenNthCalledWith(2, "desktop_get_me", {});
    expect(invokeMock).toHaveBeenNthCalledWith(3, "desktop_logout", {});
  });

  test("desktop mode sends API requests through Tauri with direct server paths", async () => {
    vi.stubEnv("NEXT_PUBLIC_CLIENT_TARGET", "desktop");
    const fetchMock = vi.fn();
    const invokeMock = vi.fn(async () => ({
      status: 200,
      body: [
        {
          machine_id: "m_online",
          machine_name: "alice-laptop",
          os: "darwin",
          status: "online",
          last_seen_at: "2026-06-10T12:00:00Z",
          capabilities: ["remote_exec"]
        }
      ]
    }));
    vi.stubGlobal("fetch", fetchMock);
    (globalThis as typeof globalThis & { __TAURI__?: unknown }).__TAURI__ = {
      core: { invoke: invokeMock }
    };

    await expect(listMachines()).resolves.toHaveLength(1);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(invokeMock).toHaveBeenCalledWith("desktop_api_request", {
      method: "GET",
      path: "/machines",
      body: null
    });
  });

  test("desktop mode maps Tauri auth errors to ApiClientError", async () => {
    vi.stubEnv("NEXT_PUBLIC_CLIENT_TARGET", "desktop");
    const invokeMock = vi.fn(async () => {
      throw {
        status: 401,
        code: "unauthorized",
        message: "token 无效或已过期"
      };
    });
    (globalThis as typeof globalThis & { __TAURI__?: unknown }).__TAURI__ = {
      core: { invoke: invokeMock }
    };

    await expect(getMe()).rejects.toMatchObject({
      name: "ApiClientError",
      status: 401,
      code: "unauthorized",
      message: "token 无效或已过期"
    } satisfies Partial<ApiClientError>);
  });

  test("fetches audit data through the protected proxy", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            total_tokens: 1200,
            by_user_backend: [
              {
                user_id: "u_1",
                backend_id: "openai",
                prompt_tokens: 500,
                completion_tokens: 700,
                total_tokens: 1200,
                turns: 4
              }
            ]
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify([{ session_id: "s_1", user_id: "u_1" }]), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify([{ id: "tc_1", session_id: "s_1" }]), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify([{ task_id: "t_1", command: "npm test" }]), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(getAuditUsage("u_1")).resolves.toMatchObject({ total_tokens: 1200 });
    await expect(getAuditSessions({ userId: "u_1", limit: 20 })).resolves.toHaveLength(1);
    await expect(getAuditToolCalls({ sessionId: "s_1", limit: 20 })).resolves.toHaveLength(1);
    await expect(getAuditCommands({ machineId: "m_1", limit: 20 })).resolves.toHaveLength(1);

    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/proxy/audit/usage?user_id=u_1", expect.any(Object));
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/proxy/audit/sessions?user_id=u_1&limit=20",
      expect.any(Object)
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "/api/proxy/audit/tool-calls?session_id=s_1&limit=20",
      expect.any(Object)
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      "/api/proxy/audit/commands?machine_id=m_1&limit=20",
      expect.any(Object)
    );
  });

  test("uses sessions endpoints for chat", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ session_id: "s_1", machine_id: "m_1", status: "active" }), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ reply: "完成", steps: [], stopped: null }), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify([{ seq: 1, role: "user", content: "看日志" }]), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(createSession({ machine_id: "m_1", title: "检查" })).resolves.toMatchObject({
      session_id: "s_1"
    });
    await expect(sendSessionMessage("s_1", "看日志")).resolves.toMatchObject({ reply: "完成" });
    await expect(getSessionMessages("s_1")).resolves.toHaveLength(1);

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/proxy/sessions",
      expect.objectContaining({ method: "POST" })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/proxy/sessions/s_1/messages",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ content: "看日志" }) })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(3, "/api/proxy/sessions/s_1/messages", expect.any(Object));
  });

  test("uses approvals, grants, and users endpoints", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify([{ approval_id: "ap_1" }]), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ approval_id: "ap_1", status: "approved", task_id: "t_1" }), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ approval_id: "ap_2", status: "rejected" }), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify([{ grant_id: "g_1" }]), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ grant_id: "g_2", expires_at: "2026-06-11T00:00:00Z" }), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ revoked: true }), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify([{ id: "u_1", username: "alice" }]), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(listApprovals("pending")).resolves.toHaveLength(1);
    await expect(approveApproval("ap_1")).resolves.toMatchObject({ task_id: "t_1" });
    await expect(rejectApproval("ap_2")).resolves.toMatchObject({ status: "rejected" });
    await expect(listMachineGrants("m_1")).resolves.toHaveLength(1);
    await expect(createMachineGrant("m_1", { grantee_user_id: "u_2", expires_in_hours: 24 })).resolves.toMatchObject({
      grant_id: "g_2"
    });
    await expect(revokeGrant("g_1")).resolves.toEqual({ revoked: true });
    await expect(listUsers()).resolves.toHaveLength(1);

    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/proxy/approvals?status=pending", expect.any(Object));
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/proxy/approvals/ap_1/approve",
      expect.objectContaining({ method: "POST" })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      5,
      "/api/proxy/machines/m_1/grants",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ grantee_user_id: "u_2", expires_in_hours: 24 })
      })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      6,
      "/api/proxy/grants/g_1",
      expect.objectContaining({ method: "DELETE" })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(7, "/api/proxy/users", expect.any(Object));
  });

  test("uses admin onboarding and task cancellation endpoints", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "u_2", username: "alice", display_name: "Alice", role: "user" }), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ enrollment_token: "et_mock_1", owner_user_id: "u_2", max_uses: 3 }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ machine_id: "m_1", owner_user_id: "u_2" }), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ task_id: "t_1", status: "cancelled" }), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createUser({ username: "alice", password: "secret1", display_name: "Alice", role: "user" })
    ).resolves.toMatchObject({ id: "u_2", username: "alice" });
    await expect(
      createEnrollmentToken({ owner_user_id: "u_2", max_uses: 3, expires_in_days: 14 })
    ).resolves.toMatchObject({ enrollment_token: "et_mock_1", owner_user_id: "u_2" });
    await expect(assignMachineOwner("m_1", "u_2")).resolves.toEqual({
      machine_id: "m_1",
      owner_user_id: "u_2"
    });
    await expect(cancelTask("t_1")).resolves.toEqual({ task_id: "t_1", status: "cancelled" });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/proxy/users",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ username: "alice", password: "secret1", display_name: "Alice", role: "user" })
      })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/proxy/enrollment-tokens",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ owner_user_id: "u_2", max_uses: 3, expires_in_days: 14 })
      })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "/api/proxy/machines/m_1/assign",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ user_id: "u_2" }) })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      "/api/proxy/tasks/t_1/cancel",
      expect.objectContaining({ method: "POST" })
    );
  });
});
