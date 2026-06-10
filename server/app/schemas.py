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
