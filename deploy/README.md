# Production Compose Deployment

This folder is a deployment wrapper only. It builds the existing Server and WebUI from read-only source contexts and keeps runtime configuration in `.env` plus `models.yaml`.

## First Run

```bash
cd deploy
cp .env.example .env
cp models.example.yaml models.yaml
# Edit .env: set real passwords, API key, enrollment token, admin account, and model key.
docker compose up --build
```

For a local smoke test without TLS, set `PUBLIC_HOST=:80` in `.env` and open `http://localhost`. For production, set `PUBLIC_HOST` to a real DNS name such as `agent.example.com`; Caddy will terminate TLS automatically.

## Services

- `postgres`: persistent PostgreSQL volume.
- `server`: builds from `../server`, installs `asyncpg`, and uses `AGENT_DATABASE_URL=postgresql+asyncpg://...`.
- `web`: builds from `../web`, uses `AGENT_API_BASE=http://server:8700`, and serves with `next start`.
- `caddy`: exposes the WebUI, Runner enrollment, `/ws/runner`, and `/ws/client` for the WebUI realtime stream.

## Connector Sandbox (MCP)

MCP stdio connectors run as child processes inside the `server` container. The container is the sandbox boundary:

- runs as non-root user `agent` (see `server.Dockerfile`), with `nodejs/npm` and `uv` installed so `npx`/`uvx` preset connectors work;
- `cap_drop: ALL` + `no-new-privileges` + `pids_limit` + memory/CPU limits (`SERVER_MEM_LIMIT`, `SERVER_CPU_LIMIT` in `.env`);
- connector package caches persist in the `connector-cache` volume;
- the app layer additionally isolates env (only the connector's own variables are injected), enforces call timeouts, output caps, and optional per-connector approval.

`AGENT_SECRET_KEY` encrypts model/connector credentials at rest; set it once to a strong random value and never rotate it casually (existing ciphertexts become unreadable).

## Admin Login

The first admin is seeded from:

```text
AGENT_ADMIN_USERNAME
AGENT_ADMIN_PASSWORD
```

The server creates tables on startup in this first compose version. Alembic migration orchestration is intentionally outside this deploy wrapper.

## Runner Connection

In a runner `config.yaml`, point `server_url` at the public reverse-proxy origin:

```yaml
server_url: https://agent.example.com
machine_name: employee-mac
enrollment_token: <AGENT_ENROLLMENT_TOKEN>
allowed_roots:
  - /Users/alice/work
```

The reverse proxy exposes only the WebUI, Runner registration, `/ws/runner`, and the browser realtime `/ws/client` endpoint. Management REST calls from the browser continue through the WebUI server-side proxy.

## Stop And Upgrade

```bash
docker compose down
docker compose pull
docker compose up --build -d
```

PostgreSQL and Caddy state are kept in named volumes.
