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

"""Kaitai-backed payload parsers: rs52s parity against the hand-written parser.

Proves the .ksy spec (specs/rs52s.ksy) decodes identically to the legacy
parsers/rs52s.py implementation, and that mismatches fail fast into the
TelemetryParser hex fallback.
"""

import struct

import pytest

from telemetry.parser import TelemetryParser
from telemetry.parsers.kaitai import KaitaiPayloadParser
from telemetry.parsers.rs52s import RS52SGeoscanAx25Parser

pytestmark = pytest.mark.unit

# 26-byte synthetic RS52S payload per the community layout in specs/rs52s.ksy.
PACKET = struct.pack(
    "<I H H H H 4b B 3b b h h b",
    1761234567,  # time_unix_s
    175,  # battery_current_raw  -> 0.013405 A (legacy rounds to 0.0134)
    40,  # panel_current_raw    -> ~0.0012 A
    50000,  # v_cell_raw           -> 3.464 V
    20000,  # v_pack_raw           -> 2.7712 V (legacy rounds to 2.771)
    21,  # temp_x_p_c
    19,  # temp_x_n_c
    22,  # temp_y_p_c
    20,  # temp_y_n_c
    0,  # reserved_16
    18,  # temp_z_n_c
    25,  # temp_bat1_c
    26,  # temp_bat2_c
    64,  # cpu_load_raw -> 25.0 %
    8000,  # obc_counter_raw  -> 524
    2000,  # comm_counter_raw -> 495
    -30,  # rssi_raw -> -129 dBm
)


def test_kaitai_matches_legacy_values_and_raw_fields():
    legacy = RS52SGeoscanAx25Parser().parse(PACKET)
    kaitai = KaitaiPayloadParser.factory("rs52s", satellite="RS52S")().parse(PACKET)

    assert kaitai["satellite"] == "RS52S"
    assert kaitai["format"] == "kaitai"
    assert kaitai["length"] == len(PACKET)
    # Legacy top-level conveniences are reproduced.
    assert kaitai["time_unix_s"] == legacy["time_unix_s"] == 1761234567
    assert kaitai["time_utc"] == legacy["time_utc"]

    # Every legacy engineering value decodes; floats may differ only by the
    # legacy rounding at the 4th/3rd decimal.
    for key, expected in legacy["values"].items():
        got = kaitai["values"][key]
        if isinstance(expected, float):
            assert got == pytest.approx(expected, abs=1e-3), key
        else:
            assert got == expected, key

    # Raw fields are a superset (spec keeps all *_raw fields, legacy kept four
    # plus a duplicated time_unix_s which the adapter exposes under values).
    for key, expected in legacy["raw_fields"].items():
        if key == "time_unix_s":
            continue
        assert kaitai["raw_fields"][key] == expected
    assert kaitai["values"]["time_unix_s"] == 1761234567


def test_truncated_payload_fails_fast():
    parser = KaitaiPayloadParser.factory("rs52s", satellite="RS52S")()
    with pytest.raises(ValueError, match="mismatch"):
        parser.parse(PACKET[:20])


def test_ax25_routing_selects_kaitai_parser_by_callsign():
    # AX.25 UI frame (FCS already stripped by the deframer, as BaseDecoder
    # delivers): dst CQ-0 (0x60), src RS52S-0 final (0x61), control 0x03, pid F0.
    frame = bytes.fromhex("86a24040404060a4a66a64a64061") + bytes([0x03, 0xF0]) + PACKET
    result = TelemetryParser().parse(frame, protocol_hint="ax25")

    assert result["success"] is True
    assert result["frame"]["source"] == "RS52S-0"
    assert result["parser"] == "ax25+Rs52sParser"
    assert result["telemetry"]["values"]["v_pack_v"] == pytest.approx(2.7712, abs=1e-3)
    assert result["telemetry"]["values"]["obc_counter"] == 524


def test_short_ax25_info_falls_back_to_hex_without_breaking_parse():
    frame = bytes.fromhex("86a24040404060a4a66a64a64061") + bytes([0x03, 0xF0]) + PACKET[:20]
    result = TelemetryParser().parse(frame, protocol_hint="ax25")

    assert result["success"] is True
    assert result["telemetry"]["format"] == "raw"
