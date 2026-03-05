name: sites
description: Query FABRIC site information, resource availability, and find sites with specific hardware
---
Help the user understand FABRIC site resources and availability.

## How to Query Sites

Use the built-in tools — no Python scripts needed:

1. **List all sites**: `fabric_list_sites` — every site with cores/RAM/disk availability,
   state, and special components (GPUs, FPGAs, SmartNICs, NVMe).

2. **Site details with hosts**: `fabric_list_sites(site_name="STAR")` — detailed info
   including per-host breakdown.

3. **Per-host resources**: `fabric_list_hosts(site_name="STAR")` — individual host machines.

4. **Find sites with hardware**: `fabric_find_sites(component="GPU_A40")` — sites with
   specific components and minimum resources.

5. **Available images**: `fabric_list_images` — all VM images with default users.

6. **Component catalog**: `fabric_list_components` — all NIC, GPU, FPGA, NVMe models.

## Key Sites

| Site | Location | Notable Hardware |
|------|----------|-----------------|
| STAR | Chicago, IL | Central hub, high capacity |
| TACC | Austin, TX | GPUs, high capacity |
| UCSD | San Diego, CA | West coast, GPUs |
| NCSA | Champaign, IL | FPGAs, GPUs, high capacity |
| MASS | Amherst, MA | Northeast hub |
| UTAH | Salt Lake City, UT | GPUs available |
| DALL | Dallas, TX | South central |
| WASH | Washington, DC | East coast |
| CERN | Geneva, Switzerland | European hub |
| LOSA | Los Angeles, CA | West coast |
| SALT | Salt Lake City, UT | |
| CLEM | Clemson, SC | Southeast |
| GATECH | Atlanta, GA | Southeast |

## Component Availability

Use `fabric_find_sites(component="MODEL_NAME")` with:

**GPUs:** GPU_RTX6000, GPU_TeslaT4, GPU_A30, GPU_A40
**FPGAs:** FPGA_Xilinx_U280, FPGA_Xilinx_SN1022
**SmartNICs:** NIC_ConnectX_5, NIC_ConnectX_6, NIC_ConnectX_7_100, NIC_ConnectX_7_400
**Storage:** NVME_P4510

## Recommendations

Based on the user's needs, suggest sites with:
- **Most available cores**: Sort `fabric_list_sites` results by cores_available
- **GPUs**: Use `fabric_find_sites(component="GPU_A40")` etc.
- **FPGAs**: `fabric_find_sites(component="FPGA_Xilinx_U280")`
- **High bandwidth**: Sites with ConnectX-6/7 SmartNICs
- **Co-location**: Nodes needing low latency should be at the same site
- **Geographic diversity**: For wide-area experiments, pick different regions
- **Cross-site L3**: Use FABNetv4 or `fabnet: "v4"` shorthand for easy routing
