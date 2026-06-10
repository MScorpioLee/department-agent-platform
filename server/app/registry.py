"""Runner 在线连接与运行中任务的输出缓冲。

状态的权威在数据库,这里只管理活的 WebSocket 连接和流式输出的内存缓冲。
"""

import asyncio
import time

from starlette.websockets import WebSocket


class OutputBuffer:
    """按 stream 聚合 task_output 分块;seq 去重,超过 cap 截断。"""

    def __init__(self, cap_bytes: int) -> None:
        self.cap = cap_bytes
        self._parts: dict[str, list[str]] = {"stdout": [], "stderr": []}
        self._sizes: dict[str, int] = {"stdout": 0, "stderr": 0}
        self._last_seq: dict[str, int] = {"stdout": -1, "stderr": -1}
        self.truncated = False

    def add(self, stream: str, seq: int, data: str) -> None:
        if stream not in self._parts or seq <= self._last_seq[stream]:
            return
        self._last_seq[stream] = seq
        room = self.cap - self._sizes[stream]
        if room <= 0:
            self.truncated = True
            return
        raw = data.encode("utf-8", errors="replace")
        if len(raw) > room:
            data = raw[:room].decode("utf-8", errors="ignore")
            self.truncated = True
        self._parts[stream].append(data)
        self._sizes[stream] += len(raw)

    def text(self, stream: str) -> str:
        return "".join(self._parts[stream])


class RunnerConn:
    def __init__(self, machine_id: str, ws: WebSocket) -> None:
        self.machine_id = machine_id
        self.ws = ws
        self.status = "idle"
        self.last_heartbeat = time.monotonic()
        self.send_lock = asyncio.Lock()


class RunnerHub:
    def __init__(self, output_cap_bytes: int) -> None:
        self._output_cap = output_cap_bytes
        self.conns: dict[str, RunnerConn] = {}
        self.buffers: dict[str, OutputBuffer] = {}
        # task_id → Future:Agent Loop 下发任务后在此等待终态信号
        self.task_waiters: dict[str, asyncio.Future] = {}

    def is_online(self, machine_id: str) -> bool:
        return machine_id in self.conns

    async def attach(self, machine_id: str, ws: WebSocket) -> RunnerConn:
        old = self.conns.pop(machine_id, None)
        if old is not None:
            try:
                await old.ws.close(code=4409)  # 同机重复连接,踢掉旧连接
            except Exception:
                pass
        conn = RunnerConn(machine_id, ws)
        self.conns[machine_id] = conn
        return conn

    def detach(self, machine_id: str, ws: WebSocket) -> None:
        conn = self.conns.get(machine_id)
        if conn is not None and conn.ws is ws:
            del self.conns[machine_id]

    async def send(self, machine_id: str, frame: dict) -> bool:
        conn = self.conns.get(machine_id)
        if conn is None:
            return False
        try:
            async with conn.send_lock:
                await conn.ws.send_json(frame)
        except Exception:
            return False
        return True

    def open_buffer(self, task_id: str) -> OutputBuffer:
        buf = OutputBuffer(self._output_cap)
        self.buffers[task_id] = buf
        return buf

    def buffer(self, task_id: str) -> OutputBuffer | None:
        return self.buffers.get(task_id)

    def close_buffer(self, task_id: str) -> OutputBuffer:
        return self.buffers.pop(task_id, None) or OutputBuffer(self._output_cap)

    # ---- 任务等待(Agent Loop 同步下发用)----

    def expect(self, task_id: str) -> None:
        self.task_waiters[task_id] = asyncio.get_running_loop().create_future()

    def resolve(self, task_id: str) -> None:
        fut = self.task_waiters.pop(task_id, None)
        if fut is not None and not fut.done():
            fut.set_result(True)

    async def wait(self, task_id: str, timeout: float) -> bool:
        fut = self.task_waiters.get(task_id)
        if fut is None:
            return True
        try:
            await asyncio.wait_for(asyncio.shield(fut), timeout)
            return True
        except asyncio.TimeoutError:
            return False
        finally:
            self.task_waiters.pop(task_id, None)
