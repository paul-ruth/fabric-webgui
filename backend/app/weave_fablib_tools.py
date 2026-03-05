"""FABlib tools for Weave — shared between CLI and WebSocket versions.

Provides tool schemas (OpenAI function calling format) and handlers
for querying and managing FABRIC slices and resources.

Based on FABlib API: https://fabric-fablib.readthedocs.io/en/latest/
Source: https://github.com/fabric-testbed/fabrictestbed-extensions
"""
from __future__ import annotations

import json
import logging
import os
from typing import Any

logger = logging.getLogger(__name__)

# ── Tool Schemas ─────────────────────────────────────────────────────────────

FABLIB_TOOLS = [
    # ── Slice Management ────────────────────────────────────────────────────
    {"type": "function", "function": {
        "name": "fabric_list_slices",
        "description": (
            "List all FABRIC slices for the current project. "
            "Returns name, state, slice ID, and lease end for each slice."
        ),
        "parameters": {"type": "object", "properties": {}, "required": []},
    }},
    {"type": "function", "function": {
        "name": "fabric_get_slice",
        "description": (
            "Get detailed info about a specific slice including nodes, "
            "networks, interfaces, IPs, components, lease times, and errors."
        ),
        "parameters": {"type": "object", "properties": {
            "slice_name": {"type": "string", "description": "Name of the slice"},
        }, "required": ["slice_name"]},
    }},
    {"type": "function", "function": {
        "name": "fabric_create_slice",
        "description": (
            "Create a new FABRIC slice from a specification. Define nodes with "
            "resources, components (NICs, GPUs, FPGAs, NVMe, SmartNICs), and "
            "network connections. Does NOT submit — returns a preview. "
            "Use fabric_submit_slice to provision."
        ),
        "parameters": {"type": "object", "properties": {
            "slice_name": {"type": "string", "description": "Name for the new slice"},
            "nodes": {
                "type": "array",
                "description": "Array of node definitions",
                "items": {"type": "object", "properties": {
                    "name": {"type": "string", "description": "Unique node name"},
                    "site": {
                        "type": "string",
                        "description": (
                            "FABRIC site name (e.g. STAR, TACC, NCSA, UCSD, MASS, UTAH, DALL) "
                            "or 'auto' for automatic placement based on availability"
                        ),
                    },
                    "cores": {"type": "integer", "description": "CPU cores (1-128, default: 2)"},
                    "ram": {"type": "integer", "description": "RAM in GB (2-512, default: 8)"},
                    "disk": {"type": "integer", "description": "Disk in GB (10-500, default: 10)"},
                    "image": {
                        "type": "string",
                        "description": (
                            "VM image name. Common: default_ubuntu_22 (default), "
                            "default_ubuntu_24, default_ubuntu_20, default_rocky_9, "
                            "default_rocky_8, default_centos9_stream, default_debian_12, "
                            "default_fedora_40, docker_ubuntu_22, docker_rocky_9, "
                            "default_kali. Use fabric_list_images to see all."
                        ),
                    },
                    "nic_model": {
                        "type": "string",
                        "description": (
                            "NIC type for network connections. "
                            "NIC_Basic (default, shared 25Gbps ConnectX-6), "
                            "NIC_ConnectX_5 (dedicated 25Gbps SmartNIC), "
                            "NIC_ConnectX_6 (dedicated 100Gbps SmartNIC), "
                            "NIC_ConnectX_7_100 (dedicated 100Gbps), "
                            "NIC_ConnectX_7_400 (dedicated 400Gbps), "
                            "NIC_BlueField_2_ConnectX_6 (DPU SmartNIC)"
                        ),
                    },
                    "components": {
                        "type": "array",
                        "description": (
                            "Additional components to add. Each is {model, name}. "
                            "Models: GPU_RTX6000, GPU_TeslaT4, GPU_A30, GPU_A40, "
                            "FPGA_Xilinx_U280, FPGA_Xilinx_SN1022, NVME_P4510. "
                            "For GPUs/FPGAs use a descriptive name like 'gpu1'."
                        ),
                        "items": {"type": "object", "properties": {
                            "model": {"type": "string"},
                            "name": {"type": "string"},
                        }, "required": ["model", "name"]},
                    },
                    "fabnet": {
                        "type": "string",
                        "description": (
                            "Shorthand to add a FABNet L3 network. "
                            "'v4' for FABNetv4, 'v6' for FABNetv6, 'both' for dual-stack. "
                            "Automatically assigns IPs and routes. Simpler than manual networks."
                        ),
                    },
                    "post_boot_commands": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Shell commands to execute after boot (in order)",
                    },
                }, "required": ["name"]},
            },
            "networks": {
                "type": "array",
                "description": "Network definitions connecting nodes",
                "items": {"type": "object", "properties": {
                    "name": {"type": "string", "description": "Network name"},
                    "type": {
                        "type": "string",
                        "description": (
                            "Network type: "
                            "L2Bridge (same-site L2, default), "
                            "L2STS (cross-site L2), "
                            "L2PTP (point-to-point L2, exactly 2 interfaces), "
                            "FABNetv4 (cross-site routed IPv4), "
                            "FABNetv6 (cross-site routed IPv6), "
                            "FABNetv4Ext (publicly routable IPv4), "
                            "FABNetv6Ext (publicly routable IPv6)"
                        ),
                    },
                    "interfaces": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Node names to connect (one NIC interface per node)",
                    },
                    "subnet": {
                        "type": "string",
                        "description": "Optional CIDR subnet for L2 networks (e.g. 192.168.1.0/24)",
                    },
                }, "required": ["name", "type", "interfaces"]},
            },
        }, "required": ["slice_name", "nodes"]},
    }},
    {"type": "function", "function": {
        "name": "fabric_submit_slice",
        "description": (
            "Submit (provision) a draft slice on FABRIC. Allocates real resources "
            "and starts VMs. For small slices (1-2 nodes) set wait=true. "
            "For larger slices use wait=false and check with fabric_get_slice."
        ),
        "parameters": {"type": "object", "properties": {
            "slice_name": {"type": "string", "description": "Name of the slice to submit"},
            "wait": {
                "type": "boolean",
                "description": "Wait for provisioning (default: false). True waits up to 10 min.",
            },
        }, "required": ["slice_name"]},
    }},
    {"type": "function", "function": {
        "name": "fabric_modify_slice",
        "description": (
            "Modify a running slice — add or remove nodes, networks, and components. "
            "First call fabric_get_slice to inspect current state, then specify changes."
        ),
        "parameters": {"type": "object", "properties": {
            "slice_name": {"type": "string", "description": "Name of the running slice to modify"},
            "add_nodes": {
                "type": "array",
                "description": "Nodes to add (same format as fabric_create_slice nodes)",
                "items": {"type": "object", "properties": {
                    "name": {"type": "string"},
                    "site": {"type": "string"},
                    "cores": {"type": "integer"},
                    "ram": {"type": "integer"},
                    "disk": {"type": "integer"},
                    "image": {"type": "string"},
                }, "required": ["name"]},
            },
            "remove_nodes": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Names of nodes to remove",
            },
            "add_networks": {
                "type": "array",
                "description": "Networks to add",
                "items": {"type": "object", "properties": {
                    "name": {"type": "string"},
                    "type": {"type": "string"},
                    "interfaces": {"type": "array", "items": {"type": "string"}},
                    "subnet": {"type": "string"},
                }, "required": ["name", "type", "interfaces"]},
            },
            "remove_networks": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Names of networks to remove",
            },
            "wait": {"type": "boolean", "description": "Wait for modification to complete"},
        }, "required": ["slice_name"]},
    }},
    {"type": "function", "function": {
        "name": "fabric_delete_slice",
        "description": (
            "Delete a FABRIC slice and release all its resources. "
            "WARNING: This permanently destroys all VMs and data. "
            "Always confirm with the user before calling this."
        ),
        "parameters": {"type": "object", "properties": {
            "slice_name": {"type": "string", "description": "Name of the slice to delete"},
        }, "required": ["slice_name"]},
    }},
    {"type": "function", "function": {
        "name": "fabric_renew_slice",
        "description": "Extend the lease of a slice. Default extension is 7 days from now.",
        "parameters": {"type": "object", "properties": {
            "slice_name": {"type": "string", "description": "Name of the slice"},
            "days": {"type": "integer", "description": "Days to extend from now (default: 7, max: 14)"},
        }, "required": ["slice_name"]},
    }},
    {"type": "function", "function": {
        "name": "fabric_wait_slice",
        "description": (
            "Wait for a slice to reach stable state and SSH to become available. "
            "Use after fabric_submit_slice with wait=false."
        ),
        "parameters": {"type": "object", "properties": {
            "slice_name": {"type": "string", "description": "Name of the slice"},
            "timeout": {"type": "integer", "description": "Max seconds to wait (default: 600)"},
        }, "required": ["slice_name"]},
    }},
    # ── SSH & Execution ─────────────────────────────────────────────────────
    {"type": "function", "function": {
        "name": "fabric_slice_ssh",
        "description": (
            "Execute a shell command on a node via SSH. The slice must be in "
            "StableOK state. Returns stdout and stderr. Max output: 12KB."
        ),
        "parameters": {"type": "object", "properties": {
            "slice_name": {"type": "string", "description": "Name of the slice"},
            "node_name": {"type": "string", "description": "Name of the node"},
            "command": {"type": "string", "description": "Shell command to execute"},
        }, "required": ["slice_name", "node_name", "command"]},
    }},
    {"type": "function", "function": {
        "name": "fabric_upload_file",
        "description": (
            "Upload a file from the container to a node in a running slice. "
            "The local file must exist on the backend container filesystem."
        ),
        "parameters": {"type": "object", "properties": {
            "slice_name": {"type": "string", "description": "Name of the slice"},
            "node_name": {"type": "string", "description": "Name of the node"},
            "local_path": {"type": "string", "description": "Path to local file on the container"},
            "remote_path": {"type": "string", "description": "Destination path on the node (default: .)"},
        }, "required": ["slice_name", "node_name", "local_path"]},
    }},
    {"type": "function", "function": {
        "name": "fabric_download_file",
        "description": (
            "Download a file from a node to the container. "
            "Useful for retrieving results, logs, or data."
        ),
        "parameters": {"type": "object", "properties": {
            "slice_name": {"type": "string", "description": "Name of the slice"},
            "node_name": {"type": "string", "description": "Name of the node"},
            "remote_path": {"type": "string", "description": "Path on the node to download"},
            "local_path": {"type": "string", "description": "Destination path on the container"},
        }, "required": ["slice_name", "node_name", "remote_path", "local_path"]},
    }},
    {"type": "function", "function": {
        "name": "fabric_node_info",
        "description": (
            "Get detailed runtime info for a node including SSH command, "
            "management IP, dataplane IPs, OS interfaces, routes, components, "
            "and CPU/NUMA topology."
        ),
        "parameters": {"type": "object", "properties": {
            "slice_name": {"type": "string", "description": "Name of the slice"},
            "node_name": {"type": "string", "description": "Name of the node"},
        }, "required": ["slice_name", "node_name"]},
    }},
    # ── Site & Resource Queries ─────────────────────────────────────────────
    {"type": "function", "function": {
        "name": "fabric_list_sites",
        "description": (
            "List all FABRIC sites with available resources (cores, RAM, disk) "
            "and special components (GPUs, FPGAs, SmartNICs, NVMe). "
            "Pass a site name for detailed per-host info."
        ),
        "parameters": {"type": "object", "properties": {
            "site_name": {
                "type": "string",
                "description": "Optional: filter to a single site for detailed host-level info",
            },
        }, "required": []},
    }},
    {"type": "function", "function": {
        "name": "fabric_list_hosts",
        "description": (
            "List individual hosts at a FABRIC site with per-host resource availability. "
            "Useful for checking if a specific host can fit your VM."
        ),
        "parameters": {"type": "object", "properties": {
            "site_name": {"type": "string", "description": "FABRIC site name (e.g. STAR, TACC, NCSA)"},
        }, "required": ["site_name"]},
    }},
    {"type": "function", "function": {
        "name": "fabric_list_images",
        "description": (
            "List all available VM images with their default usernames and descriptions."
        ),
        "parameters": {"type": "object", "properties": {}, "required": []},
    }},
    {"type": "function", "function": {
        "name": "fabric_list_components",
        "description": (
            "List all available component models that can be added to nodes. "
            "Includes NICs, GPUs, FPGAs, SmartNICs, NVMe, and storage devices."
        ),
        "parameters": {"type": "object", "properties": {}, "required": []},
    }},
    {"type": "function", "function": {
        "name": "fabric_find_sites",
        "description": (
            "Find FABRIC sites that have specific resources available. "
            "Filter by minimum cores, RAM, disk, or specific components."
        ),
        "parameters": {"type": "object", "properties": {
            "min_cores": {"type": "integer", "description": "Minimum available cores"},
            "min_ram": {"type": "integer", "description": "Minimum available RAM in GB"},
            "min_disk": {"type": "integer", "description": "Minimum available disk in GB"},
            "component": {
                "type": "string",
                "description": (
                    "Required component model: GPU_RTX6000, GPU_TeslaT4, GPU_A30, GPU_A40, "
                    "FPGA_Xilinx_U280, FPGA_Xilinx_SN1022, NIC_ConnectX_5, NIC_ConnectX_6, "
                    "NIC_ConnectX_7_100, NIC_ConnectX_7_400, NVME_P4510"
                ),
            },
        }, "required": []},
    }},
    # ── Configuration ───────────────────────────────────────────────────────
    {"type": "function", "function": {
        "name": "fabric_get_config",
        "description": (
            "Show the current FABRIC configuration including project ID, token path, "
            "bastion host, key paths, log level, and other fabric_rc settings."
        ),
        "parameters": {"type": "object", "properties": {}, "required": []},
    }},
    {"type": "function", "function": {
        "name": "fabric_set_config",
        "description": (
            "Set a FABRIC configuration value. Updates fabric_rc and environment. "
            "Common keys: FABRIC_PROJECT_ID, FABRIC_TOKEN_LOCATION, "
            "FABRIC_BASTION_HOST, FABRIC_BASTION_USERNAME, FABRIC_LOG_LEVEL, "
            "FABRIC_AVOID, FABRIC_SLICE_PRIVATE_KEY_FILE, "
            "FABRIC_SLICE_PUBLIC_KEY_FILE."
        ),
        "parameters": {"type": "object", "properties": {
            "key": {"type": "string", "description": "Config key (e.g. FABRIC_PROJECT_ID)"},
            "value": {"type": "string", "description": "Value to set"},
        }, "required": ["key", "value"]},
    }},
    {"type": "function", "function": {
        "name": "fabric_load_rc",
        "description": (
            "Load FABRIC settings from a fabric_rc file. Reads 'export KEY=VALUE' "
            "lines and applies them to current configuration."
        ),
        "parameters": {"type": "object", "properties": {
            "path": {"type": "string", "description": "Path to the fabric_rc file"},
        }, "required": ["path"]},
    }},
    {"type": "function", "function": {
        "name": "fabric_list_projects",
        "description": (
            "List FABRIC projects the user belongs to from their token. "
            "Shows project name, UUID, and which is currently active."
        ),
        "parameters": {"type": "object", "properties": {}, "required": []},
    }},
    {"type": "function", "function": {
        "name": "fabric_set_project",
        "description": "Set the active FABRIC project by project ID or name.",
        "parameters": {"type": "object", "properties": {
            "project": {"type": "string", "description": "Project UUID or name"},
        }, "required": ["project"]},
    }},
    # ── Templates ───────────────────────────────────────────────────────────
    {"type": "function", "function": {
        "name": "fabric_list_templates",
        "description": (
            "List available slice templates (built-in and user-created). "
            "Templates are pre-built topologies that can be deployed quickly."
        ),
        "parameters": {"type": "object", "properties": {}, "required": []},
    }},
    {"type": "function", "function": {
        "name": "fabric_create_from_template",
        "description": (
            "Create a draft slice from a slice template. "
            "Does NOT submit — use fabric_submit_slice to provision."
        ),
        "parameters": {"type": "object", "properties": {
            "template_name": {
                "type": "string",
                "description": "Template directory name (from fabric_list_templates)",
            },
            "slice_name": {
                "type": "string",
                "description": "Name for the new slice (optional, defaults to template name)",
            },
        }, "required": ["template_name"]},
    }},
]


