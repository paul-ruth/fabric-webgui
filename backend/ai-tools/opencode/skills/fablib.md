name: fablib
description: Manage FABRIC slices, resources, and experiments using built-in FABlib tools
---
Help the user interact with FABRIC using the built-in tools. For detailed
reference tables (component models, network types, images, node specs), see
AGENTS.md — it is loaded as context automatically.

## Tool Categories

**Slice Lifecycle:** `fabric_list_slices`, `fabric_get_slice`, `fabric_create_slice`,
`fabric_submit_slice`, `fabric_modify_slice`, `fabric_delete_slice`,
`fabric_renew_slice`, `fabric_wait_slice`

**SSH & Files:** `fabric_slice_ssh`, `fabric_upload_file`, `fabric_download_file`,
`fabric_node_info`

**Resources:** `fabric_list_sites`, `fabric_list_hosts`, `fabric_list_images`,
`fabric_list_components`, `fabric_find_sites`

**Config:** `fabric_get_config`, `fabric_set_config`, `fabric_load_rc`,
`fabric_list_projects`, `fabric_set_project`

**Templates:** `fabric_list_templates`, `fabric_create_from_template`

## When to Use Tools vs Python Scripts

**Use tools** for: listing/inspecting slices and sites, creating slices (up to ~10 nodes),
running commands on nodes, uploading/downloading files, modifying/deleting/renewing slices.

**Write a Python script** (using `FablibManager()`) for: sub-interfaces, VLAN tagging,
port mirroring, CPU pinning, NUMA tuning, persistent storage (CephFS), batch operations
across many slices, complex data analysis with pandas/matplotlib.

## Authentication

Token: `/fabric_storage/.fabric_config/id_token.json`
Config: `/fabric_storage/.fabric_config/fabric_rc`

FABlib is pre-configured — all tools use the user's credentials automatically.
If token errors occur, direct the user to refresh via the Configure view.
Token expires every ~1 hour.
