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

"""Tianqi (FHRSS) LoRa beacons via tianqi.ksy, pinned to rfbox5 captures.

Layout was recovered by correlating TinyGS raw+parsed pairs with the
captures' own receive clocks; the strongest invariants are the beacon clock
matching the capture clock within ~2 s (independent instruments) and the
sat_id matching TinyGS's own 'satId' decode.
"""

import json
from datetime import datetime, timezone
from pathlib import Path

import pytest

from telemetry.parser import TelemetryParser
from telemetry.parsers.kaitai import KaitaiPayloadParser

pytestmark = pytest.mark.unit
CAPTURES = json.loads((Path(__file__).parent / "fixtures" / "tianqi.json").read_text())


def test_lora_routing_decodes_fleet_beacons():
    tp = TelemetryParser()
    for name, cap in CAPTURES.items():
        payload = bytes.fromhex(cap["packet_hex"])
        result = tp.parse(payload, protocol_hint="lora", sat_hint="Tianqi-39")
        telemetry = result["telemetry"]

        assert result["success"] is True, name
        assert result["parser"] == "lora+TianqiParser", name
        assert telemetry["format"] == "kaitai"
        assert telemetry["spec"] == "tianqi"
        for key, expected in cap["expected_values"].items():
            assert telemetry["values"][key] == expected, (name, key)

        # The spec's epoch-corrected clock must agree with the ground-station
        # receive time that was recorded independently at capture.
        assert "time_utc" in telemetry, name
        beacon = datetime.fromisoformat(telemetry["time_utc"]).replace(tzinfo=timezone.utc)
        captured = datetime.fromtimestamp(cap["capture_unix"], tz=timezone.utc)
        assert abs((captured - beacon).total_seconds()) < 60, name


def test_other_lora_satellites_stay_opaque():
    payload = bytes.fromhex(next(iter(CAPTURES.values()))["packet_hex"])
    result = TelemetryParser().parse(payload, protocol_hint="lora", sat_hint="ISS ZARYA")
    assert result["parser"] == "lora"
    assert result["telemetry"]["format"] == "raw"


def test_foreign_net_id_fails_fast_to_hex():
    payload = bytearray(bytes.fromhex(next(iter(CAPTURES.values()))["packet_hex"]))
    payload[0] = 0x99  # not the Tianqi net id
    result = TelemetryParser().parse(bytes(payload), protocol_hint="lora", sat_hint="Tianqi-39")
    assert result["success"] is True
    assert result["parser"] == "lora"
    assert result["telemetry"]["format"] == "raw"


@pytest.mark.parametrize("size", [0, 1, 8, 9, 20, 99, 101])
def test_incomplete_or_oversized_beacons_fall_back_to_raw(size):
    captured = bytes.fromhex(next(iter(CAPTURES.values()))["packet_hex"])
    payload = (captured + b"\x00")[:size]
    with pytest.raises(ValueError, match="mismatch"):
        KaitaiPayloadParser("tianqi").parse(payload)
    result = TelemetryParser().parse(payload, protocol_hint="lora", sat_hint="Tianqi-39")
    assert result["parser"] == "lora"
    assert result["telemetry"]["format"] == "raw"
    assert result["raw"]["packet_hex"] == payload.hex()


def test_unmodeled_tail_is_preserved_without_guessing_its_contents():
    captured = bytes.fromhex(next(iter(CAPTURES.values()))["packet_hex"])
    payload = captured[:9] + bytes(range(91))
    result = KaitaiPayloadParser("tianqi").parse(payload)
    assert result["raw_fields"]["payload_data_raw"] == bytes(range(91)).hex()
    assert result["field_info"]["sat_id"]["label"] == "Fleet satellite identifier"
