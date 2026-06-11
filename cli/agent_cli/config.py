import json
import os
from pathlib import Path

CONFIG_DIR = Path.home() / ".agent-cli"
CONFIG_FILE = CONFIG_DIR / "config.json"


def load() -> dict:
    if CONFIG_FILE.exists():
        try:
            return json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            return {}
    return {}


def save(data: dict) -> None:
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    CONFIG_FILE.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    os.chmod(CONFIG_FILE, 0o600)  # token 等同凭据


def clear() -> None:
    if CONFIG_FILE.exists():
        CONFIG_FILE.unlink()
