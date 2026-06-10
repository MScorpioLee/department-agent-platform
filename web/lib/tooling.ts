import type { TaskStatus, ToolName } from "@/lib/types";

export interface ToolField {
  name: string;
  label: string;
  kind: "text" | "number" | "textarea" | "checkbox";
  required?: boolean;
  placeholder?: string;
  defaultValue?: string | boolean;
}

export interface ToolDefinition {
  value: ToolName;
  label: string;
  fields: ToolField[];
}

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    value: "remote_exec",
    label: "执行命令",
    fields: [
      { name: "workdir", label: "工作目录", kind: "text", required: true, placeholder: "/tmp" },
      { name: "command", label: "命令", kind: "textarea", required: true, placeholder: "pwd" },
      {
        name: "timeout_seconds",
        label: "超时秒数",
        kind: "number",
        required: true,
        defaultValue: "60"
      }
    ]
  },
  {
    value: "remote_read_file",
    label: "读取文件",
    fields: [
      { name: "path", label: "文件路径", kind: "text", required: true, placeholder: "/tmp/app.log" },
      { name: "offset", label: "起始行", kind: "number", placeholder: "1" },
      { name: "limit", label: "行数", kind: "number", placeholder: "200" }
    ]
  },
  {
    value: "remote_write_file",
    label: "写入文件",
    fields: [
      { name: "path", label: "文件路径", kind: "text", required: true, placeholder: "/tmp/note.txt" },
      { name: "content", label: "内容", kind: "textarea", required: true }
    ]
  },
  {
    value: "remote_patch_file",
    label: "替换文本",
    fields: [
      { name: "path", label: "文件路径", kind: "text", required: true, placeholder: "/tmp/config.yaml" },
      { name: "old_string", label: "原文本", kind: "textarea", required: true },
      { name: "new_string", label: "新文本", kind: "textarea", required: true },
      { name: "replace_all", label: "替换全部匹配", kind: "checkbox", defaultValue: false }
    ]
  },
  {
    value: "remote_list_files",
    label: "列出文件",
    fields: [
      { name: "path", label: "目录路径", kind: "text", required: true, placeholder: "/tmp" },
      { name: "max_entries", label: "最大条目", kind: "number", placeholder: "100" }
    ]
  }
];

export const TOOL_LABELS = Object.fromEntries(
  TOOL_DEFINITIONS.map((tool) => [tool.value, tool.label])
) as Record<ToolName, string>;

export const TERMINAL_STATUSES = new Set<TaskStatus>([
  "completed",
  "failed",
  "timeout",
  "cancelled",
  "lost"
]);

export const STATUS_LABELS: Record<TaskStatus, string> = {
  queued: "排队中",
  dispatched: "已派发",
  running: "运行中",
  completed: "已完成",
  failed: "失败",
  timeout: "超时",
  cancelled: "已取消",
  lost: "失联"
};
