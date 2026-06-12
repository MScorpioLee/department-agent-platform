import type {
  AdminSkill,
  Approval,
  ChatMessage,
  Connector,
  ConnectorPreset,
  ConnectorTransport,
  CreateTaskRequest,
  Machine,
  MachineGrant,
  ModelBackend,
  ModelProvider,
  ModelRoute,
  Skill,
  TaskOutput,
  TaskRecord,
  TaskStatus,
  ToolName,
  User
} from "@/lib/types";

const ALL_CAPABILITIES: ToolName[] = [
  "remote_exec",
  "remote_read_file",
  "remote_write_file",
  "remote_patch_file",
  "remote_list_files"
];

const COMPLETION_DELAY_MS = 3000;
const TERMINAL_STATUSES = new Set<TaskStatus>(["completed", "failed", "timeout", "cancelled", "lost"]);

export interface MockApiOptions {
  now?: () => number;
}

export interface MockApiResponse {
  status: number;
  body: any;
}

interface InternalTask {
  task: TaskRecord;
  createdMs: number;
  output: TaskOutput;
}

interface InternalSession {
  session_id: string;
  machine_id: string;
  status: string;
  title: string;
  messages: ChatMessage[];
}

function maskSecret(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.includes("…")) return trimmed;
  if (trimmed.length <= 7) return "••••";
  return `${trimmed.slice(0, 3)}…${trimmed.slice(-4)}`;
}

function error(status: number, code: string, message: string): MockApiResponse {
  return { status, body: { error: { code, message } } };
}

function requiredString(payload: Record<string, unknown>, key: string, label = key): MockApiResponse | null {
  const value = payload[key];
  if (typeof value !== "string" || value.trim() === "") {
    return error(422, "validation_error", `${label} 不能为空`);
  }
  return null;
}

function optionalNumber(payload: Record<string, unknown>, key: string, label = key): MockApiResponse | null {
  const value = payload[key];
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "number" || Number.isNaN(value) || value < 0) {
    return error(422, "validation_error", `${label} 必须是非负数字`);
  }
  return null;
}

function validatePayload(tool: ToolName, payload: Record<string, unknown>): MockApiResponse | null {
  switch (tool) {
    case "remote_exec":
      return (
        requiredString(payload, "workdir", "workdir") ??
        requiredString(payload, "command", "command") ??
        optionalNumber(payload, "timeout_seconds", "timeout_seconds")
      );
    case "remote_read_file":
      return (
        requiredString(payload, "path", "path") ??
        optionalNumber(payload, "offset", "offset") ??
        optionalNumber(payload, "limit", "limit")
      );
    case "remote_write_file":
      return requiredString(payload, "path", "path") ?? requiredString(payload, "content", "content");
    case "remote_patch_file":
      if (typeof payload.replace_all !== "undefined" && typeof payload.replace_all !== "boolean") {
        return error(422, "validation_error", "replace_all 必须是布尔值");
      }
      return (
        requiredString(payload, "path", "path") ??
        requiredString(payload, "old_string", "old_string") ??
        requiredString(payload, "new_string", "new_string")
      );
    case "remote_list_files":
      return requiredString(payload, "path", "path") ?? optionalNumber(payload, "max_entries", "max_entries");
  }
}

function auditUsageFixture() {
  return {
    total_tokens: 127600,
    by_user_backend: [
      {
        user_id: "u_mock_admin",
        backend_id: "openai",
        prompt_tokens: 32000,
        completion_tokens: 46000,
        total_tokens: 78000,
        turns: 42
      },
      {
        user_id: "u_mock_user",
        backend_id: "anthropic",
        prompt_tokens: 18400,
        completion_tokens: 31200,
        total_tokens: 49600,
        turns: 28
      }
    ]
  };
}

function auditSessionsFixture(nowMs: number) {
  return [
    {
      session_id: "s_mock_1",
      user_id: "u_mock_admin",
      machine_id: "m_mock_online",
      title: "排查构建失败",
      status: "active",
      message_count: 8,
      created_at: new Date(nowMs - 12 * 60 * 1000).toISOString()
    },
    {
      session_id: "s_mock_2",
      user_id: "u_mock_user",
      machine_id: "m_mock_online",
      title: "查看日志输出",
      status: "completed",
      message_count: 5,
      created_at: new Date(nowMs - 58 * 60 * 1000).toISOString()
    },
    {
      session_id: "s_mock_3",
      user_id: "u_mock_user",
      machine_id: "m_mock_offline",
      title: "同步环境信息",
      status: "completed",
      message_count: 3,
      created_at: new Date(nowMs - 3 * 60 * 60 * 1000).toISOString()
    }
  ];
}

function auditToolCallsFixture(nowMs: number) {
  return [
    {
      id: "tc_mock_1",
      session_id: "s_mock_1",
      machine_id: "m_mock_online",
      tool_name: "remote_exec",
      arguments: { command: "npm test [redacted]", workdir: "/workspace/app" },
      result: { exit_code: 0, duration_ms: 2400 },
      status: "completed",
      created_at: new Date(nowMs - 10 * 60 * 1000).toISOString()
    },
    {
      id: "tc_mock_2",
      session_id: "s_mock_1",
      machine_id: "m_mock_online",
      tool_name: "remote_read_file",
      arguments: { path: "/workspace/app/.env.[redacted]" },
      result: { content: "[redacted]", total_lines: 12 },
      status: "completed",
      created_at: new Date(nowMs - 9 * 60 * 1000).toISOString()
    },
    {
      id: "tc_mock_3",
      session_id: "s_mock_2",
      machine_id: "m_mock_online",
      tool_name: "remote_list_files",
      arguments: { path: "/var/log" },
      result: { entries: [{ name: "app.log", type: "file", size: 2048 }] },
      status: "completed",
      created_at: new Date(nowMs - 55 * 60 * 1000).toISOString()
    }
  ];
}

