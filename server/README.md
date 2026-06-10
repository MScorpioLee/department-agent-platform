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