# ── Tool Handlers ────────────────────────────────────────────────────────────

def _get_fablib():
    """Get FABlib manager — works in both CLI and WebSocket contexts."""
    from app.fablib_manager import get_fablib
    return get_fablib()


def _format_site(site: dict) -> str:
    """Format a site dict into a readable summary."""
    comps = site.get("components", {})
    comp_strs = []
    for model, info in sorted(comps.items()):
        avail = info.get("available", 0)
        cap = info.get("capacity", 0)
        if cap > 0:
            comp_strs.append(f"{model}: {avail}/{cap}")

    line = (
        f"{site['name']:6s}  "
        f"cores={site.get('cores_available', 0)}/{site.get('cores_capacity', 0)}  "
        f"ram={site.get('ram_available', 0)}/{site.get('ram_capacity', 0)}GB  "
        f"disk={site.get('disk_available', 0)}/{site.get('disk_capacity', 0)}GB  "
        f"state={site.get('state', '?')}"
    )
    if comp_strs:
        line += f"  [{', '.join(comp_strs)}]"
    return line


def _format_host(host: dict) -> str:
    """Format a host dict into a readable summary."""
    comps = host.get("components", {})
    comp_strs = []
    for model, info in sorted(comps.items()):
        avail = info.get("available", 0)
        cap = info.get("capacity", 0)
        if cap > 0:
            comp_strs.append(f"{model}: {avail}/{cap}")

    line = (
        f"  {host.get('name', '?'):30s}  "
        f"cores={host.get('cores_available', 0)}/{host.get('cores_capacity', 0)}  "
        f"ram={host.get('ram_available', 0)}/{host.get('ram_capacity', 0)}GB  "
        f"disk={host.get('disk_available', 0)}/{host.get('disk_capacity', 0)}GB"
    )
    if comp_strs:
        line += f"  [{', '.join(comp_strs)}]"
    return line


