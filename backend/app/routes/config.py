"""Configuration API routes for standalone FABRIC WebGUI setup."""
from __future__ import annotations

import base64
import json
import os
import stat
from typing import Optional
from urllib.parse import urlencode

import paramiko
from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

from app.fablib_manager import is_configured, reset_fablib

router = APIRouter()

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _config_dir() -> str:
    return os.environ.get("FABRIC_CONFIG_DIR", "/fabric_config")


def _ensure_config_dir() -> str:
    d = _config_dir()
    os.makedirs(d, mode=0o700, exist_ok=True)
    return d


def _token_path() -> str:
    return os.path.join(_config_dir(), "id_token.json")


def _read_token() -> Optional[dict]:
    path = _token_path()
    if not os.path.isfile(path):
        return None
    with open(path) as f:
        return json.load(f)


def _decode_jwt_payload(token: str) -> dict:
    """Decode JWT payload without verification (token is trusted from CM)."""
    parts = token.split(".")
    if len(parts) != 3:
        raise ValueError("Invalid JWT format")
    payload = parts[1]
    # Fix base64 padding
    payload += "=" * (4 - len(payload) % 4)
    decoded = base64.urlsafe_b64decode(payload)
    return json.loads(decoded)


def _file_exists(name: str) -> bool:
    return os.path.isfile(os.path.join(_config_dir(), name))


# ---------------------------------------------------------------------------
# GET /api/config — overall status
# ---------------------------------------------------------------------------

@router.get("/api/config")
def get_config_status():
    token_data = _read_token()
    token_info = None
    user_info = None

    if token_data and "id_token" in token_data:
        try:
            payload = _decode_jwt_payload(token_data["id_token"])
            token_info = {
                "email": payload.get("email", ""),
                "name": payload.get("name", ""),
                "exp": payload.get("exp"),
                "projects": payload.get("projects", []),
            }
        except Exception:
            token_info = {"error": "Could not decode token"}

    # Check fabric_rc for project_id
    project_id = ""
    bastion_username = ""
    rc_path = os.path.join(_config_dir(), "fabric_rc")
    if os.path.isfile(rc_path):
        with open(rc_path) as f:
            for line in f:
                line = line.strip()
                if line.startswith("export FABRIC_PROJECT_ID="):
                    project_id = line.split("=", 1)[1]
                elif line.startswith("export FABRIC_BASTION_USERNAME="):
                    bastion_username = line.split("=", 1)[1]

    return {
        "configured": is_configured(),
        "has_token": _file_exists("id_token.json"),
        "has_bastion_key": _file_exists("fabric_bastion_key"),
        "has_slice_key": _file_exists("slice_key") and _file_exists("slice_key.pub"),
        "token_info": token_info,
        "project_id": project_id,
        "bastion_username": bastion_username,
    }


# ---------------------------------------------------------------------------
# POST /api/config/token — upload token JSON file
# ---------------------------------------------------------------------------

@router.post("/api/config/token")
async def upload_token(file: UploadFile = File(...)):
    content = await file.read()
    try:
        token_data = json.loads(content)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid JSON file")

    if "id_token" not in token_data:
        raise HTTPException(status_code=400, detail="Token file must contain 'id_token' field")

    d = _ensure_config_dir()
    path = os.path.join(d, "id_token.json")
    with open(path, "w") as f:
        json.dump(token_data, f, indent=2)
    os.chmod(path, stat.S_IRUSR | stat.S_IWUSR)

    return {"status": "ok", "message": "Token uploaded successfully"}


# ---------------------------------------------------------------------------
# GET /api/config/login — return CM OAuth login URL
# ---------------------------------------------------------------------------

@router.get("/api/config/login")
def get_login_url():
    cm_url = "https://cm.fabric-testbed.net/credmgr/tokens/create_cli?" + urlencode({
        "scope": "all",
        "lifetime": "4",
    })
    return {"login_url": cm_url}


# ---------------------------------------------------------------------------
# POST /api/config/token/paste — accept pasted token JSON text
# ---------------------------------------------------------------------------

class TokenPasteRequest(BaseModel):
    token_text: str


