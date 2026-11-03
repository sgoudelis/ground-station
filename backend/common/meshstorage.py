"""Meshtastic node folders and shared twelve-hour capture windows."""

import fcntl
import json
import math
import os
import re
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

from common.pathguard import ensure_path_in_allowed_roots

WINDOW_SECONDS = 12 * 60 * 60
RUN_SUFFIX = ".gsmesh"
NODE = re.compile(r"^![0-9a-f]{8}$")


def mesh_source(result):
    if not isinstance(result, dict) or result.get("parser_id") != "meshtastic":
        return None
    source = ((result.get("headers") or {}).get("meshtastic") or {}).get("source")
    if not isinstance(source, str) or not NODE.fullmatch(source.lower()):
        return None
    return source.lower()


def mesh_values(result):
    values: dict[str, Any] = {}
    payload = result.get("payload") or {}
    if not isinstance(payload, dict):
        return values
    for record in payload.get("records", []):
        for group in record.get("groups", []):
            values.update(group.get("values") or {})
    return values


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
        if 0 < started - timestamp <= 10:
            delayed = path
    return delayed


def write_json(path, data, *, mode=None, times=None):
    """Publish complete JSON atomically, retaining capture dates on migration."""
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", dir=path.parent, delete=False) as stream:
            temporary = Path(stream.name)
            json.dump(data, stream, indent=2, allow_nan=False)
        if mode is not None:
            temporary.chmod(mode)
        if times is not None:
            os.utime(temporary, ns=times)
        temporary.replace(path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


class MeshStorage:
    def __init__(self, root):
        self.root = Path(root)

    def directory(self, source, timestamp):
        if not isinstance(source, str) or not NODE.fullmatch(source):
            raise ValueError("Invalid Meshtastic sender ID")
        if not math.isfinite(timestamp):
            raise ValueError("Invalid capture time")
        folder = ensure_path_in_allowed_roots(self.root / f"meshtastic_{source[1:]}", [self.root])
        folder.mkdir(parents=True, exist_ok=True)
        descriptor = os.open(folder, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            # VFOs and browser sessions share the original reception window.
            fcntl.flock(descriptor, fcntl.LOCK_EX)
            previous = select_run(
                (p for p in folder.glob(f"*{RUN_SUFFIX}") if p.is_dir()), timestamp
            )
            if previous is not None:
                return previous
            started_at = datetime.fromtimestamp(timestamp, timezone.utc)
            path = folder / (started_at.strftime("%Y%m%dT%H%M%S.%fZ") + RUN_SUFFIX)
            path.mkdir(exist_ok=True)
            write_json(
                path / "run.json",
                {
                    "schema_version": 1,
                    "node_id": source,
                    "started_at": started_at.isoformat(),
                    "window_seconds": WINDOW_SECONDS,
                },
            )
            return path
        finally:
            os.close(descriptor)

    def update_node(self, directory, result, timestamp):
        folder = directory.parent
        descriptor = os.open(folder, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX)
            path = ensure_path_in_allowed_roots(folder / "node.json", [self.root])
            try:
                node = json.loads(path.read_text())
            except FileNotFoundError:
                node = {"schema_version": 1, "node_id": mesh_source(result)}
            node["first_received"] = min(node.get("first_received", timestamp), timestamp)
            node["last_received"] = max(node.get("last_received", timestamp), timestamp)
            values = mesh_values(result)
            if result.get("payload_status") == "decoded" and timestamp >= node.get(
                "node_info_time", 0
            ):
                info = {
                    key: values[key]
                    for key in ("long_name", "short_name", "hw_model", "role")
                    if key in values
                }
                if info:
                    node.update(info)
                    node["node_info_time"] = timestamp
            write_json(path, node)
        finally:
            os.close(descriptor)

    def group(self, packet, metadata):
        """Relocate an already preserved binary after its sender is decoded."""
        result = metadata.get("telemetry") or {}
        source = mesh_source(result)
        if source is None:
            return packet
        timestamp = metadata["packet"]["timestamp"]
        directory = self.directory(source, timestamp)
        target = directory / packet.name
        # A colliding filename must never overwrite another receiver's capture.
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
            self.update_node(directory, result, timestamp)
            packet.unlink()
        except Exception:
            target.unlink()
            raise
        metadata.setdefault("file", {}).update(binary=target.name, binary_path=str(target))
        return target
