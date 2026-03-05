name: debug
description: Debug common FABRIC issues (SSH, networking, resources)
---
Help the user debug common FABRIC issues. Follow a systematic approach:

1. **Identify the problem category**:
   - **SSH connectivity**: Can't connect to nodes
   - **Slice creation**: Submit failures, resource unavailable
   - **Networking**: Nodes can't communicate
   - **Boot config**: Scripts failing during setup
   - **Resource issues**: Node not responding, out of resources

2. **Common SSH issues**:
   - Check if the slice is in StableOK state
   - Verify SSH keys are configured in FABRIC config
   - Check bastion key is present: `ls -la /fabric_storage/.fabric_config/fabric_bastion_key`
   - Try manual SSH: `ssh -F /fabric_storage/.fabric_config/ssh_config <user>@<mgmt_ip>`
   - Check if management IP is reachable

3. **Common networking issues**:
   - FABNetv4 routing: Check `ip route show` for 10.128.0.0/10 route
   - L2 networks: Check if interfaces are up: `ip addr show`
   - Cross-site: Verify both endpoints are at different sites for L2STS

4. **Common slice creation issues**:
   - Site capacity: Try a different site or reduce resources
   - Token expiration: Check `/fabric_storage/.fabric_config/id_token.json`
   - Quota: Check project allocation limits

5. **Diagnostic commands** (run on the node):
   ```bash
   ip addr show          # Network interfaces
   ip route show         # Routing table
   ping -c 3 <target>    # Connectivity test
   systemctl status <svc> # Service status
   journalctl -u <svc>   # Service logs
   df -h                 # Disk usage
   free -h               # Memory usage
   ```
