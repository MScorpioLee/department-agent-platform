import type {
  ApiErrorBody,
  CreateTaskRequest,
  CreateTaskResponse,
  Machine,
  TaskOutput,
  TaskRecord
} from "@/lib/types";

const PROXY_PREFIX = "/api/proxy";

export class ApiClientError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.code = code;
  }
}

async function readResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  return (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof (value as ApiErrorBody).error?.code === "string" &&
    typeof (value as ApiErrorBody).error?.message === "string"
  );
}

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");

  if (init.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${PROXY_PREFIX}${path}`, {
    ...init,
    headers: Object.fromEntries(headers.entries())
  });
  const body = await readResponseBody(response);

  if (!response.ok) {
    if (isApiErrorBody(body)) {
      throw new ApiClientError(response.status, body.error.code, body.error.message);
    }

    throw new ApiClientError(response.status, "http_error", `请求失败(${response.status})`);
  }

  return body as T;
}

export function listMachines(): Promise<Machine[]> {
  return apiFetch<Machine[]>("/machines");
}

export function createTask(request: CreateTaskRequest): Promise<CreateTaskResponse> {
  return apiFetch<CreateTaskResponse>("/tasks", {
    method: "POST",
    body: JSON.stringify(request)
  });
}

export function getTask(taskId: string): Promise<TaskRecord> {
  return apiFetch<TaskRecord>(`/tasks/${encodeURIComponent(taskId)}`);
}

export function getTaskOutput(taskId: string): Promise<TaskOutput> {
  return apiFetch<TaskOutput>(`/tasks/${encodeURIComponent(taskId)}/output`);
}

export function listTasks(machineId: string, limit = 50): Promise<TaskRecord[]> {
  const query = new URLSearchParams({ machine_id: machineId, limit: String(limit) });
  return apiFetch<TaskRecord[]>(`/tasks?${query.toString()}`);
}
