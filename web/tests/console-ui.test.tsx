import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { ConsoleClient } from "@/app/console/console-client";

const mocks = vi.hoisted(() => ({
  cancelTask: vi.fn(),
  createTask: vi.fn(),
  getTask: vi.fn(),
  getTaskOutput: vi.fn(),
  listMachines: vi.fn(),
  listTasks: vi.fn()
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("machine_id=m_1")
}));

vi.mock("@/lib/api-client", () => ({
  cancelTask: mocks.cancelTask,
  createTask: mocks.createTask,
  getTask: mocks.getTask,
  getTaskOutput: mocks.getTaskOutput,
  listMachines: mocks.listMachines,
  listTasks: mocks.listTasks
}));

vi.mock("@/lib/client-target", () => ({
  isDesktopClient: () => false
}));

vi.mock("@/lib/desktop-bridge", () => ({
  notifyDesktop: vi.fn()
}));

describe("console ui", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  test("cancels non-terminal history tasks", async () => {
    mocks.listMachines.mockResolvedValue([
      {
        machine_id: "m_1",
        machine_name: "alice-laptop",
        os: "darwin",
        status: "online",
        last_seen_at: "2026-06-10T12:00:00Z",
        capabilities: ["remote_exec"]
      }
    ]);
    mocks.listTasks.mockResolvedValue([
      {
        task_id: "t_1",
        machine_id: "m_1",
        tool: "remote_exec",
        payload: { workdir: "/tmp", command: "sleep 30" },
        status: "queued",
        result: null,
        created_at: "2026-06-10T12:00:00Z",
        finished_at: null
      }
    ]);
    mocks.cancelTask.mockResolvedValue({ task_id: "t_1", status: "cancelled" });

    render(<ConsoleClient />);

    expect(await screen.findByText("t_1")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "取消 t_1" }));

    await waitFor(() => {
      expect(mocks.cancelTask).toHaveBeenCalledWith("t_1");
      expect(screen.getByText("任务已取消")).toBeTruthy();
    });
  });
});
