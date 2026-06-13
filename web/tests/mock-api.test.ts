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
        expect.objectContaining({ approval_id: "ap_mock_1", risk_rule: expect.stringContaining("rm -rf") }),
        expect.objectContaining({
          approval_id: "ap_mock_connector",
          tool: "mcp__github__create_issue",
          risk_rule: "connector_requires_approval"
        })
      ])
    );

    const approved = await api.handle("POST", ["approvals", "ap_mock_1", "approve"]);
    expect(approved.body).toMatchObject({ approval_id: "ap_mock_1", status: "approved", task_id: expect.any(String) });

    const approvedConnector = await api.handle("POST", ["approvals", "ap_mock_connector", "approve"]);
    expect(approvedConnector.body).toMatchObject({
      approval_id: "ap_mock_connector",
      status: "approved",
      result: { content: "echo: hi" },
      tool_status: "completed"
    });
    expect(approvedConnector.body).not.toHaveProperty("task_id");

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

  test("supports admin users, enrollment, assignment, and cancellation in mock mode", async () => {
    let now = Date.parse("2026-06-10T12:00:00Z");
    const api = createMockApi({ now: () => now });

    const createdUser = await api.handle("POST", ["users"], {
      username: "new-user",
      password: "secret1",
      display_name: "New User",
      role: "user"
    });
    expect(createdUser.status).toBe(200);
    expect(createdUser.body).toMatchObject({
      id: expect.stringMatching(/^u_mock_/),
      username: "new-user",
      display_name: "New User",
      role: "user"
    });

    const duplicate = await api.handle("POST", ["users"], {
      username: "new-user",
      password: "secret1",
      role: "user"
    });
    expect(duplicate).toEqual({
      status: 409,
      body: { error: { code: "user_exists", message: "用户名已存在" } }
    });

    const enrollment = await api.handle("POST", ["enrollment-tokens"], {
      owner_user_id: createdUser.body.id,
      max_uses: 2,
      expires_in_days: 14
    });
    expect(enrollment.body).toEqual({
      enrollment_token: expect.stringMatching(/^et_mock_/),
      owner_user_id: createdUser.body.id,
      max_uses: 2
    });

    const assigned = await api.handle("POST", ["machines", "m_mock_online", "assign"], {
      user_id: createdUser.body.id
    });
    expect(assigned.body).toEqual({
      machine_id: "m_mock_online",
      owner_user_id: createdUser.body.id
    });

    const machines = await api.handle("GET", ["machines"]);
    expect(machines.body[0]).toMatchObject({
      machine_id: "m_mock_online",
      owner_user_id: createdUser.body.id
    });

    const task = await api.handle("POST", ["tasks"], {
      machine_id: "m_mock_online",
      tool: "remote_exec",
      payload: { workdir: "/tmp", command: "sleep 30", timeout_seconds: 60 }
    });
    const cancelled = await api.handle("POST", ["tasks", task.body.task_id, "cancel"]);
    expect(cancelled.body).toEqual({ task_id: task.body.task_id, status: "cancelled" });

    now += 3000;
    const loaded = await api.handle("GET", ["tasks", task.body.task_id]);
    expect(loaded.body).toMatchObject({ status: "cancelled", result: null });

    const ticket = await api.handle("POST", ["ws-ticket"]);
    expect(ticket.body).toEqual({ ticket: expect.stringMatching(/^mock_ws_ticket_/) });

    const upstreamLogout = await api.handle("POST", ["auth", "logout"]);
    expect(upstreamLogout.body).toEqual({ ok: true });
  });

  test("supports model admin mock flows without returning plaintext api keys", async () => {
    const api = createMockApi({ now: () => Date.parse("2026-06-11T12:00:00Z") });

    const providers = await api.handle("GET", ["admin", "model-providers"]);
    expect(providers.status).toBe(200);
    expect(providers.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "deepseek", models: expect.arrayContaining(["deepseek-chat"]) }),
        expect.objectContaining({ id: "ollama", needs_key: false }),
        expect.objectContaining({ id: "custom", base_url: "" })
      ])
    );

    const initial = await api.handle("GET", ["admin", "models"]);
    expect(initial.status).toBe(200);
    expect(initial.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ is_default: true, api_key: expect.stringContaining("…") })
      ])
    );

    const created = await api.handle("POST", ["admin", "models"], {
      name: "OpenAI",
      base_url: "https://api.openai.com/v1",
      model: "gpt-4.1",
      api_key: "sk-live-secret",
      max_concurrency: 3,
      is_default: true
    });
    expect(created.status).toBe(200);
    expect(JSON.stringify(created.body)).not.toContain("sk-live-secret");

    const afterCreate = await api.handle("GET", ["admin", "models"]);
    const defaults = afterCreate.body.filter((model: { is_default: boolean }) => model.is_default);
    expect(defaults).toHaveLength(1);
    expect(defaults[0]).toMatchObject({ name: "OpenAI" });
    expect(JSON.stringify(afterCreate.body)).not.toContain("sk-live-secret");

    const updated = await api.handle("PATCH", ["admin", "models", created.body.id], {
      name: "OpenAI 生产"
    });
    expect(updated.body).toMatchObject({ name: "OpenAI 生产", api_key: expect.stringContaining("…") });

    const route = await api.handle("PUT", ["admin", "model-routes"], {
      user_id: "u_mock_user",
      backend_id: created.body.id
    });
    expect(route.body).toEqual({ user_id: "u_mock_user", backend_id: created.body.id });

    const cleared = await api.handle("PUT", ["admin", "model-routes"], {
      user_id: "u_mock_user",
      backend_id: null
    });
    expect(cleared.body).toEqual({ user_id: "u_mock_user", backend_id: null });
  });

  test("supports model discovery and readable discovery failures", async () => {
    const api = createMockApi({ now: () => Date.parse("2026-06-12T12:00:00Z") });

    const discovered = await api.handle("POST", ["admin", "model-providers", "discover"], {
      base_url: "https://api.deepseek.com/v1",
      api_key: "sk-live-secret"
    });
    expect(discovered.body).toEqual({ models: ["mock-chat", "mock-coder"], count: 2 });
    expect(JSON.stringify(discovered.body)).not.toContain("sk-live-secret");

    const failed = await api.handle("POST", ["admin", "model-providers", "discover"], {
      base_url: "https://api.deepseek.com/v1",
      api_key: "bad"
    });
    expect(failed).toEqual({
      status: 502,
      body: { error: { code: "discover_failed", message: "API Key 无效或无权限" } }
    });
  });

  test("supports self registration approval lifecycle in mock mode", async () => {
    let now = Date.parse("2026-06-13T08:00:00Z");
    const api = createMockApi({ now: () => now });

    const registered = await api.handle("POST", ["register"], {
      username: "pending-user",
      password: "secret1",
      display_name: "Pending User",
      note: "需要项目访问"
    });
    expect(registered).toEqual({
      status: 200,
      body: {
        status: "pending",
        username: "pending-user",
        message: "注册已提交,等待管理员审批,通过后即可登录"
      }
    });

    const duplicate = await api.handle("POST", ["register"], {
      username: "pending-user",
      password: "secret1"
    });
    expect(duplicate).toEqual({
      status: 409,
      body: { error: { code: "user_exists", message: "用户名已存在或正在审批中" } }
    });

    const registrations = await api.handle("GET", ["admin", "registrations"]);
    expect(registrations.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: expect.stringMatching(/^reg_mock_/),
          username: "pending-user",
          display_name: "Pending User",
          note: "需要项目访问",
          status: "pending"
        })
      ])
    );

    const registrationId = registrations.body.find((item: { username: string }) => item.username === "pending-user").id;
    const approved = await api.handle("POST", ["admin", "registrations", registrationId, "approve"]);
    expect(approved.body).toMatchObject({
      username: "pending-user",
      display_name: "Pending User",
      role: "user",
      status: "active"
    });
    expect((await api.handle("GET", ["users"])).body).toEqual(
      expect.arrayContaining([expect.objectContaining({ username: "pending-user", status: "active" })])
    );

    now += 60_000;
    const rejectedRegistration = await api.handle("POST", ["register"], {
      username: "reject-me",
      password: "secret1",
      note: "临时申请"
    });
    expect(rejectedRegistration.status).toBe(200);
    const beforeReject = await api.handle("GET", ["admin", "registrations"]);
    const rejectId = beforeReject.body.find((item: { username: string }) => item.username === "reject-me").id;
    expect((await api.handle("POST", ["admin", "registrations", rejectId, "reject"])).body).toEqual({
      rejected: rejectId
    });
    expect((await api.handle("POST", ["register"], { username: "reject-me", password: "secret1" })).status).toBe(200);
  });

  test("supports oauth model backends and per-user model login mock flows without returning secrets", async () => {
    const api = createMockApi({ now: () => Date.parse("2026-06-12T12:00:00Z") });

    const created = await api.handle("POST", ["admin", "models"], {
      name: "Codex 订阅",
      base_url: "https://codex.example/v1",
      model: "codex-mini",
      auth_type: "oauth",
      auth_scope: "per_user",
      runtime: "codex_responses",
      oauth: {
        client_id: "client_from_admin",
        client_secret: "secret_from_admin",
        token_url: "https://login.example/token",
        device_authorization_url: "https://login.example/device",
        scope: "openid profile"
      },
      max_concurrency: 2,
      is_default: false
    });
    expect(created.status).toBe(200);
    expect(created.body).toMatchObject({
      name: "Codex 订阅",
      auth_type: "oauth",
      auth_scope: "per_user",
      runtime: "codex_responses",
      oauth: expect.objectContaining({
        status: "pending",
        client_id: "client_from_admin",
        has_device_flow: true
      })
    });
    expect(JSON.stringify(created.body)).not.toContain("secret_from_admin");

    const start = await api.handle("POST", ["admin", "models", created.body.id, "oauth", "device", "start"]);
    expect(start.body).toMatchObject({ user_code: expect.any(String), verification_uri: expect.any(String) });
    const firstPoll = await api.handle("POST", ["admin", "models", created.body.id, "oauth", "device", "poll"]);
    const secondPoll = await api.handle("POST", ["admin", "models", created.body.id, "oauth", "device", "poll"]);
    expect(firstPoll.body).toEqual({ status: "pending" });
    expect(secondPoll.body).toEqual({ status: "authorized" });

    const refreshed = await api.handle("POST", ["admin", "models", created.body.id, "oauth", "refresh"]);
    expect(refreshed.body).toEqual({ status: "refreshed" });

    const logins = await api.handle("GET", ["me", "model-logins"]);
    expect(logins.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ backend_id: created.body.id, runtime: "codex_responses", logged_in: false })
      ])
    );
    const loginStart = await api.handle("POST", ["me", "model-logins", created.body.id, "device", "start"]);
    expect(loginStart.body).toMatchObject({ user_code: expect.any(String) });
    expect((await api.handle("POST", ["me", "model-logins", created.body.id, "device", "poll"])).body).toEqual({
      status: "pending"
    });
    expect((await api.handle("POST", ["me", "model-logins", created.body.id, "device", "poll"])).body).toEqual({
      status: "authorized"
    });
    expect((await api.handle("GET", ["me", "model-logins"])).body).toEqual(
      expect.arrayContaining([expect.objectContaining({ backend_id: created.body.id, logged_in: true })])
    );
    expect((await api.handle("DELETE", ["me", "model-logins", created.body.id])).body).toEqual({
      logged_out: true
    });
  });

  test("supports personal api keys with plaintext returned only on creation", async () => {
    const api = createMockApi({ now: () => Date.parse("2026-06-12T12:00:00Z") });

    const initial = await api.handle("GET", ["me", "api-keys"]);
    expect(initial.body).toEqual([
      expect.objectContaining({ id: "ak_mock_seed", prefix: expect.stringContaining("ak_") })
    ]);
    expect(JSON.stringify(initial.body)).not.toContain("ak_mock_plain");

    const created = await api.handle("POST", ["me", "api-keys"], { name: "local agent" });
    expect(created.body).toMatchObject({
      id: expect.stringMatching(/^ak_mock_/),
      prefix: expect.stringContaining("ak_mock"),
      api_key: expect.stringMatching(/^ak_mock_/)
    });

    const afterCreate = await api.handle("GET", ["me", "api-keys"]);
    expect(JSON.stringify(afterCreate.body)).not.toContain(created.body.api_key);

    const deleted = await api.handle("DELETE", ["me", "api-keys", created.body.id]);
    expect(deleted.body).toEqual({ deleted: true });
  });

  test("supports connector mock flows without returning env values", async () => {
    const api = createMockApi({ now: () => Date.parse("2026-06-11T12:00:00Z") });

    const presets = await api.handle("GET", ["admin", "connector-presets"]);
    expect(presets.status).toBe(200);
    expect(presets.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "github",
          command: "npx",
          args: expect.arrayContaining(["@modelcontextprotocol/server-github"]),
          env_keys: expect.arrayContaining(["GITHUB_PERSONAL_ACCESS_TOKEN"])
        }),
        expect.objectContaining({ id: "filesystem", env_keys: [] }),
        expect.objectContaining({ id: "custom" })
      ])
    );

    const initial = await api.handle("GET", ["admin", "connectors"]);
    expect(initial.status).toBe(200);
    expect(initial.body[0]).toMatchObject({
      status: "connected",
      env_keys: expect.arrayContaining(["GITHUB_TOKEN"]),
      require_approval: expect.any(Boolean)
    });

    const created = await api.handle("POST", ["admin", "connectors"], {
      name: "Slack MCP",
      transport: "http",
      url: "https://mcp.example.test",
      env: { SLACK_TOKEN: "xoxb-live-secret" },
      scope_all: true,
      require_approval: true
    });
    expect(created.status).toBe(200);
    expect(created.body).toMatchObject({ env_keys: ["SLACK_TOKEN"], scope_all: true, require_approval: true });
    expect(JSON.stringify(created.body)).not.toContain("xoxb-live-secret");

    const scoped = await api.handle("PUT", ["admin", "connectors", created.body.id, "scope"], {
      user_ids: ["u_mock_user"]
    });
    expect(scoped.body).toEqual({ user_ids: ["u_mock_user"] });

    const updated = await api.handle("PATCH", ["admin", "connectors", created.body.id], {
      enabled: false,
      require_approval: false
    });
    expect(updated.body).toMatchObject({
      enabled: false,
      require_approval: false,
      status: "disabled",
      env_keys: ["SLACK_TOKEN"]
    });
    expect(JSON.stringify(updated.body)).not.toContain("xoxb-live-secret");
  });

  test("supports connector registry search and registry outage in mock mode", async () => {
    const api = createMockApi({ now: () => Date.parse("2026-06-11T12:00:00Z") });

    const fetchResults = await api.handle(
      "GET",
      ["admin", "connector-registry"],
      undefined,
      new URLSearchParams("q=fetch&limit=20")
    );
    expect(fetchResults.status).toBe(200);
    expect(fetchResults.body).toEqual([
      expect.objectContaining({
        name: "io.modelcontextprotocol/fetch",
        title: "Fetch MCP",
        installable: true,
        install: expect.objectContaining({
          command: "uvx",
          args: ["mcp-server-fetch==1.0.0"],
          env_keys: ["FETCH_TOKEN"]
        })
      })
    ]);

    const unsupported = await api.handle(
      "GET",
      ["admin", "connector-registry"],
      undefined,
      new URLSearchParams("q=legacy&limit=20")
    );
    expect(unsupported.body).toEqual([
      expect.objectContaining({
        title: "Legacy MCP",
        installable: false,
        install: null
      })
    ]);

    const unavailable = await api.handle(
      "GET",
      ["admin", "connector-registry"],
      undefined,
      new URLSearchParams("q=unavailable&limit=20")
    );
    expect(unavailable).toEqual({
      status: 502,
      body: { error: { code: "registry_unavailable", message: "连接器注册表暂不可用" } }
    });
  });

  test("supports skill mock flows with authorization filtering and import", async () => {
    const api = createMockApi({ now: () => Date.parse("2026-06-11T12:00:00Z") });

    const userSkills = await api.handle("GET", ["skills"]);
    expect(userSkills.status).toBe(200);
    expect(userSkills.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "skill_mock_review", enabled: true, source: "builtin" }),
        expect.objectContaining({ id: "skill_mock_release", enabled: false, source: "custom" })
      ])
    );
    expect(userSkills.body).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "skill_mock_private" })])
    );

    const toggled = await api.handle("PUT", ["skills", "skill_mock_review", "enabled"], { enabled: false });
    expect(toggled.body).toMatchObject({ id: "skill_mock_review", enabled: false });

    const afterToggle = await api.handle("GET", ["skills"]);
    expect(afterToggle.body).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "skill_mock_review", enabled: false })])
    );

    const adminSkills = await api.handle("GET", ["admin", "skills"]);
    expect(adminSkills.body).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "skill_mock_private" })])
    );

    const created = await api.handle("POST", ["admin", "skills"], {
      name: "Deploy Helper",
      description: "发布前检查",
      prompt: "Prepare release notes",
      scope_all: true
    });
    expect(created.status).toBe(200);
    expect(created.body).toMatchObject({
      id: expect.stringMatching(/^skill_mock_/),
      name: "Deploy Helper",
      source: "custom",
      scope_all: true
    });

    const updated = await api.handle("PATCH", ["admin", "skills", created.body.id], {
      prompt: "New prompt"
    });
    expect(updated.body).toMatchObject({ prompt: "New prompt" });

    const scoped = await api.handle("PUT", ["admin", "skills", created.body.id, "scope"], {
      user_ids: ["u_mock_user"]
    });
    expect(scoped.body).toEqual({ user_ids: ["u_mock_user"] });

    const imported = await api.handle("POST", ["admin", "skills", "import"], {
      url: "https://raw.githubusercontent.com/acme/repo/main/SKILL.md",
      scope_all: true
    });
    expect(imported.body).toMatchObject({
      source_ref: "https://raw.githubusercontent.com/acme/repo/main/SKILL.md",
      source: "imported",
      scope_all: true
    });

    const afterImport = await api.handle("GET", ["skills"]);
    expect(afterImport.body).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: imported.body.id })])
    );

    const deleted = await api.handle("DELETE", ["admin", "skills", created.body.id]);
    expect(deleted.body).toEqual({ deleted: true });
  });
});
