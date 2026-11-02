# Copyright (c) 2026 Efstratios Goudelis
# SPDX-License-Identifier: GPL-3.0-or-later
"""Radio captures verify the public key/nonce independently of our encoder."""

import json
import struct
from pathlib import Path

import pytest

from handlers.entities import library as libraryhandler
from library.inventory import LibraryInventory
from library.positions import packet_positions
from telemetry import reparse
from telemetry.context import ParseContext
from telemetry.meshtastic import MeshtasticParser
from telemetry.parsers.gen import meshtastic as proto
from telemetry.service import parse_packet
from tests.testtelemetryflow import decoder

pytestmark = pytest.mark.unit

# Captured on rfbox5, EU_868 LongFast. Keep ciphertext to exercise the actual
# Meshtastic AES key, sender/packet-ID byte order and application wire layout.
POSITION = bytes.fromhex(
    "ffffffff99e20820094bf14d610800049d713938121cc125eb6837b28f18b7ea45f2fc"
    "b7a6d6926a1ba22f610fe08689a205162b7b7f496aa8f7"
)
NODEINFO = bytes.fromhex(
    "ffffffffdc2950bd0ecc704362080004e9c5b6645afd71cf8a8af2a59d158a9428b9"
    "8867b5aac2f409d993d47ad3f5e5c98e2a51778ec7750173935f688e85e11a887"
    "285d45cc4374367961bb83f73ea18d5e4cb8d7bdf77d57f6c2f86645aa958"
)
PRIVATE = bytes.fromhex(
    "ffffffff8cc2198bcfa90fbfe56900040a98e28e4c34324fa41d9015bff02b507007"
    "e0040de42a812b10aa1cca720b3ba404d1361ff7009402"
)
DEVICE = bytes.fromhex(
    "ffffffff9cbe3662715929ed6308009c9cfe7ad7b6084d6155bb56216d590f9e0693"
    "08cb1e4f11df01c476996feebd3989dd"
)
ENVIRONMENT = bytes.fromhex(
    "ffffffff9cbe366272a5fe836308009c9ec239a112c5f860a79fa941995cf370adf72f82af23f5"
)


def radio(port, payload):
    if not isinstance(payload, bytes):
        payload = payload.SerializeToString()
    return struct.pack("<IIIBBBB", 0xFFFFFFFF, 0x12345678, 42, 0x6B, 0, 0, 0) + (
        proto.Data(portnum=port, payload=payload).SerializeToString()
    )


def parse(packet):
    return parse_packet(packet, ParseContext("lora", framing="lora", lora_sync_word=0x2B))


def test_real_public_position_decrypts_with_firmware_units_and_header():
    result = parse(POSITION)
    assert result["parser_id"] == "meshtastic"
    assert result["payload_status"] == "decoded"
    mesh = result["telemetry"]
    assert mesh["position"] == {
        "latitude": 40.6585344,
        "longitude": 22.9376,
        "altitude_meters": 32,
        "speed_kmh": 0,
        "course_degrees": 281.62,
    }
    assert mesh["values"]["sats_in_view"] == 12
    assert mesh["values"]["PDOP"] == 1.48
    assert mesh["values"]["precision_bits"] == 13
    header = result["headers"]["meshtastic"]
    assert header["source"] == "!2008e299"
    assert header["destination"] == "Broadcast"
    assert header["packet_id"] == "0x4df14b09"
    assert header["encryption"] == "Public default key"
    assert header["application"] == "Position"
    assert result["raw"]["packet_hex"] == POSITION.hex()
    assert result["raw"]["payload_hex"] == POSITION[16:].hex()
    assert mesh["raw_fields"]["application_payload_hex"].startswith("0d00003c18")
    assert {group["id"] for group in result["payload"]["records"][0]["groups"]} == {
        "mesh",
        "position",
    }


def test_real_public_node_information():
    result = parse(NODEINFO)
    assert result["payload_status"] == "decoded"
    assert result["telemetry"]["source"] == "!bd5029dc"
    values = result["telemetry"]["values"]
    assert values["long_name"] == "Sv2tca-1"
    assert values["short_name"] == "29dc"
    assert values["hw_model"] == 43
    assert values["role"] == 2
    assert "position" not in result["telemetry"]


def test_real_device_telemetry_and_external_power_sentinel():
    result = parse(DEVICE)
    assert result["payload_status"] == "decoded"
    values = result["telemetry"]["values"]
    assert values["voltage"] == pytest.approx(4.208)
    assert values["uptime_seconds"] == 1393595
    assert values["air_util_tx"] == pytest.approx(1.9576112)
    assert values["channel_utilization"] == 0
    assert values["power_source"] == "External power"
    assert "battery_level" not in values
    assert result["telemetry"]["raw_fields"]["battery_level_raw"] == 101


