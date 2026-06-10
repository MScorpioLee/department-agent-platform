import type {
  ApiErrorBody,
  AuditCommand,
  AuditSession,
  AuditToolCall,
  AuditUsage,
  Approval,
  ApproveApprovalResponse,
  ChatMessage,
  CreateGrantRequest,
  CreateSessionRequest,
  CreateSessionResponse,
  CreateTaskRequest,
  CreateTaskResponse,
  Machine,
  MachineGrant,
  RejectApprovalResponse,
  SendMessageResponse,
  TaskOutput,
  TaskRecord,
  User
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

async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
  prefix = PROXY_PREFIX
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");

  if (init.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${prefix}${path}`, {
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

export async function login(username: string, password: string): Promise<User> {
  const response = await apiFetch<{ user: User }>(
    "/login",
    {
      method: "POST",
      body: JSON.stringify({ username, password })
    },
    "/api/auth"
  );
  return response.user;
}

export function getMe(): Promise<User> {
  return apiFetch<User>("/me", {}, "/api/auth");
}

export async function logout(): Promise<void> {
  await apiFetch<{ ok: true }>("/logout", { method: "POST" }, "/api/auth");
}

function appendOptionalParam(query: URLSearchParams, key: string, value: string | number | undefined) {
  if (value === undefined || value === "") return;
  query.set(key, String(value));
}

function queryString(query: URLSearchParams) {
  const value = query.toString();
  return value ? `?${value}` : "";
}

export function getAuditUsage(userId?: string): Promise<AuditUsage> {
  const query = new URLSearchParams();
  appendOptionalParam(query, "user_id", userId);
  return apiFetch<AuditUsage>(`/audit/usage${queryString(query)}`);
}

export function getAuditSessions(options: { userId?: string; limit?: number } = {}): Promise<AuditSession[]> {
  const query = new URLSearchParams();
  appendOptionalParam(query, "user_id", options.userId);
  appendOptionalParam(query, "limit", options.limit);
  return apiFetch<AuditSession[]>(`/audit/sessions${queryString(query)}`);
}

export function getAuditToolCalls(
  options: { sessionId?: string; machineId?: string; limit?: number } = {}
): Promise<AuditToolCall[]> {
  const query = new URLSearchParams();
  appendOptionalParam(query, "session_id", options.sessionId);
  appendOptionalParam(query, "machine_id", options.machineId);
  appendOptionalParam(query, "limit", options.limit);
  return apiFetch<AuditToolCall[]>(`/audit/tool-calls${queryString(query)}`);
}

export function getAuditCommands(
  options: { machineId?: string; limit?: number } = {}
): Promise<AuditCommand[]> {
  const query = new URLSearchParams();
  appendOptionalParam(query, "machine_id", options.machineId);
  appendOptionalParam(query, "limit", options.limit);
  return apiFetch<AuditCommand[]>(`/audit/commands${queryString(query)}`);
}

export function createSession(request: CreateSessionRequest): Promise<CreateSessionResponse> {
  return apiFetch<CreateSessionResponse>("/sessions", {
    method: "POST",
    body: JSON.stringify(request)
  });
}

export function sendSessionMessage(sessionId: string, content: string): Promise<SendMessageResponse> {
  return apiFetch<SendMessageResponse>(`/sessions/${encodeURIComponent(sessionId)}/messages`, {
    method: "POST",
    body: JSON.stringify({ content })
  });
}

export function getSessionMessages(sessionId: string): Promise<ChatMessage[]> {
  return apiFetch<ChatMessage[]>(`/sessions/${encodeURIComponent(sessionId)}/messages`);
}

export function listApprovals(status = "pending"): Promise<Approval[]> {
  const query = new URLSearchParams({ status });
  return apiFetch<Approval[]>(`/approvals?${query.toString()}`);
}

export function approveApproval(approvalId: string): Promise<ApproveApprovalResponse> {
  return apiFetch<ApproveApprovalResponse>(`/approvals/${encodeURIComponent(approvalId)}/approve`, {
    method: "POST"
  });
}

export function rejectApproval(approvalId: string): Promise<RejectApprovalResponse> {
  return apiFetch<RejectApprovalResponse>(`/approvals/${encodeURIComponent(approvalId)}/reject`, {
    method: "POST"
  });
}

export function listMachineGrants(machineId: string): Promise<MachineGrant[]> {
  return apiFetch<MachineGrant[]>(`/machines/${encodeURIComponent(machineId)}/grants`);
}

export function createMachineGrant(
  machineId: string,
  request: CreateGrantRequest
): Promise<MachineGrant> {
  return apiFetch<MachineGrant>(`/machines/${encodeURIComponent(machineId)}/grants`, {
    method: "POST",
    body: JSON.stringify(request)
  });
}

export function revokeGrant(grantId: string): Promise<{ revoked: boolean }> {
  return apiFetch<{ revoked: boolean }>(`/grants/${encodeURIComponent(grantId)}`, {
    method: "DELETE"
  });
}

export function listUsers(): Promise<User[]> {
  return apiFetch<User[]>("/users");
}
