import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import HomePage from "@/app/page";
import LoginPage from "@/app/login/page";
import { AppShell } from "@/components/app-shell";

const mocks = vi.hoisted(() => ({
  coder: false,
  desktop: false,
  getMe: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
  pathname: "/login",
  registerUser: vi.fn(),
  replace: vi.fn()
}));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({ replace: mocks.replace })
}));

vi.mock("@/lib/api-client", () => ({
  getMe: mocks.getMe,
  login: mocks.login,
  logout: mocks.logout,
  registerUser: mocks.registerUser
}));

vi.mock("@/lib/client-target", () => ({
  isCoderProfile: () => mocks.coder,
  isDesktopClient: () => mocks.desktop
}));

describe("auth ui", () => {
  afterEach(() => {
    vi.clearAllMocks();
    mocks.coder = false;
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

  test("coder profile login redirects straight to the coding workspace", async () => {
    mocks.coder = true;
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
      expect(mocks.replace).toHaveBeenCalledWith("/desktop-agent");
    });
  });

  test("login page switches to register and shows pending approval success", async () => {
    mocks.registerUser.mockResolvedValue({
      status: "pending",
      username: "new-user",
      message: "注册已提交,等待管理员审批,通过后即可登录"
    });

    render(<LoginPage />);

    fireEvent.click(screen.getByRole("tab", { name: "注册" }));
    fireEvent.change(screen.getByLabelText("用户名"), { target: { value: "new-user" } });
    fireEvent.change(screen.getByLabelText("密码"), { target: { value: "secret1" } });
    fireEvent.change(screen.getByLabelText("显示名"), { target: { value: "New User" } });
    fireEvent.change(screen.getByLabelText("申请说明"), { target: { value: "需要项目访问" } });
    fireEvent.click(screen.getByRole("button", { name: "提交注册" }));

    await waitFor(() => {
      expect(mocks.registerUser).toHaveBeenCalledWith(
        {
          username: "new-user",
          password: "secret1",
          display_name: "New User",
          note: "需要项目访问"
        },
        {}
      );
      expect(screen.getByText("注册已提交,等待管理员审批,通过后即可登录")).toBeTruthy();
      expect(screen.getByRole("button", { name: "登录" })).toBeTruthy();
    });
  });

  test("desktop register reuses the server URL from the shared login page", async () => {
    mocks.desktop = true;
    mocks.registerUser.mockResolvedValue({
      status: "pending",
      username: "desk-user",
      message: "注册已提交,等待管理员审批,通过后即可登录"
    });

    render(<LoginPage />);

    fireEvent.change(screen.getByLabelText("Server 地址"), { target: { value: "http://agent.test" } });
    fireEvent.click(screen.getByRole("tab", { name: "注册" }));
    fireEvent.change(screen.getByLabelText("用户名"), { target: { value: "desk-user" } });
    fireEvent.change(screen.getByLabelText("密码"), { target: { value: "secret1" } });
    fireEvent.click(screen.getByRole("button", { name: "提交注册" }));

    await waitFor(() => {
      expect(mocks.registerUser).toHaveBeenCalledWith(
        {
          username: "desk-user",
          password: "secret1",
          display_name: "",
          note: ""
        },
        { serverUrl: "http://agent.test" }
      );
    });
  });

  test("login page renders pending approval errors explicitly", async () => {
    mocks.login.mockRejectedValue({ status: 403, code: "pending_approval", message: "账号待审批" });

    render(<LoginPage />);

    fireEvent.change(screen.getByLabelText("用户名"), { target: { value: "pending" } });
    fireEvent.change(screen.getByLabelText("密码"), { target: { value: "secret" } });
    fireEvent.click(screen.getByRole("button", { name: "登录" }));

    expect(await screen.findByText("账号待审批")).toBeTruthy();
    expect(screen.queryByText("用户名或密码错误")).toBeNull();
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
    expect(screen.getByRole("link", { name: "用户" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "上线" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "模型" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "连接器" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "技能" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "编码 Agent" })).toBeNull();
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
    expect(screen.queryByRole("link", { name: "用户" })).toBeNull();
    expect(screen.queryByRole("link", { name: "上线" })).toBeNull();
    expect(screen.queryByRole("link", { name: "模型" })).toBeNull();
    expect(screen.queryByRole("link", { name: "连接器" })).toBeNull();
    expect(screen.getByRole("link", { name: "技能" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "编码 Agent" })).toBeNull();
  });

  test("app shell shows coding agent navigation only in desktop mode", async () => {
    mocks.pathname = "/desktop-agent";
    mocks.desktop = true;
    mocks.getMe.mockResolvedValue({
      id: "u_mock",
      username: "bob",
      display_name: "bob",
      role: "user"
    });

    render(
      <AppShell>
        <div>桌面编码</div>
      </AppShell>
    );

    expect(await screen.findByText("bob")).toBeTruthy();
    expect(screen.getByRole("link", { name: "编码 Agent" })).toBeTruthy();
  });

  test("coder profile bypasses the management shell navigation", async () => {
    mocks.coder = true;
    mocks.desktop = true;
    mocks.pathname = "/desktop-agent";
    mocks.getMe.mockResolvedValue({
      id: "u_mock",
      username: "coder",
      display_name: "coder",
      role: "admin"
    });

    render(
      <AppShell>
        <div>编码工作台</div>
      </AppShell>
    );

    expect(await screen.findByText("Agent Coder")).toBeTruthy();
    expect(screen.getByText("编码工作台")).toBeTruthy();
    expect(screen.getByText("coder")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "机器" })).toBeNull();
    expect(screen.queryByRole("link", { name: "用户" })).toBeNull();
    expect(screen.queryByRole("link", { name: "编码 Agent" })).toBeNull();
  });

  test("home page sends coder profile users to the coding workspace", async () => {
    mocks.coder = true;

    render(<HomePage />);

    await waitFor(() => {
      expect(mocks.replace).toHaveBeenCalledWith("/desktop-agent");
    });
  });
});
