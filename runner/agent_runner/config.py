import json
import os
from dataclasses import dataclass, field
from pathlib import Path

import yaml


@dataclass
class RunnerConfig:
    server_url: str
    machine_name: str
    allowed_roots: list[str]
    blocked_paths: list[str] = field(default_factory=list)
    enrollment_token: str = ""  # 仅首次注册需要
    heartbeat_interval_seconds: float = 10.0
    plugins: list[str] | None = None  # 启用的插件;None=默认(exec+file)。只来自本地配置


def load_config(path: str) -> RunnerConfig:
    raw = yaml.safe_load(Path(path).read_text(encoding="utf-8")) or {}
    for key in ("server_url", "machine_name", "allowed_roots"):
        if not raw.get(key):
            raise ValueError(f"配置缺少必填项: {key}")
    plugins = raw.get("plugins")
    return RunnerConfig(
        server_url=str(raw["server_url"]).rstrip("/"),
        machine_name=str(raw["machine_name"]),
        allowed_roots=[str(p) for p in raw["allowed_roots"]],
        blocked_paths=[str(p) for p in raw.get("blocked_paths") or []],
        enrollment_token=str(raw.get("enrollment_token") or ""),
        heartbeat_interval_seconds=float(raw.get("heartbeat_interval_seconds") or 10.0),
        plugins=[str(p) for p in plugins] if plugins else None,
    )


def load_state(path: str) -> dict | None:
    p = Path(path)
    if not p.exists():
        return None
    state = json.loads(p.read_text(encoding="utf-8"))
    if state.get("machine_id") and state.get("runner_token"):
        return state
    return None


def save_state(path: str, machine_id: str, runner_token: str) -> None:
    p = Path(path)
    p.write_text(json.dumps({"machine_id": machine_id, "runner_token": runner_token}), encoding="utf-8")
    os.chmod(p, 0o600)  # runner_token 等同机器凭据
