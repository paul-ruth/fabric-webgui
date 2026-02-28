Rebuild and restart the test containers.

Steps:
1. `cd /mnt/scratch_nvme/work/fabric-webgui`
2. Build the frontend production bundle: `cd frontend && npm run build`
3. Run `docker compose down` to stop the running containers
4. Run `docker compose build` to rebuild both backend and frontend images
5. Run `docker compose up -d` to start containers in detached mode
6. Wait a few seconds, then run `docker compose ps` to verify both services are healthy
7. Report the result — which containers are running and on which ports
