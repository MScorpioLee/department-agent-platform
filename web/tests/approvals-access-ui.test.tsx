import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import ApprovalsPage from "@/app/approvals/page";
import MachineAccessPage from "@/app/machines/[id]/access/page";

const mocks = vi.hoisted(() => ({
  approveApproval: vi.fn(),
  createMachineGrant: vi.fn(),
  listApprovals: vi.fn(),
  listMachineGrants: vi.fn(),
  listUsers: vi.fn(),
  rejectApproval: vi.fn(),
  revokeGrant: vi.fn()
}));

vi.mock("@/lib/api-client", () => ({
  approveApproval: mocks.approveApproval,
  createMachineGrant: mocks.createMachineGrant,
  listApprovals: mocks.listApprovals,
  listMachineGrants: mocks.listMachineGrants,
  listUsers: mocks.listUsers,
  rejectApproval: mocks.rejectApproval,
  revokeGrant: mocks.revokeGrant
}));

describe("approvals and access ui", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  test("approves and rejects pending approvals", async () => {
    mocks.listApprovals
      .mockResolvedValueOnce([
        {
          approval_id: "ap_1",
          machine_id: "m_1",
          requested_by_user_id: "u_1",
          tool: "remote_exec",
          payload: { command: "rm -rf [redacted]" },
          risk_rule: "rm -rf",
          status: "pending",
          created_at: "2026-06-10T12:00:00Z"
        },
        {
          approval_id: "ap_2",
          machine_id: "m_2",
          requested_by_user_id: "u_2",
          tool: "remote_write_file",
          payload: { path: "/tmp/a" },
          risk_rule: "write_file",
          status: "pending",
          created_at: "2026-06-10T12:00:00Z"
        }
      ])
      .mockResolvedValue([]);
    mocks.approveApproval.mockResolvedValue({
      approval_id: "ap_1",
      status: "approved",
      task_id: "t_1",
      task_status: "queued"
    });
    mocks.rejectApproval.mockResolvedValue({ approval_id: "ap_2", status: "rejected" });

    render(<ApprovalsPage />);

    expect(await screen.findByText("rm -rf")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "批准 ap_1" }));

    await waitFor(() => {
      expect(mocks.approveApproval).toHaveBeenCalledWith("ap_1");
      expect(screen.getByText("已批准，task_id: t_1")).toBeTruthy();
    });
  });

  test("creates and revokes machine grants", async () => {
    mocks.listMachineGrants
      .mockResolvedValueOnce([
        {
          grant_id: "g_1",
          grantee_user_id: "u_old",
          granted_by_user_id: "u_admin",
          expires_at: "2026-06-11T00:00:00Z",
          created_at: "2026-06-10T12:00:00Z"
        }
      ])
      .mockResolvedValueOnce([]);
    mocks.listUsers.mockResolvedValue([{ id: "u_new", username: "new-user", display_name: "New User", role: "user" }]);
    mocks.createMachineGrant.mockResolvedValue({ grant_id: "g_2", expires_at: "2026-06-11T00:00:00Z" });
    mocks.revokeGrant.mockResolvedValue({ revoked: true });

    render(<MachineAccessPage params={{ id: "m_1" }} />);

    expect(await screen.findByText("u_old")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("被授权用户"), { target: { value: "u_new" } });
    fireEvent.change(screen.getByLabelText("有效小时数"), { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: "新增授权" }));

    await waitFor(() => {
      expect(mocks.createMachineGrant).toHaveBeenCalledWith("m_1", {
        grantee_user_id: "u_new",
        expires_in_hours: 12
      });
      expect(screen.getByText("授权已创建")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "撤销 g_1" }));
    await waitFor(() => expect(mocks.revokeGrant).toHaveBeenCalledWith("g_1"));
  });
});
