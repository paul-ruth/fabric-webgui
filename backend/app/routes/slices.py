"""Slice management API routes."""

from __future__ import annotations
import asyncio
import json
import os
import threading
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app.fablib_manager import get_fablib
from app.slice_serializer import slice_to_dict, slice_summary
from app.graph_builder import build_graph

router = APIRouter(tags=["slices"])

# ---------------------------------------------------------------------------
# Draft slice store — holds slices that are being edited locally.
# For new slices: created with new_slice() but not yet submitted.
# For existing slices: loaded from FABRIC and being modified locally.
# Keyed by slice name.
# ---------------------------------------------------------------------------
_draft_lock = threading.Lock()
_draft_slices: dict[str, Any] = {}
# Track which drafts are "new" (never submitted) vs "loaded" (existing slice)
_draft_is_new: dict[str, bool] = {}


def _store_draft(name: str, slice_obj: Any, is_new: bool = True) -> None:
    with _draft_lock:
        _draft_slices[name] = slice_obj
        _draft_is_new[name] = is_new


def _pop_draft(name: str) -> tuple[Any | None, bool]:
    with _draft_lock:
        obj = _draft_slices.pop(name, None)
        is_new = _draft_is_new.pop(name, True)
        return obj, is_new


def _get_draft(name: str) -> Any | None:
    with _draft_lock:
        return _draft_slices.get(name)


def _is_draft(name: str) -> bool:
    with _draft_lock:
        return name in _draft_slices


def _is_new_draft(name: str) -> bool:
    with _draft_lock:
        return _draft_is_new.get(name, True)


def _get_slice_obj(name: str):
    """Return the slice object — draft first, then from FABRIC."""
    draft = _get_draft(name)
    if draft is not None:
        return draft
    fablib = get_fablib()
    return fablib.get_slice(name=name)


def _serialize(slice_obj, dirty: bool = False) -> dict[str, Any]:
    data = slice_to_dict(slice_obj)
    name = data.get("name", "")
    is_new = _is_new_draft(name) if _is_draft(name) else False
    if is_new:
        data["state"] = "Draft"
    # Keep real state for loaded slices
    data["dirty"] = dirty
    graph = build_graph(data)
    return {**data, "graph": graph}


# --- Request models ---

class CreateNodeRequest(BaseModel):
    name: str
    site: str = "auto"
    cores: int = 2
    ram: int = 8
    disk: int = 10
    image: str = "default_ubuntu_22"


class CreateComponentRequest(BaseModel):
    name: str
    model: str  # e.g. NIC_Basic, GPU_TeslaT4


class CreateNetworkRequest(BaseModel):
    name: str
    type: str = "L2Bridge"  # L2Bridge, L2STS, L2PTP, IPv4, IPv6, etc.
    interfaces: List[str] = []  # list of interface names to attach
    subnet: Optional[str] = None      # e.g. "192.168.1.0/24"
    gateway: Optional[str] = None     # e.g. "192.168.1.1"
    ip_mode: str = "none"             # "auto" | "manual" | "none"
    interface_ips: Dict[str, str] = {} # {"node1-nic1-p1": "10.0.0.1"}


class PostBootConfigRequest(BaseModel):
    script: str  # bash script content


class SliceModelImport(BaseModel):
    format: str = "fabric-webgui-v1"
    name: str
    nodes: List[Dict[str, Any]] = []
    networks: List[Dict[str, Any]] = []


class UpdateNodeRequest(BaseModel):
    site: Optional[str] = None
    cores: Optional[int] = None
    ram: Optional[int] = None
    disk: Optional[int] = None
    image: Optional[str] = None


# --- Routes ---
# Heavy FABlib calls use async + asyncio.to_thread() so they don't block
# the event loop or exhaust the default threadpool for other requests.

@router.get("/slices")
async def list_slices() -> list[dict[str, Any]]:
    """List all slices visible to the current user."""
    def _do():
        fablib = get_fablib()
        slices = fablib.get_slices()
        return [slice_summary(s) for s in slices]
    try:
        results = await asyncio.to_thread(_do)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    # Append any new draft slices not yet submitted
    existing_names = {r["name"] for r in results}
    with _draft_lock:
        for name in _draft_slices:
            if name not in existing_names:
                results.append({"name": name, "id": "", "state": "Draft"})
    return results


