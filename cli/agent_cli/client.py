"""Agent Server 的瘦客户端:登录、机器、对话(流式)、审批。直连 REST + /ws/client。"""

import asyncio
import json

import httpx
import websockets


class ApiError(Exception):
    pass


class AgentClient:
    def __init__(self, server_url: str, token: str | None = None) -> None:
        self.server_url = server_url.rstrip("/")
        self.token = token

    def _headers(self) -> dict:
        return {"Authorization": f"Bearer {self.token}"} if self.token else {}

    async def _request(self, method: str, path: str, **kw) -> dict | list:
        async with httpx.AsyncClient(timeout=kw.pop("timeout", 30)) as http:
            resp = await http.request(method, f"{self.server_url}{path}", headers=self._headers(), **kw)
        if resp.status_code >= 400:
            try:
                err = resp.json().get("error", {})
                raise ApiError(f"{resp.status_code} {err.get('code','')}: {err.get('message','')}")
            except (ValueError, AttributeError):
                raise ApiError(f"{resp.status_code}: {resp.text[:200]}")
        return resp.json() if resp.text else {}

    async def login(self, username: str, password: str) -> dict:
        return await self._request("POST", "/api/auth/login", json={"username": username, "password": password})

    async def logout(self) -> None:
        try:
            await self._request("POST", "/api/auth/logout")
        except ApiError:
            pass

    async def me(self) -> dict:
        return await self._request("GET", "/api/auth/me")

    async def machines(self) -> list:
        return await self._request("GET", "/api/machines")

    async def create_session(self, machine_id: str, title: str | None = None) -> dict:
        return await self._request("POST", "/api/sessions", json={"machine_id": machine_id, "title": title})

    async def approvals(self) -> list:
        return await self._request("GET", "/api/approvals", params={"status": "pending"})

    async def approve(self, approval_id: str) -> dict:
        return await self._request("POST", f"/api/approvals/{approval_id}/approve")

    async def reject(self, approval_id: str) -> dict:
        return await self._request("POST", f"/api/approvals/{approval_id}/reject")

    async def send_and_stream(self, session_id: str, content: str, on_event) -> None:
        """发消息并经 /ws/client 实时接收事件;每个事件回调 on_event(dict)。"""
        ticket = (await self._request("POST", "/api/ws-ticket"))["ticket"]
        ws_url = (
            self.server_url.replace("http://", "ws://").replace("https://", "wss://")
            + f"/ws/client?ticket={ticket}"
        )
        async with websockets.connect(ws_url) as ws:
            await ws.send(json.dumps({"type": "subscribe", "session_id": session_id}))
            await ws.recv()  # subscribed

            async def post():
                async with httpx.AsyncClient(timeout=180) as http:
                    await http.post(
                        f"{self.server_url}/api/sessions/{session_id}/messages",
                        headers=self._headers(),
                        json={"content": content},
                    )

            poster = asyncio.create_task(post())
            try:
                while True:
                    ev = json.loads(await ws.recv())
                    on_event(ev)
                    if ev.get("type") in ("turn_done", "turn_error"):
                        break
            finally:
                await poster
