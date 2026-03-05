#!/usr/bin/env python3
"""Weave — FABRIC AI Coding Assistant

A Claude Code-like terminal AI assistant powered by FABRIC's self-hosted LLM.
Read and edit files, run commands, search code, and manage experiments.
"""
from __future__ import annotations

import json
import os
import re
import readline
import subprocess
import sys
import textwrap
import time
from pathlib import Path

from openai import OpenAI

# ─── Configuration ────────────────────────────────────────────────────────────

API_BASE = (
    os.environ.get("OPENAI_BASE_URL")
    or os.environ.get("OPENAI_API_BASE", "https://ai.fabric-testbed.net/v1")
)
MODEL = os.environ.get("WEAVE_MODEL", "qwen3-coder-30b")
MAX_OUTPUT = 12_000
CMD_TIMEOUT = 30

# Tool calling mode (same as WebSocket version):
#   "native"  = OpenAI function-calling API (requires vLLM --enable-auto-tool-choice)
#   "prompt"  = tools embedded in system prompt, model outputs <tool_call> XML
#   "auto"    = native for models in NATIVE_TOOL_MODELS, prompt for everything else
TOOL_MODE = os.environ.get("WEAVE_TOOL_MODE", "auto")
NATIVE_TOOL_MODELS: set[str] = set(
    m.strip() for m in os.environ.get("WEAVE_NATIVE_TOOL_MODELS", "").split(",") if m.strip()
)

_TOOL_CALL_RE = re.compile(r'<tool_call>\s*(.*?)\s*</tool_call>', re.DOTALL)


def _use_native_tools(model: str) -> bool:
    if TOOL_MODE == "native":
        return True
    if TOOL_MODE == "prompt":
        return False
    return model in NATIVE_TOOL_MODELS


def _extract_tool_calls(text: str) -> list[dict]:
    """Extract tool calls from assistant text (prompt-based mode)."""
    calls = []
    for m in _TOOL_CALL_RE.finditer(text):
        try:
            data = json.loads(m.group(1))
            if "name" in data:
                calls.append(data)
        except json.JSONDecodeError:
            continue
    return calls


def _detect_api_key() -> str:
    """Get API key from env or auto-detect from fabric_rc."""
    key = os.environ.get("OPENAI_API_KEY", "")
    if key:
        return key
    # Try to read from fabric_rc (same logic as the backend)
    config_dir = os.environ.get("FABRIC_CONFIG_DIR", "/fabric_config")
    for rc_path in [
        os.path.join(config_dir, "fabric_rc"),
        os.path.join(config_dir, ".fabric_config", "fabric_rc"),
    ]:
        try:
            with open(rc_path) as f:
                for line in f:
                    line = line.strip()
                    if line.startswith("export FABRIC_AI_API_KEY="):
                        return line.split("=", 1)[1]
        except OSError:
            continue
    # Also try /fabric_storage/.fabric_config/fabric_rc
    try:
        with open("/fabric_storage/.fabric_config/fabric_rc") as f:
            for line in f:
                line = line.strip()
                if line.startswith("export FABRIC_AI_API_KEY="):
                    return line.split("=", 1)[1]
    except OSError:
        pass
    return ""


API_KEY = _detect_api_key()


def _fetch_models() -> list[str]:
    """Fetch available model IDs from the AI server."""
    try:
        import urllib.request
        req = urllib.request.Request(
            f"{API_BASE}/models",
            headers={"Authorization": f"Bearer {API_KEY}"},
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read())
            return sorted(m["id"] for m in data.get("data", []))
    except Exception:
        return []

# ─── ANSI Colors (FABRIC brand) ──────────────────────────────────────────────

RST = "\033[0m"
BOLD = "\033[1m"
DIM = "\033[2m"

F_PRIMARY = "\033[38;2;87;152;188m"    # #5798bc
F_DARK    = "\033[38;2;31;106;140m"    # #1f6a8c
F_TEAL    = "\033[38;2;0;142;122m"     # #008e7a
F_ORANGE  = "\033[38;2;255;133;66m"    # #ff8542
F_CORAL   = "\033[38;2;226;82;65m"     # #e25241

