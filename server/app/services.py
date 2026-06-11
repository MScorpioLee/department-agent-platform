"""会话编排:把 Agent Loop 接到真实的模型网关与 Runner 下发。

run_session_turn 是 POST /api/sessions/{id}/messages 的核心:
存用户消息 → 构造上下文 → 跑 Agent Loop(模型↔工具)→ 落库 messages/tool_calls → 返回回复。
"""

import logging

from fastapi import HTTPException
from sqlalchemy import func, select

from .agent import run_agent_turn
from .model_gateway import ModelError
from .models import Approval, Machine, Message, ModelUsage, Session, Task, ToolCall, new_id, utcnow
from .risk import evaluate_risk
from .tool_specs import TOOL_NAMES, specs_for

log = logging.getLogger("agent_runner.services")

SYSTEM_PROMPT = (
    "你是部门 AI Agent 平台的助手,可以通过工具在目标机器 {machine_name}（{os}）上执行命令、读写文件。"
    "所有路径与命令受该机器的本地安全策略限制(allowed_roots/blocked_paths),被拒绝时工具会返回 error_code。"
    "请根据用户任务合理调用工具,完成后用中文简要说明结果与结论。"
)


async def _emit(app, session_id: str | None, event: dict) -> None:
    """向会话事件总线发布事件(无订阅者时为空操作)。"""
    if not session_id:
        return
    bus = getattr(app.state, "events", None)
    if bus is not None:
        await bus.publish(session_id, event)


async def dispatch_and_wait(app, machine_id: str, tool: str, payload: dict, session_id: str | None = None) -> Task:
    """创建任务、下发给 Runner 并等待终态,返回最终 Task 行。

    与 POST /api/tasks 的 fire-and-forget 不同,这里会阻塞到任务结束(或超时/掉线)。
    session_id 非空时,把 task 注册到 task_sessions,使其实时输出能路由到该会话订阅者。
    """
    hub = app.state.hub
    timeout = app.state.settings.tool_wait_timeout_seconds
    sessionmaker = app.state.sessionmaker
    task_sessions = getattr(app.state, "task_sessions", None)

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

        if task_sessions is not None and session_id:
            task_sessions[task_id] = session_id
        hub.open_buffer(task_id)
        hub.expect(task_id)
        sent = await hub.send(
            machine_id,
            {"protocol_version": 1, "type": "task", "task_id": task_id, "tool": tool, "payload": payload},
        )
        if not sent:
            hub.close_buffer(task_id)
            hub.resolve(task_id)
            if task_sessions is not None:
                task_sessions.pop(task_id, None)
            task.status = "lost"
            task.finished_at = utcnow()
            await session.commit()
            return task
        task.status = "dispatched"
        task.dispatched_at = utcnow()
        await session.commit()

    try:
        await hub.wait(task_id, timeout)  # 超时返回 False,任务仍可能稍后回结果
    finally:
        if task_sessions is not None:
            task_sessions.pop(task_id, None)

    async with sessionmaker() as session:
        return await session.get(Task, task_id)


async def create_approval(app, machine_id, session_id, user_id, tool, payload, rule) -> str:
    async with app.state.sessionmaker() as session:
        ap = Approval(
            id=new_id("ap"),
            machine_id=machine_id,
            session_id=session_id,
            requested_by_user_id=user_id,
            tool=tool,
            payload=payload,
            risk_rule=rule,
        )
        session.add(ap)
        await session.commit()
        return ap.id


async def dispatch_no_wait(app, machine_id: str, tool: str, payload: dict) -> Task:
    """创建任务并下发,不等待结果(供 /api/tasks 与审批通过后复用)。返回 Task(可能为 lost)。"""
    hub = app.state.hub
    async with app.state.sessionmaker() as session:
        task = Task(id=new_id("t"), machine_id=machine_id, tool=tool, payload=payload)
        session.add(task)
        await session.commit()
        hub.open_buffer(task.id)
        sent = await hub.send(
            machine_id,
            {"protocol_version": 1, "type": "task", "task_id": task.id, "tool": tool, "payload": payload},
        )
        if not sent:
            hub.close_buffer(task.id)
            task.status = "lost"
            task.finished_at = utcnow()
        else:
            task.status = "dispatched"
            task.dispatched_at = utcnow()
        await session.commit()
        return task