@router.get("/slices/{slice_name}")
async def get_slice(slice_name: str) -> dict[str, Any]:
    """Get full slice data including topology graph."""
    def _do():
        slice_obj = _get_slice_obj(slice_name)
        # When loading an existing (non-draft) slice, store it in drafts
        # so subsequent edits are local until Submit
        if not _is_draft(slice_name):
            _store_draft(slice_name, slice_obj, is_new=False)
        return _serialize(slice_obj)
    try:
        return await asyncio.to_thread(_do)
    except Exception as e:
        raise HTTPException(status_code=404, detail=f"Slice not found: {e}")


@router.post("/slices")
async def create_slice(name: str) -> dict[str, Any]:
    """Create a new empty draft slice."""
    def _do():
        fablib = get_fablib()
        slice_obj = fablib.new_slice(name=name)
        _store_draft(name, slice_obj, is_new=True)
        return _serialize(slice_obj)
    try:
        return await asyncio.to_thread(_do)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/slices/{slice_name}/submit")
async def submit_slice(slice_name: str) -> dict[str, Any]:
    """Submit a slice — creates new slice or modifies existing one."""
    draft, is_new = _pop_draft(slice_name)
    if draft is not None:
        def _do():
            if is_new:
                draft.submit()
            else:
                draft.submit(wait=False)
            return _serialize(draft)
        try:
            return await asyncio.to_thread(_do)
        except Exception as e:
            # Put draft back so user can retry
            _store_draft(slice_name, draft, is_new=is_new)
            raise HTTPException(status_code=500, detail=str(e))
    # Not a draft — nothing to submit
    raise HTTPException(status_code=400, detail="No pending changes to submit")


@router.post("/slices/{slice_name}/refresh")
async def refresh_slice(slice_name: str) -> dict[str, Any]:
    """Refresh slice state from FABRIC (discards local edits)."""
    # Drop any draft — reload fresh from FABRIC
    _pop_draft(slice_name)
    def _do():
        fablib = get_fablib()
        slice_obj = fablib.get_slice(name=slice_name)
        slice_obj.update()
        # Store fresh copy as draft for further editing
        _store_draft(slice_name, slice_obj, is_new=False)
        return _serialize(slice_obj)
    try:
        return await asyncio.to_thread(_do)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/slices/{slice_name}")
async def delete_slice(slice_name: str) -> dict[str, str]:
    """Delete a slice."""
    draft, is_new = _pop_draft(slice_name)
    if draft is not None and is_new:
        # Just a draft that was never submitted — discard it
        return {"status": "deleted", "name": slice_name}
    # Delete the actual slice from FABRIC
    def _do():
        fablib = get_fablib()
        slice_obj = fablib.get_slice(name=slice_name)
        slice_obj.delete()
        return {"status": "deleted", "name": slice_name}
    try:
        return await asyncio.to_thread(_do)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/slices/{slice_name}/validate")
def validate_slice(slice_name: str) -> dict[str, Any]:
    """Validate a slice and return any issues."""
    try:
        slice_obj = _get_slice_obj(slice_name)
    except Exception as e:
        raise HTTPException(status_code=404, detail=f"Slice not found: {e}")

    issues: list[dict[str, str]] = []
    data = slice_to_dict(slice_obj)
    nodes = data.get("nodes", [])
    networks = data.get("networks", [])

    # Must have at least one node
    if not nodes:
        issues.append({
            "severity": "error",
            "message": "Slice has no nodes.",
            "remedy": "Add at least one node using the editor panel.",
        })

    for node in nodes:
        name = node.get("name", "?")
        site = node.get("site", "")
        # Node needs a site
        if not site or site in ("None", "none", ""):
            issues.append({
                "severity": "error",
                "message": f"Node '{name}' has no site assigned.",
                "remedy": f"Set a site for node '{name}' in the editor panel.",
            })
        # Check resource minimums
        cores = node.get("cores", 0)
        ram = node.get("ram", 0)
        disk = node.get("disk", 0)
        if isinstance(cores, (int, float)) and cores < 1:
            issues.append({
                "severity": "error",
                "message": f"Node '{name}' has {cores} cores.",
                "remedy": f"Set at least 1 core for node '{name}'.",
            })
        if isinstance(ram, (int, float)) and ram < 1:
            issues.append({
                "severity": "error",
                "message": f"Node '{name}' has {ram} GB RAM.",
                "remedy": f"Set at least 1 GB RAM for node '{name}'.",
            })
        if isinstance(disk, (int, float)) and disk < 1:
            issues.append({
                "severity": "error",
                "message": f"Node '{name}' has {disk} GB disk.",
                "remedy": f"Set at least 1 GB disk for node '{name}'.",
            })

    for net in networks:
        net_name = net.get("name", "?")
        net_type = net.get("type", "")
        ifaces = net.get("interfaces", [])
        iface_count = len(ifaces)

        if "PTP" in net_type:
            if iface_count != 2:
                issues.append({
                    "severity": "error",
                    "message": f"Network '{net_name}' ({net_type}) has {iface_count} interface(s), needs exactly 2.",
                    "remedy": f"Connect exactly 2 interfaces to '{net_name}'.",
                })
        else:
            if iface_count < 2:
                issues.append({
                    "severity": "error",
                    "message": f"Network '{net_name}' ({net_type}) has {iface_count} interface(s), needs at least 2.",
                    "remedy": f"Connect at least 2 interfaces to '{net_name}'.",
                })

    # Check for nodes with NICs that aren't connected to any network
    for node in nodes:
        for comp in node.get("components", []):
            for iface in comp.get("interfaces", []):
                if not iface.get("network_name"):
                    issues.append({
                        "severity": "warning",
                        "message": f"Interface '{iface.get('name', '?')}' on node '{node.get('name', '?')}' is not connected to a network.",
                        "remedy": "Connect the interface to a network, or remove the component if unused.",
                    })

    return {
        "valid": len([i for i in issues if i["severity"] == "error"]) == 0,
        "issues": issues,
    }


