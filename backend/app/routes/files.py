"""File browser endpoints: container storage CRUD, VM SFTP, provisioning."""
from __future__ import annotations

import asyncio
import io
import json
import logging
import os
import shutil
import tempfile
import uuid
import zipfile
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, HTTPException, UploadFile, File, Query
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel

from app.fablib_manager import get_fablib
from app.routes.terminal import (
    _load_private_key,
    _get_ssh_config,
    _connect_bastion,
    _open_tunnel,
)

logger = logging.getLogger(__name__)
router = APIRouter()

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _storage_dir() -> str:
    return os.environ.get("FABRIC_STORAGE_DIR", "/fabric_storage")


def _safe_path(base: str, user_path: str) -> str:
    """Resolve *user_path* under *base*, rejecting traversals."""
    joined = os.path.join(base, user_path.lstrip("/"))
    resolved = os.path.realpath(joined)
    base_resolved = os.path.realpath(base)
    if not resolved.startswith(base_resolved + os.sep) and resolved != base_resolved:
        raise HTTPException(status_code=400, detail="Path traversal not allowed")
    return resolved


def _entry(full_path: str) -> dict:
    """Build a FileEntry dict for a single path."""
    st = os.stat(full_path)
    return {
        "name": os.path.basename(full_path),
        "type": "dir" if os.path.isdir(full_path) else "file",
        "size": st.st_size,
        "modified": datetime.fromtimestamp(st.st_mtime).isoformat(),
    }


def _provisions_dir() -> str:
    d = os.path.join(_storage_dir(), ".provisions")
    os.makedirs(d, exist_ok=True)
    return d


def _load_provisions(slice_name: str) -> list:
    path = os.path.join(_provisions_dir(), f"{slice_name}.json")
    if not os.path.isfile(path):
        return []
    with open(path) as f:
        return json.load(f)


def _save_provisions(slice_name: str, rules: list):
    path = os.path.join(_provisions_dir(), f"{slice_name}.json")
    with open(path, "w") as f:
        json.dump(rules, f, indent=2)


# ---------------------------------------------------------------------------
# FABlib node helper
# ---------------------------------------------------------------------------

def _get_node(slice_name: str, node_name: str):
    """Return FABlib node object for a slice/node pair."""
    fablib = get_fablib()
    slice_obj = fablib.get_slice(slice_name)
    return slice_obj.get_node(node_name)


# ---------------------------------------------------------------------------
# SFTP helper (used only for VM file listing)
# ---------------------------------------------------------------------------

def _get_sftp(slice_name: str, node_name: str):
    """Return (bastion, target_client, sftp_client) for a VM node."""
    import paramiko

    fablib = get_fablib()
    slice_obj = fablib.get_slice(slice_name)
    node_obj = slice_obj.get_node(node_name)
    management_ip = str(node_obj.get_management_ip())
    username = node_obj.get_username()

    if not management_ip:
        raise HTTPException(status_code=400, detail="Node has no management IP")

    ssh_config = _get_ssh_config(slice_name=slice_name)
    bastion = _connect_bastion(ssh_config)
    channel = _open_tunnel(bastion, management_ip)

    pkey = _load_private_key(ssh_config["slice_key"])
    target = paramiko.SSHClient()
    target.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    target.connect(
        hostname=management_ip,
        username=username,
        pkey=pkey,
        sock=channel,
        timeout=15,
    )
    sftp = target.open_sftp()
    return bastion, target, sftp


# ---------------------------------------------------------------------------
# Container file endpoints
# ---------------------------------------------------------------------------

@router.get("/api/files")
async def list_files(path: str = ""):
    base = _storage_dir()
    target = _safe_path(base, path)
    if not os.path.isdir(target):
        raise HTTPException(status_code=404, detail="Directory not found")
    entries = []
    for name in sorted(os.listdir(target)):
        if name in (".provisions", ".boot-config", ".slice-keys", ".templates", ".vm-templates"):
            continue
        full = os.path.join(target, name)
        try:
            entries.append(_entry(full))
        except OSError:
            continue
    return entries


