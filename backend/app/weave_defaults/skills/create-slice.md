name: create-slice
description: Create a new FABRIC slice template from a description
---
Create a new slice template based on the user's description. Follow these steps:

1. **Understand the request**: What kind of experiment? How many nodes? What topology?
   What software/services need to be installed?

2. **Design the topology**: Choose appropriate:
   - Node count and sizing (cores, RAM, disk)
   - Site placement (@group tags or auto)
   - Network type (L2Bridge, L2STS, FABNetv4, etc.)
   - Components (NICs, GPUs, NVMe as needed)

3. **Create the template directory** at `/fabric_storage/.slice_templates/<DirName>/`:
   - `metadata.json` — name, description, node_count, network_count, builtin: false
   - `template.fabric.json` — the full topology definition
   - `tools/deploy.sh` — if software needs to be installed (with ### PROGRESS markers)

4. **Verify**: Read back the created files to confirm they're correct.

Directory naming: Use the template name with spaces replaced by underscores.
Example: "GPU Compute Cluster" -> "GPU_Compute_Cluster"

Interface naming: `{node-name}-{component-name}-p{port}` (e.g., `node1-nic1-p1`)

Use `default_ubuntu_22` as the default image unless the user specifies otherwise.
Use `NIC_Basic` unless high-performance networking is needed.
Use `@group` tags for co-located nodes, different tags for distributed nodes.
