name: sites
description: Query FABRIC site information and resource availability
---
Help the user understand FABRIC site resources and availability.

## How to Query Sites

Use the built-in FABlib tools — no Python scripts needed:

1. **List all sites**: Call `fabric_list_sites` to see every site with cores/RAM/disk
   availability, state, and special components (GPUs, FPGAs, SmartNICs, NVMe).

2. **Site details with hosts**: Call `fabric_list_sites(site_name="STAR")` to get
   detailed info for a single site including per-host breakdown.

3. **Per-host resources**: Call `fabric_list_hosts(site_name="STAR")` to see
   individual host machines and what's available on each.

## Key Sites

| Site | Location | Notes |
|------|----------|-------|
| STAR | Chicago, IL | Central hub, high capacity |
| TACC | Austin, TX | GPUs, high capacity |
| UCSD | San Diego, CA | West coast hub |
| NCSA | Champaign, IL | FPGAs, GPUs, high capacity |
| MASS | Amherst, MA | Northeast |
| UTAH | Salt Lake City, UT | GPUs available |
| DALL | Dallas, TX | South central |
| WASH | Washington, DC | East coast |
| CERN | Geneva, Switzerland | European hub |

## Recommendations

Based on the user's needs, suggest sites with:
- **Most available cores**: Check `fabric_list_sites` and sort by cores_available
- **GPUs**: Filter for sites with GPU components (RTX6000, A30, A40, Tesla T4)
- **FPGAs**: Look for FPGA-Xilinx-U280 in the components
- **SmartNICs**: ConnectX-5 or ConnectX-6 for programmable networking
- **Co-location**: Nodes needing low latency should be at the same site
- **Geographic diversity**: For wide-area experiments, pick sites in different regions
