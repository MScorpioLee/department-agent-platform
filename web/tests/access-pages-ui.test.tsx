import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import ApiAccessPage from "@/app/api-access/page";
import MyModelsPage from "@/app/my-models/page";

const mocks = vi.hoisted(() => ({
  createPersonalApiKey: vi.fn(),
  deleteMyModelLogin: vi.fn(),
  deletePersonalApiKey: vi.fn(),
  listMyModelLogins: vi.fn(),
  listPersonalApiKeys: vi.fn(),
  pollMyModelLoginDevice: vi.fn(),
  startMyModelLoginDevice: vi.fn()
}));

vi.mock("@/lib/api-client", () => ({
  createPersonalApiKey: mocks.createPersonalApiKey,
  deleteMyModelLogin: mocks.deleteMyModelLogin,
  deletePersonalApiKey: mocks.deletePersonalApiKey,
  listMyModelLogins: mocks.listMyModelLogins,
  listPersonalApiKeys: mocks.listPersonalApiKeys,
  pollMyModelLoginDevice: mocks.pollMyModelLoginDevice,
  startMyModelLoginDevice: mocks.startMyModelLoginDevice
}));

describe("access pages", () => {
  afterEach(() => {
    vi.resetAllMocks();
    vi.unstubAllGlobals();
  });

  test("users create and revoke personal api keys while plaintext is shown only once", async () => {
    mocks.listPersonalApiKeys
      .mockResolvedValueOnce([
        {
          id: "ak_seed",
          name: "ci",
          prefix: "ak_3f9c1b2…",
          created_at: "2026-06-12T00:00:00Z",
          last_used_at: null
        }
      ])
      .mockResolvedValue([
        {
          id: "ak_local",
          name: "local agent",
          prefix: "ak_mock_1234…",
          created_at: "2026-06-12T00:01:00Z",
          last_used_at: null
        }
      ]);
    mocks.createPersonalApiKey.mockResolvedValue({
      id: "ak_local",
      name: "local agent",
      prefix: "ak_mock_1234…",
      api_key: "ak_mock_plain_secret"
    });
    mocks.deletePersonalApiKey.mockResolvedValue({ deleted: true });
    vi.stubGlobal("confirm", vi.fn(() => true));
    vi.stubGlobal("navigator", {
      clipboard: {
        writeText: vi.fn()
      }
    });

    render(<ApiAccessPage />);

    expect(await screen.findByText("API 接入")).toBeTruthy();
    expect(screen.getByText("ak_3f9c1b2…")).toBeTruthy();
    expect(screen.getByDisplayValue(/\/v1$/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText("用途名"), { target: { value: "local agent" } });
    fireEvent.click(screen.getByRole("button", { name: "创建 Key" }));

    expect(await screen.findByText("关闭后无法再次查看")).toBeTruthy();
    expect(screen.getByText("ak_mock_plain_secret")).toBeTruthy();
    await waitFor(() => expect(mocks.listPersonalApiKeys).toHaveBeenCalledTimes(2));

    fireEvent.click(screen.getByRole("button", { name: "关闭一次性明文" }));
    await waitFor(() => expect(screen.queryByText("ak_mock_plain_secret")).toBeNull());
    expect(screen.getByText("ak_mock_1234…")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "吊销 local agent" }));

    await waitFor(() => expect(mocks.deletePersonalApiKey).toHaveBeenCalledWith("ak_local"));
  });

  test("users log into and out of per-user model backends with their own subscription", async () => {
    mocks.listMyModelLogins
      .mockResolvedValueOnce([
        {
          backend_id: "model_codex",
          name: "Codex 订阅",
          model: "codex-mini",
          runtime: "codex_responses",
          logged_in: false,
          updated_at: null
        }
      ])
      .mockResolvedValueOnce([
        {
          backend_id: "model_codex",
          name: "Codex 订阅",
          model: "codex-mini",
          runtime: "codex_responses",
          logged_in: true,
          updated_at: "2026-06-12T00:02:00Z"
        }
      ])
      .mockResolvedValue([
        {
          backend_id: "model_codex",
          name: "Codex 订阅",
          model: "codex-mini",
          runtime: "codex_responses",
          logged_in: false,
          updated_at: null
        }
      ]);
    mocks.startMyModelLoginDevice.mockResolvedValue({
      verification_uri: "https://chatgpt.com/activate",
      user_code: "USER-CODE",
      expires_in: 900,
      interval: 0
    });
    mocks.pollMyModelLoginDevice.mockResolvedValueOnce({ status: "pending" }).mockResolvedValueOnce({ status: "authorized" });
    mocks.deleteMyModelLogin.mockResolvedValue({ logged_out: true });

    render(<MyModelsPage />);

    expect(await screen.findByText("我的模型登录")).toBeTruthy();
    expect(screen.getByText("用你自己的订阅，只用于你自己的会话")).toBeTruthy();
    expect(screen.getByText("未登录")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "用我的订阅登录 Codex 订阅" }));

    expect(await screen.findByText("USER-CODE")).toBeTruthy();
    await waitFor(() => expect(mocks.pollMyModelLoginDevice).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getAllByText("已登录").length).toBeGreaterThan(0));

    fireEvent.click(screen.getByRole("button", { name: "注销 Codex 订阅" }));

    await waitFor(() => expect(mocks.deleteMyModelLogin).toHaveBeenCalledWith("model_codex"));
  });
});
