Rebuild the combined Docker image and push it to Docker Hub as `pruth/fabric-webui:latest`.

IMPORTANT: Before pushing, you MUST audit the built image to ensure it contains NO user data, secrets, or credentials. A contaminated push is irreversible for anyone who pulls before a fix.

## Steps

1. **Pre-flight checks**
   - Run `docker login` status check (`docker info 2>&1 | grep Username`) to confirm we're authenticated to Docker Hub.
   - If not logged in, stop and tell the user to run `docker login` first.

2. **Build the image**
   - `cd /mnt/scratch_nvme/work/fabric-webgui`
   - `docker build --no-cache -t pruth/fabric-webui:latest .`
   - The `--no-cache` flag ensures a clean build from scratch — no stale layers that might contain old data.

3. **Audit the image for secrets and user data**
   Run ALL of the following checks inside the freshly built image. If ANY check fails, STOP immediately and report the finding. Do NOT push.

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

4. **Report audit results**
   Summarize what each check found. Only proceed if ALL checks pass.

5. **Push to Docker Hub**
   - `docker push pruth/fabric-webui:latest`

6. **Verify the push**
   - `docker inspect pruth/fabric-webui:latest --format '{{.Id}}'` to get the image digest.
   - Report success with the image ID/digest.
