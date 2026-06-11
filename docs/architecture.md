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

## 模型网关(多后端 + 用户路由)

平台不绑定单一模型来源。网关把每个上游抽象成一个 **backend**:

```text
ModelBackend = { id, base_url, model, api_key, max_concurrency }
```

backend 底层可以是:
- **Hermes proxy / OpenClaw 等 OAuth 代理**:把 Claude Pro / ChatGPT(Codex)/ SuperGrok 订阅暴露成本地 OpenAI 兼容端点(`http://localhost:port/v1`)。开发期可用,**不作为生产基础设施**(厂商可能封禁订阅计费、违反 ToS、稳定性靠逆向维持)。
- **合规 API key**:Anthropic / OpenAI / DeepSeek 等,生产推荐。
- **本地模型**:Ollama / LiteLLM。

对上层统一为 `base_url + token`,所以三类可**混用**,切换只改配置。

### 用户路由与共享配额

- `user → backend` 映射由管理员分配(静态绑定最利于审计归集;池化轮询省订阅但归集变糊)。
- 多个用户可映射到**同一个 backend**(多对一):一个 OAuth 订阅能被多客户端并发使用。
- 但**并发可用 ≠ 配额翻倍**:共享 backend = 共享上游配额池(订阅的速率/消息上限),会一起撞限流。Agent Loop 是放大器(一次任务可能十几次模型往返),容量须按**并发会话数**而非人头估算。
- 网关因此内置:**per-backend 并发闸 + 队列**、对上游 **429/限流自动退避重试**、`model_usage` 按 backend 聚合以便观察各订阅余量。
- 成本说明:订阅制下只能审计"调用次数 / token / 归属 backend",**无法分摊到每次调用的金额**(无单价)。

## 技术栈

- Server:Python 3.11+、FastAPI、SQLAlchemy 2.x、PostgreSQL(开发期 SQLite)、WebSocket、LiteLLM Proxy
- Runner:Python 3.11+(websockets、httpx、pydantic、pyyaml);正式版可换 Go 单文件
- Web:Next.js、React、Tailwind、shadcn/ui、Monaco、xterm.js
- 模型 ID 以各厂商当前版本为准(如 `claude-sonnet-4-6`、`claude-opus-4-8`;OpenAI 侧以实际发布的 Codex/GPT 模型 ID 为准),写入配置而非硬编码

## 客户端形态(多端)

同一套 REST + WS 契约服务所有客户端;客户端只做展示与交互,**不做任何安全决策**(权限、审批、路径校验全部在 Server / Runner 侧)。

- **WebUI**(Next.js)— 第一优先级(M4,任务卡 T-WEB-01)
- **桌面客户端**(Windows / macOS / Linux)— Tauri 2 壳复用 `web/` 的同一 React 前端,增加系统托盘、任务完成通知、凭据存 OS keychain。**排在用户系统(M4)之后**:分发到员工电脑的客户端必须使用按用户登录的会话凭据,不允许内置共享 API Key(任务卡 T-DESK-01)
- **CLI / 终端客户端** — 终端里的 agent 客户端(形态对标 Hermes / Codex CLI / Claude Code / Aider)。
  **关键:它是 Server 的瘦客户端,不是独立 agent**——agent loop 与机器队列都在 Server,CLI 只负责:
  登录(token 存本地配置/keychain)、对话(经 `/ws/client` 在终端流式展示工具调用与命令输出)、
  处理审批、以及模型/连接器/技能的管理子命令(走 admin API)。建议 Python(httpx + websockets,与 runner 同语言),
  先做交互式 REPL,后续可上 TUI(Textual/rich)。
- **移动端** — 远期,同一 API,暂不排期

为支撑多端复用,前端的 API 访问必须收敛到单一传输层模块(见 T-WEB-01 约定),桌面端只替换传输层(Next 代理 → 直连 Server)。
CLI 与桌面端一样直连 Server REST + WS(不经 Next 代理),用一次性票据开 `/ws/client`。

> 与 Hermes 等的区别:那些是"本地独立 agent";本平台把大脑、机器队列、审计、审批、归属都放在 Server,
> 所有客户端(Web/Desktop/CLI)都是薄客户端。这是本平台的定位差异(部门级、多机、可审计),不要把 CLI 做成又一个本地 agent。
