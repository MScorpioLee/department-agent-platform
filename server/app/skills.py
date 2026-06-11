"""技能(M11):声明式能力包。提示词预设 + 作用域;可从 GitHub 导入(只读解析,不执行代码)。

启用某技能 = 把其 prompt 并入该用户会话的系统提示。技能本身不新增执行通道,复用机器/连接器工具。
"""

import logging

import httpx
import yaml
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select

from .auth import require_admin, require_user
from .models import Skill, SkillScope, User, UserSkillState, new_id
from .schemas import SkillImportIn, SkillIn, SkillPatch, SkillScopeIn, SkillToggleIn

router = APIRouter()
log = logging.getLogger("agent_runner.skills")


def _iso(dt):
    return dt.isoformat() if dt else None


def parse_skill_manifest(text: str) -> dict:
    """解析技能清单:支持 markdown frontmatter(SKILL.md)或纯 YAML(skill.yaml)。"""
    stripped = text.lstrip()
    if stripped.startswith("---"):
        parts = stripped.split("---", 2)
        if len(parts) >= 3:
            fm = yaml.safe_load(parts[1]) or {}
            body = parts[2].strip()
            return {
                "name": fm.get("name"),
                "description": fm.get("description"),
                "prompt": str(fm.get("prompt") or body),
            }
    try:
        data = yaml.safe_load(text)
        if isinstance(data, dict):
            return {
                "name": data.get("name"),
                "description": data.get("description"),
                "prompt": str(data.get("prompt") or ""),
            }
    except yaml.YAMLError:
        pass
    return {"name": None, "description": None, "prompt": text}


async def active_skill_prompts(sessionmaker, user_id: str) -> list[str]:
    """该用户已启用且有权的技能的提示词(供 Agent Loop 并入系统提示)。"""
    if not user_id or user_id == "default":
        return []
    async with sessionmaker() as session:
        skills = (await session.execute(select(Skill))).scalars().all()
        scopes = {
            s.skill_id for s in (await session.execute(
                select(SkillScope).where(SkillScope.user_id == user_id))).scalars()
        }
        states = {
            st.skill_id: st.enabled for st in (await session.execute(
                select(UserSkillState).where(UserSkillState.user_id == user_id))).scalars()
        }
    out = []
    for sk in skills:
        available = sk.scope_all or sk.id in scopes
        if available and states.get(sk.id) and sk.prompt:
            out.append(sk.prompt)
    return out


def _out(sk: Skill, scopes: list[str]) -> dict:
    return {
        "id": sk.id, "name": sk.name, "description": sk.description,
        "prompt": sk.prompt, "source_ref": sk.source_ref, "scope_all": sk.scope_all,
        "scopes": scopes, "created_at": _iso(sk.created_at),
    }


# ---------- 管理员 ----------


@router.get("/api/admin/skills", dependencies=[Depends(require_admin)])
async def list_skills(request: Request) -> list[dict]:
    async with request.app.state.sessionmaker() as session:
        rows = (await session.execute(select(Skill).order_by(Skill.created_at))).scalars().all()
        scope_rows = (await session.execute(select(SkillScope))).scalars().all()
    scopes: dict[str, list[str]] = {}
    for s in scope_rows:
        scopes.setdefault(s.skill_id, []).append(s.user_id)
    return [_out(r, scopes.get(r.id, [])) for r in rows]


async def _create_skill(session, name, description, prompt, scope_all, source_ref=None) -> Skill:
    if (await session.execute(select(Skill).where(Skill.name == name))).scalar_one_or_none():
        raise HTTPException(409, {"code": "name_exists", "message": "同名技能已存在"})
    sk = Skill(id=new_id("skill"), name=name, description=description, prompt=prompt or "",
               scope_all=scope_all, source_ref=source_ref)
    session.add(sk)
    return sk


@router.post("/api/admin/skills", dependencies=[Depends(require_admin)])
async def create_skill(body: SkillIn, request: Request) -> dict:
    async with request.app.state.sessionmaker() as session:
        sk = await _create_skill(session, body.name, body.description, body.prompt, body.scope_all)
        await session.commit()
        return _out(sk, [])


