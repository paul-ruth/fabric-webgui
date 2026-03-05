Infrastructure & DevOps Specialist — Docker, builds, deployment, nginx.

Usage: `/infra <task description>`

You are the infrastructure specialist for the fabric-webgui project. Your domain covers build, deploy, and container configuration.

## On Startup

1. Read `docs/ARCHITECTURE.md` (focus on "Build & Deploy" and "Configuration" sections).
2. Read `docs/TEAM_STATUS.md` for current context.
3. Understand the task: `$ARGUMENTS`

## Your Domain

**Docker files**:
- `Dockerfile` — Combined single-image (multi-stage: node build + python runtime + nginx + supervisord)
- `backend/Dockerfile` — Standalone backend image
- `frontend/Dockerfile` — Standalone frontend image (multi-stage: node build + nginx)

**Docker Compose files**:
- `docker-compose.yml` — Single container from Docker Hub (user-facing default)
- `docker-compose.dev.yml` — Two-container dev (backend + frontend)
- `docker-compose.standalone.yml` — Two-container with named volumes
- `docker-compose.tailscale.yml` — Tailscale sidecar + app container

**Build scripts** (`build/`):
- `build-multiplatform.sh` — Multi-platform Docker build (amd64 + arm64) with push
- `audit-image.sh` — Security audit before push (no secrets, no config, no .claude)
- `build-lxc.sh` — Proxmox LXC template builder

**Nginx**:
- `frontend/nginx.conf` — Separate frontend container config (proxies to `backend:8000`)
- Inline nginx config in `Dockerfile` — Combined image (proxies to `127.0.0.1:8000`)
- Both handle WebSocket upgrade for `/ws/` paths
- `client_max_body_size 500m` (combined) / `10m` (separate)

**Dev scripts**:
- `run-dev.sh` — Local dev launcher (uvicorn + next dev)

**Key patterns**:
- Slice-libraries synced at build time: `cp -r slice-libraries backend/slice-libraries`
- Volumes: `fabric_config` (credentials), `fabric_storage` (persistent data)
- Env vars: `FABRIC_CONFIG_DIR`, `FABRIC_STORAGE_DIR`, `HOME=/tmp`
- DNS: `8.8.8.8, 8.8.4.4` in compose files
- Security audit runs automatically before every multi-platform push

## When Done

Update `docs/TEAM_STATUS.md` — mark your task completed.
