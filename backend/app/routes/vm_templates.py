"""VM Template management API routes.

VM templates store per-node configurations (image + boot config) that can
be applied when creating or editing nodes.  Storage layout:

    FABRIC_STORAGE_DIR/.vm_templates/{sanitized_name}/vm-template.json
    FABRIC_STORAGE_DIR/.vm_templates/{sanitized_name}/tools/  (optional scripts)
"""

from __future__ import annotations

import hashlib
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
    return os.path.join(storage, ".vm_templates")


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
    {
        "name": "GPU + CUDA Host",
        "description": "Ubuntu 22.04 with NVIDIA drivers, CUDA 12.6 toolkit, and PyTorch. Add a GPU component (e.g. GPU_RTX6000) to the node.",
        "image": "default_ubuntu_22",
        "builtin": True,
        "boot_config": {
            "uploads": [],
            "commands": [
                {"id": "1", "command": "sudo apt-get update", "order": 0},
                {"id": "2", "command": "sudo apt-get install -y nvidia-driver-535", "order": 1},
                {
                    "id": "3",
                    "command": (
                        "wget https://developer.download.nvidia.com/compute/cuda/repos/ubuntu2204/x86_64/cuda-keyring_1.1-1_all.deb && "
                        "sudo dpkg -i cuda-keyring_1.1-1_all.deb && sudo apt-get update && "
                        "sudo apt-get install -y cuda-toolkit-12-6"
                    ),
                    "order": 2,
                },
                {
                    "id": "4",
                    "command": "echo 'export PATH=/usr/local/cuda-12.6/bin:$PATH' >> ~/.bashrc && echo 'export LD_LIBRARY_PATH=/usr/local/cuda-12.6/lib64:$LD_LIBRARY_PATH' >> ~/.bashrc",
                    "order": 3,
                },
                {
                    "id": "5",
                    "command": "pip3 install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121",
                    "order": 4,
                },
            ],
            "network": [],
        },
    },
    {
        "name": "NVMe Storage Node",
        "description": "Ubuntu 22.04 with NVMe P4510 formatted ext4 and mounted at /mnt/nvme. Add an NVME_P4510 component to the node.",
        "image": "default_ubuntu_22",
        "builtin": True,
        "boot_config": {
            "uploads": [],
            "commands": [
                {"id": "1", "command": "sudo apt-get update", "order": 0},
                {"id": "2", "command": "sudo apt-get install -y nvme-cli", "order": 1},
                {
                    "id": "3",
                    "command": "NVME_DEV=$(lsblk -d -n -o NAME | grep nvme | head -1) && [ -n \"$NVME_DEV\" ] && sudo mkfs.ext4 /dev/$NVME_DEV",
                    "order": 2,
                },
                {
                    "id": "4",
                    "command": "NVME_DEV=$(lsblk -d -n -o NAME | grep nvme | head -1) && [ -n \"$NVME_DEV\" ] && sudo mkdir -p /mnt/nvme && sudo mount /dev/$NVME_DEV /mnt/nvme && sudo chown $(whoami):$(whoami) /mnt/nvme",
                    "order": 3,
                },
            ],
            "network": [],
        },
    },
    {
        "name": "Prometheus Node Exporter",
        "description": "Rocky 8 with Docker running Prometheus node_exporter on port 9100 for metrics collection",
        "image": "default_rocky_8",
        "builtin": True,
        "boot_config": {
            "uploads": [],
            "commands": [
                {"id": "1", "command": "sudo dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo", "order": 0},
                {"id": "2", "command": "sudo dnf install -y docker-ce docker-ce-cli containerd.io", "order": 1},
                {"id": "3", "command": "sudo systemctl enable docker && sudo systemctl start docker", "order": 2},
                {
                    "id": "4",
                    "command": "sudo docker run -d --name node-exporter --restart always --net host --pid host -v /:/host:ro,rslave prom/node-exporter --path.rootfs=/host",
                    "order": 3,
                },
            ],
            "network": [],
        },
    },
    {
        "name": "Ollama LLM Server",
        "description": "Ubuntu 22.04 with Ollama + Open WebUI. Requires GPU component. Recommended: 16 cores, 32 GB RAM, 100 GB disk.",
        "image": "default_ubuntu_22",
        "builtin": True,
        "boot_config": {
            "uploads": [],
            "commands": [
                {"id": "1", "command": "sudo apt-get update", "order": 0},
                {"id": "2", "command": "sudo apt-get install -y nvidia-driver-535", "order": 1},
                {"id": "3", "command": "curl -fsSL https://ollama.com/install.sh | sh", "order": 2},
                {"id": "4", "command": "ollama pull llama3.2:3b", "order": 3},
                {"id": "5", "command": "sudo apt-get install -y docker.io && sudo systemctl enable docker && sudo systemctl start docker", "order": 4},
                {
                    "id": "6",
                    "command": "sudo docker run -d --name open-webui --restart always -p 3000:8080 -e OLLAMA_BASE_URL=http://127.0.0.1:11434 -v open-webui:/app/backend/data ghcr.io/open-webui/open-webui:main",
                    "order": 5,
                },
            ],
            "network": [],
        },
    },
    {
        "name": "DPDK Host",
        "description": "Ubuntu 22.04 with DPDK 23.11 built from source and hugepages configured. Needs ConnectX-5/6 SmartNIC component.",
        "image": "default_ubuntu_22",
        "builtin": True,
        "boot_config": {
            "uploads": [],
            "commands": [
                {"id": "1", "command": "sudo apt-get update", "order": 0},
                {
                    "id": "2",
                    "command": "sudo apt-get install -y build-essential meson ninja-build python3-pyelftools libnuma-dev pkg-config",
                    "order": 1,
                },
                {
                    "id": "3",
                    "command": (
                        "cd /opt && sudo wget https://fast.dpdk.org/rel/dpdk-23.11.tar.xz && "
                        "sudo tar xf dpdk-23.11.tar.xz && cd dpdk-23.11 && "
                        "sudo meson setup build && cd build && sudo ninja && sudo ninja install && sudo ldconfig"
                    ),
                    "order": 2,
                },
                {
                    "id": "4",
                    "command": "sudo bash -c 'echo 1024 > /sys/kernel/mm/hugepages/hugepages-2048kB/nr_hugepages' && sudo mkdir -p /mnt/huge && sudo mount -t hugetlbfs nodev /mnt/huge",
                    "order": 3,
                },
            ],
            "network": [],
        },
    },
    {
        "name": "P4 BMv2 Switch",
        "description": "Ubuntu 20.04 with P4 behavioral model (BMv2) software switch in Docker. Add NIC_Basic components for data-plane ports.",
        "image": "default_ubuntu_20",
        "builtin": True,
        "boot_config": {
            "uploads": [],
            "commands": [
                {"id": "1", "command": "sudo apt-get update", "order": 0},
                {"id": "2", "command": "sudo apt-get install -y docker.io && sudo systemctl enable docker && sudo systemctl start docker", "order": 1},
                {"id": "3", "command": "sudo docker pull pruth/fabric-images:0.0.2j", "order": 2},
            ],
            "network": [],
        },
    },
    {
        "name": "Kubernetes Node",
        "description": "Ubuntu 22.04 with containerd + kubeadm/kubelet/kubectl installed and ready to join or init a cluster",
        "image": "default_ubuntu_22",
        "builtin": True,
        "_tools": [
            {
                "filename": "k8s_setup.sh",
                "content": """#!/bin/bash
set -e

# Disable swap
sudo swapoff -a
sudo sed -i '/swap/d' /etc/fstab

# Load kernel modules
cat <<MODEOF | sudo tee /etc/modules-load.d/k8s.conf
overlay
br_netfilter
MODEOF
sudo modprobe overlay
sudo modprobe br_netfilter

# Sysctl params
cat <<SYSEOF | sudo tee /etc/sysctl.d/k8s.conf
net.bridge.bridge-nf-call-iptables  = 1
net.bridge.bridge-nf-call-ip6tables = 1
net.ipv4.ip_forward                 = 1
SYSEOF
sudo sysctl --system

# Install containerd
sudo apt-get update
sudo apt-get install -y containerd
sudo mkdir -p /etc/containerd
containerd config default | sudo tee /etc/containerd/config.toml
sudo sed -i 's/SystemdCgroup = false/SystemdCgroup = true/' /etc/containerd/config.toml
sudo systemctl restart containerd
sudo systemctl enable containerd

# Install kubeadm, kubelet, kubectl
sudo apt-get install -y apt-transport-https ca-certificates curl gpg
curl -fsSL https://pkgs.k8s.io/core:/stable:/v1.29/deb/Release.key | sudo gpg --dearmor -o /etc/apt/keyrings/kubernetes-apt-keyring.gpg
echo 'deb [signed-by=/etc/apt/keyrings/kubernetes-apt-keyring.gpg] https://pkgs.k8s.io/core:/stable:/v1.29/deb/ /' | sudo tee /etc/apt/sources.list.d/kubernetes.list
sudo apt-get update
sudo apt-get install -y kubelet kubeadm kubectl
sudo apt-mark hold kubelet kubeadm kubectl
sudo systemctl enable kubelet

echo "Kubernetes node ready. Run 'sudo kubeadm init' on controller or 'sudo kubeadm join ...' on workers."
""",
            }
        ],
        "boot_config": {
            "uploads": [],
            "commands": [
                {"id": "1", "command": "chmod +x ~/tools/k8s_setup.sh && ~/tools/k8s_setup.sh", "order": 0},
            ],
            "network": [],
        },
    },
    {
        "name": "iPerf3 Test Node",
        "description": "Rocky 8 with Docker and iperf3 container for network bandwidth testing",
        "image": "default_rocky_8",
        "builtin": True,
        "boot_config": {
            "uploads": [],
            "commands": [
                {"id": "1", "command": "sudo dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo", "order": 0},
                {"id": "2", "command": "sudo dnf install -y docker-ce docker-ce-cli containerd.io", "order": 1},
                {"id": "3", "command": "sudo systemctl enable docker && sudo systemctl start docker", "order": 2},
                {"id": "4", "command": "sudo docker pull networkstatic/iperf3", "order": 3},
            ],
            "network": [],
        },
    },
]


