import json

import httpx
import pytest

from app.agent import run_agent_turn
from app.model_gateway import ModelBackend, ModelError, ModelGateway


def _assistant(content=None, tool_calls=None):
    msg = {"role": "assistant", "content": content}
    if tool_calls:
        msg["tool_calls"] = tool_calls
    return {"choices": [{"message": msg}]}


def _tool_call(call_id, name, args: dict):
    return {"id": call_id, "type": "function", "function": {"name": name, "arguments": json.dumps(args)}}


# ---------- Agent Loop ----------


async def test_loop_runs_tool_then_finishes():
    """模型先要求 remote_exec,拿到结果后给出文字回复。"""
    scripted = [
        _assistant(tool_calls=[_tool_call("c1", "remote_exec", {"workdir": ".", "command": "hostname"})]),
        _assistant(content="主机名是 my-host,命令成功。"),
    ]
    calls = iter(scripted)
    executed = []

    async def chat_fn(messages):
        return next(calls)

    async def executor(name, args):
        executed.append((name, args))
        return {"exit_code": 0, "stdout_tail": "my-host\n"}

    messages = [{"role": "user", "content": "查一下主机名"}]
    result = await run_agent_turn(messages, chat_fn, executor)

    assert result["stopped"] == "completed"
    assert result["steps"] == 2
    assert result["content"] == "主机名是 my-host,命令成功。"
    assert executed == [("remote_exec", {"workdir": ".", "command": "hostname"})]
    # 消息序列:user → assistant(tool_call) → tool → assistant(final)
    assert [m["role"] for m in messages] == ["user", "assistant", "tool", "assistant"]
    assert json.loads(messages[2]["content"])["exit_code"] == 0


async def test_loop_no_tool_immediate_answer():
    async def chat_fn(messages):
        return _assistant(content="你好,有什么可以帮你?")

    async def executor(name, args):
        raise AssertionError("不应调用工具")

    messages = [{"role": "user", "content": "你好"}]
    result = await run_agent_turn(messages, chat_fn, executor)
    assert result["stopped"] == "completed"
    assert result["steps"] == 1


async def test_loop_multiple_tools_in_one_step():
    scripted = [
        _assistant(
            tool_calls=[
                _tool_call("a", "remote_write_file", {"path": "/w/x", "content": "hi"}),
                _tool_call("b", "remote_read_file", {"path": "/w/x"}),
            ]
        ),
        _assistant(content="写入并读回完成。"),
    ]
    calls = iter(scripted)
    executed = []

    async def chat_fn(messages):
        return next(calls)

    async def executor(name, args):
        executed.append(name)
        return {"ok": True}

    messages = [{"role": "user", "content": "写文件再读回"}]
    result = await run_agent_turn(messages, chat_fn, executor)
    assert executed == ["remote_write_file", "remote_read_file"]
    assert [m["role"] for m in messages].count("tool") == 2
    assert result["stopped"] == "completed"


async def test_loop_bad_arguments_does_not_crash():
    bad_call = {"id": "x", "function": {"name": "remote_exec", "arguments": "{not json"}}
    scripted = [_assistant(tool_calls=[bad_call]), _assistant(content="参数有误,已跳过。")]
    calls = iter(scripted)

    async def chat_fn(messages):
        return next(calls)

    async def executor(name, args):
        raise AssertionError("参数非法时不应真正执行")

    messages = [{"role": "user", "content": "x"}]
    result = await run_agent_turn(messages, chat_fn, executor)
    tool_msg = next(m for m in messages if m["role"] == "tool")
    assert json.loads(tool_msg["content"])["error_code"] == "bad_arguments"
    assert result["stopped"] == "completed"


async def test_loop_stops_at_max_steps():
    async def chat_fn(messages):
        # 永远要求再执行一次工具 → 必须被 max_steps 截断
        return _assistant(tool_calls=[_tool_call("c", "remote_exec", {"workdir": ".", "command": "true"})])

    async def executor(name, args):
        return {"exit_code": 0}

    messages = [{"role": "user", "content": "死循环"}]
    result = await run_agent_turn(messages, chat_fn, executor, max_steps=3)
    assert result["stopped"] == "max_steps"
    assert result["steps"] == 3


async def test_loop_persistence_callbacks():
    scripted = [
        _assistant(tool_calls=[_tool_call("c1", "remote_exec", {"workdir": ".", "command": "ls"})]),
        _assistant(content="done"),
    ]
    calls = iter(scripted)
    saved_messages = []
    saved_tools = []

    async def chat_fn(messages):
        return next(calls)

    async def executor(name, args):
        return {"exit_code": 0}

    async def on_message(msg):
        saved_messages.append(msg["role"])

    async def on_tool_call(name, args, result):
        saved_tools.append((name, result["exit_code"]))

    messages = [{"role": "user", "content": "ls"}]
    await run_agent_turn(messages, chat_fn, executor, on_message=on_message, on_tool_call=on_tool_call)
    assert saved_messages == ["assistant", "tool", "assistant"]
    assert saved_tools == [("remote_exec", 0)]


# ---------- ModelGateway ----------


def test_gateway_routing():
    backends = [
        ModelBackend(id="sub1", base_url="http://x/v1", model="codex"),
        ModelBackend(id="sub2", base_url="http://y/v1", model="codex"),
    ]
    gw = ModelGateway(backends, user_routes={"alice": "sub2"}, default_backend_id="sub1")
    assert gw.resolve("alice").id == "sub2"  # 显式路由
    assert gw.resolve("bob").id == "sub1"  # 落到默认
    assert gw.resolve(None).id == "sub1"


def test_gateway_no_backend():
    gw = ModelGateway([])
    with pytest.raises(ModelError) as exc:
        gw.resolve("alice")
    assert exc.value.code == "no_backend"


async def test_gateway_retries_on_429_then_succeeds():
    attempts = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        attempts["n"] += 1
        if attempts["n"] == 1:
            return httpx.Response(429, headers={"retry-after": "0"}, json={"error": "slow down"})
        return httpx.Response(200, json={"choices": [{"message": {"role": "assistant", "content": "ok"}}]})

    backend = ModelBackend(id="sub1", base_url="http://fake/v1", model="codex")
    gw = ModelGateway([backend])

    transport = httpx.MockTransport(handler)
    # 用 MockTransport 拦截:打补丁 AsyncClient 默认 transport
    import app.model_gateway as mg

    orig = httpx.AsyncClient

    def patched(*args, **kwargs):
        kwargs["transport"] = transport
        return orig(*args, **kwargs)

    mg.httpx.AsyncClient = patched
    try:
        result = await gw.chat(backend, [{"role": "user", "content": "hi"}])
    finally:
        mg.httpx.AsyncClient = orig

    assert attempts["n"] == 2  # 第一次 429,退避后第二次成功
    assert result["choices"][0]["message"]["content"] == "ok"
