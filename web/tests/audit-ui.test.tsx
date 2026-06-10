import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import AuditPage from "@/app/audit/page";

const mocks = vi.hoisted(() => ({
  getMe: vi.fn(),
  getAuditUsage: vi.fn(),
  getAuditSessions: vi.fn(),
  getAuditToolCalls: vi.fn(),
  getAuditCommands: vi.fn()
}));

vi.mock("@/lib/api-client", () => ({
  getMe: mocks.getMe,
  getAuditUsage: mocks.getAuditUsage,
  getAuditSessions: mocks.getAuditSessions,
  getAuditToolCalls: mocks.getAuditToolCalls,
  getAuditCommands: mocks.getAuditCommands
}));

describe("audit ui", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  test("renders usage, sessions, tool calls, and command records for admins", async () => {
    mocks.getMe.mockResolvedValue({
      id: "u_admin",
      username: "admin",
      display_name: "Admin",
      role: "admin"
    });
    mocks.getAuditUsage.mockResolvedValue({
      total_tokens: 1234,
      by_user_backend: [
        {
          user_id: "u_admin",
          backend_id: "openai",
          prompt_tokens: 500,
          completion_tokens: 734,
          total_tokens: 1234,
          turns: 8
        }
      ]
    });
    mocks.getAuditSessions.mockResolvedValue([
      {
        session_id: "s_1",
        user_id: "u_admin",
        machine_id: "m_1",
        title: "排查构建",
        status: "active",
        message_count: 3,
        created_at: "2026-06-10T12:00:00Z"
      }
    ]);
    mocks.getAuditToolCalls.mockResolvedValue([
      {
        id: "tc_1",
        session_id: "s_1",
        machine_id: "m_1",
        tool_name: "remote_exec",
        arguments: { command: "[redacted]" },
        result: { exit_code: 0 },
        status: "completed",
        created_at: "2026-06-10T12:00:01Z"
      }
    ]);
    mocks.getAuditCommands.mockResolvedValue([
      {
        task_id: "t_1",
        machine_id: "m_1",
        command: "npm test [redacted]",
        status: "completed",
        exit_code: 0,
        stdout: "ok",
        stderr: "",
        created_at: "2026-06-10T12:00:02Z"
      }
    ]);

    render(<AuditPage />);

    await screen.findByText("审计后台");
    expect(screen.getAllByText("1,234").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("openai")).toBeTruthy();
    expect(screen.getByText("排查构建")).toBeTruthy();
    expect(screen.getByText("npm test [redacted]")).toBeTruthy();

    fireEvent.click(screen.getByText("排查构建"));

    await waitFor(() => {
      expect(mocks.getAuditToolCalls).toHaveBeenCalledWith({ sessionId: "s_1", limit: 50 });
      expect(screen.getByText("remote_exec")).toBeTruthy();
    });
  });

  test("shows a permission message for non-admin users", async () => {
    mocks.getMe.mockResolvedValue({
      id: "u_user",
      username: "bob",
      display_name: "Bob",
      role: "user"
    });

    render(<AuditPage />);

    expect(await screen.findByText("需要管理员权限")).toBeTruthy();
    expect(mocks.getAuditUsage).not.toHaveBeenCalled();
  });
});
