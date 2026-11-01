"""Incrementally index ADS-B log tails; load full state only for an open page."""

import json
import uuid
from datetime import datetime, timezone
from urllib.parse import quote

from common.adsb import aircraft_position, number
from common.adsbstorage import aircraft_address


class AdsbFiles:
    def __init__(self):
        self.folders = {}

    def scan(self, folder):
        address = aircraft_address(folder.name.removeprefix("adsb_"))
        cache = self.folders.setdefault(str(folder), self._empty())
        files = [
            path
            for run in sorted(folder.glob("*.gsadsb"))
            if run.is_dir() and not run.is_symlink()
            for path in sorted(run.iterdir())
            if path.is_file() and not path.is_symlink()
        ]
        logs = [
            path for path in files if path.name.startswith("track_") and path.suffix == ".jsonl"
        ]
        states = cache["logs"]
        # A truncation/replacement/deletion invalidates offsets. Ordinary appends
        # keep all old offsets and read only the newly written complete lines.
        changed_layout = bool(set(states) - {str(path) for path in logs})
        for path in logs:
            stat = path.stat()
            previous = states.get(str(path))
            if previous and (previous["inode"] != stat.st_ino or stat.st_size < previous["offset"]):
                changed_layout = True
        if changed_layout:
            cache = self._empty()
            self.folders[str(folder)] = cache
            states = cache["logs"]
        initial = not cache["rows"]
        for path in logs:
            state = states.setdefault(str(path), {"inode": path.stat().st_ino, "offset": 0})
            with path.open("rb") as stream:
                stream.seek(state["offset"])
                while True:
                    offset = stream.tell()
                    line = stream.readline(262145)
                    if not line or not line.endswith(b"\n"):
                        break  # A writer may not have finished the last record.
                    state["offset"] = stream.tell()
                    if len(line) > 262144:
                        continue
                    try:
                        record = json.loads(line)
                        if record.get("icao") != address or number(record.get("timestamp")) is None:
                            continue
                        relative = path.relative_to(folder).as_posix()
                        row = {
                            "path": relative,
                            "offset": offset,
                            "timestamp": record["timestamp"],
                            "captured_at": record["captured_at"],
                            "run": path.parent.name,
                        }
                        cache["rows"].append(row)
                        cache["first"] = min(cache["first"], record["timestamp"])
                        cache["last"] = max(cache["last"], record["timestamp"])
                        run = cache["runs"].setdefault(
                            row["run"], {"name": row["run"], "packet_count": 0}
                        )
                        run["packet_count"] += 1
                        if record["timestamp"] >= cache["latest"].get("timestamp", 0):
                            cache["latest"] = record
                        point = aircraft_position(record, f"adsb:{folder.name}/{relative}:{offset}")
                        if point:
                            # Full readsb reports belong in the log, not at every
                            # point of a potentially twelve-hour in-memory track.
                            point["_details"] = {
                                "telemetry": {
                                    key: record.get(key)
                                    for key in (
                                        "icao",
                                        "callsign",
                                        "squawk",
                                        "emergency",
                                        "groundspeed_mps",
                                        "vertical_rate_mps",
                                        "on_ground",
                                    )
                                }
                            }
                            cache["positions"].append(point)
                    except (ValueError, TypeError, KeyError, AttributeError):
                        continue
        rows = cache["rows"]
        if initial:
            # Receiver files can cover overlapping periods. At startup, merge
            # their complete histories before issuing append-only cursors.
            rows.sort(key=lambda row: (row["timestamp"], row["path"], row["offset"]))
        if not rows:
            return None
        latest = cache["latest"]
        first, last, runs = cache["first"], cache["last"], cache["runs"]

        def iso(stamp):
            return datetime.fromtimestamp(stamp, timezone.utc).isoformat(timespec="microseconds")

        return {
            "id": f"decoded_folder:{folder.name}",
            "type": "decoded_folder",
            "folder_kind": "adsb",
            "foldername": folder.name,
            "name": address.upper(),
            "display_name": address.upper(),
            "icao": address,
            "callsign": latest.get("callsign"),
            "decoder_type": "ADSB",
            "packet_count": len(rows),
            "run_count": len(runs),
            "runs": list(runs.values()),
            "size": sum(path.stat().st_size for path in files),
            "file_count": len(files),
            "purge_bytes": sum(path.stat().st_size for path in files),
            "created": iso(folder.stat().st_ctime),
            "captured_at": iso(first),
            "captured_at_source": "reception",
            "modified": iso(last),
            "latest_activity": iso(last),
            "last_packet_at": iso(last),
            "completed_at": None,
            "url": f"/decoded/{quote(folder.name)}",
            "download_url": f"/api/decoded/{quote(folder.name)}/download",
            "_positions": cache["positions"],
            "_adsb_rows": rows,
            "_latest": latest,
            "_adsb_generation": cache["generation"],
            "_member_names": [path.relative_to(folder).as_posix() for path in files],
        }

    @staticmethod
    def _empty():
        return {
            "generation": uuid.uuid4().hex,
            "logs": {},
            "rows": [],
            "positions": [],
            "latest": {},
            "first": float("inf"),
            "last": 0,
            "runs": {},
        }

    @staticmethod
    def records(folder, rows):
        records = []
        for row in rows:
            path = folder / row["path"]
            if path.is_symlink() or not path.resolve().is_relative_to(folder.resolve()):
                continue
            try:
                with path.open("rb") as stream:
                    stream.seek(row["offset"])
                    record = json.loads(stream.readline(262145))
                records.append(record)
            except (OSError, ValueError):
                continue
        return records
