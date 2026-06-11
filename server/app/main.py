import asyncio
import contextlib
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from . import audit, routes, ws
from .auth import hash_password
from .config import Settings
from .db import Base
from .model_gateway import build_gateway
from .models import ACTIVE_TASK_STATUSES, Machine, Task, User, new_id, utcnow
from .registry import RunnerHub


def _load_models_config(path: str | None) -> dict | None:
    if not path:
        return None
    import os
    import pathlib

    import yaml

    # 支持 ${ENV_VAR} 插值,使 api_key 等敏感值只存在于环境变量,不落盘到配置文件
    text = os.path.expandvars(pathlib.Path(path).read_text(encoding="utf-8"))
    return yaml.safe_load(text)


async def _sweep_loop(app: FastAPI) -> None:
    """心跳超时巡检:关掉僵死连接,由 ws handler 的清理逻辑统一善后。"""
    settings = app.state.settings
    hub = app.state.hub
    while True:
        await asyncio.sleep(settings.sweep_interval_seconds)
        now = time.monotonic()
        for conn in list(hub.conns.values()):
            if now - conn.last_heartbeat > settings.heartbeat_timeout_seconds:
                with contextlib.suppress(Exception):
                    await conn.ws.close(code=4408)


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings()
    engine = create_async_engine(settings.database_url)
    sessionmaker = async_sessionmaker(engine, expire_on_commit=False)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        # 开发/测试自动建表;生产由 Alembic 迁移建表(AGENT_AUTO_CREATE_TABLES=false)
        if settings.auto_create_tables:
            async with engine.begin() as conn:
                await conn.run_sync(Base.metadata.create_all)
        # 启动复位:上次进程异常退出可能残留 online 机器与进行中任务
        async with sessionmaker() as session:
            await session.execute(update(Machine).values(status="offline"))
            await session.execute(
                update(Task)
                .where(Task.status.in_(ACTIVE_TASK_STATUSES))
                .values(status="lost", finished_at=utcnow())
            )
            # seed 管理员(幂等:仅当配置了凭据且用户不存在时创建)
            if settings.admin_username and settings.admin_password:
                exists = (
                    await session.execute(select(User).where(User.username == settings.admin_username))
                ).scalar_one_or_none()
                if exists is None:
                    session.add(
                        User(
                            id=new_id("u"),
                            username=settings.admin_username,
                            display_name=settings.admin_username,
                            role="admin",
                            password_hash=hash_password(settings.admin_password),
                        )
                    )
            await session.commit()
        sweeper = asyncio.create_task(_sweep_loop(app))
        try:
            yield
        finally:
            sweeper.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await sweeper
            await engine.dispose()

    app = FastAPI(title="Agent Server", lifespan=lifespan)
    app.state.settings = settings
    app.state.engine = engine
    app.state.sessionmaker = sessionmaker
    app.state.hub = RunnerHub(settings.output_cap_bytes)
    app.state.gateway = build_gateway(_load_models_config(settings.models_config_path))
    app.include_router(routes.router)
    app.include_router(audit.router)
    app.include_router(ws.router)

    @app.exception_handler(HTTPException)
    async def _http_exc(request: Request, exc: HTTPException) -> JSONResponse:
        detail = exc.detail if isinstance(exc.detail, dict) else {"code": "error", "message": str(exc.detail)}
        return JSONResponse({"error": detail}, status_code=exc.status_code)

    @app.exception_handler(RequestValidationError)
    async def _validation_exc(request: Request, exc: RequestValidationError) -> JSONResponse:
        return JSONResponse(
            {"error": {"code": "payload_invalid", "message": str(exc.errors()[:3])}}, status_code=422
        )

    return app


app = create_app()
