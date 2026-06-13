# T-WEB-20:首次启动引导(空库时第一个注册者=管理员)

> 执行者:Codex。**只允许改动 `web/`。** 后端已就绪。
> 目标:消灭预置默认管理员口令——全新部署打开时,登录页变成「创建管理员账号」,首个注册者直接成为 admin。

## 1. 后端契约(已就绪)

```text
GET /api/auth/setup-status   (开放,无需登录)
  → {needs_setup: bool, allow_registration: bool}
     needs_setup=true 表示空库,下一个注册者将成为管理员

POST /api/register  {username, password, display_name?, note?}  (已有,新增 bootstrap 行为)
  - 空库时:创建的是 **管理员**(active,无需审批),返回 {status:"active", role:"admin", bootstrap:true, ...}
  - 非空库:普通用户(status:"pending",需审批,现有行为不变)

POST /api/auth/login  (已有)
```

## 2. 登录页改造(`/login`)

1. 页面加载时先调 `GET /api/auth/setup-status`。
2. **needs_setup=true(首次设置)**:
   - 整个页面切成「**首次设置 · 创建管理员账号**」模式:标题/文案点明这是建管理员;隐藏"登录"和"普通注册"切换;
     只有创建表单(用户名/密码/确认密码;display_name 可选)。
   - 提交 → `POST /api/register` → 返回 `bootstrap:true` → **直接用刚填的账号自动 `login`** → 进管理端。
     (后端 bootstrap 注册返回的是 active,不是 pending;所以可以立即登录,不用等审批。)
   - 友好提示:"这是该服务器的第一个账号,将成为管理员。"
3. **needs_setup=false(常规)**:维持现有「登录 / 注册」(注册=待审批)逻辑不变。
4. 桌面端(填服务器地址后)同样先查 setup-status——注意桌面端无代理,setup-status 也要能直连/经 Rust。
   > 桌面可复用现有 `desktopApiFetch`(走 Rust)或新增一个无 token 的 Rust 命令查 setup-status;
   > 与 `desktop_register` 同理(避免 webview CSP)。**这条若涉及 Rust,标注出来,我(Claude)来加 Rust 命令**,你先做 web 端。

## 3. Mock 模式

`MOCK_API=1`:`/api/auth/setup-status` 默认返回 `{needs_setup:false}`;
提供一个开关/特殊用户名(如服务器地址含 `setup`)模拟 `needs_setup:true` 以预览首次设置界面;
bootstrap 注册返回 `{status:"active", role:"admin", bootstrap:true}` 并能自动登录。

## 4. 验收标准

1. 空库(needs_setup=true)登录页显示「创建管理员」,提交后自动登录进管理端
2. 非空库维持现有 登录/注册(待审批)逻辑
3. `pnpm build` 通过;`MOCK_API=1` 可预览两种态;既有测试全绿;仅改 `web/`(桌面 Rust 部分标注给 Claude)

## 5. 明确不做

多管理员设置向导、找回密码、首次设置时配模型/机器(后续)。
