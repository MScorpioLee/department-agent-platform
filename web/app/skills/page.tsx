"use client";

import { BookOpen, Loader2, RefreshCw, Trash2, UploadCloud } from "lucide-react";
import React, { FormEvent, useEffect, useState } from "react";

import {
  createSkill,
  deleteSkill,
  getMe,
  importSkill,
  listAdminSkills,
  listSkills,
  listUsers,
  putSkillScope,
  setSkillEnabled,
  updateSkill
} from "@/lib/api-client";
import { cn } from "@/lib/cn";
import type { AdminSkill, Skill, UpdateSkillRequest, User } from "@/lib/types";

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "请求失败";
}

function scopeLabel(skill: AdminSkill, users: User[]) {
  if (skill.scope_all) return "全员";
  if (skill.scopes.length === 0) return "未授权";
  return skill.scopes
    .map((userId) => users.find((user) => user.id === userId)?.display_name || users.find((user) => user.id === userId)?.username || userId)
    .join(", ");
}

function sourceLabel(sourceRef?: string | null) {
  if (!sourceRef) return "手动";
  return sourceRef;
}

export default function SkillsPage() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [adminSkills, setAdminSkills] = useState<AdminSkill[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [prompt, setPrompt] = useState("");
  const [scopeAll, setScopeAll] = useState(false);
  const [scopeSkillId, setScopeSkillId] = useState("");
  const [scopeUserId, setScopeUserId] = useState("");
  const [importUrl, setImportUrl] = useState("");
  const [importScopeAll, setImportScopeAll] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function loadData(showSpinner = false) {
    if (showSpinner) setLoading(true);
    try {
      const [me, nextSkills] = await Promise.all([getMe(), listSkills()]);
      setCurrentUser(me);
      setSkills(nextSkills);

      if (me.role === "admin") {
        const [nextAdminSkills, nextUsers] = await Promise.all([listAdminSkills(), listUsers()]);
        setAdminSkills(nextAdminSkills);
        setUsers(nextUsers);
        setScopeSkillId((current) => current || nextAdminSkills[0]?.id || "");
        setScopeUserId((current) => current || nextUsers[0]?.id || "");
      } else {
        setAdminSkills([]);
        setUsers([]);
      }
      setError(null);
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData(true);
  }, []);

  function resetForm() {
    setEditingId(null);
    setName("");
    setDescription("");
    setPrompt("");
    setScopeAll(false);
  }

  function startEdit(skill: AdminSkill) {
    setEditingId(skill.id);
    setName(skill.name);
    setDescription(skill.description);
    setPrompt(skill.prompt);
    setScopeAll(skill.scope_all);
    setMessage(null);
  }

  async function toggleSkill(skill: Skill) {
    setTogglingId(skill.id);
    setError(null);
    setMessage(null);
    try {
      await setSkillEnabled(skill.id, !skill.enabled);
      await loadData();
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setTogglingId(null);
    }
  }

  async function submitSkill(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setMessage(null);
    try {
      if (editingId) {
        const payload: UpdateSkillRequest = {
          name: name.trim(),
          description: description.trim(),
          prompt: prompt.trim(),
          scope_all: scopeAll
        };
        await updateSkill(editingId, payload);
        setMessage("技能已保存");
      } else {
        await createSkill({
          name: name.trim(),
          description: description.trim(),
          prompt: prompt.trim(),
          scope_all: scopeAll
        });
        setMessage("技能已创建");
      }
      resetForm();
      await loadData();
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setSubmitting(false);
    }
  }

  async function removeSkill(skill: AdminSkill) {
    setError(null);
    setMessage(null);
    try {
      await deleteSkill(skill.id);
      setMessage("技能已删除");
      if (editingId === skill.id) resetForm();
      await loadData();
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    }
  }

  async function saveScope(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!scopeSkillId) return;
    setError(null);
    setMessage(null);
    try {
      await putSkillScope(scopeSkillId, scopeUserId ? [scopeUserId] : []);
      setMessage("作用域已保存");
      await loadData();
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    }
  }

  async function submitImport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setImporting(true);
    setError(null);
    setMessage(null);
    try {
      await importSkill({ url: importUrl.trim(), scope_all: importScopeAll });
      setImportUrl("");
      setImportScopeAll(false);
      setMessage("技能已导入");
      await loadData();
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setImporting(false);
    }
  }

  const isAdmin = currentUser?.role === "admin";

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-normal text-slate-950">技能</h1>
          <p className="mt-1 text-sm text-slate-500">启用后会进入对话提示词上下文</p>
        </div>
        <button
          type="button"
          onClick={() => void loadData(true)}
          className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
        >
          <RefreshCw aria-hidden="true" className={cn("h-4 w-4", loading && "animate-spin")} />
          刷新
        </button>
      </div>

      {error ? <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
      {message ? <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">{message}</div> : null}

      <section className="overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-4 py-3">
          <h2 className="text-base font-semibold text-slate-950">我的技能</h2>
        </div>
        <div className="divide-y divide-slate-100">
          {loading ? (
            <div className="px-4 py-8 text-center text-sm text-slate-500">加载中</div>
          ) : skills.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-slate-500">暂无可用技能,联系管理员授权</div>
          ) : (
            skills.map((skill) => (
              <div key={skill.id} className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-semibold text-slate-950">{skill.name}</h3>
                    <span className={cn("rounded-md border px-2 py-0.5 text-xs", skill.enabled ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-50 text-slate-500")}>
                      {skill.enabled ? "已启用" : "已停用"}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-slate-500">{skill.description || "无描述"}</p>
                </div>
                <button
                  type="button"
                  onClick={() => void toggleSkill(skill)}
                  disabled={togglingId === skill.id}
                  className={cn(
                    "inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-md px-3 text-sm font-semibold shadow-sm disabled:cursor-not-allowed disabled:opacity-60",
                    skill.enabled
                      ? "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                      : "bg-slate-900 text-white hover:bg-slate-700"
                  )}
                >
                  {togglingId === skill.id ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : null}
                  {skill.enabled ? `停用 ${skill.name}` : `启用 ${skill.name}`}
                </button>
              </div>
            ))
          )}
        </div>
      </section>

      {isAdmin ? (
        <section className="space-y-5">
          <div>
            <h2 className="text-xl font-semibold tracking-normal text-slate-950">技能管理</h2>
          </div>

          <div className="grid gap-5 xl:grid-cols-[380px_1fr]">
            <aside className="space-y-5">
              <form onSubmit={(event) => void submitSkill(event)} className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-center gap-2 text-base font-semibold text-slate-950">
                  <BookOpen aria-hidden="true" className="h-5 w-5 text-slate-500" />
                  {editingId ? "编辑技能" : "新建技能"}
                </div>
                <div className="mt-4 space-y-3">
                  <label className="block space-y-1.5">
                    <span className="text-sm font-medium text-slate-700">技能名称</span>
                    <input required value={name} onChange={(event) => setName(event.target.value)} className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 shadow-sm outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200" />
                  </label>
                  <label className="block space-y-1.5">
                    <span className="text-sm font-medium text-slate-700">描述</span>
                    <input value={description} onChange={(event) => setDescription(event.target.value)} className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 shadow-sm outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200" />
                  </label>
                  <label className="block space-y-1.5">
                    <span className="text-sm font-medium text-slate-700">提示词</span>
                    <textarea required value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={5} className="w-full resize-y rounded-md border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-950 shadow-sm outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200" />
                  </label>
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input type="checkbox" checked={scopeAll} onChange={(event) => setScopeAll(event.target.checked)} className="h-4 w-4 rounded border-slate-300" />
                    全员可用
                  </label>
                  <div className="flex gap-2">
                    <button type="submit" disabled={submitting} className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-md bg-slate-900 px-4 text-sm font-semibold text-white shadow-sm hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60">
                      {submitting ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : null}
                      {editingId ? "保存技能" : "新建技能"}
                    </button>
                    {editingId ? (
                      <button type="button" onClick={resetForm} className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50">
                        取消
                      </button>
                    ) : null}
                  </div>
                </div>
              </form>

              <form onSubmit={(event) => void submitImport(event)} className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-center gap-2 text-base font-semibold text-slate-950">
                  <UploadCloud aria-hidden="true" className="h-5 w-5 text-slate-500" />
                  从 GitHub 导入
                </div>
                <div className="mt-4 space-y-3">
                  <label className="block space-y-1.5">
                    <span className="text-sm font-medium text-slate-700">GitHub raw URL</span>
                    <input required type="url" value={importUrl} onChange={(event) => setImportUrl(event.target.value)} className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 shadow-sm outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200" />
                  </label>
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input type="checkbox" checked={importScopeAll} onChange={(event) => setImportScopeAll(event.target.checked)} className="h-4 w-4 rounded border-slate-300" />
                    导入后全员可用
                  </label>
                  <button type="submit" disabled={importing} className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-slate-900 px-4 text-sm font-semibold text-white shadow-sm hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60">
                    {importing ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : null}
                    导入技能
                  </button>
                </div>
              </form>

              <form onSubmit={(event) => void saveScope(event)} className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
                <h3 className="text-base font-semibold text-slate-950">作用域</h3>
                <div className="mt-4 space-y-3">
                  <label className="block space-y-1.5">
                    <span className="text-sm font-medium text-slate-700">作用域技能</span>
                    <select value={scopeSkillId} onChange={(event) => setScopeSkillId(event.target.value)} className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 shadow-sm outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200">
                      {adminSkills.map((skill) => (
                        <option key={skill.id} value={skill.id}>
                          {skill.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block space-y-1.5">
                    <span className="text-sm font-medium text-slate-700">授权用户</span>
                    <select value={scopeUserId} onChange={(event) => setScopeUserId(event.target.value)} className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 shadow-sm outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200">
                      <option value="">无指定用户</option>
                      {users.map((user) => (
                        <option key={user.id} value={user.id}>
                          {user.display_name || user.username} ({user.id})
                        </option>
                      ))}
                    </select>
                  </label>
                  <button type="submit" className="inline-flex h-10 w-full items-center justify-center rounded-md bg-slate-900 px-4 text-sm font-semibold text-white shadow-sm hover:bg-slate-700">
                    保存作用域
                  </button>
                </div>
              </form>
            </aside>

            <section className="overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 px-4 py-3">
                <h3 className="text-base font-semibold text-slate-950">全部技能</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                  <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
                    <tr>
                      <th className="px-4 py-3">名称</th>
                      <th className="px-4 py-3">描述</th>
                      <th className="px-4 py-3">来源</th>
                      <th className="px-4 py-3">作用域</th>
                      <th className="px-4 py-3">创建时间</th>
                      <th className="px-4 py-3">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {adminSkills.length === 0 ? (
                      <tr>
                        <td className="px-4 py-8 text-center text-slate-500" colSpan={6}>
                          暂无技能
                        </td>
                      </tr>
                    ) : (
                      adminSkills.map((skill) => (
                        <tr key={skill.id} className="hover:bg-slate-50">
                          <td className="whitespace-nowrap px-4 py-4 font-medium text-slate-950">{skill.name}</td>
                          <td className="max-w-[260px] px-4 py-4 text-slate-600">{skill.description || "-"}</td>
                          <td className="max-w-[260px] truncate px-4 py-4 font-mono text-xs text-slate-600" title={sourceLabel(skill.source_ref)}>{sourceLabel(skill.source_ref)}</td>
                          <td className="whitespace-nowrap px-4 py-4 text-slate-600">{scopeLabel(skill, users)}</td>
                          <td className="whitespace-nowrap px-4 py-4 text-slate-600">{new Date(skill.created_at).toLocaleString()}</td>
                          <td className="whitespace-nowrap px-4 py-4">
                            <div className="flex flex-wrap gap-2">
                              <button type="button" onClick={() => startEdit(skill)} className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50">
                                编辑 {skill.name}
                              </button>
                              <button type="button" onClick={() => void removeSkill(skill)} aria-label={`删除 ${skill.name}`} className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-red-200 text-red-600 hover:bg-red-50">
                                <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        </section>
      ) : null}
    </section>
  );
}
