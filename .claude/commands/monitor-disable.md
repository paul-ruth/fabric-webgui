Disable monitoring on a slice — stops the scrape loop.

Usage: `/monitor-disable <slice-name>`

## Steps

1. **Parse the slice name** from `$ARGUMENTS`. If empty, ask the user.

2. **Disable monitoring**
   - `curl -s -X POST http://localhost:8000/api/monitoring/<slice-name>/disable | python3 -m json.tool`

3. **Verify**
   - `curl -s http://localhost:8000/api/monitoring/<slice-name>/status`
   - Confirm enabled=false and all nodes show disabled.

4. **Report**
   - Confirm monitoring is disabled.
   - Note that node_exporter containers remain running on the VMs (they don't consume significant resources). To fully remove them, the user would need to SSH in and run `docker rm -f node_exporter` on each VM.
