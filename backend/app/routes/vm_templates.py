"""VM Template management API routes.

VM templates store per-node configurations (image + boot config) that can
be applied when creating or editing nodes.  Storage layout:

    FABRIC_STORAGE_DIR/.vm-templates/{sanitized_name}/vm-template.json
"""

from __future__ import annotations

import json
import os
import re
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/api/vm-templates", tags=["vm-templates"])


def _vm_templates_dir() -> str:
    storage = os.environ.get("FABRIC_STORAGE_DIR", "/fabric_storage")
    return os.path.join(storage, ".vm-templates")


def _sanitize_name(name: str) -> str:
    safe = re.sub(r"[^a-zA-Z0-9_\-]", "_", name.strip())
    if not safe:
        raise HTTPException(status_code=400, detail="Invalid template name")
    return safe


def _validate_path(base: str, name: str) -> str:
    path = os.path.realpath(os.path.join(base, name))
    if not path.startswith(os.path.realpath(base)):
        raise HTTPException(status_code=400, detail="Invalid template name")
    return path


# ---------------------------------------------------------------------------
# Seed templates
# ---------------------------------------------------------------------------

SEED_TEMPLATES: list[dict[str, Any]] = [
    {
        "name": "Docker Host",
        "description": "Ubuntu 22.04 with Docker CE installed and ready to use",
        "image": "default_ubuntu_22",
        "builtin": True,
        "boot_config": {
            "uploads": [],
            "commands": [
                {"id": "1", "command": "sudo apt-get update", "order": 0},
                {"id": "2", "command": "sudo apt-get install -y docker.io", "order": 1},
                {"id": "3", "command": "sudo systemctl enable docker", "order": 2},
                {"id": "4", "command": "sudo systemctl start docker", "order": 3},
                {"id": "5", "command": "sudo usermod -aG docker ubuntu", "order": 4},
            ],
            "network": [],
        },
    },
    {
        "name": "OVS Switch",
        "description": "Ubuntu 22.04 with Open vSwitch bridge (br0) auto-configured",
        "image": "default_ubuntu_22",
        "builtin": True,
        "boot_config": {
            "uploads": [],
            "commands": [
                {"id": "1", "command": "sudo apt-get update", "order": 0},
                {"id": "2", "command": "sudo apt-get install -y openvswitch-switch", "order": 1},
                {"id": "3", "command": "sudo ovs-vsctl add-br br0", "order": 2},
                {
                    "id": "4",
                    "command": (
                        "for iface in $(ip -o link show | awk -F': ' '{print $2}' "
                        "| grep -v -E '^(lo|eth0|ens3|docker|br|ovs|veth)'); do "
                        "sudo ovs-vsctl add-port br0 $iface; done"
                    ),
                    "order": 3,
                },
            ],
            "network": [],
        },
    },
    {
        "name": "FRR Router",
        "description": "Ubuntu 22.04 with FRRouting (OSPF + Zebra) and IP forwarding enabled",
        "image": "default_ubuntu_22",
        "builtin": True,
        "boot_config": {
            "uploads": [],
            "commands": [
                {"id": "1", "command": "sudo apt-get update", "order": 0},
                {"id": "2", "command": "sudo apt-get install -y frr", "order": 1},
                {
                    "id": "3",
                    "command": "sudo sed -i 's/ospfd=no/ospfd=yes/' /etc/frr/daemons && sudo sed -i 's/zebra=no/zebra=yes/' /etc/frr/daemons",
                    "order": 2,
                },
                {"id": "4", "command": "sudo systemctl restart frr", "order": 3},
                {"id": "5", "command": "sudo sysctl -w net.ipv4.ip_forward=1", "order": 4},
            ],
            "network": [],
        },
    },
]


def _seed_if_needed() -> None:
    """Create seed VM templates if the directory doesn't exist yet."""
    tdir = _vm_templates_dir()
    if os.path.isdir(tdir):
        return
    os.makedirs(tdir, exist_ok=True)
    for tmpl in SEED_TEMPLATES:
        safe = _sanitize_name(tmpl["name"])
        tmpl_dir = os.path.join(tdir, safe)
        os.makedirs(tmpl_dir, exist_ok=True)
        data = {
            "name": tmpl["name"],
            "description": tmpl["description"],
            "image": tmpl["image"],
            "builtin": True,
            "created": datetime.now(timezone.utc).isoformat(),
            "boot_config": tmpl["boot_config"],
        }
        with open(os.path.join(tmpl_dir, "vm-template.json"), "w") as f:
            json.dump(data, f, indent=2)


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------

