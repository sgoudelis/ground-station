"""Group sonde captures by device and fixed windows starting at the first packet."""

import fcntl
import json
import os
from datetime import datetime, timezone
from pathlib import Path

from common.artifactdates import parse_artifact_time
from common.filenames import radiosonde_folder_name
from common.pathguard import ensure_path_in_allowed_roots

# Approximate a flight with a fixed window, never extended by later packets.
RUN_WINDOW_SECONDS = 12 * 60 * 60
RUN_SUFFIX = ".gssonde"


def run_name(timestamp: float) -> str:
    return (
        datetime.fromtimestamp(timestamp, timezone.utc).strftime("%Y%m%dT%H%M%S.%fZ") + RUN_SUFFIX
    )


def run_start(path: Path) -> float | None:
    """Recover the original anchor, independent of filesystem modification times."""
    marker = path / "run.json"
    if marker.is_symlink():
        return None
    try:
        details = json.loads(marker.read_text())
        if isinstance(details, dict):
            started: datetime | None = parse_artifact_time(details.get("started_at"))
            if started is not None:
                return started.timestamp()
    except (OSError, ValueError):
        pass
    # Earlier migrations stored the folder name in started_at. The UTC name
    # also lets another worker find a newly created run before its marker exists.
    name = path.name.removesuffix(RUN_SUFFIX)
    for pattern in ("%Y%m%dT%H%M%S.%fZ", "%Y%m%dT%H%M%SZ"):
        try:
            return datetime.strptime(name, pattern).replace(tzinfo=timezone.utc).timestamp()
        except ValueError:
            pass
    return None


class SondeStorage:
    def __init__(self, root: str, session_id: str, vfo: int | None):
        self.root = Path(root)
        self.session_id = session_id
        self.vfo = vfo
        self.runs: dict[tuple[str, str], tuple[Path, float]] = {}

    def packet_directory(self, model: str, serial: str, timestamp: float) -> Path:
        identity = (model, serial)
        previous = self.runs.get(identity)
        if previous is not None:
            path, started_at = previous
            if 0 <= timestamp - started_at < RUN_WINDOW_SECONDS and path.is_dir():
                ensure_path_in_allowed_roots(path, [self.root])
                return path
        folder: Path = ensure_path_in_allowed_roots(
            self.root / radiosonde_folder_name(model, serial), [self.root]
        )
        folder.mkdir(parents=True, exist_ok=True)
        # Lock the directory itself so simultaneous decoder workers agree on
        # the first packet's window without adding lock files to the library.
        descriptor = os.open(folder, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX)
            return self._recover_or_create(folder, model, serial, timestamp)
        finally:
            os.close(descriptor)

    def _recover_or_create(self, folder: Path, model: str, serial: str, timestamp: float) -> Path:
        identity = (model, serial)
        # Sessions/VFOs describe individual packets, not flights. Scan again
        # after cache expiry: another worker may already have opened the next run.
        for candidate in sorted(folder.iterdir()):
            if candidate.is_symlink() or not candidate.is_dir():
                continue
            started_at = run_start(candidate)
            if started_at is not None and 0 <= timestamp - started_at < RUN_WINDOW_SECONDS:
                self.runs[identity] = (candidate, started_at)
                return candidate
        started = datetime.fromtimestamp(timestamp, timezone.utc)
        path: Path = ensure_path_in_allowed_roots(folder / run_name(timestamp), [self.root])
        path.mkdir(exist_ok=True)
        # Preserve an existing marker, including any original provenance.
        try:
            marker = (path / "run.json").open("x")
        except FileExistsError:
            self.runs[identity] = (path, timestamp)
            return path
        with marker:
            json.dump(
                {
                    "model": model,
                    "serial": serial,
                    "session_id": self.session_id,
                    "vfo": self.vfo,
                    "started_at": started.isoformat(),
                    "window_seconds": RUN_WINDOW_SECONDS,
                },
                marker,
                indent=2,
            )
        self.runs[identity] = (path, timestamp)
        return path
