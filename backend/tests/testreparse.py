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

"""Saved-packet preview and reparsing preserve captures and confine writes."""

import json
import logging
import stat
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock
from urllib.parse import quote

import pytest

from handlers.entities import telemetry as handler
from telemetry import reparse

pytestmark = pytest.mark.unit
CAPTURE = json.loads((Path(__file__).parent / "fixtures" / "tianqi.json").read_text())
LASARSAT = json.loads((Path(__file__).parent / "fixtures" / "lasarsat.json").read_text())


def saved_packet(root, relative="decoded/fleet packet.bin"):
    path = root / "data" / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    captured = bytes.fromhex(next(iter(CAPTURE.values()))["packet_hex"])
    # LoRa application bytes may contain an HDLC flag and must remain intact.
    path.write_bytes(captured[:-1] + b"\x7e")
    metadata = {
        "decoder": {"type": "lora"},
        "decoder_config": {"framing": "lora", "payload_protocol": "lora"},
        "satellite": {"name": "Tianqi-39"},
        "packet": {"timestamp": 1793196461, "number": 27},
        "signal": {"frequency_hz": 400000000},
        "telemetry": {"parser": "lora", "protocol": "lora", "telemetry": {"format": "raw"}},
    }
    path.with_suffix(".json").write_text(json.dumps(metadata))
    return path, metadata


@pytest.mark.parametrize(
    "relative",
    [
        "decoded/fleet packet.bin",
        "observations/Tianqi.gsobs/decoded/fleet packet.bin",
    ],
)
def test_reparse_updates_only_telemetry_and_preserves_binary_and_permissions(tmp_path, relative):
    packet, before = saved_packet(tmp_path, relative)
    binary = packet.read_bytes()
    metadata_path = packet.with_suffix(".json")
    metadata_path.chmod(0o640)
    result = reparse.reparse_packet(tmp_path, "/" + quote(relative))
    assert json.loads(metadata_path.read_text()) == result
    assert result["telemetry"]["parser"] == "lora+TianqiParser"
    assert result["telemetry"]["raw"]["packet_hex"] == binary.hex()
    assert result["telemetry"]["telemetry"]["time_utc"]
    assert {key: value for key, value in result.items() if key != "telemetry"} == {
        key: value for key, value in before.items() if key != "telemetry"
    }
    assert packet.read_bytes() == binary
    assert stat.S_IMODE(metadata_path.stat().st_mode) == 0o640


@pytest.mark.parametrize("decode", [reparse.reparse_packet, reparse.preview_packet])
@pytest.mark.parametrize(
    "url",
    [
        "https://example.com/decoded/packet.bin",
        "/decoded/../packet.bin",
        "/decoded/%2e%2e%2fpacket.bin",
        "/observations/../decoded/packet.bin",
        "/recordings/packet.bin",
        "/decoded/packet.json",
    ],
)
def test_reparse_rejects_external_or_unrelated_paths(tmp_path, url, decode):
    with pytest.raises(ValueError):
        decode(tmp_path, url)


@pytest.mark.parametrize("decode", [reparse.reparse_packet, reparse.preview_packet])
def test_reparse_rejects_symlink_escape_and_metadata_symlink(tmp_path, decode):
    packet, _ = saved_packet(tmp_path)
    outside = tmp_path / "outside.bin"
    outside.write_bytes(packet.read_bytes())
    link = packet.parent / "escape.bin"
    link.symlink_to(outside)
    with pytest.raises(ValueError, match="path"):
        decode(tmp_path, "/decoded/escape.bin")
    metadata_path = packet.with_suffix(".json")
    elsewhere = tmp_path / "outside.json"
    metadata_path.rename(elsewhere)
    metadata_path.symlink_to(elsewhere)
    with pytest.raises(ValueError, match="symbolic link"):
        decode(tmp_path, "/decoded/fleet%20packet.bin")


def test_failed_replace_keeps_original_metadata_and_removes_temporary_file(tmp_path, monkeypatch):
    packet, _ = saved_packet(tmp_path)
    original = packet.with_suffix(".json").read_bytes()

    def fail_replace(*_args):
        raise OSError("Disk failure")

    monkeypatch.setattr(reparse.os, "replace", fail_replace)
    with pytest.raises(OSError, match="Disk failure"):
        reparse.reparse_packet(tmp_path, "/decoded/fleet%20packet.bin")
    assert packet.with_suffix(".json").read_bytes() == original
    assert set(packet.parent.iterdir()) == {packet, packet.with_suffix(".json")}


def test_unknown_protocol_does_not_overwrite_existing_metadata(tmp_path):
    packet, metadata = saved_packet(tmp_path)
    metadata["decoder"] = {}
    metadata["decoder_config"] = {}
    metadata["telemetry"] = {}
    metadata_path = packet.with_suffix(".json")
    metadata_path.write_text(json.dumps(metadata))
    with pytest.raises(ValueError, match="protocol"):
        reparse.reparse_packet(tmp_path, "/decoded/fleet%20packet.bin")
    assert json.loads(metadata_path.read_text()) == metadata


