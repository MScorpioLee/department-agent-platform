import type {
  CreateTaskRequest,
  Machine,
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
  let taskCounter = 0;

  function machines(): Machine[] {
    const current = now();
    return [
      {
        machine_id: "m_mock_online",
        machine_name: "alice-laptop",
        os: "darwin",
        status: "online",
        last_seen_at: new Date(current - 7000).toISOString(),
        capabilities: ALL_CAPABILITIES
      },
      {
        machine_id: "m_mock_offline",
        machine_name: "build-box-01",
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

  async function handle(
    method: string,
    pathSegments: string[],
    body?: unknown,
    searchParams: URLSearchParams = new URLSearchParams()
  ): Promise<MockApiResponse> {
    const normalizedMethod = method.toUpperCase();
    const [resource, taskId, nested] = pathSegments;

    if (normalizedMethod === "GET" && resource === "machines" && pathSegments.length === 1) {
      return { status: 200, body: machines() };
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
