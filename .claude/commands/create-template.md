Slice Template Architect — design and build orchestrated multi-node slice templates with complex boot configuration.

Usage: `/create-template <description of the desired slice deployment>`

You are a specialist in creating FABRIC slice templates that orchestrate complicated multi-node deployments with configuration dependencies between nodes. Your job is to turn a user's high-level description into a complete, working slice template.

## On Startup

1. Read `docs/ARCHITECTURE.md` (focus on "Slice Libraries" section).
2. Read the user's request: `$ARGUMENTS`
3. Study existing templates for patterns (see Reference section below).

## Template File Structure

Every slice template lives in `slice-libraries/slice_templates/{Name_With_Underscores}/` and consists of:

```
{Name}/
├── metadata.json           # Display name, description, order, node/network counts
├── template.fabric.json    # Topology: nodes, components, networks, boot_config
└── tools/                  # Optional shell scripts uploaded to ~/tools on each node
    ├── setup-server.sh
    └── setup-worker.sh
```

After creating/modifying files, ALWAYS sync: `rm -rf backend/slice-libraries && cp -r slice-libraries backend/slice-libraries`

## File Formats

### metadata.json
```json
{
  "name": "Human Readable Name",
  "description": "1-2 sentence description of what the template deploys and how to use it.",
  "builtin": true,
  "order": 12,
  "node_count": 3,
  "network_count": 1
}
```

### template.fabric.json
```json
{
  "format": "fabric-slice-v1",
  "name": "Human Readable Name",
  "nodes": [
    {
      "name": "node-name",
      "site": "@group-tag",
      "cores": 4,
      "ram": 16,
      "disk": 50,
      "image": "default_ubuntu_22",
      "boot_config": {
        "uploads": [],
        "commands": [
          {
            "id": "1",
            "command": "chmod +x ~/tools/*.sh && ~/tools/setup-script.sh",
            "order": 0
          }
        ],
        "network": []
      },
      "components": [
        {"name": "FABNET", "model": "NIC_Basic"},
        {"name": "gpu1", "model": "GPU_RTX6000"}
      ]
    }
  ],
  "networks": [
    {
      "name": "net-name",
      "type": "FABNetv4",
      "interfaces": ["node-name-FABNET-p1", "other-node-FABNET-p1"]
    }
  ]
}
```

## Key Rules

### Site Groups (`@tag` syntax)
- Nodes with the same `@tag` are co-located at the same site
- Different `@tags` allow placement at different sites
- Use `"auto"` for single nodes where co-location doesn't matter
- Examples: `@cluster`, `@site-a`, `@site-b`

### Interface Naming Convention
Interface names follow the pattern: `{node-name}-{component-name}-p{port}`
- Example: node `server` with component `FABNET` → interface `server-FABNET-p1`
- Example: node `router1` with component `nic-r2` → interface `router1-nic-r2-p1`

### Network Types
- `FABNetv4` — Routed IPv4 (most common, auto-assigns IPs, works across sites)
- `FABNetv6` — Routed IPv6
- `L2Bridge` — Layer 2 bridge (same site only, needs manual/auto IP)
- `L2STS` — Layer 2 site-to-site (cross-site L2)

### Component Models
- `NIC_Basic` — 1 Gbps NIC (most common)
- `NIC_ConnectX_5` / `NIC_ConnectX_6` — 25/100 Gbps SmartNICs
- `GPU_RTX6000` / `GPU_A30` / `GPU_A40` — NVIDIA GPUs
- `NVME_P4510` — NVMe storage
- `FPGA_Xilinx_U280` — FPGA

### Boot Config Best Practices

**Use tools/ scripts instead of inline commands** for anything longer than a one-liner. The tools/ directory is auto-uploaded to `~/tools/` on each node when the template is loaded. Each node's boot_config command should be:
```json
{"id": "1", "command": "chmod +x ~/tools/*.sh && ~/tools/setup-whatever.sh", "order": 0}
```

### Orchestrating Configuration Dependencies

