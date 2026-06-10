# Department Agent Platform 多端项目方案

> 目标：构建一个类似 Codex / Claude Code / Devin 的部门内部 AI Agent 平台。  
> 服务器统一保存对话、模型调用、工具调用、审计日志；客户端 Runner 安装在员工电脑上，负责执行服务器下发的命令、文件操作和任务。

---

> **注意:本文件是总体方案概览。协议细节以 [docs/protocol.md](docs/protocol.md) 为准,安全模型以 [docs/security.md](docs/security.md) 为准;本文协议/安全章节的示例如有冲突,以 docs/ 为准。**

## 1. 项目定位

本项目由两类软件组成：

### 1.1 服务器端 Agent Server

部署在部门内部服务器上，负责：

- 用户登录与权限管理
- 多模型接入与模型选择
- 对话管理与云端存档
- Agent 推理与工具调度
- Runner 连接管理
- 远程任务下发
- 工具调用日志
- 命令执行日志
- 文件修改记录
- Token / 成本统计
- 审计与监控后台

服务器可以理解为：

```text
Codex 云端大脑 + 模型网关 + 会话数据库 + 审计中心 + Runner 调度器
```

### 1.2 客户端 Runner Client

安装在员工电脑、测试机、构建机、内部服务器上，负责：

- 主动连接 Agent Server
- 注册本机信息
- 上报在线状态
- 上报本机能力、插件、工具
- 接收服务器下发的任务
- 在本机执行命令
- 读写和修改本机文件
- 调用本机插件
- 回传 stdout / stderr / exit code
- 回传文件 diff
- 执行本地安全策略

Runner 可以理解为：

```text
目标电脑上的受控执行器 / 手脚
```

---

## 2. 用户最终体验

用户打开 WebUI 或桌面客户端后：

```text
1. 登录账号
2. 选择模型
   - Claude
   - Codex
   - GPT
   - DeepSeek
   - Qwen
   - 本地模型
3. 选择执行目标
   - 我的电脑
   - 我的开发机
   - 部门测试机
   - 授权给我的同事电脑
   - 内部服务器
4. 输入任务
5. AI 通过远程工具控制目标电脑执行任务
6. 所有对话、命令、文件修改、模型用量保存到服务器
```

示例：

```text
模型：Claude Sonnet
目标机器：alice-laptop
工作目录：D:/projects/webapp
任务：帮我运行测试，分析失败原因，并修复代码。
```

执行流程：

```text
用户发消息
  ↓
服务器保存消息
  ↓
服务器调用所选模型
  ↓
模型决定调用 remote_exec / remote_read_file / remote_patch_file 等工具
  ↓
服务器检查权限
  ↓
服务器下发任务到目标 Runner
  ↓
Runner 在本机执行
  ↓
Runner 回传结果
  ↓
服务器继续调用模型
  ↓
任务完成并存档
```

---

## 3. 总体架构

```text
                       Claude / Codex / OpenAI / OpenRouter / 本地模型
                                           ↑
                                           │
                                  模型网关层
                         LiteLLM Proxy / OpenAI-compatible API
                                           ↑
                                           │
                                  Agent Server
        ┌──────────────────────────────────┼──────────────────────────────────┐
        │                                  │                                  │
    用户系统                           Agent 核心                         审计系统
 登录 / 权限 / 机器授权          对话 / 工具调度 / 模型调用          日志 / 命令 / 文件 / 用量
        │                                  │                                  │
        └──────────────────────────────────┼──────────────────────────────────┘
                                           │
                                     Runner Gateway
                              WebSocket / HTTPS / 任务队列
                                           │
        ┌──────────────────────────────────┼──────────────────────────────────┐
        │                                  │                                  │
 Alice 电脑 Runner                  Bob 电脑 Runner                   测试机 Runner
 本地执行任务                       本地执行任务                       共享执行环境
```

---

## 4. 核心设计原则

### 4.1 服务器负责“大脑”

服务器负责保存对话、调用模型、构建上下文、管理 Agent 循环、决定下一步工具调用、检查权限、记录审计日志、下发任务、汇总结果。

### 4.2 Runner 负责“手脚”

