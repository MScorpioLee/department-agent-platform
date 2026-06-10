import asyncio

import pytest

from agent_runner import tools
from agent_runner.secure_path import PathDenied, PathPolicy


@pytest.fixture
def work(tmp_path):
    (tmp_path / "work").mkdir()
    return tmp_path / "work"


@pytest.fixture
def policy(work):
    return PathPolicy([str(work)])


async def _noop_emit(stream, data):
    pass


# ---------- remote_exec ----------


async def test_exec_basic(policy, work):
    chunks = []

    async def emit(stream, data):
        chunks.append((stream, data))

    status, result = await tools.remote_exec(
        policy, {"workdir": str(work), "command": "echo hello"}, emit, asyncio.Event()
    )
    assert status == "completed"
    assert result["exit_code"] == 0
    assert "hello" in result["stdout_tail"]
    assert any(s == "stdout" and "hello" in d for s, d in chunks)
    assert result["duration_ms"] >= 0


async def test_exec_nonzero_exit(policy, work):
    status, result = await tools.remote_exec(
        policy, {"workdir": str(work), "command": "exit 3"}, _noop_emit, asyncio.Event()
    )
    assert status == "completed"
    assert result["exit_code"] == 3


async def test_exec_timeout(policy, work):
    status, result = await tools.remote_exec(
        policy,
        {"workdir": str(work), "command": "sleep 30", "timeout_seconds": 0.3},
        _noop_emit,
        asyncio.Event(),
    )
    assert status == "timeout"
    assert result["exit_code"] is None


async def test_exec_cancel(policy, work):
    cancel = asyncio.Event()

    async def trigger():
        await asyncio.sleep(0.2)
        cancel.set()

    trigger_task = asyncio.create_task(trigger())
    status, _ = await tools.remote_exec(
        policy, {"workdir": str(work), "command": "sleep 30"}, _noop_emit, cancel
    )
    await trigger_task
    assert status == "cancelled"


async def test_exec_workdir_outside_denied(policy, tmp_path):
    with pytest.raises(PathDenied):
        await tools.remote_exec(
            policy, {"workdir": str(tmp_path), "command": "echo x"}, _noop_emit, asyncio.Event()
        )


# ---------- 文件工具 ----------


def test_write_read_roundtrip(policy, work):
    w = tools.remote_write_file(policy, {"path": str(work / "f.txt"), "content": "第一行\n第二行\n"})
    assert w["bytes_written"] > 0
    assert w["sha256_before"] is None

    r = tools.remote_read_file(policy, {"path": str(work / "f.txt")})
    assert r["content"] == "第一行\n第二行\n"
    assert r["total_lines"] == 2
    assert r["sha256"] == w["sha256_after"]


def test_read_offset_limit(policy, work):
    tools.remote_write_file(policy, {"path": str(work / "n.txt"), "content": "1\n2\n3\n4\n5\n"})
    r = tools.remote_read_file(policy, {"path": str(work / "n.txt"), "offset": 2, "limit": 2})
    assert r["content"] == "2\n3\n"
    assert r["total_lines"] == 5


def test_read_binary_rejected(policy, work):
    (work / "bin.dat").write_bytes(b"\x00\x01\x02")
    with pytest.raises(tools.ToolError) as exc:
        tools.remote_read_file(policy, {"path": str(work / "bin.dat")})
    assert exc.value.code == "binary_file"


def test_patch_basic(policy, work):
    tools.remote_write_file(policy, {"path": str(work / "p.txt"), "content": "const a = 1;\n"})
    r = tools.remote_patch_file(
        policy, {"path": str(work / "p.txt"), "old_string": "a = 1", "new_string": "a = 2"}
    )
    assert r["changed"] is True
    assert r["replacements"] == 1
    assert "-const a = 1;" in r["diff"] and "+const a = 2;" in r["diff"]
    assert tools.remote_read_file(policy, {"path": str(work / "p.txt")})["content"] == "const a = 2;\n"


def test_patch_not_unique(policy, work):
    tools.remote_write_file(policy, {"path": str(work / "u.txt"), "content": "x\nx\n"})
    with pytest.raises(tools.ToolError) as exc:
        tools.remote_patch_file(policy, {"path": str(work / "u.txt"), "old_string": "x", "new_string": "y"})
    assert exc.value.code == "old_string_not_unique"

    r = tools.remote_patch_file(
        policy, {"path": str(work / "u.txt"), "old_string": "x", "new_string": "y", "replace_all": True}
    )
    assert r["replacements"] == 2


def test_patch_not_found(policy, work):
    tools.remote_write_file(policy, {"path": str(work / "nf.txt"), "content": "abc\n"})
    with pytest.raises(tools.ToolError) as exc:
        tools.remote_patch_file(policy, {"path": str(work / "nf.txt"), "old_string": "zzz", "new_string": "y"})
    assert exc.value.code == "old_string_not_found"


def test_list_files(policy, work):
    (work / "sub").mkdir()
    (work / "a.txt").write_text("x")
    r = tools.remote_list_files(policy, {"path": str(work)})
    names = {e["name"]: e["type"] for e in r["entries"]}
    assert names["sub"] == "dir"
    assert names["a.txt"] == "file"
