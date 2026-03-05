name: ssh-config
description: Configure and troubleshoot SSH for FABRIC access
---
Help the user configure SSH for FABRIC access.

1. **Check current config**:
   - List config files: `ls -la /fabric_storage/.fabric_config/`
   - Check for required files: fabric_rc, fabric_bastion_key, ssh_config, id_token.json
   - Check slice keys: `ls -la /fabric_storage/.fabric_config/slice_keys/`

2. **SSH config structure**:
   - `fabric_bastion_key` — SSH key for the bastion host
   - `ssh_config` — SSH config that routes through the bastion
   - `slice_keys/default/slice_key` — Private key for slice VMs
   - `slice_keys/default/slice_key.pub` — Public key for slice VMs

3. **Generate new slice keys** if needed:
   ```bash
   mkdir -p /fabric_storage/.fabric_config/slice_keys/default
   ssh-keygen -t rsa -b 3072 -f /fabric_storage/.fabric_config/slice_keys/default/slice_key -N "" -C "fabric-slice-key"
   ```

4. **Test SSH connectivity**:
   ```bash
   ssh -F /fabric_storage/.fabric_config/ssh_config -i /fabric_storage/.fabric_config/slice_keys/default/slice_key <user>@<management_ip>
   ```

5. **Common issues**:
   - Bastion key permissions: `chmod 600 /fabric_storage/.fabric_config/fabric_bastion_key`
   - Slice key permissions: `chmod 600 /fabric_storage/.fabric_config/slice_keys/*/slice_key`
   - Token expired: User needs to refresh via FABRIC portal
