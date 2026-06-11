export type MachineStatus = "online" | "offline";

export type ToolName =
  | "remote_exec"
  | "remote_read_file"
  | "remote_write_file"
  | "remote_patch_file"
  | "remote_list_files";

export type TaskStatus =
  | "queued"
  | "dispatched"
  | "running"
  | "completed"
  | "failed"
  | "timeout"
  | "cancelled"
  | "lost";

export interface Machine {
  machine_id: string;
  machine_name: string;
  owner_user_id?: string;
  os: string;
  status: MachineStatus;
  last_seen_at: string;
  capabilities: ToolName[];
}

export interface User {
  id: string;
  username: string;
  display_name: string;
  role: string;
}

export interface WsTicketResponse {
  ticket: string;
}

export interface ModelBackend {
  id: string;
  name: string;
  base_url: string;
  model: string;
  api_key: string;
  max_concurrency: number;
  enabled: boolean;
  is_default: boolean;
  created_at: string;
}

export interface CreateModelBackendRequest {
  name: string;
  base_url: string;
  model: string;
  api_key: string;
  max_concurrency: number;
  is_default: boolean;
}

export interface UpdateModelBackendRequest {
  name?: string;
  base_url?: string;
  model?: string;
  api_key?: string;
  max_concurrency?: number;
  enabled?: boolean;
  is_default?: boolean;
}

export interface ModelRoute {
  user_id: string;
  backend_id: string | null;
}

export type ConnectorTransport = "stdio" | "http";

export interface Connector {
  id: string;
  name: string;
  transport: ConnectorTransport;
  command?: string;
  args?: string[];
  url?: string;
  env_keys: string[];
  enabled: boolean;
  scope_all: boolean;
  scopes: string[];
  status: string;
  tool_count: number;
  created_at: string;
}

export interface CreateConnectorRequest {
  name: string;
  transport: ConnectorTransport;
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  enabled?: boolean;
  scope_all?: boolean;
}

export interface UpdateConnectorRequest {
  name?: string;
  transport?: ConnectorTransport;
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  enabled?: boolean;
  scope_all?: boolean;
}

export interface CreateUserRequest {
  username: string;
  password: string;
  display_name?: string;
  role: "user" | "admin";
}

export interface CreateEnrollmentTokenRequest {
  owner_user_id?: string;
  max_uses: number;
  expires_in_days: number;
}

export interface EnrollmentTokenResponse {
  enrollment_token: string;
  owner_user_id: string | null;
  max_uses: number;
}

export interface AssignMachineOwnerResponse {
  machine_id: string;
  owner_user_id: string | null;
}

export interface CreateTaskRequest {
  machine_id: string;
  tool: ToolName;
  payload: Record<string, unknown>;
}

export interface CreateTaskResponse {
  task_id: string;
  status: Extract<TaskStatus, "queued">;
}

export interface CancelTaskResponse {
  task_id: string;
  status: Extract<TaskStatus, "cancelled">;
}

export interface TaskRecord {
  task_id: string;
  machine_id: string;
  tool: ToolName;
  payload: Record<string, unknown>;
  status: TaskStatus;
  result: Record<string, unknown> | null;
  created_at: string;
  finished_at: string | null;
}

export interface TaskOutput {
  stdout: string;
  stderr: string;
  truncated: boolean;
}

export interface AuditUsageRow {
  user_id: string;
  backend_id: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  turns: number;
}

export interface AuditUsage {
  total_tokens: number;
  by_user_backend: AuditUsageRow[];
}

export interface AuditSession {
  session_id: string;
  user_id: string;
  machine_id: string;
  title: string;
  status: string;
  message_count: number;
  created_at: string;
}

export interface AuditToolCall {
  id: string;
  session_id: string;
  machine_id: string;
  tool_name: string;
  arguments: Record<string, unknown>;
  result: Record<string, unknown>;
  status: string;
  created_at: string;
}

export interface AuditCommand {
  task_id: string;
  machine_id: string;
  command: string;
  status: string;
  exit_code: number | null;
  stdout: string;
  stderr: string;
  created_at: string;
}

export interface CreateSessionRequest {
  machine_id: string;
  title?: string;
}

export interface CreateSessionResponse {
  session_id: string;
  machine_id: string;
  status: string;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ChatMessage {
  seq: number;
  role: "user" | "assistant" | "tool";
  content: string;
  tool_calls: ToolCall[] | null;
  tool_call_id?: string;
  created_at: string;
}

export interface SendMessageResponse {
  reply: string;
  steps: unknown[];
  stopped: string | null;
}

export interface Approval {
  approval_id: string;
  machine_id: string;
  requested_by_user_id: string;
  tool: ToolName;
  payload: Record<string, unknown>;
  risk_rule: string;
  status: string;
  created_at: string;
}

export interface ApproveApprovalResponse {
  approval_id: string;
  status: "approved";
  task_id: string;
  task_status: string;
}

export interface RejectApprovalResponse {
  approval_id: string;
  status: "rejected";
}

export interface MachineGrant {
  grant_id: string;
  grantee_user_id: string;
  granted_by_user_id: string;
  expires_at: string;
  created_at: string;
}

export interface CreateGrantRequest {
  grantee_user_id: string;
  expires_in_hours: number;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
  };
}