@router.post("/api/config/token/paste")
def paste_token(req: TokenPasteRequest):
    text = req.token_text.strip()
    try:
        token_data = json.loads(text)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid JSON. Paste the complete token JSON from Credential Manager.")

    if "id_token" not in token_data:
        raise HTTPException(status_code=400, detail="Token JSON must contain an 'id_token' field")

    d = _ensure_config_dir()
    path = os.path.join(d, "id_token.json")
    with open(path, "w") as f:
        json.dump(token_data, f, indent=2)
    os.chmod(path, stat.S_IRUSR | stat.S_IWUSR)

    return {"status": "ok", "message": "Token saved successfully"}


# ---------------------------------------------------------------------------
# GET /api/config/callback — OAuth callback from CM
# ---------------------------------------------------------------------------

@router.get("/api/config/callback")
def oauth_callback(id_token: str, refresh_token: str = ""):
    d = _ensure_config_dir()
    token_data = {
        "id_token": id_token,
        "refresh_token": refresh_token,
    }
    path = os.path.join(d, "id_token.json")
    with open(path, "w") as f:
        json.dump(token_data, f, indent=2)
    os.chmod(path, stat.S_IRUSR | stat.S_IWUSR)

    # Redirect back to frontend with success indicator
    base_url = os.environ.get("WEBGUI_BASE_URL", "http://localhost:3000")
    return RedirectResponse(url=f"{base_url}/?configLogin=success")


# ---------------------------------------------------------------------------
# GET /api/config/projects — decode JWT + query UIS for projects & bastion_login
# ---------------------------------------------------------------------------

@router.get("/api/config/projects")
def get_projects():
    token_data = _read_token()
    if not token_data or "id_token" not in token_data:
        raise HTTPException(status_code=400, detail="No token available. Upload or login first.")

    id_token = token_data["id_token"]

    # Decode JWT for projects
    try:
        payload = _decode_jwt_payload(id_token)
    except Exception:
        raise HTTPException(status_code=400, detail="Could not decode token")

    projects = payload.get("projects", [])

    # Derive bastion_login from JWT claims
    # Pattern: {email_username}_{cilogon_id_zero_padded_to_10}
    bastion_login = ""
    try:
        email = payload.get("email", "")
        sub = payload.get("sub", "")  # e.g. http://cilogon.org/serverA/users/31379841
        if email and sub:
            username = email.split("@")[0]
            cilogon_id = sub.rstrip("/").rsplit("/", 1)[-1]
            if cilogon_id.isdigit():
                bastion_login = f"{username}_{cilogon_id.zfill(10)}"
    except Exception:
        pass  # Non-fatal — user can fill in manually

    return {
        "projects": projects,
        "bastion_login": bastion_login,
        "email": payload.get("email", ""),
        "name": payload.get("name", ""),
    }


# ---------------------------------------------------------------------------
# POST /api/config/keys/bastion — upload bastion private key
# ---------------------------------------------------------------------------

@router.post("/api/config/keys/bastion")
async def upload_bastion_key(file: UploadFile = File(...)):
    content = await file.read()
    d = _ensure_config_dir()
    path = os.path.join(d, "fabric_bastion_key")
    with open(path, "wb") as f:
        f.write(content)
    os.chmod(path, stat.S_IRUSR | stat.S_IWUSR)
    return {"status": "ok", "message": "Bastion key uploaded"}


# ---------------------------------------------------------------------------
# POST /api/config/keys/slice — upload slice key pair
# ---------------------------------------------------------------------------

@router.post("/api/config/keys/slice")
async def upload_slice_keys(
    private_key: UploadFile = File(...),
    public_key: UploadFile = File(...),
):
    d = _ensure_config_dir()

    priv_content = await private_key.read()
    pub_content = await public_key.read()

    priv_path = os.path.join(d, "slice_key")
    with open(priv_path, "wb") as f:
        f.write(priv_content)
    os.chmod(priv_path, stat.S_IRUSR | stat.S_IWUSR)

    pub_path = os.path.join(d, "slice_key.pub")
    with open(pub_path, "wb") as f:
        f.write(pub_content)
    os.chmod(pub_path, stat.S_IRUSR | stat.S_IWUSR | stat.S_IRGRP | stat.S_IROTH)

    return {"status": "ok", "message": "Slice keys uploaded"}


# ---------------------------------------------------------------------------
# POST /api/config/keys/slice/generate — auto-generate RSA 2048 slice keys
# ---------------------------------------------------------------------------

