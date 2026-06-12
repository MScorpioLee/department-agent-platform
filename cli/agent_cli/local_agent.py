"""本地 Agent 模式(类 Claude Code / Codex CLI):Agent Loop 跑在用户自己的机器上。

工具(执行命令/读写文件)只作用于启动时的工作目录(realpath 锁定),模型调用走
服务端 OpenAI 兼容中转 /v1(服务端管 key/路由/配额/审计,本地不存模型密钥)。
每条命令执行前在终端确认(--yes 跳过);目录外路径一律拒绝。
"""

import asyncio
import json
import os
import subprocess

OUTPUT_CAP = 30_000  # 单次工具输出进入上下文的上限(字符)
MAX_STEPS = 12

TOOLS = [
    {"type": "function", "function": {
        "name": "run_command",
        "description": "在工作目录执行 shell 命令,返回 stdout/stderr/exit_code",
        "parameters": {"type": "object", "properties": {
            "command": {"type": "string", "description": "要执行的命令"}},
            "required": ["command"]},
    }},
    {"type": "function", "function": {
        "name": "read_file",
        "description": "读工作目录内的文本文件",
        "parameters": {"type": "object", "properties": {
            "path": {"type": "string", "description": "相对工作目录的路径"}},
            "required": ["path"]},
    }},
    {"type": "function", "function": {
        "name": "write_file",
        "description": "写工作目录内的文本文件(覆盖;自动建父目录)",
        "parameters": {"type": "object", "properties": {
            "path": {"type": "string"}, "content": {"type": "string"}},
            "required": ["path", "content"]},
    }},
    {"type": "function", "function": {
        "name": "list_files",
        "description": "列工作目录(或其子目录)的文件",
        "parameters": {"type": "object", "properties": {
            "path": {"type": "string", "description": "相对路径,默认 ."}}},
    }},
]


def _cap(text: str) -> str:
    if len(text) <= OUTPUT_CAP:
        return text
    return text[:OUTPUT_CAP] + f"\n…(截断,共 {len(text)} 字符)"


class LocalExecutor:
    """工具执行器:所有路径 realpath 后必须在 root 之下;命令执行前回调审批。"""

    def __init__(self, root: str, approve=None):
        self.root = os.path.realpath(root)
        # approve(command) -> bool;默认拒绝(交互模式由 CLI 注入终端确认)
        self.approve = approve or (lambda command: False)

    def _resolve(self, path: str) -> str | None:
        full = os.path.realpath(os.path.join(self.root, path or "."))
        if full != self.root and not full.startswith(self.root + os.sep):
            return None
        return full

    async def __call__(self, name: str, args: dict) -> dict:
        try:
            return await asyncio.to_thread(self._dispatch, name, args or {})
        except Exception as exc:
            return {"error_code": "tool_failed", "error_message": repr(exc)}

    def _dispatch(self, name: str, args: dict) -> dict:
        if name == "run_command":
            command = str(args.get("command") or "")
            if not command:
                return {"error_code": "payload_invalid", "error_message": "command 不能为空"}
            if not self.approve(command):
                return {"error_code": "denied", "error_message": "用户拒绝执行该命令"}
            proc = subprocess.run(
                command, shell=True, cwd=self.root, capture_output=True, text=True, timeout=120
            )
            return {"exit_code": proc.returncode,
                    "stdout": _cap(proc.stdout), "stderr": _cap(proc.stderr)}
        if name == "read_file":
            full = self._resolve(str(args.get("path") or ""))
            if full is None:
                return {"error_code": "path_denied", "error_message": "路径不在工作目录内"}
            with open(full, encoding="utf-8", errors="replace") as f:
                return {"content": _cap(f.read())}
        if name == "write_file":
            full = self._resolve(str(args.get("path") or ""))
            if full is None:
                return {"error_code": "path_denied", "error_message": "路径不在工作目录内"}
            os.makedirs(os.path.dirname(full) or self.root, exist_ok=True)
            content = str(args.get("content") or "")
            with open(full, "w", encoding="utf-8") as f:
                f.write(content)
            return {"written": len(content)}
        if name == "list_files":
            full = self._resolve(str(args.get("path") or "."))
            if full is None:
                return {"error_code": "path_denied", "error_message": "路径不在工作目录内"}
            return {"entries": sorted(os.listdir(full))[:200]}
        return {"error_code": "unknown_tool", "error_message": f"未知工具 {name}"}