@router.post("/api/files/upload")
async def upload_files(path: str = "", files: List[UploadFile] = File(...)):
    base = _storage_dir()
    target = _safe_path(base, path)
    os.makedirs(target, exist_ok=True)
    saved = []
    for f in files:
        # filename may contain subdirectory paths (e.g. "folder/sub/file.txt")
        dest = os.path.join(target, f.filename)
        resolved = os.path.realpath(dest)
        # Prevent writing outside target
        if not resolved.startswith(os.path.realpath(target) + os.sep) and resolved != os.path.realpath(target):
            continue
        # Create intermediate directories for nested paths
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        content = await f.read()
        with open(dest, "wb") as out:
            out.write(content)
        saved.append(f.filename)
    return {"uploaded": saved}


class MkdirRequest(BaseModel):
    name: str


@router.post("/api/files/mkdir")
async def create_folder(body: MkdirRequest, path: str = ""):
    base = _storage_dir()
    target = _safe_path(base, path)
    new_dir = os.path.join(target, body.name)
    _safe_path(base, os.path.join(path, body.name))
    os.makedirs(new_dir, exist_ok=True)
    return {"created": body.name}


MAX_TEXT_SIZE = 5 * 1024 * 1024  # 5 MB


@router.get("/api/files/content")
async def read_file_content(path: str = ""):
    """Read text file content for in-browser editing."""
    base = _storage_dir()
    target = _safe_path(base, path)
    if not os.path.isfile(target):
        raise HTTPException(status_code=404, detail="File not found")
    size = os.path.getsize(target)
    if size > MAX_TEXT_SIZE:
        raise HTTPException(status_code=400, detail="File too large to edit (>5 MB)")
    try:
        with open(target, "r", encoding="utf-8", errors="replace") as f:
            content = f.read()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Cannot read file: {e}")
    return {"path": path, "content": content}


class FileContentBody(BaseModel):
    path: str
    content: str


@router.put("/api/files/content")
async def write_file_content(body: FileContentBody):
    """Write text file content from in-browser editor."""
    base = _storage_dir()
    target = _safe_path(base, body.path)
    try:
        with open(target, "w", encoding="utf-8") as f:
            f.write(body.content)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Cannot write file: {e}")
    return {"path": body.path, "status": "ok"}


@router.get("/api/files/download")
async def download_file(path: str = ""):
    base = _storage_dir()
    target = _safe_path(base, path)
    if not os.path.isfile(target):
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(target, filename=os.path.basename(target))


@router.get("/api/files/download-folder")
async def download_folder(path: str = ""):
    base = _storage_dir()
    target = _safe_path(base, path)
    if not os.path.isdir(target):
        raise HTTPException(status_code=404, detail="Directory not found")

    buf = io.BytesIO()
    folder_name = os.path.basename(target) or "storage"
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for root, dirs, files in os.walk(target):
            # Skip internal directories
            dirs[:] = [d for d in dirs if d not in (".provisions", ".boot-config", ".slice-keys")]
            for fname in files:
                full = os.path.join(root, fname)
                arcname = os.path.relpath(full, target)
                zf.write(full, arcname)
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{folder_name}.zip"'},
    )


@router.delete("/api/files")
async def delete_file(path: str = ""):
    base = _storage_dir()
    if not path or path.strip("/") == "":
        raise HTTPException(status_code=400, detail="Cannot delete storage root")
    target = _safe_path(base, path)
    if not os.path.exists(target):
        raise HTTPException(status_code=404, detail="Path not found")
    if os.path.isdir(target):
        shutil.rmtree(target)
    else:
        os.remove(target)
    return {"deleted": path}


# ---------------------------------------------------------------------------
# VM file endpoints (SFTP)
# ---------------------------------------------------------------------------

@router.get("/api/files/vm/{slice_name}/{node_name}")
async def list_vm_files(slice_name: str, node_name: str, path: str = "/home"):
    def _do():
        bastion, target, sftp = _get_sftp(slice_name, node_name)
        try:
            entries = []
            for attr in sftp.listdir_attr(path):
                import stat as stat_mod
                entry = {
                    "name": attr.filename,
                    "type": "dir" if stat_mod.S_ISDIR(attr.st_mode or 0) else "file",
                    "size": attr.st_size or 0,
                    "modified": datetime.fromtimestamp(attr.st_mtime or 0).isoformat() if attr.st_mtime else "",
                }
                entries.append(entry)
            return sorted(entries, key=lambda e: (e["type"] != "dir", e["name"]))
        finally:
            sftp.close()
            target.close()
            bastion.close()

    return await asyncio.to_thread(_do)


class VmDownloadRequest(BaseModel):
    remote_path: str
    dest_dir: str = ""


