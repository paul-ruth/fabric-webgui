name: fablib
description: Manage FABRIC slices, resources, and experiments using built-in FABlib tools
---
Help the user interact with the FABRIC testbed using the built-in FABlib tools.
These tools wrap the FABlib Python library (fabrictestbed-extensions) and provide
direct access to FABRIC operations without writing Python scripts.

## Available Tools

### Slice Lifecycle
- `fabric_list_slices` — List all slices with name, state, lease end, and ID
- `fabric_get_slice(slice_name)` — Detailed info: nodes, networks, IPs, components, errors
- `fabric_create_slice(slice_name, nodes, networks)` — Create a draft (saved to .drafts/, appears in web UI)
- `fabric_submit_slice(slice_name, wait)` — Submit a draft for provisioning
- `fabric_modify_slice(slice_name, add_nodes, remove_nodes, add_networks, remove_networks)` — Modify a running slice
- `fabric_delete_slice(slice_name)` — Delete a slice (always confirm with user first!)
- `fabric_renew_slice(slice_name, days)` — Extend lease (default: 7 days)
- `fabric_wait_slice(slice_name, timeout)` — Wait for provisioning and SSH readiness

### SSH & File Transfer
- `fabric_slice_ssh(slice_name, node_name, command)` — Execute command on a node
- `fabric_upload_file(slice_name, node_name, local_path, remote_path)` — Upload file to node
- `fabric_download_file(slice_name, node_name, remote_path, local_path)` — Download from node
- `fabric_node_info(slice_name, node_name)` — Detailed node info (IPs, components, SSH cmd)

### Resource Queries
- `fabric_list_sites(site_name?)` — Sites with resource availability and components
- `fabric_list_hosts(site_name)` — Per-host resources at a site
- `fabric_list_images` — All available VM images with default users
- `fabric_list_components` — All component models (NICs, GPUs, FPGAs, NVMe)
- `fabric_find_sites(min_cores, min_ram, min_disk, component)` — Find sites matching requirements

### Configuration
- `fabric_get_config` — Show fabric_rc settings
- `fabric_set_config(key, value)` — Update a config value
- `fabric_load_rc(path)` — Load settings from a fabric_rc file
- `fabric_list_projects` — List user's projects from token
- `fabric_set_project(project)` — Switch active project

### Templates
- `fabric_list_templates` — List built-in and user slice templates
- `fabric_create_from_template(template_name, slice_name?)` — Create draft from template

## Node Specification

When creating slices, each node supports:

| Field | Default | Description |
|-------|---------|-------------|
| name | required | Unique node name |
| site | "auto" | Site name or "auto" for best available |
| cores | 2 | CPU cores (1-128) |
| ram | 8 | RAM in GB (2-512) |
| disk | 10 | Disk in GB (10-500) |
| image | default_ubuntu_22 | VM image (use `fabric_list_images` to see all) |
| nic_model | NIC_Basic | NIC type (see Component Models below) |
| components | [] | Extra hardware: `[{model: "GPU_A40", name: "gpu1"}]` |
| fabnet | (none) | Shorthand: "v4", "v6", or "both" for auto L3 networking |
| post_boot_commands | [] | Shell commands to run after boot |

## Component Models

**NICs:** NIC_Basic (shared 25G), NIC_ConnectX_5 (dedicated 25G), NIC_ConnectX_6 (100G),
NIC_ConnectX_7_100 (100G), NIC_ConnectX_7_400 (400G), NIC_BlueField_2_ConnectX_6 (DPU)

**GPUs:** GPU_RTX6000 (24GB), GPU_TeslaT4 (16GB), GPU_A30 (24GB HBM2), GPU_A40 (48GB)

**FPGAs:** FPGA_Xilinx_U280 (8GB HBM2), FPGA_Xilinx_SN1022

**Storage:** NVME_P4510 (1TB NVMe SSD)

## Network Types

