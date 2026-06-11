import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import OnboardingPage from "@/app/admin/onboarding/page";
import AdminUsersPage from "@/app/admin/users/page";

const mocks = vi.hoisted(() => ({
  createEnrollmentToken: vi.fn(),
  createUser: vi.fn(),
  getMe: vi.fn(),
  listUsers: vi.fn()
}));

vi.mock("@/lib/api-client", () => ({
  createEnrollmentToken: mocks.createEnrollmentToken,
  createUser: mocks.createUser,
  getMe: mocks.getMe,
  listUsers: mocks.listUsers
}));

vi.mock("@/lib/client-target", () => ({
  isDesktopClient: () => false
}));

describe("admin ui", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  test("admin creates users from the users page", async () => {
    mocks.getMe.mockResolvedValue({ id: "u_admin", username: "admin", display_name: "管理员", role: "admin" });
    mocks.listUsers
      .mockResolvedValueOnce([{ id: "u_admin", username: "admin", display_name: "管理员", role: "admin" }])
      .mockResolvedValueOnce([
        { id: "u_admin", username: "admin", display_name: "管理员", role: "admin" },
        { id: "u_new", username: "new-user", display_name: "New User", role: "user" }
      ]);
    mocks.createUser.mockResolvedValue({ id: "u_new", username: "new-user", display_name: "New User", role: "user" });

    render(<AdminUsersPage />);

    expect(await screen.findByText("admin")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("用户名"), { target: { value: "new-user" } });
    fireEvent.change(screen.getByLabelText("密码"), { target: { value: "secret1" } });
    fireEvent.change(screen.getByLabelText("显示名"), { target: { value: "New User" } });
    fireEvent.click(screen.getByRole("button", { name: "新建用户" }));

    await waitFor(() => {
      expect(mocks.createUser).toHaveBeenCalledWith({
        username: "new-user",
        password: "secret1",
        display_name: "New User",
        role: "user"
      });
      expect(screen.getByText("用户已创建")).toBeTruthy();
    });
  });

  test("non-admin direct access shows no permission", async () => {
    mocks.getMe.mockResolvedValue({ id: "u_user", username: "alice", display_name: "Alice", role: "user" });

    render(<AdminUsersPage />);

    expect(await screen.findByText("无权限")).toBeTruthy();
    expect(mocks.listUsers).not.toHaveBeenCalled();
  });

  test("admin issues enrollment tokens and sees runner config", async () => {
    mocks.getMe.mockResolvedValue({ id: "u_admin", username: "admin", display_name: "管理员", role: "admin" });
    mocks.listUsers.mockResolvedValue([
      { id: "u_admin", username: "admin", display_name: "管理员", role: "admin" },
      { id: "u_owner", username: "owner", display_name: "Owner", role: "user" }
    ]);
    mocks.createEnrollmentToken.mockResolvedValue({
      enrollment_token: "et_mock_abc",
      owner_user_id: "u_owner",
      max_uses: 2
    });

    render(<OnboardingPage />);

    expect(await screen.findByText("签发 enrollment token")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("归属用户"), { target: { value: "u_owner" } });
    fireEvent.change(screen.getByLabelText("max_uses"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("有效天数"), { target: { value: "14" } });
    fireEvent.click(screen.getByRole("button", { name: "签发 token" }));

    await waitFor(() => {
      expect(mocks.createEnrollmentToken).toHaveBeenCalledWith({
        owner_user_id: "u_owner",
        max_uses: 2,
        expires_in_days: 14
      });
      expect(screen.getByText("仅此一次，请立即复制")).toBeTruthy();
      expect(screen.getByText("et_mock_abc")).toBeTruthy();
      expect(screen.getByText(/enrollment_token: et_mock_abc/)).toBeTruthy();
    });
  });
});