def test_reparse_ax25_strips_hdlc_flags_and_uses_saved_callsigns(tmp_path):
    packet, metadata = saved_packet(tmp_path)
    captures = json.loads((Path(__file__).parent / "fixtures" / "uwe4.json").read_text())
    binary = bytes.fromhex(captures["beacon_1"]["packet_hex"])
    packet.write_bytes(binary)
    metadata["decoder"] = {"type": "fsk"}
    metadata["decoder_config"] = {"framing": "ax25", "payload_protocol": "ax25"}
    metadata["satellite"] = {"name": "UWE-4"}
    packet.with_suffix(".json").write_text(json.dumps(metadata))
    result = reparse.reparse_packet(tmp_path, "/decoded/fleet%20packet.bin")
    assert result["telemetry"]["parser"] == "ax25+Uwe4Parser"
    assert result["telemetry"]["telemetry"]["values"]["batt_a_voltage_v"] == 4.2
    assert packet.read_bytes() == binary


@pytest.mark.asyncio
async def test_socket_reparse_returns_new_metadata_and_refreshes_library(tmp_path, monkeypatch):
    saved_packet(tmp_path)
    inventory = SimpleNamespace(roots=SimpleNamespace(backend=tmp_path), rebuild=lambda: 12)
    monkeypatch.setattr(handler, "get_inventory", lambda: inventory)
    monkeypatch.setattr(handler, "publish_ready_artifacts", lambda _inventory: None)
    sio = SimpleNamespace(emit=AsyncMock())
    result = await handler.reparse_telemetry(
        sio, {"url": "/decoded/fleet%20packet.bin"}, logging.getLogger(__name__), "sid"
    )
    assert result["success"] is True
    assert result["data"]["telemetry"]["telemetry"]["format"] == "kaitai"
    assert sio.emit.call_args.args[0] == "library.changed"
    assert sio.emit.call_args.args[1]["revision"] == 12


@pytest.mark.parametrize("capture,kind,count", zip(LASARSAT[:3], ["DOS", "SOL", "U"], [16, 12, 13]))
def test_preview_decodes_legacy_lasarsat_without_modifying_any_capture_files(
    tmp_path, capture, kind, count
):
    directory = tmp_path / "data" / "decoded"
    directory.mkdir(parents=True)
    packet = directory / capture["filename"]
    packet.write_bytes(bytes.fromhex(capture["binary_hex"]))
    metadata_path = packet.with_suffix(".json")
    metadata_path.write_text(json.dumps(capture["metadata"]))
    before = {
        path.name: (path.read_bytes(), path.stat().st_mtime_ns) for path in directory.iterdir()
    }

    result = reparse.preview_packet(tmp_path, "/decoded/" + capture["filename"])

    decoded = result["telemetry"]
    assert decoded["parser"] == "ax25+LasarsatAx25Parser"
    assert decoded["telemetry"]["type"] == kind
    assert len(decoded["telemetry"]["values"]) == count
    assert decoded["telemetry"]["field_info"].keys() == decoded["telemetry"]["values"].keys()
    assert {key: value for key, value in result.items() if key != "telemetry"} == {
        key: value for key, value in capture["metadata"].items() if key != "telemetry"
    }
    assert {
        path.name: (path.read_bytes(), path.stat().st_mtime_ns) for path in directory.iterdir()
    } == before


def test_preview_returns_frame_errors_for_display_and_never_saves_them(tmp_path):
    capture = LASARSAT[3]
    packet, _ = saved_packet(tmp_path)
    packet.write_bytes(bytes.fromhex(capture["binary_hex"]))
    metadata_path = packet.with_suffix(".json")
    metadata_path.write_text(json.dumps(capture["metadata"]))
    original = metadata_path.read_bytes()
    result = reparse.preview_packet(tmp_path, "/decoded/fleet%20packet.bin")
    assert result["telemetry"]["success"] is False
    assert "Invalid destination callsign" in result["telemetry"]["error"]
    assert metadata_path.read_bytes() == original
    with pytest.raises(ValueError, match="Invalid destination callsign"):
        reparse.reparse_packet(tmp_path, "/decoded/fleet%20packet.bin")
    assert metadata_path.read_bytes() == original


@pytest.mark.asyncio
async def test_socket_preview_never_rebuilds_or_publishes_changes(tmp_path, monkeypatch):
    saved_packet(tmp_path)
    inventory = SimpleNamespace(roots=SimpleNamespace(backend=tmp_path), rebuild=Mock())
    publish = Mock()
    monkeypatch.setattr(handler, "get_inventory", lambda: inventory)
    monkeypatch.setattr(handler, "publish_ready_artifacts", publish)
    sio = SimpleNamespace(emit=AsyncMock())
    result = await handler.preview_telemetry(
        sio, {"url": "/decoded/fleet%20packet.bin"}, logging.getLogger(__name__), "sid"
    )
    assert result["success"] is True
    assert result["data"]["telemetry"]["telemetry"]["format"] == "kaitai"
    inventory.rebuild.assert_not_called()
    publish.assert_not_called()
    sio.emit.assert_not_called()


@pytest.mark.asyncio
async def test_socket_preview_reports_missing_files_and_bad_requests(tmp_path, monkeypatch):
    inventory = SimpleNamespace(roots=SimpleNamespace(backend=tmp_path))
    monkeypatch.setattr(handler, "get_inventory", lambda: inventory)
    logger = logging.getLogger(__name__)
    assert await handler.preview_telemetry(None, {}, logger, "sid") == {
        "success": False,
        "error": "Packet URL is required",
    }
    result = await handler.preview_telemetry(None, {"url": "/decoded/missing.bin"}, logger, "sid")
    assert result["success"] is False
    assert result["error"]
