# Copyright (c) 2026 Efstratios Goudelis
# SPDX-License-Identifier: GPL-3.0-or-later

"""Build the census allowlist without collecting station or user configuration."""

import os
import platform
import re
import shlex
import subprocess
from pathlib import Path

from server.version import get_version_base

NOTICE_VERSION = "census-2"
SUPPORTED_NOTICE_VERSIONS = ("census-1", NOTICE_VERSION)
COLLECTOR_URL = "https://reports.gscontrol.net"
ENVIRONMENTS = ("production", "development", "test", "unknown")
MEMORY_BUCKETS = (1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024)


def _label(value, limit=64):
    if value is None:
        return None
    return str(value).strip()[:limit] or None


def _cpu():
    fields = {}
    try:
        # Read named fields only: /proc/cpuinfo can also contain device serials.
        for line in Path("/proc/cpuinfo").read_text().splitlines():
            key, separator, value = line.partition(":")
            if separator and key.strip() not in fields:
                fields[key.strip()] = value.strip()
    except OSError:
        pass
    count = os.cpu_count()
    return {
        "vendor": _label(fields.get("vendor_id") or fields.get("CPU implementer")),
        "model": _label(fields.get("model name") or fields.get("Hardware"), 128),
        "logical_cores": min(count, 4096) if count else None,
    }


def _gpu():
    try:
        result = subprocess.run(
            ["lspci", "-mm"], capture_output=True, text=True, timeout=2, check=True
        )
        devices = []
        for line in result.stdout.splitlines():
            parts = shlex.split(line)
            if len(parts) >= 4 and parts[1] in (
                "VGA compatible controller",
                "3D controller",
                "Display controller",
            ):
                devices.append({"vendor": _label(parts[2]), "model": _label(parts[3], 128)})
        return {"status": "detected" if devices else "none", "devices": devices[:4]}
    except (OSError, ValueError, subprocess.SubprocessError):
        # Minimal/container installs may have no pciutils. PCI IDs are a safe
        # fallback; never transmit bus addresses, serials or a command dump.
        devices = []
        root = Path("/sys/bus/pci/devices")
        try:
            if not root.is_dir():
                return {"status": "unavailable", "devices": []}
            for device in root.iterdir():
                if (device / "class").read_text().strip().startswith("0x03"):
                    vendor = (device / "vendor").read_text().strip()
                    model = (device / "device").read_text().strip()
                    devices.append(
                        {
                            "vendor": {"0x10de": "NVIDIA", "0x1002": "AMD", "0x8086": "Intel"}.get(
                                vendor, vendor
                            ),
                            "model": f"PCI {model}",
                        }
                    )
            return {"status": "detected" if devices else "none", "devices": devices[:4]}
        except OSError:
            return {"status": "unavailable", "devices": []}


def build_sample(installation_id, environment, notice_version=NOTICE_VERSION):
    """Only these fields cross the network; unknown values remain null."""
    try:
        release = platform.freedesktop_os_release()
    except OSError:
        release = {}
    try:
        memory = os.sysconf("SC_PHYS_PAGES") * os.sysconf("SC_PAGE_SIZE") / 1024**3
        memory_bucket = next((bucket for bucket in MEMORY_BUCKETS if memory <= bucket), 1024)
    except (OSError, ValueError, AttributeError):
        memory_bucket = None
    match = re.match(
        r"^(\d{1,4}\.\d{1,4}\.\d{1,4})(?:\D|$)",
        os.environ.get("BUILD_VERSION") or get_version_base(),
    )
    runtime = os.environ.get("GS_ENVIRONMENT", "unknown")
    return {
        "schema_version": 1,
        "consent_notice_version": notice_version,
        "installation_id": installation_id,
        "application": {
            "version": match.group(1) if match else "0.0.0",
            "channel": {"production": "stable", "development": "development"}.get(
                runtime, "unknown"
            ),
        },
        "deployment": {
            "type": "docker" if Path("/.dockerenv").exists() else "native",
            "environment": environment,
        },
        "os": {
            "family": _label(platform.system()),
            "distribution": _label(release.get("ID")),
            "version": _label(release.get("VERSION_ID")),
        },
        "hardware": {
            "architecture": _label(platform.machine()),
            "cpu": _cpu(),
            "gpu": _gpu(),
            "memory_gib_bucket": memory_bucket,
        },
    }