# --- Node operations ---

@router.post("/slices/{slice_name}/nodes")
def add_node(slice_name: str, req: CreateNodeRequest) -> dict[str, Any]:
    """Add a node to a slice."""
    try:
        slice_obj = _get_slice_obj(slice_name)
        kwargs: dict[str, Any] = {
            "name": req.name,
            "cores": req.cores,
            "ram": req.ram,
            "disk": req.disk,
            "image": req.image,
        }
        if req.site != "auto":
            kwargs["site"] = req.site
        slice_obj.add_node(**kwargs)
        return _serialize(slice_obj, dirty=True)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/slices/{slice_name}/nodes/{node_name}")
def remove_node(slice_name: str, node_name: str) -> dict[str, Any]:
    """Remove a node from a slice."""
    try:
        slice_obj = _get_slice_obj(slice_name)
        node = slice_obj.get_node(name=node_name)
        node.delete()
        return _serialize(slice_obj, dirty=True)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/slices/{slice_name}/nodes/{node_name}")
def update_node(slice_name: str, node_name: str, req: UpdateNodeRequest) -> dict[str, Any]:
    """Update node configuration."""
    try:
        slice_obj = _get_slice_obj(slice_name)
        node = slice_obj.get_node(name=node_name)
        if req.site is not None:
            node.set_site(req.site)
        if req.cores is not None:
            node.set_capacities(cores=req.cores)
        if req.ram is not None:
            node.set_capacities(ram=req.ram)
        if req.disk is not None:
            node.set_capacities(disk=req.disk)
        if req.image is not None:
            node.set_image(req.image)
        return _serialize(slice_obj, dirty=True)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# --- Component operations ---

@router.post("/slices/{slice_name}/nodes/{node_name}/components")
def add_component(slice_name: str, node_name: str, req: CreateComponentRequest) -> dict[str, Any]:
    """Add a component to a node."""
    try:
        slice_obj = _get_slice_obj(slice_name)
        node = slice_obj.get_node(name=node_name)
        node.add_component(model=req.model, name=req.name)
        return _serialize(slice_obj, dirty=True)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/slices/{slice_name}/nodes/{node_name}/components/{comp_name}")
def remove_component(slice_name: str, node_name: str, comp_name: str) -> dict[str, Any]:
    """Remove a component from a node."""
    try:
        slice_obj = _get_slice_obj(slice_name)
        node = slice_obj.get_node(name=node_name)
        comp = node.get_component(name=comp_name)
        comp.delete()
        return _serialize(slice_obj, dirty=True)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# --- Network operations ---

