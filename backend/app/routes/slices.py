"""Slice management API routes."""

from __future__ import annotations
import threading
from typing import Any, List, Optional

from fastapi import APIRouter, HTTPException
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


class UpdateNodeRequest(BaseModel):
    site: Optional[str] = None
    cores: Optional[int] = None
    ram: Optional[int] = None
    disk: Optional[int] = None
    image: Optional[str] = None


# --- Routes ---

@router.get("/slices")
def list_slices() -> list[dict[str, Any]]:
    """List all slices visible to the current user."""
    fablib = get_fablib()
    try:
        slices = fablib.get_slices()
        results = [slice_summary(s) for s in slices]
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
def get_slice(slice_name: str) -> dict[str, Any]:
    """Get full slice data including topology graph."""
    try:
        slice_obj = _get_slice_obj(slice_name)
        # When loading an existing (non-draft) slice, store it in drafts
        # so subsequent edits are local until Submit
        if not _is_draft(slice_name):
            _store_draft(slice_name, slice_obj, is_new=False)
        return _serialize(slice_obj)
    except Exception as e:
        raise HTTPException(status_code=404, detail=f"Slice not found: {e}")


@router.post("/slices")
def create_slice(name: str) -> dict[str, Any]:
    """Create a new empty draft slice."""
    fablib = get_fablib()
    try:
        slice_obj = fablib.new_slice(name=name)
        _store_draft(name, slice_obj, is_new=True)
        return _serialize(slice_obj)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/slices/{slice_name}/submit")
def submit_slice(slice_name: str) -> dict[str, Any]:
    """Submit a slice — creates new slice or modifies existing one."""
    draft, is_new = _pop_draft(slice_name)
    if draft is not None:
        try:
            if is_new:
                draft.submit()
            else:
                draft.submit(wait=False)
            return _serialize(draft)
        except Exception as e:
            # Put draft back so user can retry
            _store_draft(slice_name, draft, is_new=is_new)
            raise HTTPException(status_code=500, detail=str(e))
    # Not a draft — nothing to submit
    raise HTTPException(status_code=400, detail="No pending changes to submit")


@router.post("/slices/{slice_name}/refresh")
def refresh_slice(slice_name: str) -> dict[str, Any]:
    """Refresh slice state from FABRIC (discards local edits)."""
    # Drop any draft — reload fresh from FABRIC
    _pop_draft(slice_name)
    fablib = get_fablib()
    try:
        slice_obj = fablib.get_slice(name=slice_name)
        slice_obj.update()
        # Store fresh copy as draft for further editing
        _store_draft(slice_name, slice_obj, is_new=False)
        return _serialize(slice_obj)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/slices/{slice_name}")
def delete_slice(slice_name: str) -> dict[str, str]:
    """Delete a slice."""
    draft, is_new = _pop_draft(slice_name)
    if draft is not None and is_new:
        # Just a draft that was never submitted — discard it
        return {"status": "deleted", "name": slice_name}
    # Delete the actual slice from FABRIC
    fablib = get_fablib()
    try:
        slice_obj = fablib.get_slice(name=slice_name)
        slice_obj.delete()
        return {"status": "deleted", "name": slice_name}
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
        slice_obj.add_l2network(name=req.name, interfaces=ifaces, type=req.type)
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
