name: create-vm-template
description: Create a new VM template for a single-node configuration
---
Create a new VM template based on the user's description. VM templates define
single-node configurations that can be added to any slice.

1. **Understand the request**: What software/configuration? Which OS images should
   be supported? What resources does it need?

2. **Create the template directory** at `/fabric_storage/.vm_templates/<DirName>/`:
   - `vm-template.json` — the template definition

3. **Choose the right format**:
   - **Simple (boot_config)**: If the setup is the same across all OS images, use
     inline boot_config commands. Good for pip installs, simple apt packages.
   - **Multi-variant**: If setup differs by OS, create variant directories with
     OS-specific setup.sh scripts.

4. **Verify**: Read back the created files.

Simple format example:
```json
{
  "name": "My Template",
  "version": "1.0.0",
  "description": "What this template configures",
  "image": "default_ubuntu_22",
  "builtin": false,
  "boot_config": {
    "uploads": [],
    "commands": [
      {"id": "1", "command": "sudo apt-get update && sudo apt-get install -y package", "order": 0}
    ],
    "network": []
  }
}
```
