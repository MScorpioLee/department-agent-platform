import { afterEach, describe, expect, test, vi } from "vitest";

import { ApiClientError, createTask, listMachines } from "@/lib/api-client";

describe("api-client", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("routes browser calls through the Next proxy without exposing an API key", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify([
          {
            machine_id: "m_online",
            machine_name: "alice-laptop",
            os: "darwin",
            status: "online",
            last_seen_at: "2026-06-10T12:00:00Z",
            capabilities: ["remote_exec"]
          }
        ]),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const machines = await listMachines();

    expect(machines).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/proxy/machines",
      expect.objectContaining({
        headers: expect.not.objectContaining({
          "X-API-Key": expect.anything()
        })
      })
    );
  });

  test("sends task payloads as JSON to the proxy", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ task_id: "t_mock", status: "queued" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const task = await createTask({
      machine_id: "m_online",
      tool: "remote_exec",
      payload: {
        workdir: "/tmp",
        command: "pwd",
        timeout_seconds: 60
      }
    });

    expect(task).toEqual({ task_id: "t_mock", status: "queued" });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/proxy/tasks",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          machine_id: "m_online",
          tool: "remote_exec",
          payload: {
            workdir: "/tmp",
            command: "pwd",
            timeout_seconds: 60
          }
        })
      })
    );
  });

  test("surfaces server error messages", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            error: { code: "validation_error", message: "command 不能为空" }
          }),
          { status: 422, headers: { "content-type": "application/json" } }
        )
      )
    );

    await expect(
      createTask({
        machine_id: "m_online",
        tool: "remote_exec",
        payload: { workdir: "/tmp", command: "", timeout_seconds: 60 }
      })
    ).rejects.toMatchObject({
      name: "ApiClientError",
      status: 422,
      code: "validation_error",
      message: "command 不能为空"
    } satisfies Partial<ApiClientError>);
  });
});
