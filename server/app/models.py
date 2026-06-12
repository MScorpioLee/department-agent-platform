import uuid
from datetime import datetime, timezone

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base

# 任务状态机见 docs/protocol.md §3.1
ACTIVE_TASK_STATUSES = ("queued", "dispatched", "running")
# Runner 可上报的终态;lost 只能由 Server 在断线时设置
RESULT_STATUSES = ("completed", "failed", "timeout", "cancelled")


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex}"


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def iso_utc(dt: datetime | None) -> str | None:
    """时间戳出 API 的统一格式。SQLite 读出的是 naive UTC;补上时区,否则前端按本地时间解析会偏一个时区。"""
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()


class Machine(Base):
    __tablename__ = "machines"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    machine_name: Mapped[str] = mapped_column(String(255))
    owner_user_id: Mapped[str | None] = mapped_column(String(64), index=True)  # None=无主,待管理员分配
    os: Mapped[str | None] = mapped_column(String(32))
    arch: Mapped[str | None] = mapped_column(String(32))
    runner_version: Mapped[str | None] = mapped_column(String(32))
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    status: Mapped[str] = mapped_column(String(16), default="offline")
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    capabilities: Mapped[list | None] = mapped_column(JSON)  # 工具名列表(向后兼容)
    tools: Mapped[list | None] = mapped_column(JSON)  # Runner 上报的工具 schema(动态)
    allowed_roots: Mapped[list | None] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Task(Base):
    __tablename__ = "tasks"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    machine_id: Mapped[str] = mapped_column(ForeignKey("machines.id"), index=True)
    tool: Mapped[str] = mapped_column(String(64))
    payload: Mapped[dict] = mapped_column(JSON)
    status: Mapped[str] = mapped_column(String(16), default="queued", index=True)
    result: Mapped[dict | None] = mapped_column(JSON)
    stdout: Mapped[str] = mapped_column(Text, default="")
    stderr: Mapped[str] = mapped_column(Text, default="")
    truncated: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    dispatched_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Session(Base):
    __tablename__ = "sessions"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    # M4 用户系统上线前,user_id 暂用占位值 "default"
    user_id: Mapped[str] = mapped_column(String(64), default="default", index=True)
    machine_id: Mapped[str] = mapped_column(ForeignKey("machines.id"), index=True)
    title: Mapped[str | None] = mapped_column(String(255))
    status: Mapped[str] = mapped_column(String(16), default="active")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Message(Base):
    __tablename__ = "messages"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    session_id: Mapped[str] = mapped_column(ForeignKey("sessions.id"), index=True)
    seq: Mapped[int] = mapped_column(default=0, index=True)  # 会话内顺序
    role: Mapped[str] = mapped_column(String(16))  # user/assistant/tool
    content: Mapped[str] = mapped_column(Text, default="")
    tool_calls: Mapped[list | None] = mapped_column(JSON)  # assistant 发起的工具调用
    tool_call_id: Mapped[str | None] = mapped_column(String(64))  # tool 消息对应的调用
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class ToolCall(Base):
    __tablename__ = "tool_calls"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    session_id: Mapped[str] = mapped_column(ForeignKey("sessions.id"), index=True)
    machine_id: Mapped[str] = mapped_column(String(64))
    tool_name: Mapped[str] = mapped_column(String(64))
    arguments_json: Mapped[dict | None] = mapped_column(JSON)
    result_json: Mapped[dict | None] = mapped_column(JSON)
    status: Mapped[str] = mapped_column(String(16))  # completed/failed
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Approval(Base):
    __tablename__ = "approvals"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    machine_id: Mapped[str] = mapped_column(String(64), index=True)
    session_id: Mapped[str | None] = mapped_column(String(64))
    requested_by_user_id: Mapped[str | None] = mapped_column(String(64))
    tool: Mapped[str] = mapped_column(String(64))
    payload: Mapped[dict] = mapped_column(JSON)
    risk_rule: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(16), default="pending", index=True)  # pending/approved/rejected
    decided_by_user_id: Mapped[str | None] = mapped_column(String(64))
    task_id: Mapped[str | None] = mapped_column(String(64))  # 批准后产生的任务
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Skill(Base):
    """技能:声明式能力包(提示词预设 + 作用域)。可从 GitHub 导入(不执行代码,安全)。"""

    __tablename__ = "skills"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    description: Mapped[str | None] = mapped_column(String(255))
    prompt: Mapped[str] = mapped_column(Text, default="")  # 启用后并入会话的系统提示
    source: Mapped[str] = mapped_column(String(16), default="custom")  # builtin | imported | custom
    source_ref: Mapped[str | None] = mapped_column(String(255))  # 导入来源(URL/commit)
    scope_all: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class SkillScope(Base):
    __tablename__ = "skill_scopes"

    skill_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(64), primary_key=True)


