"""Serialize FABlib Slice objects into plain dicts for JSON transport."""

from __future__ import annotations
from typing import Any


def _safe(fn, default=""):
    """Call fn(), return default on any exception."""
    try:
        result = fn()
        return result if result is not None else default
    except Exception:
        return default


def serialize_interface(iface) -> dict[str, Any]:
    """Serialize a FABlib Interface object."""
    return {
        "name": _safe(iface.get_name),
        "node_name": _safe(lambda: iface.get_node().get_name() if iface.get_node() else ""),
        "network_name": _safe(lambda: iface.get_network().get_name() if iface.get_network() else ""),
        "vlan": _safe(iface.get_vlan),
        "mac": _safe(iface.get_mac),
        "ip_addr": _safe(lambda: str(iface.get_ip_addr()) if iface.get_ip_addr() else ""),
        "bandwidth": _safe(iface.get_bandwidth),
    }


def serialize_component(comp) -> dict[str, Any]:
    """Serialize a FABlib Component object."""
    return {
        "name": _safe(comp.get_name),
        "model": _safe(comp.get_model),
        "type": _safe(lambda: str(comp.get_type()) if comp.get_type() else ""),
        "interfaces": [
            serialize_interface(iface)
            for iface in (_safe(comp.get_interfaces, []) or [])
        ],
    }


def serialize_node(node) -> dict[str, Any]:
    """Serialize a FABlib Node object."""
    components = [
        serialize_component(c)
        for c in (_safe(node.get_components, []) or [])
    ]
    interfaces = [
        serialize_interface(i)
        for i in (_safe(node.get_interfaces, []) or [])
    ]
    return {
        "name": _safe(node.get_name),
        "site": _safe(node.get_site),
        "host": _safe(node.get_host),
        "cores": _safe(node.get_cores),
        "ram": _safe(node.get_ram),
        "disk": _safe(node.get_disk),
        "image": _safe(node.get_image),
        "image_type": _safe(node.get_image_type),
        "management_ip": _safe(node.get_management_ip),
        "reservation_state": _safe(lambda: str(node.get_reservation_state())),
        "username": _safe(node.get_username),
        "components": components,
        "interfaces": interfaces,
    }


def serialize_network(net) -> dict[str, Any]:
    """Serialize a FABlib NetworkService object."""
    net_type = _safe(lambda: str(net.get_type()))
    layer = "L3" if "IPv" in net_type else "L2"
    interfaces = [
        serialize_interface(i)
        for i in (_safe(net.get_interfaces, []) or [])
    ]
    return {
        "name": _safe(net.get_name),
        "type": net_type,
        "layer": layer,
        "subnet": _safe(lambda: str(net.get_subnet()) if net.get_subnet() else ""),
        "gateway": _safe(lambda: str(net.get_gateway()) if net.get_gateway() else ""),
        "interfaces": interfaces,
    }


def slice_to_dict(slice_obj) -> dict[str, Any]:
    """Convert a full FABlib Slice into a plain dict."""
    nodes = [serialize_node(n) for n in (_safe(slice_obj.get_nodes, []) or [])]
    networks = [serialize_network(n) for n in (_safe(slice_obj.get_network_services, []) or [])]

    return {
        "name": _safe(slice_obj.get_name),
        "id": _safe(slice_obj.get_slice_id),
        "state": _safe(lambda: str(slice_obj.get_state())),
        "lease_end": _safe(lambda: str(slice_obj.get_lease_end()) if slice_obj.get_lease_end() else ""),
        "nodes": nodes,
        "networks": networks,
    }


def slice_summary(slice_obj) -> dict[str, Any]:
    """Convert a FABlib Slice into a summary dict (for list view)."""
    return {
        "name": _safe(slice_obj.get_name),
        "id": _safe(slice_obj.get_slice_id),
        "state": _safe(lambda: str(slice_obj.get_state())),
    }
