FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# MCP 连接器运行时:stdio 连接器需要 npx(node)/uvx(uv) 在容器内可用
RUN apt-get update \
    && apt-get install -y --no-install-recommends nodejs npm \
    && rm -rf /var/lib/apt/lists/* \
    && pip install --no-cache-dir uv

WORKDIR /app

COPY pyproject.toml README.md ./
COPY alembic.ini ./
COPY alembic ./alembic
COPY app ./app

RUN pip install --no-cache-dir . "asyncpg>=0.29"

# 低权限运行:server 与其拉起的 MCP 子进程都不以 root 跑(连接器=第三方代码,容器+低权限账号是沙箱边界)
RUN useradd --create-home --shell /usr/sbin/nologin agent
USER agent
ENV HOME=/home/agent

EXPOSE 8700

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8700"]
