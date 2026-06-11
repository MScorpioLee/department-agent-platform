import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import LoginPage from "@/app/login/page";
import { AppShell } from "@/components/app-shell";

const mocks = vi.hoisted(() => ({
  desktop: false,
  getMe: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
  pathname: "/login",
  replace: vi.fn()
}));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({ replace: mocks.replace })
}));

vi.mock("@/lib/api-client", () => ({
  getMe: mocks.getMe,
  login: mocks.login,
  logout: mocks.logout
}));

vi.mock("@/lib/client-target", () => ({
  isDesktopClient: () => mocks.desktop
}));

describe("auth ui", () => {
  afterEach(() => {
    vi.clearAllMocks();
    mocks.desktop = false;
    mocks.pathname = "/login";
  });

  test("login page submits credentials and redirects to machines", async () => {
    mocks.login.mockResolvedValue({
      id: "u_mock",
      username: "alice",
      display_name: "alice",
      role: "user"
    });

    render(<LoginPage />);

    fireEvent.change(screen.getByLabelText("用户名"), { target: { value: "alice" } });
    fireEvent.change(screen.getByLabelText("密码"), { target: { value: "secret" } });
    fireEvent.click(screen.getByRole("button", { name: "登录" }));

    await waitFor(() => {
      expect(mocks.login).toHaveBeenCalledWith("alice", "secret");
      expect(mocks.replace).toHaveBeenCalledWith("/machines");
    });
  });

  test("desktop login asks for server URL and passes it to the API client", async () => {
    mocks.desktop = true;
    mocks.login.mockResolvedValue({
      id: "u_mock",
      username: "alice",
      display_name: "alice",
      role: "user"
    });

    render(<LoginPage />);

    fireEvent.change(screen.getByLabelText("Server 地址"), { target: { value: "http://agent.test" } });
    fireEvent.change(screen.getByLabelText("用户名"), { target: { value: "alice" } });
    fireEvent.change(screen.getByLabelText("密码"), { target: { value: "secret" } });
    fireEvent.click(screen.getByRole("button", { name: "登录" }));

    await waitFor(() => {
      expect(mocks.login).toHaveBeenCalledWith("alice", "secret", { serverUrl: "http://agent.test" });
      expect(mocks.replace).toHaveBeenCalledWith("/machines");
    });
  });

  test("app shell shows current user and logs out", async () => {
    mocks.pathname = "/machines";
    mocks.getMe.mockResolvedValue({
      id: "u_mock",
      username: "alice",
      display_name: "alice",
      role: "admin"
    });
    mocks.logout.mockResolvedValue(undefined);

    render(
      <AppShell>
        <div>受保护内容</div>
      </AppShell>
    );

    expect(await screen.findByText("alice")).toBeTruthy();
    expect(screen.getByRole("link", { name: "审计" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "登出" }));

    await waitFor(() => {
      expect(mocks.logout).toHaveBeenCalled();
      expect(mocks.replace).toHaveBeenCalledWith("/login");
    });
  });

  test("app shell treats trailing slash login route as public", () => {
    mocks.pathname = "/login/";

    render(
      <AppShell>
        <div>登录内容</div>
      </AppShell>
    );

    expect(screen.getByText("登录内容")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "登出" })).toBeNull();
    expect(mocks.getMe).not.toHaveBeenCalled();
  });

  test("app shell redirects protected pages to login when unauthenticated", async () => {
    mocks.pathname = "/machines";
    mocks.getMe.mockRejectedValue({ status: 401, message: "请先登录" });

    render(
      <AppShell>
        <div>受保护内容</div>
      </AppShell>
    );

    await waitFor(() => {
      expect(mocks.replace).toHaveBeenCalledWith("/login");
    });
  });

  test("app shell hides audit navigation for non-admin users", async () => {
    mocks.pathname = "/machines";
    mocks.getMe.mockResolvedValue({
      id: "u_mock",
      username: "bob",
      display_name: "bob",
      role: "user"
    });

    render(
      <AppShell>
        <div>受保护内容</div>
      </AppShell>
    );

    expect(await screen.findByText("bob")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "审计" })).toBeNull();
  });
});
