# T-WEB-02:WebUI 登录与按用户鉴权

> 执行者:Codex。前置:T-WEB-01 已完成。**只允许改动 `web/`。**
> 后端认证已就绪(server M4),本卡只改前端;如发现契约不符,在 PR 描述中列出,不要改后端。

## 1. 目标

给控制台加登录,把传输层从「服务端注入 X-API-Key」改成「用户登录拿 token、按用户鉴权」。
登录后用户只看到归属自己的机器(后端已自动过滤,前端无需改列表逻辑)。

## 2. 后端 API 契约(已冻结)

```text
POST /api/auth/login   {username, password}
  → 200 {token:"at_...", user:{id, username, display_name, role}}
  → 401 {error:{code:"invalid_credentials", message:"..."}}

GET  /api/auth/me      (需要 Authorization: Bearer <token>)
  → 200 {id, username, display_name, role}
  → 401 {error:{code:"unauthorized", message:"..."}}
```

登录后,对 `/api/machines`、`/api/tasks`、`/api/sessions` 等的请求带 `Authorization: Bearer <token>` 即按该用户归属返回;响应结构与 T-WEB-01 完全一致(`/api/machines` 多了一个 `owner_user_id` 字段,可忽略或展示)。

## 3. 认证改造方案(关键,务必照此实现)

**token 绝不暴露给浏览器 JS**,用 httpOnly cookie 承载:

1. 新增 Route Handler `POST /api/auth/login`(`web/app/api/auth/login/route.ts`):
   - 接收前端表单的 {username, password},服务端转发到 `${AGENT_API_BASE}/api/auth/login`。
   - 成功:把返回的 `token` 写入 **httpOnly + SameSite=Lax + Secure(生产)** 的 cookie(如 `agent_token`),响应体只回 `{user}`,不回 token。
   - 失败:透传 401 与 error。
2. 新增 `POST /api/auth/logout`:清除该 cookie。
3. 改造代理 `web/app/api/proxy/[...path]/route.ts`:
   - 从 cookie 读 `agent_token`,注入 `Authorization: Bearer <token>`;**移除 X-API-Key 注入**。
   - 无 cookie 时对受保护接口返回 401(让前端跳登录)。
4. `web/lib/api-client.ts` 增加 `login(username,password)` / `logout()` / `getMe()`;其余调用不变(仍走 `/api/proxy`)。

> 安全要点:`AGENT_API_KEY` 在本卡完成后不再用于普通请求(可保留给后续管理脚本);浏览器侧任何地方都不应出现 token 或 API Key。

## 4. 页面与交互

- `/login`:用户名 + 密码表单,提交调 `/api/auth/login`;失败显示 `error.message`;成功跳 `/machines`。
- **未登录保护**:在受保护页面(`/machines`、`/console`)挂载时调 `getMe()`,401 则 `router.replace('/login')`(或用 middleware 统一拦截)。
- 顶部导航(`components/app-shell.tsx`)右上角显示当前用户 `display_name`(调 `getMe()`)+「登出」按钮(调 logout 后跳 `/login`)。

## 5. Mock 模式(沿用 T-WEB-01 约定)

`MOCK_API=1` 时:`/api/auth/login` 任意非空账号密码通过,返回假 `{user:{id:"u_mock",username:输入值,display_name:输入值,role:"user"}}` 并设 cookie;`getMe` 返回该假用户;logout 清 cookie。机器/任务接口沿用原 mock。

## 6. 验收标准

1. 未登录直接访问 `/machines` → 跳转 `/login`
2. 错误密码 → 登录页显示可读错误;正确 → 进入 `/machines`
3. 浏览器 DevTools 的 Application/Storage 与 Network 中**看不到 token、看不到 X-API-Key**(token 仅在 httpOnly cookie)
4. 顶部显示当前用户名,点「登出」回到 `/login` 且再次访问受保护页被拦截
5. `pnpm build` 通过、无 TS 错误;`MOCK_API=1` 下全流程可走通
6. 仅改动 `web/`

## 7. 明确不做(后续卡)

注册页、管理员的用户管理 UI、enrollment token 签发 UI、机器分配 UI、token 刷新/续期(本期 7 天有效,过期重登)。
