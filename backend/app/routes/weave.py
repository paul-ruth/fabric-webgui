"""Weave chat — Claude Code-like AI assistant with persistent sessions.

Sessions stored in /fabric_storage/.weave/chats/ as JSON.
Skills in .weave/skills/, agents in .weave/agents/.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import shutil
import subprocess
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.routes.config import _get_ai_api_key

logger = logging.getLogger(__name__)
router = APIRouter()

API_BASE = "https://ai.fabric-testbed.net/v1"
DEFAULT_MODEL = "qwen3-coder-30b"
DEFAULT_CWD = "/fabric_storage" if os.path.isdir("/fabric_storage") else os.path.expanduser("~")
MAX_OUTPUT = 12_000
CMD_TIMEOUT = 30

# Models cache
_models_cache: list[dict] | None = None
_models_cache_time: float = 0
_MODELS_CACHE_TTL = 300

# ── Paths ────────────────────────────────────────────────────────────────────

WEAVE_DIR = Path(DEFAULT_CWD) / ".weave"
SKILLS_DIR = WEAVE_DIR / "skills"
AGENTS_DIR = WEAVE_DIR / "agents"
CHATS_DIR = WEAVE_DIR / "chats"

_DEFAULTS_DIR = Path(__file__).parent.parent / "weave_defaults"

_WEAVE_MD_PATHS = [
    Path("/app/WEAVE.md"),
    Path(__file__).parent.parent.parent / "WEAVE.md",
    Path(__file__).parent.parent.parent.parent / "WEAVE.md",
]

# ── System prompt ────────────────────────────────────────────────────────────

_FALLBACK_PROMPT = (
    "You are Weave, a FABRIC testbed AI coding assistant. "
    "You help users write code, manage files, run commands, and work with FABRIC."
)


def _load_weave_md() -> str:
    for p in _WEAVE_MD_PATHS:
        if p.is_file():
            return p.read_text()
    return _FALLBACK_PROMPT


def _build_system_prompt(cwd: str = DEFAULT_CWD) -> str:
    base = _load_weave_md()
    skills = _load_skills()
    agents = _load_agents()

    parts = [base, "", f"Working directory: {cwd}", ""]

    if skills:
        parts.append("## Currently Available Skills")
        parts.append("")
        for name, info in sorted(skills.items()):
            parts.append(f"- `/{name}` — {info['description']}")
        parts.append("")

    if agents:
        parts.append("## Currently Available Agents")
        parts.append("")
        for name, info in sorted(agents.items()):
            parts.append(f"- `@{name}` — {info['description']}")
        parts.append("")

    return "\n".join(parts)


# ── Skills & Agents ──────────────────────────────────────────────────────────

def _seed_defaults() -> None:
    for subdir in ("skills", "agents"):
        src = _DEFAULTS_DIR / subdir
        dst = WEAVE_DIR / subdir
        if not src.is_dir():
            continue
        dst.mkdir(parents=True, exist_ok=True)
        for f in src.glob("*.md"):
            target = dst / f.name
            if not target.exists():
                shutil.copy2(f, target)


def _parse_skill_file(path: Path) -> dict | None:
    try:
        text = path.read_text()
    except Exception:
        return None
    if "---" not in text:
        return None
    header, _, prompt = text.partition("---")
    info: dict[str, str] = {}
    for line in header.strip().splitlines():
        if ":" in line:
            key, _, val = line.partition(":")
            info[key.strip().lower()] = val.strip()
    return {
        "name": info.get("name", path.stem),
        "description": info.get("description", ""),
        "prompt": prompt.strip(),
    }


def _load_skills() -> dict[str, dict]:
    _seed_defaults()
    skills: dict[str, dict] = {}
    if SKILLS_DIR.is_dir():
        for f in SKILLS_DIR.glob("*.md"):
            info = _parse_skill_file(f)
            if info:
                skills[info["name"]] = info
    return skills


def _load_agents() -> dict[str, dict]:
    _seed_defaults()
    agents: dict[str, dict] = {}
    if AGENTS_DIR.is_dir():
        for f in AGENTS_DIR.glob("*.md"):
            info = _parse_skill_file(f)
            if info:
                agents[info["name"]] = info
    return agents


# ── Chat session persistence ─────────────────────────────────────────────────

def _save_session(session: dict) -> None:
    CHATS_DIR.mkdir(parents=True, exist_ok=True)
    session["updated_at"] = datetime.now(timezone.utc).isoformat()
    path = CHATS_DIR / f"{session['id']}.json"
    path.write_text(json.dumps(session, default=str))


def _load_session(session_id: str) -> dict | None:
    path = CHATS_DIR / f"{session_id}.json"
    if path.is_file():
        try:
            return json.loads(path.read_text())
        except Exception:
            return None
    return None


def _list_sessions() -> list[dict]:
    CHATS_DIR.mkdir(parents=True, exist_ok=True)
    sessions = []
    for f in CHATS_DIR.glob("*.json"):
        try:
            data = json.loads(f.read_text())
            sessions.append({
                "id": data["id"],
                "title": data.get("title", "Untitled"),
                "folder": data.get("folder", ""),
                "model": data.get("model", DEFAULT_MODEL),
                "created_at": data.get("created_at", ""),
                "updated_at": data.get("updated_at", ""),
            })
        except Exception:
            continue
    return sorted(sessions, key=lambda x: x.get("updated_at", ""), reverse=True)


def _delete_session(session_id: str) -> bool:
    path = CHATS_DIR / f"{session_id}.json"
    if path.is_file():
        path.unlink()
        return True
    return False


def _create_session(folder: str, model: str = DEFAULT_MODEL) -> dict:
    now = datetime.now(timezone.utc).isoformat()
    return {
        "id": str(uuid.uuid4()),
        "title": "New Chat",
        "folder": folder,
        "model": model,
        "created_at": now,
        "updated_at": now,
        "messages": [],  # OpenAI message format (excludes system prompt)
    }


def _tool_summary_py(name: str, args: dict) -> str:
    """Python-side tool summary for session restoration."""
    if name == "read_file": return str(args.get("path", ""))
    if name == "write_file": return str(args.get("path", ""))
    if name == "edit_file": return str(args.get("path", ""))
    if name == "list_directory": return str(args.get("path", "."))
    if name == "search_files": return f"{args.get('pattern', '')} in {args.get('path', '.')}"
    if name == "glob_files": return str(args.get("pattern", ""))
    if name == "run_command": return str(args.get("command", ""))
    return ""


def _messages_to_items(messages: list[dict]) -> list[dict]:
    """Convert stored OpenAI messages to frontend ChatItem format."""
    items: list[dict] = []
    turn_id = 0
    tool_call_map: dict[str, int] = {}

    for msg in messages:
        role = msg.get("role")
        if role == "system":
            continue

        if role == "user":
            turn_id += 1
            text = msg.get("content", "")
            # Strip skill/agent injected prompts — show original user text
            if text.startswith("[Skill:") or text.startswith("[Agent:"):
                idx = text.find("User request:")
                if idx != -1:
                    text = text[idx + 13:].strip()
            items.append({"kind": "user", "text": text, "turnId": turn_id})

        elif role == "assistant":
            content = msg.get("content")
            if content:
                items.append({"kind": "assistant", "text": content, "turnId": turn_id})
            for tc in msg.get("tool_calls", []):
                fn = tc.get("function", {})
                name = fn.get("name", "")
                try:
                    args = json.loads(fn.get("arguments", "{}"))
                except (json.JSONDecodeError, TypeError):
                    args = {}
                items.append({
                    "kind": "tool",
                    "name": name,
                    "args": args,
                    "summary": _tool_summary_py(name, args),
                    "expanded": False,
                    "turnId": turn_id,
                })
                tc_id = tc.get("id", "")
                if tc_id:
                    tool_call_map[tc_id] = len(items) - 1

        elif role == "tool":
            tc_id = msg.get("tool_call_id", "")
            if tc_id in tool_call_map:
                items[tool_call_map[tc_id]]["result"] = msg.get("content", "")

    return items


# ── Tool schemas ─────────────────────────────────────────────────────────────

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
            "timeout": {"type": "integer", "description": "Timeout in seconds (default 30, max 120)"},
        }, "required": ["command"]},
    }},
]

# ── Tool handlers (per-session CWD) ─────────────────────────────────────────


def _resolve(path: str, cwd: str) -> Path:
    p = Path(path)
    if not p.is_absolute():
        p = Path(cwd) / p
    return p.resolve()


def _tool_read_file(path: str, offset: int = 1, limit: int = 0, *, cwd: str) -> str:
    p = _resolve(path, cwd)
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


def _tool_write_file(path: str, content: str, *, cwd: str) -> str:
    p = _resolve(path, cwd)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content)
    n = content.count("\n") + (1 if content and not content.endswith("\n") else 0)
    return f"Wrote {n} lines to {path}"


def _tool_edit_file(path: str, old_string: str, new_string: str, *, cwd: str) -> str:
    p = _resolve(path, cwd)
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


def _tool_list_directory(path: str = ".", *, cwd: str) -> str:
    p = _resolve(path, cwd)
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


def _tool_search_files(pattern: str, path: str = ".", include: str = "", *, cwd: str) -> str:
    cmd = ["grep", "-rn", "--color=never", "-E", pattern]
    if include:
        cmd.extend(["--include", include])
    cmd.append(str(_resolve(path, cwd)))
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
    out = r.stdout.strip()
    if not out:
        return "No matches found."
    return out[:MAX_OUTPUT] if len(out) <= MAX_OUTPUT else out[:MAX_OUTPUT].rsplit("\n", 1)[0] + "\n... (truncated)"


def _tool_glob_files(pattern: str, *, cwd: str) -> str:
    import glob
    base = cwd if not Path(pattern).is_absolute() else "/"
    matches = sorted(glob.glob(os.path.join(base, pattern), recursive=True))
    if not matches:
        return "No files matched."
    result = "\n".join(matches[:200])
    if len(matches) > 200:
        result += f"\n... ({len(matches)} total)"
    return result


def _tool_run_command(command: str, timeout: int = CMD_TIMEOUT, *, cwd: str) -> str:
    timeout = min(max(timeout, 5), 120)
    r = subprocess.run(command, shell=True, capture_output=True, text=True, timeout=timeout, cwd=cwd)
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


def _exec_tool(name: str, args: dict, cwd: str) -> str:
    handlers: dict[str, Any] = {
        "read_file": lambda a: _tool_read_file(a["path"], a.get("offset", 1), a.get("limit", 0), cwd=cwd),
        "write_file": lambda a: _tool_write_file(a["path"], a["content"], cwd=cwd),
        "edit_file": lambda a: _tool_edit_file(a["path"], a["old_string"], a["new_string"], cwd=cwd),
        "list_directory": lambda a: _tool_list_directory(a.get("path", "."), cwd=cwd),
        "search_files": lambda a: _tool_search_files(a["pattern"], a.get("path", "."), a.get("include", ""), cwd=cwd),
        "glob_files": lambda a: _tool_glob_files(a["pattern"], cwd=cwd),
        "run_command": lambda a: _tool_run_command(a["command"], a.get("timeout", CMD_TIMEOUT), cwd=cwd),
    }
    h = handlers.get(name)
    if not h:
        return f"Unknown tool: {name}"
    try:
        return h(args)
    except Exception as e:
        return f"Error in {name}: {e}"


# ── Slash command handling ───────────────────────────────────────────────────

_BUILTIN_COMMANDS = {"clear", "compact", "help", "skills", "agents"}


def _handle_slash_command(text: str) -> tuple[str | None, str]:
    if not text.startswith("/"):
        if text.startswith("@"):
            parts = text.split(None, 1)
            agent_name = parts[0][1:]
            user_args = parts[1] if len(parts) > 1 else ""
            agents = _load_agents()
            if agent_name in agents:
                agent = agents[agent_name]
                return "agent", (
                    f"[Agent: {agent['name']}]\n\n"
                    f"{agent['prompt']}\n\n"
                    f"User request: {user_args}"
                )
        return None, text

    parts = text.split(None, 1)
    cmd = parts[0][1:].lower()
    user_args = parts[1] if len(parts) > 1 else ""

    if cmd == "clear":
        return "clear", ""

    if cmd == "help":
        skills = _load_skills()
        agents = _load_agents()
        return "help_response", _format_help(skills, agents)

    if cmd == "skills":
        skills = _load_skills()
        listing = "\n".join(f"- `/{n}` — {s['description']}" for n, s in sorted(skills.items()))
        return "help_response", f"**Available Skills:**\n\n{listing}\n\nInvoke with `/<skill-name> <request>`"

    if cmd == "agents":
        agents = _load_agents()
        listing = "\n".join(f"- `@{n}` — {a['description']}" for n, a in sorted(agents.items()))
        return "help_response", f"**Available Agents:**\n\n{listing}\n\nActivate with `@<agent-name> <request>`"

    skills = _load_skills()
    if cmd in skills:
        skill = skills[cmd]
        return "skill", (
            f"[Skill: /{skill['name']}]\n\n"
            f"{skill['prompt']}\n\n"
            f"User request: {user_args}"
        )

    return None, text


def _format_help(skills: dict, agents: dict) -> str:
    lines = ["**Weave Commands & Skills**", ""]
    lines.append("**Built-in Commands:**")
    lines.append("- `/clear` — Clear the conversation context")
    lines.append("- `/compact` — Summarize conversation to save context")
    lines.append("- `/help` — Show this help message")
    lines.append("- `/skills` — List available skills")
    lines.append("- `/agents` — List available agents")
    lines.append("")
    if skills:
        lines.append("**Skills:**")
        for name, info in sorted(skills.items()):
            if name not in _BUILTIN_COMMANDS:
                lines.append(f"- `/{name}` — {info['description']}")
        lines.append("")
    if agents:
        lines.append("**Agents:**")
        for name, info in sorted(agents.items()):
            lines.append(f"- `@{name}` — {info['description']}")
        lines.append("")
    lines.append("Skills: `/fabric_storage/.weave/skills/` | Agents: `.weave/agents/`")
    return "\n".join(lines)


# ── REST endpoints ───────────────────────────────────────────────────────────

@router.get("/api/weave/skills")
def api_list_skills():
    skills = _load_skills()
    return [{"name": n, "description": s["description"]} for n, s in sorted(skills.items())]


@router.get("/api/weave/agents")
def api_list_agents():
    agents = _load_agents()
    return [{"name": n, "description": a["description"]} for n, a in sorted(agents.items())]


@router.get("/api/weave/models")
async def api_list_models():
    global _models_cache, _models_cache_time
    now = time.time()
    if _models_cache is not None and (now - _models_cache_time) < _MODELS_CACHE_TTL:
        return {"models": _models_cache, "default": DEFAULT_MODEL}

    api_key = _get_ai_api_key()
    if not api_key:
        return {"models": [{"id": DEFAULT_MODEL, "name": DEFAULT_MODEL}], "default": DEFAULT_MODEL}

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                f"{API_BASE}/models",
                headers={"Authorization": f"Bearer {api_key}"},
            )
            resp.raise_for_status()
            data = resp.json()
            models = [{"id": m["id"], "name": m["id"]} for m in data.get("data", [])]
            if models:
                _models_cache = models
                _models_cache_time = now
            else:
                models = [{"id": DEFAULT_MODEL, "name": DEFAULT_MODEL}]
            return {"models": models, "default": DEFAULT_MODEL}
    except Exception as e:
        logger.warning("Failed to fetch models: %s", e)
        return {"models": [{"id": DEFAULT_MODEL, "name": DEFAULT_MODEL}], "default": DEFAULT_MODEL}


@router.get("/api/weave/chats")
def api_list_chats():
    return _list_sessions()


@router.delete("/api/weave/chats/{session_id}")
def api_delete_chat(session_id: str):
    if _delete_session(session_id):
        return {"status": "deleted"}
    return {"status": "not_found"}


@router.patch("/api/weave/chats/{session_id}")
def api_rename_chat(session_id: str, body: dict):
    session = _load_session(session_id)
    if not session:
        return {"status": "not_found"}
    session["title"] = body.get("title", session.get("title", ""))
    _save_session(session)
    return {"status": "ok"}


@router.get("/api/weave/folders")
def api_list_folders():
    base = Path(DEFAULT_CWD)
    folders = [str(base)]
    if base.is_dir():
        for p in sorted(base.iterdir()):
            if p.is_dir() and not p.name.startswith("."):
                folders.append(str(p))
    return {"folders": folders, "default": DEFAULT_CWD}


# ── WebSocket endpoint ───────────────────────────────────────────────────────

@router.websocket("/ws/weave")
async def weave_ws(websocket: WebSocket):
    await websocket.accept()

    api_key = _get_ai_api_key()
    if not api_key:
        await websocket.send_json({"type": "error", "content": "AI API key not configured."})
        await websocket.close()
        return

    from openai import OpenAI
    client = OpenAI(api_key=api_key, base_url=API_BASE)

    # Session state
    session: dict | None = None
    messages: list[dict] = []
    current_model = DEFAULT_MODEL
    current_cwd = DEFAULT_CWD

    def _init_session(sess: dict) -> None:
        nonlocal session, messages, current_model, current_cwd
        session = sess
        current_cwd = sess.get("folder", DEFAULT_CWD)
        current_model = sess.get("model", DEFAULT_MODEL)
        system_prompt = _build_system_prompt(current_cwd)
        messages.clear()
        messages.append({"role": "system", "content": system_prompt})
        # Restore stored messages
        for m in sess.get("messages", []):
            messages.append(m)

    def _save_current() -> None:
        if session is not None:
            # Store messages (excluding system prompt)
            session["messages"] = [m for m in messages if m.get("role") != "system"]
            session["model"] = current_model
            _save_session(session)

    try:
        await websocket.send_json({"type": "ready"})

        while True:
            raw = await websocket.receive_text()
            data = json.loads(raw)
            msg_type = data.get("type")

            if msg_type == "new_session":
                _save_current()
                folder = data.get("folder", DEFAULT_CWD)
                model = data.get("model", DEFAULT_MODEL)
                sess = _create_session(folder, model)
                _init_session(sess)
                _save_session(sess)
                await websocket.send_json({
                    "type": "session_loaded",
                    "session_id": sess["id"],
                    "items": [],
                    "folder": folder,
                    "model": model,
                    "title": sess["title"],
                })

            elif msg_type == "load_session":
                _save_current()
                sid = data.get("session_id", "")
                sess = _load_session(sid)
                if sess:
                    _init_session(sess)
                    items = _messages_to_items(sess.get("messages", []))
                    await websocket.send_json({
                        "type": "session_loaded",
                        "session_id": sess["id"],
                        "items": items,
                        "folder": sess.get("folder", DEFAULT_CWD),
                        "model": sess.get("model", DEFAULT_MODEL),
                        "title": sess.get("title", ""),
                    })
                else:
                    await websocket.send_json({"type": "error", "content": f"Session {sid} not found."})

            elif msg_type == "message":
                user_text = data.get("content", "").strip()
                if not user_text:
                    continue

                if data.get("model"):
                    current_model = data["model"]

                # Auto-create session if none active
                if session is None:
                    sess = _create_session(current_cwd, current_model)
                    _init_session(sess)

                # Auto-title from first user message
                if session and session.get("title") == "New Chat":
                    title = user_text[:60]
                    if len(user_text) > 60:
                        title += "..."
                    session["title"] = title
                    await websocket.send_json({"type": "session_updated", "title": title, "session_id": session["id"]})

                action, processed = _handle_slash_command(user_text)

                if action == "clear":
                    system_prompt = _build_system_prompt(current_cwd)
                    messages.clear()
                    messages.append({"role": "system", "content": system_prompt})
                    if session:
                        session["messages"] = []
                        _save_session(session)
                    await websocket.send_json({"type": "cleared"})
                    continue

                if action == "help_response":
                    await websocket.send_json({"type": "assistant_start"})
                    await websocket.send_json({"type": "text", "content": processed})
                    await websocket.send_json({"type": "text_done"})
                    await websocket.send_json({"type": "turn_done"})
                    continue

                messages.append({"role": "user", "content": processed})
                await _agent_turn(websocket, client, messages, current_model, current_cwd)
                _save_current()

            elif msg_type == "clear":
                system_prompt = _build_system_prompt(current_cwd)
                messages.clear()
                messages.append({"role": "system", "content": system_prompt})
                if session:
                    session["messages"] = []
                    _save_session(session)
                await websocket.send_json({"type": "cleared"})

            elif msg_type == "delete_session":
                sid = data.get("session_id", "")
                _delete_session(sid)
                if session and session["id"] == sid:
                    session = None
                    messages.clear()
                await websocket.send_json({"type": "session_deleted", "session_id": sid})

    except WebSocketDisconnect:
        _save_current()
    except Exception as e:
        logger.exception("weave ws error")
        _save_current()
        try:
            await websocket.send_json({"type": "error", "content": str(e)})
        except Exception:
            pass


async def _agent_turn(ws: WebSocket, client: Any, messages: list[dict],
                      model: str = DEFAULT_MODEL, cwd: str = DEFAULT_CWD) -> None:
    loop = asyncio.get_event_loop()
    iteration = 0

    while True:
        if iteration == 0:
            await ws.send_json({"type": "status", "message": "Thinking..."})
        else:
            await ws.send_json({"type": "status", "message": "Analyzing results..."})
        iteration += 1

        await ws.send_json({"type": "assistant_start"})

        try:
            response = await loop.run_in_executor(
                None, lambda: client.chat.completions.create(
                    model=model, messages=messages, tools=TOOLS, stream=True,
                )
            )
        except Exception as e:
            await ws.send_json({"type": "error", "content": f"API error: {e}"})
            return

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

        await ws.send_json({"type": "status", "message": "Executing tools..."})
        for i, tc in enumerate(tc_list):
            tc_id = tc["id"] or f"call_{i}"
            name = tc["name"]
            try:
                args = json.loads(tc["arguments"])
            except json.JSONDecodeError:
                args = {}

            label = name.replace("_", " ")
            await ws.send_json({"type": "status", "message": f"Running {label}..."})
            await ws.send_json({"type": "tool_call", "name": name, "args": args})

            result = await loop.run_in_executor(None, _exec_tool, name, args, cwd)

            await ws.send_json({"type": "tool_result", "name": name, "result": result})
            messages.append({"role": "tool", "tool_call_id": tc_id, "content": result})
