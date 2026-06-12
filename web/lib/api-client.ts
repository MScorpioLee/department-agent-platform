import type {
  ApiErrorBody,
  AdminSkill,
  AuditCommand,
  AuditSession,
  AuditToolCall,
  AuditUsage,
  Approval,
  ApproveApprovalResponse,
  ChatMessage,
  AssignMachineOwnerResponse,
  CancelTaskResponse,
  Connector,
  ConnectorPreset,
  ConnectorRegistryEntry,
  CreateEnrollmentTokenRequest,
  CreateConnectorRequest,
  CreateSkillRequest,
  CreateModelBackendRequest,
  CreatePersonalApiKeyRequest,
  CreatePersonalApiKeyResponse,
  CreateUserRequest,
  DiscoverModelProviderRequest,
  DiscoverModelProviderResponse,
  EnrollmentTokenResponse,
  CreateGrantRequest,
  ImportSkillRequest,
  CreateSessionRequest,
  CreateSessionResponse,
  CreateTaskRequest,
  CreateTaskResponse,
  Machine,
  MachineGrant,
  MyModelLogin,
  ModelBackend,
  OAuthAuthorizeUrlResponse,
  OAuthCallbackRequest,
  OAuthCallbackResponse,
  OAuthDeviceStartResponse,
  OAuthPollResponse,
  OAuthRefreshResponse,
  PersonalApiKey,
  ModelProvider,
  ModelRoute,
  RejectApprovalResponse,
  SendMessageResponse,
  Skill,
  TaskOutput,
  TaskRecord,
  UpdateConnectorRequest,
  UpdateSkillRequest,
  UpdateModelBackendRequest,
  User,
  WsTicketResponse
} from "@/lib/types";
import { isDesktopClient } from "@/lib/client-target";
import {
  desktopApiFetch,
  desktopGetMe,
  desktopLogin,
  desktopLogout,
  type DesktopLoginOptions
} from "@/lib/desktop-bridge";

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

function isDesktopCommandError(
  value: unknown
): value is { status?: number; code?: string; message?: string } {
  return typeof value === "object" && value !== null && "message" in value;
}

async function desktopCommand<T>(request: Promise<T>): Promise<T> {
  try {
    return await request;
  } catch (error) {
    if (isDesktopCommandError(error)) {
      throw new ApiClientError(
        typeof error.status === "number" ? error.status : 0,
        typeof error.code === "string" ? error.code : "desktop_error",
        typeof error.message === "string" ? error.message : "桌面客户端请求失败"
      );
    }
    if (error instanceof Error) {
      throw new ApiClientError(0, "desktop_error", error.message);
    }
    throw new ApiClientError(0, "desktop_error", String(error));
  }
}

