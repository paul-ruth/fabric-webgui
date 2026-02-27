"""Convert FABlib Slice objects into Cytoscape.js graph JSON.

Replicates the logic from fabvis/graph_builder.py, producing the same
node types, labels, edge structures, and data attributes.
"""

from __future__ import annotations
from typing import Any


# State color mapping — exact match to fabvis/styles.py STATE_COLORS
STATE_COLORS = {
    "StableOK": {"bg": "#e0f2f1", "border": "#008e7a"},
    "Active": {"bg": "#e0f2f1", "border": "#008e7a"},
    "Configuring": {"bg": "#fff3e0", "border": "#ff8542"},
    "Ticketed": {"bg": "#fff3e0", "border": "#ff8542"},
    "ModifyOK": {"bg": "#fff3e0", "border": "#ff8542"},
    "Nascent": {"bg": "#f8f9fa", "border": "#838385"},
    "StableError": {"bg": "#fce4ec", "border": "#b00020"},
    "ModifyError": {"bg": "#fce4ec", "border": "#b00020"},
    "Closing": {"bg": "#eeeeee", "border": "#616161"},
    "Dead": {"bg": "#eeeeee", "border": "#616161"},
}
DEFAULT_STATE = {"bg": "#f8f9fa", "border": "#838385"}

# Dark mode state colors — brighter borders on dark tinted backgrounds
STATE_COLORS_DARK = {
    "StableOK": {"bg": "#0d2e26", "border": "#4dd0b8"},
    "Active": {"bg": "#0d2e26", "border": "#4dd0b8"},
    "Configuring": {"bg": "#3a2008", "border": "#ffb74d"},
    "Ticketed": {"bg": "#3a2008", "border": "#ffb74d"},
    "ModifyOK": {"bg": "#3a2008", "border": "#ffb74d"},
    "Nascent": {"bg": "#28283a", "border": "#a0a0b8"},
    "StableError": {"bg": "#3a1018", "border": "#ff6b6b"},
    "ModifyError": {"bg": "#3a1018", "border": "#ff6b6b"},
    "Closing": {"bg": "#222230", "border": "#8a8a9a"},
    "Dead": {"bg": "#222230", "border": "#8a8a9a"},
}
DEFAULT_STATE_DARK = {"bg": "#28283a", "border": "#a0a0b8"}

# Component model abbreviations
COMPONENT_ABBREV = {
    "NIC_Basic": "NIC",
    "NIC_ConnectX_5": "CX5",
    "NIC_ConnectX_6": "CX6",
    "NIC_ConnectX_7": "CX7",
    "GPU_TeslaT4": "T4",
    "GPU_RTX6000": "RTX",
    "GPU_A30": "A30",
    "GPU_A40": "A40",
    "FPGA_Xilinx_U280": "FPGA",
    "NVME_P4510": "NVMe",
}


def _component_summary(components: list) -> str:
    """Build abbreviated component summary like 'NIC x2  GPU'."""
    counts: dict[str, int] = {}
    for comp in components:
        model = comp.get("model", "")
        abbrev = COMPONENT_ABBREV.get(model, model)
        counts[abbrev] = counts.get(abbrev, 0) + 1
    parts = []
    for name, count in counts.items():
        if count > 1:
            parts.append(f"{name} x{count}")
        else:
            parts.append(name)
    return "  ".join(parts)


def build_graph(slice_data: dict) -> dict[str, Any]:
    """Build a Cytoscape.js-compatible graph JSON from slice data.

    Args:
        slice_data: Dict with keys: name, id, state, nodes, networks,
                    interfaces, components (as returned by slice_to_dict).

    Returns:
        {"nodes": [...], "edges": [...]} in Cytoscape.js JSON format.
    """
    nodes = []
    edges = []
    slice_name = slice_data.get("name", "slice")
    slice_id = slice_data.get("id", "unknown")

    # Slice container node
    nodes.append({
        "data": {
            "id": f"slice:{slice_id}",
            "label": slice_name,
            "element_type": "slice",
            "state": slice_data.get("state", "Unknown"),
        },
        "classes": "slice",
    })

    # VM nodes
    for node in slice_data.get("nodes", []):
        node_name = node["name"]
        site = node.get("site", "?")
        cores = node.get("cores", "?")
        ram = node.get("ram", "?")
        disk = node.get("disk", "?")
        state = node.get("reservation_state", "Unknown")
        state_colors = STATE_COLORS.get(state, DEFAULT_STATE)
        state_colors_dark = STATE_COLORS_DARK.get(state, DEFAULT_STATE_DARK)
        comp_summary = _component_summary(node.get("components", []))

        label_lines = [
            node_name,
            f"@ {site}",
            f"{cores}c / {ram}G / {disk}G",
        ]
        if comp_summary:
            label_lines.append(comp_summary)

        node_id = f"node:{slice_id}:{node_name}"
        nodes.append({
            "data": {
                "id": node_id,
                "parent": f"slice:{slice_id}",
                "label": "\n".join(label_lines),
                "element_type": "node",
                "name": node_name,
                "site": site,
                "cores": cores,
                "ram": ram,
                "disk": disk,
                "state": state,
                "state_bg": state_colors["bg"],
                "state_color": state_colors["border"],
                "state_bg_dark": state_colors_dark["bg"],
                "state_color_dark": state_colors_dark["border"],
                "image": node.get("image", ""),
                "management_ip": node.get("management_ip", ""),
                "username": node.get("username", ""),
                "host": node.get("host", ""),
            },
            "classes": "vm",
        })

    # Network nodes
    for net in slice_data.get("networks", []):
        net_name = net["name"]
        net_type = net.get("type", "L2Bridge")
        layer = net.get("layer", "L2")
        net_id = f"net:{slice_id}:{net_name}"

        nodes.append({
            "data": {
                "id": net_id,
                "parent": f"slice:{slice_id}",
                "label": f"{net_name}\n({net_type})",
                "element_type": "network",
                "name": net_name,
                "type": net_type,
                "layer": layer,
                "subnet": net.get("subnet", ""),
                "gateway": net.get("gateway", ""),
            },
            "classes": f"network-{layer.lower()}",
        })

        # Edges from nodes to networks via interfaces
        for iface in net.get("interfaces", []):
            iface_node = iface.get("node_name", "")
            iface_name = iface.get("name", "")
            if iface_node:
                source_id = f"node:{slice_id}:{iface_node}"
                edge_id = f"edge:{slice_id}:{iface_name}"
                edge_label_parts = []
                if iface.get("vlan"):
                    edge_label_parts.append(f"VLAN {iface['vlan']}")
                if iface.get("ip_addr"):
                    edge_label_parts.append(iface["ip_addr"])

                edges.append({
                    "data": {
                        "id": edge_id,
                        "source": source_id,
                        "target": net_id,
                        "label": "\n".join(edge_label_parts),
                        "element_type": "interface",
                        "interface_name": iface_name,
                        "node_name": iface_node,
                        "network_name": net_name,
                        "vlan": iface.get("vlan", ""),
                        "mac": iface.get("mac", ""),
                        "ip_addr": iface.get("ip_addr", ""),
                        "bandwidth": iface.get("bandwidth", ""),
                    },
                    "classes": f"edge-{layer.lower()}",
                })

    return {"nodes": nodes, "edges": edges}