def _make_executor(app, machine: Machine, session_id: str, user_id: str):
    """生成给 Agent Loop 用的工具执行器:能力门控 + 高风险审批拦截,再下发到真实 Runner。"""
    caps = machine.capabilities

    async def executor(name: str, args: dict) -> dict:
        if name not in TOOL_NAMES:
            return {"error_code": "tool_unknown", "error_message": f"未知工具: {name}"}
        if caps and name not in caps:
            return {"error_code": "tool_not_supported", "error_message": f"目标机器不支持 {name}"}
        # 高风险操作不直接执行,创建审批并把结果交回模型(由模型转达用户)
        rule = evaluate_risk(name, args)
        if rule:
            approval_id = await create_approval(app, machine.id, session_id, user_id, name, args, rule)
            await _emit(app, session_id, {"type": "approval_required", "tool": name, "approval_id": approval_id, "risk_rule": rule})
            return {
                "needs_approval": True,
                "approval_id": approval_id,
                "risk_rule": rule,
                "error_message": f"操作命中高风险规则「{rule}」,已创建审批 {approval_id},需机器所有者批准后才会执行。",
            }
        await _emit(app, session_id, {"type": "tool_call", "tool": name, "arguments": args})
        task = await dispatch_and_wait(app, machine.id, name, args, session_id=session_id)
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
    usage_acc = {"prompt": 0, "completion": 0, "total": 0}

    async def chat_fn(msgs: list[dict]) -> dict:
        completion = await gateway.chat(backend, msgs, tools)
        u = completion.get("usage") or {}
        usage_acc["prompt"] += int(u.get("prompt_tokens") or 0)
        usage_acc["completion"] += int(u.get("completion_tokens") or 0)
        usage_acc["total"] += int(u.get("total_tokens") or 0)
        return completion

    executor = _make_executor(app, machine_for_exec, session_id, user_id)

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
        # 实时推送 assistant 消息(含文字与 tool_calls);tool 角色由 tool_result 事件覆盖
        if msg["role"] == "assistant":
            await _emit(app, session_id, {
                "type": "assistant",
                "content": msg.get("content") or "",
                "tool_calls": msg.get("tool_calls"),
            })

    async def on_tool_call(name: str, args: dict, result: dict) -> None:
        status = "failed" if isinstance(result, dict) and result.get("error_code") else "completed"
        await _emit(app, session_id, {"type": "tool_result", "tool": name, "status": status})
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

    await _emit(app, session_id, {"type": "turn_started"})
    try:
        result = await run_agent_turn(
            messages, chat_fn, executor, on_message=on_message, on_tool_call=on_tool_call
        )
    except ModelError as exc:
        await _emit(app, session_id, {"type": "turn_error", "code": exc.code, "message": exc.message})
        raise HTTPException(503, {"code": exc.code, "message": exc.message})
    await _emit(app, session_id, {"type": "turn_done", "reply": result["content"], "stopped": result["stopped"]})

    # 记录本轮模型用量(支撑按用户/订阅的审计与配额观察)
    if usage_acc["total"] or usage_acc["prompt"]:
        async with sessionmaker() as s:
            s.add(
                ModelUsage(
                    id=new_id("mu"),
                    session_id=session_id,
                    user_id=user_id,
                    backend_id=getattr(backend, "id", None),
                    model=getattr(backend, "model", None),
                    prompt_tokens=usage_acc["prompt"],
                    completion_tokens=usage_acc["completion"],
                    total_tokens=usage_acc["total"] or (usage_acc["prompt"] + usage_acc["completion"]),
                )
            )
            await s.commit()

    return {"reply": result["content"], "steps": result["steps"], "stopped": result["stopped"]}