| Type | Description | Cross-site? |
|------|-------------|-------------|
| L2Bridge | Layer 2 switched network | Same site only |
| L2STS | Layer 2 site-to-site tunnel | Yes |
| L2PTP | Point-to-point Layer 2 | Yes (exactly 2 nodes) |
| FABNetv4 | Routed IPv4 on FABRIC backbone | Yes (auto-configured) |
| FABNetv6 | Routed IPv6 on FABRIC backbone | Yes (auto-configured) |
| FABNetv4Ext | Publicly routable IPv4 | Yes (limited) |
| FABNetv6Ext | Publicly routable IPv6 | Yes |

## Common Images

| Image | User | OS |
|-------|------|----|
| default_ubuntu_22 | ubuntu | Ubuntu 22.04 LTS (default) |
| default_ubuntu_24 | ubuntu | Ubuntu 24.04 LTS |
| default_ubuntu_20 | ubuntu | Ubuntu 20.04 LTS |
| default_rocky_9 | rocky | Rocky Linux 9 |
| default_centos9_stream | cloud-user | CentOS 9 Stream |
| default_debian_12 | debian | Debian 12 |
| default_fedora_40 | fedora | Fedora 40 |
| docker_ubuntu_22 | ubuntu | Ubuntu 22.04 with Docker |
| docker_rocky_9 | rocky | Rocky 9 with Docker |
| default_kali | kali | Kali Linux |

## When to Use Tools vs Python Scripts

**Use the tools** for:
- Listing and inspecting slices, sites, resources
- Creating slices with up to ~10 nodes
- Running commands on nodes
- Uploading/downloading files
- Modifying running slices
- Deleting or renewing slices

**Write a Python script** (using `FablibManager()`) for:
- Complex topologies needing loops or conditional logic
- Sub-interfaces and VLAN tagging
- Port mirroring
- Batch operations across many slices
- Data collection with pandas/matplotlib
- CPU pinning, NUMA tuning
- Persistent storage (CephFS) setup

## FABlib Python API Quick Reference

For operations not covered by tools, use the FABlib Python API directly:

```python
from fabrictestbed_extensions.fablib.fablib import FablibManager
fablib = FablibManager()

# Key constants
fablib.FABNETV4_SUBNET   # "10.128.0.0/10"
fablib.FABNETV6_SUBNET   # "2602:fcfb::/40"

# Random site selection with filtering
site = fablib.get_random_site(avoid=["UCSD"])
sites = fablib.get_random_sites(count=2, filter_function=lambda x: x['gpu_rtx6000_available'] > 0)

# Slice operations
slice = fablib.new_slice(name="my-slice")
node = slice.add_node(name="n1", site="STAR", cores=4, ram=16, disk=50, image="default_ubuntu_24")

# Add components
nic = node.add_component(model="NIC_ConnectX_6", name="nic1")
gpu = node.add_component(model="GPU_A40", name="gpu1")
nvme = node.add_component(model="NVME_P4510", name="nvme1")

# Easy L3 networking (auto-assigns IPs and routes)
node.add_fabnet(net_type="IPv4")

# Manual L2 networking
iface = nic.get_interfaces()[0]
iface.set_mode('auto')
net = slice.add_l2network(name="lan", interfaces=[iface1, iface2], subnet="192.168.1.0/24")

# Sub-interfaces (VLAN tagging on a single physical NIC)
child1 = iface.add_sub_interface("child1", vlan="100")
child2 = iface.add_sub_interface("child2", vlan="200")

# Post-boot tasks
node.add_post_boot_upload_directory('tools', '.')
node.add_post_boot_execute('chmod +x tools/setup.sh && ./tools/setup.sh')

# Submit and wait
slice.submit(wait=True)  # Blocks until ready
slice.wait_ssh(timeout=600)

# SSH and file transfer
stdout, stderr = node.execute("hostname")
node.upload_file("local.sh", "remote.sh")
node.download_file("local.log", "remote.log")

# Modify a running slice
slice = fablib.get_slice("my-slice")
new_node = slice.add_node(name="n2", site="TACC")
old_node = slice.get_node("n1")
old_node.delete()
slice.submit()  # Submits the modification

# Renew
slice.renew(days=7)
```

## Authentication

Token: `/fabric_storage/.fabric_config/id_token.json`
Config: `/fabric_storage/.fabric_config/fabric_rc`
FABlib is pre-configured — all tools use the user's credentials automatically.
If token errors occur, direct the user to refresh via the Configure view.
