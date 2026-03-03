"""Template management API routes."""

from __future__ import annotations

import hashlib
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
    return os.path.join(storage, ".slice_templates")


def _builtin_templates_dir() -> str:
    """Return the path to the builtin slice templates shipped with the repo."""
    # Check two candidate paths: inside backend (Docker) and repo root (local dev)
    base = os.path.dirname(__file__)
    for levels in [("..", ".."), ("..", "..", "..")]:
        candidate = os.path.realpath(os.path.join(base, *levels, "slice-libraries", "slice_templates"))
        if os.path.isdir(candidate):
            return candidate
    return os.path.join(base, "..", "..", "slice-libraries", "slice_templates")


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


# ---------------------------------------------------------------------------
# Builtin template helpers
# ---------------------------------------------------------------------------

def _builtin_hash(builtin_dir: str) -> str:
    """Compute a hash of a builtin template directory for change detection."""
    hashable: dict[str, Any] = {}
    tmpl_path = os.path.join(builtin_dir, "template.fabric.json")
    if os.path.isfile(tmpl_path):
        with open(tmpl_path) as f:
            hashable["model"] = json.load(f)
    tools_dir = os.path.join(builtin_dir, "tools")
    if os.path.isdir(tools_dir):
        tools = []
        for fn in sorted(os.listdir(tools_dir)):
            fp = os.path.join(tools_dir, fn)
            if os.path.isfile(fp):
                with open(fp) as f:
                    tools.append({"filename": fn, "content": f.read()})
        hashable["_tools"] = tools
    else:
        hashable["_tools"] = []
    return hashlib.sha256(json.dumps(hashable, sort_keys=True).encode()).hexdigest()[:16]


def _list_builtin_templates() -> list[dict[str, Any]]:
    """Scan the builtin templates directory and return metadata for each."""
    bdir = os.path.realpath(_builtin_templates_dir())
    if not os.path.isdir(bdir):
        return []
    results = []
    for entry in sorted(os.listdir(bdir)):
        entry_dir = os.path.join(bdir, entry)
        tmpl_path = os.path.join(entry_dir, "template.fabric.json")
        meta_path = os.path.join(entry_dir, "metadata.json")
        if os.path.isfile(tmpl_path) and os.path.isfile(meta_path):
            with open(meta_path) as f:
                meta = json.load(f)
            meta["_dir"] = entry_dir
            meta["_entry"] = entry
            results.append(meta)
    return results


def _seed_if_needed() -> None:
    """Create or update seed slice templates from the builtin templates directory.

    For each builtin template:
    - Creates it if the directory doesn't exist in storage.
    - Re-writes it if the on-disk model differs from the builtin
      (detected via a hash stored in metadata).
    - Removes stale builtins no longer in the templates directory.
    """
    tdir = _templates_dir()
    os.makedirs(tdir, exist_ok=True)

    builtins = _list_builtin_templates()
    current_names = {b["_entry"] for b in builtins}

    # Remove stale builtin templates no longer in the builtin directory
    if os.path.isdir(tdir):
        for entry in os.listdir(tdir):
            meta_path = os.path.join(tdir, entry, "metadata.json")
            if os.path.isfile(meta_path):
                try:
                    with open(meta_path) as f:
                        meta = json.load(f)
                    if meta.get("builtin") and entry not in current_names:
                        shutil.rmtree(os.path.join(tdir, entry))
                except Exception:
                    pass

    for builtin in builtins:
        entry = builtin["_entry"]
        builtin_dir = builtin["_dir"]
        tmpl_dir = os.path.join(tdir, entry)
        code_hash = _builtin_hash(builtin_dir)

        # Check if existing template needs updating
        needs_write = True
        if os.path.isdir(tmpl_dir):
            meta_path = os.path.join(tmpl_dir, "metadata.json")
            if os.path.isfile(meta_path):
                try:
                    with open(meta_path) as f:
                        meta = json.load(f)
                    if meta.get("model_hash") == code_hash and "order" in meta:
                        needs_write = False  # up-to-date
                except Exception:
                    pass  # corrupted metadata, re-write

        if not needs_write:
            continue

        os.makedirs(tmpl_dir, exist_ok=True)

        # Copy template.fabric.json
        shutil.copy2(
            os.path.join(builtin_dir, "template.fabric.json"),
            os.path.join(tmpl_dir, "template.fabric.json"),
        )

        # Build storage metadata (includes model_hash for change detection)
        with open(os.path.join(builtin_dir, "metadata.json")) as f:
            src_meta = json.load(f)
        metadata = {
            "name": src_meta["name"],
            "description": src_meta.get("description", ""),
            "source_slice": "",
            "builtin": True,
            "created": datetime.now(timezone.utc).isoformat(),
            "node_count": src_meta.get("node_count", 0),
            "network_count": src_meta.get("network_count", 0),
            "model_hash": code_hash,
            "order": src_meta.get("order", 999),
        }
        with open(os.path.join(tmpl_dir, "metadata.json"), "w") as f:
            json.dump(metadata, f, indent=2)

        # Copy tools/ directory if present
        src_tools = os.path.join(builtin_dir, "tools")
        dst_tools = os.path.join(tmpl_dir, "tools")
        if os.path.isdir(src_tools):
            if os.path.isdir(dst_tools):
                shutil.rmtree(dst_tools)
            shutil.copytree(src_tools, dst_tools)


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------

