import asyncio
import os
import sys
from logging.config import fileConfig

from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import async_engine_from_config

from alembic import context

# 让 alembic 能 import 到 app 包(alembic 从 server/ 目录运行)
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.config import Settings  # noqa: E402
from app.db import Base  # noqa: E402
from app import models  # noqa: E402,F401  导入以注册全部表

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# 数据库地址来自应用配置(环境变量 AGENT_DATABASE_URL),不在 alembic.ini 硬编码
config.set_main_option("sqlalchemy.url", Settings().database_url)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    context.configure(
        url=config.get_main_option("sqlalchemy.url"),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        render_as_batch=True,  # SQLite 改表需 batch 模式
    )
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    # batch 模式仅 SQLite 需要(用于 ALTER);Postgres 用 batch 会把改表变成重建表,故按方言判断
    is_sqlite = connection.dialect.name == "sqlite"
    context.configure(connection=connection, target_metadata=target_metadata, render_as_batch=is_sqlite)
    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    connectable = async_engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await connectable.dispose()


def run_migrations_online() -> None:
    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
