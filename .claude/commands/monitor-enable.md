Enable monitoring on a slice — installs node_exporter on all VMs and starts the scrape loop.

Usage: `/monitor-enable <slice-name>`

## Steps

1. **Parse the slice name** from `$ARGUMENTS`. If empty, ask the user.

2. **Pre-flight check**
   - Verify the backend is running: `curl -s http://localhost:8000/api/health`
   - If not running, tell the user to start it first (e.g., `/rebuild` or `./run-dev.sh`).

3. **Check current status**
   - `curl -s http://localhost:8000/api/monitoring/<slice-name>/status`
   - If already enabled, report current state and ask if user wants to proceed anyway.

4. **Enable monitoring**
   - `curl -s -X POST http://localhost:8000/api/monitoring/<slice-name>/enable | python3 -m json.tool`
   - This installs Docker + prom/node-exporter on each VM via SSH. It may take 1-2 minutes per node.
   - Report the install results for each node (success/failure).

5. **Wait and verify**
   - Wait 20 seconds for the first scrape cycle.
   - `curl -s http://localhost:8000/api/monitoring/<slice-name>/status`
   - Report which nodes are actively scraping vs. which have errors.

6. **Report**
   - Show per-node status: name, site, exporter installed, scraping active, any errors.
   - Remind user they can view charts in the Monitoring view in the WebUI.
