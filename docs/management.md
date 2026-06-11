# 管理面设计:模型 / 插件 / Skill(MCP)

> 设计文档(未实现)。回答"平台缺三块管理面"的规划:模型管理、插件管理、Skill(MCP 外部能力)管理。
> 协议/安全仍以 protocol.md / security.md 为准;本文定方向,落地时再拆任务卡。

## 0. 统一图景(三块是一条线)

Agent 能做什么 = **一个大脑 + 两副手脚**:

```
            ┌──────────────── Agent(大脑)────────────────┐
            │            模型来自【模型管理】                │
            └───────────────────┬───────────────────────────┘
                                │ 决定调用工具
              ┌─────────────────┴──────────────────┐
   本地的手脚(在目标机器上执行)        外部的手脚(在服务端/外部执行)
        【插件管理】                          【Skill / MCP 管理】
   remote_exec / git / node / python ...   web 搜索 / 数据库 / SaaS API ...
        由 Runner 提供                         由挂载的 MCP server 提供
```

- **模型管理** = 换/配大脑(哪个模型、给谁用)。
- **插件管理** = 扩展"**在目标机器上**能做什么"(Runner 侧,本地的手脚)。
- **Skill/MCP 管理** = 扩展"**在机器之外**能做什么"(服务端侧,外部的手脚)。

工具暴露公式升级为:
```
(机器插件工具 ∪ 已挂载的 Skill 工具) ∩ 用户权限 ∩ 会话策略 ∩ Runner 本地策略
```

Agent Loop 按工具来源路由:机器工具 → 下发 Runner;Skill 工具 → 调对应 MCP server。

---

## 1. 模型管理(最该先做,最具体)

**现状**:`server/models.yaml` 文件,启动时加载;加模型/改路由要改文件 + 重启。

**目标**:DB 存储 + admin API + 管理页,界面里增删改、分配用户、热生效。

### 数据模型
- `model_backends`(id, name, base_url, model, api_key_enc, max_concurrency, enabled, created_at)
- `user_model_routes`(user_id, backend_id)
- 设置项:default_backend_id

### 密钥处理(关键)
- api_key 是密钥:**DB 加密存**(服务端主密钥 `AGENT_SECRET_KEY`,Fernet/AES-GCM),或继续支持 `${ENV}` 引用。
- **API 永不回显明文 key**(GET 返回脱敏:`sk-…1234`)。
- 兼容:首次启动可从 `models.yaml` 导入为初始数据,之后 DB 为准。

### Admin API
```
GET    /api/admin/models                  → 列表(key 脱敏)
POST   /api/admin/models                   {name,base_url,model,api_key,max_concurrency}
PATCH  /api/admin/models/{id}              改属性/启停
DELETE /api/admin/models/{id}
POST   /api/admin/models/{id}/test         连通性测试(可选)
PUT    /api/admin/model-routes             {user_id, backend_id}
```
网关从 DB 读 + 支持热加载(改完不重启)。用量沿用 `/api/audit/usage`。

### 工作量 / 分工
- Server(Claude):DB 化网关 + 加密 + admin API + 热加载 —— 中。
- 前端(Codex):模型管理页(任务卡)。

---

## 2. 插件管理(扩展机器侧工具)

**现状**:Runner 把 5 个工具(exec/file)**硬编码**上报;server 的 `tool_specs.py` 也是硬编码;模型按机器 capabilities 裁剪。

**目标**:Runner 插件系统——插件提供工具,能力动态化,可按机器启用。

### 设计
- **插件 = 注册一组工具的模块**:内置 `exec`、`file`;可选 `git`、`node`、`python`、`docker`、`browser` 等,每个声明工具名 + JSON schema + 执行逻辑(更结构化,如 `git` 插件给 `git_status`/`git_commit` 而非裸 `remote_exec`)。
- Runner 从本地插件目录/配置加载,启用的插件的工具 union 后在 hello 上报(**含工具 schema**)。
- Server 的工具 schema 改为**动态**:来自 Runner 上报,而非 `tool_specs.py` 写死。

### 安全不变量(重要)
- **插件与 allowed_roots 同源**:只来自 **Runner 本地配置**,服务器**不能远程启用插件**(否则 server 被攻破即可给机器加能力)。
- 管理 UI 对插件是**只读可见**;启停由机器所有者本地改。需要的话做"管理员申请 → 机器所有者批准"流程(类比跨机器授权)。

### 工作量 / 分工
- Runner + Server(Claude):插件加载器 + 动态工具 schema 链路 —— 中高(动协议:hello 带 tool schema)。
- 前端(Codex):机器详情里展示插件/工具(只读)。

---

## 3. Skill 管理(MCP 外部能力)

**定义(已与用户对齐)**:Skill = 挂载的**外部 MCP server**,提供 Agent 可调的工具,**在服务端/外部执行**(不碰目标机器)。例:web 搜索、数据库查询、Jira/GitHub API、知识库。

### 设计
- **Skill = 一个 MCP server 连接**(stdio 子进程 或 HTTP/SSE)。Agent Server 作为 **MCP client** 连上去,把其工具纳入 Agent 可用工具集。
- **执行位置**:服务端(Agent Server 调 MCP),**不经 Runner**。这是 Agent 的"外部手脚",与机器工具并列。
- Agent Loop 路由:tool_call 命中机器工具 → 下发 Runner;命中 Skill 工具 → 调 MCP server。

### 数据模型
- `skills`(id, name, transport=stdio|http, command/url, env_enc, enabled, created_at)
- `skill_scopes`(skill_id, user_id | role)——谁能用哪个 skill

### 安全
- MCP skill 能力强(联网/调 API):**默认关闭、按用户/角色授权、全程审计**;高风险动作同样走风险标记/审批。
- skill 的密钥(MCP server 的 API key/env)同模型 key:加密存、不回显。
- 单独的输出脱敏与速率限制。

### 工作量 / 分工
- Server(Claude):MCP client 集成 + Agent Loop 工具路由 + skill 管理 API + 鉴权/审计 —— **高**(最重,但最能让平台"破圈"到机器控制之外)。
- 前端(Codex):Skill 管理页 + 会话里展示 skill 工具调用。

---

## 4. 分期建议

| 期 | 内容 | 主要谁做 | 量 |
|---|---|---|---|
| M8 | 模型管理(DB 化 + admin API + UI) | Claude server + Codex UI | 中 |
| M9 | 插件管理(Runner 插件系统 + 动态 schema + 只读 UI) | Claude runner/server + Codex UI | 中高 |
| M10 | Skill/MCP 管理(MCP client + 路由 + 管理 + 鉴权审计) | Claude server + Codex UI | 高 |

建议顺序 **M8 → M9 → M10**:先把"配大脑"做顺(最具体、立刻有感),再扩机器侧工具,最后接外部 MCP(最重、最有想象力)。

## 5. 对安全不变量的补充

- 插件来源只认 Runner 本地配置,服务器不可远程启用(同 allowed_roots)。
- 模型/skill 的密钥一律加密存、API 不回显明文。
- Skill(MCP)默认关闭、按用户授权、审计 + 高危审批照旧适用。
