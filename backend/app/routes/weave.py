"""Weave chat WebSocket — structured JSON events for the React chat UI."""
from __future__ import annotations

import asyncio
import json
import logging
import os
import subprocess
from pathlib import Path
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.routes.config import _get_ai_api_key

logger = logging.getLogger(__name__)
router = APIRouter()

API_BASE = "https://ai.fabric-testbed.net/v1"
MODEL = "qwen3-coder-30b"
CWD = "/fabric_storage" if os.path.isdir("/fabric_storage") else os.path.expanduser("~")
MAX_OUTPUT = 12_000
CMD_TIMEOUT = 30

# ── System prompt ─────────────────────────────────────────────────────────────

SYSTEM_PROMPT = f"""\
You are Weave, a FABRIC testbed AI coding assistant. You help users write \
code, manage files, run commands, and work with the FABRIC research \
infrastructure.

IMPORTANT — Always follow this workflow:
1. **Plan**: Start every response by briefly stating what you will do (1-3 \
bullet points). Keep it concise.
2. **Execute**: Carry out the plan using your tools. Read files before \
editing. Verify changes after making them.
3. **Done**: End with a short summary of what was accomplished, e.g. \
"Done — created hello.py with a Flask server on port 8080."

You have tools to read files, edit files, create files, search code, list \
directories, and run shell commands. Use them proactively.

When the user asks about FABRIC, you know:
- FABRIC is a nationwide research infrastructure for networking and \
distributed computing
- Users create "slices" containing VMs, networks, and specialized hardware \
(GPUs, FPGAs, SmartNICs)
- FABlib is the Python library for programmatic access
- Sites include RENC, TACC, UCSD, UTAH, MASS, STAR, and many more

Working directory: {CWD}
"""

# ── Tool schemas ──────────────────────────────────────────────────────────────

TOOLS = [
    {"type": "function", "function": {
        "name": "read_file",
        "description": "Read the contents of a file with line numbers.",
        "parameters": {"type": "object", "properties": {
            "path": {"type": "string", "description": "File path"},
            "offset": {"type": "integer", "description": "Start line (1-based)"},
            "limit": {"type": "integer", "description": "Max lines"},
        }, "required": ["path"]},
    }},
    {"type": "function", "function": {
        "name": "write_file",
        "description": "Create or overwrite a file.",
        "parameters": {"type": "object", "properties": {
            "path": {"type": "string", "description": "File path"},
            "content": {"type": "string", "description": "File content"},
        }, "required": ["path", "content"]},
    }},
    {"type": "function", "function": {
        "name": "edit_file",
        "description": "Replace an exact string in a file with new text.",
        "parameters": {"type": "object", "properties": {
            "path": {"type": "string", "description": "File path"},
            "old_string": {"type": "string", "description": "Text to find"},
            "new_string": {"type": "string", "description": "Replacement"},
        }, "required": ["path", "old_string", "new_string"]},
    }},
    {"type": "function", "function": {
        "name": "list_directory",
        "description": "List files and directories.",
        "parameters": {"type": "object", "properties": {
            "path": {"type": "string", "description": "Directory path"},
        }, "required": []},
    }},
    {"type": "function", "function": {
        "name": "search_files",
        "description": "Grep for a regex pattern in files.",
        "parameters": {"type": "object", "properties": {
            "pattern": {"type": "string", "description": "Regex pattern"},
            "path": {"type": "string", "description": "Directory"},
            "include": {"type": "string", "description": "Glob filter e.g. *.py"},
        }, "required": ["pattern"]},
    }},
    {"type": "function", "function": {
        "name": "glob_files",
        "description": "Find files matching a glob pattern.",
        "parameters": {"type": "object", "properties": {
            "pattern": {"type": "string", "description": "Glob e.g. **/*.py"},
        }, "required": ["pattern"]},
    }},
    {"type": "function", "function": {
        "name": "run_command",
        "description": "Execute a shell command.",
        "parameters": {"type": "object", "properties": {
            "command": {"type": "string", "description": "Shell command"},
        }, "required": ["command"]},
    }},
]

# ── Tool handlers ─────────────────────────────────────────────────────────────


def _resolve(path: str) -> Path:
    p = Path(path)
    if not p.is_absolute():
        p = Path(CWD) / p
    return p.resolve()


