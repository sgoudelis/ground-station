"""Aircraft capture windows and buffered, receiver-owned append-only logs."""

import fcntl
import json
import os
import re
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

from common.pathguard import ensure_path_in_allowed_roots

WINDOW_SECONDS = 12 * 60 * 60
RUN_SUFFIX = ".gsadsb"
ICAO = re.compile(r"^[0-9a-f]{6}$")


def aircraft_address(value):
    address = str(value).lower()
    if not ICAO.fullmatch(address):
        raise ValueError("ADS-B requires a six-digit ICAO hexadecimal address")
    return address


class AdsbStorage:
    def __init__(self, root, receiver_id):
        self.root = Path(root)
        self.receiver_id = receiver_id
        self.runs = {}
        self.pending = defaultdict(list)
        self.pending_bytes = 0
        self.dirty = set()

    def directory(self, address, timestamp):
        address = aircraft_address(address)
        cached = self.runs.get(address)
        if cached:
            path, started = cached
            if 0 <= timestamp - started < WINDOW_SECONDS and path.is_dir():
                return ensure_path_in_allowed_roots(path, [self.root])
        folder = ensure_path_in_allowed_roots(self.root / f"adsb_{address}", [self.root])
        folder.mkdir(parents=True, exist_ok=True)
        descriptor = os.open(folder, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            # As with sondes, sessions and VFOs share the first packet's window.
            fcntl.flock(descriptor, fcntl.LOCK_EX)
            delayed = None
            for path in sorted(folder.glob(f"*{RUN_SUFFIX}")):
                if path.is_symlink() or not path.is_dir():
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
                    self.runs[address] = path, started
                    return path
                if 0 < started - timestamp <= 10:
                    delayed = path, started
            # A snapshot can report reception just before the raw frame was
            # emitted, or arrive behind another VFO's first report. Keep that
            # small startup delay in one run, preferring an exact older window
            # above when a record arrives across the twelve-hour boundary.
            if delayed:
                self.runs[address] = delayed
                return delayed[0]
            started_at = datetime.fromtimestamp(timestamp, timezone.utc)
            path = folder / (started_at.strftime("%Y%m%dT%H%M%S.%fZ") + RUN_SUFFIX)
            path.mkdir(exist_ok=True)
            with (path / "run.json").open("x") as marker:
                json.dump(
                    {
                        "schema_version": 1,
                        "icao": address,
                        "started_at": started_at.isoformat(),
                        "window_seconds": WINDOW_SECONDS,
                    },
                    marker,
                    indent=2,
                )
            self.runs[address] = path, timestamp
            return path
        finally:
            os.close(descriptor)

    def append(self, kind, record):
        if kind not in {"track", "messages"}:
            raise ValueError("Unknown ADS-B log type")
        path = self.directory(record["icao"], record["timestamp"])
        logfile = path / f"{kind}_{self.receiver_id}.jsonl"
        line = json.dumps(record, allow_nan=False, separators=(",", ":")) + "\n"
        self.pending[logfile].append(line)
        self.pending_bytes += len(line)
        # Optional raw capture can greatly exceed the snapshot rate. Bound its
        # write buffer even while a large IQ chunk is being drained.
        if self.pending_bytes >= 1_048_576:
            self.flush()

    def flush(self):
        # The worker flushes once a second. No high-rate raw-message events cross
        # the multiprocessing queue or the browser socket.
        for path, lines in list(self.pending.items()):
            ensure_path_in_allowed_roots(path, [self.root])
            with path.open("a") as stream:
                stream.writelines(lines)
            self.dirty.add(path.parent.parent.name)
            del self.pending[path]
        self.pending_bytes = 0

    def take_dirty(self):
        folders = sorted(self.dirty)
        self.dirty.clear()
        return folders