This is the most critical part. Multi-node templates often have ordering dependencies (e.g., workers need to know the server's IP). Since boot scripts run independently on each node, use these patterns:

**Pattern 1: Auto-discovery (preferred for monitoring/service mesh)**
- Server node runs a discovery script on a timer that scans the subnet
- Workers just install their service; server finds them automatically
- Example: Prometheus discovers node_exporters via nmap scan of FABNetv4 subnet
```bash
# Detect FABNetv4 subnet from local interface
SUBNET=$(ip -4 addr show | grep -oP '10\.\d+\.\d+\.\d+/\d+' | head -1)
# Scan for nodes with service port open
nmap -sn "$SUBNET" -oG - | awk '/Up$/{print $2}'
```

**Pattern 2: Retry loops for eventual consistency**
- When a service depends on another node being ready, use a background retry loop
- Don't block the main script — run retries in background with `( ... ) &`
```bash
# Background: retry until dependency is ready (up to 5 min)
(for i in $(seq 1 30); do
  # Check if dependency is satisfied
  if some_check; then break; fi
  sleep 10
done) &
```

**Pattern 3: API-based provisioning (preferred for dashboards/config)**
- After installing a service, use its API to configure it
- Wait for the API to be healthy before calling it
```bash
# Wait for service API
for i in $(seq 1 30); do
  curl -sf http://localhost:PORT/api/health > /dev/null 2>&1 && break
  sleep 2
done
# Then configure via API
curl -X POST http://localhost:PORT/api/config -d '...'
```

**Pattern 4: GPU auto-detection (for optional GPU support)**
```bash
HAS_GPU=false
if lspci | grep -qi nvidia; then
  HAS_GPU=true
  # Install NVIDIA drivers + container toolkit
fi
# Later, conditionally use GPU
if [ "$HAS_GPU" = true ]; then
  docker run --gpus all ...
fi
```

**Pattern 5: Embedding for Client View (for web UIs)**
When a service has a web UI that should work in the Client View iframe:
- Disable auth or enable anonymous access (WEBUI_AUTH=false, allow_embedding=true)
- The Client View SSH tunnel strips X-Frame-Options headers automatically
- Default Client View port is 3000

### Script Writing Guidelines

1. Always start with `#!/bin/bash` and `set -ex`
2. Use `sudo` for system operations
3. Use `-qq` flags on apt-get for quiet output
4. Install from official sources (upstream repos, not distro packages) for latest versions
5. Use systemd units for services that should survive reboots
6. Echo clear status messages at the end showing URLs and access info
7. Background long-running setup tasks that aren't needed for the script to complete
8. Handle the case where internet access to external repos (grafana.com, docker hub) may fail

## Existing Templates (for reference)

| Template | Nodes | Pattern | Key Feature |
|----------|-------|---------|-------------|
| Hello FABRIC | 1 | Single node | Minimal starting point |
| L2 Bridge | 2 | Co-located pair | L2Bridge network, auto IP |
| Wide-Area L2 | 2 | Cross-site pair | L2STS network |
| iPerf3 Bandwidth | 2 | Client-server | FABNetv4, recipe-based install |
| Prometheus + Grafana | 3 | Monitor + workers | Auto-discovery, dashboard provisioning, embedding |
| FRR OSPF Triangle | 6 | Router mesh + hosts | Complex topology, multiple L2Bridge networks |
| Kubernetes Cluster | 3 | Controller + workers | VM template based, FABNetv4 |
| P4 BMv2 Lab | 4 | Switches + hosts | Software switch experimentation |
| GPU Compute Pair | 2 | GPU nodes cross-site | L2STS, NVIDIA drivers |
| Ollama LLM Service | 1 | Single GPU/CPU | Docker, optional GPU, web UI, no auth |

## Process

1. **Analyze** the user's request — identify nodes, their roles, and dependencies
2. **Design** the topology — which nodes, components, networks, and site groups
3. **Plan** boot config orchestration — what needs to happen on each node and in what order
4. **Write** the template files (metadata.json, template.fabric.json, tools/*.sh)
5. **Sync** to backend: `rm -rf backend/slice-libraries && cp -r slice-libraries backend/slice-libraries`
6. **Rebuild** if requested: suggest the user run `/rebuild`

## When Done

Report what was created: template name, node count, network topology, and what the boot scripts do. Mention any Client View ports and access instructions.
