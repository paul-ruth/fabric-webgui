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
# Builtin slice templates
# ---------------------------------------------------------------------------

SEED_SLICE_TEMPLATES: list[dict[str, Any]] = [
    {
        "name": "Hello FABRIC",
        "description": "Simplest possible slice — one Ubuntu 22.04 node. Great starting point for tutorials.",
        "model": {
            "format": "fabric-slice-v1",
            "name": "Hello FABRIC",
            "nodes": [
                {
                    "name": "node1",
                    "site": "auto",
                    "cores": 2,
                    "ram": 8,
                    "disk": 10,
                    "image": "default_ubuntu_22",
                    "components": [],
                }
            ],
            "networks": [],
        },
    },
    {
        "name": "L2 Point-to-Point",
        "description": "Two nodes on the same site connected by an L2Bridge with manual IP configuration.",
        "model": {
            "format": "fabric-slice-v1",
            "name": "L2 Point-to-Point",
            "nodes": [
                {
                    "name": "node1",
                    "site": "@lan",
                    "cores": 2,
                    "ram": 8,
                    "disk": 10,
                    "image": "default_ubuntu_22",
                    "components": [{"name": "nic1", "model": "NIC_Basic"}],
                },
                {
                    "name": "node2",
                    "site": "@lan",
                    "cores": 2,
                    "ram": 8,
                    "disk": 10,
                    "image": "default_ubuntu_22",
                    "components": [{"name": "nic1", "model": "NIC_Basic"}],
                },
            ],
            "networks": [
                {
                    "name": "lan",
                    "type": "L2Bridge",
                    "interfaces": ["node1-nic1-p1", "node2-nic1-p1"],
                }
            ],
        },
    },
    {
        "name": "Wide-Area L2 Network",
        "description": "Two nodes at different sites connected by an L2STS (site-to-site) network for cross-site L2 connectivity.",
        "model": {
            "format": "fabric-slice-v1",
            "name": "Wide-Area L2 Network",
            "nodes": [
                {
                    "name": "node-a",
                    "site": "@wan-a",
                    "cores": 2,
                    "ram": 8,
                    "disk": 10,
                    "image": "default_ubuntu_22",
                    "components": [{"name": "nic1", "model": "NIC_Basic"}],
                },
                {
                    "name": "node-b",
                    "site": "@wan-b",
                    "cores": 2,
                    "ram": 8,
                    "disk": 10,
                    "image": "default_ubuntu_22",
                    "components": [{"name": "nic1", "model": "NIC_Basic"}],
                },
            ],
            "networks": [
                {
                    "name": "wan-l2",
                    "type": "L2STS",
                    "interfaces": ["node-a-nic1-p1", "node-b-nic1-p1"],
                }
            ],
        },
    },
    {
        "name": "iPerf3 Bandwidth Test",
        "description": "Two Docker nodes at different sites connected by FABNetv4. Server runs iperf3 -s, client has iperf3 pulled.",
        "model": {
            "format": "fabric-slice-v1",
            "name": "iPerf3 Bandwidth Test",
            "nodes": [
                {
                    "name": "iperf-server",
                    "site": "@perf-a",
                    "cores": 4,
                    "ram": 8,
                    "disk": 10,
                    "vm_template": "iPerf3 Test Node",
                    "boot_config": {
                        "uploads": [],
                        "commands": [
                            {
                                "id": "run-server",
                                "command": "sudo docker run -d --name iperf3-server --restart always --net host networkstatic/iperf3 -s",
                                "order": 10,
                            },
                        ],
                        "network": [],
                    },
                    "components": [{"name": "FABNET", "model": "NIC_Basic"}],
                },
                {
                    "name": "iperf-client",
                    "site": "@perf-b",
                    "cores": 4,
                    "ram": 8,
                    "disk": 10,
                    "vm_template": "iPerf3 Test Node",
                    "components": [{"name": "FABNET", "model": "NIC_Basic"}],
                },
            ],
            "networks": [
                {
                    "name": "net",
                    "type": "FABNetv4",
                    "interfaces": ["iperf-server-FABNET-p1", "iperf-client-FABNET-p1"],
                }
            ],
        },
    },
    {
        "name": "Prometheus + Grafana Stack",
        "description": "3-node monitoring stack: 1 monitor (Prometheus + Grafana in Docker) and 2 target nodes running node_exporter.",
        "_tools": [
            {
                "filename": "prometheus.yml",
                "content": """global:
  scrape_interval: 15s

scrape_configs:
  - job_name: 'prometheus'
    static_configs:
      - targets: ['localhost:9090']
  - job_name: 'node'
    static_configs:
      - targets: ['localhost:9100']
      # Add target node IPs after slice is active
""",
            }
        ],
        "model": {
            "format": "fabric-slice-v1",
            "name": "Prometheus + Grafana Stack",
            "nodes": [
                {
                    "name": "monitor",
                    "site": "@cluster",
                    "cores": 4,
                    "ram": 16,
                    "disk": 50,
                    "image": "default_docker_rocky_8",
                    "boot_config": {
                        "uploads": [],
                        "commands": [
                            {"id": "1", "command": "sudo systemctl start docker", "order": 0},
                            {"id": "2", "command": "sudo mkdir -p /etc/prometheus && sudo cp ~/tools/prometheus.yml /etc/prometheus/prometheus.yml", "order": 1},
                            {
                                "id": "3",
                                "command": "sudo docker run -d --name prometheus --restart always --net host -v /etc/prometheus:/etc/prometheus prom/prometheus",
                                "order": 2,
                            },
                            {
                                "id": "4",
                                "command": "sudo docker run -d --name grafana --restart always -p 3000:3000 grafana/grafana",
                                "order": 3,
                            },
                        ],
                        "network": [],
                    },
                    "components": [{"name": "FABNET", "model": "NIC_Basic"}],
                },
                {
                    "name": "target1",
                    "site": "@cluster",
                    "cores": 2,
                    "ram": 8,
                    "disk": 10,
                    "vm_template": "Prometheus Node Exporter",
                    "components": [{"name": "FABNET", "model": "NIC_Basic"}],
                },
                {
                    "name": "target2",
                    "site": "@cluster",
                    "cores": 2,
                    "ram": 8,
                    "disk": 10,
                    "vm_template": "Prometheus Node Exporter",
                    "components": [{"name": "FABNET", "model": "NIC_Basic"}],
                },
            ],
            "networks": [
                {
                    "name": "monitoring-net",
                    "type": "FABNetv4",
                    "interfaces": ["monitor-FABNET-p1", "target1-FABNET-p1", "target2-FABNET-p1"],
                }
            ],
        },
    },
    {
        "name": "FRR OSPF Triangle",
        "description": "3 FRR routers in a triangle topology with 3 host nodes. OSPF routing with IP forwarding enabled.",
        "model": {
            "format": "fabric-slice-v1",
            "name": "FRR OSPF Triangle",
            "nodes": [
                {
                    "name": "router1",
                    "site": "@site",
                    "cores": 2,
                    "ram": 4,
                    "disk": 10,
                    "vm_template": "FRR Router",
                    "components": [
                        {"name": "nic-r2", "model": "NIC_Basic"},
                        {"name": "nic-r3", "model": "NIC_Basic"},
                        {"name": "nic-lan", "model": "NIC_Basic"},
                    ],
                },
                {
                    "name": "router2",
                    "site": "@site",
                    "cores": 2,
                    "ram": 4,
                    "disk": 10,
                    "vm_template": "FRR Router",
                    "components": [
                        {"name": "nic-r1", "model": "NIC_Basic"},
                        {"name": "nic-r3", "model": "NIC_Basic"},
                        {"name": "nic-lan", "model": "NIC_Basic"},
                    ],
                },
                {
                    "name": "router3",
                    "site": "@site",
                    "cores": 2,
                    "ram": 4,
                    "disk": 10,
                    "vm_template": "FRR Router",
                    "components": [
                        {"name": "nic-r1", "model": "NIC_Basic"},
                        {"name": "nic-r2", "model": "NIC_Basic"},
                        {"name": "nic-lan", "model": "NIC_Basic"},
                    ],
                },
                {
                    "name": "host1",
                    "site": "@site",
                    "cores": 2,
                    "ram": 4,
                    "disk": 10,
                    "image": "default_ubuntu_22",
                    "components": [{"name": "nic1", "model": "NIC_Basic"}],
                },
                {
                    "name": "host2",
                    "site": "@site",
                    "cores": 2,
                    "ram": 4,
                    "disk": 10,
                    "image": "default_ubuntu_22",
                    "components": [{"name": "nic1", "model": "NIC_Basic"}],
                },
                {
                    "name": "host3",
                    "site": "@site",
                    "cores": 2,
                    "ram": 4,
                    "disk": 10,
                    "image": "default_ubuntu_22",
                    "components": [{"name": "nic1", "model": "NIC_Basic"}],
                },
            ],
            "networks": [
                {
                    "name": "link-r1-r2",
                    "type": "L2Bridge",
                    "interfaces": ["router1-nic-r2-p1", "router2-nic-r1-p1"],
                },
                {
                    "name": "link-r2-r3",
                    "type": "L2Bridge",
                    "interfaces": ["router2-nic-r3-p1", "router3-nic-r2-p1"],
                },
                {
                    "name": "link-r1-r3",
                    "type": "L2Bridge",
                    "interfaces": ["router1-nic-r3-p1", "router3-nic-r1-p1"],
                },
                {
                    "name": "lan1",
                    "type": "L2Bridge",
                    "interfaces": ["router1-nic-lan-p1", "host1-nic1-p1"],
                },
                {
                    "name": "lan2",
                    "type": "L2Bridge",
                    "interfaces": ["router2-nic-lan-p1", "host2-nic1-p1"],
                },
                {
                    "name": "lan3",
                    "type": "L2Bridge",
                    "interfaces": ["router3-nic-lan-p1", "host3-nic1-p1"],
                },
            ],
        },
    },
    {
        "name": "P4 BMv2 Lab",
        "description": "2 BMv2 software switches and 2 hosts connected via L2Bridge networks for P4 programming experiments.",
        "model": {
            "format": "fabric-slice-v1",
            "name": "P4 BMv2 Lab",
            "nodes": [
                {
                    "name": "switch1",
                    "site": "@lab",
                    "cores": 4,
                    "ram": 8,
                    "disk": 20,
                    "vm_template": "P4 BMv2 Switch",
                    "components": [
                        {"name": "nic-host", "model": "NIC_Basic"},
                        {"name": "nic-sw2", "model": "NIC_Basic"},
                    ],
                },
                {
                    "name": "switch2",
                    "site": "@lab",
                    "cores": 4,
                    "ram": 8,
                    "disk": 20,
                    "vm_template": "P4 BMv2 Switch",
                    "components": [
                        {"name": "nic-host", "model": "NIC_Basic"},
                        {"name": "nic-sw1", "model": "NIC_Basic"},
                    ],
                },
                {
                    "name": "host1",
                    "site": "@lab",
                    "cores": 2,
                    "ram": 4,
                    "disk": 10,
                    "image": "default_ubuntu_22",
                    "components": [{"name": "nic1", "model": "NIC_Basic"}],
                },
                {
                    "name": "host2",
                    "site": "@lab",
                    "cores": 2,
                    "ram": 4,
                    "disk": 10,
                    "image": "default_ubuntu_22",
                    "components": [{"name": "nic1", "model": "NIC_Basic"}],
                },
            ],
            "networks": [
                {
                    "name": "sw-link",
                    "type": "L2Bridge",
                    "interfaces": ["switch1-nic-sw2-p1", "switch2-nic-sw1-p1"],
                },
                {
                    "name": "host1-link",
                    "type": "L2Bridge",
                    "interfaces": ["switch1-nic-host-p1", "host1-nic1-p1"],
                },
                {
                    "name": "host2-link",
                    "type": "L2Bridge",
                    "interfaces": ["switch2-nic-host-p1", "host2-nic1-p1"],
                },
            ],
        },
    },
    {
        "name": "Kubernetes Cluster",
        "description": "3-node K8s cluster: 1 controller + 2 workers connected by FABNetv4. containerd + kubeadm pre-installed.",
        "model": {
            "format": "fabric-slice-v1",
            "name": "Kubernetes Cluster",
            "nodes": [
                {
                    "name": "controller",
                    "site": "@k8s",
                    "cores": 4,
                    "ram": 16,
                    "disk": 50,
                    "vm_template": "Kubernetes Node",
                    "components": [{"name": "FABNET", "model": "NIC_Basic"}],
                },
                {
                    "name": "worker1",
                    "site": "@k8s",
                    "cores": 4,
                    "ram": 16,
                    "disk": 50,
                    "vm_template": "Kubernetes Node",
                    "components": [{"name": "FABNET", "model": "NIC_Basic"}],
                },
                {
                    "name": "worker2",
                    "site": "@k8s",
                    "cores": 4,
                    "ram": 16,
                    "disk": 50,
                    "vm_template": "Kubernetes Node",
                    "components": [{"name": "FABNET", "model": "NIC_Basic"}],
                },
            ],
            "networks": [
                {
                    "name": "k8s-net",
                    "type": "FABNetv4",
                    "interfaces": ["controller-FABNET-p1", "worker1-FABNET-p1", "worker2-FABNET-p1"],
                }
            ],
        },
    },
    {
        "name": "GPU Compute Pair",
        "description": "2 GPU nodes at different sites connected by L2STS. RTX6000 GPUs with NVIDIA drivers pre-installed.",
        "model": {
            "format": "fabric-slice-v1",
            "name": "GPU Compute Pair",
            "nodes": [
                {
                    "name": "gpu-node1",
                    "site": "@gpu-a",
                    "cores": 8,
                    "ram": 32,
                    "disk": 100,
                    "vm_template": "GPU + CUDA Host",
                    "components": [
                        {"name": "gpu1", "model": "GPU_RTX6000"},
                        {"name": "nic1", "model": "NIC_Basic"},
                    ],
                },
                {
                    "name": "gpu-node2",
                    "site": "@gpu-b",
                    "cores": 8,
                    "ram": 32,
                    "disk": 100,
                    "vm_template": "GPU + CUDA Host",
                    "components": [
                        {"name": "gpu1", "model": "GPU_RTX6000"},
                        {"name": "nic1", "model": "NIC_Basic"},
                    ],
                },
            ],
            "networks": [
                {
                    "name": "gpu-link",
                    "type": "L2STS",
                    "interfaces": ["gpu-node1-nic1-p1", "gpu-node2-nic1-p1"],
                }
            ],
        },
    },
    {
        "name": "Ollama LLM Service",
        "description": "GPU server running Ollama + Open WebUI with a client node. Connected via FABNetv4.",
        "model": {
            "format": "fabric-slice-v1",
            "name": "Ollama LLM Service",
            "nodes": [
                {
                    "name": "llm-server",
                    "site": "@llm",
                    "cores": 16,
                    "ram": 32,
                    "disk": 100,
                    "vm_template": "Ollama LLM Server",
                    "components": [
                        {"name": "gpu1", "model": "GPU_RTX6000"},
                        {"name": "FABNET", "model": "NIC_Basic"},
                    ],
                },
                {
                    "name": "client",
                    "site": "@llm",
                    "cores": 4,
                    "ram": 8,
                    "disk": 10,
                    "image": "default_ubuntu_22",
                    "components": [{"name": "FABNET", "model": "NIC_Basic"}],
                },
            ],
            "networks": [
                {
                    "name": "llm-net",
                    "type": "FABNetv4",
                    "interfaces": ["llm-server-FABNET-p1", "client-FABNET-p1"],
                }
            ],
        },
    },
]