C_GREEN  = "\033[38;2;76;175;106m"
C_YELLOW = "\033[38;2;255;202;40m"
C_GRAY   = "\033[90m"
C_RED    = "\033[91m"

# ─── System Prompt ────────────────────────────────────────────────────────────

_FALLBACK_PROMPT = (
    "You are Weave, a FABRIC testbed AI coding assistant. "
    "You help users write code, manage files, run commands, and work with FABRIC."
)

_WEAVE_MD_PATHS = [
    Path("/app/WEAVE.md"),
    Path(__file__).parent.parent / "WEAVE.md",
    Path(__file__).parent.parent.parent / "WEAVE.md",
]

# Skills/agents directories (mirrors the WebSocket version)
_WEAVE_DIR: Path | None = None
_DEFAULTS_DIR = Path(__file__).parent.parent / "app" / "weave_defaults"


def _get_weave_dir() -> Path:
    global _WEAVE_DIR
    if _WEAVE_DIR is None:
        base = Path(os.environ.get("FABRIC_STORAGE_DIR", "/fabric_storage"))
        if not base.is_dir():
            base = Path.cwd()
        _WEAVE_DIR = base / ".weave"
    return _WEAVE_DIR


def _seed_defaults() -> None:
    weave_dir = _get_weave_dir()
    for subdir in ("skills", "agents"):
        src = _DEFAULTS_DIR / subdir
        dst = weave_dir / subdir
        if not src.is_dir():
            continue
        dst.mkdir(parents=True, exist_ok=True)
        import shutil
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
    skills_dir = _get_weave_dir() / "skills"
    skills: dict[str, dict] = {}
    if skills_dir.is_dir():
        for f in skills_dir.glob("*.md"):
            info = _parse_skill_file(f)
            if info:
                skills[info["name"]] = info
    return skills


def _load_agents() -> dict[str, dict]:
    _seed_defaults()
    agents_dir = _get_weave_dir() / "agents"
    agents: dict[str, dict] = {}
    if agents_dir.is_dir():
        for f in agents_dir.glob("*.md"):
            info = _parse_skill_file(f)
            if info:
                agents[info["name"]] = info
    return agents


def _load_weave_md() -> str:
    for p in _WEAVE_MD_PATHS:
        if p.is_file():
            return p.read_text()
    return _FALLBACK_PROMPT


def _build_tools_prompt() -> str:
    """Build compact tool reference for prompt-based tool calling."""
    lines = [
        "## Tool Calling",
        "",
        "To use a tool, output exactly this format (including the XML tags):",
        "",
        "<tool_call>",
        '{"name": "tool_name", "arguments": {"param": "value"}}',
        "</tool_call>",
        "",
        "Rules:",
        "- Call ONE tool at a time and wait for the <tool_result> before calling another",
        "- Always use valid JSON inside the tool_call tags",
        "- The arguments field must be an object (not positional args)",
        "- Do NOT wrap tool calls in markdown code blocks",
        "",
        "### Tool Reference",
        "",
    ]
    for tool in TOOLS:
        fn = tool["function"]
        name = fn["name"]
        desc = fn["description"]
        if len(desc) > 100:
            desc = desc[:97] + "..."
        props = fn.get("parameters", {}).get("properties", {})
        required = set(fn.get("parameters", {}).get("required", []))
        params = []
        for k in props:
            suffix = "" if k in required else "?"
            params.append(f"{k}{suffix}")
        sig = ", ".join(params) if params else ""
        lines.append(f"- `{name}({sig})` — {desc}")
    return "\n".join(lines)