def test_real_environment_telemetry():
    result = parse(ENVIRONMENT)
    assert result["payload_status"] == "decoded"
    values = result["telemetry"]["values"]
    assert values["temperature"] == pytest.approx(27.1771049)
    assert values["lux"] == 1
    assert result["telemetry"]["field_info"]["temperature"]["unit"] == "°C"
    assert result["telemetry"]["field_info"]["lux"]["unit"] == "lx"


def test_private_payload_retains_header_and_ciphertext_without_inventing_readings():
    result = parse(PRIVATE)
    assert result["payload_status"] == "unsupported"
    assert result["payload"]["records"][0]["status"] == "unsupported"
    assert result["headers"]["meshtastic"]["source"] == "!8b19c28c"
    assert result["headers"]["meshtastic"]["channel_hash"] == "0x69"
    assert result["telemetry"]["values"]["encryption"] == "Encrypted"
    assert "position" not in result["telemetry"]
    assert result["raw"]["packet_hex"] == PRIVATE.hex()
    assert packet_positions({"telemetry": result}, "decoded:p.bin", "2026-11-02") == []


@pytest.mark.parametrize("port", [1, 10, 11, 66])
def test_plaintext_utf8_and_hop_flags(port):
    result = parse(radio(port, "Hello Θεσσαλονίκη".encode()))
    assert result["payload_status"] == "decoded"
    assert result["telemetry"]["values"]["message"] == "Hello Θεσσαλονίκη"
    header = result["headers"]["meshtastic"]
    assert header["encryption"] == "Unencrypted"
    assert header["hop_limit"] == 3
    assert header["hop_start"] == 3
    assert header["want_ack"] is True
    assert header["via_mqtt"] is False


def test_device_metrics_keep_explicit_zero_but_omit_missing_fields():
    result = parse(
        radio(
            67,
            proto.Telemetry(
                time=1793655209,
                device_metrics=proto.DeviceMetrics(
                    battery_level=0,
                    voltage=3.75,
                    channel_utilization=0,
                    uptime_seconds=123,
                ),
            ),
        )
    )
    values = result["telemetry"]["values"]
    info = result["telemetry"]["field_info"]
    assert values["battery_level"] == 0
    assert values["channel_utilization"] == 0
    assert values["voltage"] == 3.75
    assert values["uptime_seconds"] == 123
    assert values["reported_time"] == 1793655209
    assert "air_util_tx" not in values
    assert info["voltage"]["unit"] == "V"
    assert info["battery_level"]["unit"] == "%"


@pytest.mark.parametrize(
    "variant,metrics,key,value,unit",
    [
        (
            "environment_metrics",
            proto.EnvironmentMetrics(temperature=-12.5),
            "temperature",
            -12.5,
            "°C",
        ),
        (
            "environment_metrics",
            proto.EnvironmentMetrics(relative_humidity=0),
            "relative_humidity",
            0,
            "%",
        ),
        (
            "environment_metrics",
            proto.EnvironmentMetrics(one_wire_temperature=[0, -2.5]),
            "one_wire_temperature",
            [0, -2.5],
            "°C",
        ),
        (
            "power_metrics",
            proto.PowerMetrics(ch1_voltage=12.5, ch1_current=0),
            "ch1_voltage",
            12.5,
            "V",
        ),
        ("power_metrics", proto.PowerMetrics(ch1_current=125), "ch1_current", 125, "mA"),
        (
            "air_quality_metrics",
            proto.AirQualityMetrics(pm25_standard=12),
            "pm25_standard",
            12,
            "µg/m³",
        ),
        ("air_quality_metrics", proto.AirQualityMetrics(co2=420), "co2", 420, "ppm"),
        (
            "air_quality_metrics",
            proto.AirQualityMetrics(form_formaldehyde=4),
            "form_formaldehyde",
            4,
            "ppb",
        ),
    ],
)
def test_metric_variants_and_units(variant, metrics, key, value, unit):
    result = parse(radio(67, proto.Telemetry(**{variant: metrics})))
    assert result["payload_status"] == "decoded"
    assert result["telemetry"]["values"][key] == value
    assert result["telemetry"]["field_info"][key] == {
        "label": result["telemetry"]["field_info"][key]["label"],
        "unit": unit,
        "group": variant,
    }