# ── Slice management ─────────────────────────────────────────────────────────

def tool_fabric_list_slices() -> str:
    """List all slices for the current project."""
    try:
        fablib = _get_fablib()
        slices = fablib.get_slices()
        if not slices:
            return "No slices found."
        lines = [f"{'Name':30s}  {'State':15s}  {'Lease End':25s}  {'ID':36s}"]
        lines.append("-" * 110)
        for s in slices:
            name = s.get_name() or "?"
            state = str(s.get_state()) if s.get_state() else "?"
            sid = str(s.get_slice_id()) if hasattr(s, "get_slice_id") else ""
            lease_end = ""
            try:
                le = s.get_lease_end()
                if le:
                    lease_end = str(le)[:25]
            except Exception:
                pass
            lines.append(f"{name:30s}  {state:15s}  {lease_end:25s}  {sid}")
        return "\n".join(lines)
    except Exception as e:
        return f"Error listing slices: {e}"


def tool_fabric_get_slice(slice_name: str) -> str:
    """Get detailed information about a slice."""
    try:
        fablib = _get_fablib()
        s = fablib.get_slice(name=slice_name)
        state = str(s.get_state()) if s.get_state() else "?"
        sid = str(s.get_slice_id()) if hasattr(s, "get_slice_id") else ""

        lines = [
            f"Slice: {slice_name}",
            f"State: {state}",
            f"ID:    {sid}",
        ]

        # Lease info
        try:
            exp = s.get_lease_end()
            if exp:
                lines.append(f"Expires: {exp}")
        except Exception:
            pass

        # Nodes
        nodes = list(s.get_nodes())
        lines.append(f"\nNodes ({len(nodes)}):")
        for node in nodes:
            nname = node.get_name()
            site = node.get_site() or "?"
            host = ""
            try:
                host = node.get_host() or ""
            except Exception:
                pass
            nstate = str(node.get_reservation_state()) if hasattr(node, "get_reservation_state") else "?"
            cores = node.get_cores() if hasattr(node, "get_cores") else "?"
            ram = node.get_ram() if hasattr(node, "get_ram") else "?"
            disk = node.get_disk() if hasattr(node, "get_disk") else "?"
            image = ""
            try:
                image = node.get_image() or ""
            except Exception:
                pass
            username = ""
            try:
                username = node.get_username() or ""
            except Exception:
                pass
            mgmt_ip = ""
            try:
                mgmt_ip = node.get_management_ip() or ""
            except Exception:
                pass

            lines.append(f"  {nname} @ {site}  state={nstate}  {cores}c/{ram}GB/{disk}GB  image={image}")
            if host:
                lines.append(f"    host: {host}")
            if mgmt_ip:
                lines.append(f"    management_ip: {mgmt_ip}  user: {username}")

            # Interfaces
            try:
                for iface in node.get_interfaces():
                    iname = iface.get_name() if hasattr(iface, "get_name") else "?"
                    net = ""
                    try:
                        n = iface.get_network()
                        if n:
                            net = n.get_name()
                    except Exception:
                        pass
                    ip = ""
                    try:
                        fd = iface.get_fablib_data()
                        if fd and "addr" in fd:
                            ip = str(fd["addr"])
                    except Exception:
                        pass
                    mac = ""
                    try:
                        fim_iface = iface.get_fim()
                        if hasattr(fim_iface, 'label_allocations') and fim_iface.label_allocations:
                            mac = str(fim_iface.label_allocations.mac) if hasattr(fim_iface.label_allocations, 'mac') and fim_iface.label_allocations.mac else ""
                    except Exception:
                        pass
                    vlan = ""
                    try:
                        v = iface.get_vlan()
                        if v:
                            vlan = str(v)
                    except Exception:
                        pass
                    parts = [f"    iface: {iname}"]
                    if net:
                        parts.append(f"net={net}")
                    if ip:
                        parts.append(f"ip={ip}")
                    if mac:
                        parts.append(f"mac={mac}")
                    if vlan:
                        parts.append(f"vlan={vlan}")
                    lines.append("  ".join(parts))
            except Exception:
                pass

            # Components (GPUs, FPGAs, NVMe, etc.)
            try:
                for comp in node.get_components():
                    cname = comp.get_name() if hasattr(comp, "get_name") else "?"
                    cmodel = comp.get_model() if hasattr(comp, "get_model") else "?"
                    ctype = ""
                    try:
                        ctype = str(comp.get_type()) if comp.get_type() else ""
                    except Exception:
                        pass
                    pci = ""
                    try:
                        pci = comp.get_pci_addr() or ""
                    except Exception:
                        pass
                    cline = f"    component: {cname} ({cmodel})"
                    if pci:
                        cline += f" pci={pci}"
                    lines.append(cline)
            except Exception:
                pass

            # Error message
            try:
                em = node.get_error_message()
                if em:
                    lines.append(f"    ERROR: {em}")
            except Exception:
                pass

        # Networks
        try:
            nets = list(s.get_networks())
            if nets:
                lines.append(f"\nNetworks ({len(nets)}):")
                for net in nets:
                    netname = net.get_name()
                    ntype = str(net.get_type()) if hasattr(net, "get_type") else "?"
                    subnet = ""
                    try:
                        sub = net.get_subnet()
                        if sub:
                            subnet = str(sub)
                    except Exception:
                        pass
                    gateway = ""
                    try:
                        gw = net.get_gateway()
                        if gw:
                            gateway = str(gw)
                    except Exception:
                        pass
                    nline = f"  {netname}  type={ntype}"
                    if subnet:
                        nline += f"  subnet={subnet}"
                    if gateway:
                        nline += f"  gateway={gateway}"
                    lines.append(nline)
                    # Network interfaces
                    try:
                        for ni in net.get_interfaces():
                            ni_name = ni.get_name()
                            ni_ip = ""
                            try:
                                fd = ni.get_fablib_data()
                                if fd and "addr" in fd:
                                    ni_ip = str(fd["addr"])
                            except Exception:
                                pass
                            ni_node = ""
                            try:
                                nn = ni.get_node()
                                if nn:
                                    ni_node = nn.get_name()
                            except Exception:
                                pass
                            parts = [f"    {ni_name}"]
                            if ni_node:
                                parts.append(f"node={ni_node}")
                            if ni_ip:
                                parts.append(f"ip={ni_ip}")
                            lines.append("  ".join(parts))
                    except Exception:
                        pass
        except Exception:
            pass

        # Error messages
        try:
            errors = s.get_error_messages()
            if errors:
                lines.append("\nErrors:")
                for err in errors:
                    notice = err.get("notice", "") if isinstance(err, dict) else str(err)
                    if notice:
                        lines.append(f"  - {notice}")
        except Exception:
            pass

        return "\n".join(lines)
    except Exception as e:
        return f"Error getting slice '{slice_name}': {e}"


def _pick_auto_site(cores_needed: int = 2) -> str:
    """Pick a site with the most available cores."""
    try:
        from app.routes.resources import get_cached_sites
        sites = get_cached_sites()
        active = [
            s for s in sites
            if s.get("state") == "Active"
            and s.get("cores_available", 0) >= cores_needed
        ]
        if active:
            best = max(active, key=lambda s: s.get("cores_available", 0))
            return best["name"]
    except Exception:
        pass
    return "STAR"


