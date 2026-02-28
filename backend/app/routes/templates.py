"""Template management API routes."""

from __future__ import annotations

import json
import os
import re
import shutil
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.routes.slices import build_slice_model, import_slice, SliceModelImport

router = APIRouter(prefix="/api/templates", tags=["templates"])


def _templates_dir() -> str:
    storage = os.environ.get("FABRIC_STORAGE_DIR", "/fabric_storage")
    return os.path.join(storage, ".templates")


def _sanitize_name(name: str) -> str:
    """Sanitize template name to safe directory name."""
    safe = re.sub(r"[^a-zA-Z0-9_\-]", "_", name.strip())
    if not safe:
        raise HTTPException(status_code=400, detail="Invalid template name")
    return safe


def _validate_path(base: str, name: str) -> str:
    """Return full path for template dir, with traversal protection."""
    path = os.path.realpath(os.path.join(base, name))
    if not path.startswith(os.path.realpath(base)):
        raise HTTPException(status_code=400, detail="Invalid template name")
    return path


class SaveTemplateRequest(BaseModel):
    name: str
    description: str = ""
    slice_name: str


class UpdateTemplateRequest(BaseModel):
    description: str


class LoadTemplateRequest(BaseModel):
    slice_name: str = ""


@router.get("")
def list_templates() -> list[dict[str, Any]]:
    """List all saved templates."""
    tdir = _templates_dir()
    if not os.path.isdir(tdir):
        return []
    results = []
    for entry in sorted(os.listdir(tdir)):
        meta_path = os.path.join(tdir, entry, "metadata.json")
        if os.path.isfile(meta_path):
            try:
                with open(meta_path) as f:
                    meta = json.load(f)
                meta["dir_name"] = entry
                results.append(meta)
            except Exception:
                pass
    return results


@router.post("")
def save_template(req: SaveTemplateRequest) -> dict[str, Any]:
    """Save current slice as a reusable template."""
    safe_name = _sanitize_name(req.name)
    tdir = _templates_dir()
    os.makedirs(tdir, exist_ok=True)
    tmpl_dir = _validate_path(tdir, safe_name)

    if os.path.isdir(tmpl_dir):
        raise HTTPException(status_code=409, detail=f"Template '{req.name}' already exists")

    try:
        model = build_slice_model(req.slice_name)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to export slice: {e}")

    # Override the name in the model to use the template name
    model["name"] = req.name

    os.makedirs(tmpl_dir, exist_ok=True)
    with open(os.path.join(tmpl_dir, "template.fabric.json"), "w") as f:
        json.dump(model, f, indent=2)

    metadata = {
        "name": req.name,
        "description": req.description,
        "source_slice": req.slice_name,
        "created": datetime.now(timezone.utc).isoformat(),
        "node_count": len(model.get("nodes", [])),
        "network_count": len(model.get("networks", [])),
    }
    with open(os.path.join(tmpl_dir, "metadata.json"), "w") as f:
        json.dump(metadata, f, indent=2)

    return metadata


@router.post("/{name}/load")
def load_template(name: str, req: LoadTemplateRequest) -> dict[str, Any]:
    """Load a template as a new draft slice."""
    safe_name = _sanitize_name(name)
    tdir = _templates_dir()
    tmpl_dir = _validate_path(tdir, safe_name)

    tmpl_path = os.path.join(tmpl_dir, "template.fabric.json")
    if not os.path.isfile(tmpl_path):
        raise HTTPException(status_code=404, detail=f"Template '{name}' not found")

    with open(tmpl_path) as f:
        model_data = json.load(f)

    # Use provided slice name or fall back to template name
    slice_name = req.slice_name.strip() if req.slice_name else model_data.get("name", name)
    model_data["name"] = slice_name

    model = SliceModelImport(**model_data)
    return import_slice(model)


@router.delete("/{name}")
def delete_template(name: str) -> dict[str, str]:
    """Delete a template."""
    safe_name = _sanitize_name(name)
    tdir = _templates_dir()
    tmpl_dir = _validate_path(tdir, safe_name)

    if not os.path.isdir(tmpl_dir):
        raise HTTPException(status_code=404, detail=f"Template '{name}' not found")

    shutil.rmtree(tmpl_dir)
    return {"status": "deleted", "name": name}


@router.put("/{name}")
def update_template(name: str, req: UpdateTemplateRequest) -> dict[str, Any]:
    """Update template metadata (description)."""
    safe_name = _sanitize_name(name)
    tdir = _templates_dir()
    tmpl_dir = _validate_path(tdir, safe_name)

    meta_path = os.path.join(tmpl_dir, "metadata.json")
    if not os.path.isfile(meta_path):
        raise HTTPException(status_code=404, detail=f"Template '{name}' not found")

    with open(meta_path) as f:
        metadata = json.load(f)

    metadata["description"] = req.description

    with open(meta_path, "w") as f:
        json.dump(metadata, f, indent=2)

    return metadata
