# Copyright (c) 2026 Efstratios Goudelis

"""Portable artifact chronology, independent of local filesystem creation times."""

import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# Observation bundle names have always used UTC, including retry suffixes.
# Other legacy filenames use the producer's local timezone, which may differ
# from this machine. Do not guess that timezone when importing those files.
_BUNDLE_DATE = re.compile(r"_(\d{8}_\d{6})(?:_[A-Za-z0-9-]+)*(?:\.gsobs)$")


def parse_artifact_time(value: Any) -> datetime | None:
    """Accept epoch seconds or timezone-aware ISO dates; reject ambiguous dates."""
    try:
        if isinstance(value, bool):
            return None
        if isinstance(value, (int, float)):
            return datetime.fromtimestamp(value, timezone.utc)
        if not isinstance(value, str):
            return None
        parsed = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
        if parsed.tzinfo is not None:
            return parsed.astimezone(timezone.utc)
    except (ValueError, OverflowError, OSError):
        pass
    return None


def transcription_end(path: Path) -> str | None:
    """Read the completion footer without loading a potentially large transcript."""
    try:
        with path.open("rb") as stream:
            stream.seek(0, 2)
            stream.seek(max(0, stream.tell() - 4096))
            lines = stream.read().decode("utf-8", errors="replace").splitlines()
        for line in reversed(lines):
            if line.startswith("# Ended:"):
                return line.split(":", 1)[1].strip()
    except OSError:
        pass
    return None


def folder_content_mtime(folder: Path) -> float:
    """Directory entry times do not track writes to existing nested artifacts."""
    return max(
        (
            path.stat().st_mtime
            for path in folder.rglob("*")
            if not path.is_symlink() and path.is_file()
        ),
        default=folder.stat().st_mtime,
    )


def artifact_dates(
    kind: str, path: Path, metadata: Any = None, *, mtime: float | None = None
) -> dict[str, Any]:
    """Resolve capture/completion dates without changing filesystem date semantics."""
    if metadata is None and kind == "snapshot":
        # Legacy snapshot listings do not otherwise read the optional sidecar.
        try:
            metadata = json.loads(path.with_suffix(".json").read_text())
        except (OSError, UnicodeError, ValueError):
            pass
    meta = metadata if isinstance(metadata, dict) else {}
    starts: tuple[Any, ...] = ()
    ends: tuple[Any, ...] = ()
    if kind == "observation":
        # The nested scheduler row's created_at is when the job was scheduled,
        # not when this observation ran. Only use the bundle's own lifecycle.
        starts = (meta.get("created_at"),)
        ends = (meta.get("finalized_at"),)
    elif kind == "recording":
        starts = (meta.get("start_time"), meta.get("capture_time"))
        ends = (meta.get("finalized_time"),)
    elif kind == "audio":
        starts = (meta.get("start_time"),)
        ends = (meta.get("end_time"),)
    elif kind == "transcription":
        starts = (meta.get("started"),)
        ends = (meta.get("ended"),)
    elif kind == "decoded":
        packet = meta.get("packet")
        image = meta.get("image")
        starts = tuple(
            section.get(key)
            for section in (packet, image)
            if isinstance(section, dict)
            for key in ("timestamp", "timestamp_iso")
        )
    elif kind == "decoded_folder":
        starts = (meta.get("timestamp"),)
    elif kind == "snapshot":
        starts = (meta.get("captured_at"),)

    captured = next((parsed for value in starts if (parsed := parse_artifact_time(value))), None)
    source = "metadata"
    if captured is None and kind == "observation":
        match = _BUNDLE_DATE.search(path.name)
        if match:
            try:
                captured = datetime.strptime(match[1], "%Y%m%d_%H%M%S").replace(tzinfo=timezone.utc)
                source = "filename"
            except ValueError:
                pass
    if captured is None:
        captured = datetime.fromtimestamp(
            path.stat().st_mtime if mtime is None else mtime, timezone.utc
        )
        source = "filesystem"

    completed = next((parsed for value in ends if (parsed := parse_artifact_time(value))), None)
    # Missing or invalid completion dates remain unknown, rather than silently
    # substituting a copy time or presenting an active recording as completed.
    if (
        meta.get("recording_in_progress")
        or meta.get("in_progress")
        or meta.get("status") == "recording"
    ):
        completed = None
    return {
        "captured_at": captured.isoformat(timespec="microseconds"),
        "captured_at_source": source,
        "completed_at": completed.isoformat(timespec="microseconds") if completed else None,
    }
