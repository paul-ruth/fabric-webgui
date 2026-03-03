Rebuild the combined Docker image and push it to Docker Hub as `pruth/fabric-webui`.

Builds multi-platform images (linux/amd64 + linux/arm64) so the image works on Mac (Intel & Apple Silicon), Windows, and Linux. Auto-increments the patch version before building.

IMPORTANT: Before pushing, you MUST audit the built image to ensure it contains NO user data, secrets, or credentials. A contaminated push is irreversible for anyone who pulls before a fix.

## Steps

1. **Increment the version number**
   - Read the current version from `frontend/src/version.ts` (the single source of truth). It will look like `export const VERSION = "X.Y.Z-beta";`
   - Increment the patch number (Z → Z+1). For example `0.1.3-beta` → `0.1.4-beta`.
   - If `$ARGUMENTS` contains an explicit version string (e.g. `1.2.0`), use that instead of auto-incrementing. Strip any leading `v` prefix.
   - The suffix (currently `-beta`) should be preserved as-is when auto-incrementing. If an explicit version is given, use it exactly.
   - Update these files with the new version:
     - `frontend/src/version.ts` — update the VERSION string (include suffix)
     - `frontend/package.json` — update the `"version"` field (semver only, no suffix)
   - Set `VERSION_TAG` to the semver part (e.g. `0.1.4`) for Docker tagging.
   - Report: "Version bumped: X.Y.Z-beta → A.B.C-beta"

2. **Pre-flight checks**
   - Run `docker login` status check (`docker info 2>&1 | grep Username`) to confirm we're authenticated to Docker Hub.
   - If not logged in, stop and tell the user to run `docker login` first.
   - Ensure a buildx builder exists for multi-platform builds:
     `docker buildx inspect multiarch 2>/dev/null || docker buildx create --name multiarch --use`
     `docker buildx use multiarch`
     `docker buildx inspect --bootstrap`

3. **Build and push the multi-platform image**
   - `cd /mnt/scratch_nvme/work/fabric-webgui`
   - Use `docker buildx build` with `--push` (buildx builds remotely and pushes in one step for multi-platform):
     ```
     docker buildx build --no-cache \
       --platform linux/amd64,linux/arm64 \
       -t pruth/fabric-webui:latest \
       -t pruth/fabric-webui:<VERSION_TAG> \
       --push .
     ```
   - The `--no-cache` flag ensures a clean build from scratch — no stale layers that might contain old data.
   - This builds for both Intel/AMD (amd64) and Apple Silicon/ARM (arm64) and pushes both tags in one command.

4. **Audit the image for secrets and user data**
   Pull and run the freshly pushed image to verify. Run ALL of the following checks. If ANY check fails, report the finding.

   a. **Check /fabric_config is empty:**
      `docker run --rm pruth/fabric-webui:latest ls -la /fabric_config/`
      Must contain only `.` and `..` — no tokens, keys, or config files.

   b. **Check /fabric_storage is empty:**
      `docker run --rm pruth/fabric-webui:latest ls -la /fabric_storage/`
      Must contain only `.` and `..`.

   c. **Scan for common secret file patterns:**
      `docker run --rm pruth/fabric-webui:latest find / -maxdepth 4 \( -name "id_token*" -o -name "*.pem" -o -name "*_key" -o -name "*_key.pub" -o -name "*.env" -o -name "credentials*" -o -name "fabric_rc" -o -name "ssh_config" -o -name ".ssh" -o -name "*.json" -path "*/fabric_config/*" \) 2>/dev/null`
      Must return nothing.

   d. **Check no .claude directory leaked in:**
      `docker run --rm pruth/fabric-webui:latest test -d /app/.claude && echo "LEAKED" || echo "clean"`
      Must print "clean".

   e. **Check /tmp and /root are clean (no leftover user state):**
      `docker run --rm pruth/fabric-webui:latest sh -c "ls -la /root/ 2>/dev/null; ls -la /tmp/ 2>/dev/null"`
      Should contain no user-specific files (tokens, keys, history, etc.). Standard dotfiles like .bashrc are fine.

   f. **Check environment variables don't contain secrets:**
      `docker run --rm pruth/fabric-webui:latest env`
      Verify no env vars contain tokens, passwords, or API keys. Expected env vars like FABRIC_CONFIG_DIR=/fabric_config are fine.

5. **Report audit results**
   Summarize what each check found.

6. **Verify the push**
   - `docker buildx imagetools inspect pruth/fabric-webui:latest` to verify multi-platform manifest exists (should show both amd64 and arm64).
   - `docker buildx imagetools inspect pruth/fabric-webui:<VERSION_TAG>` to confirm the version tag exists too.
   - Report success with:
     - Which tags were pushed (`pruth/fabric-webui:latest` and `pruth/fabric-webui:<VERSION_TAG>`)
     - The version displayed in the UI (e.g. `v0.1.4-beta`)
     - Platforms supported (linux/amd64, linux/arm64)
     - Confirm both tags point to the same manifest