@pytest.mark.parametrize(
    "position,expected",
    [
        (
            proto.Position(latitude_i=0, longitude_i=0, altitude=0),
            {"latitude": 0, "longitude": 0, "altitude_meters": 0},
        ),
        (
            proto.Position(latitude_i=-345000000, longitude_i=-705000000, altitude=-32),
            {"latitude": -34.5, "longitude": -70.5, "altitude_meters": -32},
        ),
        (proto.Position(latitude_i=0), None),
        (proto.Position(time=100), None),
    ],
)
def test_position_presence_signed_values_and_zero(position, expected):
    result = parse(radio(3, position))
    assert result["payload_status"] == "decoded"
    assert result["telemetry"].get("position") == expected


def test_invalid_heading_does_not_discard_a_valid_position():
    result = parse(radio(3, proto.Position(latitude_i=0, longitude_i=0, ground_track=40000000)))
    assert result["payload_status"] == "decoded"
    assert result["telemetry"]["position"] == {"latitude": 0, "longitude": 0}
    assert result["telemetry"]["raw_fields"]["ground_track_raw"] == 40000000


@pytest.mark.parametrize(
    "port,payload",
    [
        (1, b"\xff"),
        (3, b"\x0d\x00"),
        (3, b""),
        (4, b""),
        (3, proto.Position(latitude_i=910000000, longitude_i=0)),
        (3, proto.Position(latitude_i=0, longitude_i=-1810000000)),
        (67, proto.Telemetry(device_metrics=proto.DeviceMetrics(voltage=float("nan")))),
        (
            67,
            proto.Telemetry(
                environment_metrics=proto.EnvironmentMetrics(one_wire_temperature=[float("inf")])
            ),
        ),
    ],
)
def test_malformed_applications_keep_bytes_and_never_produce_a_position(port, payload):
    packet = radio(port, payload)
    result = parse(packet)
    assert result["payload_status"] == "malformed"
    assert result["payload"]["records"][0]["status"] == "malformed"
    assert result["raw"]["packet_hex"] == packet.hex()
    assert "position" not in result["telemetry"]
    assert packet_positions({"telemetry": result}, "decoded:p.bin", "2026-11-02") == []
    json.dumps(result, allow_nan=False)


@pytest.mark.parametrize("packet", [b"", POSITION[:16], b"\0" * 32, POSITION + b"\0" * 256])
def test_invalid_radio_header(packet):
    assert MeshtasticParser().parse(packet) is None
    assert parse(packet)["payload_status"] == "malformed"


@pytest.mark.parametrize("packet", [PRIVATE, b"ordinary satellite LoRa packet"])
def test_generic_unknown_lora_is_not_assumed_to_be_meshtastic(packet):
    result = parse_packet(packet, ParseContext("lora"))
    assert result["parser_id"] != "meshtastic"
    assert result["raw"]["packet_hex"] == packet.hex()


def test_public_packet_is_recognized_even_without_radio_sync_hint():
    assert parse_packet(POSITION, ParseContext("lora"))["parser_id"] == "meshtastic"


@pytest.mark.parametrize("port,payload", [(64, b"serial bytes"), (67, b"\x32\x02\x08\x01")])
def test_unsupported_applications_and_new_telemetry_variants_preserve_payload(port, payload):
    result = parse(radio(port, payload))
    assert result["payload_status"] == "unsupported"
    assert result["telemetry"]["raw_fields"]["application_payload_hex"] == payload.hex()


def test_satellite_specific_parser_still_takes_precedence():
    sample = json.loads((Path(__file__).parent / "fixtures" / "tianqi.json").read_text())
    packet = bytes.fromhex(next(iter(sample.values()))["packet_hex"])
    result = parse_packet(packet, ParseContext("lora", satellite="Tianqi-39", lora_sync_word=0x2B))
    assert result["parser"] == "lora+TianqiParser"


@pytest.mark.parametrize("packet", [POSITION, PRIVATE])
def test_capture_preview_reparse_and_legacy_context_agree(tmp_path, packet):
    directory = tmp_path / "data" / "decoded"
    directory.mkdir(parents=True)
    context = ParseContext("lora", framing="lora", lora_sync_word=0x2B)
    instance = decoder(directory, context)
    instance._get_decoder_type = lambda: "lora"
    instance._get_decoder_config_metadata = lambda: {
        "framing": "lora",
        "payload_protocol": "lora",
        "sync_word": [0x2B],
    }
    instance._on_packet_decoded(packet)
    path = directory / "packet.json"
    saved = json.loads(path.read_text())
    expected = parse(packet)
    assert saved["parse_context"]["lora_sync_word"] == 0x2B
    assert saved["telemetry"] == expected
    assert instance.data_queue.get_nowait()["output"]["telemetry"] == expected
    assert reparse.preview_packet(tmp_path, "/decoded/packet.bin")["telemetry"] == expected
    assert reparse.reparse_packet(tmp_path, "/decoded/packet.bin")["telemetry"] == expected
    # Older captures have the sync word only in decoder_config.
    del saved["parse_context"]["lora_sync_word"]
    path.write_text(json.dumps(saved))
    assert ParseContext.from_metadata(saved).lora_sync_word == 0x2B
    assert reparse.preview_packet(tmp_path, "/decoded/packet.bin")["telemetry"] == expected
    del saved["parse_context"]
    assert ParseContext.from_metadata(saved).lora_sync_word == 0x2B
    assert (directory / "packet.bin").read_bytes() == packet


