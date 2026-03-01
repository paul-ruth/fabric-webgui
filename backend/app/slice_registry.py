"""Persistent slice registry — maps slice names to UUIDs, tracks state, supports archiving.

Registry file: ``FABRIC_STORAGE_DIR/.all_slices/registry.json``
"""

from __future__ import annotations

import json
import logging
import os
import threading
from datetime import datetime, timezone
from typing import Any

logger = logging.getLogger(__name__)

TERMINAL_STATES = {"Dead", "Closing", "StableError"}

_lock = threading.Lock()


def _registry_path() -> str:
    storage = os.environ.get("FABRIC_STORAGE_DIR", "/fabric_storage")
    d = os.path.join(storage, ".all_slices")
    os.makedirs(d, exist_ok=True)
    return os.path.join(d, "registry.json")


def _load() -> dict[str, Any]:
    path = _registry_path()
    if not os.path.isfile(path):
        return {"slices": {}}
    try:
        with open(path) as f:
            return json.load(f)
    except Exception:
        logger.warning("Could not read slice registry; starting fresh")
        return {"slices": {}}


def _save(data: dict[str, Any]) -> None:
    path = _registry_path()
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(data, f, indent=2)
    os.replace(tmp, path)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# --- Public API ---

def register_slice(name: str, uuid: str = "", state: str = "Draft", has_errors: bool | None = None) -> None:
    """Add or update a slice entry in the registry."""
    with _lock:
        reg = _load()
        now = _now()
        existing = reg["slices"].get(name)
        entry = {
            "uuid": uuid or (existing["uuid"] if existing else ""),
            "name": name,
            "state": state,
            "archived": False,
            "has_errors": has_errors if has_errors is not None else (existing.get("has_errors", False) if existing else False),
            "created_at": existing["created_at"] if existing else now,
            "updated_at": now,
        }
        reg["slices"][name] = entry
        _save(reg)


def update_slice_state(name: str, state: str, uuid: str = "", has_errors: bool | None = None) -> None:
    """Update state (and optionally UUID / has_errors) for a registered slice."""
    with _lock:
        reg = _load()
        entry = reg["slices"].get(name)
        if entry is None:
            entry = {
                "uuid": uuid,
                "name": name,
                "state": state,
                "archived": False,
                "has_errors": has_errors or False,
                "created_at": _now(),
                "updated_at": _now(),
            }
        else:
            entry["state"] = state
            entry["updated_at"] = _now()
            if uuid:
                # New UUID means a fresh submission — unarchive so it
                # appears in the list again even if an older slice with
                # the same name was previously archived.
                if uuid != entry.get("uuid"):
                    entry["archived"] = False
                entry["uuid"] = uuid
            if has_errors is not None:
                entry["has_errors"] = has_errors
        reg["slices"][name] = entry
        _save(reg)


def get_slice_uuid(name: str) -> str:
    """Return the UUID for a slice name, or empty string."""
    with _lock:
        reg = _load()
        entry = reg["slices"].get(name)
        return entry["uuid"] if entry else ""


def archive_slice(name: str) -> None:
    """Mark a slice as archived."""
    with _lock:
        reg = _load()
        entry = reg["slices"].get(name)
        if entry:
            entry["archived"] = True
            entry["updated_at"] = _now()
            _save(reg)


def archive_all_terminal() -> list[str]:
    """Archive all slices in terminal states. Returns list of archived names."""
    with _lock:
        reg = _load()
        archived = []
        for name, entry in reg["slices"].items():
            if not entry.get("archived") and entry.get("state") in TERMINAL_STATES:
                entry["archived"] = True
                entry["updated_at"] = _now()
                archived.append(name)
        if archived:
            _save(reg)
        return archived


def unregister_slice(name: str) -> None:
    """Remove a slice entry entirely (for draft deletion)."""
    with _lock:
        reg = _load()
        if name in reg["slices"]:
            del reg["slices"][name]
            _save(reg)


def get_all_entries(include_archived: bool = False) -> dict[str, dict[str, Any]]:
    """Return all registry entries, optionally including archived ones."""
    with _lock:
        reg = _load()
        if include_archived:
            return dict(reg["slices"])
        return {k: v for k, v in reg["slices"].items() if not v.get("archived")}


def bulk_register(entries: list[dict[str, Any]]) -> None:
    """Register many slices at once (single read/write cycle).

    Each entry dict should have: name, uuid, state, and optionally has_errors.
    """
    with _lock:
        reg = _load()
        now = _now()
        for e in entries:
            name = e["name"]
            existing = reg["slices"].get(name)
            reg["slices"][name] = {
                "uuid": e.get("uuid", "") or (existing["uuid"] if existing else ""),
                "name": name,
                "state": e.get("state", ""),
                "archived": existing.get("archived", False) if existing else False,
                "has_errors": e.get("has_errors", existing.get("has_errors", False) if existing else False),
                "created_at": existing["created_at"] if existing else now,
                "updated_at": now,
            }
        _save(reg)
