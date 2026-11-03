"""Browse per-node Meshtastic captures while retaining per-packet map fixes."""

import json
from pathlib import Path
from typing import Any
from urllib.parse import quote

from common.artifactdates import artifact_dates
from common.meshstorage import NODE, mesh_values
from library.positions import packet_positions


def read_json(path):
    if path.is_symlink():
        return {}
    try:
        value = json.loads(path.read_text())
        return value if isinstance(value, dict) else {}
    except (OSError, ValueError):
        return {}


def scan_mesh(folder: Path):
    source = "!" + folder.name.removeprefix("meshtastic_")
    if not NODE.fullmatch(source):
        return None
    node = read_json(folder / "node.json")
    packets, positions = [], []
    runs: dict[str, dict[str, Any]] = {}
    size = file_count = 0
    latest_position = None
    latest_telemetry = None
    latest_info_time = node.get("node_info_time", 0)
    for path in sorted(folder.rglob("*")):
        if (
            path.is_symlink()
            or not path.is_file()
            or not path.resolve().is_relative_to(folder.resolve())
        ):
            continue
        stat = path.stat()
        size += stat.st_size
        file_count += 1
        if path.suffix != ".bin":
            continue
        metadata = read_json(path.with_suffix(".json"))
        result = metadata.get("telemetry") or {}
        if not isinstance(result, dict):
            result = {}
        dates = artifact_dates("decoded", path, metadata, mtime=stat.st_mtime)
        values = mesh_values(result)
        stamp = (metadata.get("packet") or {}).get("timestamp", 0)
        if (
            result.get("payload_status") == "decoded"
            and isinstance(stamp, (int, float))
            and stamp >= latest_info_time
        ):
            info = {
                key: values[key]
                for key in ("long_name", "short_name", "hw_model", "role")
                if key in values
            }
            if info:
                node.update(info)
                latest_info_time = stamp
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
        positions.extend(fixes)
        for fix in fixes:
            if latest_position is None or fix["captured_at"] >= latest_position["captured_at"]:
                latest_position = {
                    key: fix[key] for key in ("latitude", "longitude", "altitude", "captured_at")
                }
        if values.get("application") == "Telemetry" and result.get("payload_status") == "decoded":
            if latest_telemetry is None or dates["captured_at"] >= latest_telemetry["captured_at"]:
                latest_telemetry = {
                    "captured_at": dates["captured_at"],
                    "values": values,
                    "field_info": (result.get("telemetry") or {}).get("field_info") or {},
                }
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
                "decoder_type": "LORA",
                "application": values.get("application") or "Encrypted / unknown",
                "payload_status": result.get("payload_status"),
                **dates,
            }
        )
    if not packets:
        return None
    packets.sort(key=lambda item: (item["captured_at"], item["path"]), reverse=True)
    label = node.get("long_name") or node.get("short_name")
    name = f"{label} ({source})" if label else source
    # Names enrich display only; every fix retains the stable sender ID.
    for point in positions:
        point["name"] = name
    return {
        "id": f"decoded_folder:{folder.name}",
        "type": "decoded_folder",
        "folder_kind": "meshtastic",
        "foldername": folder.name,
        "name": name,
        "display_name": name,
        "node_id": source,
        **{
            key: node[key] for key in ("long_name", "short_name", "hw_model", "role") if key in node
        },
        "decoder_type": "LORA",
        "protocol": "meshtastic",
        "packet_count": len(packets),
        "run_count": len(runs),
        "size": size,
        "file_count": file_count,
        "purge_bytes": size,
        "created": packets[-1]["captured_at"],
        "captured_at": packets[-1]["captured_at"],
        "captured_at_source": packets[-1]["captured_at_source"],
        "completed_at": None,
        "modified": packets[0]["captured_at"],
        "latest_activity": packets[0]["captured_at"],
        "last_packet_at": packets[0]["captured_at"],
        "url": f"/decoded/{quote(folder.name)}",
        "download_url": f"/api/decoded/{quote(folder.name)}/download",
        "runs": sorted(runs.values(), key=lambda item: item["started_at"], reverse=True),
        "latest_position": latest_position,
        "latest_telemetry": latest_telemetry,
        "_packets": packets,
        "_positions": positions,
        "_member_names": [p["path"].split("/", 1)[1] for p in packets],
    }
