# 架构设计

## 核心架构

```text
 WebUI (Next.js)
   │  REST (X-API-Key → 后续会话认证)
   │  WS /ws/client(实时:任务状态、流式输出、模型流式回复)
   ▼
 Agent Server (FastAPI)
   ├─ 用户/权限/审批
   ├─ Agent Loop(自研:模型 tool-call → 权限检查 → 下发 → 结果回填 → 再调模型)
   ├─ 模型网关(LiteLLM Proxy / OpenAI-compatible)
   ├─ 审计与用量统计(PostgreSQL;开发期 SQLite)
   ▼
 Runner Gateway(WS /ws/runner,runner_token 认证)
   ▼
 Runner Client(员工电脑/测试机,专用低权限账号运行)
   ├─ 本地安全策略(realpath + allowed_roots/blocked_paths,本地配置,不可远程放宽)
   └─ 工具执行:exec / read / write / patch / list
```

两条实时通道是独立的:浏览器侧 `/ws/client`(M3–M4)与 Runner 侧 `/ws/runner`(M1)。

## Server 职责

登录与权限、会话存档、模型调用、Agent 循环与工具调度、任务状态机、审计日志、用量统计、Runner 连接管理。

## Runner 职责

主动连接并认证、上报能力、本地安全检查(权威在本地)、执行工具、流式回传输出、结果幂等缓存。

## Agent Loop(自研,不引入重框架)

```text
while True:
    resp = model.chat(messages, tools=exposed_tools)
    if no tool_call: break
    for call in resp.tool_calls:
        权限检查 → 风险标记/审批 → 下发 Runner → 等待结果(含流式转发) → 审计落库
        messages.append(tool_result)
```

核心就是这个循环,几十行可控代码;上下文裁剪(旧工具输出截断)在 M3 实现。

## 动态工具暴露

```text
目标机器能力 ∩ 用户权限 ∩ 会话策略 ∩ Runner 本地策略
```

## 技术栈

- Server:Python 3.11+、FastAPI、SQLAlchemy 2.x、PostgreSQL(开发期 SQLite)、WebSocket、LiteLLM Proxy
- Runner:Python 3.11+(websockets、httpx、pydantic、pyyaml);正式版可换 Go 单文件
- Web:Next.js、React、Tailwind、shadcn/ui、Monaco、xterm.js
- 模型 ID 以各厂商当前版本为准(如 `claude-sonnet-4-6`、`claude-opus-4-8`;OpenAI 侧以实际发布的 Codex/GPT 模型 ID 为准),写入配置而非硬编码
