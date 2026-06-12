"""本地 Agent 执行器:目录锁定 / 命令审批 / 基本工具行为。"""

import asyncio

from agent_cli.local_agent import LocalExecutor


def run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


def test_path_locked_to_root(tmp_path):
    outside = tmp_path.parent / "outside.txt"
    outside.write_text("secret", encoding="utf-8")
    ex = LocalExecutor(str(tmp_path))
    assert run(ex("read_file", {"path": "../outside.txt"}))["error_code"] == "path_denied"
    assert run(ex("write_file", {"path": "/etc/evil", "content": "x"}))["error_code"] == "path_denied"
    assert run(ex("list_files", {"path": ".."}))["error_code"] == "path_denied"


def test_file_roundtrip_inside_root(tmp_path):
    ex = LocalExecutor(str(tmp_path))
    assert run(ex("write_file", {"path": "sub/a.txt", "content": "你好"}))["written"] == 2
    assert run(ex("read_file", {"path": "sub/a.txt"}))["content"] == "你好"
    assert "sub" in run(ex("list_files", {}))["entries"]


def test_command_requires_approval(tmp_path):
    denied = LocalExecutor(str(tmp_path))  # 默认 approve=拒绝
    assert run(denied("run_command", {"command": "echo hi"}))["error_code"] == "denied"

    approved = LocalExecutor(str(tmp_path), approve=lambda c: True)
    result = run(approved("run_command", {"command": "echo hi"}))
    assert result["exit_code"] == 0 and "hi" in result["stdout"]
    # 命令在工作目录执行
    pwd = run(approved("run_command", {"command": "pwd"}))
    import os
    assert pwd["stdout"].strip() == os.path.realpath(str(tmp_path))


def test_unknown_tool(tmp_path):
    ex = LocalExecutor(str(tmp_path))
    assert run(ex("nope", {}))["error_code"] == "unknown_tool"
