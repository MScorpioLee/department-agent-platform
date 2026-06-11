"""会话事件总线 + WS 票据。

事件总线:进程内 per-session 发布/订阅,/ws/client 订阅后实时收到 turn/tool/output 事件。
WS 票据:浏览器用 httpOnly cookie 鉴权,JS 读不到 token、也无法跨源给 WS 设 Authorization;
故先经认证 REST 换一张短时一次性票据,再用 ?ticket= 打开 WS(标准做法)。
"""

import asyncio
import secrets
import time


class EventBus:
    def __init__(self) -> None:
        self._subs: dict[str, set[asyncio.Queue]] = {}

    def subscribe(self, session_id: str) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=1000)
        self._subs.setdefault(session_id, set()).add(q)
        return q

    def unsubscribe(self, session_id: str, q: asyncio.Queue) -> None:
        subs = self._subs.get(session_id)
        if subs is not None:
            subs.discard(q)
            if not subs:
                self._subs.pop(session_id, None)

    def has_subscribers(self, session_id: str) -> bool:
        return bool(self._subs.get(session_id))

    async def publish(self, session_id: str, event: dict) -> None:
        for q in list(self._subs.get(session_id, ())):
            try:
                q.put_nowait(event)
            except asyncio.QueueFull:
                pass  # 慢消费者丢弃,不阻塞产出


class TicketStore:
    """短时一次性票据:issue 后须在 ttl 秒内 consume 一次。"""

    def __init__(self, ttl_seconds: float = 30.0) -> None:
        self.ttl = ttl_seconds
        self._tickets: dict[str, tuple[str, float]] = {}

    def issue(self, user_id: str) -> str:
        ticket = "wst_" + secrets.token_urlsafe(24)
        self._tickets[ticket] = (user_id, time.monotonic() + self.ttl)
        return ticket

    def consume(self, ticket: str | None) -> str | None:
        if not ticket:
            return None
        item = self._tickets.pop(ticket, None)  # 一次性:取出即删
        if item is None:
            return None
        user_id, expires_at = item
        if time.monotonic() > expires_at:
            return None
        return user_id
