# Department Agent WebUI

内部 AI Agent 平台的运维调试控制台，包含登录、机器列表、任务下发、模型对话、审批、跨机器授权、任务状态轮询、输出查看和管理员审计后台。

## 安装

```bash
corepack enable
corepack pnpm install
```

## 开发启动

```bash
cp .env.example .env.local
corepack pnpm dev
```

访问：

- `http://localhost:3000/login`
- `http://localhost:3000/machines`
- `http://localhost:3000/console`
- `http://localhost:3000/chat`
- `http://localhost:3000/approvals`
- `http://localhost:3000/machines/m_mock_online/access`
- `http://localhost:3000/audit`

## Mock 模式

`.env.local` 中设置 `MOCK_API=1` 后，Next.js Route Handler 会直接返回内置 mock 数据，不会转发到后端。任意非空用户名和密码可登录，登录态写入 `httpOnly` cookie，`/api/auth/me` 返回 mock 管理员用于预览审计后台。mock 数据包含 1 台在线机器、1 台离线机器；提交任务后约 3 秒返回 `completed`，并提供固定 stdout 输出；对话消息会生成 user / assistant / tool / assistant 时间线并触发一个需审批的高风险命令；审批队列内置 2 条待审批记录，批准/拒绝会在 mock 内存中更新；机器授权支持 mock 列表、新增和撤销；审计后台提供少量脱敏用量、会话、工具调用和命令记录。

取消或删除 `MOCK_API=1` 后，登录接口会转发到 Agent Server：

```text
AGENT_API_BASE=http://127.0.0.1:8700
```

登录成功后，服务端把后端返回的 token 写入 `agent_token` 的 `httpOnly` cookie，浏览器侧 API 仍然只访问 `/api/proxy/*`。代理从 cookie 读取 token 并注入 `Authorization: Bearer <token>`；响应体不会把 token 返回给浏览器 JS。

## 验证

```bash
corepack pnpm test
corepack pnpm build
```