# Component model name -> readable description for reference
_COMPONENT_MODELS = {
    "NIC_Basic": "Shared 25Gbps ConnectX-6 (1 port, default for basic networking)",
    "NIC_ConnectX_5": "Dedicated 25Gbps SmartNIC (2 ports, programmable)",
    "NIC_ConnectX_6": "Dedicated 100Gbps SmartNIC (2 ports, programmable)",
    "NIC_ConnectX_7_100": "Dedicated 100Gbps ConnectX-7 (2 ports)",
    "NIC_ConnectX_7_400": "Dedicated 400Gbps ConnectX-7 (2 ports)",
    "NIC_BlueField_2_ConnectX_6": "BlueField-2 DPU SmartNIC with ARM cores",
    "NIC_OpenStack": "OpenStack vNIC (management only, no data plane)",
    "GPU_RTX6000": "NVIDIA RTX 6000 (24GB VRAM, 4608 CUDA cores)",
    "GPU_TeslaT4": "NVIDIA Tesla T4 (16GB VRAM, inference-optimized)",
    "GPU_A30": "NVIDIA A30 (24GB HBM2, multi-instance GPU)",
    "GPU_A40": "NVIDIA A40 (48GB VRAM, visualization + compute)",
    "FPGA_Xilinx_U280": "Xilinx Alveo U280 (8GB HBM2, network processing)",
    "FPGA_Xilinx_SN1022": "Xilinx SN1022 SmartNIC FPGA",
    "NVME_P4510": "Intel P4510 NVMe SSD (1TB, high IOPS local storage)",
}


def tool_fabric_create_slice(
    slice_name: str,
    nodes: list[dict],
    networks: list[dict] | None = None,
) -> str:
    """Create a FABRIC slice with nodes and networks (does not submit)."""
    try:
        fablib = _get_fablib()
        s = fablib.new_slice(name=slice_name)

        # Track node objects and their NIC interfaces for network wiring
        node_map: dict[str, Any] = {}
        node_ifaces: dict[str, Any] = {}  # node_name -> first NIC interface

        for nspec in nodes:
            name = nspec["name"]
            site = nspec.get("site", "auto")
            cores = nspec.get("cores", 2)
            ram = nspec.get("ram", 8)
            disk = nspec.get("disk", 10)
            image = nspec.get("image", "default_ubuntu_22")

            # Resolve 'auto' site
            if not site or site.lower() == "auto":
                site = _pick_auto_site(cores)

            node = s.add_node(
                name=name,
                site=site,
                cores=cores,
                ram=ram,
                disk=disk,
                image=image,
            )
            node_map[name] = node

            # Add NIC if any networks reference this node
            nic_model = nspec.get("nic_model", "NIC_Basic")
            needs_nic = False
            if networks:
                for net in networks:
                    if name in net.get("interfaces", []):
                        needs_nic = True
                        break

            if needs_nic:
                nic = node.add_component(model=nic_model, name=f"{name}-nic1")
                ifaces = nic.get_interfaces()
                if ifaces:
                    node_ifaces[name] = ifaces[0]

            # Add extra components (GPUs, FPGAs, NVMe, etc.)
            for comp_spec in nspec.get("components", []):
                comp_model = comp_spec["model"]
                comp_name = comp_spec.get("name", f"{name}-{comp_model.lower()}")
                node.add_component(model=comp_model, name=comp_name)

            # Add FABNet shorthand
            fabnet = nspec.get("fabnet", "")
            if fabnet:
                if fabnet.lower() in ("v4", "ipv4", "both"):
                    node.add_fabnet(net_type="IPv4")
                if fabnet.lower() in ("v6", "ipv6", "both"):
                    node.add_fabnet(net_type="IPv6")

            # Add post-boot commands
            for cmd in nspec.get("post_boot_commands", []):
                node.add_post_boot_execute(cmd)

        # Create networks
        if networks:
            for nspec in networks:
                net_name = nspec["name"]
                net_type = nspec.get("type", "L2Bridge")
                iface_nodes = nspec.get("interfaces", [])
                subnet = nspec.get("subnet")
                ifaces = [node_ifaces[n] for n in iface_nodes if n in node_ifaces]

                if not ifaces:
                    continue

                if net_type in ("FABNetv4", "FABNetv6", "FABNetv4Ext", "FABNetv6Ext"):
                    ip_type = "IPv4" if "v4" in net_type.lower() else "IPv6"
                    s.add_l3network(name=net_name, interfaces=ifaces, type=ip_type)
                else:
                    kwargs: dict[str, Any] = {"name": net_name, "interfaces": ifaces, "type": net_type}
                    if subnet:
                        from ipaddress import IPv4Network
                        kwargs["subnet"] = IPv4Network(subnet)
                    s.add_l2network(**kwargs)

        # Persist draft to disk so the web UI picks it up on next refresh
        try:
            import re as _re
            storage = os.environ.get("FABRIC_STORAGE_DIR", "/fabric_storage")
            drafts_root = os.path.join(storage, ".drafts")
            safe = _re.sub(r'[^\w\-. ]', '_', slice_name).strip()
            draft_dir = os.path.join(drafts_root, safe)
            os.makedirs(draft_dir, exist_ok=True)
            s.save(os.path.join(draft_dir, "topology.graphml"))
            meta = {"name": slice_name, "project_id": os.environ.get("FABRIC_PROJECT_ID", "")}
            with open(os.path.join(draft_dir, "meta.json"), "w") as _f:
                json.dump(meta, _f)
            logger.info("Persisted Weave draft '%s' to %s", slice_name, draft_dir)
        except Exception:
            logger.warning("Could not persist draft '%s' to disk", slice_name, exc_info=True)

        # Summary
        node_list = list(s.get_nodes())
        net_list = list(s.get_networks())
        lines = [
            f"Slice '{slice_name}' created (draft — not yet submitted).",
            f"  Nodes: {len(node_list)}",
            f"  Networks: {len(net_list)}",
            "",
            "Nodes:",
        ]
        for n in node_list:
            comp_names = []
            try:
                for c in n.get_components():
                    comp_names.append(f"{c.get_model()}")
            except Exception:
                pass
            comp_str = f"  components=[{', '.join(comp_names)}]" if comp_names else ""
            lines.append(
                f"  {n.get_name()} @ {n.get_site()}  "
                f"{n.get_cores()}c/{n.get_ram()}GB/{n.get_disk()}GB  "
                f"image={n.get_image()}{comp_str}"
            )
        if net_list:
            lines.append("\nNetworks:")
            for net in net_list:
                lines.append(f"  {net.get_name()}  type={net.get_type()}")

        lines.append("\nUse fabric_submit_slice to provision this slice on FABRIC.")
        return "\n".join(lines)
    except Exception as e:
        return f"Error creating slice: {e}"


def tool_fabric_submit_slice(slice_name: str, wait: bool = False) -> str:
    """Submit a slice for provisioning."""
    try:
        fablib = _get_fablib()
        s = fablib.get_slice(name=slice_name)
        state = str(s.get_state()) if s.get_state() else ""

        if state in ("StableOK", "StableError"):
            return f"Slice '{slice_name}' is already provisioned (state: {state}). Use fabric_get_slice to inspect it."

        s.submit(wait=wait, wait_timeout=600 if wait else 60)

        new_state = str(s.get_state()) if s.get_state() else "Submitted"
        result = f"Slice '{slice_name}' submitted. State: {new_state}"

        if wait and new_state == "StableOK":
            result += "\n\nNodes are ready:"
            for node in s.get_nodes():
                mgmt_ip = ""
                try:
                    mgmt_ip = node.get_management_ip() or ""
                except Exception:
                    pass
                username = ""
                try:
                    username = node.get_username() or ""
                except Exception:
                    pass
                result += f"\n  {node.get_name()} @ {node.get_site()}  ip={mgmt_ip}  user={username}"
        elif not wait:
            result += "\n\nProvisioning in progress. Use fabric_get_slice or fabric_wait_slice to check."

        return result
    except Exception as e:
        return f"Error submitting slice '{slice_name}': {e}"


