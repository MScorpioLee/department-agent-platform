# Agent CLI(终端客户端)

终端里的**瘦客户端**——agent loop 与机器队列都在 Server,CLI 只负责登录、对话(终端流式)、审批。
对标 Hermes / Codex CLI / Claude Code 的形态,但本平台是多机、可审计的中心化服务,CLI 只是一张脸。

## 安装

```bash
cd cli
uv venv .venv
uv pip install -e .
```

## 用法

```bash
.venv/bin/agent login http://192.168.1.10:8700   # 登录(token 存 ~/.agent-cli/config.json,0600)
.venv/bin/agent machines                            # 列机器(在线状态/工具数)
.venv/bin/agent chat -m win-notebook                # 对话:模型驱动该机器,工具调用+命令输出实时流在终端
.venv/bin/agent approvals                           # 看待审批(高危命令)
.venv/bin/agent approve <id>                        # 批准
.venv/bin/agent whoami / logout
```

对话里直接输入自然语言任务;模型决定调工具,命令的 stdout 实时滚动显示;命中高危会提示需审批。
凭据、审批、归属、审计都在 Server 统一管,CLI 不做任何安全决策。
