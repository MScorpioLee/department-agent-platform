"""会话编排:把 Agent Loop 接到真实的模型网关与 Runner 下发。

run_session_turn 是 POST /api/sessions/{id}/messages 的核心:
存用户消息 → 构造上下文 → 跑 Agent Loop(模型↔工具)→ 落库 messages/tool_calls → 返回回复。
"""

import logging

from fastapi import HTTPException
from sqlalchemy import func, select

from .agent import run_agent_turn
from .model_gateway import ModelError
from .models import Machine, Message, Session, Task, ToolCall, new_id, utcnow
from .tool_specs import TOOL_NAMES, specs_for

log = logging.getLogger("agent_runner.services")

SYSTEM_PROMPT = (
    "你是部门 AI Agent 平台的助手,可以通过工具在目标机器 {machine_name}（{os}）上执行命令、读写文件。"
    "所有路径与命令受该机器的本地安全策略限制(allowed_roots/blocked_paths),被拒绝时工具会返回 error_code。"
    "请根据用户任务合理调用工具,完成后用中文简要说明结果与结论。"
)


async def dispatch_and_wait(app, machine_id: str, tool: str, payload: dict) -> Task:
    """创建任务、下发给 Runner 并等待终态,返回最终 Task 行。

    与 POST /api/tasks 的 fire-and-forget 不同,这里会阻塞到任务结束(或超时/掉线)。
    """
    hub = app.state.hub
    timeout = app.state.settings.tool_wait_timeout_seconds
    sessionmaker = app.state.sessionmaker

    async with sessionmaker() as session:
        task = Task(id=new_id("t"), machine_id=machine_id, tool=tool, payload=payload)
        session.add(task)
        await session.commit()
        task_id = task.id

        if not hub.is_online(machine_id):
            task.status = "lost"
            task.finished_at = utcnow()
            await session.commit()
            return task

        hub.open_buffer(task_id)
        hub.expect(task_id)
        sent = await hub.send(
            machine_id,
            {"protocol_version": 1, "type": "task", "task_id": task_id, "tool": tool, "payload": payload},
        )
        if not sent:
            hub.close_buffer(task_id)
            hub.resolve(task_id)
            task.status = "lost"
            task.finished_at = utcnow()
            await session.commit()
            return task
        task.status = "dispatched"
        task.dispatched_at = utcnow()
        await session.commit()

    await hub.wait(task_id, timeout)  # 超时返回 False,任务仍可能稍后回结果

    async with sessionmaker() as session:
        return await session.get(Task, task_id)


def _make_executor(app, machine: Machine, session_id: str):
    """生成给 Agent Loop 用的工具执行器:做能力门控,再下发到真实 Runner。"""
    caps = machine.capabilities

    async def executor(name: str, args: dict) -> dict:
        if name not in TOOL_NAMES:
            return {"error_code": "tool_unknown", "error_message": f"未知工具: {name}"}
        if caps and name not in caps:
            return {"error_code": "tool_not_supported", "error_message": f"目标机器不支持 {name}"}
        task = await dispatch_and_wait(app, machine.id, name, args)
        if task.status == "completed":
            return task.result or {}
        return {
            "error_code": task.status,
            "error_message": f"任务未成功完成: {task.status}",
            "result": task.result,
        }

    return executor


def _to_openai(msg: Message) -> dict:
    out: dict = {"role": msg.role, "content": msg.content or ""}
    if msg.tool_calls:
        out["tool_calls"] = msg.tool_calls
    if msg.tool_call_id:
        out["tool_call_id"] = msg.tool_call_id
    return out


async def run_session_turn(app, session_id: str, user_content: str) -> dict:
    sessionmaker = app.state.sessionmaker
    gateway = app.state.gateway

    async with sessionmaker() as session:
        sess = await session.get(Session, session_id)
        if sess is None:
            raise HTTPException(404, {"code": "session_not_found", "message": "会话不存在"})
        machine = await session.get(Machine, sess.machine_id)
        if machine is None:
            raise HTTPException(404, {"code": "machine_not_found", "message": "会话绑定的机器不存在"})

        next_seq = (
            await session.execute(
                select(func.coalesce(func.max(Message.seq), 0)).where(Message.session_id == session_id)
            )
        ).scalar_one()
        next_seq += 1
        session.add(
            Message(id=new_id("msg"), session_id=session_id, seq=next_seq, role="user", content=user_content)
        )
        await session.commit()

        history = (
            await session.execute(
                select(Message).where(Message.session_id == session_id).order_by(Message.seq)
            )
        ).scalars().all()
        user_id = sess.user_id
        machine_caps = machine.capabilities
        machine_name = machine.machine_name
        machine_os = machine.os or "unknown"
        machine_for_exec = machine

    try:
        backend = gateway.resolve(user_id)
    except ModelError as exc:
        raise HTTPException(503, {"code": exc.code, "message": exc.message})

    system_msg = {"role": "system", "content": SYSTEM_PROMPT.format(machine_name=machine_name, os=machine_os)}
    messages = [system_msg] + [_to_openai(m) for m in history]
    tools = specs_for(machine_caps)

    seq_counter = {"v": next_seq}

    async def chat_fn(msgs: list[dict]) -> dict:
        return await gateway.chat(backend, msgs, tools)

    executor = _make_executor(app, machine_for_exec, session_id)

    async def on_message(msg: dict) -> None:
        seq_counter["v"] += 1
        async with sessionmaker() as s:
            s.add(
                Message(
                    id=new_id("msg"),
                    session_id=session_id,
                    seq=seq_counter["v"],
                    role=msg["role"],
                    content=msg.get("content") or "",
                    tool_calls=msg.get("tool_calls"),
                    tool_call_id=msg.get("tool_call_id"),
                )
            )
            await s.commit()

    async def on_tool_call(name: str, args: dict, result: dict) -> None:
        status = "failed" if isinstance(result, dict) and result.get("error_code") else "completed"
        async with sessionmaker() as s:
            s.add(
                ToolCall(
                    id=new_id("tc"),
                    session_id=session_id,
                    machine_id=machine_for_exec.id,
                    tool_name=name,
                    arguments_json=args,
                    result_json=result,
                    status=status,
                )
            )
            await s.commit()

    try:
        result = await run_agent_turn(
            messages, chat_fn, executor, on_message=on_message, on_tool_call=on_tool_call
        )
    except ModelError as exc:
        raise HTTPException(503, {"code": exc.code, "message": exc.message})

    return {"reply": result["content"], "steps": result["steps"], "stopped": result["stopped"]}
