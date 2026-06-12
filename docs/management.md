# 管理面设计:模型 / 机器能力 / 插件(连接器)/ 技能

> 设计文档(未实现)。术语对齐 Codex:**插件 = 外部服务连接器(MCP)**、**技能 = 任务能力包**;
> 另有平台独有的**机器能力**(Runner 在目标机器上的工具)。协议/安全以 protocol.md / security.md 为准。

## 0. 统一图景:一个大脑 + 三层能力

```
                     Agent(大脑 ← 【模型管理】)
                              │ 决定调用工具
        ┌─────────────────────┼─────────────────────┐
   【机器能力】            【插件 / 连接器】          【技能】
   Runner 在目标机器上      服务端经 MCP 连外部服务     任务能力包(可启停)
   exec/file/git/node…     Slack/Notion/GitHub/Web…   封装连接器+提示词的预设
   本地的手脚              外部的手脚                  打包好的"一键能力"
```

工具暴露公式:
```
(机器能力工具 ∪ 已连接插件工具 ∪ 已启用技能工具) ∩ 用户权限 ∩ 会话/技能作用域
```
Agent Loop 按来源路由:机器工具 → 下发 Runner;插件/技能工具 → 调对应 MCP server(服务端)。

## 1. 模型管理(配大脑)

**现状**:`models.yaml` 文件 + 重启。**目标**:DB 化 + admin API + 管理页,热生效。
- `model_backends`(name,base_url,model,api_key_enc,max_concurrency,enabled)+ `user_model_routes`。
- **api_key 加密存(`AGENT_SECRET_KEY`),API 永不回显明文**(GET 脱敏)。models.yaml 首次导入为初始数据。
- API:`/api/admin/models` CRUD + `/test` 连通性 + `/api/admin/model-routes`。
- 量:中(Claude server + Codex UI)。

## 2. 机器能力(Runner 工具,平台独有)

**现状**:Runner 硬编码 5 个工具上报。**目标**:Runner 插件式加载,工具 schema 动态上报。
- 内置 `exec`/`file`;可选 `git`/`node`/`python`/`docker` 等,各声明结构化工具(如 `git_status`)。
- **安全不变量**:机器能力只来自 **Runner 本地配置**,服务器**不可远程启用**(同 allowed_roots)。UI 只读可见;启停由机器所有者本地改,或"管理员申请→所有者批准"。
- 量:中高(动协议:hello 带 tool schema)。这是"控制真机"层,与下面的外部连接器是两回事。

## 3. 插件 / 连接器(外部 MCP,= Codex 的"插件")

**定义**:连接外部服务的 **MCP server**,其工具纳入 Agent 可用集,**服务端执行**(不碰目标机器)。
例:Slack、Notion、GitHub、Google、Web 搜索、数据库。

### 形态(对标 Codex 截图)
- **市场**:可搜索/分类/精选的连接器列表;每个有「连接」按钮。
- **已连接**:展示已连接的服务图标 + 「管理」。
- **连接 = 配置一个 MCP server**(stdio 子进程 / 远程 HTTP-SSE)+ 其凭据(OAuth 或 API key)。

### 从 GitHub / 包生态导入(不手搓)
- 多数 MCP server 以 **npm/pypi 包**(npx/uvx 启动)或 **git 仓库**发布,直接导入而非自己写。
- 导入 = 登记一个启动方式(`npx @scope/mcp-server-x` / `uvx mcp-x` / `git+commit` + 启动命令)+ 其凭据。

### ⚠ 供应链安全(MCP 连接器在服务端跑第三方代码,红线)
- **仅管理员可导入**;导入是**显式信任**动作。
- **版本钉死**(commit hash / tag),**不自动更新**(防 repo 被投毒后自动拉到恶意版本)。
- **沙箱化运行** MCP 子进程:专用低权限账号 + 资源/网络限制 + 只注入其自身配置的凭据,
  **隔离平台主密钥、数据库、其它机器**(同"Runner 低权限账号"原则)。
- 审计导入来源与每次工具调用;输出脱敏 + 速率限制;高危照旧风险标记/审批。

### 数据模型
- `connectors`(id,name,kind=mcp,transport=stdio|http,launch_spec,source_ref,pinned_version,auth_enc,enabled,created_at)
- `connector_scopes`(connector_id,user_id|role)——谁能用

### 后端
- Agent Server 内置 **MCP client**:连上 server(沙箱子进程或远程)→ 拉取其 tools → 注册进工具表。
- Agent Loop 路由:tool_call 命中连接器工具 → 调对应 MCP server,结果回填。

### 量:高(MCP client + 路由 + 凭据 + 鉴权审计)。这是平台"破圈到机器之外"的关键。

### 实现状态(M10)
- ✅ 已实现:MCP client(stdio/http,按操作开会话)、子进程 **env 隔离**、工具命名空间 `mcp__<连接器>__<工具>`、
  Agent Loop 路由、按用户作用域、admin API(CRUD+scope,env 加密不回显,热加载)、真实 MCP 集成测试。UI=T-WEB-09/12(交 Codex)。