@router.post("/slices/{slice_name}/networks")
def add_network(slice_name: str, req: CreateNetworkRequest) -> dict[str, Any]:
    """Add a network to a slice."""
    try:
        slice_obj = _get_slice_obj(slice_name)
        # Resolve interface objects from names
        ifaces = []
        for iface_name in req.interfaces:
            for node in slice_obj.get_nodes():
                for iface in node.get_interfaces():
                    if iface.get_name() == iface_name:
                        ifaces.append(iface)

        l3_types = {"IPv4", "IPv6", "IPv4Ext", "IPv6Ext", "L3VPN"}
        if req.type in l3_types:
            # L3 network — use add_l3network, auto-assign IPs
            net = slice_obj.add_l3network(name=req.name, interfaces=ifaces, type=req.type)
            for iface in ifaces:
                iface.set_mode("auto")
        else:
            # L2 network
            net = slice_obj.add_l2network(name=req.name, interfaces=ifaces, type=req.type)
            if req.subnet:
                net.set_subnet(req.subnet)
            if req.gateway:
                net.set_gateway(req.gateway)
            if req.ip_mode == "auto" and req.subnet:
                for iface in ifaces:
                    iface.set_mode("auto")
            elif req.ip_mode == "manual":
                for iface in ifaces:
                    iface_name = iface.get_name()
                    if iface_name in req.interface_ips:
                        iface.set_mode("manual")
                        iface.set_ip_addr(addr=req.interface_ips[iface_name])

        return _serialize(slice_obj, dirty=True)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/slices/{slice_name}/networks/{net_name}")
def remove_network(slice_name: str, net_name: str) -> dict[str, Any]:
    """Remove a network from a slice."""
    try:
        slice_obj = _get_slice_obj(slice_name)
        net = slice_obj.get_network(name=net_name)
        net.delete()
        return _serialize(slice_obj, dirty=True)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# --- Post-boot config ---

@router.put("/slices/{slice_name}/nodes/{node_name}/post-boot")
def set_post_boot_config(slice_name: str, node_name: str, req: PostBootConfigRequest) -> dict[str, Any]:
    """Set a post-boot config script on a node."""
    try:
        slice_obj = _get_slice_obj(slice_name)
        node = slice_obj.get_node(name=node_name)
        node.add_post_boot_upload_directory(req.script)
        return _serialize(slice_obj, dirty=True)
    except AttributeError:
        # Fallback: use execute() style or set_user_data if available
        try:
            slice_obj = _get_slice_obj(slice_name)
            node = slice_obj.get_node(name=node_name)
            node.set_user_data({"post_boot_script": req.script})
            return _serialize(slice_obj, dirty=True)
        except Exception as e2:
            raise HTTPException(status_code=500, detail=str(e2))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# --- Slice export/import ---

