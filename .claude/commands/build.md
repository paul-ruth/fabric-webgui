Build the frontend production bundle and verify it compiles cleanly.

Usage: `/build`

## Steps

1. `cd /mnt/scratch_nvme/work/fabric-webgui/frontend`

2. **Install dependencies if needed**
   - Check if `node_modules` exists. If not, run `npm install`.

3. **Build**
   - `npm run build`
   - This runs `NEXT_BUILD_MODE=export next build` which produces a static export.

4. **Report results**
   - If build succeeded: report the route sizes and total bundle size from the Next.js output.
   - If build failed: show the full error output (TypeScript errors, missing imports, etc.) and suggest fixes.

5. **Update team status** (if `docs/TEAM_STATUS.md` has active work)
   - If build succeeded: note "Build: OK" in the Notes column of any active task.
   - If build failed: add a blocker entry with the error summary.