def _build_system_prompt(cwd: str, model: str = MODEL) -> str:
    base = _load_weave_md()
    skills = _load_skills()
    agents = _load_agents()

    parts = [base, ""]

    # Add tool-calling instructions when NOT using native mode
    if not _use_native_tools(model):
        parts.append(_build_tools_prompt())
        parts.append("")

    parts.append(f"Working directory: {cwd}")
    parts.append("")

    if _fablib_tools_available:
        parts.append("## FABRIC Authentication")
        parts.append("")
        parts.append("The user's FABRIC token is at `/fabric_storage/.fabric_config/id_token.json`.")
        parts.append("Config is at `/fabric_storage/.fabric_config/fabric_rc`.")
        parts.append("FABlib is pre-configured — all FABlib tools use the user's credentials automatically.")
        parts.append("If tools return token errors, direct the user to refresh via the Configure view.")
        parts.append("")

    if skills:
        parts.append("## Currently Available Skills")
        parts.append("")
        for name, info in sorted(skills.items()):
            parts.append(f"- `/{name}` -- {info['description']}")
        parts.append("")

    if agents:
        parts.append("## Currently Available Agents")
        parts.append("")
        for name, info in sorted(agents.items()):
            parts.append(f"- `@{name}` -- {info['description']}")
        parts.append("")

    return "\n".join(parts)

# ─── Tool Definitions (OpenAI function calling format) ────────────────────────

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "read_file",
            "description": "Read the contents of a file with line numbers.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "File path relative to working directory",
                    },
                    "offset": {
                        "type": "integer",
                        "description": "Starting line (1-based). Default: 1",
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Max lines to read. Default: all",
                    },
                },
                "required": ["path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "write_file",
            "description": "Create or overwrite a file with the given content.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "File path relative to working directory",
                    },
                    "content": {
                        "type": "string",
                        "description": "Complete file content to write",
                    },
                },
                "required": ["path", "content"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "edit_file",
            "description": (
                "Edit a file by replacing an exact string with new text. "
                "old_string must match exactly including whitespace."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "File path relative to working directory",
                    },
                    "old_string": {
                        "type": "string",
                        "description": "Exact text to find",
                    },
                    "new_string": {
                        "type": "string",
                        "description": "Replacement text",
                    },
                },
                "required": ["path", "old_string", "new_string"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_directory",
            "description": "List files and directories at a path.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Directory path. Default: .",
                    },
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_files",
            "description": "Grep for a regex pattern in files. Returns matching lines.",
            "parameters": {
                "type": "object",
                "properties": {
                    "pattern": {
                        "type": "string",
                        "description": "Regex pattern",
                    },
                    "path": {
                        "type": "string",
                        "description": "Directory to search. Default: .",
                    },
                    "include": {
                        "type": "string",
                        "description": "Glob filter (e.g. '*.py')",
                    },
                },
                "required": ["pattern"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "glob_files",
            "description": "Find files matching a glob pattern.",
            "parameters": {
                "type": "object",
                "properties": {
                    "pattern": {
                        "type": "string",
                        "description": "Glob pattern (e.g. '**/*.py')",
                    },
                },
                "required": ["pattern"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "run_command",
            "description": "Execute a shell command and return output.",
            "parameters": {
                "type": "object",
                "properties": {
                    "command": {
                        "type": "string",
                        "description": "Shell command to execute",
                    },
                },
                "required": ["command"],
            },
        },
    },
]

# ─── FABlib Tools (optional — available when running in the container) ────────

_fablib_tools_available = False
try:
    import sys
    # Ensure /app is on path so we can import the app package
    if "/app" not in sys.path:
        sys.path.insert(0, "/app")
    from app.weave_fablib_tools import FABLIB_TOOLS, exec_fablib_tool, is_fablib_tool
    TOOLS += FABLIB_TOOLS
    _fablib_tools_available = True
except ImportError:
    def is_fablib_tool(name: str) -> bool:
        return False
    def exec_fablib_tool(name: str, args: dict) -> str:
        return "FABlib tools not available (not running in FABRIC container)."


# ─── Tool Handlers ────────────────────────────────────────────────────────────


def _resolve(path: str) -> Path:
    p = Path(path)
    if not p.is_absolute():
        p = Path.cwd() / p
    return p.resolve()


def tool_read_file(path: str, offset: int = 1, limit: int = 0) -> str:
    p = _resolve(path)
    if not p.exists():
        return f"Error: File not found: {path}"
    if not p.is_file():
        return f"Error: Not a file: {path}"
    try:
        lines = p.read_text().splitlines()
        start = max(0, offset - 1)
        end = start + limit if limit > 0 else len(lines)
        numbered = [
            f"{i + start + 1:>5} | {line}" for i, line in enumerate(lines[start:end])
        ]
        result = "\n".join(numbered)
        if len(result) > MAX_OUTPUT:
            result = result[:MAX_OUTPUT] + f"\n... (truncated, {len(lines)} total lines)"
        return result
    except Exception as e:
        return f"Error reading {path}: {e}"


def tool_write_file(path: str, content: str) -> str:
    p = _resolve(path)
    try:
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content)
        n = content.count("\n") + (1 if content and not content.endswith("\n") else 0)
        return f"Wrote {n} lines to {path}"
    except Exception as e:
        return f"Error writing {path}: {e}"