async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
  prefix = PROXY_PREFIX
): Promise<T> {
  if (isDesktopClient()) {
    const response = await desktopCommand(desktopApiFetch(path, init, prefix));
    if (response.status < 200 || response.status >= 300) {
      if (isApiErrorBody(response.body)) {
        throw new ApiClientError(response.status, response.body.error.code, response.body.error.message);
      }
      throw new ApiClientError(response.status, "http_error", `请求失败(${response.status})`);
    }
    return response.body as T;
  }

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

export function cancelTask(taskId: string): Promise<CancelTaskResponse> {
  return apiFetch<CancelTaskResponse>(`/tasks/${encodeURIComponent(taskId)}/cancel`, {
    method: "POST"
  });
}

export function listTasks(machineId: string, limit = 50): Promise<TaskRecord[]> {
  const query = new URLSearchParams({ machine_id: machineId, limit: String(limit) });
  return apiFetch<TaskRecord[]>(`/tasks?${query.toString()}`);
}

export async function login(
  username: string,
  password: string,
  options: DesktopLoginOptions = {}
): Promise<User> {
  if (isDesktopClient()) {
    return desktopCommand(desktopLogin(username, password, options));
  }

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
  if (isDesktopClient()) {
    return desktopCommand(desktopGetMe());
  }

  return apiFetch<User>("/me", {}, "/api/auth");
}

export async function logout(): Promise<void> {
  if (isDesktopClient()) {
    await desktopCommand(desktopLogout());
    return;
  }

  try {
    await apiFetch<{ ok: true }>("/auth/logout", { method: "POST" });
  } catch {
    // Local cookie clearing must still happen when the upstream server is already offline.
  }
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

export function createWsTicket(): Promise<WsTicketResponse> {
  return apiFetch<WsTicketResponse>("/ws-ticket", { method: "POST" });
}

export function listSkills(): Promise<Skill[]> {
  return apiFetch<Skill[]>("/skills");
}

export function setSkillEnabled(skillId: string, enabled: boolean): Promise<Skill> {
  return apiFetch<Skill>(`/skills/${encodeURIComponent(skillId)}/enabled`, {
    method: "PUT",
    body: JSON.stringify({ enabled })
  });
}

export function listAdminSkills(): Promise<AdminSkill[]> {
  return apiFetch<AdminSkill[]>("/admin/skills");
}

export function createSkill(request: CreateSkillRequest): Promise<AdminSkill> {
  return apiFetch<AdminSkill>("/admin/skills", {
    method: "POST",
    body: JSON.stringify(request)
  });
}

export function updateSkill(skillId: string, request: UpdateSkillRequest): Promise<AdminSkill> {
  return apiFetch<AdminSkill>(`/admin/skills/${encodeURIComponent(skillId)}`, {
    method: "PATCH",
    body: JSON.stringify(request)
  });
}

export function deleteSkill(skillId: string): Promise<{ deleted: boolean }> {
  return apiFetch<{ deleted: boolean }>(`/admin/skills/${encodeURIComponent(skillId)}`, {
    method: "DELETE"
  });
}

export function putSkillScope(skillId: string, userIds: string[]): Promise<{ user_ids: string[] }> {
  return apiFetch<{ user_ids: string[] }>(`/admin/skills/${encodeURIComponent(skillId)}/scope`, {
    method: "PUT",
    body: JSON.stringify({ user_ids: userIds })
  });
}

export function importSkill(request: ImportSkillRequest): Promise<AdminSkill> {
  return apiFetch<AdminSkill>("/admin/skills/import", {
    method: "POST",
    body: JSON.stringify(request)
  });
}

export function listModelBackends(): Promise<ModelBackend[]> {
  return apiFetch<ModelBackend[]>("/admin/models");
}

export function listModelProviders(): Promise<ModelProvider[]> {
  return apiFetch<ModelProvider[]>("/admin/model-providers");
}

export function discoverModelProvider(
  request: DiscoverModelProviderRequest
): Promise<DiscoverModelProviderResponse> {
  return apiFetch<DiscoverModelProviderResponse>("/admin/model-providers/discover", {
    method: "POST",
    body: JSON.stringify(request)
  });
}

export function createModelBackend(request: CreateModelBackendRequest): Promise<ModelBackend> {
  return apiFetch<ModelBackend>("/admin/models", {
    method: "POST",
    body: JSON.stringify(request)
  });
}

export function updateModelBackend(
  backendId: string,
  request: UpdateModelBackendRequest
): Promise<ModelBackend> {
  return apiFetch<ModelBackend>(`/admin/models/${encodeURIComponent(backendId)}`, {
    method: "PATCH",
    body: JSON.stringify(request)
  });
}

export function deleteModelBackend(backendId: string): Promise<{ deleted: boolean }> {
  return apiFetch<{ deleted: boolean }>(`/admin/models/${encodeURIComponent(backendId)}`, {
    method: "DELETE"
  });
}

export function listModelRoutes(): Promise<ModelRoute[]> {
  return apiFetch<ModelRoute[]>("/admin/model-routes");
}

export function putModelRoute(userId: string, backendId: string | null): Promise<ModelRoute> {
  return apiFetch<ModelRoute>("/admin/model-routes", {
    method: "PUT",
    body: JSON.stringify({ user_id: userId, backend_id: backendId })
  });
}

export function startModelOAuthDevice(backendId: string): Promise<OAuthDeviceStartResponse> {
  return apiFetch<OAuthDeviceStartResponse>(
    `/admin/models/${encodeURIComponent(backendId)}/oauth/device/start`,
    { method: "POST" }
  );
}

export function pollModelOAuthDevice(backendId: string): Promise<OAuthPollResponse> {
  return apiFetch<OAuthPollResponse>(
    `/admin/models/${encodeURIComponent(backendId)}/oauth/device/poll`,
    { method: "POST" }
  );
}

export function getModelOAuthAuthorizeUrl(backendId: string): Promise<OAuthAuthorizeUrlResponse> {
  return apiFetch<OAuthAuthorizeUrlResponse>(
    `/admin/models/${encodeURIComponent(backendId)}/oauth/authorize-url`
  );
}

export function submitModelOAuthCallback(
  backendId: string,
  request: OAuthCallbackRequest
): Promise<OAuthCallbackResponse> {
  return apiFetch<OAuthCallbackResponse>(
    `/admin/models/${encodeURIComponent(backendId)}/oauth/callback`,
    {
      method: "POST",
      body: JSON.stringify(request)
    }
  );
}

export function refreshModelOAuth(backendId: string): Promise<OAuthRefreshResponse> {
  return apiFetch<OAuthRefreshResponse>(
    `/admin/models/${encodeURIComponent(backendId)}/oauth/refresh`,
    { method: "POST" }
  );
}

export function listPersonalApiKeys(): Promise<PersonalApiKey[]> {
  return apiFetch<PersonalApiKey[]>("/me/api-keys");
}

export function createPersonalApiKey(
  request: CreatePersonalApiKeyRequest
): Promise<CreatePersonalApiKeyResponse> {
  return apiFetch<CreatePersonalApiKeyResponse>("/me/api-keys", {
    method: "POST",
    body: JSON.stringify(request)
  });
}

export function deletePersonalApiKey(keyId: string): Promise<{ deleted: boolean }> {
  return apiFetch<{ deleted: boolean }>(`/me/api-keys/${encodeURIComponent(keyId)}`, {
    method: "DELETE"
  });
}

export function listMyModelLogins(): Promise<MyModelLogin[]> {
  return apiFetch<MyModelLogin[]>("/me/model-logins");
}

export function startMyModelLoginDevice(backendId: string): Promise<OAuthDeviceStartResponse> {
  return apiFetch<OAuthDeviceStartResponse>(
    `/me/model-logins/${encodeURIComponent(backendId)}/device/start`,
    { method: "POST" }
  );
}

export function pollMyModelLoginDevice(backendId: string): Promise<OAuthPollResponse> {
  return apiFetch<OAuthPollResponse>(
    `/me/model-logins/${encodeURIComponent(backendId)}/device/poll`,
    { method: "POST" }
  );
}

export function deleteMyModelLogin(backendId: string): Promise<{ logged_out: boolean }> {
  return apiFetch<{ logged_out: boolean }>(`/me/model-logins/${encodeURIComponent(backendId)}`, {
    method: "DELETE"
  });
}

export function listConnectors(): Promise<Connector[]> {
  return apiFetch<Connector[]>("/admin/connectors");
}

export function listConnectorPresets(): Promise<ConnectorPreset[]> {
  return apiFetch<ConnectorPreset[]>("/admin/connector-presets");
}

export function listConnectorRegistry(query: string, limit = 20): Promise<ConnectorRegistryEntry[]> {
  const params = new URLSearchParams({ q: query, limit: String(limit) });
  return apiFetch<ConnectorRegistryEntry[]>(`/admin/connector-registry?${params.toString()}`);
}

export function createConnector(request: CreateConnectorRequest): Promise<Connector> {
  return apiFetch<Connector>("/admin/connectors", {
    method: "POST",
    body: JSON.stringify(request)
  });
}

export function updateConnector(connectorId: string, request: UpdateConnectorRequest): Promise<Connector> {
  return apiFetch<Connector>(`/admin/connectors/${encodeURIComponent(connectorId)}`, {
    method: "PATCH",
    body: JSON.stringify(request)
  });
}

export function deleteConnector(connectorId: string): Promise<{ deleted: boolean }> {
  return apiFetch<{ deleted: boolean }>(`/admin/connectors/${encodeURIComponent(connectorId)}`, {
    method: "DELETE"
  });
}

export function putConnectorScope(connectorId: string, userIds: string[]): Promise<{ user_ids: string[] }> {
  return apiFetch<{ user_ids: string[] }>(`/admin/connectors/${encodeURIComponent(connectorId)}/scope`, {
    method: "PUT",
    body: JSON.stringify({ user_ids: userIds })
  });
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

export function createUser(request: CreateUserRequest): Promise<User> {
  return apiFetch<User>("/users", {
    method: "POST",
    body: JSON.stringify(request)
  });
}

export function createEnrollmentToken(
  request: CreateEnrollmentTokenRequest
): Promise<EnrollmentTokenResponse> {
  return apiFetch<EnrollmentTokenResponse>("/enrollment-tokens", {
    method: "POST",
    body: JSON.stringify(request)
  });
}

export function assignMachineOwner(
  machineId: string,
  userId: string | null
): Promise<AssignMachineOwnerResponse> {
  return apiFetch<AssignMachineOwnerResponse>(`/machines/${encodeURIComponent(machineId)}/assign`, {
    method: "POST",
    body: JSON.stringify({ user_id: userId })
  });
}
