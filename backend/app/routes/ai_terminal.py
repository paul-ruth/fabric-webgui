"""WebSocket AI terminal endpoints — PTY-based terminals for AI coding tools."""
from __future__ import annotations

import asyncio
import fcntl
import json
import logging
import os
import pty
import struct
import subprocess
import termios

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.routes.config import _get_ai_api_key

logger = logging.getLogger(__name__)

router = APIRouter()

# Tool definitions: env setup and command for each AI tool
# Default opencode.json — sets model to one available on the FABRIC AI server
_OPENCODE_CONFIG = {
    "$schema": "https://opencode.ai/config.json",
    "model": "openai/qwen3-coder-30b",
    "small_model": "openai/qwen3-coder-30b",
    "provider": {
        "openai": {
            "api": "env:OPENAI_API_KEY",
        },
    },
    "agent": {
        "build": {"model": "openai/qwen3-coder-30b"},
        "plan": {"model": "openai/qwen3-coder-30b"},
        "explore": {"model": "openai/qwen3-coder-30b"},
        "general": {"model": "openai/qwen3-coder-30b"},
        "summary": {"model": "openai/qwen3-coder-30b"},
        "title": {"model": "openai/qwen3-coder-30b"},
        "compaction": {"model": "openai/qwen3-coder-30b"},
    },
}

# Tool definitions: env setup and command for each AI tool
TOOL_CONFIGS = {
    "weave": {
        "env": lambda key: {
            "OPENAI_API_KEY": key,
            "OPENAI_BASE_URL": "https://ai.fabric-testbed.net/v1",
            "WEAVE_MODEL": "qwen3-coder-30b",
        },
        "cmd": ["python3", "/app/scripts/weave.py"],
        "needs_key": True,
    },
    "aider": {
        "env": lambda key: {
            "OPENAI_API_KEY": key,
            "OPENAI_API_BASE": "https://ai.fabric-testbed.net/v1",
        },
        "cmd": [
            "aider",
            "--architect",
            "--model", "openai/qwen3-coder-30b",
            "--no-auto-lint",
            "--no-auto-test",
            "--no-git-commit-verify",
        ],
        "needs_key": True,
    },
    "opencode": {
        "env": lambda key: {
            "OPENAI_API_KEY": key,
            "OPENAI_BASE_URL": "https://ai.fabric-testbed.net/v1",
        },
        "cmd": ["opencode"],
        "needs_key": True,
    },
    "claude": {
        "env": lambda key: {},
        "cmd": ["claude"],
        "needs_key": False,
    },
}


@router.websocket("/ws/terminal/ai/{tool}")
async def ai_terminal_ws(websocket: WebSocket, tool: str):
    """WebSocket endpoint for interactive AI tool terminal."""
    if tool not in TOOL_CONFIGS:
        await websocket.close(code=4000, reason=f"Unknown tool: {tool}")
        return

    await websocket.accept()

    config = TOOL_CONFIGS[tool]
    api_key = _get_ai_api_key() if config["needs_key"] else ""

    if config["needs_key"] and not api_key:
        await websocket.send_text(
            "\x1b[31mError: AI API key not configured. Go to Settings > Advanced > AI Companion to set your key.\x1b[0m\r\n"
        )
        await websocket.close()
        return

    loop = asyncio.get_event_loop()
    master_fd = None
    proc = None

    try:
        master_fd, slave_fd = pty.openpty()

        # Build environment
        tool_env = {**os.environ, "TERM": "xterm-256color"}
        tool_env.update(config["env"](api_key))

        cwd = "/fabric_storage/" if os.path.isdir("/fabric_storage") else os.path.expanduser("~")

        # Ensure git is ready for aider (needs user config + initial commit)
        if tool == "aider":
            _ensure_git_ready(cwd)

        # Write opencode.json so all agents use the FABRIC AI model
        if tool == "opencode":
            _ensure_git_ready(cwd)
            oc_cfg = os.path.join(cwd, "opencode.json")
            try:
                with open(oc_cfg, "w") as f:
                    json.dump(_OPENCODE_CONFIG, f, indent=2)
            except OSError:
                pass

        proc = subprocess.Popen(
            config["cmd"],
            stdin=slave_fd,
            stdout=slave_fd,
            stderr=slave_fd,
            cwd=cwd,
            preexec_fn=os.setsid,
            env=tool_env,
        )
        os.close(slave_fd)

        # Read from master fd and send to WebSocket
        async def read_pty():
            while True:
                try:
                    data = await loop.run_in_executor(None, _read_master, master_fd)
                    if data:
                        await websocket.send_text(data)
                    else:
                        await asyncio.sleep(0.05)
                except Exception:
                    break

        read_task = asyncio.create_task(read_pty())

        # Read from WebSocket and write to master fd
        while True:
            try:
                msg = await websocket.receive_text()
                parsed = json.loads(msg)
                if parsed.get("type") == "input":
                    os.write(master_fd, parsed["data"].encode("utf-8"))
                elif parsed.get("type") == "resize":
                    cols = parsed.get("cols", 80)
                    rows = parsed.get("rows", 24)
                    winsize = struct.pack("HHHH", rows, cols, 0, 0)
                    fcntl.ioctl(master_fd, termios.TIOCSWINSZ, winsize)
            except WebSocketDisconnect:
                break
            except Exception:
                break

        read_task.cancel()

    finally:
        if master_fd is not None:
            try:
                os.close(master_fd)
            except OSError:
                pass
        if proc is not None:
            try:
                proc.terminate()
                proc.wait(timeout=2)
            except Exception:
                try:
                    proc.kill()
                except Exception:
                    pass


def _ensure_git_ready(cwd: str) -> None:
    """Make sure cwd has a usable git repo with user config and an initial commit."""
    try:
        subprocess.run(
            ["git", "config", "user.name"],
            cwd=cwd, capture_output=True, check=True,
        )
    except (subprocess.CalledProcessError, FileNotFoundError):
        subprocess.run(
            ["git", "config", "--global", "user.name", "FABRIC User"],
            cwd=cwd, capture_output=True,
        )
        subprocess.run(
            ["git", "config", "--global", "user.email", "user@fabric-testbed.net"],
            cwd=cwd, capture_output=True,
        )

    # Ensure there is at least one commit (aider requires it)
    result = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=cwd, capture_output=True,
    )
    if result.returncode != 0:
        subprocess.run(["git", "add", "-A"], cwd=cwd, capture_output=True)
        subprocess.run(
            ["git", "commit", "--allow-empty", "-m", "Initial commit"],
            cwd=cwd, capture_output=True,
        )


def _read_master(fd: int) -> str:
    """Read available data from a PTY master fd."""
    try:
        data = os.read(fd, 4096)
        return data.decode("utf-8", errors="replace") if data else ""
    except OSError:
        return ""