def tool_fabric_modify_slice(
    slice_name: str,
    add_nodes: list[dict] | None = None,
    remove_nodes: list[str] | None = None,
    add_networks: list[dict] | None = None,
    remove_networks: list[str] | None = None,
    wait: bool = True,
) -> str:
    """Modify a running slice — add or remove nodes/networks."""
    try:
        fablib = _get_fablib()
        # Always get the latest topology before modifying
        s = fablib.get_slice(name=slice_name)
        state = str(s.get_state()) if s.get_state() else ""

        if state not in ("StableOK", "StableError", "ModifyOK", "ModifyError"):
            return f"Slice '{slice_name}' is in state '{state}' — can only modify StableOK or StableError slices."

        changes = []

        # Remove networks first (before removing nodes that may have interfaces)
        for net_name in (remove_networks or []):
            try:
                net = s.get_network(name=net_name)
                net.delete()
                changes.append(f"Removed network: {net_name}")
            except Exception as e:
                changes.append(f"Error removing network {net_name}: {e}")

        # Remove nodes
        for node_name in (remove_nodes or []):
            try:
                node = s.get_node(name=node_name)
                node.delete()
                changes.append(f"Removed node: {node_name}")
            except Exception as e:
                changes.append(f"Error removing node {node_name}: {e}")

        # Add new nodes
        node_ifaces: dict[str, Any] = {}
        for nspec in (add_nodes or []):
            name = nspec["name"]
            site = nspec.get("site", "auto")
            cores = nspec.get("cores", 2)
            ram = nspec.get("ram", 8)
            disk = nspec.get("disk", 10)
            image = nspec.get("image", "default_ubuntu_22")

            if not site or site.lower() == "auto":
                site = _pick_auto_site(cores)

            node = s.add_node(name=name, site=site, cores=cores, ram=ram, disk=disk, image=image)

            # Check if new networks need NICs on this node
            nic_model = nspec.get("nic_model", "NIC_Basic")
            needs_nic = False
            if add_networks:
                for net in add_networks:
                    if name in net.get("interfaces", []):
                        needs_nic = True
                        break
            if needs_nic:
                nic = node.add_component(model=nic_model, name=f"{name}-nic1")
                ifaces = nic.get_interfaces()
                if ifaces:
                    node_ifaces[name] = ifaces[0]

            changes.append(f"Added node: {name} @ {site} ({cores}c/{ram}GB/{disk}GB)")

        # Add new networks
        for nspec in (add_networks or []):
            net_name = nspec["name"]
            net_type = nspec.get("type", "L2Bridge")
            iface_node_names = nspec.get("interfaces", [])
            subnet = nspec.get("subnet")

            # Collect interfaces — from new nodes or existing nodes
            ifaces = []
            for nn in iface_node_names:
                if nn in node_ifaces:
                    ifaces.append(node_ifaces[nn])
                else:
                    # Existing node — need to add a NIC component
                    try:
                        existing_node = s.get_node(name=nn)
                        nic = existing_node.add_component(model="NIC_Basic", name=f"{nn}-nic-mod")
                        nic_ifaces = nic.get_interfaces()
                        if nic_ifaces:
                            ifaces.append(nic_ifaces[0])
                    except Exception as e:
                        changes.append(f"Warning: could not add NIC to {nn}: {e}")

            if ifaces:
                if net_type in ("FABNetv4", "FABNetv6", "FABNetv4Ext", "FABNetv6Ext"):
                    ip_type = "IPv4" if "v4" in net_type.lower() else "IPv6"
                    s.add_l3network(name=net_name, interfaces=ifaces, type=ip_type)
                else:
                    kwargs: dict[str, Any] = {"name": net_name, "interfaces": ifaces, "type": net_type}
                    if subnet:
                        from ipaddress import IPv4Network
                        kwargs["subnet"] = IPv4Network(subnet)
                    s.add_l2network(**kwargs)
                changes.append(f"Added network: {net_name} ({net_type})")

        if not changes:
            return "No changes specified. Use add_nodes, remove_nodes, add_networks, or remove_networks."

        # Submit the modification
        s.submit(wait=wait, wait_timeout=600 if wait else 60)

        new_state = str(s.get_state()) if s.get_state() else "Modifying"
        lines = [f"Slice '{slice_name}' modified. State: {new_state}", "", "Changes:"]
        lines.extend(f"  - {c}" for c in changes)

        if not wait:
            lines.append("\nModification in progress. Use fabric_get_slice to check status.")

        return "\n".join(lines)
    except Exception as e:
        return f"Error modifying slice '{slice_name}': {e}"


def tool_fabric_delete_slice(slice_name: str) -> str:
    """Delete a slice."""
    try:
        fablib = _get_fablib()
        s = fablib.get_slice(name=slice_name)
        s.delete()
        return f"Slice '{slice_name}' deleted. All resources released."
    except Exception as e:
        return f"Error deleting slice '{slice_name}': {e}"


def tool_fabric_renew_slice(slice_name: str, days: int = 7) -> str:
    """Renew (extend) a slice's lease."""
    try:
        from datetime import datetime, timedelta
        fablib = _get_fablib()
        s = fablib.get_slice(name=slice_name)
        end_date = datetime.now() + timedelta(days=days)
        s.renew(end_date=end_date)
        return f"Slice '{slice_name}' renewed. New expiration: {end_date.strftime('%Y-%m-%d %H:%M')}"
    except Exception as e:
        return f"Error renewing slice '{slice_name}': {e}"


def tool_fabric_wait_slice(slice_name: str, timeout: int = 600) -> str:
    """Wait for a slice to reach stable state and SSH to become available."""
    try:
        fablib = _get_fablib()
        s = fablib.get_slice(name=slice_name)

        # Wait for stable state
        s.wait(timeout=timeout, progress=False)
        state = str(s.get_state()) if s.get_state() else "?"

        if state != "StableOK":
            # Check for errors
            errors = []
            try:
                for err in (s.get_error_messages() or []):
                    notice = err.get("notice", "")
                    if notice:
                        errors.append(str(notice))
            except Exception:
                pass
            result = f"Slice '{slice_name}' reached state: {state}"
            if errors:
                result += "\n\nErrors:\n" + "\n".join(f"  - {e}" for e in errors)
            return result

        # Wait for SSH
        ssh_ok = s.wait_ssh(timeout=min(timeout, 300), progress=False)

        lines = [f"Slice '{slice_name}' is ready (state: StableOK, SSH: {'OK' if ssh_ok else 'timeout'})"]
        lines.append("\nNodes:")
        for node in s.get_nodes():
            mgmt_ip = ""
            try:
                mgmt_ip = node.get_management_ip() or ""
            except Exception:
                pass
            username = ""
            try:
                username = node.get_username() or ""
            except Exception:
                pass
            lines.append(f"  {node.get_name()} @ {node.get_site()}  ip={mgmt_ip}  user={username}")

        return "\n".join(lines)
    except Exception as e:
        return f"Error waiting for slice '{slice_name}': {e}"


# ── SSH & Execution ──────────────────────────────────────────────────────────

def tool_fabric_slice_ssh(slice_name: str, node_name: str, command: str) -> str:
    """Execute a command on a slice node via SSH."""
    MAX_OUTPUT = 12_000
    try:
        fablib = _get_fablib()
        s = fablib.get_slice(name=slice_name)
        node = s.get_node(name=node_name)
        stdout, stderr = node.execute(command)
        output = ""
        if stdout:
            output += stdout
        if stderr:
            if output:
                output += "\n"
            output += stderr
        if not output.strip():
            output = "(no output)"
        if len(output) > MAX_OUTPUT:
            output = output[:MAX_OUTPUT] + "\n... (truncated)"
        return output
    except Exception as e:
        return f"Error executing on {node_name} in '{slice_name}': {e}"


def tool_fabric_upload_file(
    slice_name: str, node_name: str, local_path: str, remote_path: str = "."
) -> str:
    """Upload a file to a node."""
    try:
        if not os.path.isfile(local_path):
            return f"Error: Local file not found: {local_path}"
        fablib = _get_fablib()
        s = fablib.get_slice(name=slice_name)
        node = s.get_node(name=node_name)
        node.upload_file(local_path, remote_path)
        size = os.path.getsize(local_path)
        return f"Uploaded {local_path} ({size} bytes) to {node_name}:{remote_path}"
    except Exception as e:
        return f"Error uploading to {node_name}: {e}"


def tool_fabric_download_file(
    slice_name: str, node_name: str, remote_path: str, local_path: str
) -> str:
    """Download a file from a node."""
    try:
        fablib = _get_fablib()
        s = fablib.get_slice(name=slice_name)
        node = s.get_node(name=node_name)
        # Ensure local directory exists
        local_dir = os.path.dirname(local_path)
        if local_dir:
            os.makedirs(local_dir, exist_ok=True)
        node.download_file(local_path, remote_path)
        size = os.path.getsize(local_path) if os.path.isfile(local_path) else 0
        return f"Downloaded {node_name}:{remote_path} to {local_path} ({size} bytes)"
    except Exception as e:
        return f"Error downloading from {node_name}: {e}"