def tool_edit_file(path: str, old_string: str, new_string: str) -> str:
    p = _resolve(path)
    if not p.exists():
        return f"Error: File not found: {path}"
    try:
        content = p.read_text()
        count = content.count(old_string)
        if count == 0:
            return f"Error: old_string not found in {path}"
        if count > 1:
            return (
                f"Error: old_string found {count} times in {path}. "
                "Make it more specific."
            )
        p.write_text(content.replace(old_string, new_string, 1))
        return f"Edited {path}: replaced 1 occurrence"
    except Exception as e:
        return f"Error editing {path}: {e}"


def tool_list_directory(path: str = ".") -> str:
    p = _resolve(path)
    if not p.exists():
        return f"Error: Not found: {path}"
    if not p.is_dir():
        return f"Error: Not a directory: {path}"
    try:
        entries = sorted(p.iterdir(), key=lambda x: (not x.is_dir(), x.name.lower()))
        lines = []
        for e in entries:
            if e.name.startswith("."):
                continue
            if e.is_dir():
                lines.append(f"  {e.name}/")
            else:
                sz = e.stat().st_size
                if sz < 1024:
                    h = f"{sz}B"
                elif sz < 1024 * 1024:
                    h = f"{sz / 1024:.1f}K"
                else:
                    h = f"{sz / 1024 / 1024:.1f}M"
                lines.append(f"  {e.name}  ({h})")
        return "\n".join(lines) if lines else "(empty directory)"
    except Exception as e:
        return f"Error listing {path}: {e}"


def tool_search_files(pattern: str, path: str = ".", include: str = "") -> str:
    try:
        cmd = ["grep", "-rn", "--color=never", "-E", pattern]
        if include:
            cmd.extend(["--include", include])
        cmd.append(str(_resolve(path)))
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
        output = result.stdout.strip()
        if not output:
            return "No matches found."
        if len(output) > MAX_OUTPUT:
            return output[:MAX_OUTPUT].rsplit("\n", 1)[0] + "\n... (truncated)"
        return output
    except subprocess.TimeoutExpired:
        return "Error: Search timed out"
    except Exception as e:
        return f"Error searching: {e}"


def tool_glob_files(pattern: str) -> str:
    import glob as g

    try:
        matches = sorted(g.glob(pattern, recursive=True))
        if not matches:
            return "No files matched."
        result = "\n".join(matches[:200])
        if len(matches) > 200:
            result += f"\n... ({len(matches)} total)"
        return result
    except Exception as e:
        return f"Error: {e}"


def tool_run_command(command: str) -> str:
    try:
        result = subprocess.run(
            command,
            shell=True,
            capture_output=True,
            text=True,
            timeout=CMD_TIMEOUT,
            cwd=str(Path.cwd()),
        )
        output = ""
        if result.stdout:
            output += result.stdout
        if result.stderr:
            if output:
                output += "\n"
            output += result.stderr
        if result.returncode != 0:
            output += f"\n(exit code: {result.returncode})"
        if not output.strip():
            output = "(no output)"
        if len(output) > MAX_OUTPUT:
            output = output[:MAX_OUTPUT] + "\n... (truncated)"
        return output
    except subprocess.TimeoutExpired:
        return f"Error: Command timed out after {CMD_TIMEOUT}s"
    except Exception as e:
        return f"Error: {e}"