@router.get("/slices/{slice_name}/export")
def export_slice(slice_name: str):
    """Export a slice definition as a downloadable JSON model file."""
    try:
        slice_obj = _get_slice_obj(slice_name)
        data = slice_to_dict(slice_obj)

        model = {
            "format": "fabric-webgui-v1",
            "name": data["name"],
            "nodes": [],
            "networks": [],
        }

        for node in data.get("nodes", []):
            node_model = {
                "name": node["name"],
                "site": node.get("site", ""),
                "cores": node.get("cores", 2),
                "ram": node.get("ram", 8),
                "disk": node.get("disk", 10),
                "image": node.get("image", "default_ubuntu_22"),
                "components": [],
            }
            # Try to read post-boot script from the node object
            try:
                fab_node = slice_obj.get_node(name=node["name"])
                script = fab_node.get_user_data().get("post_boot_script", "")
                if script:
                    node_model["post_boot_script"] = script
            except Exception:
                pass
            for comp in node.get("components", []):
                node_model["components"].append({
                    "name": comp["name"],
                    "model": comp.get("model", ""),
                })
            model["nodes"].append(node_model)

        for net in data.get("networks", []):
            net_model = {
                "name": net["name"],
                "type": net.get("type", "L2Bridge"),
                "interfaces": [i["name"] for i in net.get("interfaces", [])],
                "subnet": net.get("subnet", ""),
                "gateway": net.get("gateway", ""),
            }
            model["networks"].append(net_model)

        return JSONResponse(
            content=model,
            headers={
                "Content-Disposition": f'attachment; filename="{data["name"]}.fabric.json"'
            },
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/slices/import")
def import_slice(model: SliceModelImport) -> dict[str, Any]:
    """Import a slice model and create a new draft."""
    try:
        fablib = get_fablib()
        slice_obj = fablib.new_slice(name=model.name)

        # Add nodes and components
        for node_def in model.nodes:
            kwargs: dict[str, Any] = {
                "name": node_def["name"],
                "cores": node_def.get("cores", 2),
                "ram": node_def.get("ram", 8),
                "disk": node_def.get("disk", 10),
                "image": node_def.get("image", "default_ubuntu_22"),
            }
            site = node_def.get("site", "")
            if site and site not in ("auto", ""):
                kwargs["site"] = site
            node = slice_obj.add_node(**kwargs)

            for comp_def in node_def.get("components", []):
                node.add_component(
                    model=comp_def.get("model", "NIC_Basic"),
                    name=comp_def.get("name", ""),
                )

            # Apply post-boot script if present
            post_boot = node_def.get("post_boot_script", "")
            if post_boot:
                try:
                    node.set_user_data({"post_boot_script": post_boot})
                except Exception:
                    pass

        # Add networks
        l3_types = {"IPv4", "IPv6", "IPv4Ext", "IPv6Ext", "L3VPN"}
        for net_def in model.networks:
            # Resolve interfaces by name
            ifaces = []
            for iface_name in net_def.get("interfaces", []):
                for node in slice_obj.get_nodes():
                    for iface in node.get_interfaces():
                        if iface.get_name() == iface_name:
                            ifaces.append(iface)

            net_type = net_def.get("type", "L2Bridge")
            if net_type in l3_types:
                net = slice_obj.add_l3network(
                    name=net_def["name"], interfaces=ifaces, type=net_type
                )
                for iface in ifaces:
                    iface.set_mode("auto")
            else:
                net = slice_obj.add_l2network(
                    name=net_def["name"], interfaces=ifaces, type=net_type
                )
                subnet = net_def.get("subnet", "")
                gateway = net_def.get("gateway", "")
                if subnet:
                    net.set_subnet(subnet)
                if gateway:
                    net.set_gateway(gateway)

                ip_mode = net_def.get("ip_mode", "none")
                if ip_mode == "auto" and subnet:
                    for iface in ifaces:
                        iface.set_mode("auto")
                elif ip_mode == "manual":
                    iface_ips = net_def.get("interface_ips", {})
                    for iface in ifaces:
                        iname = iface.get_name()
                        if iname in iface_ips:
                            iface.set_mode("manual")
                            iface.set_ip_addr(addr=iface_ips[iname])

        _store_draft(model.name, slice_obj, is_new=True)
        return _serialize(slice_obj)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# --- Save/Open to container storage ---

@router.post("/slices/{slice_name}/save-to-storage")
def save_to_storage(slice_name: str):
    """Export a slice definition and save it to container storage."""
    import json as _json
    try:
        # Reuse export logic
        resp = export_slice(slice_name)
        model = resp.body
        if isinstance(model, bytes):
            model = _json.loads(model)

        storage_dir = os.environ.get("FABRIC_STORAGE_DIR", "/fabric_storage")
        os.makedirs(storage_dir, exist_ok=True)
        filename = f"{slice_name}.fabric.json"
        path = os.path.join(storage_dir, filename)
        with open(path, "w") as f:
            _json.dump(model, f, indent=2)
        return {"status": "ok", "path": filename}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/slices/storage-files")
def list_storage_files():
    """List .fabric.json files in container storage."""
    storage_dir = os.environ.get("FABRIC_STORAGE_DIR", "/fabric_storage")
    if not os.path.isdir(storage_dir):
        return []
    files = []
    for name in sorted(os.listdir(storage_dir)):
        if name.endswith(".fabric.json"):
            full = os.path.join(storage_dir, name)
            if os.path.isfile(full):
                st = os.stat(full)
                files.append({
                    "name": name,
                    "size": st.st_size,
                    "modified": st.st_mtime,
                })
    return files


@router.post("/slices/open-from-storage")
def open_from_storage(body: dict):
    """Read a .fabric.json file from storage and import it."""
    import json as _json
    filename = body.get("filename", "")
    if not filename:
        raise HTTPException(status_code=400, detail="filename required")

    storage_dir = os.environ.get("FABRIC_STORAGE_DIR", "/fabric_storage")
    path = os.path.realpath(os.path.join(storage_dir, filename))
    if not path.startswith(os.path.realpath(storage_dir)):
        raise HTTPException(status_code=400, detail="Invalid path")
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="File not found")

    with open(path) as f:
        model_data = _json.load(f)

    model = SliceModelImport(**model_data)
    return import_slice(model)