def tool_fabric_node_info(slice_name: str, node_name: str) -> str:
    """Get detailed runtime info for a specific node."""
    try:
        fablib = _get_fablib()
        s = fablib.get_slice(name=slice_name)
        node = s.get_node(name=node_name)

        lines = [f"Node: {node_name}"]
        lines.append(f"  Site: {node.get_site()}")

        try:
            lines.append(f"  Host: {node.get_host()}")
        except Exception:
            pass

        lines.append(f"  State: {node.get_reservation_state()}")
        lines.append(f"  Resources: {node.get_cores()}c / {node.get_ram()}GB RAM / {node.get_disk()}GB disk")
        lines.append(f"  Image: {node.get_image()}")

        try:
            lines.append(f"  Username: {node.get_username()}")
        except Exception:
            pass

        try:
            lines.append(f"  Management IP: {node.get_management_ip()}")
        except Exception:
            pass

        try:
            ssh_cmd = node.get_ssh_command()
            if ssh_cmd:
                lines.append(f"  SSH command: {ssh_cmd}")
        except Exception:
            pass

        # Components
        try:
            comps = list(node.get_components())
            if comps:
                lines.append(f"\n  Components ({len(comps)}):")
                for c in comps:
                    cline = f"    {c.get_name()}: {c.get_model()}"
                    try:
                        pci = c.get_pci_addr()
                        if pci:
                            cline += f"  pci={pci}"
                    except Exception:
                        pass
                    try:
                        numa = c.get_numa_node()
                        if numa:
                            cline += f"  numa={numa}"
                    except Exception:
                        pass
                    lines.append(cline)
        except Exception:
            pass

        # Interfaces with OS device names
        try:
            ifaces = list(node.get_interfaces())
            if ifaces:
                lines.append(f"\n  Interfaces ({len(ifaces)}):")
                for iface in ifaces:
                    iname = iface.get_name()
                    net = ""
                    try:
                        n = iface.get_network()
                        if n:
                            net = n.get_name()
                    except Exception:
                        pass
                    ip = ""
                    try:
                        fd = iface.get_fablib_data()
                        if fd and "addr" in fd:
                            ip = str(fd["addr"])
                    except Exception:
                        pass
                    os_dev = ""
                    try:
                        os_dev = iface.get_physical_os_interface_name() or ""
                    except Exception:
                        try:
                            os_dev = iface.get_device_name() or ""
                        except Exception:
                            pass
                    parts = [f"    {iname}"]
                    if net:
                        parts.append(f"net={net}")
                    if ip:
                        parts.append(f"ip={ip}")
                    if os_dev:
                        parts.append(f"dev={os_dev}")
                    lines.append("  ".join(parts))
        except Exception:
            pass

        return "\n".join(lines)
    except Exception as e:
        return f"Error getting node info for {node_name} in '{slice_name}': {e}"


# ── Site & Resource Queries ──────────────────────────────────────────────────

def tool_fabric_list_sites(site_name: str = "") -> str:
    """List FABRIC sites with available resources."""
    try:
        from app.routes.resources import get_cached_sites

        sites = get_cached_sites()

        if site_name:
            matches = [s for s in sites if s["name"].upper() == site_name.upper()]
            if not matches:
                return f"Site '{site_name}' not found. Use fabric_list_sites without arguments to see all sites."
            site = matches[0]
            lines = [_format_site(site), ""]

            hosts = site.get("hosts_detail", [])
            if hosts:
                lines.append(f"Hosts ({len(hosts)}):")
                for h in hosts:
                    lines.append(_format_host(h))
            return "\n".join(lines)

        lines = [f"{'Site':6s}  {'Cores':12s}  {'RAM':12s}  {'Disk':12s}  {'State':10s}  Components"]
        lines.append("-" * 100)
        for site in sorted(sites, key=lambda s: s["name"]):
            lines.append(_format_site(site))
        lines.append(f"\n{len(sites)} sites total")
        return "\n".join(lines)
    except Exception as e:
        return f"Error listing sites: {e}"


def tool_fabric_list_hosts(site_name: str) -> str:
    """List hosts at a specific FABRIC site."""
    try:
        from app.routes.resources import get_cached_sites

        sites = get_cached_sites()
        matches = [s for s in sites if s["name"].upper() == site_name.upper()]
        if not matches:
            return f"Site '{site_name}' not found."
        site = matches[0]
        hosts = site.get("hosts_detail", [])
        if not hosts:
            return f"No host details available for {site_name}."

        lines = [f"Hosts at {site_name} ({len(hosts)}):", ""]
        for h in hosts:
            lines.append(_format_host(h))
        return "\n".join(lines)
    except Exception as e:
        return f"Error listing hosts for '{site_name}': {e}"


def tool_fabric_list_images() -> str:
    """List all available VM images."""
    try:
        # Try Constants first (works without a FablibManager instance)
        try:
            from fabrictestbed_extensions.fablib.constants import Constants
            images = Constants.IMAGE_NAMES
        except Exception:
            fablib = _get_fablib()
            images = fablib.get_image_names()
        lines = [f"Available VM Images ({len(images)}):", ""]
        lines.append(f"{'Image Name':35s}  {'User':12s}  Description")
        lines.append("-" * 90)
        for name, info in sorted(images.items()):
            user = info.get("default_user", "?")
            desc = info.get("description", "")
            lines.append(f"{name:35s}  {user:12s}  {desc}")
        lines.append("")
        lines.append("Specify the image name in fabric_create_slice nodes[].image field.")
        return "\n".join(lines)
    except Exception as e:
        return f"Error listing images: {e}"


def tool_fabric_list_components() -> str:
    """List all available component models."""
    lines = [
        "Available Component Models:",
        "",
        "NICs (Network Interface Cards):",
        "  NIC_Basic          — Shared 25Gbps ConnectX-6 (1 port, default for basic networking)",
        "  NIC_ConnectX_5     — Dedicated 25Gbps SmartNIC (2 ports, programmable with DPDK/RDMA)",
        "  NIC_ConnectX_6     — Dedicated 100Gbps SmartNIC (2 ports, programmable)",
        "  NIC_ConnectX_7_100 — Dedicated 100Gbps ConnectX-7 (2 ports)",
        "  NIC_ConnectX_7_400 — Dedicated 400Gbps ConnectX-7 (2 ports, highest bandwidth)",
        "  NIC_BlueField_2_ConnectX_6 — BlueField-2 DPU SmartNIC with ARM cores",
        "",
        "GPUs:",
        "  GPU_RTX6000  — NVIDIA RTX 6000 (24GB VRAM, 4608 CUDA cores)",
        "  GPU_TeslaT4  — NVIDIA Tesla T4 (16GB VRAM, inference-optimized)",
        "  GPU_A30      — NVIDIA A30 (24GB HBM2, multi-instance GPU capable)",
        "  GPU_A40      — NVIDIA A40 (48GB VRAM, visualization + compute)",
        "",
        "FPGAs:",
        "  FPGA_Xilinx_U280    — Xilinx Alveo U280 (8GB HBM2, network processing)",
        "  FPGA_Xilinx_SN1022  — Xilinx SN1022 SmartNIC FPGA",
        "",
        "Storage:",
        "  NVME_P4510 — Intel P4510 NVMe SSD (1TB, high IOPS local storage)",
        "",
        "Network Types:",
        "  L2Bridge   — Same-site Layer 2 network (switched)",
        "  L2STS      — Cross-site Layer 2 (site-to-site tunnel)",
        "  L2PTP      — Point-to-point Layer 2 (exactly 2 interfaces)",
        "  FABNetv4   — Cross-site routed IPv4 (FABRIC backbone, auto-configured)",
        "  FABNetv6   — Cross-site routed IPv6 (FABRIC backbone, auto-configured)",
        "  FABNetv4Ext — Publicly routable IPv4 (limited availability)",
        "  FABNetv6Ext — Publicly routable IPv6",
        "  PortMirror  — Port mirroring service for traffic analysis",
        "",
        "Use fabric_find_sites(component='GPU_A40') to find sites with specific hardware.",
    ]
    return "\n".join(lines)