def _tool_read_file(path: str, offset: int = 1, limit: int = 0) -> str:
    p = _resolve(path)
    if not p.exists():
        return f"Error: File not found: {path}"
    if not p.is_file():
        return f"Error: Not a file: {path}"
    lines = p.read_text().splitlines()
    start = max(0, offset - 1)
    end = start + limit if limit > 0 else len(lines)
    numbered = [f"{i+start+1:>5} | {l}" for i, l in enumerate(lines[start:end])]
    result = "\n".join(numbered)
    if len(result) > MAX_OUTPUT:
        result = result[:MAX_OUTPUT] + f"\n... (truncated, {len(lines)} lines total)"
    return result


def _tool_write_file(path: str, content: str) -> str:
    p = _resolve(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content)
    n = content.count("\n") + (1 if content and not content.endswith("\n") else 0)
    return f"Wrote {n} lines to {path}"


def _tool_edit_file(path: str, old_string: str, new_string: str) -> str:
    p = _resolve(path)
    if not p.exists():
        return f"Error: File not found: {path}"
    content = p.read_text()
    count = content.count(old_string)
    if count == 0:
        return f"Error: old_string not found in {path}"
    if count > 1:
        return f"Error: old_string found {count} times — make it more specific."
    p.write_text(content.replace(old_string, new_string, 1))
    return f"Edited {path}: replaced 1 occurrence"


def _tool_list_directory(path: str = ".") -> str:
    p = _resolve(path)
    if not p.is_dir():
        return f"Error: Not a directory: {path}"
    entries = sorted(p.iterdir(), key=lambda x: (not x.is_dir(), x.name.lower()))
    lines = []
    for e in entries:
        if e.name.startswith("."):
            continue
        if e.is_dir():
            lines.append(f"  {e.name}/")
        else:
            sz = e.stat().st_size
            h = f"{sz}B" if sz < 1024 else (f"{sz/1024:.1f}K" if sz < 1048576 else f"{sz/1048576:.1f}M")
            lines.append(f"  {e.name}  ({h})")
    return "\n".join(lines) or "(empty)"


def _tool_search_files(pattern: str, path: str = ".", include: str = "") -> str:
    cmd = ["grep", "-rn", "--color=never", "-E", pattern]
    if include:
        cmd.extend(["--include", include])
    cmd.append(str(_resolve(path)))
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
    out = r.stdout.strip()
    if not out:
        return "No matches found."
    return out[:MAX_OUTPUT] if len(out) <= MAX_OUTPUT else out[:MAX_OUTPUT].rsplit("\n", 1)[0] + "\n... (truncated)"


def _tool_glob_files(pattern: str) -> str:
    import glob
    matches = sorted(glob.glob(pattern, recursive=True))
    if not matches:
        return "No files matched."
    result = "\n".join(matches[:200])
    if len(matches) > 200:
        result += f"\n... ({len(matches)} total)"
    return result


def _tool_run_command(command: str) -> str:
    r = subprocess.run(command, shell=True, capture_output=True, text=True, timeout=CMD_TIMEOUT, cwd=CWD)
    out = ""
    if r.stdout:
        out += r.stdout
    if r.stderr:
        out += ("\n" if out else "") + r.stderr
    if r.returncode != 0:
        out += f"\n(exit code: {r.returncode})"
    if not out.strip():
        out = "(no output)"
    return out[:MAX_OUTPUT] if len(out) <= MAX_OUTPUT else out[:MAX_OUTPUT] + "\n... (truncated)"


_HANDLERS: dict[str, Any] = {
    "read_file": lambda a: _tool_read_file(a["path"], a.get("offset", 1), a.get("limit", 0)),
    "write_file": lambda a: _tool_write_file(a["path"], a["content"]),
    "edit_file": lambda a: _tool_edit_file(a["path"], a["old_string"], a["new_string"]),
    "list_directory": lambda a: _tool_list_directory(a.get("path", ".")),
    "search_files": lambda a: _tool_search_files(a["pattern"], a.get("path", "."), a.get("include", "")),
    "glob_files": lambda a: _tool_glob_files(a["pattern"]),
    "run_command": lambda a: _tool_run_command(a["command"]),
}


def _exec_tool(name: str, args: dict) -> str:
    h = _HANDLERS.get(name)
    if not h:
        return f"Unknown tool: {name}"
    try:
        return h(args)
    except Exception as e:
        return f"Error in {name}: {e}"


# ── WebSocket endpoint ────────────────────────────────────────────────────────