@pytest.mark.parametrize("sync", [True, -1, 256, "0x2b", 43.0])
def test_invalid_sync_context_is_rejected(sync):
    with pytest.raises(ValueError, match="sync word"):
        ParseContext("lora", lora_sync_word=sync)


def test_sync_context_applies_only_to_lora_and_is_optional():
    with pytest.raises(ValueError, match="sync word"):
        ParseContext("ax25", lora_sync_word=0x2B)
    assert "lora_sync_word" not in ParseContext("lora").to_dict()


def test_decoded_meshtastic_position_enters_packet_map_with_stable_identity():
    points = packet_positions({"telemetry": parse(POSITION)}, "decoded:p.bin", "2026-11-02")
    assert len(points) == 1
    point = points[0]
    assert point["kind"] == "meshtastic"
    assert point["transmitter_id"] == "meshtastic:!2008e299"
    assert point["name"] == point["source"] == "!2008e299"
    assert point["latitude"] == 40.6585344
    assert point["longitude"] == 22.9376
    assert point["altitude"] == 32
    assert point["_details"]["telemetry"]["sats_in_view"] == 12
    assert point["_field_info"]["altitude"]["unit"] == "m"
    assert packet_positions({"telemetry": parse(NODEINFO)}, "decoded:n.bin", "2026-11-02") == []


@pytest.mark.parametrize("normalized_only", [False, True])
@pytest.mark.parametrize("relative", ["decoded", "observations/Mesh.gsobs/decoded"])
async def test_map_api_indexes_location_packets_in_manual_and_observation_captures(
    tmp_path, monkeypatch, relative, normalized_only
):
    folder = tmp_path / "data" / relative
    folder.mkdir(parents=True)
    if relative.startswith("observations"):
        (folder.parent / "manifest.json").write_text(json.dumps({"status": "complete"}))
    for name, packet in (("position", POSITION), ("node", NODEINFO), ("encrypted", PRIVATE)):
        result = parse(packet)
        if normalized_only:
            del result["telemetry"]
        (folder / f"{name}.bin").write_bytes(packet)
        (folder / f"{name}.json").write_text(
            json.dumps(
                {
                    "decoder": {"type": "lora"},
                    "telemetry": result,
                    "packet": {"timestamp_iso": "2026-11-02T21:33:32Z"},
                }
            )
        )
    inventory = LibraryInventory(tmp_path)
    monkeypatch.setattr(libraryhandler, "get_inventory", lambda: inventory)
    reply = await libraryhandler.query_positions(
        None, {"start": "2026-11-02T21:30:00Z"}, None, None
    )
    assert reply["success"] is True
    result = reply["data"]
    assert result["total"] == 1
    point = result["positions"][0]
    assert point["kind"] == "meshtastic"
    assert point["transmitter_id"] == "meshtastic:!2008e299"
    assert point["latitude"] == 40.6585344
    assert point["longitude"] == 22.9376
    assert point["altitude"] == 32
    assert point["file_id"].endswith("position.bin")
    assert result["transmitters"][0]["details"]["telemetry"]["sats_in_view"] == 12
    assert result["transmitters"][0]["field_info"]["altitude"]["unit"] == "m"


def test_reparsing_an_older_mesh_capture_adds_its_position_to_the_map(tmp_path):
    folder = tmp_path / "data" / "decoded"
    folder.mkdir(parents=True)
    (folder / "position.bin").write_bytes(POSITION)
    (folder / "position.json").write_text(
        json.dumps(
            {
                "decoder": {"type": "lora"},
                "decoder_config": {"framing": "lora", "sync_word": [0x2B]},
                "packet": {"timestamp_iso": "2026-11-02T21:33:32Z"},
                "telemetry": {"protocol": "lora", "telemetry": {"format": "raw"}},
            }
        )
    )
    inventory = LibraryInventory(tmp_path)
    assert inventory.query_positions("2026-11-02T21:30:00Z")["total"] == 0
    reparse.reparse_packet(tmp_path, "/decoded/position.bin")
    inventory.rebuild()
    points = inventory.query_positions("2026-11-02T21:30:00Z")["positions"]
    assert len(points) == 1
    assert points[0]["transmitter_id"] == "meshtastic:!2008e299"
