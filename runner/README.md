# Agent Runner

## 安装与运行

```bash
cd runner
uv venv .venv
uv pip install -e '.[dev]'
cp config.example.yaml config.yaml   # 修改 server_url / machine_name / allowed_roots
.venv/bin/python -m agent_runner --config config.yaml
```

首次启动用 `enrollment_token` 注册,获得的 `machine_id` + `runner_token` 保存在
`runner_state.json`(0600)。之后启动不再需要 enrollment_token。

## 测试

```bash
.venv/bin/pytest -q
```

## 单文件可执行打包

macOS 实测构建:

```bash
cd runner
uv venv .venv
uv pip install -e '.[dev]'
.venv/bin/python build_binary.py --clean
./dist/agent-runner --config config.yaml --state runner_state.json
```

Windows / Linux 使用同一套 PyInstaller spec,在目标平台本机执行:

```bash
cd runner
uv venv .venv
uv pip install -e '.[dev]'
python build_binary.py --clean
```

输出文件:

- macOS / Linux:`dist/agent-runner`
- Windows:`dist/agent-runner.exe`

二进制入口只调用 `agent_runner.__main__.main`,参数保持与 `python -m agent_runner`
一致:`--config config.yaml --state runner_state.json`。构建流程不改变
`allowed_roots` / `blocked_paths` 的来源,仍只读取本地配置文件。

安全模型见 [../docs/security.md](../docs/security.md):Runner 建议以专用低权限账号运行;
allowed_roots / blocked_paths 仅来自本地配置。
