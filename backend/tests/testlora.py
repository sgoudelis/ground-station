import importlib.util
import os
import signal
import subprocess
import sys
from dataclasses import replace
from pathlib import Path

import pytest

from demodulators.loraconfig import lora_sync_symbols, normalize_lora
from pipeline.config.decoderconfigservice import DecoderConfigService
from telemetry.parser import TelemetryParser


@pytest.mark.unit
def test_config_metadata_overrides_and_legacy_tinygs_values():
    service = DecoderConfigService()
    config = service.get_config(
        "lora",
        transmitter={"description": "LoRa SF8 BW125 CR4/5"},
        overrides={"sync_word": "0x34", "fldro": False},
    )
    assert (config.sf, config.bw, config.cr, config.sync_word, config.ldro_mode) == (
        8,
        125000,
        1,
        [52],
        2,
    )
    assert config.framing == "lora" and config.baudrate == 0
    assert normalize_lora({"fldro": True})["ldro_mode"] == 1
    assert normalize_lora({"sync_word": []})["sync_word"] == [0, 0]
    assert normalize_lora({"preamble_len": 9})["preamble_len"] == 9
    for denominator in range(5, 9):
        assert normalize_lora({"cr": denominator})["cr"] == denominator - 4
    for key, value in {
        "ldro_mode": 0,
        "implicit_header": True,
        "payload_length": 107,
        "has_crc": False,
        "invert_iq": True,
    }.items():
        changed = replace(config, **{key: value})
        assert changed != config
        assert hash(changed) != hash(config)
        assert changed.to_dict()[key] == value


@pytest.mark.unit
@pytest.mark.parametrize("sf", range(7, 13))
def test_sync_bytes_use_signed_hardware_offsets(sf):
    assert lora_sync_symbols([0x2B], sf) == [16, ((1 << sf) - 40) % (1 << sf)]
    assert lora_sync_symbols([0x12], sf) == [8, 16]
    assert lora_sync_symbols([0x34], sf) == [24, 32]
    assert lora_sync_symbols([0xAB], sf) == [
        ((1 << sf) - 48) % (1 << sf),
        ((1 << sf) - 40) % (1 << sf),
    ]
    assert lora_sync_symbols([0, 0], sf) == [0, 0]
    assert lora_sync_symbols([8, 16], sf) == [8, 16]


@pytest.mark.unit
@pytest.mark.parametrize(
    "values",
    [
        {"sf": 6},
        {"sf": 8.1},
        {"bw": 0},
        {"cr": 9},
        {"sync_word": [256]},
        {"sync_word": [1, 2, 3]},
        {"preamble_len": 4},
        {"ldro_mode": 3},
        {"implicit_header": True, "payload_length": 1},
        {"invert_iq": "false"},
    ],
)
def test_rejects_unsafe_native_parameters(values):
    with pytest.raises((ValueError, TypeError)):
        normalize_lora(values)


@pytest.mark.unit
def test_lora_payload_remains_opaque():
    payload = b"TINYGS\xf2\x00\xff\x7e"
    result = TelemetryParser().parse(payload, protocol_hint="lora")
    assert result["protocol"] == "lora"
    assert result["raw"]["payload_hex"] == payload.hex()
    assert "headers" not in result


@pytest.mark.integration
@pytest.mark.parametrize(
    "scenario", ["graph", "worker", "modes", "meshtastic", "resampled", "persistence", "continuity"]
)
def test_native_recorded_lora(scenario):
    if importlib.util.find_spec("gnuradio") is None:
        if os.environ.get("GS_REQUIRE_LORA") == "1":
            pytest.fail("CI image must include GNU Radio and gr-lora_sdr")
        pytest.skip("GNU Radio is not installed")
    # Kill the complete native process group on timeout, including a worker child.
    with subprocess.Popen(
        [sys.executable, str(Path(__file__).with_name("lorarunner.py")), scenario],
        env={**os.environ, "PYTHONPATH": str(Path(__file__).resolve().parents[1])},
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        start_new_session=True,
    ) as process:
        try:
            stdout, stderr = process.communicate(timeout=60)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            stdout, stderr = process.communicate(timeout=5)
            pytest.fail(f"Native LoRa scenario timed out: {scenario}\n{stdout}\n{stderr}")
        assert process.returncode == 0, stdout + stderr
