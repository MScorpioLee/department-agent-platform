#!/usr/bin/env bash
# 一键拉起本地全栈:Server + Runner + WebUI(连真实后端)。Ctrl-C 停止全部。
# 首次使用前请先装依赖(见各目录 README):
#   server: cd server && uv venv .venv && uv pip install -e '.[dev]'
#   runner: cd runner && uv venv .venv && uv pip install -e '.[dev]'
#   web:    cd web && pnpm install   (或 npm install)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK_DIR="${AGENT_WORK_DIR:-$HOME/agent-workspace}"
API_KEY="${AGENT_API_KEY:-dev-key}"
ENROLL_TOKEN="${AGENT_ENROLLMENT_TOKEN:-dev-enroll}"
ADMIN_USER="${AGENT_ADMIN_USERNAME:-admin}"
ADMIN_PASS="${AGENT_ADMIN_PASSWORD:-admin12345}"
SERVER_PORT="${AGENT_SERVER_PORT:-8700}"
WEB_PORT="${AGENT_WEB_PORT:-3000}"

mkdir -p "$WORK_DIR"

[ -x "$ROOT/server/.venv/bin/uvicorn" ] || { echo "✗ 缺 server venv,见 server/README.md 安装"; exit 1; }
[ -x "$ROOT/runner/.venv/bin/python" ]  || { echo "✗ 缺 runner venv,见 runner/README.md 安装"; exit 1; }
[ -d "$ROOT/web/node_modules" ]         || { echo "✗ 缺 web 依赖,先在 web/ 跑 pnpm install 或 npm install"; exit 1; }

# 选择 web 启动器
if [ -x "$ROOT/web/node_modules/.bin/next" ]; then WEB_BIN="$ROOT/web/node_modules/.bin/next"
else echo "✗ 未找到 web/node_modules/.bin/next"; exit 1; fi

# 首次生成 runner 配置
RCONF="$ROOT/runner/config.yaml"
if [ ! -f "$RCONF" ]; then
  cat > "$RCONF" <<EOF
server_url: http://127.0.0.1:$SERVER_PORT
machine_name: $(hostname -s 2>/dev/null || echo dev-machine)
enrollment_token: $ENROLL_TOKEN
allowed_roots:
  - $WORK_DIR
heartbeat_interval_seconds: 10
EOF
  echo "✓ 已生成 runner/config.yaml(allowed_roots=$WORK_DIR)"
fi

# 可选模型配置
MODEL_ENV=()
if [ -f "$ROOT/server/models.yaml" ]; then
  MODEL_ENV=(AGENT_MODELS_CONFIG_PATH="$ROOT/server/models.yaml")
  echo "✓ 检测到 server/models.yaml,启用模型对话(记得已 export 对应 API key)"
else
  echo "ℹ 未配置 server/models.yaml,模型对话不可用(机器/任务功能正常)"
fi

PIDS=()
cleanup() { echo; echo "停止全部..."; for p in "${PIDS[@]:-}"; do kill "$p" 2>/dev/null || true; done; }
trap cleanup EXIT INT TERM

echo "▶ 启动 Server :$SERVER_PORT"
( cd "$ROOT/server" && env AGENT_API_KEY="$API_KEY" AGENT_ENROLLMENT_TOKEN="$ENROLL_TOKEN" \
    AGENT_ADMIN_USERNAME="$ADMIN_USER" AGENT_ADMIN_PASSWORD="$ADMIN_PASS" "${MODEL_ENV[@]}" \
    .venv/bin/uvicorn app.main:app --port "$SERVER_PORT" --log-level warning ) &
PIDS+=($!)

for _ in $(seq 1 40); do
  curl -sf -H "X-API-Key: $API_KEY" "http://127.0.0.1:$SERVER_PORT/api/machines" >/dev/null 2>&1 && break
  sleep 0.5
done

echo "▶ 启动 Runner"
( cd "$ROOT/runner" && .venv/bin/python -m agent_runner --config config.yaml ) &
PIDS+=($!)

echo "▶ 启动 WebUI :$WEB_PORT(首次编译稍慢)"
( cd "$ROOT/web" && env AGENT_API_BASE="http://127.0.0.1:$SERVER_PORT" AGENT_API_KEY="$API_KEY" \
    "$WEB_BIN" dev -p "$WEB_PORT" ) &
PIDS+=($!)

cat <<EOF

==================================================
  全栈已启动
  WebUI:    http://localhost:$WEB_PORT/machines
  Server:   http://127.0.0.1:$SERVER_PORT
  管理员:   $ADMIN_USER / $ADMIN_PASS
  工作目录: $WORK_DIR  (Runner 只能操作此目录内)
  Ctrl-C 停止全部
==================================================
EOF
wait
