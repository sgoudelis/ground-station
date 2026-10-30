"""UMKA and RS18S captures and boundary cases for USP payload decoding.

Expected engineering values are read from the published SPUTNIX layouts and
the captured bytes, independently of the decoder's field table.
"""

import json
import struct
from pathlib import Path

import pytest

from telemetry.context import ParseContext
from telemetry.parser import TelemetryParser
from telemetry.parsers.usp import USPParser
from telemetry.service import parse_packet

pytestmark = pytest.mark.unit
CAPTURES = json.loads((Path(__file__).parent / "fixtures" / "umka.json").read_text())
RS18S_CAPTURES = json.loads((Path(__file__).parent / "fixtures" / "rs18s.json").read_text())


def parse_capture(name):
    # The recorder adds one HDLC flag at each end; BaseDecoder removes these
    # before invoking TelemetryParser. USP does not append an AX.25 FCS.
    frame = bytes.fromhex(CAPTURES[name]["packet_hex"])[1:-1]
    return TelemetryParser().parse(frame, protocol_hint="ax25", parser_hint={"framing": "usp"})


def message(message_id, body, source=2):
    return struct.pack("<4H", message_id, source, 1, len(body)) + body


def parse_rs18s_capture(name):
    return parse_packet(
        bytes.fromhex(RS18S_CAPTURES[name]["packet_hex"]),
        ParseContext(
            protocol="ax25",
            framing="usp",
            satellite="SAKHACUBE-CHOLBON (RS18S)",
            hdlc_flags=True,
        ),
    )


def test_real_rs18s_beacon_routes_to_usp_and_exposes_radio_and_power_records():
    result = parse_rs18s_capture("beacon")
    assert result["frame"]["source"] == "RS18S-1"
    assert result["parser_id"] == "usp"
    assert result["payload_status"] == "decoded"
    assert result["raw"]["packet_hex"] == RS18S_CAPTURES["beacon"]["packet_hex"]
    radio, power = result["telemetry"]["messages"]
    assert (radio["message_id"], power["message_id"]) == ("0x4246", "0xDE21")
    assert radio["values"]["amplifier_temperature"] == 16
    assert radio["values"]["input_voltage"] == 7.924
    assert radio["values"]["time_utc"] == "2026-10-30T09:31:40+00:00"
    assert power["values"]["battery_voltage"] == 7.888
    assert power["values"]["battery_current"] == 239
    assert power["values"]["battery_temperature_1"] == -2.18
    # RS18S also transmits an unsynchronised power-system clock; preserve it literally.
    assert power["values"]["time_utc"] == "2018-03-06T01:31:53+00:00"
    radio_record, power_record = result["payload"]["records"]
    assert radio_record["status"] == power_record["status"] == "decoded"
    group = power_record["groups"][0]
    assert group["values"]["battery_voltage"] == 7.888
    assert group["field_info"]["battery_voltage"]["unit"] == "V"


def test_real_rs18s_acknowledgement_does_not_produce_telemetry_measurements():
    result = parse_rs18s_capture("ack")
    assert result["parser_id"] == "usp"
    assert result["payload_status"] == "non_telemetry"
    (record,) = result["payload"]["records"]
    assert record["message_id"] == "0x0118"
    assert record["status"] == "non_telemetry"
    assert record["groups"] == []


def test_real_night_beacon_decodes_both_subsystems_and_signed_current():
    result = parse_capture("night")
    assert result["parser"] == "ax25+USPParser"
    assert result["frame"]["source"] == "RS40S-1"
    assert result["frame"]["control"] == "0x00"
    radio, power = result["telemetry"]["messages"]
    assert (radio["message_id"], power["message_id"]) == ("0x4246", "0xDE21")
    assert (radio["source"], power["source"], power["destination"]) == (2, 4, 1)
    assert radio["values"]["input_voltage"] == 7.984
    assert radio["values"]["current"] == 40
    assert radio["values"]["amplifier_temperature"] == 4
    assert radio["values"]["idle_signal_strength"] == -119
    assert radio["values"]["receive_bitrate"] == 9600
    assert radio["values"]["time_utc"] == "2026-10-23T19:24:27+00:00"
    assert power["values"]["battery_voltage"] == 7.976
    assert power["values"]["battery_current"] == -37
    assert [power["values"][f"battery_temperature_{i}"] for i in range(1, 5)] == [
        4.75,
        4.62,
        4.25,
        4.75,
    ]
    assert power["values"]["channel_2_on"] is True
    assert power["values"]["channel_1_on"] is False
    assert power["field_info"]["battery_voltage"] == {"label": "Battery voltage", "unit": "V"}
    assert power["raw_fields"]["battery_temperature_1"] == 475
    # Preserve the power system's unsynchronised clock, rather than replacing it with reception time.
    assert power["values"]["time_utc"] == "2018-02-27T19:17:21+00:00"
    assert len(bytes.fromhex(result["raw"]["payload_hex"])) == 87