_HANDLERS = {
    "read_file": lambda a: tool_read_file(
        a["path"], a.get("offset", 1), a.get("limit", 0)
    ),
    "write_file": lambda a: tool_write_file(a["path"], a["content"]),
    "edit_file": lambda a: tool_edit_file(
        a["path"], a["old_string"], a["new_string"]
    ),
    "list_directory": lambda a: tool_list_directory(a.get("path", ".")),
    "search_files": lambda a: tool_search_files(
        a["pattern"], a.get("path", "."), a.get("include", "")
    ),
    "glob_files": lambda a: tool_glob_files(a["pattern"]),
    "run_command": lambda a: tool_run_command(a["command"]),
}


def execute_tool(name: str, args: dict) -> str:
    handler = _HANDLERS.get(name)
    if not handler:
        if is_fablib_tool(name):
            return exec_fablib_tool(name, args)
        return f"Error: Unknown tool: {name}"
    try:
        return handler(args)
    except Exception as e:
        return f"Error in {name}: {e}"


# ─── Agent ────────────────────────────────────────────────────────────────────


class WeaveAgent:
    def __init__(self, model: str = MODEL) -> None:
        self.model = model
        self.messages: list[dict] = [
            {
                "role": "system",
                "content": _build_system_prompt(os.getcwd(), model),
            }
        ]
        self.client = OpenAI(api_key=API_KEY, base_url=API_BASE)

    # ── Public API ──

    def chat(self, user_msg: str) -> None:
        self.messages.append({"role": "user", "content": user_msg})

        if _use_native_tools(self.model):
            self._chat_native()
        else:
            self._chat_prompt()

    def _chat_native(self) -> None:
        """Native OpenAI function-calling loop."""
        while True:
            content, tool_calls = self._stream_native()

            msg: dict = {"role": "assistant"}
            if content:
                msg["content"] = content
            if tool_calls:
                msg["tool_calls"] = [
                    {
                        "id": tc["id"] or f"call_{i}",
                        "type": "function",
                        "function": {
                            "name": tc["name"],
                            "arguments": tc["arguments"],
                        },
                    }
                    for i, tc in enumerate(tool_calls)
                ]
            self.messages.append(msg)

            if not tool_calls:
                break

            for i, tc in enumerate(tool_calls):
                tc_id = tc["id"] or f"call_{i}"
                _print_tool_call(tc["name"], tc["arguments"])
                try:
                    args = json.loads(tc["arguments"])
                except json.JSONDecodeError:
                    args = {}
                result = execute_tool(tc["name"], args)
                _print_tool_result(tc["name"], result)
                self.messages.append(
                    {"role": "tool", "tool_call_id": tc_id, "content": result}
                )

    def _chat_prompt(self) -> None:
        """Prompt-based tool calling — tools in system prompt, <tool_call> XML in output."""
        max_iters = 15
        for _ in range(max_iters):
            full_text = self._stream_prompt()
            self.messages.append({"role": "assistant", "content": full_text})

            tool_calls = _extract_tool_calls(full_text)
            if not tool_calls:
                break

            result_parts = []
            for tc in tool_calls:
                name = tc.get("name", "unknown")
                args = tc.get("arguments", {})
                _print_tool_call(name, json.dumps(args))
                result = execute_tool(name, args)
                _print_tool_result(name, result)
                result_parts.append(f'<tool_result name="{name}">\n{result}\n</tool_result>')

            self.messages.append({"role": "user", "content": "\n\n".join(result_parts)})

    def compact(self) -> None:
        if len(self.messages) <= 3:
            _info("Nothing to compact.")
            return
        sys_msg = self.messages[0]
        recent = self.messages[-6:]
        self.messages = [sys_msg] + recent
        _info(f"Compacted to {len(self.messages)} messages.")

    def clear(self) -> None:
        self.messages = [self.messages[0]]
        _info("Conversation cleared.")

    # ── Streaming ──

    def _stream_native(self) -> tuple[str, list[dict]]:
        """Stream with native OpenAI function calling."""
        try:
            stream = self.client.chat.completions.create(
                model=self.model,
                messages=self.messages,
                tools=TOOLS,
                stream=True,
            )
        except Exception as e:
            _error(f"API error: {e}")
            return "", []

        content = ""
        tool_calls: dict[int, dict] = {}
        in_think = False
        started = False

        try:
            for chunk in stream:
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
                        if not started:
                            sys.stdout.write(f"\n{F_PRIMARY}")
                            started = True
                        sys.stdout.write(text)
                        sys.stdout.flush()
                        content += text

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
            if started:
                sys.stdout.write(RST)
            _error(f"Stream error: {e}")

        if started:
            sys.stdout.write(f"{RST}\n")
            sys.stdout.flush()

        return content, list(tool_calls.values())

    def _stream_prompt(self) -> str:
        """Stream without tools param — parse <tool_call> tags from text."""
        try:
            stream = self.client.chat.completions.create(
                model=self.model,
                messages=self.messages,
                stream=True,
            )
        except Exception as e:
            _error(f"API error: {e}")
            return ""

        full_text = ""
        in_think = False
        in_tool = False
        started = False

        try:
            for chunk in stream:
                if not chunk.choices:
                    continue
                text = chunk.choices[0].delta.content or ""
                if not text:
                    continue

                full_text += text
                display = text

                if "<think>" in display:
                    in_think = True
                    display = display.split("<think>")[0]
                if "</think>" in display:
                    in_think = False
                    display = display.split("</think>", 1)[-1]
                if in_think:
                    display = ""

                if "<tool_call>" in display:
                    in_tool = True
                    display = display.split("<tool_call>")[0]
                if "</tool_call>" in display:
                    in_tool = False
                    display = display.split("</tool_call>", 1)[-1]
                if in_tool:
                    display = ""

                if display:
                    if not started:
                        sys.stdout.write(f"\n{F_PRIMARY}")
                        started = True
                    sys.stdout.write(display)
                    sys.stdout.flush()
        except Exception as e:
            if started:
                sys.stdout.write(RST)
            _error(f"Stream error: {e}")

        if started:
            sys.stdout.write(f"{RST}\n")
            sys.stdout.flush()

        return full_text


