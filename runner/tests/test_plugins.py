import asyncio

from agent_runner.plugins import DEFAULT_PLUGINS, build_registry


def test_default_registry_has_builtin_tools():
    reg = build_registry(None)
    assert set(reg) == {
        "remote_exec",
        "remote_read_file",
        "remote_write_file",
        "remote_patch_file",
        "remote_list_files",
    }
    # 每个工具都带可上报的 schema
    for tool in reg.values():
        s = tool.schema()
        assert s["name"] and "parameters" in s


def test_disable_exec_plugin():
    reg = build_registry(["file"])  # 不启用 exec
    assert "remote_exec" not in reg
    assert "remote_read_file" in reg


def test_optional_sysinfo_plugin():
    reg = build_registry(["exec", "file", "sysinfo"])
    assert "remote_sysinfo" in reg
    # 同步工具,直接调
    result = reg["remote_sysinfo"].handler(None, {})
    assert "os" in result and "hostname" in result


def test_unknown_plugin_ignored():
    reg = build_registry(["file", "nonexistent"])
    assert "remote_read_file" in reg


def test_exec_tool_kind():
    reg = build_registry(None)
    assert reg["remote_exec"].kind == "exec"
    assert reg["remote_read_file"].kind == "sync"
