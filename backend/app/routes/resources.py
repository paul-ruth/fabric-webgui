"""Resource and site information API routes."""

from __future__ import annotations
import time
from typing import Any

from fastapi import APIRouter, HTTPException

from app.fablib_manager import get_fablib

router = APIRouter(tags=["resources"])

# Simple cache for expensive topology queries
_cache: dict[str, tuple[float, Any]] = {}
CACHE_TTL = 300  # 5 minutes

# FABRIC site GPS coordinates (from FABRIC API)
SITE_LOCATIONS: dict[str, dict[str, float]] = {
    "AMST": {"lat": 52.3545, "lon": 4.9558},
    "ATLA": {"lat": 33.7586, "lon": -84.3877},
    "BRIST": {"lat": 51.4571, "lon": -2.6073},
    "CERN": {"lat": 46.2339, "lon": 6.0470},
    "CIEN": {"lat": 45.4215, "lon": -75.6972},
    "CLEM": {"lat": 34.5865, "lon": -82.8213},
    "DALL": {"lat": 32.7991, "lon": -96.8207},
    "EDC": {"lat": 40.0958, "lon": -88.2415},
    "EDUKY": {"lat": 38.0325, "lon": -84.5028},
    "FIU": {"lat": 25.7543, "lon": -80.3703},
    "GATECH": {"lat": 33.7754, "lon": -84.3875},
    "GPN": {"lat": 39.0343, "lon": -94.5826},
    "HAWI": {"lat": 21.2990, "lon": -157.8164},
    "INDI": {"lat": 39.7737, "lon": -86.1675},
    "KANS": {"lat": 39.1005, "lon": -94.5823},
    "LOSA": {"lat": 34.0491, "lon": -118.2595},
    "MASS": {"lat": 42.2025, "lon": -72.6079},
    "MAX": {"lat": 38.9886, "lon": -76.9435},
    "MICH": {"lat": 42.2931, "lon": -83.7101},
    "NCSA": {"lat": 40.0958, "lon": -88.2415},
    "NEWY": {"lat": 40.7384, "lon": -73.9992},
    "PRIN": {"lat": 40.3461, "lon": -74.6161},
    "PSC": {"lat": 40.4344, "lon": -79.7502},
    "RUTG": {"lat": 40.5225, "lon": -74.4406},
    "SALT": {"lat": 40.7571, "lon": -111.9535},
    "SEAT": {"lat": 47.6144, "lon": -122.3389},
    "SRI": {"lat": 37.4566, "lon": -122.1747},
    "STAR": {"lat": 42.2360, "lon": -88.1575},
    "TACC": {"lat": 30.3899, "lon": -97.7262},
    "TOKY": {"lat": 35.7115, "lon": 139.7641},
    "UCSD": {"lat": 32.8887, "lon": -117.2393},
    "UTAH": {"lat": 40.7504, "lon": -111.8938},
    "WASH": {"lat": 38.9209, "lon": -77.2112},
}

# Available component models
COMPONENT_MODELS = [
    {"model": "NIC_Basic", "type": "SmartNIC", "description": "Basic 100Gbps NIC"},
    {"model": "NIC_ConnectX_5", "type": "SmartNIC", "description": "Mellanox ConnectX-5 25Gbps"},
    {"model": "NIC_ConnectX_6", "type": "SmartNIC", "description": "Mellanox ConnectX-6 100Gbps"},
    {"model": "NIC_ConnectX_7", "type": "SmartNIC", "description": "Mellanox ConnectX-7 100Gbps"},
    {"model": "GPU_TeslaT4", "type": "GPU", "description": "NVIDIA Tesla T4"},
    {"model": "GPU_RTX6000", "type": "GPU", "description": "NVIDIA RTX 6000"},
    {"model": "GPU_A30", "type": "GPU", "description": "NVIDIA A30"},
    {"model": "GPU_A40", "type": "GPU", "description": "NVIDIA A40"},
    {"model": "FPGA_Xilinx_U280", "type": "FPGA", "description": "Xilinx Alveo U280"},
    {"model": "NVME_P4510", "type": "Storage", "description": "Intel P4510 NVMe"},
]

# Available OS images
DEFAULT_IMAGES = [
    "default_ubuntu_22",
    "default_ubuntu_24",
    "default_ubuntu_20",
    "default_centos_8",
    "default_centos_9",
    "default_rocky_8",
    "default_rocky_9",
    "default_debian_11",
    "default_debian_12",
]