# ─── UI Helpers ───────────────────────────────────────────────────────────────


def _info(msg: str) -> None:
    print(f"  {F_TEAL}{msg}{RST}")


def _error(msg: str) -> None:
    print(f"\n  {F_CORAL}{msg}{RST}\n")


def _print_tool_call(name: str, args_json: str) -> None:
    try:
        args = json.loads(args_json)
    except Exception:
        args = {}

    if name == "read_file":
        detail = args.get("path", "?")
    elif name == "write_file":
        detail = args.get("path", "?")
    elif name == "edit_file":
        detail = args.get("path", "?")
    elif name == "run_command":
        detail = args.get("command", "?")
        if len(detail) > 60:
            detail = detail[:57] + "..."
    elif name == "search_files":
        detail = f"/{args.get('pattern', '?')}/"
        if args.get("include"):
            detail += f" in {args['include']}"
    elif name == "glob_files":
        detail = args.get("pattern", "?")
    elif name == "list_directory":
        detail = args.get("path", ".")
    else:
        detail = ""

    print(f"\n  {F_TEAL}\u25b8 {name}{RST} {C_GRAY}{detail}{RST}")


def _print_tool_result(name: str, result: str) -> None:
    lines = result.split("\n")
    if len(lines) > 8:
        preview = "\n".join(lines[:6])
        print(f"{C_GRAY}{textwrap.indent(preview, '    ')}")
        print(f"    ... ({len(lines)} lines){RST}")
    elif result.strip():
        if name in ("write_file", "edit_file"):
            print(f"    {C_GREEN}{result}{RST}")
        else:
            print(f"{C_GRAY}{textwrap.indent(result, '    ')}{RST}")


