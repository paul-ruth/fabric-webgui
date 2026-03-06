name: deploy-slice
description: Create a slice from a template and submit it for provisioning on FABRIC
---
Deploy a FABRIC slice — create from a template and submit for provisioning.

## Steps

1. **Find the template**: Call `fabric_list_templates` to show available templates.
   If the user specified a template, match it by name or directory name.
   If not, show the list and ask which one to use.

2. **Create the draft**: Call `fabric_create_from_template(template_name, slice_name)`
   to build the slice. If the user didn't provide a slice name, use the template name.

3. **Show the draft**: Report what was created — nodes, sites, components, networks.
   The draft is automatically saved and visible in the web UI's slice list.
   Ask the user to confirm before submitting.

4. **Submit**: After user confirms, call `fabric_submit_slice(slice_name, wait=false)`
   to provision the slice on FABRIC.
   - For small slices (1-2 nodes), use `wait=true` to block until ready.
   - For larger slices, use `wait=false`.

5. **Wait & report**: For `wait=false`, tell the user:
   - Use `fabric_wait_slice(slice_name)` to wait for provisioning + SSH
   - Or `fabric_get_slice(slice_name)` to check progress
   - State transitions: Configuring → StableOK (ready) or StableError (failed)

## Alternative: Create from Scratch

If the user describes a custom topology instead of using a template:
1. `fabric_find_sites(component=..., min_cores=...)` to check hardware availability
2. `fabric_create_slice(slice_name, nodes, networks)` to build the draft
3. Confirm with user, then `fabric_submit_slice` to provision
4. `fabric_wait_slice` to wait for readiness

## After Deployment

Once the slice is ready (StableOK):
- `fabric_node_info(slice_name, node_name)` — Get SSH commands and IPs
- `fabric_slice_ssh(slice_name, node_name, command)` — Run commands on nodes
- `fabric_upload_file` / `fabric_download_file` — Transfer files

## Important

- Always show the user what will be created before submitting
- Submitting allocates real FABRIC resources — confirm first
- If site is "auto", mention which sites were auto-selected
- For GPU/FPGA nodes, verify availability first with `fabric_find_sites`