Runner 负责执行命令、读取文件、写入文件、Patch 文件、调用本机插件、上报本机能力、执行本地安全策略、回传执行结果。

### 4.3 工具调用必须结构化

不要让模型直接拼接 SSH 命令。应该使用结构化远程工具：

```json
{
  "tool": "remote_exec",
  "machine_id": "alice-laptop",
  "workdir": "D:/projects/app",
  "command": "npm test"
}
```

这样可以做到权限检查、操作审计、命令拦截、风险审批、日志存档、成本统计、后续查询。

### 4.4 默认只能控制自己的电脑

默认规则：

```text
用户只能控制自己名下的机器。
```

跨机器操作必须授权。

例如：

```text
Bob 授权 Alice 控制 bob-laptop
范围：D:/projects/team-app
有效期：2 小时
高风险操作需要 Bob 审批
```

---

## 5. 多模型设计

服务器统一管理模型。用户可以选择：

```text
Claude Sonnet
Claude Opus
Codex
GPT
DeepSeek
Qwen
本地模型
```

推荐使用 LiteLLM Proxy 或 OpenAI-compatible API 作为模型网关。

模型配置示例：

```yaml
models:
  claude-sonnet:
    display_name: Claude Sonnet
    provider: anthropic
    model: claude-sonnet-4-6

  codex:
    display_name: Codex
    provider: openai
    model: gpt-5.5-codex   # 以 OpenAI 实际发布的模型 ID 为准

  deepseek:
    display_name: DeepSeek Chat
    provider: deepseek
    model: deepseek-chat

  local-qwen:
    display_name: Local Qwen Coder
    provider: openai-compatible
    base_url: http://127.0.0.1:8000/v1
    model: qwen-coder
```

服务器负责隐藏真实 API Key、控制用户能使用哪些模型、统计 token、统计费用、限速、限额、fallback、记录模型调用日志。

---

## 6. 多端 Runner 设计

每台电脑可以根据自己的情况安装不同插件和能力。

### 6.1 前端开发电脑

```text
node
pnpm
playwright
chrome
vscode
git
```

### 6.2 后端开发电脑

```text
python
docker
postgres-client
redis-cli
git
```

### 6.3 机器学习电脑

```text
python
cuda
docker
huggingface
nvidia-smi
```

### 6.4 测试机 / 构建机

```text
git
docker
node
python
java
ci-tools
```

Runner 启动后上报能力：

```json
{
  "machine_id": "alice-laptop",
  "owner": "alice",
  "os": "windows",
  "runner_version": "0.1.0",
  "capabilities": [
    "remote_exec",
    "remote_read_file",
    "remote_write_file",
    "remote_patch_file",
    "git",
    "node",
    "python",
    "browser"
  ],
  "plugins": [
    "exec",
    "file",
    "git",
    "node",
    "python"
  ],
  "allowed_roots": [
    "D:/projects",
    "C:/Users/Alice/work"
  ]
}
```

模型可用工具由以下因素决定：

```text
目标机器能力 ∩ 用户权限 ∩ 当前会话策略 ∩ Runner 本地安全策略
```

---

## 7. 权限系统

权限判断维度：

```text
用户是否有权访问机器
用户是否有权使用该工具
目标路径是否在 allowed_roots 内
目标路径是否命中 blocked_paths
命令是否高风险
授权是否过期
是否需要审批
```

权限级别建议：

```text
view              只能查看机器状态
exec_limited      可以执行低风险命令
file_read         可以读取允许目录内文件
file_write        可以写入允许目录内文件
workspace_admin   可以完整操作指定工作区
machine_admin     可以管理机器和 Runner
```

授权示例：

```yaml
user: alice
machine: bob-laptop
permission: workspace_admin
allowed_roots:
  - D:/projects/team-app
expires_at: 2026-06-09T18:00:00
requires_approval:
  - delete
  - install
  - network_download
  - git_push
```

---

## 8. 安全设计

> **权威定义见 [docs/security.md](docs/security.md)**,核心结论:`remote_exec` 使文件路径限制无法成为安全边界;真正的边界是 Server 侧授权/审批 + Runner 专用低权限账号;命令黑名单只是审计/审批触发层。路径校验必须先 realpath 规范化。

### 8.1 基本原则

