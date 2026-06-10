"""五个远程工具的本地实现。所有涉路径操作必须经过 PathPolicy.resolve()。"""

import asyncio
import difflib
import hashlib
import locale
import time
from pathlib import Path
from typing import Awaitable, Callable

from .secure_path import PathPolicy

MAX_READ_BYTES = 2 * 1024 * 1024
OUTPUT_CAP_BYTES = 1024 * 1024
TAIL_BYTES = 8 * 1024
MAX_DIFF_CHARS = 64 * 1024
DEFAULT_TIMEOUT = 60.0
MAX_TIMEOUT = 600.0

# emit(stream, text) — 把输出分块回传给服务器
Emit = Callable[[str, str], Awaitable[None]]


class ToolError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _decode(data: bytes) -> str:
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError:
        # 中文 Windows 上子进程输出常为 GBK(cp936)
        return data.decode(locale.getpreferredencoding(False), errors="replace")


async def remote_exec(
    policy: PathPolicy, payload: dict, emit: Emit, cancel_event: asyncio.Event
) -> tuple[str, dict]:
    """返回 (status, result),status ∈ completed/timeout/cancelled。"""
    command = payload.get("command")
    if not command or not isinstance(command, str):
        raise ToolError("payload_invalid", "command 必填")
    workdir = policy.resolve(payload.get("workdir") or ".")
    if not workdir.is_dir():
        raise ToolError("payload_invalid", f"workdir 不是目录: {workdir}")
    timeout = min(float(payload.get("timeout_seconds") or DEFAULT_TIMEOUT), MAX_TIMEOUT)

    start = time.monotonic()
    proc = await asyncio.create_subprocess_shell(
        command,
        cwd=str(workdir),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )

    parts: dict[str, list[str]] = {"stdout": [], "stderr": []}
    sizes = {"stdout": 0, "stderr": 0}
    truncated = False

    async def pump(name: str, stream: asyncio.StreamReader) -> None:
        nonlocal truncated
        while True:
            chunk = await stream.read(8192)
            if not chunk:
                return
            room = OUTPUT_CAP_BYTES - sizes[name]
            if room <= 0:
                truncated = True
                continue  # 继续消费防止子进程因管道满而阻塞
            if len(chunk) > room:
                chunk = chunk[:room]
                truncated = True
            text = _decode(chunk)
            parts[name].append(text)
            sizes[name] += len(chunk)
            await emit(name, text)

    work = asyncio.gather(pump("stdout", proc.stdout), pump("stderr", proc.stderr), proc.wait())
    cancel_waiter = asyncio.ensure_future(cancel_event.wait())
    try:
        done, _ = await asyncio.wait({work, cancel_waiter}, timeout=timeout, return_when=asyncio.FIRST_COMPLETED)
        if work in done:
            status = "completed"
        else:
            status = "cancelled" if cancel_waiter in done else "timeout"
            proc.terminate()
            try:
                await asyncio.wait_for(proc.wait(), 5)
            except asyncio.TimeoutError:
                proc.kill()
            with_suppress = asyncio.gather(work, return_exceptions=True)
            await with_suppress
    finally:
        cancel_waiter.cancel()
        if not work.done():
            work.cancel()
            await asyncio.gather(work, return_exceptions=True)

    result = {
        "exit_code": proc.returncode if status == "completed" else None,
        "stdout_tail": "".join(parts["stdout"])[-TAIL_BYTES:],
        "stderr_tail": "".join(parts["stderr"])[-TAIL_BYTES:],
        "truncated": truncated,
        "duration_ms": int((time.monotonic() - start) * 1000),
    }
    return status, result


def _read_checked(path: Path) -> bytes:
    if not path.is_file():
        raise ToolError("payload_invalid", f"不是普通文件: {path}")
    if path.stat().st_size > MAX_READ_BYTES:
        raise ToolError("file_too_large", f"文件超过 {MAX_READ_BYTES} 字节上限")
    data = path.read_bytes()
    if b"\x00" in data[:8192]:
        raise ToolError("binary_file", "二进制文件拒绝读取")
    return data


def remote_read_file(policy: PathPolicy, payload: dict) -> dict:
    path = policy.resolve(payload.get("path") or "")
    data = _read_checked(path)
    text = _decode(data)
    lines = text.splitlines(keepends=True)
    offset = max(1, int(payload.get("offset") or 1))
    limit = max(1, int(payload.get("limit") or 500))
    return {
        "content": "".join(lines[offset - 1 : offset - 1 + limit]),
        "total_lines": len(lines),
        "sha256": _sha256(data),
    }


def remote_write_file(policy: PathPolicy, payload: dict) -> dict:
    content = payload.get("content")
    if not isinstance(content, str):
        raise ToolError("payload_invalid", "content 必须是字符串")
    path = policy.resolve(payload.get("path") or "", for_write=True)
    before = path.read_bytes() if path.exists() else None
    path.parent.mkdir(parents=True, exist_ok=True)
    data = content.encode("utf-8")
    path.write_bytes(data)
    return {
        "bytes_written": len(data),
        "sha256_before": _sha256(before) if before is not None else None,
        "sha256_after": _sha256(data),
    }


def remote_patch_file(policy: PathPolicy, payload: dict) -> dict:
    old = payload.get("old_string")
    new = payload.get("new_string")
    replace_all = bool(payload.get("replace_all"))
    if not isinstance(old, str) or not isinstance(new, str) or old == "" or old == new:
        raise ToolError("payload_invalid", "old_string/new_string 非法")
    path = policy.resolve(payload.get("path") or "")
    data = _read_checked(path)
    text = _decode(data)
    count = text.count(old)
    if count == 0:
        raise ToolError("old_string_not_found", "old_string 未找到")
    if count > 1 and not replace_all:
        raise ToolError("old_string_not_unique", f"old_string 出现 {count} 次,需 replace_all 或更长的唯一上下文")
    new_text = text.replace(old, new) if replace_all else text.replace(old, new, 1)
    diff = "".join(
        difflib.unified_diff(
            text.splitlines(keepends=True),
            new_text.splitlines(keepends=True),
            fromfile=path.name,
            tofile=path.name,
        )
    )
    new_data = new_text.encode("utf-8")
    path.write_bytes(new_data)
    return {
        "changed": True,
        "replacements": count if replace_all else 1,
        "diff": diff[:MAX_DIFF_CHARS],
        "sha256_before": _sha256(data),
        "sha256_after": _sha256(new_data),
    }


def remote_list_files(policy: PathPolicy, payload: dict) -> dict:
    path = policy.resolve(payload.get("path") or "")
    if not path.is_dir():
        raise ToolError("payload_invalid", f"不是目录: {path}")
    max_entries = min(int(payload.get("max_entries") or 500), 2000)
    entries = []
    for child in sorted(path.iterdir(), key=lambda p: p.name)[:max_entries]:
        st = child.lstat()
        kind = "link" if child.is_symlink() else "dir" if child.is_dir() else "file"
        entries.append({"name": child.name, "type": kind, "size": st.st_size})
    return {"entries": entries}


FILE_TOOLS = {
    "remote_read_file": remote_read_file,
    "remote_write_file": remote_write_file,
    "remote_patch_file": remote_patch_file,
    "remote_list_files": remote_list_files,
}
