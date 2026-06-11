"use client";

import { Ban, ChevronDown, Loader2, Play, RefreshCw } from "lucide-react";
import { useSearchParams } from "next/navigation";
import React, { FormEvent, Fragment, type MouseEvent, useCallback, useEffect, useMemo, useState } from "react";

import {
  cancelTask,
  createTask,
  getTask,
  getTaskOutput,
  listMachines,
  listTasks
} from "@/lib/api-client";
import { isDesktopClient } from "@/lib/client-target";
import { cn } from "@/lib/cn";
import { notifyDesktop } from "@/lib/desktop-bridge";
import { formatDateTime } from "@/lib/format";
import {
  TERMINAL_STATUSES,
  TOOL_DEFINITIONS,
  TOOL_LABELS,
  type ToolField
} from "@/lib/tooling";
import type { Machine, TaskOutput, TaskRecord, ToolName } from "@/lib/types";
import { MachineStatusBadge, TaskStatusBadge } from "@/components/status-badge";

type FormValue = string | boolean;
type FormValues = Record<string, FormValue>;

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "请求失败";
}

function getToolDefinition(tool: ToolName) {
  return TOOL_DEFINITIONS.find((definition) => definition.value === tool) ?? TOOL_DEFINITIONS[0];
}

function canCancelTask(task: TaskRecord) {
  return !TERMINAL_STATUSES.has(task.status);
}

function createDefaultFormValues(tool: ToolName): FormValues {
  const definition = getToolDefinition(tool);
  return Object.fromEntries(
    definition.fields.map((field) => [
      field.name,
      field.kind === "checkbox" ? Boolean(field.defaultValue) : String(field.defaultValue ?? "")
    ])
  );
}

function normalizePayload(tool: ToolName, values: FormValues): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const field of getToolDefinition(tool).fields) {
    const value = values[field.name];

    if (field.kind === "checkbox") {
      payload[field.name] = Boolean(value);
      continue;
    }

    const text = String(value ?? "");
    if (field.kind === "number") {
      const trimmed = text.trim();
      if (trimmed !== "") {
        payload[field.name] = Number(trimmed);
      }
      continue;
    }

    payload[field.name] = text;
  }
  return payload;
}

function FieldControl({
  field,
  value,
  onChange
}: {
  field: ToolField;
  value: FormValue | undefined;
  onChange: (value: FormValue) => void;
}) {
  const baseClass =
    "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-slate-900 focus:ring-2 focus:ring-slate-200";

  if (field.kind === "textarea") {
    return (
      <textarea
        required={field.required}
        value={String(value ?? "")}
        onChange={(event) => onChange(event.target.value)}
        placeholder={field.placeholder}
        rows={field.name === "command" ? 3 : 5}
        className={cn(baseClass, "resize-y font-mono")}
      />
    );
  }

  if (field.kind === "checkbox") {
    return (
      <label className="inline-flex h-10 items-center gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(event) => onChange(event.target.checked)}
          className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-400"
        />
        {field.label}
      </label>
    );
  }

  return (
    <input
      required={field.required}
      type={field.kind}
      min={field.kind === "number" ? 0 : undefined}
      value={String(value ?? "")}
      onChange={(event) => onChange(event.target.value)}
      placeholder={field.placeholder}
      className={baseClass}
    />
  );
}

function OutputPanel({ title, children }: { title: string; children: string }) {
  return (
    <div className="min-w-0">
      <div className="mb-2 text-xs font-semibold uppercase text-slate-500">{title}</div>
      <pre className="min-h-28 overflow-auto rounded-md bg-slate-950 p-3 font-mono text-xs leading-5 text-slate-100">
        {children || " "}
      </pre>
    </div>
  );
}

