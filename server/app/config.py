from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """全部可用环境变量覆盖,前缀 AGENT_,如 AGENT_API_KEY。"""

    model_config = SettingsConfigDict(env_prefix="AGENT_")

    database_url: str = "sqlite+aiosqlite:///./server.db"
    # 开发期默认值,部署时必须用环境变量覆盖
    enrollment_token: str = "dev-enroll-token"
    api_key: str = "dev-key"
    heartbeat_timeout_seconds: float = 30.0
    sweep_interval_seconds: float = 5.0
    output_cap_bytes: int = 1024 * 1024
