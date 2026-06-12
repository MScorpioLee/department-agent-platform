# T-WEB-18:Codex 订阅(per-user 登录)+ 我的模型登录页

> 执行者:Codex。前置:T-WEB-17(OAuth)。**只允许改动 `web/`。**
> 后端 M15 已就绪:模型后端可设 `auth_scope=per_user` + `runtime=codex_responses`,
> 每个用户用**自己的** ChatGPT/Codex 订阅设备码登录,令牌各自隔离,只用于自己的会话。

## 1. 后端契约(已就绪)

```text
# 管理员建 per_user Codex 后端(M14 表单基础上加两项):
POST /api/admin/models
  {..., auth_type:"oauth", auth_scope:"per_user", runtime:"codex_responses",
   oauth:{client_id, token_url, device_authorization_url, scope, ...}}
# 列表新增字段:auth_scope("shared"|"per_user")、runtime("openai_chat"|"codex_responses")

# 用户端(登录即可,管自己):
GET    /api/me/model-logins
  → [{backend_id, name, model, runtime, logged_in:bool, updated_at}]
POST   /api/me/model-logins/{backend_id}/device/start
  → {verification_uri, user_code, expires_in, interval}
POST   /api/me/model-logins/{backend_id}/device/poll
  → {status:"pending"} | {status:"authorized"}
DELETE /api/me/model-logins/{backend_id}   → {logged_out}   # 注销我的登录
```

## 2. 两块 UI

### A. 管理员「添加 Provider」(在 T-WEB-17 基础上加 2 个选项)
- **令牌归属**:`shared`(后端共用一份)| `per_user`(每用户自己登录)。
- **运行时**:`openai_chat`(标准)| `codex_responses`(Codex 订阅后端)。
- 选 per_user 时:管理员只填 OAuth **应用配置**(client_id/endpoints),**不在这里授权**——授权由每个用户自己做。

### B. 用户「我的模型登录」页(`/my-models`,工作台分组,所有登录用户)
- 列出 per_user 后端 + 我是否已登录(`logged_in`)。
- 「用我的订阅登录」→ device/start → 弹窗显示 `user_code` + 「在浏览器打开 verification_uri 输入此码」+ 复制;
  按 interval **轮询 device/poll** 到 `authorized`,成功后该后端变「已登录」。
- 已登录可「注销」(DELETE)。
- 文案明确:**用你自己的订阅,只用于你自己的会话**(不是全员共用一个号)。

## 3. Mock 模式

`MOCK_API=1`:`/api/me/model-logins` 返回 1 个 per_user 后端(logged_in=false);
device/start 返回假 user_code;poll 第一次 pending、第二次 authorized;注销生效。

## 4. 验收标准

1. 管理员能建 per_user + codex_responses 后端;列表有 auth_scope/runtime 徽章
2. 用户在「我的模型登录」用设备码登录到 authorized;注销生效;A 用户登录不影响 B
3. token/secret 全程不回显;`pnpm build` 通过;`MOCK_API=1` 全流程可走;既有测试全绿;仅改 `web/`

## 5. 重要边界(写进页面说明)

- **per_user = 个人用自己的订阅**,符合 OpenAI 对个人使用的默许;**不要做成全员共用一个订阅账号**
  (account pooling 是灰区)。
- client_id/endpoints 由管理员从**开源 Codex 源码**取得当前值填入;平台不内置。
- Codex 后端真实联通需正确的 base_url + 账号头(私有面,部署填),后端已留配置位。
