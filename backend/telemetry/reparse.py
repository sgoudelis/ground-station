# Copyright (c) 2026 Efstratios Goudelis
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU General Public License for more details.
#
# You should have received a copy of the GNU General Public License
# along with this program. If not, see <https://www.gnu.org/licenses/>.

"""Decode saved packets for viewing or explicitly refreshing their metadata."""

import json
import os
import stat
import tempfile
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlsplit

from .compatibility import normalize_metadata
from .context import ParseContext
from .service import parse_packet


def _load_packet(backend_dir: Path, url: str) -> tuple[Path, dict[str, Any]]:
    """Resolve a decoded artifact and load its metadata for either operation."""
    address = urlsplit(url)
    if address.scheme or address.netloc:
        raise ValueError("Expected a local decoded packet URL")
    parts = unquote(address.path).split("/")
    # Only standalone decoded packets and decoded observation artifacts qualify.
    if len(parts) == 3 and parts[:2] == ["", "decoded"]:
        mount = "decoded"
    elif (
        len(parts) == 5
        and parts[:2] == ["", "observations"]
        and parts[2].endswith(".gsobs")
        and parts[3] == "decoded"
    ):
        mount = "observations"
    else:
        raise ValueError("Expected a decoded packet URL")
    root = (backend_dir / "data" / mount).resolve()
    packet = root.joinpath(*parts[2:]).resolve()
    if not packet.is_relative_to(root) or packet.suffix != ".bin":
        raise ValueError("Invalid decoded packet path")
    metadata_path = packet.with_suffix(".json")
    if metadata_path.is_symlink():
        raise ValueError("Packet metadata must not be a symbolic link")
    metadata = json.loads(metadata_path.read_text())
    if not isinstance(metadata, dict):
        raise ValueError("Packet metadata must be an object")
    return packet, metadata


def _decode_packet(packet: Path, metadata: dict[str, Any]) -> dict[str, Any]:
    """Use the same framing hints and parser as live decoding, without writes."""
    return parse_packet(packet.read_bytes(), ParseContext.from_metadata(metadata))


def view_packet(backend_dir: Path, url: str) -> dict[str, Any]:
    """Normalize saved metadata for every viewer without rewriting a capture."""
    packet, metadata = _load_packet(backend_dir, url)
    normalized = normalize_metadata(metadata)
    saved = normalized["telemetry"]
    # Unsupported captures can benefit from a new parser regardless of schema
    # version. Existing measurements keep their saved interpretation until reparse.
    if saved["payload_status"] == "unsupported":
        try:
            normalized["telemetry"] = _decode_packet(packet, metadata)
        except ValueError:
            # Context-free historical files still have their normalized values
            # and bytes available; viewing must not require speculative routing.
            pass
    return normalized


def preview_packet(backend_dir: Path, url: str) -> dict[str, Any]:
    """Decode for display without changing the binary, metadata or library.

    Failed frame decodes are returned too: the viewer needs their explanation
    instead of silently showing an empty Telemetry tab.
    """
    packet, metadata = _load_packet(backend_dir, url)
    metadata["telemetry"] = _decode_packet(packet, metadata)
    return metadata


def reparse_packet(backend_dir: Path, url: str) -> dict[str, Any]:
    """Refresh one decoded packet's JSON metadata file, replacing it atomically."""
    packet, metadata = _load_packet(backend_dir, url)
    parsed = _decode_packet(packet, metadata)
    failed_records = any(
        record["status"] in {"malformed", "error"} for record in parsed["payload"]["records"]
    )
    previous = normalize_metadata(metadata)["telemetry"]
    # A partially supported reparse must not quietly erase a previously decoded
    # subsystem. Record identity stays stable for the same packet bytes.
    records = {record["id"]: record for record in parsed["payload"]["records"]}
    lost_values = previous["payload_status"] in {"decoded", "partial"} and parsed[
        "payload_status"
    ] in {"unsupported", "non_telemetry"}
    for record in previous["payload"]["records"]:
        if record["status"] == "decoded" and any(group["values"] for group in record["groups"]):
            updated = records.get(record["id"])
            if (
                not updated
                or updated["status"] != "decoded"
                or not any(group["values"] for group in updated["groups"])
            ):
                lost_values = True
    if (
        not parsed.get("success")
        or parsed["payload_status"] in {"malformed", "error"}
        or failed_records
        or lost_values
    ):
        diagnostics = parsed.get("diagnostics") or []
        message = parsed.get("error") or next(
            (item.get("message") for item in diagnostics if item.get("message")), None
        )
        raise ValueError(message or "Packet could not be parsed; saved telemetry was preserved")
    metadata["telemetry"] = parsed
    metadata_path = packet.with_suffix(".json")

    # Readers must see either the complete old metadata or the complete new one.
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w", dir=metadata_path.parent, delete=False
        ) as output:
            temporary = Path(output.name)
            json.dump(metadata, output, indent=2, allow_nan=False)
        temporary.chmod(stat.S_IMODE(metadata_path.stat().st_mode))
        os.replace(temporary, metadata_path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
    return metadata
