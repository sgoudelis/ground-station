"""APRS station identities and shared twelve-hour packet capture windows."""

import fcntl
import json
import math
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from common.pathguard import ensure_path_in_allowed_roots

WINDOW_SECONDS = 12 * 60 * 60
RUN_SUFFIX = ".gsaprs"
CALLSIGN = re.compile(r"^[A-Z0-9]{1,6}-(?:[0-9]|1[0-5])$")


def aprs_source(result):
    """Use the validated envelope, including packets with unsupported payloads."""
    if not isinstance(result, dict) or result.get("success") is not True:
        return None
    if result.get("envelope_status") != "parsed" or result.get("parser_id") != "aprs":
        return None
    source = (result.get("frame") or {}).get("source")
    if not isinstance(source, str) or not CALLSIGN.fullmatch(source):
        return None
    return source


def select_run(paths, timestamp):
    delayed = None
    for path in sorted(paths):
        if path.is_symlink():
            continue
        try:
            started = (
                datetime.strptime(path.name.removesuffix(RUN_SUFFIX), "%Y%m%dT%H%M%S.%fZ")
                .replace(tzinfo=timezone.utc)
                .timestamp()
            )
        except ValueError:
            continue
        if 0 <= timestamp - started < WINDOW_SECONDS:
            return path
        # Concurrent VFO callbacks can arrive slightly out of reception order.
        # Prefer an exact older window before allowing this startup tolerance.
        if 0 < started - timestamp <= 10:
            delayed = path
    return delayed


class AprsStorage:
    def __init__(self, root):
        self.root = Path(root)

    def directory(self, source, timestamp):
        if not isinstance(source, str) or not CALLSIGN.fullmatch(source):
            raise ValueError("Invalid APRS source callsign and SSID")
        if isinstance(timestamp, bool) or not math.isfinite(timestamp):
            raise ValueError("Invalid capture time")
        folder = ensure_path_in_allowed_roots(self.root / f"aprs_{source}", [self.root])
        folder.mkdir(parents=True, exist_ok=True)
        descriptor = os.open(folder, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            # Lock the station so every receiver agrees on the original anchor.
            fcntl.flock(descriptor, fcntl.LOCK_EX)
            previous = select_run(
                (path for path in folder.glob(f"*{RUN_SUFFIX}") if path.is_dir()), timestamp
            )
            if previous is not None:
                return ensure_path_in_allowed_roots(previous, [self.root])
            started = datetime.fromtimestamp(timestamp, timezone.utc)
            path = folder / (started.strftime("%Y%m%dT%H%M%S.%fZ") + RUN_SUFFIX)
            path.mkdir(exist_ok=True)
            marker = ensure_path_in_allowed_roots(path / "run.json", [self.root])
            with marker.open("x") as stream:
                json.dump(
                    {
                        "schema_version": 1,
                        "source_callsign": source,
                        "started_at": started.isoformat(),
                        "window_seconds": WINDOW_SECONDS,
                    },
                    stream,
                    indent=2,
                )
            return path
        finally:
            os.close(descriptor)

    def group(self, packet, metadata):
        source = aprs_source(metadata.get("telemetry"))
        if source is None:
            return packet
        directory = self.directory(source, metadata["packet"]["timestamp"])
        target = directory / packet.name
        # Never merge identical RF receptions or overwrite another receiver.
        while True:
            if target.with_suffix(".json").exists():
                target = directory / f"{packet.stem}_{uuid4().hex[:12]}{packet.suffix}"
                continue
            try:
                os.link(packet, target)
                break
            except FileExistsError:
                target = directory / f"{packet.stem}_{uuid4().hex[:12]}{packet.suffix}"
        try:
            packet.unlink()
        except Exception:
            target.unlink()
            raise
        metadata.setdefault("file", {}).update(binary=target.name, binary_path=str(target))
        return target