def _template_hash(tmpl: dict) -> str:
    """Compute a hash of a builtin template's model and tools for change detection."""
    hashable = {
        "model": tmpl["model"],
        "_tools": tmpl.get("_tools", []),
    }
    return hashlib.sha256(json.dumps(hashable, sort_keys=True).encode()).hexdigest()[:16]


def _seed_if_needed() -> None:
    """Create or update seed slice templates.

    For each builtin template:
    - Creates it if the directory doesn't exist.
    - Re-writes it if the on-disk model differs from the code
      (detected via a hash stored in metadata).
    """
    tdir = _templates_dir()
    os.makedirs(tdir, exist_ok=True)
    for idx, tmpl in enumerate(SEED_SLICE_TEMPLATES):
        safe = _sanitize_name(tmpl["name"])
        tmpl_dir = os.path.join(tdir, safe)
        model = tmpl["model"]
        code_hash = _template_hash(tmpl)

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
        with open(os.path.join(tmpl_dir, "template.fabric.json"), "w") as f:
            json.dump(model, f, indent=2)
        metadata = {
            "name": tmpl["name"],
            "description": tmpl.get("description", ""),
            "source_slice": "",
            "builtin": True,
            "created": datetime.now(timezone.utc).isoformat(),
            "node_count": len(model.get("nodes", [])),
            "network_count": len(model.get("networks", [])),
            "model_hash": code_hash,
            "order": idx,
        }
        with open(os.path.join(tmpl_dir, "metadata.json"), "w") as f:
            json.dump(metadata, f, indent=2)
        # Write tool scripts if present
        for tool_file in tmpl.get("_tools", []):
            tool_path = os.path.join(tmpl_dir, "tools", tool_file["filename"])
            os.makedirs(os.path.dirname(tool_path), exist_ok=True)
            with open(tool_path, "w") as f:
                f.write(tool_file["content"])
            os.chmod(tool_path, 0o755)


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------

class SaveTemplateRequest(BaseModel):
    name: str
    description: str = ""
    slice_name: str


class UpdateTemplateRequest(BaseModel):
    description: str


class LoadTemplateRequest(BaseModel):
    slice_name: str = ""


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