@router.post("/api/admin/skills/import", dependencies=[Depends(require_admin)])
async def import_skill(body: SkillImportIn, request: Request) -> dict:
    if not body.url.lower().startswith(("http://", "https://")):
        raise HTTPException(422, {"code": "bad_url", "message": "仅支持 http(s) URL"})
    try:
        async with httpx.AsyncClient(timeout=15, follow_redirects=True) as http:
            resp = await http.get(body.url)
        resp.raise_for_status()
    except httpx.HTTPError as exc:
        raise HTTPException(502, {"code": "fetch_failed", "message": f"拉取失败: {exc}"})
    manifest = parse_skill_manifest(resp.text)
    name = manifest.get("name") or body.url.rstrip("/").split("/")[-1].split(".")[0]
    if not manifest.get("prompt"):
        raise HTTPException(422, {"code": "no_prompt", "message": "清单缺少 prompt"})
    async with request.app.state.sessionmaker() as session:
        sk = await _create_skill(session, name, manifest.get("description"), manifest["prompt"],
                                 body.scope_all, source_ref=body.url)
        await session.commit()
        return _out(sk, [])


@router.patch("/api/admin/skills/{skill_id}", dependencies=[Depends(require_admin)])
async def update_skill(skill_id: str, body: SkillPatch, request: Request) -> dict:
    async with request.app.state.sessionmaker() as session:
        sk = await session.get(Skill, skill_id)
        if sk is None:
            raise HTTPException(404, {"code": "skill_not_found", "message": "技能不存在"})
        for f in ("name", "description", "prompt", "scope_all"):
            v = getattr(body, f)
            if v is not None:
                setattr(sk, f, v)
        await session.commit()
        scopes = [s.user_id for s in (await session.execute(
            select(SkillScope).where(SkillScope.skill_id == skill_id))).scalars()]
        return _out(sk, scopes)


@router.delete("/api/admin/skills/{skill_id}", dependencies=[Depends(require_admin)])
async def delete_skill(skill_id: str, request: Request) -> dict:
    from sqlalchemy import delete

    async with request.app.state.sessionmaker() as session:
        sk = await session.get(Skill, skill_id)
        if sk is None:
            raise HTTPException(404, {"code": "skill_not_found", "message": "技能不存在"})
        await session.execute(delete(SkillScope).where(SkillScope.skill_id == skill_id))
        await session.execute(delete(UserSkillState).where(UserSkillState.skill_id == skill_id))
        await session.delete(sk)
        await session.commit()
    return {"deleted": skill_id}


@router.put("/api/admin/skills/{skill_id}/scope", dependencies=[Depends(require_admin)])
async def set_skill_scope(skill_id: str, body: SkillScopeIn, request: Request) -> dict:
    from sqlalchemy import delete

    async with request.app.state.sessionmaker() as session:
        if await session.get(Skill, skill_id) is None:
            raise HTTPException(404, {"code": "skill_not_found", "message": "技能不存在"})
        await session.execute(delete(SkillScope).where(SkillScope.skill_id == skill_id))
        for uid in set(body.user_ids):
            session.add(SkillScope(skill_id=skill_id, user_id=uid))
        await session.commit()
    return {"skill_id": skill_id, "user_ids": body.user_ids}


# ---------- 普通用户:看可用技能 + 自己启停 ----------


@router.get("/api/skills")
async def my_skills(request: Request, user: User = Depends(require_user)) -> list[dict]:
    async with request.app.state.sessionmaker() as session:
        skills = (await session.execute(select(Skill).order_by(Skill.created_at))).scalars().all()
        my_scopes = {
            s.skill_id for s in (await session.execute(
                select(SkillScope).where(SkillScope.user_id == user.id))).scalars()
        }
        states = {
            st.skill_id: st.enabled for st in (await session.execute(
                select(UserSkillState).where(UserSkillState.user_id == user.id))).scalars()
        }
    out = []
    for sk in skills:
        if sk.scope_all or sk.id in my_scopes:
            out.append({"id": sk.id, "name": sk.name, "description": sk.description,
                        "enabled": bool(states.get(sk.id, False))})
    return out


@router.put("/api/skills/{skill_id}/enabled")
async def toggle_skill(skill_id: str, body: SkillToggleIn, request: Request, user: User = Depends(require_user)) -> dict:
    async with request.app.state.sessionmaker() as session:
        sk = await session.get(Skill, skill_id)
        if sk is None or not (sk.scope_all or (await session.get(SkillScope, (skill_id, user.id)))):
            raise HTTPException(403, {"code": "forbidden", "message": "无权使用该技能"})
        state = await session.get(UserSkillState, (user.id, skill_id))
        if state is None:
            session.add(UserSkillState(user_id=user.id, skill_id=skill_id, enabled=body.enabled))
        else:
            state.enabled = body.enabled
        await session.commit()
    return {"skill_id": skill_id, "enabled": body.enabled}
