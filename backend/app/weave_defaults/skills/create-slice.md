name: create-slice
description: Create a new FABRIC slice — from a template or custom specification
---
Create a new FABRIC slice. There are two approaches:

## Option 1: From a Template

If the user mentions a template or wants a pre-built topology:

1. Call `fabric_list_templates` to show available templates
2. Call `fabric_create_from_template(template_name, slice_name)` to create the draft
3. Show what was created (nodes, sites, networks)
4. If the user wants to submit/deploy, call `fabric_submit_slice(slice_name)`

## Option 2: Custom Specification

If the user describes a custom topology:

1. **Understand the request**: How many nodes? What topology? What resources?

2. **Check resources**: Call `fabric_list_sites` to find sites with availability

3. **Create the draft**: Call `fabric_create_slice(slice_name, nodes, networks)` with:
   - Node specs: name, site (or "auto"), cores, ram, disk, image, nic_model, gpu_model
   - Network specs: name, type (L2Bridge/L2STS/FABNetv4/etc.), interfaces (node names)

4. **Report**: Show what was created. If the user wants to deploy, use
   `fabric_submit_slice(slice_name)` to provision.

## Option 3: Create a Reusable Template

If the user wants to save the design as a reusable template (not deploy it now):

1. Create the template directory at `/fabric_storage/.slice_templates/<DirName>/`:
   - `metadata.json` — name, description, node_count, network_count, builtin: false
   - `template.fabric.json` — the full topology definition
   - `tools/deploy.sh` — if software needs to be installed (with ### PROGRESS markers)

2. Verify by reading back the created files.

## Submitting / Deploying

After creating a draft (Options 1 or 2), the user may want to submit it:
- Call `fabric_submit_slice(slice_name, wait=false)` to provision
- For small slices (1-2 nodes), `wait=true` is OK
- Always confirm with the user before submitting — it allocates real resources

## Defaults

- Image: `default_ubuntu_22`
- NIC: `NIC_Basic` (unless high-performance needed)
- Site: `auto` (picks best available) or `@group` tags for co-location
- Interface naming: `{node-name}-{component-name}-p{port}`
