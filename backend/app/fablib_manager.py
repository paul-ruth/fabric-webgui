"""Singleton FABlib manager for the backend."""
from __future__ import annotations

import json
import os
import shutil
import threading
from typing import Optional, Tuple
from fabrictestbed_extensions.fablib.fablib import FablibManager

_lock = threading.Lock()
_fablib: Optional[FablibManager] = None

DEFAULT_CONFIG_DIR = "/fabric_storage/.fabric_config"


def _load_fabric_rc(path: str) -> None:
    """Parse a fabric_rc file and load its exports into os.environ."""
    if not os.path.isfile(path):
        return
    with open(path) as f:
        for line in f:
            line = line.strip()
            if line.startswith("export ") and "=" in line:
                kv = line[len("export "):]
                key, _, value = kv.partition("=")
                os.environ[key.strip()] = value.strip()


def _keys_json_path(config_dir: str) -> str:
    return os.path.join(config_dir, "slice_keys", "keys.json")


def _load_keys_json(config_dir: str) -> dict:
    """Load the slice keys registry, returning {"default": "default", "keys": ["default"]}."""
    path = _keys_json_path(config_dir)
    if os.path.isfile(path):
        with open(path) as f:
            return json.load(f)
    return {"default": "default", "keys": ["default"]}


def _save_keys_json(config_dir: str, data: dict) -> None:
    keys_dir = os.path.join(config_dir, "slice_keys")
    os.makedirs(keys_dir, exist_ok=True)
    with open(_keys_json_path(config_dir), "w") as f:
        json.dump(data, f, indent=2)


def _migrate_legacy_keys(config_dir: str) -> None:
    """On first access, move flat slice_key/slice_key.pub into slice_keys/default/."""
    keys_dir = os.path.join(config_dir, "slice_keys")
    default_dir = os.path.join(keys_dir, "default")
    keys_json = _keys_json_path(config_dir)

    # Already migrated
    if os.path.isfile(keys_json):
        return

    old_priv = os.path.join(config_dir, "slice_key")
    old_pub = os.path.join(config_dir, "slice_key.pub")

    if os.path.isfile(old_priv) or os.path.isfile(old_pub):
        os.makedirs(default_dir, exist_ok=True)
        if os.path.isfile(old_priv):
            shutil.copy2(old_priv, os.path.join(default_dir, "slice_key"))
        if os.path.isfile(old_pub):
            shutil.copy2(old_pub, os.path.join(default_dir, "slice_key.pub"))
        _save_keys_json(config_dir, {"default": "default", "keys": ["default"]})


def get_default_slice_key_path(config_dir: str) -> Tuple[str, str]:
    """Return (private_key_path, public_key_path) for the default key set."""
    _migrate_legacy_keys(config_dir)
    data = _load_keys_json(config_dir)
    default_name = data.get("default", "default")
    base = os.path.join(config_dir, "slice_keys", default_name)
    return (
        os.path.join(base, "slice_key"),
        os.path.join(base, "slice_key.pub"),
    )


def get_slice_key_path(config_dir: str, key_name: str) -> Tuple[str, str]:
    """Return (private_key_path, public_key_path) for a named key set."""
    base = os.path.join(config_dir, "slice_keys", key_name)
    return (
        os.path.join(base, "slice_key"),
        os.path.join(base, "slice_key.pub"),
    )


def is_configured() -> bool:
    """Check whether minimum FABRIC config files exist."""
    config_dir = os.environ.get("FABRIC_CONFIG_DIR", DEFAULT_CONFIG_DIR)
    rc_path = os.path.join(config_dir, "fabric_rc")
    token_path = os.path.join(config_dir, "id_token.json")
    return os.path.isfile(rc_path) and os.path.isfile(token_path)


def reset_fablib() -> None:
    """Reset the FABlib singleton so it will be re-created on next access."""
    global _fablib
    with _lock:
        _fablib = None
    # Re-load fabric_rc env vars so FABlib picks up new settings
    config_dir = os.environ.get("FABRIC_CONFIG_DIR", DEFAULT_CONFIG_DIR)
    rc_path = os.path.join(config_dir, "fabric_rc")
    _load_fabric_rc(rc_path)


def get_fablib() -> FablibManager:
    """Get or create the FABlib manager singleton.

    Raises RuntimeError if FABRIC is not yet configured.
    """
    global _fablib
    if _fablib is None:
        with _lock:
            if _fablib is None:
                config_dir = os.environ.get("FABRIC_CONFIG_DIR", DEFAULT_CONFIG_DIR)
                rc_path = os.path.join(config_dir, "fabric_rc")
                if not os.path.isfile(rc_path):
                    raise RuntimeError(
                        "FABRIC is not configured. Please complete setup in the Configure view."
                    )
                # Load fabric_rc into environment
                _load_fabric_rc(rc_path)
                # Override path-based env vars to use the container config dir.
                # fabric_rc may have hardcoded host paths that don't exist inside
                # the container, so we rewrite any *_LOCATION / *_FILE vars that
                # reference files present in config_dir.
                _PATH_KEYS = [
                    "FABRIC_TOKEN_LOCATION",
                    "FABRIC_BASTION_KEY_LOCATION",
                    "FABRIC_SLICE_PRIVATE_KEY_FILE",
                    "FABRIC_SLICE_PUBLIC_KEY_FILE",
                    "FABRIC_BASTION_SSH_CONFIG_FILE",
                ]
                for key in _PATH_KEYS:
                    val = os.environ.get(key, "")
                    if val:
                        basename = os.path.basename(val)
                        container_path = os.path.join(config_dir, basename)
                        if os.path.exists(container_path):
                            os.environ[key] = container_path
                # Also fix SSH command line if it references a config path
                ssh_cmd = os.environ.get("FABRIC_SSH_COMMAND_LINE", "")
                if ssh_cmd:
                    import re
                    os.environ["FABRIC_SSH_COMMAND_LINE"] = re.sub(
                        r'/[^\s}]+/\.?fabric_config/',
                        config_dir.rstrip('/') + '/',
                        ssh_cmd,
                    )
                # Set defaults FABlib expects
                os.environ["FABRIC_RC"] = rc_path
                os.environ.setdefault(
                    "FABRIC_BASTION_KEY_LOCATION",
                    os.path.join(config_dir, "fabric_bastion_key"),
                )
                # Migrate legacy keys and use default key set
                _migrate_legacy_keys(config_dir)
                priv_path, pub_path = get_default_slice_key_path(config_dir)
                os.environ.setdefault(
                    "FABRIC_SLICE_PRIVATE_KEY_FILE",
                    priv_path,
                )
                os.environ.setdefault(
                    "FABRIC_SLICE_PUBLIC_KEY_FILE",
                    pub_path,
                )
                _fablib = FablibManager()
    return _fablib
