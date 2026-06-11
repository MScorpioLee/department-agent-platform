import React from "react";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import MachinesPage from "@/app/machines/page";

const mocks = vi.hoisted(() => ({
  desktop: false,
  listMachines: vi.fn()
}));

vi.mock("@/lib/api-client", () => ({
  listMachines: mocks.listMachines
}));

vi.mock("@/lib/client-target", () => ({
  isDesktopClient: () => mocks.desktop
}));

describe("machines ui", () => {
  afterEach(() => {
    vi.clearAllMocks();
    mocks.desktop = false;
  });

  test("uses the dynamic access route in web mode", async () => {
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

    render(<MachinesPage />);

    const accessLink = await screen.findByRole("link", { name: "授权" });
    expect(accessLink.getAttribute("href")).toBe("/machines/m_1/access");
  });

  test("uses the static access route in desktop mode", async () => {
    mocks.desktop = true;
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

    render(<MachinesPage />);

    const accessLink = await screen.findByRole("link", { name: "授权" });
    expect(accessLink.getAttribute("href")).toBe("/machines/access?machine_id=m_1");
  });
});
