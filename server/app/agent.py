"""自研 Agent Loop:模型 tool_call → 执行工具 → 结果回填 → 再调模型 → 文字回复。

刻意保持薄,不引入重框架。通过依赖注入 chat_fn / executor,可用打桩完整测试闭环,
不依赖真实模型或 Runner 连接。设计见 docs/architecture.md「Agent Loop」。
"""

import json
import logging
from typing import Awaitable, Callable

log = logging.getLogger("agent_runner.agent")

# chat_fn(messages) -> OpenAI 兼容的 completion JSON(含 choices[0].message)
ChatFn = Callable[[list[dict]], Awaitable[dict]]
# executor(tool_name, arguments) -> 工具结果 dict(成功或 {error_code, error_message})
Executor = Callable[[str, dict], Awaitable[dict]]
# 回调:用于把每条消息 / 每次工具调用落库审计
OnMessage = Callable[[dict], Awaitable[None]]
OnToolCall = Callable[[str, dict, dict], Awaitable[None]]

MAX_STEPS = 8  # 单轮最多模型往返次数,防失控循环


async def run_agent_turn(
    messages: list[dict],
    chat_fn: ChatFn,
    executor: Executor,
    *,
    on_message: OnMessage | None = None,
    on_tool_call: OnToolCall | None = None,
    max_steps: int = MAX_STEPS,
) -> dict:
    """就地推进 messages,返回 {"content": 最终回复, "steps": 往返次数, "stopped": 原因}。

    messages 调用前应已含 system + 历史 + 本轮 user 消息。
    """
    for step in range(1, max_steps + 1):
        completion = await chat_fn(messages)
        try:
            choice = completion["choices"][0]["message"]
        except (KeyError, IndexError) as exc:
            raise ValueError(f"模型返回结构异常: {completion!r}") from exc

        tool_calls = choice.get("tool_calls") or []
        assistant_msg: dict = {"role": "assistant", "content": choice.get("content") or ""}
        if tool_calls:
            assistant_msg["tool_calls"] = tool_calls
        messages.append(assistant_msg)
        if on_message:
            await on_message(assistant_msg)

        if not tool_calls:
            return {"content": assistant_msg["content"], "steps": step, "stopped": "completed"}

        for call in tool_calls:
            fn = call.get("function", {})
            name = fn.get("name", "")
            try:
                args = json.loads(fn.get("arguments") or "{}")
                if not isinstance(args, dict):
                    raise ValueError("arguments 不是对象")
            except (json.JSONDecodeError, ValueError) as exc:
                result = {"error_code": "bad_arguments", "error_message": f"工具参数解析失败: {exc}"}
            else:
                result = await executor(name, args)

            tool_msg = {
                "role": "tool",
                "tool_call_id": call.get("id", ""),
                "content": json.dumps(result, ensure_ascii=False),
            }
            messages.append(tool_msg)
            if on_message:
                await on_message(tool_msg)
            if on_tool_call:
                await on_tool_call(name, args if isinstance(result, dict) else {}, result)

    return {"content": "（已达到最大工具调用步数,本轮中止）", "steps": max_steps, "stopped": "max_steps"}