```text
默认最小权限
默认只能操作自己的机器
跨机器必须授权
每个 Runner 独立 token
每个用户独立账号
每个会话绑定用户、机器、模型、工作目录
所有操作必须审计
高风险操作必须审批
Runner 不使用管理员权限运行
服务器不能裸露公网
```

### 8.2 allowed_roots

Runner 只能访问允许目录：

```yaml
allowed_roots:
  - D:/projects
  - C:/Users/Alice/work
```

### 8.3 blocked_paths

Runner 禁止访问敏感目录：

```yaml
blocked_paths:
  - C:/Windows
  - C:/Program Files
  - C:/Users/Alice/.ssh
  - C:/Users/Alice/AppData
  - C:/Users/Alice/.aws
  - C:/Users/Alice/.config
```

### 8.4 高风险命令

以下命令需要拦截或审批：

```text
rm -rf
del /s
format
diskpart
reg delete
powershell -enc
curl | bash
Invoke-WebRequest | iex
读取 .ssh
读取 .env
读取浏览器 cookies
上传敏感目录
```

### 8.5 日志脱敏

日志可能包含 API key、password、token、cookie、.env、ssh key、客户数据、内部代码。

需要支持：

- secret redaction
- 敏感字段打码
- 日志访问权限
- 日志保存周期
- 审计日志不可被普通用户删除

---

## 9. Remote Tools 设计

第一版至少实现：

```text
remote_exec
remote_read_file
remote_write_file
remote_patch_file
remote_list_files
remote_upload_file
remote_download_file
```

### 9.1 remote_exec

```json
{
  "tool": "remote_exec",
  "machine_id": "alice-laptop",
  "workdir": "D:/projects/app",
  "command": "npm test",
  "timeout_seconds": 120
}
```

返回：

```json
{
  "exit_code": 1,
  "stdout": "...",
  "stderr": "...",
  "duration_ms": 5321
}
```

### 9.2 remote_read_file

```json
{
  "tool": "remote_read_file",
  "machine_id": "alice-laptop",
  "path": "D:/projects/app/src/index.ts",
  "offset": 1,
  "limit": 200
}
```

返回：

```json
{
  "content": "...",
  "total_lines": 350
}
```

### 9.3 remote_patch_file

```json
{
  "tool": "remote_patch_file",
  "machine_id": "alice-laptop",
  "path": "D:/projects/app/src/index.ts",
  "old_string": "const a = 1;",
  "new_string": "const a = 2;"
}
```

返回：

```json
{
  "changed": true,
  "diff": "- const a = 1;\n+ const a = 2;",
  "hash_before": "abc",
  "hash_after": "def"
}
```

---

## 10. 通信协议

> **已升级为 v1,权威定义见 [docs/protocol.md](docs/protocol.md)**:增加了 enrollment token / runner token 认证、流式输出(task_output)、任务取消、任务状态机与幂等、输出大小上限。以下示例仅作概念说明。

### 10.1 Runner 注册

Runner -> Server:

```json
{
  "type": "register",
  "machine_name": "alice-laptop",
  "os": "windows",
  "runner_version": "0.1.0",
  "capabilities": [
    "remote_exec",
    "remote_read_file",
    "remote_write_file"
  ]
}
```

Server -> Runner:

```json
{
  "type": "registered",
  "machine_id": "m_123"
}
```

### 10.2 心跳

Runner -> Server:

```json
{
  "type": "heartbeat",
  "machine_id": "m_123",
  "status": "idle",
  "current_task_id": null
}
```

### 10.3 执行任务

Server -> Runner:

```json
{
  "type": "task",
  "task_id": "t_001",
  "tool": "remote_exec",
  "payload": {
    "workdir": "D:/projects/app",
    "command": "npm test",
    "timeout_seconds": 120
  }
}
```

Runner -> Server:

```json
{
  "type": "task_result",
  "task_id": "t_001",
  "status": "completed",
  "result": {
    "exit_code": 1,
    "stdout": "test failed...",
    "stderr": "",
    "duration_ms": 5321
  }
}
```

---

## 11. 数据库表设计

建议使用 PostgreSQL。

核心表：

