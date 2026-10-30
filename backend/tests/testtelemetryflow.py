"""Contract and failure boundaries from accepted packet bytes to the viewer."""

import json
import logging
import queue
import threading
from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest

from demodulators.basedecoder import BaseDecoder
from handlers.entities import telemetry as handler
from telemetry import reparse
from telemetry.compatibility import normalize_metadata
from telemetry.context import ParseContext
from telemetry.cspparser import CSPParser
from telemetry.parser import TelemetryParser
from telemetry.result import json_safe, normalize_result
from telemetry.service import parse_packet
from tests.viewerfixtures import FIXTURES, legacy_cases, viewer_fixtures

pytestmark = pytest.mark.unit


def decoder(tmp_path, context, parser=None):
    instance = BaseDecoder()
    instance.packet_count = 0
    instance.stats_lock = threading.Lock()
    instance.stats = {"errors": 0, "data_messages_out": 0}
    instance.output_dir = str(tmp_path)
    instance.telemetry_parser = parser or TelemetryParser()
    instance.satellite = {"name": context.satellite} if context.satellite else {}
    instance.norad_id = None
    instance.session_id = "test"
    instance.vfo = 0
    instance.data_queue = queue.Queue()
    instance._get_decoder_type = lambda: "fsk"
    instance._get_decoder_config_metadata = lambda: {
        "framing": context.framing,
        "payload_protocol": context.protocol,
    }
    instance._generate_filename = lambda _timestamp: "packet.bin"
    instance._get_vfo_state = lambda: None
    instance._get_parameters_string = lambda: "test"
    instance._get_decoder_metadata = lambda: {"type": "fsk"}
    instance._get_demodulator_params_metadata = lambda: {}
    instance._get_transmitter_metadata = lambda: {}
    return instance


def test_shared_viewer_fixture_matches_current_backend():
    assert json.loads((FIXTURES / "viewer.json").read_text()) == viewer_fixtures()


@pytest.mark.parametrize(
    "bad_result", [None, {}, {"schema_version": 1, "payload": {}, "raw": {"x": object()}}]
)
def test_invalid_replacement_parser_results_are_contained(bad_result):
    result = parse_packet(
        b"packet", ParseContext("unknown"), Mock(parse=Mock(return_value=bad_result))
    )
    assert result["payload_status"] == "error"
    assert result["raw"]["packet_hex"] == b"packet".hex()
    json.dumps(result, allow_nan=False)


def test_capture_saves_binary_before_parser_and_publishes_failure(tmp_path):
    packet = b"\x7eoriginal packet\x7e"

    def explode(*_args, **_kwargs):
        assert (tmp_path / "packet.bin").read_bytes() == packet
        raise RuntimeError("Unexpected parser bug")

    instance = decoder(tmp_path, ParseContext("ax25", framing="ax25"), Mock(parse=explode))
    instance._on_packet_decoded(packet)
    saved = json.loads((tmp_path / "packet.json").read_text())
    output = instance.data_queue.get_nowait()["output"]
    assert saved["telemetry"] == output["telemetry"]
    assert saved["telemetry"]["payload_status"] == "error"
    assert saved["telemetry"]["raw"]["packet_hex"] == packet.hex()
    assert saved["parse_context"]["hdlc_flags"] is True
    assert instance.stats["errors"] == 0


def test_capture_preview_and_reparse_use_identical_context(tmp_path):
    directory = tmp_path / "data" / "decoded"
    directory.mkdir(parents=True)
    sample = viewer_fixtures()["real"]["uwe4"]
    original = bytes.fromhex(sample["packet"]["hex"])
    instance = decoder(directory, ParseContext(**sample["parse_context"]))
    instance._on_packet_decoded(original)
    saved = json.loads((directory / "packet.json").read_text())
    preview = reparse.preview_packet(tmp_path, "/decoded/packet.bin")
    updated = reparse.reparse_packet(tmp_path, "/decoded/packet.bin")
    expected = parse_packet(original, ParseContext.from_metadata(saved))
    assert saved["telemetry"] == expected == preview["telemetry"] == updated["telemetry"]
    assert instance.data_queue.get_nowait()["output"]["telemetry"] == expected