def tool_fabric_find_sites(
    min_cores: int = 0,
    min_ram: int = 0,
    min_disk: int = 0,
    component: str = "",
) -> str:
    """Find sites matching resource requirements."""
    try:
        from app.routes.resources import get_cached_sites

        sites = get_cached_sites()
        matches = []

        # Map component model names to the keys used in the site data
        _COMP_KEY_MAP = {
            "GPU_RTX6000": "GPU-RTX6000",
            "GPU_TeslaT4": "GPU-Tesla T4",
            "GPU_A30": "GPU-A30",
            "GPU_A40": "GPU-A40",
            "FPGA_Xilinx_U280": "FPGA-Xilinx-U280",
            "FPGA_Xilinx_SN1022": "FPGA-Xilinx-SN1022",
            "NIC_ConnectX_5": "SmartNIC-ConnectX-5",
            "NIC_ConnectX_6": "SmartNIC-ConnectX-6",
            "NIC_ConnectX_7_100": "SmartNIC-ConnectX-7-100",
            "NIC_ConnectX_7_400": "SmartNIC-ConnectX-7-400",
            "NIC_BlueField_2_ConnectX_6": "SmartNIC-BlueField-2-ConnectX-6",
            "NVME_P4510": "NVME-P4510",
        }

        comp_key = _COMP_KEY_MAP.get(component, component) if component else ""

        for site in sites:
            if site.get("state") != "Active":
                continue
            if min_cores and site.get("cores_available", 0) < min_cores:
                continue
            if min_ram and site.get("ram_available", 0) < min_ram:
                continue
            if min_disk and site.get("disk_available", 0) < min_disk:
                continue
            if comp_key:
                comps = site.get("components", {})
                comp_info = comps.get(comp_key, {})
                if comp_info.get("available", 0) <= 0:
                    continue
            matches.append(site)

        if not matches:
            filter_parts = []
            if min_cores:
                filter_parts.append(f"cores>={min_cores}")
            if min_ram:
                filter_parts.append(f"ram>={min_ram}GB")
            if min_disk:
                filter_parts.append(f"disk>={min_disk}GB")
            if component:
                filter_parts.append(f"component={component}")
            return f"No active sites match: {', '.join(filter_parts)}"

        lines = [f"Sites matching criteria ({len(matches)}):", ""]
        for site in sorted(matches, key=lambda s: s.get("cores_available", 0), reverse=True):
            lines.append(_format_site(site))

        return "\n".join(lines)
    except Exception as e:
        return f"Error finding sites: {e}"


# ── Config helpers ────────────────────────────────────────────────────────────

def _config_dir() -> str:
    return os.environ.get("FABRIC_CONFIG_DIR", "/fabric_storage/.fabric_config")


def _rc_path() -> str:
    return os.path.join(_config_dir(), "fabric_rc")


def _read_rc() -> dict[str, str]:
    """Read fabric_rc into a dict."""
    settings: dict[str, str] = {}
    path = _rc_path()
    if not os.path.isfile(path):
        return settings
    with open(path) as f:
        for line in f:
            line = line.strip()
            if line.startswith("export ") and "=" in line:
                kv = line[len("export "):]
                key, _, value = kv.partition("=")
                settings[key.strip()] = value.strip()
    return settings


def _write_rc(settings: dict[str, str]) -> None:
    """Write settings dict back to fabric_rc."""
    path = _rc_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    lines = [f"export {k}={v}" for k, v in settings.items()]
    with open(path, "w") as f:
        f.write("\n".join(lines) + "\n")


def _apply_settings(settings: dict[str, str]) -> None:
    """Apply settings to environment and reset FABlib."""
    for k, v in settings.items():
        os.environ[k] = v
    try:
        from app.fablib_manager import reset_fablib
        reset_fablib()
    except Exception:
        pass


def _decode_token_projects() -> list[dict]:
    """Decode projects from the FABRIC JWT token."""
    import base64
    token_path = os.environ.get(
        "FABRIC_TOKEN_LOCATION",
        os.path.join(_config_dir(), "id_token.json"),
    )
    try:
        with open(token_path) as f:
            data = json.load(f)
        token = data.get("id_token", "")
        parts = token.split(".")
        if len(parts) != 3:
            return []
        payload = parts[1] + "=" * (4 - len(parts[1]) % 4)
        decoded = json.loads(base64.urlsafe_b64decode(payload))
        raw_projects = decoded.get("projects", [])
        projects = []
        for p in raw_projects:
            if isinstance(p, dict):
                projects.append(p)
            elif isinstance(p, str):
                if ":" in p:
                    pid, _, pname = p.partition(":")
                    projects.append({"uuid": pid, "name": pname})
                else:
                    projects.append({"uuid": p, "name": p})
        return projects
    except Exception as e:
        logger.debug("Failed to decode token projects: %s", e)
        return []


def tool_fabric_get_config() -> str:
    """Show current FABRIC configuration."""
    settings = _read_rc()
    if not settings:
        return "No fabric_rc found. FABRIC is not configured."

    groups = {
        "Project": ["FABRIC_PROJECT_ID"],
        "Token": ["FABRIC_TOKEN_LOCATION"],
        "Bastion": ["FABRIC_BASTION_HOST", "FABRIC_BASTION_USERNAME",
                     "FABRIC_BASTION_KEY_LOCATION", "FABRIC_BASTION_SSH_CONFIG_FILE"],
        "Slice Keys": ["FABRIC_SLICE_PRIVATE_KEY_FILE", "FABRIC_SLICE_PUBLIC_KEY_FILE"],
        "Hosts": ["FABRIC_CREDMGR_HOST", "FABRIC_ORCHESTRATOR_HOST",
                   "FABRIC_CORE_API_HOST", "FABRIC_AM_HOST"],
        "Logging": ["FABRIC_LOG_LEVEL", "FABRIC_LOG_FILE"],
        "Other": ["FABRIC_AVOID", "FABRIC_SSH_COMMAND_LINE", "FABRIC_AI_API_KEY"],
    }

    lines = ["FABRIC Configuration:", ""]
    shown = set()
    for group_name, keys in groups.items():
        group_lines = []
        for k in keys:
            if k in settings:
                val = settings[k]
                if k == "FABRIC_AI_API_KEY" and val:
                    val = val[:8] + "..." + val[-4:]
                group_lines.append(f"  {k} = {val}")
                shown.add(k)
        if group_lines:
            lines.append(f"[{group_name}]")
            lines.extend(group_lines)
            lines.append("")

    remaining = [k for k in settings if k not in shown]
    if remaining:
        lines.append("[Other]")
        for k in remaining:
            lines.append(f"  {k} = {settings[k]}")
        lines.append("")

    return "\n".join(lines)


def tool_fabric_set_config(key: str, value: str) -> str:
    """Set a FABRIC config value."""
    if not key.startswith("FABRIC_"):
        return f"Error: Key must start with FABRIC_ (got '{key}')"

    settings = _read_rc()
    old_value = settings.get(key)
    settings[key] = value
    _write_rc(settings)
    _apply_settings({key: value})

    if old_value:
        return f"Updated {key}: {old_value} -> {value}"
    return f"Set {key} = {value}"


def tool_fabric_load_rc(path: str) -> str:
    """Load settings from a fabric_rc file."""
    if not os.path.isfile(path):
        return f"Error: File not found: {path}"

    new_settings: dict[str, str] = {}
    with open(path) as f:
        for line in f:
            line = line.strip()
            if line.startswith("export ") and "=" in line:
                kv = line[len("export "):]
                key, _, value = kv.partition("=")
                new_settings[key.strip()] = value.strip()

    if not new_settings:
        return f"No 'export KEY=VALUE' lines found in {path}"

    current = _read_rc()
    changed = []
    for k, v in new_settings.items():
        if current.get(k) != v:
            changed.append(k)
        current[k] = v

    _write_rc(current)
    _apply_settings(new_settings)

    lines = [f"Loaded {len(new_settings)} settings from {path}"]
    if changed:
        lines.append(f"Changed: {', '.join(changed)}")
    else:
        lines.append("No values changed.")
    return "\n".join(lines)


def tool_fabric_list_projects() -> str:
    """List user's FABRIC projects."""
    projects = _decode_token_projects()
    current_project = os.environ.get("FABRIC_PROJECT_ID", _read_rc().get("FABRIC_PROJECT_ID", ""))

    if not projects:
        if current_project:
            return f"Could not decode projects from token.\nCurrent project: {current_project}"
        return "No projects found. Token may be missing or expired."

    lines = [f"FABRIC Projects ({len(projects)}):", ""]
    for p in projects:
        pid = p.get("uuid", "")
        pname = p.get("name", "")
        active = " (active)" if pid == current_project else ""
        lines.append(f"  {pname:40s}  {pid}{active}")
    lines.append("")
    lines.append("Use fabric_set_project to change the active project.")
    return "\n".join(lines)


