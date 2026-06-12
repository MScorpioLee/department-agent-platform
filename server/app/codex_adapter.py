"""Codex 运行时适配(M15):OpenAI 兼容 chat/completions ↔ Responses API 互译。

用途:用 ChatGPT/Codex **订阅 OAuth 令牌**调 Codex 后端时,后端讲的是 Responses API
(`POST {base}/responses`,公开规范),不是 chat/completions。本模块把网关统一的
chat 请求/响应在两种形态间翻译,使订阅后端对上层透明。

边界(诚实声明):
- chat ↔ responses 的**字段映射**用 OpenAI **公开** Responses 规范实现,可离线测。
- 真实 Codex 后端的**端点 URL 与账号头**是 ChatGPT 私有面、随版本变——做成 backend.base_url
  + 配置注入,**不在此硬编码**;由部署者从开源 codex 源码填入当前值。
- httpx 经 client_factory 注入,便于用假后端完整测试。
"""

import httpx


def chat_to_responses(payload: dict) -> dict:
    """chat/completions 请求 → Responses 请求。messages→input(+instructions 提取 system)。"""
    messages = payload.get("messages") or []
    instructions_parts = []
    input_items = []
    for m in messages:
        role = m.get("role")
        content = m.get("content") or ""
        if role == "system":
            instructions_parts.append(content)
            continue
        # tool 结果与 assistant tool_calls 原样透传到 input(Responses 接受 role/content 项)
        item = {"role": role, "content": content}
        if m.get("tool_calls"):
            item["tool_calls"] = m["tool_calls"]
        if m.get("tool_call_id"):
            item["tool_call_id"] = m["tool_call_id"]
        input_items.append(item)
    out = {"model": payload.get("model"), "input": input_items}
    if instructions_parts:
        out["instructions"] = "\n\n".join(instructions_parts)
    if payload.get("tools"):
        out["tools"] = payload["tools"]
    return out


def _extract_text_and_calls(resp: dict) -> tuple[str, list]:
    """从 Responses 响应里提取助手文本与工具调用。兼容 output_text 与 output[] 两种形态。"""
    text = resp.get("output_text")
    tool_calls = []
    parts = []
    for item in resp.get("output") or []:
        itype = item.get("type")
        if itype in ("message", None):
            for block in item.get("content") or []:
                if block.get("type") in ("output_text", "text") and block.get("text"):
                    parts.append(block["text"])
        elif itype in ("function_call", "tool_call"):
            tool_calls.append({
                "id": item.get("call_id") or item.get("id") or "",
                "type": "function",
                "function": {"name": item.get("name", ""), "arguments": item.get("arguments") or "{}"},
            })
    if text is None:
        text = "".join(parts)
    return text, tool_calls


def responses_to_chat(resp: dict) -> dict:
    """Responses 响应 → chat/completions 响应(供上层统一处理)。"""
    text, tool_calls = _extract_text_and_calls(resp)
    message = {"role": "assistant", "content": text}
    if tool_calls:
        message["tool_calls"] = tool_calls
    usage = resp.get("usage") or {}
    # Responses 用 input_tokens/output_tokens;归一成 chat 的字段名
    norm_usage = {
        "prompt_tokens": usage.get("input_tokens") or usage.get("prompt_tokens") or 0,
        "completion_tokens": usage.get("output_tokens") or usage.get("completion_tokens") or 0,
        "total_tokens": usage.get("total_tokens")
        or (usage.get("input_tokens", 0) + usage.get("output_tokens", 0)),
    }
    return {"choices": [{"message": message, "finish_reason": "stop"}], "usage": norm_usage}


async def codex_chat(
    base_url: str,
    token: str,
    payload: dict,
    *,
    extra_headers: dict | None = None,
    timeout: float = 120.0,
    client_factory=httpx.AsyncClient,
) -> dict:
    """用订阅令牌调 Codex 后端 Responses 端点,返回 chat/completions 形态。

    base_url/extra_headers 由后端配置提供(私有面值不在代码内)。429/5xx 由网关层重试包裹。
    """
    req = chat_to_responses(payload)
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    if extra_headers:
        headers.update(extra_headers)
    async with client_factory(timeout=timeout) as http:
        resp = await http.post(f"{base_url.rstrip('/')}/responses", headers=headers, json=req)
    resp.raise_for_status()
    return responses_to_chat(resp.json())
