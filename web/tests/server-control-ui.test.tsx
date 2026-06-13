import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import ServerPage from "@/app/server/page";

const mocks = vi.hoisted(() => ({
  chooseServerDirectory: vi.fn(),
  desktop: true,
  serverGetConfig: vi.fn(),
  serverSetConfig: vi.fn(),
  serverStart: vi.fn(),
  serverStatus: vi.fn(),
  serverStop: vi.fn()
}));

vi.mock("@/lib/client-target", () => ({
  isDesktopClient: () => mocks.desktop
}));

vi.mock("@/lib/desktop-bridge", () => ({
  chooseServerDirectory: mocks.chooseServerDirectory,
  serverGetConfig: mocks.serverGetConfig,
  serverSetConfig: mocks.serverSetConfig,
  serverStart: mocks.serverStart,
  serverStatus: mocks.serverStatus,
  serverStop: mocks.serverStop
}));

describe("server control page", () => {
  beforeEach(() => {
    mocks.desktop = true;
    mocks.chooseServerDirectory.mockResolvedValue("/Users/leslie/agent/server");
    mocks.serverGetConfig.mockResolvedValue({
      server_dir: "",
      port: 8700,
      database_url: "",
      models_config_path: "",
      secret_key_set: true
    });
    mocks.serverSetConfig.mockResolvedValue({
      server_dir: "/Users/leslie/agent/server",
      port: 8701,
      database_url: "",
      models_config_path: "",
      secret_key_set: true
    });
    mocks.serverStatus.mockResolvedValue({
      running: false,
      reachable: false,
      pid: null,
      port: 8700,
      configured: false
    });
    mocks.serverStart.mockResolvedValue({
      running: true,
      reachable: true,
      pid: 12345,
      port: 8701,
      configured: true
    });
    mocks.serverStop.mockResolvedValue({
      running: false,
      reachable: false,
      pid: null,
      port: 8701,
      configured: true
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  test("desktop users configure and start the local server", async () => {
    render(<ServerPage />);

    expect(await screen.findByRole("heading", { name: "服务器" })).toBeTruthy();
    expect(screen.getByText("已停止")).toBeTruthy();
    expect(screen.getByText("未配置")).toBeTruthy();
    expect(screen.getByText("这是把本机当服务器主机;启动后本机/同局域网的客户端都连它。")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "选择目录" }));
    await waitFor(() => expect(mocks.chooseServerDirectory).toHaveBeenCalled());
    expect((screen.getByLabelText("server 目录") as HTMLInputElement).value).toBe("/Users/leslie/agent/server");

    fireEvent.change(screen.getByLabelText("端口"), { target: { value: "8701" } });
    fireEvent.click(screen.getByRole("button", { name: "保存设置" }));
    await waitFor(() => {
      expect(mocks.serverSetConfig).toHaveBeenCalledWith({
        serverDir: "/Users/leslie/agent/server",
        port: 8701,
        databaseUrl: "",
        modelsConfigPath: ""
      });
    });
    expect(await screen.findByText("设置已保存")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "启动" }));
    await waitFor(() => expect(mocks.serverStart).toHaveBeenCalled());
    expect(await screen.findByText("运行中 · 端口 8701 · PID 12345")).toBeTruthy();
    expect(screen.getByRole("button", { name: "停止" })).toBeTruthy();
  });

  test("shows readable server start errors", async () => {
    mocks.serverStatus.mockResolvedValue({
      running: false,
      reachable: false,
      pid: null,
      port: 8700,
      configured: true
    });
    mocks.serverStart.mockRejectedValue({
      code: "port_in_use",
      message: "address already in use"
    });

    render(<ServerPage />);

    await screen.findByText("已停止");
    fireEvent.click(screen.getByRole("button", { name: "启动" }));

    expect(await screen.findByText("端口已被占用,请换一个端口或停掉占用进程。")).toBeTruthy();
  });

  test("web preview keeps the panel unavailable instead of invoking desktop commands", () => {
    mocks.desktop = false;

    render(<ServerPage />);

    expect(screen.getByText("服务器面板仅在桌面客户端中可用。")).toBeTruthy();
    expect(mocks.serverGetConfig).not.toHaveBeenCalled();
    expect(mocks.serverStatus).not.toHaveBeenCalled();
  });
});