def tool_fabric_set_project(project: str) -> str:
    """Set the active FABRIC project."""
    projects = _decode_token_projects()
    resolved_id = project

    if projects:
        for p in projects:
            if p.get("name", "").lower() == project.lower():
                resolved_id = p["uuid"]
                break
            if p.get("uuid", "") == project:
                resolved_id = project
                break

    settings = _read_rc()
    old_project = settings.get("FABRIC_PROJECT_ID", "(not set)")
    settings["FABRIC_PROJECT_ID"] = resolved_id
    _write_rc(settings)
    _apply_settings({"FABRIC_PROJECT_ID": resolved_id})

    return f"Active project changed: {old_project} -> {resolved_id}"


# ── Template tools ────────────────────────────────────────────────────────────

def _templates_dirs() -> list[str]:
    """Return template directories (user + builtin)."""
    storage = os.environ.get("FABRIC_STORAGE_DIR", "/fabric_storage")
    dirs = [os.path.join(storage, ".slice_templates")]
    builtin = "/app/slice-libraries/slice_templates"
    if os.path.isdir(builtin):
        dirs.append(builtin)
    return dirs


def tool_fabric_list_templates() -> str:
    """List available slice templates."""
    templates = []
    seen = set()
    for tdir in _templates_dirs():
        if not os.path.isdir(tdir):
            continue
        for entry in sorted(os.listdir(tdir)):
            if entry in seen:
                continue
            entry_dir = os.path.join(tdir, entry)
            if not os.path.isdir(entry_dir):
                continue
            tmpl_path = os.path.join(entry_dir, "template.fabric.json")
            if not os.path.isfile(tmpl_path):
                continue

            name = entry
            description = ""
            node_count = "?"
            net_count = "?"
            builtin = "builtin" if "slice-libraries" in tdir else "user"

            meta_path = os.path.join(entry_dir, "metadata.json")
            if os.path.isfile(meta_path):
                try:
                    with open(meta_path) as f:
                        meta = json.load(f)
                    name = meta.get("name", entry)
                    description = meta.get("description", "")
                    node_count = str(meta.get("node_count", "?"))
                    net_count = str(meta.get("network_count", "?"))
                except Exception:
                    pass

            templates.append({
                "dir_name": entry, "name": name, "description": description,
                "nodes": node_count, "networks": net_count, "source": builtin,
            })
            seen.add(entry)

    if not templates:
        return "No slice templates found."

    lines = [f"Slice Templates ({len(templates)}):", ""]
    for t in templates:
        line = f"  {t['dir_name']:35s}  {t['nodes']}N/{t['networks']}Net  [{t['source']}]"
        if t["name"] != t["dir_name"]:
            line += f"  \"{t['name']}\""
        lines.append(line)
        if t["description"]:
            lines.append(f"    {t['description'][:80]}")
    lines.append("")
    lines.append("Use fabric_create_from_template(template_name=<dir_name>) to create a draft.")
    return "\n".join(lines)


def tool_fabric_create_from_template(template_name: str, slice_name: str = "") -> str:
    """Create a draft slice from a template."""
    tmpl_path = None
    for tdir in _templates_dirs():
        candidate = os.path.join(tdir, template_name, "template.fabric.json")
        if os.path.isfile(candidate):
            tmpl_path = candidate
            break

    if not tmpl_path:
        return f"Template '{template_name}' not found. Use fabric_list_templates to see available."

    try:
        with open(tmpl_path) as f:
            model = json.load(f)
    except Exception as e:
        return f"Error reading template: {e}"

    if not slice_name:
        slice_name = model.get("name", template_name)

    nodes = model.get("nodes", [])
    networks = model.get("networks", [])

    if not nodes:
        return f"Template '{template_name}' has no nodes defined."

    # Convert template format to fabric_create_slice format
    node_specs = []
    for node_def in nodes:
        spec: dict[str, Any] = {
            "name": node_def["name"],
            "site": node_def.get("site", "auto"),
            "cores": node_def.get("cores", 2),
            "ram": node_def.get("ram", 8),
            "disk": node_def.get("disk", 10),
            "image": node_def.get("image", "default_ubuntu_22"),
        }
        # Extract NIC model and extra components
        for comp in node_def.get("components", []):
            cmodel = comp.get("model", "")
            if "NIC" in cmodel:
                spec["nic_model"] = cmodel
            elif "GPU" in cmodel or "FPGA" in cmodel or "NVME" in cmodel:
                spec.setdefault("components", []).append({
                    "model": cmodel,
                    "name": comp.get("name", f"{node_def['name']}-{cmodel.lower()}"),
                })
        node_specs.append(spec)

    # Convert network interfaces from template format (node-nic-p1) to node names
    net_specs = []
    for net_def in networks:
        ifaces_raw = net_def.get("interfaces", [])
        node_names = []
        for iface_str in ifaces_raw:
            parts = iface_str.rsplit("-", 2)
            if len(parts) >= 2:
                node_names.append(parts[0])
            else:
                node_names.append(iface_str)
        net_specs.append({
            "name": net_def["name"],
            "type": net_def.get("type", "L2Bridge"),
            "interfaces": node_names,
        })

    result = tool_fabric_create_slice(slice_name, node_specs, net_specs if net_specs else None)
    result += f"\n\nCreated from template: {template_name}"
    return result


# ── Dispatcher ───────────────────────────────────────────────────────────────

_HANDLERS: dict[str, Any] = {
    # Slice management
    "fabric_list_slices": lambda a: tool_fabric_list_slices(),
    "fabric_get_slice": lambda a: tool_fabric_get_slice(a["slice_name"]),
    "fabric_create_slice": lambda a: tool_fabric_create_slice(
        a["slice_name"], a.get("nodes", []), a.get("networks"),
    ),
    "fabric_submit_slice": lambda a: tool_fabric_submit_slice(
        a["slice_name"], a.get("wait", False),
    ),
    "fabric_modify_slice": lambda a: tool_fabric_modify_slice(
        a["slice_name"],
        a.get("add_nodes"), a.get("remove_nodes"),
        a.get("add_networks"), a.get("remove_networks"),
        a.get("wait", True),
    ),
    "fabric_delete_slice": lambda a: tool_fabric_delete_slice(a["slice_name"]),
    "fabric_renew_slice": lambda a: tool_fabric_renew_slice(
        a["slice_name"], a.get("days", 7),
    ),
    "fabric_wait_slice": lambda a: tool_fabric_wait_slice(
        a["slice_name"], a.get("timeout", 600),
    ),
    # SSH & execution
    "fabric_slice_ssh": lambda a: tool_fabric_slice_ssh(
        a["slice_name"], a["node_name"], a["command"],
    ),
    "fabric_upload_file": lambda a: tool_fabric_upload_file(
        a["slice_name"], a["node_name"], a["local_path"], a.get("remote_path", "."),
    ),
    "fabric_download_file": lambda a: tool_fabric_download_file(
        a["slice_name"], a["node_name"], a["remote_path"], a["local_path"],
    ),
    "fabric_node_info": lambda a: tool_fabric_node_info(
        a["slice_name"], a["node_name"],
    ),
    # Site & resource queries
    "fabric_list_sites": lambda a: tool_fabric_list_sites(a.get("site_name", "")),
    "fabric_list_hosts": lambda a: tool_fabric_list_hosts(a["site_name"]),
    "fabric_list_images": lambda a: tool_fabric_list_images(),
    "fabric_list_components": lambda a: tool_fabric_list_components(),
    "fabric_find_sites": lambda a: tool_fabric_find_sites(
        a.get("min_cores", 0), a.get("min_ram", 0),
        a.get("min_disk", 0), a.get("component", ""),
    ),
    # Configuration
    "fabric_get_config": lambda a: tool_fabric_get_config(),
    "fabric_set_config": lambda a: tool_fabric_set_config(a["key"], a["value"]),
    "fabric_load_rc": lambda a: tool_fabric_load_rc(a["path"]),
    "fabric_list_projects": lambda a: tool_fabric_list_projects(),
    "fabric_set_project": lambda a: tool_fabric_set_project(a["project"]),
    # Templates
    "fabric_list_templates": lambda a: tool_fabric_list_templates(),
    "fabric_create_from_template": lambda a: tool_fabric_create_from_template(
        a["template_name"], a.get("slice_name", ""),
    ),
}


def exec_fablib_tool(name: str, args: dict) -> str:
    """Execute a FABlib tool by name. Returns result string."""
    handler = _HANDLERS.get(name)
    if not handler:
        return f"Unknown FABlib tool: {name}"
    try:
        return handler(args)
    except Exception as e:
        return f"Error in {name}: {e}"


def is_fablib_tool(name: str) -> bool:
    """Check if a tool name is a FABlib tool."""
    return name in _HANDLERS
