# Agent Server

## 开发环境

```bash
cd server
uv venv .venv
uv pip install -e '.[dev]'
```

## 启动

```bash
AGENT_ENROLLMENT_TOKEN=your-enroll-token \
AGENT_API_KEY=your-api-key \
.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8700
```

环境变量见 `app/config.py`(前缀 `AGENT_`),开发期默认值仅供本机调试,部署必须覆盖。

## 数据库配置(本地 / 远程)

数据库由 `AGENT_DATABASE_URL` 一个变量决定,可放在**环境变量**或同目录 **`.env` 文件**(见 `.env.example`):

```bash
# 本地 SQLite(默认,无需额外驱动)
AGENT_DATABASE_URL=sqlite+aiosqlite:///./server.db

# 远程 PostgreSQL(本地/局域网/云上均可;需先装 asyncpg 驱动)
uv pip install -e '.[postgres]'
AGENT_DATABASE_URL=postgresql+asyncpg://用户:密码@主机:5432/库名
```

机制基于 SQLAlchemy,理论上任何受支持的数据库(配好对应 async 驱动即可)都能用;
本项目仅对 SQLite(开发)与 PostgreSQL(生产)做承诺。远程库首次使用见下方迁移说明。

## 数据库迁移(Alembic)

开发/测试默认启动时自动建表(`AGENT_AUTO_CREATE_TABLES=true`)。**生产**改用迁移:

```bash
# 1) 关掉自动建表
export AGENT_AUTO_CREATE_TABLES=false
export AGENT_DATABASE_URL=postgresql+asyncpg://user:pass@host/db   # 或 sqlite+aiosqlite:///...
# 2) 升级到最新 schema
.venv/bin/alembic upgrade head
# 3) 再启动 Server

# 改了 models 后生成新迁移:
.venv/bin/alembic revision --autogenerate -m "描述"
```

迁移配置见 `alembic/env.py`(数据库地址取自 `AGENT_DATABASE_URL`,不在 alembic.ini 硬编码)。

## 测试

```bash
.venv/bin/pytest -q
```

## 模型配置(M3 对话)

```bash
cp models.example.yaml models.yaml   # models.yaml 已被 .gitignore 忽略
# 按需修改 backend;api_key 用 ${ENV_VAR} 占位,真实 key 只放环境变量
export DEEPSEEK_API_KEY=sk-xxxx
AGENT_MODELS_CONFIG_PATH=models.yaml \
AGENT_API_KEY=your-api-key AGENT_ENROLLMENT_TOKEN=your-enroll-token \
.venv/bin/uvicorn app.main:app --port 8700
```

未配置 `AGENT_MODELS_CONFIG_PATH` 时,Server 仍可跑 Runner/任务接口,但 `POST /api/sessions/{id}/messages` 会返回 `no_backend`。

无订阅/无 key 时,可用 `scripts/fake_model_server.py` + `scripts/e2e_agent.py` 验证 Agent Loop 全链路;
真实模型验证见 DeepSeek 等合规 backend。

协议定义见 [../docs/protocol.md](../docs/protocol.md),安全模型见 [../docs/security.md](../docs/security.md)。
