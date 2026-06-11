"""Runner 客户端:注册、连接、心跳、任务执行与幂等缓存。协议见 docs/protocol.md。"""

import asyncio
import json
import logging
from collections import OrderedDict

import httpx
import websockets

from . import tools
from .config import RunnerConfig, load_state, save_state
from .plugins import build_registry
from .secure_path import PathDenied, PathPolicy

log = logging.getLogger("agent_runner")

RESULT_CACHE_SIZE = 200  # 幂等:缓存最近任务结果,重复 task_id 直接重发


class Runner:
    def __init__(self, cfg: RunnerConfig, state_path: str) -> None:
        self.cfg = cfg
        self.state_path = state_path
        self.policy = PathPolicy(cfg.allowed_roots, cfg.blocked_paths)
        # 按本地配置启用的插件构建工具注册表(服务器不能远程改)
        self.registry = build_registry(cfg.plugins)
        self.machine_id = ""
        self.runner_token = ""
        self.results_cache: OrderedDict[str, dict] = OrderedDict()
        self.cancel_events: dict[str, asyncio.Event] = {}
        self._bg: set[asyncio.Task] = set()

    # ---------- 注册 ----------

    async def ensure_enrolled(self) -> None:
        state = load_state(self.state_path)
        if state:
            self.machine_id = state["machine_id"]
            self.runner_token = state["runner_token"]
            return
        if not self.cfg.enrollment_token:
            raise RuntimeError("尚未注册且配置中没有 enrollment_token")
        async with httpx.AsyncClient() as http:
            r = await http.post(
                f"{self.cfg.server_url}/api/runners/enroll",
                headers={"Authorization": f"Bearer {self.cfg.enrollment_token}"},
                json={
                    "machine_name": self.cfg.machine_name,
                    "os": __import__("sys").platform,
                    "runner_version": "0.1.0",
                },
            )
        r.raise_for_status()
        data = r.json()
        save_state(self.state_path, data["machine_id"], data["runner_token"])
        self.machine_id = data["machine_id"]
        self.runner_token = data["runner_token"]
        log.info("注册成功 machine_id=%s", self.machine_id)

    # ---------- 主循环 ----------

    async def main(self) -> None:
        await self.ensure_enrolled()
        backoff = 1.0
        while True:
            try:
                await self._connect_once()
                backoff = 1.0
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                log.warning("连接断开: %r,%.0f 秒后重连", exc, backoff)
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 60.0)

    async def _connect_once(self) -> None:
        ws_url = self.cfg.server_url.replace("http://", "ws://").replace("https://", "wss://") + "/ws/runner"
        async with websockets.connect(
            ws_url, additional_headers={"Authorization": f"Bearer {self.runner_token}"}
        ) as ws:
            await ws.send(
                json.dumps(
                    {
                        "protocol_version": 1,
                        "type": "hello",
                        "machine_id": self.machine_id,
                        "runner_version": "0.1.0",
                        "capabilities": list(self.registry),  # 工具名(向后兼容)
                        "tools": [t.schema() for t in self.registry.values()],  # 工具名+描述+schema(动态)
                        "allowed_roots": self.cfg.allowed_roots,
                    }
                )
            )
            try:
                ack = json.loads(await ws.recv())
            except websockets.ConnectionClosed as exc:
                if exc.code == 4426:  # 协议版本不兼容
                    raise RuntimeError(f"协议版本不兼容,请升级 Runner: {exc.reason}") from exc
                raise
            if ack.get("type") != "hello_ack":
                raise RuntimeError(f"非预期的握手响应: {ack}")
            log.info("已连接 %s", ws_url)

            heartbeat = asyncio.create_task(self._heartbeat_loop(ws))
            try:
                async for raw in ws:
                    frame = json.loads(raw)
                    self._handle_frame(ws, frame)
            finally:
                heartbeat.cancel()
                for task in self._bg:
                    task.cancel()

    async def _heartbeat_loop(self, ws) -> None:
        while True:
            await ws.send(
                json.dumps(
                    {
                        "protocol_version": 1,
                        "type": "heartbeat",
                        "machine_id": self.machine_id,
                        "status": "busy" if self.cancel_events else "idle",
                        "running_task_ids": list(self.cancel_events),
                    }
                )
            )
            await asyncio.sleep(self.cfg.heartbeat_interval_seconds)

    # ---------- 任务处理 ----------

    def _handle_frame(self, ws, frame: dict) -> None:
        ftype = frame.get("type")
        if ftype == "task":
            task = asyncio.ensure_future(self._run_task(ws, frame))
            self._bg.add(task)
            task.add_done_callback(self._bg.discard)
        elif ftype == "task_cancel":
            event = self.cancel_events.get(frame.get("task_id"))
            if event is not None:
                event.set()
        else:
            log.warning("未知帧类型: %s", ftype)

    async def _run_task(self, ws, frame: dict) -> None:
        task_id = frame.get("task_id")
        if not task_id:
            return
        # 幂等:已完成的重复任务直接重发缓存结果;执行中的重复下发忽略
        cached = self.results_cache.get(task_id)
        if cached is not None:
            await ws.send(json.dumps(cached))
            return
        if task_id in self.cancel_events:
            return

        await ws.send(json.dumps({"protocol_version": 1, "type": "task_accepted", "task_id": task_id}))
        cancel_event = asyncio.Event()
        self.cancel_events[task_id] = cancel_event
        seqs = {"stdout": 0, "stderr": 0}

        async def emit(stream: str, data: str) -> None:
            await ws.send(
                json.dumps(
                    {
                        "protocol_version": 1,
                        "type": "task_output",
                        "task_id": task_id,
                        "stream": stream,
                        "seq": seqs[stream],
                        "data": data,
                    }
                )
            )
            seqs[stream] += 1

        tool = frame.get("tool")
        payload = frame.get("payload") or {}
        try:
            tool_def = self.registry.get(tool)
            if tool_def is None:
                raise tools.ToolError("tool_not_supported", f"本机未启用该工具: {tool}")
            if tool_def.kind == "exec":
                status, result = await tool_def.handler(self.policy, payload, emit, cancel_event)
            else:
                result = await asyncio.to_thread(tool_def.handler, self.policy, payload)
                status = "completed"
        except PathDenied as exc:
            status, result = "failed", {"error_code": "path_denied", "error_message": str(exc)}
        except tools.ToolError as exc:
            status, result = "failed", {"error_code": exc.code, "error_message": exc.message}
        except Exception as exc:  # 工具内部错误不能拖垮连接
            log.exception("任务 %s 执行异常", task_id)
            status, result = "failed", {"error_code": "internal_error", "error_message": repr(exc)}
        finally:
            self.cancel_events.pop(task_id, None)

        message = {
            "protocol_version": 1,
            "type": "task_result",
            "task_id": task_id,
            "status": status,
            "result": result,
        }
        self.results_cache[task_id] = message
        while len(self.results_cache) > RESULT_CACHE_SIZE:
            self.results_cache.popitem(last=False)
        await ws.send(json.dumps(message))
