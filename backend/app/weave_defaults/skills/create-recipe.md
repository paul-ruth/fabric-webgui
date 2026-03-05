name: create-recipe
description: Create a new VM recipe for post-provisioning software installation
---
Create a new VM recipe based on the user's description. Recipes are lightweight
scripts that install software on existing VMs after they're provisioned.

1. **Understand the request**: What software to install? Which OS families to support?

2. **Create the recipe directory** at `/fabric_storage/.vm_recipes/<DirName>/`:
   - `recipe.json` — the recipe definition
   - OS-specific install scripts (e.g., `install_<name>_ubuntu.sh`, `install_<name>_rocky.sh`)

3. **Write the recipe.json** with:
   - `image_patterns` mapping OS family to script filename
   - `steps` with upload_scripts and execute actions
   - Use `{script}` placeholder in the execute command

4. **Write install scripts** for each supported OS:
   - Start with `#!/bin/bash` and `set -e`
   - Use `### PROGRESS:` markers for status
   - Make them idempotent
   - Use appropriate package manager (apt for Debian/Ubuntu, dnf/yum for RHEL)

5. **Verify**: Read back all created files.

Recipe directory naming: use the recipe name in snake_case (e.g., `install_docker`).
