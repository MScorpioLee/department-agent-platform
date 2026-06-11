FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY pyproject.toml README.md ./
COPY alembic.ini ./
COPY alembic ./alembic
COPY app ./app

RUN pip install --no-cache-dir . "asyncpg>=0.29"

EXPOSE 8700

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8700"]