@router.post("/api/config/keys/slice/generate")
def generate_slice_keys():
    d = _ensure_config_dir()

    key = paramiko.RSAKey.generate(2048)

    # Save private key
    priv_path = os.path.join(d, "slice_key")
    key.write_private_key_file(priv_path)
    os.chmod(priv_path, stat.S_IRUSR | stat.S_IWUSR)

    # Save public key
    pub_path = os.path.join(d, "slice_key.pub")
    pub_key_str = f"{key.get_name()} {key.get_base64()} fabric-webgui-generated"
    with open(pub_path, "w") as f:
        f.write(pub_key_str + "\n")
    os.chmod(pub_path, stat.S_IRUSR | stat.S_IWUSR | stat.S_IRGRP | stat.S_IROTH)

    return {
        "status": "ok",
        "public_key": pub_key_str,
        "message": "Slice keys generated. Add the public key to your FABRIC portal profile.",
    }


# ---------------------------------------------------------------------------
# POST /api/config/save — write fabric_rc and reset FABlib
# ---------------------------------------------------------------------------

class ConfigSaveRequest(BaseModel):
    # Required
    project_id: str
    bastion_username: str
    # Service hosts
    credmgr_host: str = "cm.fabric-testbed.net"
    orchestrator_host: str = "orchestrator.fabric-testbed.net"
    core_api_host: str = "uis.fabric-testbed.net"
    bastion_host: str = "bastion.fabric-testbed.net"
    am_host: str = "artifacts.fabric-testbed.net"
    # Logging
    log_level: str = "INFO"
    log_file: str = "/tmp/fablib/fablib.log"
    # Advanced
    avoid: str = ""
    ssh_command_line: str = (
        "ssh -i {{ _self_.private_ssh_key_file }} "
        "-F {config_dir}/ssh_config "
        "{{ _self_.username }}@{{ _self_.management_ip }}"
    )


@router.post("/api/config/save")
def save_config(req: ConfigSaveRequest):
    d = _ensure_config_dir()

    if not _file_exists("id_token.json"):
        raise HTTPException(status_code=400, detail="Token is required before saving configuration")

    # Resolve ssh_command_line config_dir placeholder
    ssh_cmd = req.ssh_command_line.replace("{config_dir}", d)

    fabric_rc = f"""export FABRIC_CREDMGR_HOST={req.credmgr_host}
export FABRIC_ORCHESTRATOR_HOST={req.orchestrator_host}
export FABRIC_CORE_API_HOST={req.core_api_host}
export FABRIC_AM_HOST={req.am_host}
export FABRIC_TOKEN_LOCATION={d}/id_token.json
export FABRIC_BASTION_HOST={req.bastion_host}
export FABRIC_BASTION_USERNAME={req.bastion_username}
export FABRIC_BASTION_KEY_LOCATION={d}/fabric_bastion_key
export FABRIC_BASTION_SSH_CONFIG_FILE={d}/ssh_config
export FABRIC_SLICE_PUBLIC_KEY_FILE={d}/slice_key.pub
export FABRIC_SLICE_PRIVATE_KEY_FILE={d}/slice_key
export FABRIC_PROJECT_ID={req.project_id}
export FABRIC_LOG_LEVEL={req.log_level}
export FABRIC_LOG_FILE={req.log_file}
export FABRIC_AVOID={req.avoid}
export FABRIC_SSH_COMMAND_LINE="{ssh_cmd}"
"""

    rc_path = os.path.join(d, "fabric_rc")
    with open(rc_path, "w") as f:
        f.write(fabric_rc)

    # Write ssh_config for bastion proxy jump
    ssh_config = f"""UserKnownHostsFile /dev/null
StrictHostKeyChecking no
ServerAliveInterval 120

Host bastion.fabric-testbed.net
    User {req.bastion_username}
    ForwardAgent yes
    Hostname %h
    IdentityFile {d}/fabric_bastion_key
    IdentitiesOnly yes

Host * !bastion.fabric-testbed.net
    ProxyJump {req.bastion_username}@bastion.fabric-testbed.net:22
"""
    ssh_config_path = os.path.join(d, "ssh_config")
    with open(ssh_config_path, "w") as f:
        f.write(ssh_config)

    # Reset FABlib so it picks up the new config
    reset_fablib()

    return {"status": "ok", "configured": is_configured()}
