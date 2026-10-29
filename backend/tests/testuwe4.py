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

"""UWE-4 (DP0UWH) beacons via the uwe4.ksy spec, pinned to rfbox5 captures.

Structure follows the SatNOGS decoders' uwe4.ksy; expected values are the
engineering readings from the real captured packets (physically checked:
435.600 MHz beacon frequency, 4.2 V battery, plausible temperatures).
"""

import json
import struct
from pathlib import Path

import pytest

from telemetry.parser import TelemetryParser
from telemetry.parsers.kaitai import KaitaiPayloadParser

pytestmark = pytest.mark.unit
CAPTURES = json.loads((Path(__file__).parent / "fixtures" / "uwe4.json").read_text())


def test_real_beacons_decode_end_to_end():
    tp = TelemetryParser()
    for name, cap in CAPTURES.items():
        frame = bytes.fromhex(cap["packet_hex"])[1:-1]
        result = tp.parse(frame, protocol_hint="ax25")
        telemetry = result["telemetry"]

        assert result["success"] is True, name
        assert result["parser"] == "ax25+Uwe4Parser", name
        assert telemetry["format"] == "kaitai"
        assert telemetry["spec"] == "uwe4"
        assert telemetry["satellite"] == "UWE-4"
        assert telemetry["values"] == pytest.approx(cap["expected_values"]), name
        # Beacon frequency is UWE-4's published downlink.
        assert telemetry["values"]["freq_khz"] == 435600, name
        assert 4.0 < telemetry["values"]["batt_a_voltage_v"] < 4.3, name


def test_rf_message_api103_extracts_text():
    # Header: flags(2) + packet id(2le) + 02 01 01 00 + api=103 + size.
    text = "hello from uwe4"
    size = 6 + len(text)
    payload = (
        bytes([0x25, 0x82])
        + struct.pack("<H", 7)
        + bytes([0x02, 0x01, 0x01, 0x00, 103, size])
        + bytes(6)
        + text.encode()
        + bytes([0x11, 0x22])
    )
    parsed = KaitaiPayloadParser.factory("uwe4", satellite="UWE-4")().parse(payload)
    assert parsed["values"]["api"] == 103
    assert parsed["values"]["message"] == text
    assert parsed["raw_fields"]["crc_raw"] == 0x2211


def test_unknown_mission_api_fails_fast():
    payload = bytes([0x25, 0x82]) + struct.pack("<H", 7) + bytes([0x02, 0x01, 0x01, 0x00, 99, 46])
    parser = KaitaiPayloadParser.factory("uwe4", satellite="UWE-4")()
    with pytest.raises(ValueError, match="mismatch|Validation"):
        parser.parse(payload + bytes(46))


@pytest.mark.parametrize("size", [0, 1, 45, 47, 255])
def test_inconsistent_housekeeping_length_falls_back_to_raw(size):
    frame = bytearray(bytes.fromhex(CAPTURES["beacon_1"]["packet_hex"])[1:-1])
    # Header follows the sixteen-byte AX.25 addresses/control/PID section.
    frame[16 + 9] = size
    result = TelemetryParser().parse(bytes(frame), protocol_hint="ax25")
    assert result["success"] is True
    assert result["telemetry"]["format"] == "raw"


@pytest.mark.parametrize("delta", [-48, -2, -1, 1, 2])
def test_housekeeping_requires_complete_body_and_checksum(delta):
    frame = bytes.fromhex(CAPTURES["beacon_1"]["packet_hex"])[1:-1]
    altered = frame[:delta] if delta < 0 else frame + bytes(delta)
    result = TelemetryParser().parse(altered, protocol_hint="ax25")
    assert result["telemetry"]["format"] == "raw"


def test_short_rf_message_and_invalid_utf8_are_spec_mismatches():
    header = bytes([0x25, 0x82]) + struct.pack("<H", 7) + bytes([2, 1, 1, 0, 103])
    parser = KaitaiPayloadParser("uwe4")
    for body in (bytes(5), bytes(6) + b"\xff"):
        with pytest.raises(ValueError, match="mismatch"):
            parser.parse(header + bytes([len(body)]) + body + bytes(2))


def test_housekeeping_presentation_metadata_covers_engineering_values():
    frame = bytes.fromhex(CAPTURES["beacon_1"]["packet_hex"])[1:-1]
    parsed = TelemetryParser().parse(frame, protocol_hint="ax25")["telemetry"]
    assert set(parsed["field_info"]) == set(parsed["values"])
    assert parsed["field_info"]["batt_a_voltage_v"] == {"label": "Battery A voltage", "unit": "V"}
