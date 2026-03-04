Commit all current changes with a GPG-signed commit and push to GitHub.

If `$ARGUMENTS` is provided, use it as the commit message. Otherwise, analyze the changes and generate a concise commit message.

## Steps

1. **Check for changes**
   - Run `git status` (never use `-uall`) and `git diff --stat` to see what's changed.
   - If there are no changes (no modified, no untracked files), report "Nothing to commit" and stop.

2. **Stage all changes**
   - Stage all modified and untracked files: `git add -A`
   - Exclude any sensitive files (.env, credentials, tokens) — if found, unstage them and warn.

3. **Generate or use commit message**
   - If `$ARGUMENTS` is non-empty, use it as the commit message body.
   - Otherwise, analyze staged changes (`git diff --cached --stat`) and write a concise summary.
   - Always append the co-author line.

4. **Create a GPG-signed commit**
   - Create a temporary GPG wrapper that feeds the passphrase via loopback mode:
     ```bash
     cat > /tmp/gpg-sign.sh << 'SCRIPT'
     #!/bin/bash
     gpg --batch --pinentry-mode loopback --passphrase-file ~/.gnupg_passphrase "$@"
     SCRIPT
     chmod +x /tmp/gpg-sign.sh
     ```
   - Then commit with signing using the wrapper:
     ```bash
     git -c gpg.program=/tmp/gpg-sign.sh commit -S -m "<message>"
     ```
   - If the commit fails, diagnose and report the error. Do NOT retry with `--no-gpg-sign`.

5. **Push to GitHub**
   - Run `git push` to push the current branch to its upstream remote.
   - If there is no upstream, use `git push -u origin <current-branch>`.
   - Report the result: branch name, commit hash, and remote URL.