async def chat_via_relay(server_url: str, token: str, messages: list, tools: list) -> dict:
    import httpx

    async with httpx.AsyncClient(timeout=180) as http:
        resp = await http.post(
            f"{server_url.rstrip('/')}/v1/chat/completions",
            headers={"Authorization": f"Bearer {token}"},
            json={"messages": messages, "tools": tools},
        )
    if resp.status_code >= 400:
        try:
            err = resp.json().get("error", {})
            raise RuntimeError(f"{resp.status_code} {err.get('code', '')}: {err.get('message', '')}")
        except (ValueError, AttributeError):
            raise RuntimeError(f"{resp.status_code}: {resp.text[:200]}")
    return resp.json()


async def run_turn(server_url: str, token: str, messages: list, executor) -> str:
    """单轮:模型 ↔ 本地工具循环,就地推进 messages,返回最终文字回复。"""
    for _ in range(MAX_STEPS):
        completion = await chat_via_relay(server_url, token, messages, TOOLS)
        msg = completion["choices"][0]["message"]
        calls = msg.get("tool_calls") or []
        messages.append({"role": "assistant", "content": msg.get("content") or "",
                         "tool_calls": calls or None})
        if not calls:
            return msg.get("content") or ""
        if msg.get("content"):
            print(f"\n{msg['content']}")
        for call in calls:
            fn = call.get("function", {})
            name = fn.get("name", "")
            try:
                args = json.loads(fn.get("arguments") or "{}")
            except ValueError:
                args = {}
            brief = args.get("command") or args.get("path") or ""
            print(f"  → {name}({str(brief)[:80]})")
            result = await executor(name, args)
            status = "✗ " + str(result.get("error_message")) if result.get("error_code") else "✓"
            print(f"    {status}")
            messages.append({"role": "tool", "tool_call_id": call.get("id", ""),
                             "content": json.dumps(result, ensure_ascii=False)})
    return "(已达最大步数,本轮中止)"


def system_prompt(root: str) -> str:
    import platform

    return (
        f"你是本地编码 Agent,工作目录 {root}(OS: {platform.system()})。"
        "通过工具在该目录内读写文件、执行命令完成用户任务;路径都相对工作目录,"
        "目录外不可访问。完成后用中文简要说明做了什么。"
    )


async def run_local_agent(server_url: str, token: str, auto_yes: bool = False, once: str | None = None) -> None:
    root = os.getcwd()

    def approve(command: str) -> bool:
        if auto_yes:
            print(f"  ⚡ 自动批准: {command[:100]}")
            return True
        try:
            return input(f"  ⚠ 执行命令: {command[:200]}\n    允许?[y/N] ").strip().lower() == "y"
        except EOFError:
            return False

    executor = LocalExecutor(root, approve=approve)
    messages = [{"role": "system", "content": system_prompt(root)}]
    print(f"本地 Agent(类 Claude Code)· 工作目录 {root} · 模型经服务端中转\n输入任务,exit 退出")

    while True:
        task = once or input("\n> ").strip()
        if not task or task in ("exit", "quit"):
            if once:
                return
            if not task:
                continue
            return
        messages.append({"role": "user", "content": task})
        try:
            reply = await run_turn(server_url, token, messages, executor)
            print(f"\n{reply}")
        except RuntimeError as exc:
            print(f"✗ 模型调用失败: {exc}")
        if once:
            return