@pytest.mark.parametrize(
    "framing,protocol", [("ax100_rs", "csp"), ("ax100_asm", "csp"), ("doka", "ccsds")]
)
def test_central_framing_mapping_overrides_wrong_legacy_metadata(framing, protocol):
    assert (
        ParseContext.from_metadata(
            {"decoder_config": {"framing": framing, "payload_protocol": "proprietary"}}
        ).protocol
        == protocol
    )


@pytest.mark.parametrize("protocol", ["csp", "ccsds", "proprietary", "lora", "unknown"])
def test_non_ax25_flags_are_ordinary_bytes(protocol):
    packet = b"\x7e\x00\x01\x7e"
    result = parse_packet(packet, ParseContext(protocol))
    assert result["raw"]["packet_hex"] == packet.hex()
    assert ParseContext(protocol).packet_bytes(packet) == packet


@pytest.mark.parametrize(
    "kwargs",
    [
        {"protocol": []},
        {"protocol": "csp", "csp_version": True},
        {"protocol": "csp", "frame_size": "10"},
        {"protocol": "csp", "hdlc_flags": 1},
    ],
)
def test_invalid_saved_context_has_clear_validation(kwargs):
    with pytest.raises(ValueError):
        ParseContext(**kwargs)


@pytest.mark.parametrize(
    "version,header,expected",
    [
        (
            1,
            ((2 << 30) | (9 << 25) | (17 << 20) | (35 << 14) | (42 << 8) | 0xA5).to_bytes(4, "big"),
            {"prio": 2, "src": 9, "dst": 17, "dport": 35, "sport": 42, "flags": 0xA5},
        ),
        (
            2,
            ((3 << 46) | (1234 << 32) | (5678 << 18) | (35 << 12) | (42 << 6) | 0x25).to_bytes(
                6, "big"
            ),
            {"prio": 3, "src": 5678, "dst": 1234, "dport": 35, "sport": 42, "flags": 0x25},
        ),
    ],
)
def test_csp_version_is_explicit(version, header, expected):
    result = CSPParser().parse(header + b"body", version=version)
    assert result["payload"] == b"body"
    assert {key: result["headers"][key] for key in expected} == expected
    assert CSPParser().parse(header[:3], version=version)["success"] is False


def test_protocol_detection_and_rejection_are_conservative():
    parser = TelemetryParser()
    assert parser.parse(bytes.fromhex("0001c000000001"))["protocol"] == "ccsds"
    assert parser.parse(b"arbitrary packet bytes")["protocol"] == "unknown"
    result = parser.parse(bytes.fromhex("0001c00000ff01"), protocol_hint="ccsds")
    assert result["envelope_status"] == "malformed"
    assert "length mismatch" in result["error"]
    # Native GEOSCAN layout can decode without valid AX.25 address bytes.
    result = viewer_fixtures()["real"]["geoscan"]["telemetry"]
    assert result["payload_status"] == "decoded"
    assert not result.get("frame")


def test_registry_supports_tuple_ax25_and_protocol_service_hints():
    parser = TelemetryParser()
    selected = Mock(
        parse=Mock(return_value={"values": {"test": 0}}), parser_id="custom", legacy_name="custom"
    )
    sample = viewer_fixtures()["real"]["uwe4"]
    parser.register_payload_parser(("ax25", "DP0UWH", None), selected)
    result = parse_packet(
        bytes.fromhex(sample["packet"]["hex"]), ParseContext(**sample["parse_context"]), parser
    )
    assert result["parser_id"] == "custom"
    parser.register_payload_parser(("csp", None, 7), selected)
    assert (
        parser.parse(
            b"\0" * 5, protocol_hint="csp", service_hint=7, parser_hint={"framing": "ax100_rs"}
        )["parser_id"]
        == "custom"
    )
    assert (
        parser.parse(b"\0" * 5, protocol_hint="csp", parser_hint={"parser": []})["payload_status"]
        == "unsupported"
    )