```text
users
machines
machine_permissions
sessions
messages
tool_calls
remote_commands
file_operations
model_usage
approvals
audit_events
```

### 11.1 users

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  display_name TEXT,
  role TEXT NOT NULL DEFAULT 'user',
  password_hash TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);
```

### 11.2 machines

```sql
CREATE TABLE machines (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT REFERENCES users(id),
  machine_name TEXT NOT NULL,
  hostname TEXT,
  os TEXT,
  arch TEXT,
  runner_version TEXT,
  status TEXT NOT NULL DEFAULT 'offline',
  last_seen_at TIMESTAMP,
  allowed_roots JSONB,
  blocked_paths JSONB,
  capabilities JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);
```

### 11.3 sessions

```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id),
  machine_id TEXT REFERENCES machines(id),
  model_id TEXT NOT NULL,
  workdir TEXT,
  title TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);
```

### 11.4 messages

```sql
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  session_id TEXT REFERENCES sessions(id),
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  metadata JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);
```

### 11.5 tool_calls

```sql
CREATE TABLE tool_calls (
  id TEXT PRIMARY KEY,
  session_id TEXT REFERENCES sessions(id),
  machine_id TEXT REFERENCES machines(id),
  tool_name TEXT NOT NULL,
  arguments_json JSONB,
  result_json JSONB,
  status TEXT NOT NULL,
  started_at TIMESTAMP,
  finished_at TIMESTAMP
);
```

---

## 12. 推荐项目目录

```text
ai agent/            # 本仓库根目录
  README.md
  docs/
    architecture.md
    protocol.md
    security.md
    roadmap.md

  server/
    app/
      main.py
      config.py
      database.py
      auth/
      users/
      machines/
      sessions/
      runners/
      tools/
      agent/
      permissions/
      audit/
    tests/
    pyproject.toml

  runner/
    runner.py
    config.example.yaml
    core/
      client.py
      executor.py
      policy.py
      secure_path.py
      capabilities.py
    plugins/
      exec/
      file/
      git/
    tests/
    pyproject.toml

  web/
    package.json
    app/
    components/
    lib/
