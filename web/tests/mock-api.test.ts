import { describe, expect, test } from "vitest";

import { createMockApi } from "@/lib/mock-api";

describe("mock api", () => {
  test("returns the required two-machine fixture", async () => {
    const api = createMockApi({ now: () => Date.parse("2026-06-10T12:00:00Z") });

    const response = await api.handle("GET", ["machines"]);

    expect(response.status).toBe(200);
    expect(response.body).toEqual([
      expect.objectContaining({
        machine_id: "m_mock_online",
        status: "online"
      }),
      expect.objectContaining({
        machine_id: "m_mock_offline",
        status: "offline"
      })
    ]);
  });

  test("creates a mock task that completes after three seconds with output", async () => {
    let now = Date.parse("2026-06-10T12:00:00Z");
    const api = createMockApi({ now: () => now });

    const createResponse = await api.handle("POST", ["tasks"], {
      machine_id: "m_mock_online",
      tool: "remote_exec",
      payload: { workdir: "/tmp", command: "pwd", timeout_seconds: 60 }
    });

    expect(createResponse.status).toBe(200);
    expect(createResponse.body).toMatchObject({
      task_id: expect.stringMatching(/^t_mock_/),
      status: "queued"
    });

    const taskId = createResponse.body.task_id;
    const queuedResponse = await api.handle("GET", ["tasks", taskId]);
    expect(queuedResponse.body).toMatchObject({ status: "queued", result: null });

    now += 3000;

    const completedResponse = await api.handle("GET", ["tasks", taskId]);
    expect(completedResponse.body).toMatchObject({
      status: "completed",
      result: { exit_code: 0, duration_ms: 3000 }
    });

    const outputResponse = await api.handle("GET", ["tasks", taskId, "output"]);
    expect(outputResponse.body).toEqual(
      expect.objectContaining({
        stdout: expect.stringContaining("mock task completed"),
        stderr: "",
        truncated: false
      })
    );
  });

  test("returns readable validation errors for invalid payloads", async () => {
    const api = createMockApi({ now: () => Date.parse("2026-06-10T12:00:00Z") });

    const response = await api.handle("POST", ["tasks"], {
      machine_id: "m_mock_online",
      tool: "remote_exec",
      payload: { workdir: "/tmp", command: "", timeout_seconds: 60 }
    });

    expect(response).toEqual({
      status: 422,
      body: { error: { code: "validation_error", message: "command 不能为空" } }
    });
  });
});