def test_legacy_readings_are_normalized_without_changing_source():
    source = {"telemetry": legacy_cases()["unavailable"]}
    before = deepcopy(source)
    result = normalize_metadata(source)["telemetry"]
    groups = {group["id"]: group for group in result["payload"]["records"][0]["groups"]}
    assert groups["battery_a"]["field_info"]["batt_a_voltage_v"]["unit"] == "V"
    assert groups["battery_a"]["values"]["batt_a_current_ma"] is None
    assert groups["battery_b"]["values"]["batt_b_soc_pct"] == 0
    assert groups["panels"]["values"]["panel_neg_x_temp_c"] is None
    assert result["parser_revision"] == 0
    assert (
        source["telemetry"]["telemetry"]["field_info"]
        == before["telemetry"]["telemetry"]["field_info"]
    )
    json.dumps(result, allow_nan=False)


def test_legacy_inference_is_isolated_and_explicit_metadata_wins():
    for identity in ({"spec": "uwe4"}, {"satellite": "UWE-4"}, {}):
        result = normalize_metadata(
            {
                "telemetry": {
                    "telemetry": {
                        **identity,
                        "values": {"batt_a_temp_c": {"value": -5, "unit": None}},
                    }
                }
            }
        )
        group = result["telemetry"]["payload"]["records"][0]["groups"][0]
        assert group["id"] == "battery_a"
        assert group["field_info"]["batt_a_temp_c"]["unit"] == "°C"
    group = viewer_fixtures()["legacy"]["custom"]["telemetry"]["payload"]["records"][0]["groups"][0]
    assert group["id"] == "custom_sensors"
    assert list(group["values"]) == ["new_sensor_raw", "batt_a_current_ma", "batt_a_voltage_v"]
    assert group["field_info"]["new_sensor_raw"]["calibrated"] is False


def test_aprs_legacy_decoding_is_on_backend():
    aprs = viewer_fixtures()["legacy"]["aprs"]["telemetry"]["payload"]["aprs"]
    assert aprs["position"]["latitude"] == pytest.approx(40.601269)
    assert aprs["telemetry"]["channels"] == [419]


@pytest.mark.parametrize("bad_status", ["malformed", "error", "unsupported"])
def test_failed_reparse_preserves_previously_decoded_values(tmp_path, monkeypatch, bad_status):
    directory = tmp_path / "data" / "decoded"
    directory.mkdir(parents=True)
    sample = viewer_fixtures()["real"]["uwe4"]
    packet = directory / "packet.bin"
    packet.write_bytes(bytes.fromhex(sample["packet"]["hex"]))
    path = packet.with_suffix(".json")
    path.write_text(json.dumps(sample))
    before = path.read_bytes()
    result = normalize_result({"success": True, "payload_status": bad_status})
    monkeypatch.setattr(reparse, "_decode_packet", lambda *_: result)
    with pytest.raises(ValueError):
        reparse.reparse_packet(tmp_path, "/decoded/packet.bin")
    assert path.read_bytes() == before


def test_partial_malformed_messages_cannot_replace_saved_data(tmp_path, monkeypatch):
    directory = tmp_path / "data" / "decoded"
    directory.mkdir(parents=True)
    packet = directory / "packet.bin"
    packet.write_bytes(b"packet")
    path = packet.with_suffix(".json")
    path.write_text(json.dumps(viewer_fixtures()["real"]["uwe4"]))
    before = path.read_bytes()
    result = normalize_result({"success": True, **legacy_cases()["messages"]})
    assert result["payload_status"] == "partial"
    monkeypatch.setattr(reparse, "_decode_packet", lambda *_: result)
    with pytest.raises(ValueError):
        reparse.reparse_packet(tmp_path, "/decoded/packet.bin")
    assert path.read_bytes() == before


