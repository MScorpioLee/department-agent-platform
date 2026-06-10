# T-WEB-03:审计后台(管理员)

> 执行者:Codex。前置:T-WEB-02(登录)完成。**只允许改动 `web/`。**
> 仅管理员可见;后端 `/api/audit/*` 已就绪并已脱敏,前端只读展示。

## 1. 目标

给登录后的**管理员**一个审计后台:查看各用户/订阅的 token 用量、会话列表、工具调用与命令执行记录。
普通用户不显示入口。

## 2. 后端 API 契约(已冻结,均需 admin token)

```text
GET /api/audit/usage[?user_id=]
  → {total_tokens, by_user_backend:[{user_id,backend_id,prompt_tokens,completion_tokens,total_tokens,turns}]}

GET /api/audit/sessions[?user_id=&limit=]
  → [{session_id,user_id,machine_id,title,status,message_count,created_at}]

GET /api/audit/tool-calls[?session_id=&machine_id=&limit=]
  → [{id,session_id,machine_id,tool_name,arguments,result,status,created_at}]   (已脱敏)

GET /api/audit/commands[?machine_id=&limit=]
  → [{task_id,machine_id,command,status,exit_code,stdout,stderr,created_at}]      (已脱敏)
```

非管理员调用返回 403;前端据此隐藏入口并在 403 时提示无权限。

## 3. 页面

`/audit`(仅 `role==admin` 显示导航入口):

- **用量卡片/表**:总 token + 按 user×backend 的表格(prompt/completion/total/turns)。
- **会话表**:session 列表,可按 `user_id` 过滤;点一行展开该会话的工具调用(调 `/tool-calls?session_id=`)。
- **命令表**:remote_exec 记录,可按 `machine_id` 过滤;`stdout/stderr` 等宽字体折叠展示。
- 数据已脱敏,UI 无需再处理;时间用相对时间显示。

## 4. 权限与入口

- 用 `getMe()`(T-WEB-02 已实现)判断 `role`;非 admin 不渲染 `/audit` 导航项,直接访问则显示"需要管理员权限"。
- 所有请求复用既有 `/api/proxy`(已自动带用户 token)。

## 5. Mock 模式

`MOCK_API=1` 时为 `/api/audit/*` 提供少量假数据(2 用户、若干会话与命令),并把 mock 的 `getMe` 角色设为 `admin` 以便预览。

## 6. 验收标准

1. admin 登录后出现"审计"入口,普通用户没有
2. 用量表能显示按用户/backend 聚合的 token
3. 会话表可展开看工具调用;命令表能看到脱敏后的命令与输出
4. 非 admin 直接访问 `/audit` 显示无权限提示
5. `pnpm build` 通过;`MOCK_API=1` 全流程可走通
6. 仅改动 `web/`

## 7. 明确不做

导出、图表趋势、日志检索全文搜索、保留周期设置(后续)。
