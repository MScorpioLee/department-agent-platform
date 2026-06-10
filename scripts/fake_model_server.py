"""最小 OpenAI 兼容假模型,用于在没有真实订阅时验证 Agent Loop 全链路。

行为:消息里还没有工具结果(无 role=tool)时,返回一个 remote_exec 工具调用;
看到工具结果后,返回一句最终文字回复。workdir 从环境变量 E2E_WORKDIR 注入(确保在 allowed_roots 内)。
"""

import json
import os

from fastapi import FastAPI, Request

app = FastAPI()


@app.post("/v1/chat/completions")
async def chat_completions(request: Request) -> dict:
    body = await request.json()
    messages = body.get("messages", [])
    has_tool_result = any(m.get("role") == "tool" for m in messages)

    if not has_tool_result:
        workdir = os.environ.get("E2E_WORKDIR", ".")
        args = json.dumps({"workdir": workdir, "command": "echo agent-e2e-ok"})
        message = {
            "role": "assistant",
            "content": "",
            "tool_calls": [
                {"id": "call_1", "type": "function", "function": {"name": "remote_exec", "arguments": args}}
            ],
        }
    else:
        message = {"role": "assistant", "content": "命令已执行,输出包含 agent-e2e-ok,任务完成。"}

    return {"choices": [{"message": message}], "usage": {"total_tokens": 0}}
