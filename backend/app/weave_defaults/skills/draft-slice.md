name: draft-slice
description: Create a draft FABRIC slice directly from a specification (no template)
---
Create a draft FABRIC slice directly from the user's description. The draft is
held in memory and can be submitted with `/deploy-slice` or `fabric_submit_slice`.

## Steps

1. **Understand the request**: What nodes? How many? What resources? What network?

2. **Check availability**: Call `fabric_list_sites` to find sites with enough
   resources. Recommend sites based on the user's needs.

3. **Build the specification**:
   - Determine node specs: name, site, cores, ram, disk, image
   - Determine network specs if nodes need to communicate
   - Choose NIC model (NIC_Basic unless high-performance needed)
   - Add GPUs if requested

4. **Create the draft**: Call `fabric_create_slice` with the spec:
   ```
   fabric_create_slice(
     slice_name="my-slice",
     nodes=[
       {"name": "node1", "site": "STAR", "cores": 4, "ram": 16, "disk": 50},
       {"name": "node2", "site": "TACC", "cores": 4, "ram": 16, "disk": 50}
     ],
     networks=[
       {"name": "link", "type": "FABNetv4", "interfaces": ["node1", "node2"]}
     ]
   )
   ```

5. **Report**: Show what was created (nodes, sites, resources, networks).
   Tell the user they can deploy with `/deploy-slice <name>` or
   `fabric_submit_slice(slice_name)`.

## Node Spec Fields

| Field | Default | Description |
|-------|---------|-------------|
| name | required | Unique node name |
| site | "auto" | Site name, "auto", or "@group" tag |
| cores | 2 | CPU cores (1-64) |
| ram | 8 | RAM in GB (2-384) |
| disk | 10 | Disk in GB (10-500) |
| image | default_ubuntu_22 | VM image |
| nic_model | NIC_Basic | NIC_Basic, NIC_ConnectX_5, NIC_ConnectX_6 |
| gpu_model | (none) | GPU_RTX6000, GPU_TeslaT4, GPU_A30, GPU_A40 |

## Network Spec Fields

| Field | Default | Description |
|-------|---------|-------------|
| name | required | Network name |
| type | L2Bridge | L2Bridge, L2STS, L2PTP, FABNetv4, FABNetv6 |
| interfaces | required | List of node names to connect |

## Tips

- Use "auto" for sites unless the user specifies — it picks the best available
- Use FABNetv4 for cross-site IP connectivity
- Use L2Bridge for same-site layer 2
- Use L2STS for cross-site layer 2
- Minimum practical node: 2 cores, 4GB RAM, 10GB disk