def test_real_day_beacon_has_solar_power_and_positive_battery_current():
    power = parse_capture("day")["telemetry"]["messages"][1]
    assert power["values"]["panel_voltage_2"] == 4.923
    assert power["values"]["panel_current_2"] == 319
    assert power["values"]["battery_current"] == 115
    assert power["values"]["battery_temperature_1"] == 2.68
    assert power["values"]["battery_voltage"] == 7.98


def test_real_adcs_beacon_preserves_measurements_and_honours_validity_bits():
    attitude = parse_capture("adcs")["telemetry"]["messages"][0]
    assert attitude["status"] == "decoded"
    values = attitude["values"]
    assert values["time_utc"] == "2026-10-21T18:31:50.873200+00:00"
    assert values["uptime"] == 32917
    assert values["latitude"] == pytest.approx(34.1761322)
    assert values["altitude"] == pytest.approx(495003.34375)
    assert values["eci_invalid"] is True
    assert values["eci_quaternion_w"] is None
    assert values["wheel_speed_x_plus"] is None
    assert attitude["raw_fields"]["eci_quaternion_w"] == pytest.approx(0.263392)


def test_unknown_and_non_telemetry_messages_do_not_hide_later_or_repeated_beacons():
    radio = bytes.fromhex(parse_capture("night")["telemetry"]["messages"][0]["payload_hex"])
    payload = message(0x1234, b"unknown") + message(0x0C24, b"image") + message(0x4246, radio) * 2
    decoded = USPParser().parse(payload)["messages"]
    assert [m["status"] for m in decoded] == ["unsupported", "non_telemetry", "decoded", "decoded"]
    assert decoded[0]["payload_hex"] == b"unknown".hex()
    assert decoded[1]["values"] == {}
    assert decoded[2]["values"] == decoded[3]["values"]


@pytest.mark.parametrize("size", range(8))
def test_truncated_headers_never_produce_measurements(size):
    result = USPParser().parse(b"\x46" * size)
    assert result["messages"] == []
    if size:
        assert "Truncated USP header" in result["error"]
    else:
        assert result["error"] == "Empty USP payload."


def test_truncated_body_is_not_zero_padded_or_decoded():
    result = USPParser().parse(struct.pack("<4H", 0x4246, 2, 1, 25) + bytes(24))
    item = result["messages"][0]
    assert item["status"] == "malformed"
    assert "expected 25 bytes, received 24" in item["error"]
    assert item["values"] == {}


@pytest.mark.parametrize("size", [0, 24, 26])
def test_wrong_known_message_size_does_not_consume_following_message(size):
    result = USPParser().parse(message(0x4246, bytes(size)) + message(0xDE24, b""))
    first, second = result["messages"]
    assert first["status"] == "malformed"
    assert first["values"] == {}
    assert second["message_id"] == "0xDE24"
    assert second["status"] == "non_telemetry"


def test_signed_temperatures_voltage_and_bit_order():
    body = bytearray(46)
    struct.pack_into("<h", body, 22, -1250)
    struct.pack_into("<h", body, 34, -1)
    body[30:34] = bytes([0b10000101, 0b10000001, 0b00010101, 0])
    power = USPParser().parse(message(0xDE21, body))["messages"][0]["values"]
    assert power["battery_temperature_1"] == -12.5
    assert power["battery_voltage"] == -0.001
    for key in [
        "battery_temperature_low",
        "heater_1_on",
        "battery_voltage_critical",
        "channel_1_fault",
        "channel_4_on",
        "charger_connected",
        "aux_channel_1_on",
        "aux_channel_3_on",
    ]:
        assert power[key] is True, key
    assert power["channel_2_on"] is False
    assert power["heater_2_on"] is False


def test_negative_radio_temperature_and_schedule_bits():
    body = bytearray(25)
    body[0] = 0xFB
    body[24] = 0b01100011
    values = USPParser().parse(message(0x4246, body))["messages"][0]["values"]
    assert values["amplifier_temperature"] == -5
    assert values["active_schedules"] == 3
    assert values["reset_during_schedule"] is True
    assert values["backup_schedule_active"] is True


def test_adcs_nonfinite_floats_and_out_of_range_clock_are_json_safe():
    body = bytearray(125)
    struct.pack_into("<q", body, 0, 2**63 - 1)
    struct.pack_into("<f", body, 12, float("nan"))
    struct.pack_into("<f", body, 99, float("inf"))
    result = USPParser().parse(message(0xF210, body))
    values = result["messages"][0]["values"]
    assert values["time_utc"] is None
    assert values["eci_quaternion_w"] is None
    assert values["latitude"] is None
    json.dumps(result, allow_nan=False)


def test_other_ax25_satellites_are_not_classified_as_umka():
    frame = bytearray(bytes.fromhex(CAPTURES["night"]["packet_hex"])[1:-1])
    frame[7:13] = bytes(b << 1 for b in b"TEST  ")
    result = TelemetryParser().parse(
        bytes(frame), protocol_hint="ax25", parser_hint={"framing": "usp"}
    )
    assert result["parser"] == "ax25"
    assert result["telemetry"]["format"] == "raw"
