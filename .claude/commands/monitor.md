Check and manage slice monitoring status.

Usage: `/monitor <slice-name>` or `/monitor` (uses currently selected slice context if obvious).

## Steps

1. **Identify the slice**
   - Use `$ARGUMENTS` as the slice name.
   - If no argument given, check git status or recent conversation for context about which slice is active.
   - If still unclear, ask the user which slice to check.

2. **Check monitoring status**
   - `curl -s http://localhost:8000/api/monitoring/<slice-name>/status | python3 -m json.tool`
   - Report: enabled/disabled, number of nodes, per-node status (exporter installed, last scrape time, errors).

3. **Show latest metrics (if enabled)**
   - `curl -s http://localhost:8000/api/monitoring/<slice-name>/metrics | python3 -m json.tool`
   - Summarize CPU%, memory%, load, and network rates per node in a readable table.

4. **Suggest actions**
   - If monitoring is disabled: suggest running `/monitor-enable <slice-name>`
   - If nodes have errors: show the error messages and suggest troubleshooting (e.g., check SSH connectivity, verify node is running)
   - If metrics are stale (last scrape > 60s ago): note this and suggest checking backend logs

5. **Report summary**
   - Display a clean table: Node | Site | Status | CPU% | Mem% | Last Scrape
   - Use emoji-free formatting, align columns