# ─── Banner & Help ────────────────────────────────────────────────────────────

def _banner(model: str) -> str:
    return f"""\

  {F_PRIMARY}{BOLD}\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584{RST}
  {F_PRIMARY}{BOLD}\u2588                                        \u2588{RST}
  {F_PRIMARY}{BOLD}\u2588{RST}  {F_PRIMARY}{BOLD}W E A V E{RST}                            {F_PRIMARY}{BOLD}\u2588{RST}
  {F_PRIMARY}{BOLD}\u2588{RST}  {C_GRAY}FABRIC AI Coding Assistant{RST}            {F_PRIMARY}{BOLD}\u2588{RST}
  {F_PRIMARY}{BOLD}\u2588{RST}                                        {F_PRIMARY}{BOLD}\u2588{RST}
  {F_PRIMARY}{BOLD}\u2588{RST}  {C_GRAY}Model   {F_TEAL}{model}{RST}
  {F_PRIMARY}{BOLD}\u2588{RST}  {C_GRAY}Server  {F_TEAL}{API_BASE}{RST}
  {F_PRIMARY}{BOLD}\u2588{RST}                                        {F_PRIMARY}{BOLD}\u2588{RST}
  {F_PRIMARY}{BOLD}\u2588{RST}  {C_GRAY}/help for commands \u2022 Ctrl+D to exit{RST}    {F_PRIMARY}{BOLD}\u2588{RST}
  {F_PRIMARY}{BOLD}\u2588{RST}                                        {F_PRIMARY}{BOLD}\u2588{RST}
  {F_PRIMARY}{BOLD}\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580{RST}
"""


def _print_help() -> None:
    print(f"""
  {F_PRIMARY}{BOLD}Weave Commands{RST}
  {C_GRAY}\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500{RST}
  {F_TEAL}/help{RST}           Show this help
  {F_TEAL}/clear{RST}          Clear conversation
  {F_TEAL}/compact{RST}        Trim conversation history
  {F_TEAL}/model{RST}          Show current model
  {F_TEAL}/model <name>{RST}   Switch to a different model
  {F_TEAL}/models{RST}         List available models from the AI server
  {F_TEAL}/msgs{RST}           Show message count
  {F_TEAL}/skills{RST}         List available skills
  {F_TEAL}/agents{RST}         List available agents
  {F_TEAL}/quit{RST}           Exit Weave

  {C_GRAY}Use /<skill> <args> to invoke a skill{RST}
  {C_GRAY}Use @<agent> <args> to activate an agent{RST}
""")


# ─── Slash Commands ───────────────────────────────────────────────────────────