- ✅ 加固(M10-b):**每连接器审批开关** `require_approval`(命中→走既有审批流,批准后服务端执行并落 ToolCall 审计)、
  **连接/调用超时**(connector_connect/call_timeout_seconds)、**输出上限**(output_cap_bytes,超长截断标记 truncated)。
- ✅ 沙箱(部署层,deploy/):server 容器=沙箱边界——非 root 账号 + cap_drop ALL + no-new-privileges +
  pids/mem/cpu 限制 + 容器内置 npx/uvx;AGENT_SECRET_KEY 进 .env。
- ✅ 市场一键导入:GET /api/admin/connector-registry 代理 **MCP 官方注册表**搜索,翻译成钉死版本的
  连接器配置(npm→npx pkg@ver / pypi→uvx pkg==ver / streamable-http remote);UI=T-WEB-14(交 Codex)。

## 4. 技能(能力包,= Codex 的"技能")

**定义**:可**启用/禁用**的任务专用能力包——把"若干工具/连接器 + 系统提示词 + 作用域"打包成一键能力。
例:Browser(网页操作)、文档生成、翻译、代码审查流程。

### 形态(对标 Codex 截图)
- 列表 + 勾选启停;分"个人/推荐";可搜索。
- 技能 = 预设:`{name, 描述, 依赖的连接器/机器能力, system_prompt 片段, 作用域}`。
- 启用某技能 = 在会话里追加其提示词 + 放开其工具。

### 从 GitHub 导入(可自由导入,因为是声明式)
- 技能仓库 = **声明式清单**(`skill.yaml`/`SKILL.md`:name、描述、system_prompt、依赖的工具/连接器、作用域)。
- **纯声明式不执行代码 → 从 GitHub 导入是安全的**(导入即解析清单 + 登记预设)。
- 例外:若某"技能"携带可执行脚本 / 内嵌 MCP server,则**按连接器对待**,走上面的供应链管控。

### 数据模型
- `skills`(id,name,description,prompt,source_ref,enabled)+ `skill_tools`(skill_id→tool/connector)+ `skill_scopes`。

### 后端
- 会话发起时:把已启用且有权的技能的提示词与工具并入本轮 Agent 上下文。
- 技能本身不新增执行通道——它复用机器能力/连接器,只是**打包 + 引导 + 限定作用域**(故声明式技能本身无供应链风险,风险只在它引用的连接器)。

### 量:中(建立在连接器之上;主要是预设管理 + 上下文组装)。

## 5. 分期建议

| 期 | 内容 | 谁 | 量 |
|---|---|---|---|
| M8 | 模型管理 | Claude server + Codex UI | 中 |
| M9 | 机器能力(Runner 插件化) | Claude runner/server + Codex UI | 中高 |
| M10 | 插件/连接器(MCP client + 市场 + 凭据 + 鉴权审计) | Claude server + Codex UI | 高 |
| M11 | 技能(能力包,建立在 M10 之上) | Claude server + Codex UI | 中 |

顺序 **M8 → M10 → M11 → M9**(也可):先配大脑,再接外部 MCP 连接器(用户最想要的"插件市场"),再做技能包,机器能力插件化可后置。

## 6. 安全不变量补充
- 机器能力只认 Runner 本地配置,服务器不可远程启用(同 allowed_roots)。
- 模型/连接器凭据一律加密存、API 不回显明文。
- 连接器/技能默认关闭、按用户授权、审计 + 高危审批照旧适用;MCP 工具调用同样脱敏 + 限速。
- **供应链(从 GitHub 导入)**:声明式技能可自由导入;**可执行的连接器/MCP 仅管理员导入、版本钉死、
  不自动更新、沙箱低权限运行、隔离平台密钥与数据**。导入即"在服务端跑第三方代码",按最高警惕对待。


## M13:形态对齐——服务端=API 中转站,客户端=本地 Agent(类 Claude Code)

### 服务端(中转站,已实现)
- `POST /v1/chat/completions`、`GET /v1/models`:OpenAI 兼容端点;认证=个人 API Key(`ak_…`,哈希存储,
  明文仅创建时一次)或登录 token;模型由**按用户路由**决定(忽略请求里的 model);用量入 ModelUsage 审计。
- Key 自助管理:`/api/me/api-keys`(建/列/吊销)。第三方工具把 base_url 指到本服务即可接入。
- 暂不支持 stream(后续)。UI=T-WEB-16。

### 客户端(本地 Agent,已实现)
- `agent code`:在**当前目录**跑 Agent Loop(类 Claude Code/Codex CLI)——本地执行命令/读写文件,
  模型走服务端 /v1 中转(本地不存模型密钥)。
- 安全:工具路径 realpath 锁定在启动目录内;**每条命令终端确认**(`--yes` 跳过);输出截断。
- `--once "任务"` 单次模式。与 Runner 远程托管模式并存:`agent chat -m 机器` 管别的机器,`agent code` 管自己脚下。
