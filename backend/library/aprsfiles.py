"""Browse station captures without losing object, item or station map history."""

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import quote

from common.aprsstorage import CALLSIGN, aprs_source
from common.artifactdates import artifact_dates
from library.positions import packet_positions
from telemetry.compatibility import normalize_metadata


def read_json(path):
    if path.is_symlink():
        return {}
    try:
        value = json.loads(path.read_text())
        return value if isinstance(value, dict) else {}
    except (OSError, ValueError):
        return {}


def scan_aprs(folder: Path):
    source = folder.name.removeprefix("aprs_")
    if not CALLSIGN.fullmatch(source):
        return None
    packets, positions = [], []
    runs: dict[str, dict[str, Any]] = {}
    size = file_count = 0
    latest_mtime = 0.0
    latest_position = None
    latest: dict[str, dict[str, Any]] = {}
    resolved = folder.resolve()
    for path in sorted(folder.rglob("*")):
        if path.is_symlink() or not path.is_file() or not path.resolve().is_relative_to(resolved):
            continue
        stat = path.stat()
        size += stat.st_size
        file_count += 1
        latest_mtime = max(latest_mtime, stat.st_mtime)
        if path.suffix != ".bin":
            continue
        metadata = read_json(path.with_suffix(".json"))
        try:
            result = normalize_metadata(metadata)["telemetry"]
            aprs = (result.get("payload") or {}).get("aprs") or {}
        except (ValueError, TypeError, AttributeError):
            result, aprs = {}, {}
        dates = artifact_dates("decoded", path, metadata, mtime=stat.st_mtime)
        member = path.relative_to(folder).as_posix()
        relative = f"{folder.name}/{member}"
        run = member.split("/")[0] if "/" in member else "legacy"
        summary = runs.setdefault(
            run,
            {
                "name": run,
                "packet_count": 0,
                "started_at": dates["captured_at"],
                "last_packet_at": dates["captured_at"],
            },
        )
        summary["packet_count"] += 1
        summary["started_at"] = min(summary["started_at"], dates["captured_at"])
        summary["last_packet_at"] = max(summary["last_packet_at"], dates["captured_at"])
        fixes = packet_positions(metadata, f"decoded:{relative}", dates["captured_at"])
        for fix in fixes:
            fix["_run"] = run
        positions.extend(fixes)
        # An object is reported by the station, but is not the station's location.
        station_packet = not aprs.get("object") and not aprs.get("item")
        if station_packet:
            for fix in fixes:
                if latest_position is None or fix["captured_at"] >= latest_position["captured_at"]:
                    latest_position = {
                        key: fix[key]
                        for key in ("latitude", "longitude", "altitude", "captured_at")
                    }
        if station_packet and aprs_source(result) == source:
            for key in ("status", "message", "weather", "telemetry", "comment"):
                if aprs.get(key) and (
                    key not in latest or dates["captured_at"] >= latest[key]["captured_at"]
                ):
                    latest[key] = {"captured_at": dates["captured_at"], "value": aprs[key]}
        frame = result.get("frame") or {}
        url = f"/decoded/{quote(relative)}"
        packets.append(
            {
                "type": "decoded",
                "filename": path.name,
                "name": path.stem,
                "path": relative,
                "url": url,
                "download_url": url,
                "size": stat.st_size,
                "run": run,
                "file_type": ".bin",
                "decoder_type": "APRS",
                "data_type": aprs.get("data_type", "unknown"),
                "data_type_identifier": aprs.get("data_type_identifier"),
                "destination_callsign": frame.get("destination"),
                "repeaters": frame.get("repeaters") or [],
                "payload_status": result.get("payload_status"),
                **dates,
            }
        )
    if not packets:
        return None
    packets.sort(key=lambda item: (item["captured_at"], item["path"]), reverse=True)
    return {
        "id": f"decoded_folder:{folder.name}",
        "type": "decoded_folder",
        "folder_kind": "aprs",
        "foldername": folder.name,
        "name": source,
        "display_name": source,
        "source_callsign": source,
        "decoder_type": "APRS",
        "protocol": "aprs",
        "packet_count": len(packets),
        "run_count": len(runs),
        "size": size,
        "file_count": file_count,
        "purge_bytes": size,
        "created": packets[-1]["captured_at"],
        "captured_at": packets[-1]["captured_at"],
        "captured_at_source": packets[-1]["captured_at_source"],
        "completed_at": None,
        "modified": datetime.fromtimestamp(latest_mtime, timezone.utc).isoformat(),
        "latest_activity": datetime.fromtimestamp(latest_mtime, timezone.utc).isoformat(),
        "last_packet_at": packets[0]["captured_at"],
        "url": f"/decoded/{quote(folder.name)}",
        "download_url": f"/api/decoded/{quote(folder.name)}/download",
        "runs": sorted(runs.values(), key=lambda item: item["started_at"], reverse=True),
        "latest_position": latest_position,
        "latest": latest,
        "_packets": packets,
        "_positions": positions,
        "_member_names": [p["path"].split("/", 1)[1] for p in packets],
    }
