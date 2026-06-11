# T-DEPLOY-01:生产编排(Docker Compose:Postgres + Server + Web + 反代)

> 执行者:Codex。**只允许新增 `deploy/` 目录**(compose、Dockerfile、.env 示例、说明)。
> **不得修改 `server/`、`runner/`、`web/`、`docs/` 的源码**(Dockerfile 用构建上下文只读引用它们)。
> 这是运维/打包,不碰应用逻辑。

## 1. 目标

一套 `docker compose up` 起生产栈:PostgreSQL + Agent Server + WebUI + 反向代理(TLS)。对应 docs/packaging.md 的「管理端安装包」。

## 2. 做什么(全部放 `deploy/`)

- `deploy/docker-compose.yml`,服务:
  - `postgres`:持久卷;库名/密码来自 env。
  - `server`:用 `deploy/server.Dockerfile`(上下文 `../server`)构建;
    跑 `uvicorn app.main:app`;**额外 `pip install asyncpg`**(Postgres 异步驱动);
    `AGENT_DATABASE_URL=postgresql+asyncpg://...` 指向 postgres 服务;
    挂载模型配置(`AGENT_MODELS_CONFIG_PATH` 指向挂载的 models.yaml);
    env 注入 `AGENT_API_KEY`/`AGENT_ENROLLMENT_TOKEN`/`AGENT_ADMIN_USERNAME`/`AGENT_ADMIN_PASSWORD`。
  - `web`:用 `deploy/web.Dockerfile`(上下文 `../web`)`next build && next start`;`AGENT_API_BASE` 指向 server 服务。
  - `caddy`(或 nginx):反代,对外只暴露 web + 必要的 `/ws/runner`(Runner 连接入口),TLS 终止。
- `deploy/.env.example`:列全所需 env(含 `POSTGRES_PASSWORD`、各 token、`DEEPSEEK_API_KEY`),**不含真实值**。
- `deploy/README.md`:起停、首次管理员、Runner 如何连(`server_url` 指向反代地址)。

> 数据库:首版用应用启动时的 `create_all` 建表即可(Server 已支持);Alembic 迁移由 Claude 后续单独做,本卡不涉及。

## 3. 安全护栏

- 不改 server/runner/web 源码;只新增 deploy/。
- `.env.example` 不含真实密钥;反代默认不暴露管理 API 到公网(只暴露 web 与 runner 网关)。

## 4. 验收标准

1. `cd deploy && cp .env.example .env`(填值)→ `docker compose up` 起全栈无报错
2. 浏览器开反代地址能到登录页;用 env 里的管理员账号登录成功(数据落 Postgres)
3. 一个本地 Runner 用反代 `server_url` 能注册上线(WS 通)
4. server/runner/web 源码 `git diff` 为空(只新增 deploy/)

## 5. 明确不做

K8s/Helm、自动备份、HA、Alembic 迁移(Claude 做)、CI 发布流水线。
