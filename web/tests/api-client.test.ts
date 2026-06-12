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
  createConnector,
  createEnrollmentToken,
  createSkill,
  createMachineGrant,
  createModelBackend,
  createPersonalApiKey,
  createSession,
  createUser,
  createWsTicket,
  deleteConnector,
  deleteModelBackend,
  deleteMyModelLogin,
  deletePersonalApiKey,
  deleteSkill,
  discoverModelProvider,
  getModelOAuthAuthorizeUrl,
  importSkill,
  listConnectors,
  listConnectorPresets,
  listConnectorRegistry,
  listMachines,
  listAdminSkills,
  listMyModelLogins,
  listModelBackends,
  listModelProviders,
  listModelRoutes,
  listPersonalApiKeys,
  listSkills,
  getSessionMessages,
  listApprovals,
  listMachineGrants,
  listUsers,
  login,
  logout,
  putConnectorScope,
  putModelRoute,
  putSkillScope,
  rejectApproval,
  revokeGrant,
  sendSessionMessage,
  setSkillEnabled,
  startModelOAuthDevice,
  startMyModelLoginDevice,
  pollModelOAuthDevice,
  pollMyModelLoginDevice,
  refreshModelOAuth,
  submitModelOAuthCallback,
  updateConnector,
  updateModelBackend,
  updateSkill
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

  test("uses admin model endpoints through the proxy and keeps keys out of headers", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              id: "model_1",
              name: "DeepSeek",
              base_url: "https://api.deepseek.com",
              model: "deepseek-chat",
              api_key: "sk-…cdef",
              max_concurrency: 4,
              enabled: true,
              is_default: true,
              created_at: "2026-06-11T00:00:00Z"
            }
          ]),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "model_2", api_key: "sk-…7890" }), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "model_1", api_key: "sk-…cdef" }), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ deleted: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([{ user_id: "u_1", backend_id: "model_1" }]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ user_id: "u_1", backend_id: null }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(listModelBackends()).resolves.toHaveLength(1);
    await createModelBackend({
      name: "OpenAI",
      base_url: "https://api.openai.com/v1",
      model: "gpt-4.1",
      api_key: "sk-live-secret",
      max_concurrency: 3,
      is_default: false
    });
    await updateModelBackend("model_1", { enabled: false, max_concurrency: 2 });
    await deleteModelBackend("model_1");
    await expect(listModelRoutes()).resolves.toEqual([{ user_id: "u_1", backend_id: "model_1" }]);
    await putModelRoute("u_1", null);

    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/proxy/admin/models", expect.any(Object));
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/proxy/admin/models",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          name: "OpenAI",
          base_url: "https://api.openai.com/v1",
          model: "gpt-4.1",
          api_key: "sk-live-secret",
          max_concurrency: 3,
          is_default: false
        }),
        headers: expect.not.objectContaining({
          Authorization: expect.anything(),
          "X-API-Key": expect.anything()
        })
      })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "/api/proxy/admin/models/model_1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ enabled: false, max_concurrency: 2 })
      })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      6,
      "/api/proxy/admin/model-routes",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ user_id: "u_1", backend_id: null })
      })
    );
  });

  test("uses provider and connector preset directories through the proxy", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              id: "deepseek",
              name: "DeepSeek",
              base_url: "https://api.deepseek.com/v1",
              models: ["deepseek-chat"],
              needs_key: true,
              note: "官方 API"
            }
          ]),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              id: "github",
              name: "GitHub",
              transport: "stdio",
              command: "npx",
              args: ["-y", "@modelcontextprotocol/server-github"],
              env_keys: ["GITHUB_PERSONAL_ACCESS_TOKEN"],
              note: "需 GitHub PAT"
            }
          ]),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(listModelProviders()).resolves.toEqual([
      expect.objectContaining({ id: "deepseek", needs_key: true })
    ]);
    await expect(listConnectorPresets()).resolves.toEqual([
      expect.objectContaining({ id: "github", env_keys: ["GITHUB_PERSONAL_ACCESS_TOKEN"] })
    ]);

    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/proxy/admin/model-providers", expect.any(Object));
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/proxy/admin/connector-presets", expect.any(Object));
  });

  test("discovers model provider models without putting keys in headers", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ models: ["mock-chat", "mock-coder"], count: 2 }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      discoverModelProvider({ base_url: "https://api.deepseek.com/v1", api_key: "sk-live-secret" })
    ).resolves.toEqual({ models: ["mock-chat", "mock-coder"], count: 2 });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/proxy/admin/model-providers/discover",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ base_url: "https://api.deepseek.com/v1", api_key: "sk-live-secret" }),
        headers: expect.not.objectContaining({
          Authorization: expect.anything(),
          "X-API-Key": expect.anything()
        })
      })
    );
  });

  test("uses personal api key endpoints through the proxy", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([{ id: "ak_1", name: "ci", prefix: "ak_3f9c1b2…", created_at: "2026-06-12T00:00:00Z", last_used_at: null }]),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ id: "ak_2", name: "local", prefix: "ak_mock…", api_key: "ak_mock_plain" }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ deleted: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(listPersonalApiKeys()).resolves.toHaveLength(1);
    await expect(createPersonalApiKey({ name: "local" })).resolves.toMatchObject({ api_key: "ak_mock_plain" });
    await expect(deletePersonalApiKey("ak_1")).resolves.toEqual({ deleted: true });

    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/proxy/me/api-keys", expect.any(Object));
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/proxy/me/api-keys",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ name: "local" }) })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "/api/proxy/me/api-keys/ak_1",
      expect.objectContaining({ method: "DELETE" })
    );
  });

  test("uses model oauth and per-user login endpoints through the proxy", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ verification_uri: "https://login.example/device", user_code: "ABCD-EFGH", expires_in: 900, interval: 0 }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: "authorized" }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ authorize_url: "https://login.example/oauth", state: "state_1" }), { status: 200 })
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: "authorized" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: "refreshed" }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify([{ backend_id: "model_codex", name: "Codex 订阅", model: "codex", runtime: "codex_responses", logged_in: false, updated_at: null }]), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ verification_uri: "https://chatgpt.com/activate", user_code: "USER-CODE", expires_in: 900, interval: 0 }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: "authorized" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ logged_out: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(startModelOAuthDevice("model_1")).resolves.toMatchObject({ user_code: "ABCD-EFGH" });
    await expect(pollModelOAuthDevice("model_1")).resolves.toEqual({ status: "authorized" });
    await expect(getModelOAuthAuthorizeUrl("model_1")).resolves.toMatchObject({ state: "state_1" });
    await expect(submitModelOAuthCallback("model_1", { code: "code_1", state: "state_1" })).resolves.toEqual({ status: "authorized" });
    await expect(refreshModelOAuth("model_1")).resolves.toEqual({ status: "refreshed" });
    await expect(listMyModelLogins()).resolves.toHaveLength(1);
    await expect(startMyModelLoginDevice("model_codex")).resolves.toMatchObject({ user_code: "USER-CODE" });
    await expect(pollMyModelLoginDevice("model_codex")).resolves.toEqual({ status: "authorized" });
    await expect(deleteMyModelLogin("model_codex")).resolves.toEqual({ logged_out: true });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/proxy/admin/models/model_1/oauth/device/start",
      expect.objectContaining({ method: "POST" })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      "/api/proxy/admin/models/model_1/oauth/callback",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ code: "code_1", state: "state_1" }) })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(6, "/api/proxy/me/model-logins", expect.any(Object));
    expect(fetchMock).toHaveBeenNthCalledWith(
      9,
      "/api/proxy/me/model-logins/model_codex",
      expect.objectContaining({ method: "DELETE" })
    );
  });

  test("searches the connector registry through the proxy", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          {
            name: "io.modelcontextprotocol/fetch",
            title: "Fetch MCP",
            description: "Fetches web content",
            version: "1.0.0",
            installable: true,
            install: {
              transport: "stdio",
              command: "uvx",
              args: ["mcp-server-fetch==1.0.0"],
              env_keys: []
            }
          }
        ]),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(listConnectorRegistry("fetch", 20)).resolves.toEqual([
      expect.objectContaining({
        name: "io.modelcontextprotocol/fetch",
        install: expect.objectContaining({ command: "uvx" })
      })
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/proxy/admin/connector-registry?q=fetch&limit=20",
      expect.any(Object)
    );
  });

  test("uses admin connector endpoints through the proxy without echoing env values in reads", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              id: "conn_1",
              name: "GitHub MCP",
              transport: "stdio",
              command: "npx",
              args: ["-y", "@modelcontextprotocol/server-github"],
              env_keys: ["GITHUB_TOKEN"],
              enabled: true,
              scope_all: false,
              scopes: ["u_1"],
              status: "connected",
              tool_count: 8,
              created_at: "2026-06-11T00:00:00Z"
            }
          ]),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "conn_2", env_keys: ["GITHUB_TOKEN"] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "conn_1", env_keys: ["GITHUB_TOKEN"] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ user_ids: ["u_1", "u_2"] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ deleted: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const connectors = await listConnectors();
    await createConnector({
      name: "GitHub MCP",
      transport: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github"],
      env: { GITHUB_TOKEN: "ghp_live_secret" },
      scope_all: false
    });
    await updateConnector("conn_1", { enabled: false });
    await putConnectorScope("conn_1", ["u_1", "u_2"]);
    await deleteConnector("conn_1");

    expect(JSON.stringify(connectors)).not.toContain("ghp_live_secret");
    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/proxy/admin/connectors", expect.any(Object));
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/proxy/admin/connectors",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          name: "GitHub MCP",
          transport: "stdio",
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-github"],
          env: { GITHUB_TOKEN: "ghp_live_secret" },
          scope_all: false
        }),
        headers: expect.not.objectContaining({
          Authorization: expect.anything(),
          "X-API-Key": expect.anything()
        })
      })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "/api/proxy/admin/connectors/conn_1",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ enabled: false }) })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      "/api/proxy/admin/connectors/conn_1/scope",
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ user_ids: ["u_1", "u_2"] }) })
    );
  });

  test("uses skill endpoints through the proxy", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify([{ id: "skill_1", name: "Code Review", description: "检查改动", enabled: true }]), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "skill_1", name: "Code Review", description: "检查改动", enabled: false }), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              id: "skill_1",
              name: "Code Review",
              description: "检查改动",
              prompt: "Review this diff",
              source_ref: null,
              scope_all: true,
              scopes: [],
              created_at: "2026-06-11T00:00:00Z"
            }
          ]),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "skill_2", name: "Deploy Helper" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "skill_1", prompt: "New prompt" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ user_ids: ["u_1"] }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "skill_3",
            name: "Imported Skill",
            source_ref: "https://raw.githubusercontent.com/acme/repo/main/SKILL.md"
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ deleted: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(listSkills()).resolves.toHaveLength(1);
    await expect(setSkillEnabled("skill_1", false)).resolves.toMatchObject({ enabled: false });
    await expect(listAdminSkills()).resolves.toHaveLength(1);
    await createSkill({
      name: "Deploy Helper",
      description: "发布检查",
      prompt: "Prepare release notes",
      scope_all: false
    });
    await updateSkill("skill_1", { prompt: "New prompt" });
    await putSkillScope("skill_1", ["u_1"]);
    await importSkill({
      url: "https://raw.githubusercontent.com/acme/repo/main/SKILL.md",
      scope_all: true
    });
    await deleteSkill("skill_1");

    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/proxy/skills", expect.any(Object));
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/proxy/skills/skill_1/enabled",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ enabled: false }),
        headers: expect.not.objectContaining({
          Authorization: expect.anything(),
          "X-API-Key": expect.anything()
        })
      })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(3, "/api/proxy/admin/skills", expect.any(Object));
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      "/api/proxy/admin/skills",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          name: "Deploy Helper",
          description: "发布检查",
          prompt: "Prepare release notes",
          scope_all: false
        })
      })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      5,
      "/api/proxy/admin/skills/skill_1",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ prompt: "New prompt" }) })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      6,
      "/api/proxy/admin/skills/skill_1/scope",
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ user_ids: ["u_1"] }) })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      7,
      "/api/proxy/admin/skills/import",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          url: "https://raw.githubusercontent.com/acme/repo/main/SKILL.md",
          scope_all: true
        })
      })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      8,
      "/api/proxy/admin/skills/skill_1",
      expect.objectContaining({ method: "DELETE" })
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

  test("gets the current user and logs out through upstream then auth routes", async () => {
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
      "/api/proxy/auth/logout",
      expect.objectContaining({ method: "POST" })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "/api/auth/logout",
      expect.objectContaining({ method: "POST" })
    );
  });

  test("logs out locally even when upstream logout is unavailable", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { code: "upstream_unavailable", message: "离线" } }), {
          status: 502,
          headers: { "content-type": "application/json" }
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(logout()).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/proxy/auth/logout",
      expect.objectContaining({ method: "POST" })
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

  test("requests websocket tickets through the proxy", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ ticket: "wst_123" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(createWsTicket()).resolves.toEqual({ ticket: "wst_123" });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/proxy/ws-ticket",
      expect.objectContaining({ method: "POST" })
    );
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
