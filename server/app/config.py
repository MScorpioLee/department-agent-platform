from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """全部可用环境变量覆盖,前缀 AGENT_,如 AGENT_API_KEY。"""

    model_config = SettingsConfigDict(env_prefix="AGENT_")

    database_url: str = "sqlite+aiosqlite:///./server.db"
    # 启动时自动建表(开发/测试用)。生产改用 Alembic 迁移时设为 false,见 server/README.md
    auto_create_tables: bool = True
    # 开发期默认值,部署时必须用环境变量覆盖
    enrollment_token: str = "dev-enroll-token"
    api_key: str = "dev-key"
    heartbeat_timeout_seconds: float = 30.0
    sweep_interval_seconds: float = 5.0
    output_cap_bytes: int = 1024 * 1024
    # 模型网关配置文件(YAML);为空时无可用模型后端,会话消息接口会报 no_backend
    models_config_path: str | None = None
    tool_wait_timeout_seconds: float = 130.0
    # 启动时若该用户不存在则创建管理员(开发期默认值,部署务必用环境变量覆盖)
    admin_username: str | None = None
    admin_password: str | None = None
    auth_token_ttl_days: int = 7
