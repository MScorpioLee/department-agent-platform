import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import SkillsPage from "@/app/skills/page";

const mocks = vi.hoisted(() => ({
  createSkill: vi.fn(),
  deleteSkill: vi.fn(),
  getMe: vi.fn(),
  importSkill: vi.fn(),
  listAdminSkills: vi.fn(),
  listSkills: vi.fn(),
  listUsers: vi.fn(),
  putSkillScope: vi.fn(),
  setSkillEnabled: vi.fn(),
  updateSkill: vi.fn()
}));

vi.mock("@/lib/api-client", () => ({
  createSkill: mocks.createSkill,
  deleteSkill: mocks.deleteSkill,
  getMe: mocks.getMe,
  importSkill: mocks.importSkill,
  listAdminSkills: mocks.listAdminSkills,
  listSkills: mocks.listSkills,
  listUsers: mocks.listUsers,
  putSkillScope: mocks.putSkillScope,
  setSkillEnabled: mocks.setSkillEnabled,
  updateSkill: mocks.updateSkill
}));

describe("skills page", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  test("regular users see authorized skills and can toggle them without admin controls", async () => {
    mocks.getMe.mockResolvedValue({ id: "u_alice", username: "alice", display_name: "Alice", role: "user" });
    mocks.listSkills
      .mockResolvedValueOnce([
        { id: "skill_1", name: "Code Review", description: "检查代码改动", enabled: true }
      ])
      .mockResolvedValueOnce([
        { id: "skill_1", name: "Code Review", description: "检查代码改动", enabled: false }
      ]);
    mocks.setSkillEnabled.mockResolvedValue({
      id: "skill_1",
      name: "Code Review",
      description: "检查代码改动",
      enabled: false
    });

    render(<SkillsPage />);

    expect(await screen.findByText("Code Review")).toBeTruthy();
    expect(screen.queryByText("Finance Private")).toBeNull();
    expect(screen.queryByText("技能管理")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "停用 Code Review" }));

    await waitFor(() => expect(mocks.setSkillEnabled).toHaveBeenCalledWith("skill_1", false));
    expect(await screen.findByRole("button", { name: "启用 Code Review" })).toBeTruthy();
  });

  test("regular users see an empty state when no authorized skills exist", async () => {
    mocks.getMe.mockResolvedValue({ id: "u_bob", username: "bob", display_name: "Bob", role: "user" });
    mocks.listSkills.mockResolvedValue([]);

    render(<SkillsPage />);

    expect(await screen.findByText("暂无可用技能,联系管理员授权")).toBeTruthy();
    expect(screen.queryByText("技能管理")).toBeNull();
  });

  test("admins create, edit, delete, scope, and import skills", async () => {
    mocks.getMe.mockResolvedValue({ id: "u_admin", username: "admin", display_name: "管理员", role: "admin" });
    mocks.listUsers.mockResolvedValue([
      { id: "u_admin", username: "admin", display_name: "管理员", role: "admin" },
      { id: "u_alice", username: "alice", display_name: "Alice", role: "user" }
    ]);
    mocks.listSkills.mockResolvedValue([
      { id: "skill_1", name: "Code Review", description: "检查代码改动", enabled: true }
    ]);
    mocks.listAdminSkills.mockResolvedValue([
      {
        id: "skill_1",
        name: "Code Review",
        description: "检查代码改动",
        prompt: "Review this diff",
        source_ref: null,
        scope_all: true,
        scopes: [],
        created_at: "2026-06-11T00:00:00Z"
      }
    ]);
    mocks.createSkill.mockResolvedValue({ id: "skill_2" });
    mocks.updateSkill.mockResolvedValue({ id: "skill_1" });
    mocks.deleteSkill.mockResolvedValue({ deleted: true });
    mocks.putSkillScope.mockResolvedValue({ user_ids: ["u_alice"] });
    mocks.importSkill.mockResolvedValue({
      id: "skill_3",
      name: "Imported Skill",
      source_ref: "https://raw.githubusercontent.com/acme/repo/main/SKILL.md"
    });

    render(<SkillsPage />);

    expect(await screen.findByText("技能管理")).toBeTruthy();
    expect(screen.getByText("从 GitHub 导入")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("技能名称"), { target: { value: "Deploy Helper" } });
    fireEvent.change(screen.getByLabelText("描述"), { target: { value: "发布前检查" } });
    fireEvent.change(screen.getByLabelText("提示词"), { target: { value: "Prepare release notes" } });
    fireEvent.click(screen.getByLabelText("全员可用"));
    fireEvent.click(screen.getByRole("button", { name: "新建技能" }));

    await waitFor(() => {
      expect(mocks.createSkill).toHaveBeenCalledWith({
        name: "Deploy Helper",
        description: "发布前检查",
        prompt: "Prepare release notes",
        scope_all: true
      });
    });

    fireEvent.change(screen.getByLabelText("GitHub raw URL"), {
      target: { value: "https://raw.githubusercontent.com/acme/repo/main/SKILL.md" }
    });
    fireEvent.click(screen.getByRole("button", { name: "导入技能" }));

    await waitFor(() => {
      expect(mocks.importSkill).toHaveBeenCalledWith({
        url: "https://raw.githubusercontent.com/acme/repo/main/SKILL.md",
        scope_all: false
      });
    });

    fireEvent.change(screen.getByLabelText("作用域技能"), { target: { value: "skill_1" } });
    fireEvent.change(screen.getByLabelText("授权用户"), { target: { value: "u_alice" } });
    fireEvent.click(screen.getByRole("button", { name: "保存作用域" }));

    await waitFor(() => expect(mocks.putSkillScope).toHaveBeenCalledWith("skill_1", ["u_alice"]));

    fireEvent.click(screen.getByRole("button", { name: "编辑 Code Review" }));
    fireEvent.change(screen.getByLabelText("提示词"), { target: { value: "New prompt" } });
    fireEvent.click(screen.getByRole("button", { name: "保存技能" }));

    await waitFor(() => {
      expect(mocks.updateSkill).toHaveBeenCalledWith(
        "skill_1",
        expect.objectContaining({ prompt: "New prompt" })
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "删除 Code Review" }));

    await waitFor(() => expect(mocks.deleteSkill).toHaveBeenCalledWith("skill_1"));
  });
});