class SaveTemplateRequest(BaseModel):
    name: str
    description: str = ""
    slice_name: str


class UpdateTemplateRequest(BaseModel):
    description: str


class ToolFileBody(BaseModel):
    content: str


class LoadTemplateRequest(BaseModel):
    slice_name: str = ""


# ---------------------------------------------------------------------------
# Helper: list tool files for a template directory
# ---------------------------------------------------------------------------

def _list_tools(tmpl_dir: str) -> list[dict[str, str]]:
    """Return a sorted list of {filename} dicts for tools in a template dir."""
    tools_dir = os.path.join(tmpl_dir, "tools")
    if not os.path.isdir(tools_dir):
        return []
    return [{"filename": fn} for fn in sorted(os.listdir(tools_dir))
            if os.path.isfile(os.path.join(tools_dir, fn))]


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("")
def list_templates() -> list[dict[str, Any]]:
    """List all saved templates."""
    _seed_if_needed()
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
                # Ensure builtin field is present
                if "builtin" not in meta:
                    meta["builtin"] = False
                results.append(meta)
            except Exception:
                pass
    # Sort: built-in templates first (by order field), then user templates alphabetically
    results.sort(key=lambda m: (0, m.get("order", 999)) if m.get("builtin") else (1, m.get("name", "").lower()))
    return results


@router.post("")
def save_template(req: SaveTemplateRequest) -> dict[str, Any]:
    """Save current slice as a reusable template."""
    _seed_if_needed()
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
        "builtin": False,
        "created": datetime.now(timezone.utc).isoformat(),
        "node_count": len(model.get("nodes", [])),
        "network_count": len(model.get("networks", [])),
    }
    with open(os.path.join(tmpl_dir, "metadata.json"), "w") as f:
        json.dump(metadata, f, indent=2)

    return metadata


@router.post("/resync")
def resync_templates() -> list[dict[str, Any]]:
    """Force re-seed builtins, clean corrupted entries, and return updated list."""
    tdir = _templates_dir()
    os.makedirs(tdir, exist_ok=True)

    # Remove corrupted entries (dirs without valid metadata)
    if os.path.isdir(tdir):
        for entry in os.listdir(tdir):
            entry_dir = os.path.join(tdir, entry)
            if not os.path.isdir(entry_dir):
                continue
            meta_path = os.path.join(entry_dir, "metadata.json")
            tmpl_path = os.path.join(entry_dir, "template.fabric.json")
            if not os.path.isfile(meta_path) or not os.path.isfile(tmpl_path):
                shutil.rmtree(entry_dir)

    # Force re-seed by clearing model hashes so _seed_if_needed re-writes
    builtins = _list_builtin_templates()
    for builtin in builtins:
        entry = builtin["_entry"]
        meta_path = os.path.join(tdir, entry, "metadata.json")
        if os.path.isfile(meta_path):
            try:
                with open(meta_path) as f:
                    meta = json.load(f)
                meta.pop("model_hash", None)
                with open(meta_path, "w") as f:
                    json.dump(meta, f, indent=2)
            except Exception:
                pass

    _seed_if_needed()
    return list_templates()


