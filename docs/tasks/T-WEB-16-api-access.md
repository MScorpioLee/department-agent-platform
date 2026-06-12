# T-WEB-16:「API 接入」页(个人 API Key + 中转站用法)

> 执行者:Codex。前置:T-WEB-02(登录)。**只允许改动 `web/`。**
> 后端 M13 已就绪:服务端现在是 OpenAI 兼容中转站(/v1),用户用个人 API Key 把它接进任意工具
>(含 `agent code` 本地 Agent)。本卡做用户自助的 Key 管理 + 接入说明页。

## 1. 后端契约(已就绪,登录即可,管自己的)

```text
POST   /api/me/api-keys        {name?}   → {id, name, prefix, api_key}   # 明文仅此一次!
GET    /api/me/api-keys                  → [{id, name, prefix, created_at, last_used_at}]
DELETE /api/me/api-keys/{id}             → {deleted}

# 中转端点(展示用法,页面不直接调):
POST /v1/chat/completions   GET /v1/models    认证 Bearer <ak_…>(或登录 token)
```

## 2. 页面(`/api-access`,工作台分组,所有登录用户)

1. **我的 API Key 列表**:name、prefix(如 `ak_3f9c1b2…`)、创建时间、最后使用时间、吊销按钮(二次确认)。
2. **新建 Key**:输入用途名 → 创建 → **弹窗展示明文一次**(带复制按钮 + 醒目提示"关闭后无法再次查看");列表刷新。
3. **接入说明卡片**(静态展示,带复制):
   - Base URL:`<当前站点协议+主机>:8700/v1`(或反代域名;从 `NEXT_PUBLIC_AGENT_SERVER_URL` / window.location 推导,可手改展示框)
   - 示例:OpenAI SDK 配置 `base_url` + `api_key`;curl 示例;`agent code` 提示(登录即用,无需 key)。
4. 安全提示:Key 等同账号凭据,泄露立即吊销;服务端只存哈希,丢了只能重建。

## 3. Mock 模式

`MOCK_API=1`:内置 1 个假 key(prefix);创建返回假明文 `ak_mock_…`;吊销生效。

## 4. 验收标准

1. 能创建/列出/吊销自己的 Key;明文只在创建弹窗出现一次,列表/刷新后不可再见
2. 接入说明可复制,Base URL 正确推导
3. `pnpm build` 通过;`MOCK_API=1` 全流程可走;既有测试全绿;仅改 `web/`

## 5. 明确不做

Key 级配额/限速设置(后端后续)、admin 查看他人 key(审计页已有用量聚合)。