@pytest.mark.asyncio
async def test_view_is_read_only_and_does_not_require_parser_context(tmp_path, monkeypatch):
    directory = tmp_path / "data" / "decoded"
    directory.mkdir(parents=True)
    packet = directory / "packet.bin"
    packet.write_bytes(b"packet")
    path = packet.with_suffix(".json")
    path.write_text(json.dumps({"telemetry": legacy_cases()["housekeeping"]}))
    before = {p.name: (p.read_bytes(), p.stat().st_mtime_ns) for p in directory.iterdir()}
    inventory = SimpleNamespace(roots=SimpleNamespace(backend=tmp_path), rebuild=Mock())
    publish = Mock()
    monkeypatch.setattr(handler, "get_inventory", lambda: inventory)
    monkeypatch.setattr(handler, "publish_ready_artifacts", publish)
    sio = SimpleNamespace(emit=AsyncMock())
    result = await handler.view_telemetry(
        sio, {"url": "/decoded/packet.bin"}, logging.getLogger(__name__), "sid"
    )
    assert result["success"] is True
    assert result["data"]["telemetry"]["schema_version"] == 1
    assert {p.name: (p.read_bytes(), p.stat().st_mtime_ns) for p in directory.iterdir()} == before
    inventory.rebuild.assert_not_called()
    publish.assert_not_called()
    sio.emit.assert_not_called()


def test_nonfinite_readings_are_strict_json_and_unknown_objects_fail():
    assert json_safe([float("nan"), float("inf"), b"\x01"]) == [None, None, "01"]
    with pytest.raises(TypeError):
        json_safe(object())
    with pytest.raises(ValueError, match="schema"):
        normalize_metadata({"telemetry": {"schema_version": 999}})


@pytest.mark.parametrize(
    "contents",
    [{"telemetry": [1]}, {"telemetry": {"values": []}}, {"telemetry": {"field_info": []}}],
)
def test_invalid_legacy_shapes_raise_validation_errors(contents):
    with pytest.raises(ValueError):
        normalize_metadata({"telemetry": contents})


def test_partial_reparse_cannot_drop_a_previously_supported_subsystem(tmp_path, monkeypatch):
    directory = tmp_path / "data" / "decoded"
    directory.mkdir(parents=True)
    packet = directory / "packet.bin"
    packet.write_bytes(b"packet")
    path = packet.with_suffix(".json")
    saved = viewer_fixtures()["real"]["umka"]
    path.write_text(json.dumps(saved))
    before = path.read_bytes()
    result = deepcopy(saved["telemetry"])
    result["payload_status"] = result["payload"]["status"] = "partial"
    result["payload"]["records"][1].update(status="unsupported", groups=[])
    monkeypatch.setattr(reparse, "_decode_packet", lambda *_: result)
    with pytest.raises(ValueError, match="preserved"):
        reparse.reparse_packet(tmp_path, "/decoded/packet.bin")
    assert path.read_bytes() == before


def test_legacy_colibri_parser_identity_preserves_named_flags():
    result = normalize_metadata(
        {
            "telemetry": {
                "parser": "ax25+ColibriSGeoscanAx25Parser",
                "telemetry": {"values": {"obc_activity": {"camera": False}}},
            }
        }
    )["telemetry"]
    group = result["payload"]["records"][0]["groups"][0]
    assert group["values"] == {"obc_activity_camera": False}
    assert group["field_info"]["obc_activity_camera"]["label"] == "Camera"


def test_hdlc_convention_cannot_be_assigned_to_a_non_ax25_packet():
    with pytest.raises(ValueError, match="require AX.25"):
        ParseContext("csp", hdlc_flags=True)