function auditCommandsFixture(nowMs: number) {
  return [
    {
      task_id: "t_audit_1",
      machine_id: "m_mock_online",
      command: "npm test [redacted]",
      status: "completed",
      exit_code: 0,
      stdout: "15 tests passed\n[redacted]",
      stderr: "",
      created_at: new Date(nowMs - 10 * 60 * 1000).toISOString()
    },
    {
      task_id: "t_audit_2",
      machine_id: "m_mock_online",
      command: "cat /var/log/app.log | tail [redacted]",
      status: "completed",
      exit_code: 0,
      stdout: "service started\nrequest complete\n[redacted]",
      stderr: "",
      created_at: new Date(nowMs - 52 * 60 * 1000).toISOString()
    },
    {
      task_id: "t_audit_3",
      machine_id: "m_mock_offline",
      command: "systemctl status agent [redacted]",
      status: "failed",
      exit_code: 1,
      stdout: "",
      stderr: "unit not found\n[redacted]",
      created_at: new Date(nowMs - 2 * 60 * 60 * 1000).toISOString()
    }
  ];
}

function isToolName(value: unknown): value is ToolName {
  return typeof value === "string" && ALL_CAPABILITIES.includes(value as ToolName);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function createMockApi(options: MockApiOptions = {}) {
  const now = options.now ?? (() => Date.now());
  const tasks = new Map<string, InternalTask>();
  const sessions = new Map<string, InternalSession>();
  const approvals = new Map<string, Approval>();
  const grants = new Map<string, MachineGrant[]>();
  const users: User[] = [
    { id: "u_mock_admin", username: "admin", display_name: "管理员", role: "admin" },
    { id: "u_mock_user", username: "alice", display_name: "Alice", role: "user" }
  ];
  const modelBackends = new Map<string, ModelBackend>([
    [
      "model_mock_deepseek",
      {
        id: "model_mock_deepseek",
        name: "DeepSeek",
        base_url: "https://api.deepseek.com",
        model: "deepseek-chat",
        api_key: "sk-…cdef",
        max_concurrency: 4,
        enabled: true,
        is_default: true,
        created_at: new Date(now()).toISOString()
      }
    ],
    [
      "model_mock_openai",
      {
        id: "model_mock_openai",
        name: "OpenAI",
        base_url: "https://api.openai.com/v1",
        model: "gpt-4.1",
        api_key: "sk-…7890",
        max_concurrency: 2,
        enabled: true,
        is_default: false,
        created_at: new Date(now() - 60 * 1000).toISOString()
      }
    ]
  ]);
  const modelKeyValues = new Map<string, string>([
    ["model_mock_deepseek", "sk-mock-deepseek-cdef"],
    ["model_mock_openai", "sk-mock-openai-7890"]
  ]);
  const modelRoutes = new Map<string, string>([["u_mock_user", "model_mock_openai"]]);
  const modelProviders: ModelProvider[] = [
    {
      id: "deepseek",
      name: "DeepSeek",
      base_url: "https://api.deepseek.com/v1",
      models: ["deepseek-chat", "deepseek-reasoner"],
      needs_key: true,
      note: "官方 OpenAI 兼容接口"
    },
    {
      id: "openai",
      name: "OpenAI",
      base_url: "https://api.openai.com/v1",
      models: ["gpt-4.1", "gpt-4.1-mini"],
      needs_key: true,
      note: "官方 API Key"
    },
    {
      id: "ollama",
      name: "Ollama",
      base_url: "http://127.0.0.1:11434/v1",
      models: ["llama3.1", "qwen2.5-coder"],
      needs_key: false,
      note: "本地服务可不填 key"
    },
    {
      id: "custom",
      name: "自定义",
      base_url: "",
      models: [],
      needs_key: true,
      note: "手动填写兼容 OpenAI 的 base_url 和 model"
    }
  ];
  const connectors = new Map<string, Connector>([
    [
      "conn_mock_github",
      {
        id: "conn_mock_github",
        name: "GitHub MCP",
        transport: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-github"],
        env_keys: ["GITHUB_TOKEN"],
        enabled: true,
        scope_all: false,
        scopes: ["u_mock_user"],
        status: "connected",
        tool_count: 8,
        created_at: new Date(now()).toISOString()
      }
    ],
    [
      "conn_mock_docs",
      {
        id: "conn_mock_docs",
        name: "Docs MCP",
        transport: "http",
        url: "https://mcp.example.test",
        env_keys: [],
        enabled: false,
        scope_all: true,
        scopes: [],
        status: "disabled",
        tool_count: 0,
        created_at: new Date(now() - 60 * 1000).toISOString()
      }
    ]
  ]);
  const connectorEnvValues = new Map<string, Record<string, string>>([
    ["conn_mock_github", { GITHUB_TOKEN: "ghp_mock_secret" }],
    ["conn_mock_docs", {}]
  ]);
  const connectorPresets: ConnectorPreset[] = [
    {
      id: "github",
      name: "GitHub",
      transport: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github"],
      env_keys: ["GITHUB_PERSONAL_ACCESS_TOKEN"],
      note: "需 GitHub PAT"
    },
    {
      id: "filesystem",
      name: "Filesystem",
      transport: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/dir"],
      env_keys: [],
      note: "请把 /path/to/dir 替换为允许访问的目录"
    },
    {
      id: "custom",
      name: "自定义",
      transport: "stdio",
      args: [],
      env_keys: [],
      note: "手动填写 command/args 或 HTTP URL"
    }
  ];
  const skills = new Map<string, AdminSkill>([
    [
      "skill_mock_review",
      {
        id: "skill_mock_review",
        name: "Code Review",
        description: "检查代码改动并指出风险点",
        prompt: "Review the current code change and prioritize bugs, regressions, and missing tests.",
        source_ref: null,
        source: "builtin",
        scope_all: true,
        scopes: [],
        created_at: new Date(now()).toISOString()
      }
    ],
    [
      "skill_mock_release",
      {
        id: "skill_mock_release",
        name: "Release Notes",
        description: "整理变更摘要和发布检查项",
        prompt: "Prepare concise release notes and note verification coverage.",
        source_ref: null,
        source: "custom",
        scope_all: false,
        scopes: ["u_mock_user"],
        created_at: new Date(now() - 60 * 1000).toISOString()
      }
    ],
    [
      "skill_mock_private",
      {
        id: "skill_mock_private",
        name: "Finance Private",
        description: "仅用于验证未授权技能不会出现在普通列表",
        prompt: "Private finance workflow placeholder.",
        source_ref: null,
        source: "custom",
        scope_all: false,
        scopes: ["u_private_only"],
        created_at: new Date(now() - 120 * 1000).toISOString()
      }
    ]
  ]);
  const skillEnabled = new Map<string, boolean>([
    ["skill_mock_review", true],
    ["skill_mock_release", false],
    ["skill_mock_private", true]
  ]);
  const machineOwners = new Map<string, string | null>([
    ["m_mock_online", "u_mock_admin"],
    ["m_mock_offline", "u_mock_admin"]
  ]);
  let taskCounter = 0;
  let sessionCounter = 0;
  let grantCounter = 0;
  let userCounter = 2;
  let enrollmentCounter = 0;
  let wsTicketCounter = 0;
  let modelCounter = 2;
  let connectorCounter = 2;
  let skillCounter = 3;

  function seedApprovals() {
    if (approvals.size > 0) return;
    const current = now();
    approvals.set("ap_mock_1", {
      approval_id: "ap_mock_1",
      machine_id: "m_mock_online",
      requested_by_user_id: "u_mock_user",
      tool: "remote_exec",
      payload: { workdir: "/workspace/app", command: "rm -rf [redacted]", timeout_seconds: 60 },
      risk_rule: "rm -rf 高风险命令",
      status: "pending",
      created_at: new Date(current - 4 * 60 * 1000).toISOString()
    });
    approvals.set("ap_mock_2", {
      approval_id: "ap_mock_2",
      machine_id: "m_mock_online",
      requested_by_user_id: "u_mock_user",
      tool: "remote_write_file",
      payload: { path: "/etc/[redacted]", content: "[redacted]" },
      risk_rule: "系统路径写入",
      status: "pending",
      created_at: new Date(current - 11 * 60 * 1000).toISOString()
    });
  }

  function seedGrants() {
    if (grants.size > 0) return;
    const current = now();
    grants.set("m_mock_online", [
      {
        grant_id: "g_mock_seed",
        grantee_user_id: "u_mock_user",
        granted_by_user_id: "u_mock_admin",
        expires_at: new Date(current + 24 * 60 * 60 * 1000).toISOString(),
        created_at: new Date(current - 30 * 60 * 1000).toISOString()
      }
    ]);
  }

  function machines(): Machine[] {
    const current = now();
    return [
      {
        machine_id: "m_mock_online",
        machine_name: "alice-laptop",
        owner_user_id: machineOwners.get("m_mock_online") ?? undefined,
        os: "darwin",
        status: "online",
        last_seen_at: new Date(current - 7000).toISOString(),
        capabilities: ALL_CAPABILITIES
      },
      {
        machine_id: "m_mock_offline",
        machine_name: "build-box-01",
        owner_user_id: machineOwners.get("m_mock_offline") ?? undefined,
        os: "linux",
        status: "offline",
        last_seen_at: new Date(current - 45 * 60 * 1000).toISOString(),
        capabilities: ["remote_exec", "remote_read_file", "remote_list_files"]
      }
    ];
  }

  function materializeTask(entry: InternalTask): TaskRecord {
    if (TERMINAL_STATUSES.has(entry.task.status)) {
      return entry.task;
    }

    const elapsed = now() - entry.createdMs;
    const isComplete = elapsed >= COMPLETION_DELAY_MS;
    const status: TaskStatus = isComplete ? "completed" : entry.task.status;

    return {
      ...entry.task,
      status,
      result: isComplete ? { exit_code: 0, duration_ms: COMPLETION_DELAY_MS } : null,
      finished_at: isComplete ? new Date(entry.createdMs + COMPLETION_DELAY_MS).toISOString() : null
    };
  }

  function findTask(taskId: string): InternalTask | undefined {
    return tasks.get(taskId);
  }

  function createTask(body: unknown): MockApiResponse {
    const request = asRecord(body);
    if (!request) return error(422, "validation_error", "请求体必须是对象");

    const machineId = request.machine_id;
    const tool = request.tool;
    const payload = asRecord(request.payload);

    if (typeof machineId !== "string" || machineId.trim() === "") {
      return error(422, "validation_error", "machine_id 不能为空");
    }
    if (!isToolName(tool)) {
      return error(422, "validation_error", "tool 不支持");
    }
    if (!payload) {
      return error(422, "validation_error", "payload 必须是对象");
    }

    const machine = machines().find((item) => item.machine_id === machineId);
    if (!machine) return error(404, "not_found", "机器不存在");
    if (machine.status !== "online") return error(409, "machine_offline", "机器离线，无法下发任务");
    if (!machine.capabilities.includes(tool)) {
      return error(422, "validation_error", "机器不支持该工具");
    }

    const validationError = validatePayload(tool, payload);
    if (validationError) return validationError;

    const createdMs = now();
    const taskId = `t_mock_${createdMs}_${++taskCounter}`;
    const normalizedPayload =
      tool === "remote_exec" && payload.timeout_seconds === undefined
        ? { ...payload, timeout_seconds: 60 }
        : payload;
    const requestForOutput: CreateTaskRequest = {
      machine_id: machineId,
      tool,
      payload: normalizedPayload
    };

    const task: TaskRecord = {
      task_id: taskId,
      machine_id: machineId,
      tool,
      payload: normalizedPayload,
      status: "queued",
      result: null,
      created_at: new Date(createdMs).toISOString(),
      finished_at: null
    };

    tasks.set(taskId, {
      task,
      createdMs,
      output: {
        stdout: `mock task completed\nmachine_id=${requestForOutput.machine_id}\ntool=${requestForOutput.tool}\n`,
        stderr: "",
        truncated: false
      }
    });

    return { status: 200, body: { task_id: taskId, status: "queued" } };
  }

  function createUser(body: unknown): MockApiResponse {
    const request = asRecord(body);
    if (!request) return error(422, "validation_error", "请求体必须是对象");
    const username = typeof request.username === "string" ? request.username.trim() : "";
    const password = typeof request.password === "string" ? request.password : "";
    const displayName = typeof request.display_name === "string" ? request.display_name.trim() : "";
    const role = request.role === "admin" ? "admin" : "user";

    if (!username) return error(422, "validation_error", "username 不能为空");
    if (password.length < 6) return error(422, "validation_error", "password 最少 6 位");
    if (users.some((user) => user.username === username)) {
      return error(409, "user_exists", "用户名已存在");
    }

    const user: User = {
      id: `u_mock_${++userCounter}`,
      username,
      display_name: displayName || username,
      role
    };
    users.push(user);
    return { status: 200, body: user };
  }

  function createEnrollmentToken(body: unknown): MockApiResponse {
    const request = asRecord(body);
    if (!request) return error(422, "validation_error", "请求体必须是对象");
    const ownerUserId =
      typeof request.owner_user_id === "string" && request.owner_user_id.trim()
        ? request.owner_user_id.trim()
        : null;
    const maxUses = typeof request.max_uses === "number" ? request.max_uses : 1;
    const expiresInDays = typeof request.expires_in_days === "number" ? request.expires_in_days : 7;

    if (ownerUserId && !users.some((user) => user.id === ownerUserId)) {
      return error(404, "user_not_found", "用户不存在");
    }
    if (!Number.isFinite(maxUses) || maxUses <= 0) {
      return error(422, "validation_error", "max_uses 必须大于 0");
    }
    if (!Number.isFinite(expiresInDays) || expiresInDays <= 0) {
      return error(422, "validation_error", "expires_in_days 必须大于 0");
    }

    return {
      status: 200,
      body: {
        enrollment_token: `et_mock_${++enrollmentCounter}`,
        owner_user_id: ownerUserId,
        max_uses: maxUses
      }
    };
  }

  function assignMachine(machineId: string | undefined, body: unknown): MockApiResponse {
    if (!machineId || !machines().some((machine) => machine.machine_id === machineId)) {
      return error(404, "not_found", "机器不存在");
    }
    const request = asRecord(body);
    const userId = typeof request?.user_id === "string" && request.user_id.trim() ? request.user_id.trim() : null;
    if (userId && !users.some((user) => user.id === userId)) {
      return error(404, "user_not_found", "用户不存在");
    }
    machineOwners.set(machineId, userId);
    return { status: 200, body: { machine_id: machineId, owner_user_id: userId } };
  }

  function cancelTask(taskId: string): MockApiResponse {
    const entry = tasks.get(taskId);
    if (!entry) return error(404, "not_found", "任务不存在");
    const task = materializeTask(entry);
    if (TERMINAL_STATUSES.has(task.status)) {
      return error(409, "already_finished", "任务已结束");
    }
    entry.task = {
      ...entry.task,
      status: "cancelled",
      result: null,
      finished_at: new Date(now()).toISOString()
    };
    return { status: 200, body: { task_id: taskId, status: "cancelled" } };
  }

  function allModelBackends() {
    return Array.from(modelBackends.values());
  }

  function setOnlyDefault(backendId: string) {
    for (const [id, backend] of modelBackends.entries()) {
      modelBackends.set(id, { ...backend, is_default: id === backendId });
    }
  }

  function createModelBackend(body: unknown): MockApiResponse {
    const request = asRecord(body);
    if (!request) return error(422, "validation_error", "请求体必须是对象");
    const name = typeof request.name === "string" ? request.name.trim() : "";
    const baseUrl = typeof request.base_url === "string" ? request.base_url.trim() : "";
    const model = typeof request.model === "string" ? request.model.trim() : "";
    const apiKey = typeof request.api_key === "string" ? request.api_key.trim() : "";
    const maxConcurrency = typeof request.max_concurrency === "number" ? request.max_concurrency : 1;
    const isDefault = request.is_default === true;

    if (!name) return error(422, "validation_error", "name 不能为空");
    if (!baseUrl) return error(422, "validation_error", "base_url 不能为空");
    if (!model) return error(422, "validation_error", "model 不能为空");
    if (!Number.isFinite(maxConcurrency) || maxConcurrency <= 0) {
      return error(422, "validation_error", "max_concurrency 必须大于 0");
    }

    const id = `model_mock_${++modelCounter}`;
    const backend: ModelBackend = {
      id,
      name,
      base_url: baseUrl,
      model,
      api_key: apiKey ? maskSecret(apiKey) : "",
      max_concurrency: maxConcurrency,
      enabled: request.enabled !== false,
      is_default: isDefault,
      created_at: new Date(now()).toISOString()
    };
    modelBackends.set(id, backend);
    modelKeyValues.set(id, apiKey);
    if (isDefault) setOnlyDefault(id);
    return { status: 200, body: modelBackends.get(id) };
  }

  function updateModelBackend(backendId: string | undefined, body: unknown): MockApiResponse {
    if (!backendId || !modelBackends.has(backendId)) return error(404, "not_found", "模型后端不存在");
    const request = asRecord(body);
    if (!request) return error(422, "validation_error", "请求体必须是对象");
    const current = modelBackends.get(backendId)!;
    const next: ModelBackend = { ...current };

    if (typeof request.name === "string") next.name = request.name.trim();
    if (typeof request.base_url === "string") next.base_url = request.base_url.trim();
    if (typeof request.model === "string") next.model = request.model.trim();
    if (typeof request.max_concurrency === "number") next.max_concurrency = request.max_concurrency;
    if (typeof request.enabled === "boolean") next.enabled = request.enabled;
    if (typeof request.api_key === "string" && request.api_key.trim()) {
      modelKeyValues.set(backendId, request.api_key.trim());
      next.api_key = maskSecret(request.api_key);
    }
    if (typeof request.is_default === "boolean") next.is_default = request.is_default;
    modelBackends.set(backendId, next);
    if (request.is_default === true) setOnlyDefault(backendId);
    return { status: 200, body: modelBackends.get(backendId) };
  }

  function deleteModelBackend(backendId: string | undefined): MockApiResponse {
    if (!backendId || !modelBackends.has(backendId)) return error(404, "not_found", "模型后端不存在");
    modelBackends.delete(backendId);
    modelKeyValues.delete(backendId);
    for (const [userId, routeBackendId] of modelRoutes.entries()) {
      if (routeBackendId === backendId) modelRoutes.delete(userId);
    }
    if (!allModelBackends().some((backend) => backend.is_default)) {
      const first = allModelBackends()[0];
      if (first) modelBackends.set(first.id, { ...first, is_default: true });
    }
    return { status: 200, body: { deleted: true } };
  }

  function putModelRoute(body: unknown): MockApiResponse {
    const request = asRecord(body);
    if (!request) return error(422, "validation_error", "请求体必须是对象");
    const userId = typeof request.user_id === "string" ? request.user_id.trim() : "";
    const backendId =
      typeof request.backend_id === "string" && request.backend_id.trim() ? request.backend_id.trim() : null;
    if (!users.some((user) => user.id === userId)) return error(404, "user_not_found", "用户不存在");
    if (backendId && !modelBackends.has(backendId)) return error(404, "not_found", "模型后端不存在");
    if (backendId) {
      modelRoutes.set(userId, backendId);
    } else {
      modelRoutes.delete(userId);
    }
    return { status: 200, body: { user_id: userId, backend_id: backendId } satisfies ModelRoute };
  }

  function connectorStatus(enabled: boolean) {
    return enabled ? "connected" : "disabled";
  }

  function parseArgs(value: unknown): string[] | undefined {
    if (value === undefined) return undefined;
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is string => typeof item === "string");
  }

  function parseEnv(value: unknown): Record<string, string> | undefined {
    if (value === undefined) return undefined;
    const record = asRecord(value);
    if (!record) return {};
    return Object.fromEntries(
      Object.entries(record)
        .filter(([key, envValue]) => key.trim() && typeof envValue === "string")
        .map(([key, envValue]) => [key.trim(), envValue as string])
    );
  }

  function createConnector(body: unknown): MockApiResponse {
    const request = asRecord(body);
    if (!request) return error(422, "validation_error", "请求体必须是对象");
    const name = typeof request.name === "string" ? request.name.trim() : "";
    const transport = request.transport === "http" ? "http" : request.transport === "stdio" ? "stdio" : null;
    const command = typeof request.command === "string" ? request.command.trim() : undefined;
    const url = typeof request.url === "string" ? request.url.trim() : undefined;
    const args = parseArgs(request.args);
    const env = parseEnv(request.env) ?? {};
    const enabled = request.enabled !== false;

    if (!name) return error(422, "validation_error", "name 不能为空");
    if (!transport) return error(422, "validation_error", "transport 不支持");
    if (transport === "stdio" && !command) return error(422, "validation_error", "command 不能为空");
    if (transport === "http" && !url) return error(422, "validation_error", "url 不能为空");

    const id = `conn_mock_${++connectorCounter}`;
    const connector: Connector = {
      id,
      name,
      transport,
      ...(transport === "stdio" ? { command, args: args ?? [] } : { url }),
      env_keys: Object.keys(env),
      enabled,
      scope_all: request.scope_all !== false,
      scopes: [],
      status: connectorStatus(enabled),
      tool_count: enabled ? 3 : 0,
      created_at: new Date(now()).toISOString()
    };
    connectors.set(id, connector);
    connectorEnvValues.set(id, env);
    return { status: 200, body: connector };
  }

  function updateConnector(connectorId: string | undefined, body: unknown): MockApiResponse {
    if (!connectorId || !connectors.has(connectorId)) return error(404, "not_found", "连接器不存在");
    const request = asRecord(body);
    if (!request) return error(422, "validation_error", "请求体必须是对象");
    const current = connectors.get(connectorId)!;
    const next: Connector = { ...current };

    if (typeof request.name === "string") next.name = request.name.trim();
    if (request.transport === "stdio" || request.transport === "http") next.transport = request.transport;
    if (typeof request.command === "string") next.command = request.command.trim();
    if (typeof request.url === "string") next.url = request.url.trim();
    const args = parseArgs(request.args);
    if (args) next.args = args;
    const env = parseEnv(request.env);
    if (env) {
      connectorEnvValues.set(connectorId, env);
      next.env_keys = Object.keys(env);
    }
    if (typeof request.enabled === "boolean") {
      next.enabled = request.enabled;
      next.status = connectorStatus(request.enabled);
      next.tool_count = request.enabled ? Math.max(next.tool_count, 1) : 0;
    }
    if (typeof request.scope_all === "boolean") {
      next.scope_all = request.scope_all;
      if (request.scope_all) next.scopes = [];
    }

    connectors.set(connectorId, next);
    return { status: 200, body: next };
  }

  function deleteConnector(connectorId: string | undefined): MockApiResponse {
    if (!connectorId || !connectors.has(connectorId)) return error(404, "not_found", "连接器不存在");
    connectors.delete(connectorId);
    connectorEnvValues.delete(connectorId);
    return { status: 200, body: { deleted: true } };
  }

  function putConnectorScope(connectorId: string | undefined, body: unknown): MockApiResponse {
    if (!connectorId || !connectors.has(connectorId)) return error(404, "not_found", "连接器不存在");
    const request = asRecord(body);
    if (!request || !Array.isArray(request.user_ids)) {
      return error(422, "validation_error", "user_ids 必须是数组");
    }
    const userIds = request.user_ids.filter((item): item is string => typeof item === "string");
    if (userIds.some((userId) => !users.some((user) => user.id === userId))) {
      return error(404, "user_not_found", "用户不存在");
    }
    const connector = connectors.get(connectorId)!;
    connectors.set(connectorId, { ...connector, scope_all: false, scopes: userIds });
    return { status: 200, body: { user_ids: userIds } };
  }

  function isSkillAuthorized(skill: AdminSkill) {
    return skill.scope_all || skill.scopes.includes("u_mock_user");
  }

  function materializeSkill(skill: AdminSkill): Skill {
    return {
      id: skill.id,
      name: skill.name,
      description: skill.description,
      enabled: skillEnabled.get(skill.id) ?? false,
      source: skill.source
    };
  }

  function allAdminSkills() {
    return Array.from(skills.values());
  }

  function userSkills() {
    return allAdminSkills().filter(isSkillAuthorized).map(materializeSkill);
  }

  function createSkill(body: unknown): MockApiResponse {
    const request = asRecord(body);
    if (!request) return error(422, "validation_error", "请求体必须是对象");
    const name = typeof request.name === "string" ? request.name.trim() : "";
    const description = typeof request.description === "string" ? request.description.trim() : "";
    const prompt = typeof request.prompt === "string" ? request.prompt.trim() : "";

    if (!name) return error(422, "validation_error", "name 不能为空");
    if (!prompt) return error(422, "validation_error", "prompt 不能为空");

    const id = `skill_mock_${++skillCounter}`;
    const skill: AdminSkill = {
      id,
      name,
      description,
      prompt,
      source_ref: null,
      source: "custom",
      scope_all: request.scope_all === true,
      scopes: [],
      created_at: new Date(now()).toISOString()
    };
    skills.set(id, skill);
    skillEnabled.set(id, true);
    return { status: 200, body: skill };
  }

  function updateSkill(skillId: string | undefined, body: unknown): MockApiResponse {
    if (!skillId || !skills.has(skillId)) return error(404, "not_found", "技能不存在");
    const request = asRecord(body);
    if (!request) return error(422, "validation_error", "请求体必须是对象");
    const current = skills.get(skillId)!;
    const next: AdminSkill = { ...current };

    if (typeof request.name === "string") next.name = request.name.trim();
    if (typeof request.description === "string") next.description = request.description.trim();
    if (typeof request.prompt === "string") next.prompt = request.prompt.trim();
    if (typeof request.scope_all === "boolean") {
      next.scope_all = request.scope_all;
      if (request.scope_all) next.scopes = [];
    }

    skills.set(skillId, next);
    return { status: 200, body: next };
  }

  function deleteSkill(skillId: string | undefined): MockApiResponse {
    if (!skillId || !skills.has(skillId)) return error(404, "not_found", "技能不存在");
    skills.delete(skillId);
    skillEnabled.delete(skillId);
    return { status: 200, body: { deleted: true } };
  }

  function putSkillScope(skillId: string | undefined, body: unknown): MockApiResponse {
    if (!skillId || !skills.has(skillId)) return error(404, "not_found", "技能不存在");
    const request = asRecord(body);
    if (!request || !Array.isArray(request.user_ids)) {
      return error(422, "validation_error", "user_ids 必须是数组");
    }
    const userIds = request.user_ids.filter((item): item is string => typeof item === "string");
    if (userIds.some((userId) => !users.some((user) => user.id === userId))) {
      return error(404, "user_not_found", "用户不存在");
    }
    const skill = skills.get(skillId)!;
    skills.set(skillId, { ...skill, scope_all: false, scopes: userIds });
    return { status: 200, body: { user_ids: userIds } };
  }

  function importSkill(body: unknown): MockApiResponse {
    const request = asRecord(body);
    if (!request) return error(422, "validation_error", "请求体必须是对象");
    const url = typeof request.url === "string" ? request.url.trim() : "";
    if (!url) return error(422, "validation_error", "url 不能为空");

    const id = `skill_mock_${++skillCounter}`;
    const fileName = decodeURIComponent(url.split("/").filter(Boolean).pop() ?? "SKILL.md");
    const name = fileName.toLowerCase() === "skill.md" ? "Imported Skill" : `Imported ${fileName}`;
    const skill: AdminSkill = {
      id,
      name,
      description: "从 GitHub raw URL 导入的 mock 技能",
      prompt: `Mock imported prompt from ${url}`,
      source_ref: url,
      source: "imported",
      scope_all: request.scope_all === true,
      scopes: [],
      created_at: new Date(now()).toISOString()
    };
    skills.set(id, skill);
    skillEnabled.set(id, true);
    return { status: 200, body: skill };
  }

  function setSkillEnabled(skillId: string | undefined, body: unknown): MockApiResponse {
    if (!skillId) return error(404, "not_found", "技能不存在");
    const skill = skills.get(skillId);
    if (!skill || !isSkillAuthorized(skill)) return error(404, "not_found", "技能不存在");
    const request = asRecord(body);
    if (!request || typeof request.enabled !== "boolean") {
      return error(422, "validation_error", "enabled 必须是布尔值");
    }
    skillEnabled.set(skillId, request.enabled);
    return { status: 200, body: materializeSkill(skill) };
  }

  function createSession(body: unknown): MockApiResponse {
    const request = asRecord(body);
    if (!request) return error(422, "validation_error", "请求体必须是对象");
    const machineId = request.machine_id;
    if (typeof machineId !== "string" || machineId.trim() === "") {
      return error(422, "validation_error", "machine_id 不能为空");
    }
    const machine = machines().find((item) => item.machine_id === machineId);
    if (!machine) return error(404, "not_found", "机器不存在");
    if (machine.status !== "online") return error(409, "machine_offline", "机器离线，无法新建会话");

    const sessionId = `s_mock_${++sessionCounter}`;
    const title = typeof request.title === "string" && request.title.trim() ? request.title.trim() : "新会话";
    sessions.set(sessionId, {
      session_id: sessionId,
      machine_id: machineId,
      status: "active",
      title,
      messages: []
    });
    return { status: 200, body: { session_id: sessionId, machine_id: machineId, status: "active" } };
  }

  function sendSessionMessage(sessionId: string, body: unknown): MockApiResponse {
    const session = sessions.get(sessionId);
    if (!session) return error(404, "not_found", "会话不存在");
    const request = asRecord(body);
    const content = typeof request?.content === "string" ? request.content.trim() : "";
    if (!content) return error(422, "validation_error", "content 不能为空");

    const current = now();
    const startSeq = session.messages.length + 1;
    const toolCallId = `call_mock_${sessionId}_${startSeq}`;
    const approvalId = "ap_mock_1";
    const messages: ChatMessage[] = [
      {
        seq: startSeq,
        role: "user",
        content,
        tool_calls: null,
        created_at: new Date(current).toISOString()
      },
      {
        seq: startSeq + 1,
        role: "assistant",
        content: "",
        tool_calls: [
          {
            id: toolCallId,
            name: "remote_exec",
            arguments: { workdir: "/workspace/app", command: "rm -rf [redacted]", timeout_seconds: 60 }
          }
        ],
        created_at: new Date(current + 1000).toISOString()
      },
      {
        seq: startSeq + 2,
        role: "tool",
        content: JSON.stringify(
          { needs_approval: true, approval_id: approvalId, risk_rule: "rm -rf 高风险命令" },
          null,
          2
        ),
        tool_calls: null,
        tool_call_id: toolCallId,
        created_at: new Date(current + 2000).toISOString()
      },
      {
        seq: startSeq + 3,
        role: "assistant",
        content: `mock 已分析请求，危险操作已提交审批 ${approvalId}。`,
        tool_calls: null,
        created_at: new Date(current + 3000).toISOString()
      }
    ];
    session.messages.push(...messages);
    return { status: 200, body: { reply: messages[3].content, steps: [], stopped: null } };
  }

  async function handle(
    method: string,
    pathSegments: string[],
    body?: unknown,
    searchParams: URLSearchParams = new URLSearchParams()
  ): Promise<MockApiResponse> {
    const normalizedMethod = method.toUpperCase();
    const [resource, taskId, nested] = pathSegments;
    seedApprovals();
    seedGrants();

    if (normalizedMethod === "GET" && resource === "machines" && pathSegments.length === 1) {
      return { status: 200, body: machines() };
    }

    if (resource === "users" && normalizedMethod === "GET" && pathSegments.length === 1) {
      return { status: 200, body: users };
    }

    if (resource === "users" && normalizedMethod === "POST" && pathSegments.length === 1) {
      return createUser(body);
    }

    if (resource === "auth" && pathSegments[1] === "logout" && normalizedMethod === "POST") {
      return { status: 200, body: { ok: true } };
    }

    if (resource === "enrollment-tokens" && normalizedMethod === "POST" && pathSegments.length === 1) {
      return createEnrollmentToken(body);
    }

    if (resource === "ws-ticket" && normalizedMethod === "POST" && pathSegments.length === 1) {
      wsTicketCounter += 1;
      return { status: 200, body: { ticket: `mock_ws_ticket_${wsTicketCounter}` } };
    }

    if (resource === "skills") {
      if (normalizedMethod === "GET" && pathSegments.length === 1) {
        return { status: 200, body: userSkills() };
      }
      if (normalizedMethod === "PUT" && pathSegments[2] === "enabled" && pathSegments.length === 3) {
        return setSkillEnabled(pathSegments[1], body);
      }
      return error(404, "not_found", "接口不存在");
    }

    if (resource === "admin") {
      const adminResource = pathSegments[1];
      const itemId = pathSegments[2];
      const action = pathSegments[3];

      if (adminResource === "models") {
        if (normalizedMethod === "GET" && pathSegments.length === 2) {
          return { status: 200, body: allModelBackends() };
        }
        if (normalizedMethod === "POST" && pathSegments.length === 2) {
          return createModelBackend(body);
        }
        if (normalizedMethod === "PATCH" && pathSegments.length === 3) {
          return updateModelBackend(itemId, body);
        }
        if (normalizedMethod === "DELETE" && pathSegments.length === 3) {
          return deleteModelBackend(itemId);
        }
      }

      if (adminResource === "model-routes") {
        if (normalizedMethod === "GET" && pathSegments.length === 2) {
          return {
            status: 200,
            body: Array.from(modelRoutes.entries()).map(([user_id, backend_id]) => ({ user_id, backend_id }))
          };
        }
        if (normalizedMethod === "PUT" && pathSegments.length === 2) {
          return putModelRoute(body);
        }
      }

      if (adminResource === "model-providers" && normalizedMethod === "GET" && pathSegments.length === 2) {
        return { status: 200, body: modelProviders };
      }

      if (adminResource === "connector-presets" && normalizedMethod === "GET" && pathSegments.length === 2) {
        return { status: 200, body: connectorPresets };
      }

      if (adminResource === "connectors") {
        if (normalizedMethod === "GET" && pathSegments.length === 2) {
          return { status: 200, body: Array.from(connectors.values()) };
        }
        if (normalizedMethod === "POST" && pathSegments.length === 2) {
          return createConnector(body);
        }
        if (normalizedMethod === "PATCH" && pathSegments.length === 3) {
          return updateConnector(itemId, body);
        }
        if (normalizedMethod === "DELETE" && pathSegments.length === 3) {
          return deleteConnector(itemId);
        }
        if (normalizedMethod === "PUT" && action === "scope" && pathSegments.length === 4) {
          return putConnectorScope(itemId, body);
        }
      }

      if (adminResource === "skills") {
        if (normalizedMethod === "POST" && itemId === "import" && pathSegments.length === 3) {
          return importSkill(body);
        }
        if (normalizedMethod === "GET" && pathSegments.length === 2) {
          return { status: 200, body: allAdminSkills() };
        }
        if (normalizedMethod === "POST" && pathSegments.length === 2) {
          return createSkill(body);
        }
        if (normalizedMethod === "PATCH" && pathSegments.length === 3) {
          return updateSkill(itemId, body);
        }
        if (normalizedMethod === "DELETE" && pathSegments.length === 3) {
          return deleteSkill(itemId);
        }
        if (normalizedMethod === "PUT" && action === "scope" && pathSegments.length === 4) {
          return putSkillScope(itemId, body);
        }
      }

      return error(404, "not_found", "接口不存在");
    }

    if (resource === "sessions") {
      const sessionId = pathSegments[1];
      const messagesResource = pathSegments[2];
      if (normalizedMethod === "POST" && pathSegments.length === 1) {
        return createSession(body);
      }
      if (sessionId && messagesResource === "messages" && pathSegments.length === 3) {
        if (normalizedMethod === "POST") {
          return sendSessionMessage(sessionId, body);
        }
        if (normalizedMethod === "GET") {
          const session = sessions.get(sessionId);
          if (!session) return error(404, "not_found", "会话不存在");
          return { status: 200, body: session.messages };
        }
      }
      return error(404, "not_found", "接口不存在");
    }

    if (resource === "approvals") {
      const approvalId = pathSegments[1];
      const action = pathSegments[2];
      if (normalizedMethod === "GET" && pathSegments.length === 1) {
        const status = searchParams.get("status");
        return {
          status: 200,
          body: Array.from(approvals.values()).filter((approval) => !status || approval.status === status)
        };
      }
      const approval = approvalId ? approvals.get(approvalId) : undefined;
      if (!approval) return error(404, "not_found", "审批不存在");
      if (normalizedMethod === "POST" && action === "approve" && pathSegments.length === 3) {
        approval.status = "approved";
        return {
          status: 200,
          body: {
            approval_id: approval.approval_id,
            status: "approved",
            task_id: `t_from_${approval.approval_id}`,
            task_status: "queued"
          }
        };
      }
      if (normalizedMethod === "POST" && action === "reject" && pathSegments.length === 3) {
        approval.status = "rejected";
        return { status: 200, body: { approval_id: approval.approval_id, status: "rejected" } };
      }
      return error(404, "not_found", "接口不存在");
    }

    if (resource === "machines" && pathSegments[2] === "grants") {
      const machineId = pathSegments[1];
      if (!machineId) return error(404, "not_found", "机器不存在");
      const machine = machines().find((item) => item.machine_id === machineId);
      if (!machine) return error(404, "not_found", "机器不存在");
      const currentGrants = grants.get(machineId) ?? [];
      if (normalizedMethod === "GET" && pathSegments.length === 3) {
        return { status: 200, body: currentGrants };
      }
      if (normalizedMethod === "POST" && pathSegments.length === 3) {
        const request = asRecord(body);
        const grantee = typeof request?.grantee_user_id === "string" ? request.grantee_user_id.trim() : "";
        const hours = typeof request?.expires_in_hours === "number" ? request.expires_in_hours : 0;
        if (!grantee) return error(422, "validation_error", "grantee_user_id 不能为空");
        if (!Number.isFinite(hours) || hours <= 0) {
          return error(422, "validation_error", "expires_in_hours 必须大于 0");
        }
        const current = now();
        const grant: MachineGrant = {
          grant_id: `g_mock_${++grantCounter}`,
          grantee_user_id: grantee,
          granted_by_user_id: "u_mock_admin",
          expires_at: new Date(current + hours * 60 * 60 * 1000).toISOString(),
          created_at: new Date(current).toISOString()
        };
        currentGrants.push(grant);
        grants.set(machineId, currentGrants);
        return { status: 200, body: grant };
      }
    }

    if (resource === "machines" && pathSegments[2] === "assign" && normalizedMethod === "POST" && pathSegments.length === 3) {
      return assignMachine(pathSegments[1], body);
    }

    if (resource === "grants" && normalizedMethod === "DELETE" && pathSegments.length === 2) {
      const grantId = pathSegments[1];
      let revoked = false;
      for (const [machineId, currentGrants] of grants.entries()) {
        const filtered = currentGrants.filter((grant) => grant.grant_id !== grantId);
        if (filtered.length !== currentGrants.length) {
          revoked = true;
          grants.set(machineId, filtered);
        }
      }
      if (!revoked) return error(404, "not_found", "授权不存在");
      return { status: 200, body: { revoked: true } };
    }

    if (normalizedMethod === "GET" && resource === "audit" && pathSegments.length === 2) {
      const auditResource = pathSegments[1];
      const current = now();

      if (auditResource === "usage") {
        const userId = searchParams.get("user_id");
        const usage = auditUsageFixture();
        return {
          status: 200,
          body: userId
            ? {
                total_tokens: usage.by_user_backend
                  .filter((row) => row.user_id === userId)
                  .reduce((sum, row) => sum + row.total_tokens, 0),
                by_user_backend: usage.by_user_backend.filter((row) => row.user_id === userId)
              }
            : usage
        };
      }

      if (auditResource === "sessions") {
        const userId = searchParams.get("user_id");
        const limit = Number(searchParams.get("limit") ?? "50");
        const sessions = auditSessionsFixture(current)
          .filter((session) => !userId || session.user_id === userId)
          .slice(0, Number.isFinite(limit) && limit > 0 ? limit : 50);
        return { status: 200, body: sessions };
      }

      if (auditResource === "tool-calls") {
        const sessionId = searchParams.get("session_id");
        const machineId = searchParams.get("machine_id");
        const limit = Number(searchParams.get("limit") ?? "50");
        const toolCalls = auditToolCallsFixture(current)
          .filter((call) => !sessionId || call.session_id === sessionId)
          .filter((call) => !machineId || call.machine_id === machineId)
          .slice(0, Number.isFinite(limit) && limit > 0 ? limit : 50);
        return { status: 200, body: toolCalls };
      }

      if (auditResource === "commands") {
        const machineId = searchParams.get("machine_id");
        const limit = Number(searchParams.get("limit") ?? "50");
        const commands = auditCommandsFixture(current)
          .filter((command) => !machineId || command.machine_id === machineId)
          .slice(0, Number.isFinite(limit) && limit > 0 ? limit : 50);
        return { status: 200, body: commands };
      }
    }

    if (resource !== "tasks") {
      return error(404, "not_found", "接口不存在");
    }

    if (normalizedMethod === "POST" && pathSegments.length === 1) {
      return createTask(body);
    }

    if (normalizedMethod === "GET" && pathSegments.length === 1) {
      const machineId = searchParams.get("machine_id");
      const limit = Number(searchParams.get("limit") ?? "50");
      const records = Array.from(tasks.values())
        .map(materializeTask)
        .filter((task) => !machineId || task.machine_id === machineId)
        .sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at))
        .slice(0, Number.isFinite(limit) && limit > 0 ? limit : 50);

      return { status: 200, body: records };
    }

    if (!taskId) {
      return error(404, "not_found", "任务不存在");
    }

    const entry = findTask(taskId);
    if (!entry) {
      return error(404, "not_found", "任务不存在");
    }

    if (normalizedMethod === "GET" && pathSegments.length === 2) {
      return { status: 200, body: materializeTask(entry) };
    }

    if (normalizedMethod === "GET" && nested === "output" && pathSegments.length === 3) {
      return { status: 200, body: entry.output };
    }

    if (normalizedMethod === "POST" && nested === "cancel" && pathSegments.length === 3) {
      return cancelTask(taskId);
    }

    return error(404, "not_found", "接口不存在");
  }

  return { handle };
}
