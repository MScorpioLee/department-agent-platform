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
