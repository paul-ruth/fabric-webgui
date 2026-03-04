#!/bin/bash
# deploy.sh — Prometheus + Grafana Stack
# Runs on the webgui container. Configures FABNetv4 routes.
# Per-role setup scripts run as VM-side boot commands.
SLICE_NAME="${1:-${SLICE_NAME}}"
echo "### PROGRESS: Configuring FABNetv4 for Prometheus slice '$SLICE_NAME'"
export SLICE_NAME
python3 <<'PYEOF'
import os, sys, ipaddress
FABNETV4_SUBNET = ipaddress.ip_network("10.128.0.0/10")
slice_name = os.environ["SLICE_NAME"]
errors = []
from fabrictestbed_extensions.fablib.fablib import FablibManager
fablib = FablibManager()
s = fablib.get_slice(name=slice_name)
s.update()
node_ips = {}
for node in s.get_nodes():
    for iface in node.get_interfaces():
        net = iface.get_network()
        if net and str(net.get_type()) in ("FABNetv4", "FABNetv4Ext"):
            gw = net.get_gateway()
            if gw:
                try:
                    node.ip_route_add(subnet=FABNETV4_SUBNET, gateway=gw)
                    print(f"  {node.get_name()}: route 10.128.0.0/10 via {gw}")
                except Exception as e:
                    if "File exists" not in str(e):
                        errors.append(f"{node.get_name()} route: {e}")
            fd = iface.get_fablib_data()
            ip = fd.get("addr")
            if ip:
                node_ips[node.get_name()] = ip
print("")
if errors:
    print("=== Boot config complete with errors ===")
    for e in errors:
        print(f"  ERROR: {e}")
    sys.exit(1)
else:
    print("=== Boot config complete and successful ===")
    print("  FABNetv4 routes configured. Per-node setup scripts starting (see node logs).")
    for name, ip in node_ips.items():
        role = "monitor" if name == "monitor" else "worker"
        print(f"  {name} ({role}): FABNet IP = {ip}")
PYEOF