export function ConsoleClient() {
  const searchParams = useSearchParams();
  const queryMachineId = searchParams.get("machine_id");
  const [machines, setMachines] = useState<Machine[]>([]);
  const [machineError, setMachineError] = useState<string | null>(null);
  const [selectedMachineId, setSelectedMachineId] = useState("");
  const [selectedTool, setSelectedTool] = useState<ToolName>("remote_exec");
  const [formValues, setFormValues] = useState<FormValues>(() => createDefaultFormValues("remote_exec"));
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [activeTask, setActiveTask] = useState<TaskRecord | null>(null);
  const [activeOutput, setActiveOutput] = useState<TaskOutput | null>(null);
  const [history, setHistory] = useState<TaskRecord[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [expandedOutput, setExpandedOutput] = useState<TaskOutput | null>(null);
  const [expandedError, setExpandedError] = useState<string | null>(null);
  const [notifiedTaskId, setNotifiedTaskId] = useState<string | null>(null);
  const [cancellingTaskId, setCancellingTaskId] = useState<string | null>(null);
  const [cancelMessage, setCancelMessage] = useState<string | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const onlineMachines = useMemo(
    () => machines.filter((machine) => machine.status === "online"),
    [machines]
  );
  const selectedMachine = machines.find((machine) => machine.machine_id === selectedMachineId);
  const selectedToolDefinition = getToolDefinition(selectedTool);

  const refreshMachines = useCallback(async () => {
    try {
      const items = await listMachines();
      setMachines(items);
      setMachineError(null);
    } catch (error) {
      setMachineError(getErrorMessage(error));
    }
  }, []);

  const refreshHistory = useCallback(async () => {
    if (!selectedMachineId) {
      setHistory([]);
      return;
    }

    try {
      const items = await listTasks(selectedMachineId, 20);
      setHistory(items);
      setHistoryError(null);
    } catch (error) {
      setHistoryError(getErrorMessage(error));
    }
  }, [selectedMachineId]);

  useEffect(() => {
    void refreshMachines();
    const interval = window.setInterval(() => void refreshMachines(), 5000);
    return () => window.clearInterval(interval);
  }, [refreshMachines]);

  useEffect(() => {
    if (onlineMachines.length === 0) {
      setSelectedMachineId("");
      return;
    }

    const selectedStillOnline = onlineMachines.some(
      (machine) => machine.machine_id === selectedMachineId
    );
    if (selectedStillOnline) return;

    const queryMachine = onlineMachines.find((machine) => machine.machine_id === queryMachineId);
    setSelectedMachineId((queryMachine ?? onlineMachines[0]).machine_id);
  }, [onlineMachines, queryMachineId, selectedMachineId]);

  useEffect(() => {
    void refreshHistory();
    const interval = window.setInterval(() => void refreshHistory(), 5000);
    return () => window.clearInterval(interval);
  }, [refreshHistory]);

  useEffect(() => {
    if (!activeTaskId) return;

    let stopped = false;
    let interval: number | undefined;

    async function pollTask() {
      try {
        const task = await getTask(activeTaskId as string);
        if (stopped) return;
        setActiveTask(task);

        if (TERMINAL_STATUSES.has(task.status)) {
          const output = await getTaskOutput(activeTaskId as string);
          if (stopped) return;
          setActiveOutput(output);
          void refreshHistory();
          if (isDesktopClient() && notifiedTaskId !== task.task_id) {
            setNotifiedTaskId(task.task_id);
            void notifyDesktop("任务已完成", `${task.tool} · ${task.status}`);
          }
          if (interval !== undefined) {
            window.clearInterval(interval);
          }
        }
      } catch (error) {
        if (stopped) return;
        setSubmitError(getErrorMessage(error));
        if (interval !== undefined) {
          window.clearInterval(interval);
        }
      }
    }

    void pollTask();
    interval = window.setInterval(() => void pollTask(), 1000);
    return () => {
      stopped = true;
      if (interval !== undefined) {
        window.clearInterval(interval);
      }
    };
  }, [activeTaskId, notifiedTaskId, refreshHistory]);

  function updateField(name: string, value: FormValue) {
    setFormValues((current) => ({ ...current, [name]: value }));
  }

  function changeTool(tool: ToolName) {
    setSelectedTool(tool);
    setFormValues(createDefaultFormValues(tool));
    setSubmitError(null);
  }

  async function submitTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedMachineId) return;

    setSubmitting(true);
    setSubmitError(null);
    setCancelMessage(null);
    setCancelError(null);
    setActiveTask(null);
    setActiveOutput(null);
    setNotifiedTaskId(null);

    try {
      const task = await createTask({
        machine_id: selectedMachineId,
        tool: selectedTool,
        payload: normalizePayload(selectedTool, formValues)
      });
      setActiveTaskId(task.task_id);
      void refreshHistory();
    } catch (error) {
      setSubmitError(getErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleHistory(taskId: string) {
    if (expandedTaskId === taskId) {
      setExpandedTaskId(null);
      setExpandedOutput(null);
      setExpandedError(null);
      return;
    }

    setExpandedTaskId(taskId);
    setExpandedOutput(null);
    setExpandedError(null);

    try {
      const output = await getTaskOutput(taskId);
      setExpandedOutput(output);
    } catch (error) {
      setExpandedError(getErrorMessage(error));
    }
  }

  async function handleCancelTask(taskId: string, event?: MouseEvent<HTMLButtonElement>) {
    event?.stopPropagation();
    setCancellingTaskId(taskId);
    setCancelMessage(null);
    setCancelError(null);

    try {
      const cancelled = await cancelTask(taskId);
      const finishedAt = new Date().toISOString();
      setHistory((current) =>
        current.map((task) =>
          task.task_id === taskId
            ? { ...task, status: cancelled.status, finished_at: finishedAt }
            : task
        )
      );
      setActiveTask((current) =>
        current?.task_id === taskId
          ? { ...current, status: cancelled.status, finished_at: finishedAt }
          : current
      );
      setCancelMessage("任务已取消");
      void refreshHistory();
    } catch (error) {
      setCancelError(getErrorMessage(error));
    } finally {
      setCancellingTaskId(null);
    }
  }

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-normal text-slate-950">任务控制台</h1>
          <p className="mt-1 text-sm text-slate-500">工具任务下发与输出查看</p>
        </div>
        <button
          type="button"
          onClick={() => {
            void refreshMachines();
            void refreshHistory();
          }}
          className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
        >
          <RefreshCw aria-hidden="true" className="h-4 w-4" />
          刷新
        </button>
      </div>

      {machineError ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {machineError}
        </div>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <form
          onSubmit={(event) => void submitTask(event)}
          className="space-y-4 rounded-md border border-slate-200 bg-white p-4 shadow-sm"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block space-y-1.5">
              <span className="text-sm font-medium text-slate-700">机器</span>
              <div className="relative">
                <select
                  value={selectedMachineId}
                  onChange={(event) => setSelectedMachineId(event.target.value)}
                  className="h-10 w-full appearance-none rounded-md border border-slate-300 bg-white px-3 pr-9 text-sm text-slate-950 shadow-sm outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200"
                >
                  {onlineMachines.length === 0 ? (
                    <option value="">无在线机器</option>
                  ) : (
                    onlineMachines.map((machine) => (
                      <option key={machine.machine_id} value={machine.machine_id}>
                        {machine.machine_name}
                      </option>
                    ))
                  )}
                </select>
                <ChevronDown
                  aria-hidden="true"
                  className="pointer-events-none absolute right-3 top-3 h-4 w-4 text-slate-400"
                />
              </div>
            </label>

            <label className="block space-y-1.5">
              <span className="text-sm font-medium text-slate-700">工具</span>
              <div className="relative">
                <select
                  value={selectedTool}
                  onChange={(event) => changeTool(event.target.value as ToolName)}
                  className="h-10 w-full appearance-none rounded-md border border-slate-300 bg-white px-3 pr-9 text-sm text-slate-950 shadow-sm outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200"
                >
                  {TOOL_DEFINITIONS.map((tool) => (
                    <option key={tool.value} value={tool.value}>
                      {tool.label}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  aria-hidden="true"
                  className="pointer-events-none absolute right-3 top-3 h-4 w-4 text-slate-400"
                />
              </div>
            </label>
          </div>

          {selectedMachine ? (
            <div className="flex flex-wrap items-center gap-2 border-y border-slate-100 py-3 text-sm text-slate-600">
              <MachineStatusBadge status={selectedMachine.status} />
              <span>{selectedMachine.os}</span>
              <span className="text-slate-300">/</span>
              <span>{selectedMachine.machine_id}</span>
            </div>
          ) : null}

          <div className="grid gap-4">
            {selectedToolDefinition.fields.map((field) =>
              field.kind === "checkbox" ? (
                <FieldControl
                  key={field.name}
                  field={field}
                  value={formValues[field.name]}
                  onChange={(value) => updateField(field.name, value)}
                />
              ) : (
                <label key={field.name} className="block space-y-1.5">
                  <span className="text-sm font-medium text-slate-700">{field.label}</span>
                  <FieldControl
                    field={field}
                    value={formValues[field.name]}
                    onChange={(value) => updateField(field.name, value)}
                  />
                </label>
              )
            )}
          </div>

          {submitError ? (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {submitError}
            </div>
          ) : null}

          {cancelError ? (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {cancelError}
            </div>
          ) : null}

          {cancelMessage ? (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800">
              {cancelMessage}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={!selectedMachineId || submitting}
            className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-slate-900 px-4 text-sm font-semibold text-white shadow-sm hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300 sm:w-auto"
          >
            {submitting ? (
              <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
            ) : (
              <Play aria-hidden="true" className="h-4 w-4" />
            )}
            下发任务
          </button>
        </form>

        <div className="space-y-4 rounded-md border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-slate-950">下发结果</h2>
              <div className="mt-1 text-xs text-slate-500">{activeTask?.task_id ?? "暂无任务"}</div>
            </div>
            <div className="inline-flex items-center gap-2">
              {activeTask && canCancelTask(activeTask) ? (
                <button
                  type="button"
                  onClick={() => void handleCancelTask(activeTask.task_id)}
                  disabled={cancellingTaskId !== null}
                  className="inline-flex h-9 items-center gap-2 rounded-md border border-red-200 bg-white px-3 text-sm font-medium text-red-700 shadow-sm hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {cancellingTaskId === activeTask.task_id ? (
                    <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
                  ) : (
                    <Ban aria-hidden="true" className="h-4 w-4" />
                  )}
                  取消
                </button>
              ) : null}
              {activeTask ? <TaskStatusBadge status={activeTask.status} /> : null}
            </div>
          </div>

          {activeTask ? (
            <div className="grid gap-3 text-sm text-slate-600 sm:grid-cols-3">
              <div>
                <div className="text-xs text-slate-400">工具</div>
                <div className="mt-1 font-medium text-slate-800">{TOOL_LABELS[activeTask.tool]}</div>
              </div>
              <div>
                <div className="text-xs text-slate-400">exit_code</div>
                <div className="mt-1 font-medium text-slate-800">
                  {String(activeTask.result?.exit_code ?? "-")}
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-400">duration_ms</div>
                <div className="mt-1 font-medium text-slate-800">
                  {String(activeTask.result?.duration_ms ?? "-")}
                </div>
              </div>
            </div>
          ) : null}

          {activeOutput?.truncated ? (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
              输出已截断
            </div>
          ) : null}

          <div className="grid gap-4 lg:grid-cols-2">
            <OutputPanel title="stdout">{activeOutput?.stdout ?? ""}</OutputPanel>
            <OutputPanel title="stderr">{activeOutput?.stderr ?? ""}</OutputPanel>
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div>
            <h2 className="text-base font-semibold text-slate-950">最近任务</h2>
            <div className="mt-1 text-xs text-slate-500">最近 20 条</div>
          </div>
          {historyError ? <div className="text-sm text-red-600">{historyError}</div> : null}
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Task ID</th>
                <th className="px-4 py-3">工具</th>
                <th className="px-4 py-3">状态</th>
                <th className="px-4 py-3">创建时间</th>
                <th className="px-4 py-3">完成时间</th>
                <th className="px-4 py-3 text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {history.length === 0 ? (
                <tr>
                  <td className="px-4 py-8 text-center text-slate-500" colSpan={6}>
                    暂无任务
                  </td>
                </tr>
              ) : (
                history.map((task) => (
                  <Fragment key={task.task_id}>
                    <tr
                      className="cursor-pointer hover:bg-slate-50"
                      onClick={() => void toggleHistory(task.task_id)}
                    >
                      <td className="whitespace-nowrap px-4 py-4 font-mono text-xs text-slate-700">
                        {task.task_id}
                      </td>
                      <td className="whitespace-nowrap px-4 py-4 text-slate-600">
                        {TOOL_LABELS[task.tool]}
                      </td>
                      <td className="whitespace-nowrap px-4 py-4">
                        <TaskStatusBadge status={task.status} />
                      </td>
                      <td className="whitespace-nowrap px-4 py-4 text-slate-600">
                        {formatDateTime(task.created_at)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-4 text-slate-600">
                        {formatDateTime(task.finished_at)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-4 text-right">
                        {canCancelTask(task) ? (
                          <button
                            type="button"
                            aria-label={`取消 ${task.task_id}`}
                            onClick={(event) => void handleCancelTask(task.task_id, event)}
                            disabled={cancellingTaskId !== null}
                            className="inline-flex h-9 items-center gap-2 rounded-md border border-red-200 bg-white px-3 text-sm font-medium text-red-700 shadow-sm hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {cancellingTaskId === task.task_id ? (
                              <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
                            ) : (
                              <Ban aria-hidden="true" className="h-4 w-4" />
                            )}
                            取消
                          </button>
                        ) : (
                          <span className="text-xs text-slate-400">-</span>
                        )}
                      </td>
                    </tr>
                    {expandedTaskId === task.task_id ? (
                      <tr>
                        <td className="bg-slate-50 px-4 py-4" colSpan={6}>
                          {expandedError ? (
                            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                              {expandedError}
                            </div>
                          ) : (
                            <div className="grid gap-4 lg:grid-cols-2">
                              <OutputPanel title="stdout">{expandedOutput?.stdout ?? ""}</OutputPanel>
                              <OutputPanel title="stderr">{expandedOutput?.stderr ?? ""}</OutputPanel>
                            </div>
                          )}
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
