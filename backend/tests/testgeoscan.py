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

"""GEOSCAN Type-I decoding via Kaitai specs, pinned to real rfbox5 captures.

Expected values come from the legacy table parser as recorded on the rfbox5
data pool at capture time (see tests/fixtures/geoscan6.json), so the migrated
dispatcher must reproduce them key-for-key. Documented deviations:
- values key ``obc_activity_raw`` renamed to ``obc_activity``;
- reserve fields dropped from ``values`` (kept under ``raw_fields``);
- legacy raw key ``obc_activity_raw_raw`` superseded by ``obc_activity_raw``.
"""

import json
import struct
from pathlib import Path

import pytest

from telemetry.parser import TelemetryParser
from telemetry.parsers.geoscan import GeoscanParser
from telemetry.parsers.kaitai import KaitaiPayloadParser

pytestmark = pytest.mark.unit
CAPTURES = json.loads((Path(__file__).parent / "fixtures" / "geoscan6.json").read_text())


def parse(name, frame_size=74):
    cap = CAPTURES[name]
    return GeoscanParser().parse(
        bytes.fromhex(cap["payload_hex"]), sat_name="GEOSCAN 6 (RS92S6)", frame_size=frame_size
    )


def assert_parity(name, spec_id):
    cap = CAPTURES[name]
    result = parse(name)
    assert result["format"] == "kaitai"
    assert result["spec"] == spec_id
    assert result["satellite"] == "GEOSCAN 6 (RS92S6)"
    assert result["length"] == len(cap["payload_hex"]) // 2

    values = result["values"]
    for key, expected in cap["expected_values"].items():
        if "reserve" in key:
            # Deviation: reserves are raw-only now.
            assert key + "_raw" in result["raw_fields"], key
            continue
        key_new = "obc_activity" if key == "obc_activity_raw" else key
        got = values[key_new]
        if isinstance(expected, float):
            assert got == pytest.approx(expected, abs=1e-3), key_new
        else:
            assert got == expected, key_new

    for key, expected in cap["expected_raw"].items():
        if key == "obc_activity_raw_raw":
            assert result["raw_fields"]["obc_activity_raw"] == expected
            continue
        assert result["raw_fields"][key] == expected, key


@pytest.mark.parametrize("name", ["full_a", "full_b"])
def test_full_frame_parity(name):
    assert_parity(name, "geoscan_type1_74")


@pytest.mark.parametrize("name", ["info_a", "info_b"])
def test_info_field_parity(name):
    assert_parity(name, "geoscan_type1_info56")


def test_length_dispatch_without_frame_hint():
    # parser.py passes frame_size = hint or len(payload); hint==len means
    # "no hint" and exact-length dispatch must pick the same layouts.
    for name, spec in [("full_a", "geoscan_type1_74"), ("info_a", "geoscan_type1_info56")]:
        payload = bytes.fromhex(CAPTURES[name]["payload_hex"])
        result = GeoscanParser().parse(payload, frame_size=len(payload))
        assert result["spec"] == spec


def test_image_packet_syncword_returns_warning_envelope():
    payload = bytearray(bytes.fromhex(CAPTURES["full_a"]["payload_hex"]))
    payload[13:17] = bytes([0x6F, 0x6B, 0x6F, 0x31])
    result = GeoscanParser().parse(bytes(payload), frame_size=74)
    assert result["format"] == "geoscan"
    assert "image packet" in result["warning"]
    assert "values" not in result


def test_66_frame_info_layout_is_correctly_aligned():
    # Synthesized 48-byte AX.25 info field of a 66-byte Type-I frame: the
    # legacy dispatcher decoded these with misaligned full-frame offsets.
    mayak, eps_time = 0xA5, 1_700_000_000
    payload = bytearray(48)
    payload[0] = mayak
    struct.pack_into("<I", payload, 1, eps_time)
    struct.pack_into("<H", payload, 11, 3456)  # v_cell raw mV
    payload[17] = 0xE9  # temp_bat1 = -23 C
    result = GeoscanParser().parse(bytes(payload), frame_size=66)
    assert result["spec"] == "geoscan_type1_info40"
    assert result["values"]["mayak_id"] == mayak
    assert result["values"]["eps_time_unix_s"] == eps_time
    assert result["values"]["v_cell_v"] == pytest.approx(3.456, abs=1e-3)
    assert result["values"]["temp_bat1_c"] == -23


def test_unsized_payload_fails_fast():
    # Hint 74 but too short even for the info layout: spec-level fail-fast.
    with pytest.raises(ValueError, match="mismatch"):
        GeoscanParser().parse(bytes(30), frame_size=74)
    # No hint and no exact-length match: dispatcher-level fail-fast.
    with pytest.raises(ValueError, match="no GEOSCAN layout"):
        GeoscanParser().parse(bytes(30))
    # A hint that is neither 74/66 nor the payload length: no layout applies.
    with pytest.raises(ValueError, match="no GEOSCAN layout"):
        GeoscanParser().parse(bytes(72), frame_size=90)


def test_end_to_end_routing_and_hex_fallback():
    payload = bytes.fromhex(CAPTURES["full_a"]["payload_hex"])
    tp = TelemetryParser()
    result = tp.parse(
        payload,
        protocol_hint="proprietary",
        parser_hint={"framing": "geoscan", "frame_size": 74},
    )
    assert result["success"] is True
    assert result["parser"] == "proprietary+GeoscanParser"
    assert result["telemetry"]["format"] == "kaitai"

    # Something proprietary but not GEOSCAN: must fall back to hex cleanly.
    junk = tp.parse(
        bytes(range(40)),
        protocol_hint="proprietary",
        parser_hint={"framing": "geoscan", "frame_size": 74},
    )
    assert junk["success"] is True
    assert junk["telemetry"]["format"] == "raw"


@pytest.mark.parametrize("frame_size,length", [(66, 64), (66, 48), (74, 72), (74, 56)])
def test_only_complete_frame_lengths_are_accepted(frame_size, length):
    parser = GeoscanParser()
    assert parser.parse(bytes(length), frame_size=frame_size)["format"] == "kaitai"
    for invalid in (0, 30, 40, 47, 49, 50, 51, length - 1, length + 1, 80):
        with pytest.raises(ValueError):
            parser.parse(bytes(invalid), frame_size=frame_size)


@pytest.mark.parametrize(
    "spec,length",
    [
        ("geoscan_type1_full66", 64),
        ("geoscan_type1_info40", 48),
        ("geoscan_type1_74", 72),
        ("geoscan_type1_info56", 56),
    ],
)
def test_schema_rejects_incomplete_frames_even_without_dispatcher(spec, length):
    parser = KaitaiPayloadParser(spec)
    for invalid in (length - 1, length + 1):
        with pytest.raises(ValueError, match="mismatch"):
            parser.parse(bytes(invalid))


def test_66_frame_unmodeled_tails_are_preserved():
    full = bytes(range(64))
    result = GeoscanParser().parse(full, frame_size=66)
    assert result["raw_fields"]["trailing_data_raw"] == full[51:].hex()
    result = GeoscanParser().parse(full[16:], frame_size=66)
    assert result["raw_fields"]["trailing_data_raw"] == full[56:].hex()
    assert result["field_info"]["v_cell_v"]["unit"] == "V"
