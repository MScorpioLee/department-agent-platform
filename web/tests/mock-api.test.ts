import { describe, expect, test } from "vitest";

import { createMockApi } from "@/lib/mock-api";

describe("mock api", () => {
  test("returns the required two-machine fixture", async () => {
    const api = createMockApi({ now: () => Date.parse("2026-06-10T12:00:00Z") });

    const response = await api.handle("GET", ["machines"]);

    expect(response.status).toBe(200);
    expect(response.body).toEqual([
      expect.objectContaining({
        machine_id: "m_mock_online",
        status: "online"
      }),
      expect.objectContaining({
        machine_id: "m_mock_offline",
        status: "offline"
      })
    ]);
  });

  test("creates a mock task that completes after three seconds with output", async () => {
    let now = Date.parse("2026-06-10T12:00:00Z");
    const api = createMockApi({ now: () => now });

    const createResponse = await api.handle("POST", ["tasks"], {
      machine_id: "m_mock_online",
      tool: "remote_exec",
      payload: { workdir: "/tmp", command: "pwd", timeout_seconds: 60 }
    });

    expect(createResponse.status).toBe(200);
    expect(createResponse.body).toMatchObject({
      task_id: expect.stringMatching(/^t_mock_/),
      status: "queued"
    });

    const taskId = createResponse.body.task_id;
    const queuedResponse = await api.handle("GET", ["tasks", taskId]);
    expect(queuedResponse.body).toMatchObject({ status: "queued", result: null });

    now += 3000;

    const completedResponse = await api.handle("GET", ["tasks", taskId]);
    expect(completedResponse.body).toMatchObject({
      status: "completed",
      result: { exit_code: 0, duration_ms: 3000 }
    });

    const outputResponse = await api.handle("GET", ["tasks", taskId, "output"]);
    expect(outputResponse.body).toEqual(
      expect.objectContaining({
        stdout: expect.stringContaining("mock task completed"),
        stderr: "",
        truncated: false
      })
    );
  });

  test("returns readable validation errors for invalid payloads", async () => {
    const api = createMockApi({ now: () => Date.parse("2026-06-10T12:00:00Z") });

    const response = await api.handle("POST", ["tasks"], {
      machine_id: "m_mock_online",
      tool: "remote_exec",
      payload: { workdir: "/tmp", command: "", timeout_seconds: 60 }
    });

    expect(response).toEqual({
      status: 422,
      body: { error: { code: "validation_error", message: "command 不能为空" } }
    });
  });

  test("returns audit fixtures for admin preview", async () => {
    const api = createMockApi({ now: () => Date.parse("2026-06-10T12:00:00Z") });

    const usage = await api.handle("GET", ["audit", "usage"]);
    const sessions = await api.handle("GET", ["audit", "sessions"]);
    const toolCalls = await api.handle("GET", ["audit", "tool-calls"], undefined, new URLSearchParams("session_id=s_mock_1"));
    const commands = await api.handle("GET", ["audit", "commands"]);

    expect(usage.body).toMatchObject({
      total_tokens: expect.any(Number),
      by_user_backend: expect.arrayContaining([
        expect.objectContaining({ user_id: "u_mock_admin", backend_id: "openai" })
      ])
    });
    expect(sessions.body).toEqual(
      expect.arrayContaining([expect.objectContaining({ session_id: "s_mock_1" })])
    );
    expect(toolCalls.body).toEqual(
      expect.arrayContaining([expect.objectContaining({ session_id: "s_mock_1" })])
    );
    expect(commands.body).toEqual(
      expect.arrayContaining([expect.objectContaining({ command: expect.stringContaining("[redacted]") })])
    );
  });

  test("creates chat sessions and records model/tool timeline messages", async () => {
    const api = createMockApi({ now: () => Date.parse("2026-06-10T12:00:00Z") });

    const sessionResponse = await api.handle("POST", ["sessions"], {
      machine_id: "m_mock_online",
      title: "检查日志"
    });
    expect(sessionResponse.body).toMatchObject({
      session_id: expect.stringMatching(/^s_mock_/),
      machine_id: "m_mock_online",
      status: "active"
    });

    const sessionId = sessionResponse.body.session_id;
    const replyResponse = await api.handle("POST", ["sessions", sessionId, "messages"], {
      content: "帮我执行危险操作"
    });
    expect(replyResponse.body).toMatchObject({
      reply: expect.stringContaining("mock"),
      stopped: null
    });

    const messagesResponse = await api.handle("GET", ["sessions", sessionId, "messages"]);
    expect(messagesResponse.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: "user" }),
        expect.objectContaining({ role: "assistant", tool_calls: expect.any(Array) }),
        expect.objectContaining({
          role: "tool",
          content: expect.stringContaining("needs_approval")
        }),
        expect.objectContaining({ role: "assistant", content: expect.stringContaining("mock") })
      ])
    );
  });

  test("updates approvals and machine grants in mock mode", async () => {
    const api = createMockApi({ now: () => Date.parse("2026-06-10T12:00:00Z") });

    const approvals = await api.handle("GET", ["approvals"], undefined, new URLSearchParams("status=pending"));
    expect(approvals.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ approval_id: "ap_mock_1", risk_rule: expect.stringContaining("rm -rf") })
      ])
    );

    const approved = await api.handle("POST", ["approvals", "ap_mock_1", "approve"]);
    expect(approved.body).toMatchObject({ approval_id: "ap_mock_1", status: "approved", task_id: expect.any(String) });

    const grant = await api.handle("POST", ["machines", "m_mock_online", "grants"], {
      grantee_user_id: "u_mock_user",
      expires_in_hours: 12
    });
    expect(grant.body).toMatchObject({ grant_id: expect.stringMatching(/^g_mock_/) });

    const grants = await api.handle("GET", ["machines", "m_mock_online", "grants"]);
    expect(grants.body).toEqual(
      expect.arrayContaining([expect.objectContaining({ grantee_user_id: "u_mock_user" })])
    );

    const revoked = await api.handle("DELETE", ["grants", grant.body.grant_id]);
    expect(revoked.body).toEqual({ revoked: true });
  });
});
