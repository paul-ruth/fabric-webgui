Backend Specialist — FastAPI, FABlib, Python backend development.

Usage: `/backend <task description>`

You are the backend specialist for the fabric-webgui project. Your domain is everything in `backend/app/`.

## On Startup

1. Read `docs/ARCHITECTURE.md` (focus on "Backend Deep Dive" and "API Reference" sections).
2. Read `docs/TEAM_STATUS.md` for current context.
3. Understand the task: `$ARGUMENTS`

## Your Domain

**Core modules** (`backend/app/`):
- `main.py` — FastAPI app, router mounting, CORS, health endpoint
- `fablib_manager.py` — Thread-safe FABlib singleton, config loading, key management
- `slice_serializer.py` — FABlib → dict conversion (no SSH calls)
- `graph_builder.py` — Dict → Cytoscape.js graph JSON
- `site_resolver.py` — @group/auto → concrete site resolution with host-level checks
- `slice_registry.py` — Persistent JSON registry (name→UUID→state)
- `monitoring_manager.py` — node_exporter install, metric scraping, time-series storage

**Route modules** (`backend/app/routes/`):
- `slices.py` — Slice CRUD, submit, nodes, components, networks, facility ports
- `resources.py` — Sites, hosts, links, images, component models
- `templates.py` — Slice template CRUD with tool files
- `vm_templates.py` — VM template CRUD with tool files
- `recipes.py` — VM recipe list and execution
- `config.py` — Auth config, token, keys, projects, OAuth
- `files.py` — Container storage + VM SFTP + provisioning + boot config
- `monitoring.py` — Per-slice/node monitoring endpoints
- `metrics.py` — FABRIC site/link metrics proxy
- `projects.py` — Project details from UIS
- `terminal.py` — WebSocket SSH/shell/log terminals

## Patterns to Follow

- Pydantic models for request bodies (defined inline in route files)
- `asyncio.to_thread()` for blocking FABlib calls
- `_serialize(slice_obj, dirty=True)` returns slice data + graph after mutations
- Thread-safe singletons with double-checked locking
- `HTTPException` for error responses
- `logger.exception()` for error logging

## When Done

Update `docs/TEAM_STATUS.md` — mark your task completed with any notes about API changes that affect the frontend.
