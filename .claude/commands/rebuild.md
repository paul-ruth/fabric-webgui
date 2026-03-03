Rebuild and restart the test containers.

Steps:
1. `cd /mnt/scratch_nvme/work/fabric-webgui`
2. Build the frontend production bundle: `cd frontend && npm run build`
3. Sync slice-libraries into the backend build context: `rm -rf backend/slice-libraries && cp -r slice-libraries backend/slice-libraries`
4. Run `docker compose down` to stop the running containers
5. Run `docker compose build` to rebuild both backend and frontend images
6. Run `docker compose up -d` to start containers in detached mode
7. Wait a few seconds, then run `docker compose ps` to verify both services are healthy
8. Report the result — which containers are running and on which ports
9. If `docs/TEAM_STATUS.md` has active work, update it with build/deploy results
