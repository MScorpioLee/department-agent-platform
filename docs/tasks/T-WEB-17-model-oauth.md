# T-WEB-17:模型页 OAuth 认证(设备码 + 授权码 PKCE)

> 执行者:Codex。前置:T-WEB-11/15(添加 Provider)。**只允许改动 `web/`。**
> 后端 M14 已就绪:模型后端支持 `auth_type=oauth`,标准 OAuth 2.0 设备码 + 授权码 PKCE 流程。
> 给"添加 Provider"加第二种认证方式:不是填 API Key,而是"OAuth 登录"。

## 1. 后端契约(已就绪,均 admin)

```text
# 创建 OAuth 后端(api_key 留空,带 oauth 配置):
POST /api/admin/models
  {name, base_url, model, auth_type:"oauth",
   oauth:{client_id, client_secret?, token_url,
          device_authorization_url?, authorization_url?, scope?, redirect_uri?}}

# 列表/详情新增字段:
  auth_type: "api_key" | "oauth"
  oauth: null | {status:"unconfigured"|"pending"|"authorized"|"expired",
                 client_id, scope, has_device_flow, has_auth_code_flow, expires_at}
  (绝不回 client_secret / token)

# 设备码流程:
POST /api/admin/models/{id}/oauth/device/start
  → {verification_uri, user_code, expires_in, interval}
POST /api/admin/models/{id}/oauth/device/poll
  → {status:"pending"} | {status:"authorized"}     # 轮询到 authorized 即完成

# 授权码 PKCE 流程:
GET  /api/admin/models/{id}/oauth/authorize-url  → {authorize_url, state}
POST /api/admin/models/{id}/oauth/callback {code, state}  → {status:"authorized"}

# 手动刷新:
POST /api/admin/models/{id}/oauth/refresh  → {status:"refreshed"}
```

## 2. 交互(「添加 Provider」加认证方式切换)

1. 表单顶部加**认证方式**单选:`API Key`(现有)| `OAuth`。
2. 选 OAuth → 隐藏 API Key,显示 OAuth 配置:client_id、client_secret(可空,注明"PKCE/设备码可不填")、
   token_url、device_authorization_url、authorization_url、scope、redirect_uri。
   (这些是**该厂商发的应用凭据**,管理员填;平台不内置任何厂商的 client_id。)
3. 提交创建 → 后端返回 `oauth.status="pending"`(待授权)。
4. **授权(列表行/详情里的「OAuth 登录」按钮)**,按 `has_device_flow`/`has_auth_code_flow` 二选一:
   - **设备码**:点登录 → 调 device/start → 弹窗显示「在浏览器打开 `verification_uri` 并输入 `user_code`」+
     复制按钮;前端按 `interval` **轮询 device/poll** 直到 `authorized`(或超时),成功后刷新列表(status→authorized)。
   - **授权码**:点登录 → 调 authorize-url → 新开标签打开 `authorize_url`;用户授权后浏览器回到 redirect_uri
     带 `code`/`state`;提供一个**手动粘贴 code** 的输入(MVP:redirect_uri 指向一个展示 code 的页面,用户复制回填)
     → 调 callback。
5. 列表显示 `auth_type` 徽章 + OAuth 状态徽章(待授权黄/已授权绿/已过期红);已授权可「刷新令牌」。

## 3. Mock 模式

`MOCK_API=1`:创建 oauth 后端返回 `oauth.status="pending"`;device/start 返回假 `user_code`;
device/poll 第一次 `pending`、第二次 `authorized`;refresh 返回 `refreshed`。走通整个授权动画。

## 4. 验收标准

1. 能创建 OAuth 后端(不填 key);设备码授权弹窗显示 user_code + 轮询到已授权;状态徽章正确
2. client_secret / token 全程不回显;授权码流程能拿到 authorize_url
3. 已授权后能手动刷新;`auth_type` 徽章区分两类后端
4. `pnpm build` 通过;`MOCK_API=1` 全流程可走;既有测试全绿;仅改 `web/`

## 5. 明确不做(也不允许)

**不内置任何第一方(Claude/Codex/OpenAI)的 client_id 去冒充官方客户端**(违反厂商 ToS)。
本页只做标准 OAuth——凭据由管理员从厂商处获得后填入。订阅类走外部代理 + hermes_proxy 预设。
