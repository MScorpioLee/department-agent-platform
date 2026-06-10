# scripts/ 开发与验证脚本

## 一键启动本地全栈

```bash
scripts/dev_up.sh
```

拉起 **Server + Runner + WebUI**(连真实后端,不开 mock),Ctrl-C 停止全部。
首次会自动生成 `runner/config.yaml`(allowed_roots 指向 `~/agent-workspace`)。

启动后打开 **http://localhost:3000/machines**:
- 能看到本机 Runner 在线、capabilities
- 进 `/console` 选机器和工具,下发任务,看真实执行输出
- 目前走 `X-API-Key` 管理通道直接可用;Codex 完成 T-WEB-02 后会变成真实用户登录

可用环境变量覆盖:`AGENT_WORK_DIR`、`AGENT_API_KEY`、`AGENT_SERVER_PORT`、`AGENT_WEB_PORT`、
`AGENT_ADMIN_USERNAME/PASSWORD`。配置模型对话见 [../server/README.md](../server/README.md)。

前置依赖(各跑一次):
```bash
cd server && uv venv .venv && uv pip install -e '.[dev]'
cd runner && uv venv .venv && uv pip install -e '.[dev]'
cd web    && pnpm install        # 或 npm install
```

## 验证脚本(无需真实模型/订阅)

| 脚本 | 作用 |
|---|---|
| `e2e_smoke.py` | Server+Runner 真实进程:enroll→注册→心跳→五工具→越界拒绝→超时 |
| `e2e_agent.py` | + 假模型驱动:用户消息→模型调 remote_exec→真实执行→回填→回复 |
| `fake_model_server.py` | 最小 OpenAI 兼容假模型(被 e2e_agent.py 使用) |

```bash
server/.venv/bin/python scripts/e2e_smoke.py
server/.venv/bin/python scripts/e2e_agent.py
```