@router.post("/api/files/vm/{slice_name}/{node_name}/download")
async def download_vm_file(slice_name: str, node_name: str, body: VmDownloadRequest):
    def _do():
        node_obj = _get_node(slice_name, node_name)
        base = _storage_dir()
        dest = _safe_path(base, body.dest_dir)
        os.makedirs(dest, exist_ok=True)
        filename = os.path.basename(body.remote_path)
        local_path = os.path.join(dest, filename)
        node_obj.download_file(local_path, body.remote_path)
        return {"downloaded": filename, "local_path": os.path.join(body.dest_dir, filename)}

    return await asyncio.to_thread(_do)


class VmUploadRequest(BaseModel):
    source: str
    dest: str


@router.post("/api/files/vm/{slice_name}/{node_name}/upload")
async def upload_to_vm(slice_name: str, node_name: str, body: VmUploadRequest):
    def _do():
        base = _storage_dir()
        local_path = _safe_path(base, body.source)
        if not os.path.exists(local_path):
            raise HTTPException(status_code=404, detail="Source not found in container storage")

        node_obj = _get_node(slice_name, node_name)
        if os.path.isdir(local_path):
            node_obj.upload_directory(local_path, body.dest)
        else:
            node_obj.upload_file(local_path, body.dest)
        return {"uploaded": body.source, "remote_path": body.dest}

    return await asyncio.to_thread(_do)


@router.post("/api/files/vm/{slice_name}/{node_name}/upload-direct")
async def upload_direct_to_vm(
    slice_name: str,
    node_name: str,
    dest_path: str = Query("/home"),
    files: List[UploadFile] = File(...),
):
    """Upload files directly from the browser to a VM.

    Files are written to a temp directory, pushed to the VM via FABlib,
    then cleaned up.  The filename field may contain subdirectory segments
    (e.g. ``folder/sub/file.txt``) to preserve folder structure.
    """
    tmp_dir = tempfile.mkdtemp(prefix="fabric_vm_upload_")
    saved: list[str] = []
    try:
        # 1. Write uploaded files to temp dir, preserving relative paths
        for f in files:
            local = os.path.join(tmp_dir, f.filename)
            os.makedirs(os.path.dirname(local), exist_ok=True)
            content = await f.read()
            with open(local, "wb") as out:
                out.write(content)
            saved.append(f.filename)

        # 2. Push to VM via FABlib (in a thread)
        def _do():
            node_obj = _get_node(slice_name, node_name)
            # Check if we have top-level directories (folder upload)
            top_items = os.listdir(tmp_dir)
            for item in top_items:
                item_path = os.path.join(tmp_dir, item)
                remote = dest_path.rstrip("/") + "/" + item
                if os.path.isdir(item_path):
                    node_obj.upload_directory(item_path, remote)
                else:
                    node_obj.upload_file(item_path, remote)

        await asyncio.to_thread(_do)
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)

    return {"uploaded": saved, "dest": dest_path}


@router.get("/api/files/vm/{slice_name}/{node_name}/download-direct")
async def download_direct_from_vm(
    slice_name: str,
    node_name: str,
    remote_path: str = Query(...),
):
    """Download a single file from a VM directly to the browser."""
    tmp_dir = tempfile.mkdtemp(prefix="fabric_vm_dl_")
    filename = os.path.basename(remote_path) or "download"
    local_path = os.path.join(tmp_dir, filename)

    def _do():
        node_obj = _get_node(slice_name, node_name)
        node_obj.download_file(local_path, remote_path)

    await asyncio.to_thread(_do)

    if not os.path.isfile(local_path):
        shutil.rmtree(tmp_dir, ignore_errors=True)
        raise HTTPException(status_code=500, detail="Download from VM failed")

    # Stream the file and clean up the temp dir afterward
    def iterfile():
        try:
            with open(local_path, "rb") as f:
                while chunk := f.read(1024 * 1024):
                    yield chunk
        finally:
            shutil.rmtree(tmp_dir, ignore_errors=True)

    return StreamingResponse(
        iterfile(),
        media_type="application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/api/files/vm/{slice_name}/{node_name}/download-folder")
