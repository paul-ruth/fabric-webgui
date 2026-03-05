Check the health and configuration status of the fabric-webgui backend.

Usage: `/health`

## Steps

1. **Check if backend is running**
   - `curl -s http://localhost:8000/api/health | python3 -m json.tool`
   - If connection refused: report that backend is not running and suggest `/dev backend` or `/rebuild`.

2. **Check FABRIC configuration**
   - `curl -s http://localhost:8000/config/status | python3 -m json.tool`
   - Report:
     - Token: valid/expired/missing (show email and expiry if present)
     - Bastion key: configured/missing
     - Slice keys: configured/missing (list key sets if any)
     - Active project: name and UUID

3. **Check Docker containers** (if using Docker)
   - `docker compose -f docker-compose.dev.yml ps 2>/dev/null` from `/mnt/scratch_nvme/work/fabric-webgui`
   - Report container status and ports.

4. **Summary**
   - Green: everything configured and running
   - Yellow: running but missing some config (e.g., expired token)
   - Red: backend not running or FABRIC not configured at all
