# Department Agent WebUI

内部 AI Agent 平台的运维调试控制台，包含机器列表、任务下发、任务状态轮询和输出查看。

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

- `http://localhost:3000/machines`
- `http://localhost:3000/console`

## Mock 模式

`.env.local` 中设置 `MOCK_API=1` 后，Next.js Route Handler 会直接返回内置 mock 数据，不会转发到后端。mock 数据包含 1 台在线机器、1 台离线机器；提交任务后约 3 秒返回 `completed`，并提供固定 stdout 输出。

取消或删除 `MOCK_API=1` 后，浏览器仍然只访问 `/api/proxy/*`，代理会从服务端环境变量读取：

```text
AGENT_API_BASE=http://127.0.0.1:8700
AGENT_API_KEY=dev-key
```

`AGENT_API_KEY` 只在服务端代理中注入 `X-API-Key`，不会下发给浏览器。

## 验证

```bash
corepack pnpm test
corepack pnpm build
```