def _vm_template_hash(tmpl: dict) -> str:
    """Compute a hash of a builtin VM template for change detection."""
    hashable = {
        "image": tmpl.get("image", ""),
        "boot_config": tmpl.get("boot_config", {}),
        "_tools": tmpl.get("_tools", []),
    }
    return hashlib.sha256(json.dumps(hashable, sort_keys=True).encode()).hexdigest()[:16]


def _seed_if_needed() -> None:
    """Create or update seed VM templates.

    For each builtin template:
    - Creates it if the directory doesn't exist.
    - Re-writes it if the on-disk data differs from the code
      (detected via a hash stored in vm-template.json).
    """
    tdir = _vm_templates_dir()
    os.makedirs(tdir, exist_ok=True)
    for tmpl in SEED_TEMPLATES:
        safe = _sanitize_name(tmpl["name"])
        tmpl_dir = os.path.join(tdir, safe)
        code_hash = _vm_template_hash(tmpl)

        # Check if existing template needs updating
        needs_write = True
        if os.path.isdir(tmpl_dir):
            tmpl_path = os.path.join(tmpl_dir, "vm-template.json")
            if os.path.isfile(tmpl_path):
                try:
                    with open(tmpl_path) as f:
                        existing = json.load(f)
                    if existing.get("model_hash") == code_hash:
                        needs_write = False
                except Exception:
                    pass  # corrupted, re-write

        if not needs_write:
            continue

        os.makedirs(tmpl_dir, exist_ok=True)
        data = {
            "name": tmpl["name"],
            "description": tmpl["description"],
            "image": tmpl["image"],
            "builtin": True,
            "created": datetime.now(timezone.utc).isoformat(),
            "boot_config": tmpl["boot_config"],
            "model_hash": code_hash,
        }
        with open(os.path.join(tmpl_dir, "vm-template.json"), "w") as f:
            json.dump(data, f, indent=2)
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

    shutil.rmtree(tmpl_dir)
    return {"status": "deleted", "name": name}
