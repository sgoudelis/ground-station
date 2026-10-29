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

from telemetry.parser import TelemetryParser


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
    config = metadata.get("decoder_config") or {}
    previous = metadata.get("telemetry") or {}
    decoder = metadata.get("decoder") or {}
    satellite = metadata.get("satellite") or {}
    if not all(isinstance(section, dict) for section in (config, previous, decoder, satellite)):
        raise ValueError("Invalid packet decoding metadata")
    framing = config.get("framing")
    if framing is not None and not isinstance(framing, str):
        raise ValueError("Invalid packet framing")
    protocol = (
        config.get("payload_protocol")
        or {
            "lora": "lora",
            "ax25": "ax25",
            "usp": "ax25",
            "aprs": "ax25",
            "geoscan": "proprietary",
            "ax100_rs": "csp",
            "ax100_asm": "csp",
            "doka": "ccsds",
        }.get(framing or "")
        or previous.get("protocol")
    )
    if decoder.get("type") == "lora":
        protocol = "lora"
    if not isinstance(protocol, str) or protocol not in {
        "lora",
        "ax25",
        "proprietary",
        "csp",
        "ccsds",
    }:
        raise ValueError("Packet metadata does not identify a supported payload protocol")
    satellite_name = satellite.get("name")
    if satellite_name is not None and not isinstance(satellite_name, str):
        raise ValueError("Invalid packet satellite name")
    framing_params = config.get("framing_params") or {}
    geoscan = config.get("geoscan") or {}
    if not isinstance(framing_params, dict) or not isinstance(geoscan, dict):
        raise ValueError("Invalid packet framing parameters")
    payload = packet.read_bytes()
    # Match the live decoder: HDLC flags are framing bytes only outside LoRa.
    if protocol != "lora":
        payload = payload.removeprefix(b"\x7e").removesuffix(b"\x7e")
    frame_size = (
        config.get("frame_size") or framing_params.get("frame_size") or geoscan.get("frame_size")
    )
    parsed: dict[str, Any] = TelemetryParser().parse(
        payload,
        protocol_hint=protocol,
        sat_hint=satellite_name,
        parser_hint={"framing": framing, "frame_size": frame_size},
    )
    return parsed


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
    if not parsed.get("success"):
        raise ValueError(parsed.get("error") or "Packet could not be parsed")
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
