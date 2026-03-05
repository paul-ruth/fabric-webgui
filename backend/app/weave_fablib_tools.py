"""FABlib tools for Weave — shared between CLI and WebSocket versions.

Provides tool schemas (OpenAI function calling format) and handlers
for querying and managing FABRIC slices and resources.
"""
from __future__ import annotations

import json
import logging
import os
from typing import Any

logger = logging.getLogger(__name__)

# ── Tool Schemas ─────────────────────────────────────────────────────────────

FABLIB_TOOLS = [
    {"type": "function", "function": {
        "name": "fabric_list_slices",
        "description": (
            "List all FABRIC slices for the current project. "
            "Returns name, state, and slice ID for each slice."
        ),
        "parameters": {"type": "object", "properties": {}, "required": []},
    }},
    {"type": "function", "function": {
        "name": "fabric_get_slice",
        "description": (
            "Get detailed info about a specific slice including its nodes, "
            "networks, interfaces, IPs, and state."
        ),
        "parameters": {"type": "object", "properties": {
            "slice_name": {"type": "string", "description": "Name of the slice"},
        }, "required": ["slice_name"]},
    }},
    {"type": "function", "function": {
        "name": "fabric_list_sites",
        "description": (
            "List all FABRIC sites with available resources (cores, RAM, disk) "
            "and special components (GPUs, FPGAs, SmartNICs, NVMe)."
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
            "List individual hosts at a FABRIC site with per-host resource availability."
        ),
        "parameters": {"type": "object", "properties": {
            "site_name": {"type": "string", "description": "FABRIC site name (e.g. STAR, TACC, NCSA)"},
        }, "required": ["site_name"]},
    }},
    {"type": "function", "function": {
        "name": "fabric_create_slice",
        "description": (
            "Create a new FABRIC slice from a specification. Define nodes with "
            "their resources and network connections. Does NOT submit — returns "
            "a preview. Use fabric_submit_slice to actually provision."
        ),
        "parameters": {"type": "object", "properties": {
            "slice_name": {"type": "string", "description": "Name for the new slice"},
            "nodes": {
                "type": "array",
                "description": "Array of node definitions",
                "items": {"type": "object", "properties": {
                    "name": {"type": "string", "description": "Node name"},
                    "site": {"type": "string", "description": "FABRIC site (e.g. STAR, TACC, NCSA, or 'auto')"},
                    "cores": {"type": "integer", "description": "CPU cores (default: 2)"},
                    "ram": {"type": "integer", "description": "RAM in GB (default: 8)"},
                    "disk": {"type": "integer", "description": "Disk in GB (default: 10)"},
                    "image": {"type": "string", "description": "VM image (default: default_ubuntu_22)"},
                    "nic_model": {
                        "type": "string",
                        "description": "NIC model: NIC_Basic, NIC_ConnectX_5, NIC_ConnectX_6 (default: NIC_Basic)",
                    },
                    "gpu_model": {
                        "type": "string",
                        "description": "Optional GPU: GPU_RTX6000, GPU_TeslaT4, GPU_A30, GPU_A40",
                    },
                }, "required": ["name"]},
            },
            "networks": {
                "type": "array",
                "description": "Array of network definitions connecting nodes",
                "items": {"type": "object", "properties": {
                    "name": {"type": "string", "description": "Network name"},
                    "type": {
                        "type": "string",
                        "description": "Network type: L2Bridge, L2STS, L2PTP, FABNetv4, FABNetv6",
                    },
                    "interfaces": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Node names to connect (one NIC interface per node will be used)",
                    },
                }, "required": ["name", "type", "interfaces"]},
            },
        }, "required": ["slice_name", "nodes"]},
    }},
    {"type": "function", "function": {
        "name": "fabric_submit_slice",
        "description": (
            "Submit (provision) a slice that was previously created. "
            "This allocates resources on FABRIC and starts the VMs. "
            "Returns immediately — the slice will transition through "
            "Configuring states before becoming StableOK."
        ),
        "parameters": {"type": "object", "properties": {
            "slice_name": {"type": "string", "description": "Name of the slice to submit"},
            "wait": {
                "type": "boolean",
                "description": "Wait for provisioning to complete (default: false, max 10 min)",
            },
        }, "required": ["slice_name"]},
    }},
    {"type": "function", "function": {
        "name": "fabric_delete_slice",
        "description": "Delete a FABRIC slice and release all its resources.",
        "parameters": {"type": "object", "properties": {
            "slice_name": {"type": "string", "description": "Name of the slice to delete"},
        }, "required": ["slice_name"]},
    }},
    {"type": "function", "function": {
        "name": "fabric_slice_ssh",
        "description": (
            "Execute a command on a node in a provisioned slice via SSH. "
            "The slice must be in StableOK state with SSH accessible."
        ),
        "parameters": {"type": "object", "properties": {
            "slice_name": {"type": "string", "description": "Name of the slice"},
            "node_name": {"type": "string", "description": "Name of the node"},
            "command": {"type": "string", "description": "Shell command to execute"},
        }, "required": ["slice_name", "node_name", "command"]},
    }},
    {"type": "function", "function": {
        "name": "fabric_renew_slice",
        "description": "Extend the expiration of a slice by a number of days.",
        "parameters": {"type": "object", "properties": {
            "slice_name": {"type": "string", "description": "Name of the slice"},
            "days": {"type": "integer", "description": "Number of days to extend (default: 7)"},
        }, "required": ["slice_name"]},
    }},
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
            "FABRIC_AVOID, FABRIC_AI_API_KEY, FABRIC_SLICE_PRIVATE_KEY_FILE, "
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
            "Load FABRIC settings from a fabric_rc file. Reads all 'export KEY=VALUE' "
            "lines and applies them to the current configuration."
        ),
        "parameters": {"type": "object", "properties": {
            "path": {"type": "string", "description": "Path to the fabric_rc file to load"},
        }, "required": ["path"]},
    }},
    {"type": "function", "function": {
        "name": "fabric_list_projects",
        "description": (
            "List FABRIC projects the user belongs to. Shows project name, UUID, "
            "and which one is currently active."
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
    {"type": "function", "function": {
        "name": "fabric_list_templates",
        "description": (
            "List available slice templates (both built-in and user-created). "
            "Shows template name, description, node/network counts."
        ),
        "parameters": {"type": "object", "properties": {}, "required": []},
    }},
    {"type": "function", "function": {
        "name": "fabric_create_from_template",
        "description": (
            "Create a draft FABRIC slice from a slice template. "
            "Reads the template definition and builds the slice with FABlib. "
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


def tool_fabric_list_slices() -> str:
    """List all slices for the current project."""
    try:
        fablib = _get_fablib()
        slices = fablib.get_slices()
        if not slices:
            return "No slices found."
        lines = [f"{'Name':30s}  {'State':15s}  {'ID':36s}"]
        lines.append("-" * 85)
        for s in slices:
            name = s.get_name() or "?"
            state = str(s.get_state()) if s.get_state() else "?"
            sid = str(s.get_slice_id()) if hasattr(s, "get_slice_id") else ""
            lines.append(f"{name:30s}  {state:15s}  {sid}")
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
            nstate = str(node.get_reservation_state()) if hasattr(node, "get_reservation_state") else "?"
            cores = node.get_cores() if hasattr(node, "get_cores") else "?"
            ram = node.get_ram() if hasattr(node, "get_ram") else "?"
            disk = node.get_disk() if hasattr(node, "get_disk") else "?"
            image = ""
            try:
                image = node.get_image() or ""
            except Exception:
                pass
            mgmt_ip = ""
            try:
                mgmt_ip = node.get_management_ip() or ""
            except Exception:
                pass

            lines.append(f"  {nname} @ {site}  state={nstate}  {cores}c/{ram}GB/{disk}GB  image={image}")
            if mgmt_ip:
                lines.append(f"    management_ip: {mgmt_ip}")

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
                    parts = [f"    iface: {iname}"]
                    if net:
                        parts.append(f"net={net}")
                    if ip:
                        parts.append(f"ip={ip}")
                    lines.append("  ".join(parts))
            except Exception:
                pass

            # Components (GPUs, etc.)
            try:
                for comp in node.get_components():
                    cname = comp.get_name() if hasattr(comp, "get_name") else "?"
                    cmodel = comp.get_model() if hasattr(comp, "get_model") else "?"
                    lines.append(f"    component: {cname} ({cmodel})")
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
                    lines.append(f"  {netname}  type={ntype}")
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


def tool_fabric_list_sites(site_name: str = "") -> str:
    """List FABRIC sites with available resources."""
    try:
        from app.routes.resources import get_cached_sites, _fablib_lock, _fetch_sites_sync
        import time

        # Use the resources module's caching
        sites = get_cached_sites()

        if site_name:
            # Filter to single site
            matches = [s for s in sites if s["name"].upper() == site_name.upper()]
            if not matches:
                return f"Site '{site_name}' not found. Use fabric_list_sites without arguments to see all sites."
            site = matches[0]
            lines = [_format_site(site), ""]

            # Show hosts
            hosts = site.get("hosts_detail", [])
            if hosts:
                lines.append(f"Hosts ({len(hosts)}):")
                for h in hosts:
                    lines.append(_format_host(h))
            return "\n".join(lines)

        # All sites
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

        # Resolve 'auto' sites — pick the site with the most available cores
        def _pick_auto_site(cores_needed: int = 2) -> str:
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
            return "STAR"  # Fallback to a well-known site

        for nspec in nodes:
            name = nspec["name"]
            site = nspec.get("site", "auto")
            cores = nspec.get("cores", 2)
            ram = nspec.get("ram", 8)
            disk = nspec.get("disk", 10)
            image = nspec.get("image", "default_ubuntu_22")

            # Resolve 'auto' — pick site with most available resources
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
            if networks:
                for net in networks:
                    if name in net.get("interfaces", []):
                        nic = node.add_component(model=nic_model, name=f"{name}-nic1")
                        ifaces = nic.get_interfaces()
                        if ifaces:
                            node_ifaces[name] = ifaces[0]
                        break

            # Add GPU if specified
            gpu_model = nspec.get("gpu_model")
            if gpu_model:
                node.add_component(model=gpu_model, name=f"{name}-gpu1")

        # Create networks
        if networks:
            for nspec in networks:
                net_name = nspec["name"]
                net_type = nspec.get("type", "L2Bridge")
                iface_nodes = nspec.get("interfaces", [])
                ifaces = [node_ifaces[n] for n in iface_nodes if n in node_ifaces]

                if not ifaces:
                    continue

                if net_type in ("FABNetv4", "FABNetv6"):
                    ip_type = "IPv4" if net_type == "FABNetv4" else "IPv6"
                    s.add_l3network(name=net_name, interfaces=ifaces, type=ip_type)
                else:
                    s.add_l2network(name=net_name, interfaces=ifaces, type=net_type)

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
            lines.append(
                f"  {n.get_name()} @ {n.get_site()}  "
                f"{n.get_cores()}c/{n.get_ram()}GB/{n.get_disk()}GB  "
                f"image={n.get_image()}"
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

        # Only submit if it's a new/modifiable slice
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
                result += f"\n  {node.get_name()} @ {node.get_site()}  ip={mgmt_ip}"
        elif not wait:
            result += "\n\nThe slice is being provisioned. Use fabric_get_slice to check progress."

        return result
    except Exception as e:
        return f"Error submitting slice '{slice_name}': {e}"


def tool_fabric_delete_slice(slice_name: str) -> str:
    """Delete a slice."""
    try:
        fablib = _get_fablib()
        s = fablib.get_slice(name=slice_name)
        s.delete()
        return f"Slice '{slice_name}' deleted."
    except Exception as e:
        return f"Error deleting slice '{slice_name}': {e}"


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


# ── Config helpers ────────────────────────────────────────────────────────────

def _config_dir() -> str:
    return os.environ.get("FABRIC_CONFIG_DIR", "/fabric_storage/.fabric_config")


def _rc_path() -> str:
    return os.path.join(_config_dir(), "fabric_rc")


def _read_rc() -> dict[str, str]:
    """Read fabric_rc into a dict of key -> value."""
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
        # Projects may be dicts or strings
        projects = []
        for p in raw_projects:
            if isinstance(p, dict):
                projects.append(p)
            elif isinstance(p, str):
                # Try to parse "uuid:name" or just uuid
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

    # Group settings logically
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
                # Mask sensitive values
                if k == "FABRIC_AI_API_KEY" and val:
                    val = val[:8] + "..." + val[-4:]
                group_lines.append(f"  {k} = {val}")
                shown.add(k)
        if group_lines:
            lines.append(f"[{group_name}]")
            lines.extend(group_lines)
            lines.append("")

    # Any remaining settings
    remaining = [k for k in settings if k not in shown]
    if remaining:
        lines.append("[Other]")
        for k in remaining:
            lines.append(f"  {k} = {settings[k]}")
        lines.append("")

    return "\n".join(lines)


def tool_fabric_set_config(key: str, value: str) -> str:
    """Set a FABRIC config value."""
    # Validate key prefix
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

    # Merge with existing settings
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
        lines.append("No values changed (all settings already matched).")
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
    # Check if it's a UUID or a name
    projects = _decode_token_projects()
    resolved_id = project

    # Try to match by name first
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
            meta_path = os.path.join(entry_dir, "metadata.json")
            tmpl_path = os.path.join(entry_dir, "template.fabric.json")
            if not os.path.isfile(tmpl_path):
                continue

            name = entry
            description = ""
            node_count = "?"
            net_count = "?"
            builtin = "builtin" if "slice-libraries" in tdir else "user"

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
                "dir_name": entry,
                "name": name,
                "description": description,
                "nodes": node_count,
                "networks": net_count,
                "source": builtin,
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
    lines.append("Use fabric_create_from_template(template_name=<dir_name>) to create a draft slice.")
    return "\n".join(lines)


def tool_fabric_create_from_template(template_name: str, slice_name: str = "") -> str:
    """Create a draft slice from a template."""
    # Find the template
    tmpl_path = None
    for tdir in _templates_dirs():
        candidate = os.path.join(tdir, template_name, "template.fabric.json")
        if os.path.isfile(candidate):
            tmpl_path = candidate
            break

    if not tmpl_path:
        return f"Template '{template_name}' not found. Use fabric_list_templates to see available templates."

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
        # Extract NIC model from components
        for comp in node_def.get("components", []):
            cmodel = comp.get("model", "")
            if "NIC" in cmodel:
                spec["nic_model"] = cmodel
            elif "GPU" in cmodel:
                spec["gpu_model"] = cmodel
        node_specs.append(spec)

    # Convert network interfaces from template format (node-nic-p1) to node names
    net_specs = []
    for net_def in networks:
        ifaces_raw = net_def.get("interfaces", [])
        # Extract node names from interface strings like "node1-nic1-p1"
        node_names = []
        for iface_str in ifaces_raw:
            # Interface format: {node-name}-{component-name}-p{port}
            # Node name is everything before the last two dash-separated segments
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

    # Create the slice using the existing tool
    result = tool_fabric_create_slice(slice_name, node_specs, net_specs if net_specs else None)

    # Append template info
    result += f"\n\nCreated from template: {template_name}"
    return result


# ── Dispatcher ───────────────────────────────────────────────────────────────

_HANDLERS: dict[str, Any] = {
    "fabric_list_slices": lambda a: tool_fabric_list_slices(),
    "fabric_get_slice": lambda a: tool_fabric_get_slice(a["slice_name"]),
    "fabric_list_sites": lambda a: tool_fabric_list_sites(a.get("site_name", "")),
    "fabric_list_hosts": lambda a: tool_fabric_list_hosts(a["site_name"]),
    "fabric_create_slice": lambda a: tool_fabric_create_slice(
        a["slice_name"], a.get("nodes", []), a.get("networks"),
    ),
    "fabric_submit_slice": lambda a: tool_fabric_submit_slice(
        a["slice_name"], a.get("wait", False),
    ),
    "fabric_delete_slice": lambda a: tool_fabric_delete_slice(a["slice_name"]),
    "fabric_slice_ssh": lambda a: tool_fabric_slice_ssh(
        a["slice_name"], a["node_name"], a["command"],
    ),
    "fabric_renew_slice": lambda a: tool_fabric_renew_slice(
        a["slice_name"], a.get("days", 7),
    ),
    "fabric_get_config": lambda a: tool_fabric_get_config(),
    "fabric_set_config": lambda a: tool_fabric_set_config(a["key"], a["value"]),
    "fabric_load_rc": lambda a: tool_fabric_load_rc(a["path"]),
    "fabric_list_projects": lambda a: tool_fabric_list_projects(),
    "fabric_set_project": lambda a: tool_fabric_set_project(a["project"]),
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
