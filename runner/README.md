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

安全模型见 [../docs/security.md](../docs/security.md):Runner 建议以专用低权限账号运行;
allowed_roots / blocked_paths 仅来自本地配置。