async def download_folder_from_vm(
    slice_name: str,
    node_name: str,
    remote_path: str = Query(...),
):
    """Download a folder from a VM as a zip file to the browser."""
    tmp_dir = tempfile.mkdtemp(prefix="fabric_vm_dldir_")

    def _do():
        bastion, target, sftp = _get_sftp(slice_name, node_name)
        try:
            _sftp_download_recursive(sftp, remote_path, tmp_dir)
        finally:
            sftp.close()
            target.close()
            bastion.close()

    await asyncio.to_thread(_do)

    folder_name = os.path.basename(remote_path.rstrip("/")) or "folder"
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for root, _dirs, files in os.walk(tmp_dir):
            for fname in files:
                full = os.path.join(root, fname)
                arcname = os.path.relpath(full, tmp_dir)
                zf.write(full, arcname)
    shutil.rmtree(tmp_dir, ignore_errors=True)
    buf.seek(0)

    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{folder_name}.zip"'},
    )


def _sftp_download_recursive(sftp, remote_dir: str, local_dir: str):
    """Recursively download a remote directory via SFTP."""
    import stat as stat_mod
    os.makedirs(local_dir, exist_ok=True)
    for attr in sftp.listdir_attr(remote_dir):
        remote_path = f"{remote_dir.rstrip('/')}/{attr.filename}"
        local_path = os.path.join(local_dir, attr.filename)
        if stat_mod.S_ISDIR(attr.st_mode or 0):
            _sftp_download_recursive(sftp, remote_path, local_path)
        else:
            sftp.get(remote_path, local_path)


class VmReadFileRequest(BaseModel):
    path: str


@router.post("/api/files/vm/{slice_name}/{node_name}/read-content")
async def read_vm_file_content(slice_name: str, node_name: str, body: VmReadFileRequest):
    """Read a text file from a VM for in-browser editing."""
    def _do():
        node_obj = _get_node(slice_name, node_name)
        stdout, stderr = node_obj.execute(
            f"cat {body.path!r}", quiet=True
        )
        return {"path": body.path, "content": stdout}

    return await asyncio.to_thread(_do)


class VmWriteFileRequest(BaseModel):
    path: str
    content: str


@router.post("/api/files/vm/{slice_name}/{node_name}/write-content")
async def write_vm_file_content(slice_name: str, node_name: str, body: VmWriteFileRequest):
    """Write a text file on a VM from in-browser editor."""
    def _do():
        node_obj = _get_node(slice_name, node_name)
        # Use python to write the file to handle arbitrary content safely
        import base64
        encoded = base64.b64encode(body.content.encode("utf-8")).decode("ascii")
        cmd = f"python3 -c \"import base64; open({body.path!r},'w').write(base64.b64decode('{encoded}').decode('utf-8'))\""
        stdout, stderr = node_obj.execute(cmd, quiet=True)
        if stderr and stderr.strip():
            raise HTTPException(status_code=500, detail=stderr.strip())
        return {"path": body.path, "status": "ok"}

    return await asyncio.to_thread(_do)


class VmMkdirRequest(BaseModel):
    path: str


@router.post("/api/files/vm/{slice_name}/{node_name}/mkdir")
async def vm_mkdir(slice_name: str, node_name: str, body: VmMkdirRequest):
    """Create a directory on the VM."""
    def _do():
        node_obj = _get_node(slice_name, node_name)
        stdout, stderr = node_obj.execute(f"mkdir -p {body.path!r}", quiet=True)
        if stderr and stderr.strip():
            raise HTTPException(status_code=500, detail=stderr.strip())
        return {"created": body.path}

    return await asyncio.to_thread(_do)


class VmDeleteRequest(BaseModel):
    path: str


@router.post("/api/files/vm/{slice_name}/{node_name}/delete")
async def vm_delete(slice_name: str, node_name: str, body: VmDeleteRequest):
    """Delete a file or directory on the VM."""
    def _do():
        node_obj = _get_node(slice_name, node_name)
        stdout, stderr = node_obj.execute(f"rm -rf {body.path!r}", quiet=True)
        if stderr and stderr.strip():
            raise HTTPException(status_code=500, detail=stderr.strip())
        return {"deleted": body.path}

    return await asyncio.to_thread(_do)


class VmExecBody(BaseModel):
    command: str


@router.post("/api/files/vm/{slice_name}/{node_name}/execute")
async def execute_on_vm(slice_name: str, node_name: str, body: VmExecBody):
    """Execute an ad-hoc command on a VM node."""
    def _do():
        node_obj = _get_node(slice_name, node_name)
        stdout, stderr = node_obj.execute(body.command, quiet=True)
        return {"stdout": stdout or "", "stderr": stderr or ""}

    return await asyncio.to_thread(_do)


