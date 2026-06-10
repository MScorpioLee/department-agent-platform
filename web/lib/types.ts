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
  os: string;
  status: MachineStatus;
  last_seen_at: string;
  capabilities: ToolName[];
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

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
  };
}
