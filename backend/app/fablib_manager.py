"""Singleton FABlib manager for the backend."""
from __future__ import annotations

import os
import threading
from typing import Optional
from fabrictestbed_extensions.fablib.fablib import FablibManager

_lock = threading.Lock()
_fablib: Optional[FablibManager] = None


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


def is_configured() -> bool:
    """Check whether minimum FABRIC config files exist."""
    config_dir = os.environ.get(
        "FABRIC_CONFIG_DIR",
        "/fabric_config",
    )
    rc_path = os.path.join(config_dir, "fabric_rc")
    token_path = os.path.join(config_dir, "id_token.json")
    return os.path.isfile(rc_path) and os.path.isfile(token_path)


def reset_fablib() -> None:
    """Reset the FABlib singleton so it will be re-created on next access."""
    global _fablib
    with _lock:
        _fablib = None
    # Re-load fabric_rc env vars so FABlib picks up new settings
    config_dir = os.environ.get(
        "FABRIC_CONFIG_DIR",
        "/fabric_config",
    )
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
                config_dir = os.environ.get(
                    "FABRIC_CONFIG_DIR",
                    "/fabric_config",
                )
                rc_path = os.path.join(config_dir, "fabric_rc")
                if not os.path.isfile(rc_path):
                    raise RuntimeError(
                        "FABRIC is not configured. Please complete setup in the Configure view."
                    )
                # Load fabric_rc into environment
                _load_fabric_rc(rc_path)
                # Set defaults FABlib expects
                os.environ.setdefault(
                    "FABRIC_RC", rc_path
                )
                os.environ.setdefault(
                    "FABRIC_BASTION_KEY_LOCATION",
                    os.path.join(config_dir, "fabric_bastion_key"),
                )
                os.environ.setdefault(
                    "FABRIC_SLICE_PRIVATE_KEY_FILE",
                    os.path.join(config_dir, "slice_key"),
                )
                os.environ.setdefault(
                    "FABRIC_SLICE_PUBLIC_KEY_FILE",
                    os.path.join(config_dir, "slice_key.pub"),
                )
                _fablib = FablibManager()
    return _fablib