# ---------------------------------------------------------------------------
# Provisioning endpoints
# ---------------------------------------------------------------------------

class ProvisionRequest(BaseModel):
    source: str
    slice_name: str
    node_name: str
    dest: str


@router.post("/api/files/provisions")
async def add_provision(body: ProvisionRequest):
    rules = _load_provisions(body.slice_name)
    rule = {
        "id": str(uuid.uuid4()),
        "source": body.source,
        "slice_name": body.slice_name,
        "node_name": body.node_name,
        "dest": body.dest,
    }
    rules.append(rule)
    _save_provisions(body.slice_name, rules)
    return rule


@router.get("/api/files/provisions/{slice_name}")
async def list_provisions(slice_name: str):
    return _load_provisions(slice_name)


@router.delete("/api/files/provisions/{slice_name}/{rule_id}")
async def delete_provision(slice_name: str, rule_id: str):
    rules = _load_provisions(slice_name)
    rules = [r for r in rules if r["id"] != rule_id]
    _save_provisions(slice_name, rules)
    return {"deleted": rule_id}


@router.post("/api/files/provisions/{slice_name}/execute")
async def execute_provisions(slice_name: str, node_name: Optional[str] = Query(None)):
    rules = _load_provisions(slice_name)
    if node_name:
        rules = [r for r in rules if r["node_name"] == node_name]

    results = []

    def _do():
        fablib = get_fablib()
        slice_obj = fablib.get_slice(slice_name)
        for rule in rules:
            try:
                base = _storage_dir()
                local_path = _safe_path(base, rule["source"])
                if not os.path.exists(local_path):
                    results.append({"id": rule["id"], "status": "error", "detail": "Source not found"})
                    continue

                node_obj = slice_obj.get_node(rule["node_name"])
                if os.path.isdir(local_path):
                    node_obj.upload_directory(local_path, rule["dest"])
                else:
                    node_obj.upload_file(local_path, rule["dest"])
                results.append({"id": rule["id"], "status": "ok"})
            except Exception as e:
                results.append({"id": rule["id"], "status": "error", "detail": str(e)})

    await asyncio.to_thread(_do)
    return results


# ---------------------------------------------------------------------------
# Boot config helpers
# ---------------------------------------------------------------------------

def _boot_config_dir(slice_name: str) -> str:
    d = os.path.join(_storage_dir(), ".boot-config", slice_name)
    os.makedirs(d, exist_ok=True)
    return d


def _load_boot_config(slice_name: str, node_name: str) -> dict:
    """Load boot config.  Priority: .boot-config/ JSON file, then FABlib user_data."""
    path = os.path.join(_boot_config_dir(slice_name), f"{node_name}.json")
    if os.path.isfile(path):
        with open(path) as f:
            data = json.load(f)
        data.setdefault("network", [])
        return data

    # Fallback: read from FABlib user_data (persists with slice)
    return _load_boot_config_from_fablib(slice_name, node_name)


def _load_boot_config_from_fablib(slice_name: str, node_name: str) -> dict:
    """Read boot config from FABlib node user_data."""
    empty = {"uploads": [], "commands": [], "network": []}
    try:
        fablib = get_fablib()
        slice_obj = fablib.get_slice(slice_name)
        node = slice_obj.get_node(node_name)
        user_data = node.get_user_data()
        bc = user_data.get("boot_config")
        if bc and isinstance(bc, dict):
            bc.setdefault("uploads", [])
            bc.setdefault("commands", [])
            bc.setdefault("network", [])
            return bc
    except Exception:
        pass
    return empty


def _save_boot_config(slice_name: str, node_name: str, config: dict):
    """Save boot config to .boot-config/ JSON and to FABlib user_data."""
    # 1. Save to local JSON file (working copy for execute)
    path = os.path.join(_boot_config_dir(slice_name), f"{node_name}.json")
    with open(path, "w") as f:
        json.dump(config, f, indent=2)

    # 2. Save to FABlib user_data so it persists with the slice
    _save_boot_config_to_fablib(slice_name, node_name, config)


