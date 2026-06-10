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

协议定义见 [../docs/protocol.md](../docs/protocol.md),安全模型见 [../docs/security.md](../docs/security.md)。
