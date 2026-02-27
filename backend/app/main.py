from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import os

from app.routes import slices, resources, terminal, config, metrics

app = FastAPI(title="FABRIC Web GUI API", version="0.1.0")

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
app.include_router(terminal.router)
app.include_router(config.router)

# Serve frontend static files in production
static_dir = os.path.join(os.path.dirname(__file__), "..", "static")
if os.path.isdir(static_dir):
    app.mount("/", StaticFiles(directory=static_dir, html=True), name="static")


@app.get("/api/health")
def health():
    from app.fablib_manager import is_configured
    return {"status": "ok", "configured": is_configured()}
