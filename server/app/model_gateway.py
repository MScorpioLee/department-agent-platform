"""模型网关:多 backend 注册、用户路由、per-backend 并发闸与 429 退避。

backend 底层可以是 Hermes/OpenClaw 这类 OAuth 代理(开发期),也可以是合规 API key 或本地模型;
对上层统一为 OpenAI 兼容的 /chat/completions 接口。设计见 docs/architecture.md「模型网关」。
"""

import asyncio
import logging
from dataclasses import dataclass

import httpx

log = logging.getLogger("agent_runner.gateway")


@dataclass
class ModelBackend:
    id: str
    base_url: str  # OpenAI 兼容根,如 http://127.0.0.1:11500/v1
    model: str
    api_key: str = "x"  # OAuth 代理通常忽略此值,填占位即可
    max_concurrency: int = 2


class ModelError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


class ModelGateway:
    def __init__(
        self,
        backends: list[ModelBackend],
        user_routes: dict[str, str] | None = None,
        default_backend_id: str | None = None,
    ) -> None:
        self.backends = {b.id: b for b in backends}
        self.user_routes = user_routes or {}
        self.default_backend_id = default_backend_id or (backends[0].id if backends else None)
        # per-backend 并发闸:多用户共享一个订阅时,限制同时打到上游的请求数
        self._sems = {b.id: asyncio.Semaphore(b.max_concurrency) for b in backends}

    def resolve(self, user_id: str | None = None) -> ModelBackend:
        backend_id = self.user_routes.get(user_id or "", self.default_backend_id)
        if not backend_id or backend_id not in self.backends:
            raise ModelError("no_backend", "没有可用的模型后端,请检查网关配置")
        return self.backends[backend_id]

    async def chat(
        self,
        backend: ModelBackend,
        messages: list[dict],
        tools: list[dict] | None = None,
        *,
        timeout: float = 120.0,
        max_retries: int = 4,
    ) -> dict:
        """调用上游 /chat/completions,返回解析后的 JSON。429/限流自动退避重试。"""
        payload: dict = {"model": backend.model, "messages": messages}
        if tools:
            payload["tools"] = tools
            payload["tool_choice"] = "auto"

        sem = self._sems.get(backend.id) or asyncio.Semaphore(1)
        delay = 1.0
        async with sem:
            for attempt in range(max_retries):
                try:
                    async with httpx.AsyncClient(timeout=timeout) as http:
                        resp = await http.post(
                            f"{backend.base_url.rstrip('/')}/chat/completions",
                            headers={"Authorization": f"Bearer {backend.api_key}"},
                            json=payload,
                        )
                except httpx.HTTPError as exc:
                    raise ModelError("upstream_unreachable", f"无法连接模型后端: {exc}") from exc

                if resp.status_code == 429 or resp.status_code >= 500:
                    if attempt < max_retries - 1:
                        retry_after = resp.headers.get("retry-after")
                        wait = float(retry_after) if retry_after and retry_after.isdigit() else delay
                        log.warning("backend %s 限流/错误 %s,%.1fs 后重试", backend.id, resp.status_code, wait)
                        await asyncio.sleep(wait)
                        delay = min(delay * 2, 30.0)
                        continue
                    raise ModelError("rate_limited", f"模型后端持续 {resp.status_code},已达重试上限")

                if resp.status_code >= 400:
                    raise ModelError("upstream_error", f"模型后端返回 {resp.status_code}: {resp.text[:300]}")
                return resp.json()

        raise ModelError("rate_limited", "模型后端持续限流")


def build_gateway(config: dict | None) -> ModelGateway:
    """从配置字典构造网关。config 形如:
    {"backends": [{"id","base_url","model","api_key","max_concurrency"}],
     "user_routes": {"user_id": "backend_id"}, "default_backend_id": "..."}
    """
    config = config or {}
    backends = [ModelBackend(**b) for b in config.get("backends", [])]
    return ModelGateway(backends, config.get("user_routes"), config.get("default_backend_id"))
