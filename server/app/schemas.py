from pydantic import BaseModel, Field


class EnrollIn(BaseModel):
    machine_name: str = Field(min_length=1, max_length=255)
    os: str | None = None
    arch: str | None = None
    runner_version: str | None = None


class TaskIn(BaseModel):
    machine_id: str
    tool: str
    payload: dict = Field(default_factory=dict)


class SessionIn(BaseModel):
    machine_id: str
    title: str | None = None
    user_id: str = "default"


class MessageIn(BaseModel):
    content: str = Field(min_length=1)


class LoginIn(BaseModel):
    username: str = Field(min_length=1)
    password: str = Field(min_length=1)


class UserCreateIn(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=6)
    display_name: str | None = None
    role: str = Field(default="user", pattern="^(user|admin)$")


class EnrollmentTokenIn(BaseModel):
    owner_user_id: str | None = None  # 绑定机器归属;None=无主
    max_uses: int = Field(default=1, ge=0)  # 0=不限次
    expires_in_days: int = Field(default=7, ge=1)


class AssignMachineIn(BaseModel):
    user_id: str | None  # None=置为无主


class GrantIn(BaseModel):
    grantee_user_id: str
    expires_in_hours: int = Field(default=2, ge=1, le=720)


class ModelDiscoverIn(BaseModel):
    base_url: str = Field(min_length=1)
    api_key: str = ""


class OAuthConfigIn(BaseModel):
    client_id: str = Field(min_length=1)
    client_secret: str = ""  # 公共客户端(PKCE/设备码)可空
    token_url: str = Field(min_length=1)
    device_authorization_url: str = ""  # 设备码流程需要
    authorization_url: str = ""  # 授权码 PKCE 流程需要
    scope: str = ""
    redirect_uri: str = ""


class ModelBackendIn(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    base_url: str = Field(min_length=1)
    model: str = Field(min_length=1)
    api_key: str = ""
    auth_type: str = Field(default="api_key", pattern="^(api_key|oauth)$")
    auth_scope: str = Field(default="shared", pattern="^(shared|per_user)$")
    runtime: str = Field(default="openai_chat", pattern="^(openai_chat|codex_responses)$")
    oauth: OAuthConfigIn | None = None  # auth_type=oauth 时填厂商发的应用配置
    max_concurrency: int = Field(default=2, ge=1, le=64)
    is_default: bool = False


class OAuthCallbackIn(BaseModel):
    code: str = Field(min_length=1)
    state: str = ""


class ModelBackendPatch(BaseModel):
    name: str | None = None
    base_url: str | None = None
    model: str | None = None
    api_key: str | None = None  # 提供才更新;不提供保持原值
    max_concurrency: int | None = Field(default=None, ge=1, le=64)
    enabled: bool | None = None
    is_default: bool | None = None


class ModelRouteIn(BaseModel):
    user_id: str
    backend_id: str | None = None  # None=删除该用户的路由(回落默认)


class ConnectorIn(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    transport: str = Field(default="stdio", pattern="^(stdio|http)$")
    command: str | None = None
    args: list[str] = Field(default_factory=list)
    url: str | None = None
    env: dict[str, str] = Field(default_factory=dict)
    scope_all: bool = False
    require_approval: bool = False


class ConnectorPatch(BaseModel):
    name: str | None = None
    command: str | None = None
    args: list[str] | None = None
    url: str | None = None
    env: dict[str, str] | None = None
    enabled: bool | None = None
    scope_all: bool | None = None
    require_approval: bool | None = None


class ConnectorScopeIn(BaseModel):
    user_ids: list[str] = Field(default_factory=list)


class SkillIn(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    description: str | None = None
    prompt: str = ""
    scope_all: bool = False


class SkillPatch(BaseModel):
    name: str | None = None
    description: str | None = None
    prompt: str | None = None
    scope_all: bool | None = None


class SkillScopeIn(BaseModel):
    user_ids: list[str] = Field(default_factory=list)


class SkillImportIn(BaseModel):
    url: str = Field(min_length=1)  # GitHub raw 文件(skill.yaml / SKILL.md)
    scope_all: bool = False


class SkillToggleIn(BaseModel):
    enabled: bool