class CreateVMTemplateRequest(BaseModel):
    name: str
    description: str = ""
    image: str = "default_ubuntu_22"
    boot_config: dict = {}


class UpdateVMTemplateRequest(BaseModel):
    description: str | None = None
    image: str | None = None
    boot_config: dict | None = None


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("")
def list_vm_templates() -> list[dict[str, Any]]:
    """List all VM templates (summary: no boot_config)."""
    _seed_if_needed()
    tdir = _vm_templates_dir()
    if not os.path.isdir(tdir):
        return []
    results = []
    for entry in sorted(os.listdir(tdir)):
        tmpl_path = os.path.join(tdir, entry, "vm-template.json")
        if os.path.isfile(tmpl_path):
            try:
                with open(tmpl_path) as f:
                    data = json.load(f)
                results.append({
                    "name": data.get("name", entry),
                    "description": data.get("description", ""),
                    "image": data.get("image", ""),
                    "created": data.get("created", ""),
                    "builtin": data.get("builtin", False),
                    "dir_name": entry,
                })
            except Exception:
                pass
    return results


@router.get("/{name}")
def get_vm_template(name: str) -> dict[str, Any]:
    """Get full VM template detail including boot_config."""
    _seed_if_needed()
    safe = _sanitize_name(name)
    tdir = _vm_templates_dir()
    tmpl_dir = _validate_path(tdir, safe)
    tmpl_path = os.path.join(tmpl_dir, "vm-template.json")
    if not os.path.isfile(tmpl_path):
        raise HTTPException(status_code=404, detail=f"VM template '{name}' not found")
    with open(tmpl_path) as f:
        data = json.load(f)
    data["dir_name"] = safe
    return data


@router.post("")
def create_vm_template(req: CreateVMTemplateRequest) -> dict[str, Any]:
    """Create a new VM template."""
    _seed_if_needed()
    safe = _sanitize_name(req.name)
    tdir = _vm_templates_dir()
    os.makedirs(tdir, exist_ok=True)
    tmpl_dir = _validate_path(tdir, safe)

    if os.path.isdir(tmpl_dir):
        raise HTTPException(status_code=409, detail=f"VM template '{req.name}' already exists")

    os.makedirs(tmpl_dir, exist_ok=True)
    data = {
        "name": req.name,
        "description": req.description,
        "image": req.image,
        "builtin": False,
        "created": datetime.now(timezone.utc).isoformat(),
        "boot_config": req.boot_config,
    }
    with open(os.path.join(tmpl_dir, "vm-template.json"), "w") as f:
        json.dump(data, f, indent=2)
    return data


@router.put("/{name}")
def update_vm_template(name: str, req: UpdateVMTemplateRequest) -> dict[str, Any]:
    """Update a VM template."""
    safe = _sanitize_name(name)
    tdir = _vm_templates_dir()
    tmpl_dir = _validate_path(tdir, safe)
    tmpl_path = os.path.join(tmpl_dir, "vm-template.json")
    if not os.path.isfile(tmpl_path):
        raise HTTPException(status_code=404, detail=f"VM template '{name}' not found")

    with open(tmpl_path) as f:
        data = json.load(f)

    if req.description is not None:
        data["description"] = req.description
    if req.image is not None:
        data["image"] = req.image
    if req.boot_config is not None:
        data["boot_config"] = req.boot_config

    with open(tmpl_path, "w") as f:
        json.dump(data, f, indent=2)

    data["dir_name"] = safe
    return data


@router.delete("/{name}")
def delete_vm_template(name: str) -> dict[str, str]:
    """Delete a VM template (builtins cannot be deleted)."""
    import shutil

    safe = _sanitize_name(name)
    tdir = _vm_templates_dir()
    tmpl_dir = _validate_path(tdir, safe)
    tmpl_path = os.path.join(tmpl_dir, "vm-template.json")

    if not os.path.isdir(tmpl_dir):
        raise HTTPException(status_code=404, detail=f"VM template '{name}' not found")

    if os.path.isfile(tmpl_path):
        with open(tmpl_path) as f:
            data = json.load(f)
        if data.get("builtin"):
            raise HTTPException(status_code=403, detail="Cannot delete built-in VM template")

    shutil.rmtree(tmpl_dir)
    return {"status": "deleted", "name": name}
