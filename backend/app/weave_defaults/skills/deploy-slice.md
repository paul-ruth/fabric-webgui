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

3. **Show the draft**: Report what was created — nodes, sites, networks.
   Ask the user to confirm before submitting.

4. **Submit**: After user confirms, call `fabric_submit_slice(slice_name, wait=false)`
   to provision the slice on FABRIC.
   - For small slices (1-2 nodes), you may use `wait=true` to wait for provisioning.
   - For larger slices, use `wait=false` and tell the user to check back later.

5. **Report**: Tell the user the slice is being provisioned and how to check status:
   - Use `fabric_get_slice(slice_name)` to check progress
   - The slice transitions: Configuring → StableOK (ready) or StableError (failed)

## Alternative: Create from Scratch

If the user describes a custom topology instead of using a template:
1. Use `fabric_list_sites` to check resource availability
2. Use `fabric_create_slice(slice_name, nodes, networks)` to build the draft
3. Confirm with user, then `fabric_submit_slice` to provision

## Important

- Always show the user what will be created before submitting
- Submitting allocates real FABRIC resources — confirm first
- If site is "auto", mention which sites were auto-selected
