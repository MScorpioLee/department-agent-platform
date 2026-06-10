import type {
  Approval,
  ChatMessage,
  CreateTaskRequest,
  Machine,
  MachineGrant,
  TaskOutput,
  TaskRecord,
  TaskStatus,
  ToolName
} from "@/lib/types";

const ALL_CAPABILITIES: ToolName[] = [
  "remote_exec",
  "remote_read_file",
  "remote_write_file",
  "remote_patch_file",
  "remote_list_files"
];

const COMPLETION_DELAY_MS = 3000;

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
  let taskCounter = 0;
  let sessionCounter = 0;
  let grantCounter = 0;

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
        owner_user_id: "u_mock_admin",
        os: "darwin",
        status: "online",
        last_seen_at: new Date(current - 7000).toISOString(),
        capabilities: ALL_CAPABILITIES
      },
      {
        machine_id: "m_mock_offline",
        machine_name: "build-box-01",
        owner_user_id: "u_mock_admin",
        os: "linux",
        status: "offline",
        last_seen_at: new Date(current - 45 * 60 * 1000).toISOString(),
        capabilities: ["remote_exec", "remote_read_file", "remote_list_files"]
      }
    ];
  }

  function materializeTask(entry: InternalTask): TaskRecord {
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
      return {
        status: 200,
        body: [
          { id: "u_mock_admin", username: "admin", display_name: "管理员", role: "admin" },
          { id: "u_mock_user", username: "alice", display_name: "Alice", role: "user" }
        ]
      };
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

    return error(404, "not_found", "接口不存在");
  }

  return { handle };
}
