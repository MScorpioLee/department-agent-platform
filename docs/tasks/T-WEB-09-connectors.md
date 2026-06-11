# T-WEB-09:插件/连接器管理页(管理员,MCP)

> 执行者:Codex。前置:T-WEB-02(登录)。**只允许改动 `web/`。**
> 后端 M10 已就绪。对标 Codex 的"插件市场":管理员配置外部 MCP server,其工具自动进 Agent 可用集。

## 1. 目标

`/admin/connectors` 页(仅 admin,复用 `AdminGuard`):增删改外部连接器(MCP server)、设作用域(谁能用)、看连接状态与工具数。

## 2. 后端 API 契约(已冻结,均需 admin)

```text
GET    /api/admin/connectors
  → [{id,name,transport,command,args,url,env_keys,enabled,scope_all,scopes,status,tool_count,created_at}]
     status ∈ "connected" | "error: ..." | "disabled" | "unknown";env 只回 key 名(env_keys),不回值

POST   /api/admin/connectors
  {name, transport:"stdio"|"http", command?, args?:[], url?, env?:{KEY:VAL}, scope_all?:bool}
PATCH  /api/admin/connectors/{id}   {任意子集;env 提供才覆盖}
DELETE /api/admin/connectors/{id}   → {deleted}
PUT    /api/admin/connectors/{id}/scope   {user_ids:[...]}     # 授权给哪些用户(scope_all=false 时)
GET    /api/users   (已有)  → 选授权用户
```

要点:
- **env 单向**:GET 只回 `env_keys`(key 名);新建/编辑时由你**发明文 env 字典**,服务端加密存。
- 改动后端会**热加载**(重连 MCP),返回里 `status` 反映连接结果。
- `scope_all=true` 全员可用;否则按 `scope` 用户白名单。

## 3. 页面

### 连接器列表
- 表格:名称、传输(stdio/http)、command 或 url、**状态徽章**(connected 绿 / error 红 + 悬停看原因 / disabled)、工具数、作用域(全员 / N 个用户)、启用开关。
- 删除、编辑、设作用域。

### 新建连接器表单
- name、transport(stdio/http)。
- stdio:command(如 `npx`)+ args(如 `["-y","@modelcontextprotocol/server-github"]`,可多行/标签输入)。
- http:url。
- env:key-value 列表(如 `GITHUB_TOKEN=xxx`)。
- 作用域:全员开关,或选用户(`/api/users`)。
- **醒目安全提示**:"连接器会在服务端运行你提供的第三方程序,仅管理员可配置,请确认来源可信"(对应供应链风险)。

## 4. Mock 模式

`MOCK_API=1`:内置 1-2 个假连接器(status=connected,tool_count>0,env_keys 示例),可增删改、设作用域。

## 5. 验收标准

1. admin 能新建/编辑/删除连接器,列表显示连接状态与工具数
2. **env 值全程不回显**(只见 env_keys);新建带 env 能成功
3. 能设作用域(全员 / 指定用户)
4. 有安全提示;非 admin 无入口、直达显示无权限
5. `pnpm build` 通过;`MOCK_API=1` 全流程可走;既有测试全绿;仅改 `web/`

## 6. 明确不做

GitHub 市场浏览/一键导入(后续)、连接器工具的实时调试、技能(M11)。
