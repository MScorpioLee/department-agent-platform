"""预设 Provider 目录:给"添加 Provider"提供现成选项(OpenAI 兼容端点),用户选了自动填地址,只填 key。

参考 Hermes Studio 的 Provider 列表。全部是 OpenAI 兼容的 /chat/completions 端点;
非兼容的(如 Anthropic 原生)注明需经 LiteLLM/代理。base_url 不含末尾 /chat/completions。
"""

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