def _handle_command(cmd: str, agent: WeaveAgent) -> bool:
    """Handle a slash command. Returns False to exit."""
    parts = cmd.strip().split(None, 1)
    command = parts[0].lower()
    user_args = parts[1] if len(parts) > 1 else ""

    if command in ("/quit", "/exit", "/q"):
        return False
    elif command == "/help":
        _print_help()
    elif command == "/clear":
        agent.clear()
    elif command == "/compact":
        agent.compact()
    elif command == "/model":
        if user_args:
            new_model = user_args.strip()
            available = _fetch_models()
            if available and new_model not in available:
                print(f"  {F_CORAL}Model '{new_model}' not found on server.{RST}")
                print(f"  {C_GRAY}Available: {', '.join(available)}{RST}")
            else:
                agent.model = new_model
                _info(f"Switched to model: {new_model}")
        else:
            print(f"  {C_GRAY}Model:  {RST}{F_TEAL}{agent.model}{RST}")
            print(f"  {C_GRAY}Server: {RST}{F_TEAL}{API_BASE}{RST}")
    elif command == "/models":
        available = _fetch_models()
        if available:
            print(f"\n  {F_PRIMARY}{BOLD}Available Models{RST}")
            for m in available:
                marker = f" {F_TEAL}\u25c0 current{RST}" if m == agent.model else ""
                print(f"  {C_GRAY}\u2022{RST} {m}{marker}")
            print(f"\n  {C_GRAY}Use /model <name> to switch{RST}\n")
        else:
            _info(f"Could not fetch models from {API_BASE}")
    elif command == "/msgs":
        print(f"  {C_GRAY}Messages: {RST}{len(agent.messages)}")
    elif command == "/skills":
        skills = _load_skills()
        if skills:
            print(f"\n  {F_PRIMARY}{BOLD}Available Skills{RST}")
            for name, info in sorted(skills.items()):
                print(f"  {F_TEAL}/{name}{RST}  {C_GRAY}{info['description']}{RST}")
            print()
        else:
            _info("No skills found.")
    elif command == "/agents":
        agents = _load_agents()
        if agents:
            print(f"\n  {F_PRIMARY}{BOLD}Available Agents{RST}")
            for name, info in sorted(agents.items()):
                print(f"  {F_TEAL}@{name}{RST}  {C_GRAY}{info['description']}{RST}")
            print()
        else:
            _info("No agents found.")
    else:
        # Check if it's a skill
        skill_name = command[1:]  # strip leading /
        skills = _load_skills()
        if skill_name in skills:
            skill = skills[skill_name]
            _info(f"Invoking skill: {skill_name}")
            injected = (
                f"[Skill: /{skill['name']}]\n\n"
                f"{skill['prompt']}\n\n"
                f"User request: {user_args}"
            )
            agent.chat(injected)
        else:
            print(f"  {C_GRAY}Unknown command: {command}. Type /help{RST}")
    return True


# ─── Main ─────────────────────────────────────────────────────────────────────


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser(
        description="Weave — FABRIC AI Coding Assistant",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "-c", "--command",
        help="Run a single prompt and exit (non-interactive mode)",
    )
    parser.add_argument(
        "-m", "--model",
        help=f"Model to use (default: {MODEL})",
    )
    parser.add_argument(
        "--version", action="version", version="weave 0.1.0",
    )
    args = parser.parse_args()

    # Allow --model to override the default
    model = args.model or MODEL

    if not API_KEY:
        print(f"{F_CORAL}Error: No API key found.{RST}")
        print(f"{C_GRAY}Set OPENAI_API_KEY or configure the AI API key in the WebUI Settings.{RST}")
        sys.exit(1)

    agent = WeaveAgent(model=model)

    # Non-interactive: run one command and exit
    if args.command:
        agent.chat(args.command)
        return

    print(_banner(model))

    # Readline history
    histfile = os.path.join(
        os.environ.get("HOME", "/tmp"), ".weave_history"
    )
    try:
        readline.read_history_file(histfile)
    except FileNotFoundError:
        pass
    readline.set_history_length(500)

    prompt = f"{F_PRIMARY}{BOLD}weave{RST} {C_GRAY}\u203a{RST} "

    try:
        while True:
            try:
                user_input = input(prompt)
            except KeyboardInterrupt:
                print()
                continue

            text = user_input.strip()
            if not text:
                continue

            if text.startswith("/"):
                if not _handle_command(text, agent):
                    break
                continue

            # @agent invocation
            if text.startswith("@"):
                parts = text.split(None, 1)
                agent_name = parts[0][1:]
                user_args = parts[1] if len(parts) > 1 else ""
                agents = _load_agents()
                if agent_name in agents:
                    ag = agents[agent_name]
                    _info(f"Activating agent: {agent_name}")
                    injected = (
                        f"[Agent: {ag['name']}]\n\n"
                        f"{ag['prompt']}\n\n"
                        f"User request: {user_args}"
                    )
                    agent.chat(injected)
                    continue
                # Not a known agent, send as regular message

            agent.chat(text)
    except EOFError:
        pass
    finally:
        try:
            readline.write_history_file(histfile)
        except Exception:
            pass
        print(f"\n{C_GRAY}Goodbye.{RST}\n")


if __name__ == "__main__":
    main()