def _save_boot_config_to_fablib(slice_name: str, node_name: str, config: dict):
    """Write boot config into FABlib node user_data and post_boot_tasks."""
    try:
        from app.routes.slices import _get_slice_obj
        slice_obj = _get_slice_obj(slice_name)
        node = slice_obj.get_node(name=node_name)
        user_data = node.get_user_data()

        # Store full boot_config in user_data for round-tripping
        user_data["boot_config"] = {
            "uploads": config.get("uploads", []),
            "commands": config.get("commands", []),
            "network": config.get("network", []),
        }

        # Also set post_boot_tasks using FABlib's native format
        # so FABlib's own post-boot system can execute them on submit
        tasks = []
        for u in config.get("uploads", []):
            tasks.append(("upload_directory", u.get("source", ""), u.get("dest", ".")))
        for c in sorted(config.get("commands", []), key=lambda x: x.get("order", 0)):
            tasks.append(("execute", c.get("command", "")))
        if "fablib_data" not in user_data:
            user_data["fablib_data"] = {}
        user_data["fablib_data"]["post_boot_tasks"] = tasks

        node.set_user_data(user_data)
    except Exception as e:
        logging.warning("Could not save boot config to FABlib user_data: %s", e)


# ---------------------------------------------------------------------------
# Boot config endpoints
# ---------------------------------------------------------------------------

class BootConfigBody(BaseModel):
    uploads: list = []
    commands: list = []
    network: list = []


@router.get("/api/files/boot-config/{slice_name}/{node_name}")
async def get_boot_config(slice_name: str, node_name: str):
    return _load_boot_config(slice_name, node_name)


@router.put("/api/files/boot-config/{slice_name}/{node_name}")
async def save_boot_config(slice_name: str, node_name: str, body: BootConfigBody):
    config = {"uploads": body.uploads, "commands": body.commands, "network": body.network}
    _save_boot_config(slice_name, node_name, config)
    return config


@router.post("/api/files/boot-config/{slice_name}/{node_name}/execute")
async def execute_boot_config(slice_name: str, node_name: str):
    config = _load_boot_config(slice_name, node_name)
    results = []

    def _do():
        node_obj = _get_node(slice_name, node_name)
        base = _storage_dir()

        # 1. Process uploads using FABlib
        for upload in config.get("uploads", []):
            uid = upload.get("id", "?")
            try:
                local_path = _safe_path(base, upload["source"])
                if os.path.isdir(local_path):
                    node_obj.upload_directory(local_path, upload["dest"])
                    results.append({"type": "upload", "id": uid, "status": "ok"})
                elif os.path.isfile(local_path):
                    node_obj.upload_file(local_path, upload["dest"])
                    results.append({"type": "upload", "id": uid, "status": "ok"})
                else:
                    results.append({"type": "upload", "id": uid, "status": "error",
                                    "detail": "Source not found"})
            except Exception as e:
                results.append({"type": "upload", "id": uid, "status": "error",
                                "detail": str(e)})

        # 2. Process network config via node.execute()
        for net in sorted(config.get("network", []), key=lambda n: n.get("order", 0)):
            nid = net.get("id", "?")
            try:
                iface = net["iface"]
                mode = net.get("mode", "auto")
                if mode == "auto":
                    cmd = f"sudo dhclient {iface}"
                else:
                    ip_addr = net.get("ip", "")
                    subnet = net.get("subnet", "24")
                    cmd = f"sudo ip addr add {ip_addr}/{subnet} dev {iface} && sudo ip link set {iface} up"
                    gw = net.get("gateway")
                    if gw:
                        cmd += f" && sudo ip route add default via {gw} dev {iface}"
                stdout, stderr = node_obj.execute(cmd, quiet=True)
                if stderr and stderr.strip():
                    results.append({"type": "network", "id": nid, "status": "error",
                                    "detail": stderr.strip()})
                else:
                    results.append({"type": "network", "id": nid, "status": "ok",
                                    "detail": stdout.strip() or None})
            except Exception as e:
                results.append({"type": "network", "id": nid, "status": "error",
                                "detail": str(e)})

        # 3. Process commands (in order) via node.execute()
        for cmd_entry in sorted(config.get("commands", []), key=lambda c: c.get("order", 0)):
            cid = cmd_entry.get("id", "?")
            try:
                stdout, stderr = node_obj.execute(cmd_entry["command"], quiet=True)
                if stderr and stderr.strip():
                    results.append({"type": "command", "id": cid, "status": "error",
                                    "detail": stderr.strip()})
                else:
                    results.append({"type": "command", "id": cid, "status": "ok",
                                    "detail": stdout.strip() or None})
            except Exception as e:
                results.append({"type": "command", "id": cid, "status": "error",
                                "detail": str(e)})

    await asyncio.to_thread(_do)
    return results
