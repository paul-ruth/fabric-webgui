Start the local development environment (backend + frontend) without Docker.

Usage: `/dev` or `/dev backend` or `/dev frontend`

## Steps

1. **Parse argument** from `$ARGUMENTS`:
   - `backend` — start only the backend
   - `frontend` — start only the frontend
   - Empty or `full` — start both

2. **Start backend** (if requested)
   - `cd /mnt/scratch_nvme/work/fabric-webgui/backend`
   - Check if venv exists: `test -d venv`
   - If not: `python3 -m venv venv && source venv/bin/activate && pip install -r requirements.txt`
   - If yes: `source venv/bin/activate`
   - Start uvicorn in the background: `uvicorn app.main:app --reload --port 8000 &`
   - Verify it's running: `curl -s http://localhost:8000/api/health`

3. **Start frontend** (if requested)
   - `cd /mnt/scratch_nvme/work/fabric-webgui/frontend`
   - Check if node_modules exists: `test -d node_modules`
   - If not: `npm install`
   - Start Next.js dev server in the background: `npm run dev &`
   - The dev server runs on port 3000 and proxies `/api/*` to localhost:8000.

4. **Report**
   - Backend: http://localhost:8000 (API docs at http://localhost:8000/docs)
   - Frontend: http://localhost:3000
   - Remind user that Ctrl+C or killing the terminal stops the servers.
