name: fablib
description: Manage FABRIC slices and resources using built-in FABlib tools
---
Help the user interact with the FABRIC testbed using the built-in FABlib tools.

## Available FABlib Tools

You have these tools — use them directly for most operations:

- `fabric_list_slices` — List all slices (name, state, ID)
- `fabric_get_slice(slice_name)` — Detailed info: nodes, networks, IPs, errors
- `fabric_list_sites` — All sites with cores/RAM/disk availability and components
- `fabric_list_hosts(site_name)` — Per-host resources at a specific site
- `fabric_create_slice(slice_name, nodes, networks)` — Create a draft slice
- `fabric_submit_slice(slice_name, wait)` — Submit/provision a draft slice
- `fabric_delete_slice(slice_name)` — Delete a slice
- `fabric_slice_ssh(slice_name, node_name, command)` — Run command on a node
- `fabric_renew_slice(slice_name, days)` — Extend slice lease

## When to Use Tools vs Python Scripts

**Use the tools** for:
- Listing and inspecting slices
- Checking site/host availability
- Simple slice creation (a few nodes + networks)
- Running commands on nodes
- Deleting or renewing slices

**Write a Python script** (using `FablibManager()`) for:
- Complex topologies needing loops or conditional logic
- Batch operations across many slices
- Data collection and analysis (pandas, matplotlib)
- Operations not covered by the tools (e.g., upload/download files)

## Authentication

The user's FABRIC token is at `/fabric_storage/.fabric_config/id_token.json`.
FABlib is pre-configured — `FablibManager()` works automatically in this container.
If operations fail with token errors, direct the user to refresh via the Configure view.

## Example: Python Script (for complex operations)

```python
from fabrictestbed_extensions.fablib.fablib import FablibManager
fablib = FablibManager()

# Create and submit a slice
slice = fablib.new_slice(name="my-experiment")
node = slice.add_node(name="node1", site="STAR", cores=4, ram=16, disk=50)
nic = node.add_component(model="NIC_Basic", name="nic1")
slice.submit()
slice.wait_ssh(progress=True)
```
