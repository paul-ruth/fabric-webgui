from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import os

import asyncio
from contextlib import asynccontextmanager

from app.routes import slices, resources, terminal, config, metrics, files, templates, vm_templates, projects, monitoring, recipes, experiments, http_proxy, tunnels, ai_terminal, weave
from app.tunnel_manager import get_tunnel_manager


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup/shutdown lifecycle: periodic tunnel cleanup + shutdown."""
    mgr = get_tunnel_manager()

    async def _cleanup_loop():
        while True:
            await asyncio.sleep(60)
            mgr.cleanup_idle()

    task = asyncio.create_task(_cleanup_loop())
    yield
    task.cancel()
    mgr.close_all()


app = FastAPI(title="FABRIC Web GUI API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(slices.router, prefix="/api")
app.include_router(resources.router, prefix="/api")
app.include_router(metrics.router, prefix="/api")
app.include_router(ai_terminal.router)
app.include_router(weave.router)
app.include_router(terminal.router)
app.include_router(config.router)
app.include_router(files.router)
app.include_router(templates.router)
app.include_router(vm_templates.router)
app.include_router(projects.router)
app.include_router(monitoring.router)
app.include_router(recipes.router)
app.include_router(experiments.router)
app.include_router(http_proxy.router)
app.include_router(tunnels.router)

# Serve frontend static files in production
static_dir = os.path.join(os.path.dirname(__file__), "..", "static")
if os.path.isdir(static_dir):
    app.mount("/", StaticFiles(directory=static_dir, html=True), name="static")


@app.get("/api/health")
def health():
    from app.fablib_manager import is_configured
    return {"status": "ok", "configured": is_configured()}


# Fast 404 for /metrics — prevents Prometheus scraper from clogging the threadpool
@app.get("/metrics")
async def metrics_not_found():
    from fastapi.responses import PlainTextResponse
    return PlainTextResponse("Not Found", status_code=404)
