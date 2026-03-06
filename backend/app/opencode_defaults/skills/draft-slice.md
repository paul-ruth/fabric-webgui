name: draft-slice
description: Create a draft FABRIC slice directly from a specification (no template)
---
Create a draft FABRIC slice directly from the user's description. The
`fabric_create_slice` tool automatically saves the draft to
`/fabric_storage/.drafts/<name>/` (topology.graphml + meta.json). The web UI
picks up new drafts on the next slice refresh, so the draft will appear in the
slice selector and slice table. It can then be submitted with `/deploy-slice`,
`fabric_submit_slice`, or directly from the web UI.

## Steps

1. **Understand the request**: What nodes? How many? What resources? What network?
   GPUs, FPGAs, SmartNICs? What OS image?

2. **Check availability**: Call `fabric_find_sites` or `fabric_list_sites` to find
   sites with enough resources. If specific hardware is needed (GPUs, FPGAs),
   use `fabric_find_sites(component="GPU_A40")`.

3. **Build the specification**:
   - Determine node specs: name, site, cores, ram, disk, image
   - Determine network specs if nodes need to communicate
   - Choose NIC model (NIC_Basic unless high-performance or programmable needed)
   - Add GPUs/FPGAs/NVMe via the `components` field
   - For easy cross-site L3, use `fabnet: "v4"` instead of manual networks

4. **Create the draft**: Call `fabric_create_slice` with the spec:
   ```
   fabric_create_slice(
     slice_name="my-slice",
     nodes=[
       {name: "node1", site: "STAR", cores: 4, ram: 16, disk: 50,
        components: [{model: "GPU_A40", name: "gpu1"}]},
       {name: "node2", site: "TACC", cores: 4, ram: 16, disk: 50}
     ],
     networks=[
       {name: "link", type: "FABNetv4", interfaces: ["node1", "node2"]}
     ]
   )
   ```

   Or with fabnet shorthand (simpler for L3):
   ```
   fabric_create_slice(
     slice_name="my-slice",
     nodes=[
       {name: "node1", site: "STAR", cores: 4, ram: 16, disk: 50, fabnet: "v4"},
       {name: "node2", site: "TACC", cores: 4, ram: 16, disk: 50, fabnet: "v4"}
     ]
   )
   ```

5. **Report**: Show what was created (nodes, sites, resources, components, networks).
   Tell the user the draft is now visible in the web UI slice list and table
   (it will appear on the next refresh). They can deploy with
   `fabric_submit_slice(slice_name)` or submit from the web UI.

## Node Spec Fields

| Field | Default | Description |
|-------|---------|-------------|
| name | required | Unique node name |
| site | "auto" | Site name, "auto", or "@group" tag |
| cores | 2 | CPU cores (1-128) |
| ram | 8 | RAM in GB (2-512) |
| disk | 10 | Disk in GB (10-500) |
| image | default_ubuntu_22 | VM image |
| nic_model | NIC_Basic | NIC type for network connections |
| components | [] | `[{model: "GPU_A40", name: "gpu1"}]` |
| fabnet | (none) | "v4", "v6", or "both" for auto L3 networking |
| post_boot_commands | [] | Shell commands to run after boot |

## Network Types

| Type | When to use |
|------|-------------|
| L2Bridge | Same-site Layer 2 |
| L2STS | Cross-site Layer 2 |
| L2PTP | Point-to-point (exactly 2 nodes) |
| FABNetv4 | Cross-site routed IPv4 (recommended for most cases) |
| FABNetv6 | Cross-site routed IPv6 |
| fabnet: "v4" | Shorthand — equivalent to FABNetv4 but simpler |

## Draft Storage

Drafts created by `fabric_create_slice` are automatically persisted to
`/fabric_storage/.drafts/<name>/` and registered in the web UI's slice list.
They appear as "Draft" state in the slice selector and slice table after
the next refresh. Drafts survive container restarts.

## Tips

- Use "auto" for sites unless the user specifies
- Use `fabnet: "v4"` for the simplest cross-site connectivity
- Use `fabric_find_sites` to check hardware availability before creating
- For GPU nodes, many sites have limited GPU inventory — always check first
- Minimum practical node: 2 cores, 4GB RAM, 10GB disk