@router.get("/{name}")
def get_template(name: str) -> dict[str, Any]:
    """Get full template detail including model JSON and tools listing."""
    _seed_if_needed()
    safe_name = _sanitize_name(name)
    tdir = _templates_dir()
    tmpl_dir = _validate_path(tdir, safe_name)

    meta_path = os.path.join(tmpl_dir, "metadata.json")
    tmpl_path = os.path.join(tmpl_dir, "template.fabric.json")
    if not os.path.isfile(meta_path) or not os.path.isfile(tmpl_path):
        raise HTTPException(status_code=404, detail=f"Template '{name}' not found")

    with open(meta_path) as f:
        metadata = json.load(f)
    with open(tmpl_path) as f:
        model = json.load(f)

    metadata["dir_name"] = safe_name
    metadata["model"] = model
    metadata["tools"] = _list_tools(tmpl_dir)
    return metadata


@router.post("/{name}/load")
def load_template(name: str, req: LoadTemplateRequest) -> dict[str, Any]:
    """Load a template as a new draft slice."""
    _seed_if_needed()
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

    # If this template has a tools/ directory, inject an upload entry into
    # each node's boot_config so the scripts are available at ~/tools
    tools_dir = os.path.join(tmpl_dir, "tools")
    if os.path.isdir(tools_dir) and os.listdir(tools_dir):
        for node_def in model_data.get("nodes", []):
            bc = node_def.get("boot_config")
            if bc and isinstance(bc, dict):
                uploads = bc.setdefault("uploads", [])
                uploads.insert(0, {
                    "id": "slice-tools",
                    "source": tools_dir,
                    "dest": "~/tools",
                })

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


# ---------------------------------------------------------------------------
# Tool file endpoints
# ---------------------------------------------------------------------------

def _validate_tool_filename(filename: str) -> str:
    """Sanitize and validate a tool filename."""
    safe = re.sub(r"[^a-zA-Z0-9_\-.]", "_", filename.strip())
    if not safe or safe.startswith("."):
        raise HTTPException(status_code=400, detail="Invalid tool filename")
    return safe


@router.get("/{name}/tools/{filename}")
def read_tool(name: str, filename: str) -> dict[str, str]:
    """Read a tool file's content."""
    safe_name = _sanitize_name(name)
    safe_file = _validate_tool_filename(filename)
    tdir = _templates_dir()
    tmpl_dir = _validate_path(tdir, safe_name)
    tool_path = os.path.join(tmpl_dir, "tools", safe_file)

    if not os.path.isfile(tool_path):
        raise HTTPException(status_code=404, detail=f"Tool file '{filename}' not found")

    with open(tool_path) as f:
        content = f.read()
    return {"filename": safe_file, "content": content}


@router.put("/{name}/tools/{filename}")
def write_tool(name: str, filename: str, body: ToolFileBody) -> dict[str, str]:
    """Create or update a tool file."""
    safe_name = _sanitize_name(name)
    safe_file = _validate_tool_filename(filename)
    tdir = _templates_dir()
    tmpl_dir = _validate_path(tdir, safe_name)

    if not os.path.isdir(tmpl_dir):
        raise HTTPException(status_code=404, detail=f"Template '{name}' not found")

    tools_dir = os.path.join(tmpl_dir, "tools")
    os.makedirs(tools_dir, exist_ok=True)
    tool_path = os.path.join(tools_dir, safe_file)

    with open(tool_path, "w") as f:
        f.write(body.content)
    return {"filename": safe_file, "status": "saved"}


@router.delete("/{name}/tools/{filename}")
def delete_tool(name: str, filename: str) -> dict[str, str]:
    """Delete a tool file."""
    safe_name = _sanitize_name(name)
    safe_file = _validate_tool_filename(filename)
    tdir = _templates_dir()
    tmpl_dir = _validate_path(tdir, safe_name)
    tool_path = os.path.join(tmpl_dir, "tools", safe_file)

    if not os.path.isfile(tool_path):
        raise HTTPException(status_code=404, detail=f"Tool file '{filename}' not found")

    os.remove(tool_path)
    return {"filename": safe_file, "status": "deleted"}
