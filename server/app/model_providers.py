"""预设 Provider 目录:给"添加 Provider"提供现成选项(OpenAI 兼容端点),用户选了自动填地址,只填 key。

参考 Hermes Studio 的 Provider 列表。全部是 OpenAI 兼容的 /chat/completions 端点;
非兼容的(如 Anthropic 原生)注明需经 LiteLLM/代理。base_url 不含末尾 /chat/completions。
"""

async def list_models_from_endpoint(base_url: str, api_key: str = "") -> list[str]:
    """调 OpenAI 兼容端点的 GET /models,返回真实可用模型 id(对标 Hermes 的"获取模型列表")。

    同时充当连通性与 key 校验:401 = key 错,连接失败 = 地址不通。独立函数便于测试替换。
    """
    import httpx

    headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
    async with httpx.AsyncClient(timeout=12) as client:
        resp = await client.get(f"{base_url.rstrip('/')}/models", headers=headers)
        resp.raise_for_status()
        data = resp.json()
    items = data.get("data") if isinstance(data, dict) else data
    out = []
    for it in items or []:
        mid = it.get("id") if isinstance(it, dict) else None
        if mid:
            out.append(str(mid))
    return sorted(out)


PRESET_PROVIDERS = [
    {"id": "deepseek", "name": "DeepSeek", "base_url": "https://api.deepseek.com/v1",
     "models": ["deepseek-chat", "deepseek-reasoner"], "needs_key": True, "note": ""},
    {"id": "openai", "name": "OpenAI", "base_url": "https://api.openai.com/v1",
     "models": ["gpt-4o", "gpt-4o-mini", "o4-mini"], "needs_key": True, "note": ""},
    {"id": "google", "name": "Google AI Studio (Gemini)", "base_url": "https://generativelanguage.googleapis.com/v1beta/openai",
     "models": ["gemini-2.0-flash", "gemini-1.5-pro"], "needs_key": True, "note": "Gemini 的 OpenAI 兼容端点"},
    {"id": "zhipu", "name": "Z.AI / GLM (智谱)", "base_url": "https://open.bigmodel.cn/api/paas/v4",
     "models": ["glm-4-plus", "glm-4-flash"], "needs_key": True, "note": ""},
    {"id": "moonshot", "name": "Moonshot / Kimi", "base_url": "https://api.moonshot.cn/v1",
     "models": ["moonshot-v1-8k", "moonshot-v1-32k"], "needs_key": True, "note": ""},
    {"id": "qwen", "name": "通义千问 (DashScope)", "base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
     "models": ["qwen-plus", "qwen-turbo", "qwen-max"], "needs_key": True, "note": "OpenAI 兼容模式"},
    {"id": "openrouter", "name": "OpenRouter", "base_url": "https://openrouter.ai/api/v1",
     "models": ["openai/gpt-4o", "anthropic/claude-3.5-sonnet"], "needs_key": True, "note": "聚合多家"},
    {"id": "siliconflow", "name": "SiliconFlow (硅基流动)", "base_url": "https://api.siliconflow.cn/v1",
     "models": ["deepseek-ai/DeepSeek-V3", "Qwen/Qwen2.5-72B-Instruct"], "needs_key": True, "note": "国内聚合,多开源模型"},
    {"id": "groq", "name": "Groq", "base_url": "https://api.groq.com/openai/v1",
     "models": ["llama-3.3-70b-versatile", "qwen-2.5-coder-32b"], "needs_key": True, "note": "高速推理"},
    {"id": "mistral", "name": "Mistral", "base_url": "https://api.mistral.ai/v1",
     "models": ["mistral-large-latest", "codestral-latest"], "needs_key": True, "note": ""},
    {"id": "xai", "name": "xAI (Grok)", "base_url": "https://api.x.ai/v1",
     "models": ["grok-3", "grok-3-mini"], "needs_key": True, "note": ""},
    {"id": "lmstudio", "name": "LM Studio (本地)", "base_url": "http://127.0.0.1:1234/v1",
     "models": ["local-model"], "needs_key": False, "note": "本机 LM Studio,model 名以其加载的为准"},
    {"id": "ollama", "name": "Ollama (本地)", "base_url": "http://127.0.0.1:11434/v1",
     "models": ["qwen2.5", "llama3.1"], "needs_key": False, "note": "本机 Ollama 的 OpenAI 兼容端点"},
    {"id": "hermes_proxy", "name": "Hermes / Codex 代理 (OAuth)", "base_url": "http://127.0.0.1:11500/v1",
     "models": ["gpt-5.1-codex"], "needs_key": False, "note": "开发期把订阅暴露为 OpenAI 兼容端点,非生产基础设施"},
    {"id": "anthropic", "name": "Anthropic / Claude (需代理)", "base_url": "",
     "models": ["claude-sonnet-4-6", "claude-opus-4-8"], "needs_key": True,
     "note": "Anthropic 原生非 /chat/completions;需经 LiteLLM 或兼容代理,base_url 填代理地址"},
    {"id": "custom", "name": "自定义", "base_url": "", "models": [], "needs_key": True,
     "note": "任意 OpenAI 兼容端点,手动填 base_url 与 model"},
]
