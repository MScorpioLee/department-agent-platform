# T-WEB-19:自助注册 + 管理员审批 UI(登录页注册 + 审批入口)

> 执行者:Codex。**只允许改动 `web/`。** 后端 M17 已就绪。
> 用户端(及 Web)登录页加「注册」;注册后置 pending,管理员审批通过才能登录。

## 1. 后端契约(已就绪)

```text
# 开放(无需登录):
POST /api/register  {username, password, display_name?, note?}
  → 200 {status:"pending", username, message}   # 不签发 token
  → 409 {code:"user_exists"} | 403 {code:"registration_disabled"}

# 登录(已有,新增态):
POST /api/auth/login
  → pending 用户:403 {code:"pending_approval", message:"账号待管理员审批…"}

# 管理员审批:
GET  /api/admin/registrations                      → [{id,username,display_name,note,status,created_at}]
POST /api/admin/registrations/{id}/approve         → {…status:"active"}
POST /api/admin/registrations/{id}/reject          → {rejected:id}   # 删除待审批,用户名释放

# 用户列表(已有,_user_out 新增 status/note/created_at 字段)
GET  /api/users
```

## 2. 登录页(`/login`,Web + 桌面/coder 共用)

- 「登录 / 注册」切换(Tab 或链接)。
- **注册表单**:用户名、密码、显示名(可选)、申请说明 note(可选)→ `POST /api/register`。
  - 成功:显示「✅ 注册已提交,等待管理员审批,通过后即可登录」,切回登录态。
  - 409 用户名占用 / 403 未开放注册:显示后端 message。
- 登录时若收到 `pending_approval`(403):显示「账号待审批」提示,而不是"密码错误"。
- 服务器地址:Web 端走代理无需填;**桌面端登录页已有服务器地址输入,沿用**(注册同样发到该服务器)。

## 3. 管理员审批入口

- `/admin/users` 页(或新 `/admin/registrations`):
  - 顶部「待审批注册」区:列出 pending(用户名 / 显示名 / 申请说明 note / 时间)+「通过」「拒绝」按钮。
  - 有待审批时给个数字角标提示。
  - 现有用户列表加 `status` 列(active/pending)。
- 通过 → 该用户消失出待审批区、进正式用户列表;拒绝 → 移除。

## 4. Mock 模式

`MOCK_API=1`:`/api/register` 返回 pending;`/api/admin/registrations` 返回 1-2 条假申请;
approve/reject 就地生效;登录 mock 可模拟一个 pending 账号返回 403 pending_approval。

## 5. 验收标准

1. 登录页能切到注册、提交后显示"待审批";pending 账号登录得到"待审批"而非"密码错误"
2. 管理员能看到待审批申请(含说明)、通过/拒绝;通过后该账号能登录
3. `pnpm build` 通过;`MOCK_API=1` 全流程可走;既有测试全绿;仅改 `web/`

## 6. 明确不做

邮箱验证 / 验证码 / 注册限流(部署层或后续)、自助改密、注册时选机器。