@router.get("/sites")
def list_sites() -> list[dict[str, Any]]:
    """List all FABRIC sites with location and availability."""
    fablib = get_fablib()
    try:
        resources = fablib.get_resources()
        sites = []
        for site_name in resources.get_site_names():
            site = resources.get_site(site_name)
            location = SITE_LOCATIONS.get(site_name, {"lat": 0, "lon": 0})
            sites.append({
                "name": site_name,
                "lat": location["lat"],
                "lon": location["lon"],
                "state": str(site.get_state()) if hasattr(site, "get_state") else "Active",
                "hosts": _safe_count(site, "get_hosts"),
                "cores_available": _safe_attr(site, "get_core_available", 0),
                "cores_capacity": _safe_attr(site, "get_core_capacity", 0),
                "ram_available": _safe_attr(site, "get_ram_available", 0),
                "ram_capacity": _safe_attr(site, "get_ram_capacity", 0),
                "disk_available": _safe_attr(site, "get_disk_available", 0),
                "disk_capacity": _safe_attr(site, "get_disk_capacity", 0),
            })
        return sites
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/links")
def list_links() -> list[dict[str, Any]]:
    """List unique FABRIC backbone links between sites."""
    import re

    # Return cached result if fresh
    cached = _cache.get("links")
    if cached and time.time() - cached[0] < CACHE_TTL:
        return cached[1]

    fablib = get_fablib()
    try:
        resources = fablib.get_resources()
        topo = resources.get_topology()
        seen: set[tuple[str, str]] = set()
        links = []
        for link in topo.links.values():
            try:
                # Extract site names from link name pattern:
                # "port+SITE-data-sw:... to port+SITE-data-sw:..."
                parts = re.findall(r"port\+(\w+)-data-sw:", link.name)
                if len(parts) < 2:
                    continue
                site_a, site_b = parts[0].upper(), parts[1].upper()
                if site_a == site_b:
                    continue
                pair = tuple(sorted([site_a, site_b]))
                if pair in seen:
                    continue
                seen.add(pair)
                links.append({
                    "site_a": pair[0],
                    "site_b": pair[1],
                })
            except Exception:
                continue
        _cache["links"] = (time.time(), links)
        return links
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


COMPONENT_QUERY_MODELS = [
    ("SharedNIC-ConnectX-6", "SharedNIC ConnectX-6"),
    ("SmartNIC-ConnectX-5", "SmartNIC ConnectX-5"),
    ("SmartNIC-ConnectX-6", "SmartNIC ConnectX-6"),
    ("SmartNIC-ConnectX-7", "SmartNIC ConnectX-7"),
    ("GPU-Tesla T4", "GPU Tesla T4"),
    ("GPU-RTX6000", "GPU RTX6000"),
    ("GPU-A30", "GPU A30"),
    ("GPU-A40", "GPU A40"),
    ("FPGA-Xilinx-U280", "FPGA Xilinx U280"),
    ("NVME-P4510", "NVMe P4510"),
]


@router.get("/sites/{site_name}")
def get_site_detail(site_name: str) -> dict[str, Any]:
    """Get detailed site info including per-component resource allocation."""
    fablib = get_fablib()
    try:
        resources = fablib.get_resources()
        site = resources.get_site(site_name)
        location = SITE_LOCATIONS.get(site_name, {"lat": 0, "lon": 0})

        components: dict[str, dict[str, int]] = {}
        for model_name, display_name in COMPONENT_QUERY_MODELS:
            try:
                capacity = site.get_component_capacity(model_name)
                if capacity and capacity > 0:
                    allocated = site.get_component_allocated(model_name) or 0
                    available = site.get_component_available(model_name) or 0
                    components[display_name] = {
                        "capacity": capacity,
                        "allocated": allocated,
                        "available": available,
                    }
            except Exception:
                continue

        return {
            "name": site_name,
            "lat": location["lat"],
            "lon": location["lon"],
            "state": str(site.get_state()) if hasattr(site, "get_state") else "Active",
            "hosts": _safe_count(site, "get_hosts"),
            "cores_available": _safe_attr(site, "get_core_available", 0),
            "cores_capacity": _safe_attr(site, "get_core_capacity", 0),
            "cores_allocated": _safe_attr(site, "get_core_allocated", 0),
            "ram_available": _safe_attr(site, "get_ram_available", 0),
            "ram_capacity": _safe_attr(site, "get_ram_capacity", 0),
            "ram_allocated": _safe_attr(site, "get_ram_allocated", 0),
            "disk_available": _safe_attr(site, "get_disk_available", 0),
            "disk_capacity": _safe_attr(site, "get_disk_capacity", 0),
            "disk_allocated": _safe_attr(site, "get_disk_allocated", 0),
            "components": components,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/resources")
def get_resources() -> dict[str, Any]:
    """Get resource availability across all sites."""
    fablib = get_fablib()
    try:
        resources = fablib.get_resources()
        result = {}
        for site_name in resources.get_site_names():
            try:
                site = resources.get_site(site_name)
                result[site_name] = {
                    "cores_available": _safe_attr(site, "get_core_available"),
                    "cores_capacity": _safe_attr(site, "get_core_capacity"),
                    "ram_available": _safe_attr(site, "get_ram_available"),
                    "ram_capacity": _safe_attr(site, "get_ram_capacity"),
                    "disk_available": _safe_attr(site, "get_disk_available"),
                    "disk_capacity": _safe_attr(site, "get_disk_capacity"),
                }
            except Exception:
                result[site_name] = {"error": "unavailable"}
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/images")
def list_images() -> list[str]:
    """List available VM images."""
    return DEFAULT_IMAGES


@router.get("/component-models")
def list_component_models() -> list[dict[str, str]]:
    """List available component models."""
    return COMPONENT_MODELS


def _safe_attr(obj, method_name, default=None):
    try:
        return getattr(obj, method_name)()
    except Exception:
        return default


def _safe_count(obj, method_name):
    try:
        return len(getattr(obj, method_name)())
    except Exception:
        return 0
