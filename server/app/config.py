from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """配置来源(优先级从高到低):环境变量(前缀 AGENT_) > 同目录 .env 文件 > 默认值。

    数据库通过 AGENT_DATABASE_URL 切换本地/远程:
      - 本地 SQLite:  sqlite+aiosqlite:///./server.db
      - 远程 Postgres: postgresql+asyncpg://user:pass@db-host:5432/dbname  (需装 .[postgres])
    """

    model_config = SettingsConfigDict(
        env_prefix="AGENT_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    database_url: str = "sqlite+aiosqlite:///./server.db"
    # 启动时自动建表(开发/测试用)。生产改用 Alembic 迁移时设为 false,见 server/README.md
    auto_create_tables: bool = True
    # 开发期默认值,部署时必须用环境变量覆盖
    enrollment_token: str = "dev-enroll-token"
    api_key: str = "dev-key"
    # 加密 DB 中密钥(模型/连接器 api_key)的主密钥,生产必须设强随机值
    secret_key: str = "dev-secret-key-change-me"
    heartbeat_timeout_seconds: float = 30.0
    sweep_interval_seconds: float = 5.0
    output_cap_bytes: int = 1024 * 1024
    # 模型网关配置文件(YAML);为空时无可用模型后端,会话消息接口会报 no_backend
    models_config_path: str | None = None
    tool_wait_timeout_seconds: float = 130.0
    # MCP 连接器:建立会话/列工具的超时、单次工具调用的超时
    connector_connect_timeout_seconds: float = 20.0
    connector_call_timeout_seconds: float = 60.0
    # 启动时若该用户不存在则创建管理员(开发期默认值,部署务必用环境变量覆盖)
    admin_username: str | None = None
    admin_password: str | None = None
    auth_token_ttl_days: int = 7
    # 是否开放自助注册(注册后置 pending,需管理员审批才能登录);关掉则只能管理员建号
    allow_registration: bool = True