@router.websocket("/ws/weave")
async def weave_ws(websocket: WebSocket):
    await websocket.accept()

    api_key = _get_ai_api_key()
    if not api_key:
        await websocket.send_json({"type": "error", "content": "AI API key not configured."})
        await websocket.close()
        return

    # Lazy import openai
    from openai import OpenAI
    client = OpenAI(api_key=api_key, base_url=API_BASE)
    messages: list[dict] = [{"role": "system", "content": SYSTEM_PROMPT}]

    try:
        while True:
            raw = await websocket.receive_text()
            data = json.loads(raw)

            if data.get("type") == "message":
                user_text = data.get("content", "").strip()
                if not user_text:
                    continue
                messages.append({"role": "user", "content": user_text})
                await _agent_turn(websocket, client, messages)

            elif data.get("type") == "clear":
                messages = [messages[0]]
                await websocket.send_json({"type": "cleared"})

    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.exception("weave ws error")
        try:
            await websocket.send_json({"type": "error", "content": str(e)})
        except Exception:
            pass


async def _agent_turn(ws: WebSocket, client: Any, messages: list[dict]) -> None:
    """Run one full agent turn: stream text, handle tool calls, repeat."""
    loop = asyncio.get_event_loop()

    iteration = 0
    while True:
        # Signal thinking phase
        if iteration == 0:
            await ws.send_json({"type": "status", "message": "Thinking..."})
        else:
            await ws.send_json({"type": "status", "message": "Analyzing results..."})
        iteration += 1

        # Signal start of assistant response
        await ws.send_json({"type": "assistant_start"})

        # Call LLM (in executor since openai is sync)
        try:
            response = await loop.run_in_executor(
                None, lambda: client.chat.completions.create(
                    model=MODEL, messages=messages, tools=TOOLS, stream=True,
                )
            )
        except Exception as e:
            await ws.send_json({"type": "error", "content": f"API error: {e}"})
            return

        # Stream response
        content = ""
        tool_calls: dict[int, dict] = {}
        in_think = False

        try:
            for chunk in response:
                if not chunk.choices:
                    continue
                delta = chunk.choices[0].delta

                if delta.content:
                    text = delta.content
                    # Filter <think>...</think>
                    if "<think>" in text:
                        in_think = True
                        text = text.split("<think>")[0]
                    if "</think>" in text:
                        in_think = False
                        text = text.split("</think>", 1)[-1]
                    if in_think:
                        continue
                    if text:
                        content += text
                        await ws.send_json({"type": "text", "content": text})

                if delta.tool_calls:
                    for tc in delta.tool_calls:
                        idx = tc.index
                        if idx not in tool_calls:
                            tool_calls[idx] = {"id": "", "name": "", "arguments": ""}
                        if tc.id:
                            tool_calls[idx]["id"] = tc.id
                        if tc.function:
                            if tc.function.name:
                                tool_calls[idx]["name"] = tc.function.name
                            if tc.function.arguments:
                                tool_calls[idx]["arguments"] += tc.function.arguments
        except Exception as e:
            await ws.send_json({"type": "error", "content": f"Stream error: {e}"})
            return

        await ws.send_json({"type": "text_done"})

        # Build assistant message
        msg: dict = {"role": "assistant"}
        if content:
            msg["content"] = content
        tc_list = list(tool_calls.values())
        if tc_list:
            msg["tool_calls"] = [
                {"id": tc["id"] or f"call_{i}", "type": "function",
                 "function": {"name": tc["name"], "arguments": tc["arguments"]}}
                for i, tc in enumerate(tc_list)
            ]
        messages.append(msg)

        if not tc_list:
            await ws.send_json({"type": "turn_done"})
            return

        # Execute tools
        await ws.send_json({"type": "status", "message": "Executing tools..."})
        for i, tc in enumerate(tc_list):
            tc_id = tc["id"] or f"call_{i}"
            name = tc["name"]
            try:
                args = json.loads(tc["arguments"])
            except json.JSONDecodeError:
                args = {}

            # Send tool_call event with status
            label = name.replace("_", " ")
            await ws.send_json({"type": "status", "message": f"Running {label}..."})
            await ws.send_json({"type": "tool_call", "name": name, "args": args})

            # Execute
            result = await loop.run_in_executor(None, _exec_tool, name, args)

            # Send tool_result event
            await ws.send_json({"type": "tool_result", "name": name, "result": result})

            messages.append({"role": "tool", "tool_call_id": tc_id, "content": result})

        # Loop back for next LLM call with tool results