class UserSkillState(Base):
    __tablename__ = "user_skill_states"

    user_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    skill_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)


class Connector(Base):
    """外部 MCP 连接器(插件)。command/args 或 url 由管理员显式配置。"""

    __tablename__ = "connectors"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    transport: Mapped[str] = mapped_column(String(16), default="stdio")  # stdio | http
    command: Mapped[str | None] = mapped_column(String(255))  # stdio:启动命令
    args: Mapped[list | None] = mapped_column(JSON)  # stdio:参数
    url: Mapped[str | None] = mapped_column(String(255))  # http:远程地址
    env_enc: Mapped[str | None] = mapped_column(Text)  # 加密:子进程注入的环境变量(JSON)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    scope_all: Mapped[bool] = mapped_column(Boolean, default=False)  # True=所有用户可用
    require_approval: Mapped[bool] = mapped_column(Boolean, default=False)  # 每次调用需审批
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class ConnectorScope(Base):
    __tablename__ = "connector_scopes"

    connector_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(64), primary_key=True)


class ModelBackendRow(Base):
    __tablename__ = "model_backends"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    base_url: Mapped[str] = mapped_column(String(255))
    model: Mapped[str] = mapped_column(String(128))
    api_key_enc: Mapped[str | None] = mapped_column(Text)  # 加密存储,API 不回显
    max_concurrency: Mapped[int] = mapped_column(default=2)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class UserModelRoute(Base):
    __tablename__ = "user_model_routes"

    user_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    backend_id: Mapped[str] = mapped_column(String(64))


class MachineGrant(Base):
    __tablename__ = "machine_grants"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    machine_id: Mapped[str] = mapped_column(String(64), index=True)
    grantee_user_id: Mapped[str] = mapped_column(String(64), index=True)  # 被授权人
    granted_by_user_id: Mapped[str | None] = mapped_column(String(64))
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))  # None=不过期
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class UserApiKey(Base):
    """个人 API Key(M13 中转站):把服务端当 OpenAI 兼容供应商接入任意工具。哈希存储,明文仅创建时返回一次。"""

    __tablename__ = "user_api_keys"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(64), index=True)
    name: Mapped[str] = mapped_column(String(64), default="")
    key_hash: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    prefix: Mapped[str] = mapped_column(String(16))  # 形如 ak_3f9c…,供列表辨认
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class ModelUsage(Base):
    __tablename__ = "model_usage"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    session_id: Mapped[str] = mapped_column(String(64), index=True)
    user_id: Mapped[str] = mapped_column(String(64), index=True)
    backend_id: Mapped[str | None] = mapped_column(String(64), index=True)
    model: Mapped[str | None] = mapped_column(String(64))
    prompt_tokens: Mapped[int] = mapped_column(default=0)
    completion_tokens: Mapped[int] = mapped_column(default=0)
    total_tokens: Mapped[int] = mapped_column(default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    username: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    display_name: Mapped[str | None] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(16), default="user")  # user/admin
    password_hash: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class AuthToken(Base):
    __tablename__ = "auth_tokens"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)  # 只存哈希,可吊销
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class EnrollmentToken(Base):
    __tablename__ = "enrollment_tokens"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    owner_user_id: Mapped[str | None] = mapped_column(String(64))  # 注册的机器归属该用户;None=无主
    max_uses: Mapped[int] = mapped_column(default=1)  # 0=不限次
    used_count: Mapped[int] = mapped_column(default=0)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