```

---

## 13. 推荐技术栈

### Server

```text
Python 3.11+
FastAPI
PostgreSQL
SQLAlchemy / SQLModel
Alembic
Redis
WebSocket
LiteLLM Proxy
自研 Agent Loop(模型 tool-call → 权限检查 → 下发 → 回填循环,见 docs/architecture.md)
```

### Runner

MVP 阶段：

```text
Python 3.11+
websockets
httpx
pydantic
pyyaml
```

正式版可考虑：

```text
Go
单文件可执行
Windows Service
macOS LaunchAgent
Linux systemd service
```

### Web

```text
Next.js
React
Tailwind CSS
shadcn/ui
Monaco Editor
xterm.js
```

### 部署

```text
Docker Compose
PostgreSQL
Redis
LiteLLM Proxy
Agent Server
Web Frontend
Nginx / Caddy
```

---

## 14. MVP 开发范围

第一版不要做太大，先做最小闭环。

### Server MVP

```text
用户登录
机器注册
Runner WebSocket 连接
模型选择
创建会话
发送消息
保存 messages
调用模型
remote_exec
remote_read_file
remote_write_file
remote_patch_file
保存 tool_calls
保存 remote_commands
管理员查看日志
```

### Runner MVP

```text
读取配置
连接服务器
注册机器
心跳
执行 remote_exec
执行 remote_read_file
执行 remote_write_file
执行 remote_patch_file
allowed_roots 检查
blocked_paths 检查
回传结果
```

### WebUI MVP

```text
登录页
会话列表
模型选择
机器选择
工作目录输入
聊天窗口
工具调用展示
命令输出展示
管理员日志页
```

---

## 15. 开发里程碑

### Milestone 1：Runner 通信闭环

目标：服务器可以下发命令给 Runner，Runner 执行后回传结果。

验收：

```text
服务器下发 hostname
Runner 返回机器名
服务器下发 pwd / cd
Runner 返回当前目录
服务器下发 npm test
Runner 返回 stdout/stderr/exit_code
```

### Milestone 2：远程文件工具

目标：服务器可以安全读写 Runner 允许目录内文件。

验收：

```text
remote_read_file 可以读取文件
remote_write_file 可以写文件
remote_patch_file 可以修改文件
blocked_paths 无法访问
allowed_roots 外路径无法访问
```

### Milestone 3：模型对话闭环

目标：用户发消息，模型可以调用远程工具完成任务。

验收：

```text
用户：帮我运行测试并分析失败原因
系统自动调用 remote_exec npm test
模型根据输出解释失败原因
```

### Milestone 4：基础 WebUI

目标：用户可以在网页中选择模型和机器进行对话。

验收：

```text
可以登录
可以看到机器在线状态
可以选择模型
可以创建会话
可以聊天
可以看到工具调用结果
```

### Milestone 5：审计后台

目标：管理员可以查看所有对话、命令、工具调用。

验收：

```text
可以按用户查看会话
可以按机器查看命令
可以按时间搜索日志
可以查看模型 token 使用量
```

### Milestone 6：权限和授权

目标：支持跨机器授权和高风险操作审批。

验收：

```text
用户默认只能控制自己的机器
机器 owner 可以临时授权他人
高风险命令触发审批
审批通过后才执行
```

---

## 16. 第一阶段任务拆解

### Task 1：初始化项目目录

创建：

```text
server/
runner/
web/
docs/
```

创建基础文档：

```text
README.md
docs/architecture.md
docs/protocol.md
docs/security.md
docs/roadmap.md
```

### Task 2：实现 Runner 注册协议

Server：

```text
POST /api/runners/register
```

Runner：启动后请求注册，提交 machine_name、os、capabilities。

### Task 3：实现 WebSocket 心跳

Server：

```text
/ws/runner/{machine_id}
```

Runner：连接 WebSocket，每 10 秒发送 heartbeat。

### Task 4：实现 remote_exec

Server 下发：

```json
{
  "tool": "remote_exec",
  "payload": {
    "command": "hostname",
    "workdir": "."
  }
}
```

Runner 执行并返回：

```json
{
  "exit_code": 0,
  "stdout": "...",
  "stderr": ""
}
```

### Task 5：实现 remote_read_file

Runner 检查路径安全后读取文件。必须检查 allowed_roots、blocked_paths、文件大小限制、编码。

### Task 6：实现 remote_write_file

Runner 检查路径安全后写文件。记录 hash_before、hash_after、diff。

### Task 7：实现 remote_patch_file

支持 old_string、new_string、replace_all，生成 diff 并回传。

### Task 8：实现会话和消息存储

Server 保存 sessions、messages、tool_calls、remote_commands、file_operations。

### Task 9：接入模型

先通过 LiteLLM 或 OpenAI-compatible API 接入模型。模型调用时提供 remote tools。

### Task 10：实现 WebUI 聊天页面

页面包含模型选择、机器选择、工作目录输入、聊天窗口、工具调用时间线、命令输出面板。

---

## 17. 风险和注意事项

### 17.1 服务器权限过大

服务器可以调度多台电脑执行任务。

必须：强化服务器安全、使用 HTTPS、使用强认证、Runner token 可吊销、限制管理员权限、审计日志不可删除。

### 17.2 AI 执行危险命令

必须：命令风险检测、高危操作审批、allowed_roots、blocked_paths、普通用户权限运行 Runner。

### 17.3 敏感数据进入日志

必须：secret redaction、日志访问权限、日志保存周期、敏感路径禁止读取。

---

## 18. 最终产品形态

项目最终应成为：

```text
部门内部 AI Agent 平台
```

具备：

```text
多用户
多模型
多机器
多端 Runner
集中对话
集中审计
集中监控
本机执行
跨机器授权
插件化能力
```

一句话：

> 用户像使用 Codex 一样选择模型和目标电脑进行对话，服务器统一保存会话和日志，Runner 在授权机器上执行任务并回传结果。

---

## 19. 下一步建议

优先实现最小闭环：

```text
server 下发 remote_exec
runner 执行命令
runner 回传结果
server 保存日志
```

跑通后再接入：

```text
模型
WebUI
文件工具
权限
审批
插件
```

不要一开始做完整平台。第一阶段只证明：

```text
服务器能让目标电脑安全执行任务，并且所有过程可记录、可审计。
```
