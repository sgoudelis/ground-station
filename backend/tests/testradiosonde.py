"""Radiosonde channel continuity, common artifacts, and the real RS receive path."""

import json
import logging
import multiprocessing
import queue
import shutil
import subprocess
import time
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import psutil
import pytest
from scipy import signal

from demodulators.radiosondedecoder import RadiosondeDecoder, SondeChannel
from handlers.entities import vfo as vfohandlers
from pipeline.config.decoderconfigservice import DecoderConfigService
from pipeline.registries.decoderregistry import DecoderRegistry
from telemetry.context import ParseContext
from telemetry.parser import TelemetryParser
from telemetry.radiosonde import RadiosondeParser
from telemetry.reparse import reparse_packet, view_packet
from telemetry.service import parse_packet
from vfos.state import VFOManager

pytestmark = pytest.mark.unit
FRAME = bytes.fromhex((Path(__file__).parent / "fixtures/radiosonde/rs41.hex").read_text())
REPORT = {
    "type": "RS41",
    "subtype": "RS41-SGP",
    "id": "TEST0042",
    "frame": 42,
    "datetime": "2026-01-06T00:00:00.000Z",
    "ref_datetime": "GPS",
    "lat": 0.0,
    "lon": 0.0,
    "alt": 1000.0,
    "temp": -12.5,
    "humidity": 42.0,
    "pressure": 900.0,
    "batt": 3.0,
}


def _decoder(tmp_path, family="rs41"):
    decoder = RadiosondeDecoder(
        queue.Queue(),
        queue.Queue(),
        "test-session",
        DecoderConfigService().get_config("radiosonde", overrides={"radiosonde_type": family}),
        output_dir=str(tmp_path),
        vfo=1,
    )
    decoder.telemetry_parser = TelemetryParser()
    decoder.stats = {
        "packets_decoded": 0,
        "data_messages_out": 0,
        "errors": 0,
        "iq_chunks_in": 0,
        "samples_in": 0,
        "samples_out": 0,
        "samples_dropped_out_of_band": 0,
        "iq_discontinuities": 0,
    }
    decoder.cached_vfo_state = {"center_freq": 403_000_000, "bandwidth": 20000, "active": True}
    return decoder


@pytest.mark.parametrize("input_rate", [240_000, 250_000, 2_400_000])
def test_channel_preserves_chunk_clock_and_rejects_adjacent_signals(input_rate):
    count = input_rate // 5
    offset = 43_210
    times = np.arange(count) / input_rate
    wanted = np.exp(2j * np.pi * (offset + 1000) * times)
    adjacent = np.exp(2j * np.pi * (offset + 35000) * times)
    iq = (wanted + adjacent).astype(np.complex64)
    channel = SondeChannel(input_rate, 48000, offset, 20000)
    chunks = [channel.process(iq[start : start + 8191]) for start in range(0, count, 8191)]
    actual = np.concatenate(chunks)
    whole = SondeChannel(input_rate, 48000, offset, 20000).process(iq)
    assert actual.dtype == np.complex64
    assert len(actual) == 9600
    np.testing.assert_allclose(actual, whole, atol=2e-6)
    # After settling, only the selected 1-kHz tone should remain near unit power.
    steady = actual[1000:]
    frequency = np.angle(np.vdot(steady[:-1], steady[1:])) * 48000 / (2 * np.pi)
    assert frequency == pytest.approx(1000, abs=0.5)
    assert np.mean(np.abs(steady) ** 2) == pytest.approx(1, abs=0.02)


def test_decoder_config_and_registry_do_not_infer_satellite_framing():
    service = DecoderConfigService()
    config = service.get_config("radiosonde", transmitter={"baud": 9600, "framing": "ax25"})
    changed = service.get_config("radiosonde", overrides={"radiosonde_sample_rate": 96000})
    assert (config.baudrate, config.framing, config.radiosonde_sample_rate) == (0, "auto", 48000)
    assert config.radiosonde_type == "auto"
    assert config != changed
    assert config.to_dict()["radiosonde_sample_rate"] == 48000
    with pytest.raises(ValueError, match="sample rate"):
        service.get_config("radiosonde", overrides={"radiosonde_sample_rate": "bad"})
    capabilities = DecoderRegistry().get_capabilities("radiosonde")
    assert capabilities.decoder_class is RadiosondeDecoder
    assert capabilities.needs_raw_iq
    assert capabilities.required_demodulator is None
    assert "radiosonde_sample_rate" in capabilities.restart_on_params
    assert "radiosonde_type" in capabilities.restart_on_params
    with pytest.raises(ValueError, match="Radiosonde type"):
        service.get_config("radiosonde", overrides={"radiosonde_type": "unknown"})
    for family, baudrate in [("rs41", 4800), ("dfm", 2500), ("m10m20", 9600)]:
        forced = service.get_config("radiosonde", overrides={"radiosonde_type": family})
        assert (forced.radiosonde_type, forced.baudrate) == (family, baudrate)
        assert forced != config
        assert forced.to_dict()["radiosonde_type"] == family


@pytest.mark.parametrize("relative", ["decoded", "observations/sonde.gsobs/decoded"])
def test_common_files_events_and_reparse_preserve_calibrated_report(tmp_path, relative):
    folder = tmp_path / "data" / relative
    decoder = _decoder(folder)
    decoder.sdr_sample_rate, decoder.sdr_center_freq = 2_400_000, 403_000_000
    decoder._handle_stdout(FRAME.hex().encode() + b" [OK]")
    decoder._handle_stdout(json.dumps(REPORT).encode())
    event = decoder.data_queue.get_nowait()
    assert event["type"] == "decoder-output"
    assert event["decoder_type"] == "radiosonde"
    assert event["vfo"] == 1
    output = event["output"]
    packet = Path(output["filepath"])
    assert packet.parent.parent == folder / "radiosonde_RS41_TEST0042"
    assert packet.read_bytes() == FRAME
    saved = json.loads(Path(output["metadata_filepath"]).read_text())
    assert saved["parse_context"]["decoder_report"] == REPORT
    assert saved["signal"]["sample_rate_hz"] == 48000
    assert saved["telemetry"] == output["telemetry"]
    values = saved["telemetry"]["telemetry"]["values"]
    assert values["temp"] == -12.5
    assert values["id"] == "TEST0042"
    assert (
        saved["telemetry"]["payload"]["records"][0]["groups"][0]["field_info"]["temp"]["unit"]
        == "°C"
    )
    url = "/" + packet.relative_to(tmp_path / "data").as_posix()
    assert view_packet(tmp_path, url)["telemetry"] == saved["telemetry"]
    assert reparse_packet(tmp_path, url)["telemetry"] == saved["telemetry"]


def test_frame_and_report_pairing_never_reuses_previous_report(tmp_path):
    decoder = _decoder(tmp_path)
    decoder._handle_stdout(json.dumps(REPORT).encode())  # No preceding frame.
    decoder._handle_stdout(FRAME.hex().encode())
    decoder._handle_stdout(b"not a frame")
    decoder._handle_stdout(json.dumps(REPORT).encode())
    decoder._handle_stdout(FRAME.hex().encode())
    decoder._handle_stdout(json.dumps({**REPORT, "frame": 43}).encode())
    assert decoder.packet_count == 0
    assert not list(tmp_path.iterdir())
    assert decoder.stats["errors"] == 1


def test_encrypted_reports_do_not_present_placeholder_positions():
    result = parse_packet(
        FRAME,
        ParseContext(
            protocol="radiosonde",
            framing="rs41",
            decoder_report={**REPORT, "encrypted": True},
        ),
    )
    assert result["payload_status"] == "decoded"
    assert result["telemetry"]["values"]["encrypted"] is True
    assert "lat" not in result["telemetry"]["values"]
    assert "datetime" not in result["telemetry"]["values"]


@pytest.mark.parametrize("family", ["rs41", "auto"])
def test_retunes_and_queue_gaps_reset_receiver_before_changing_metadata(
    tmp_path, monkeypatch, family
):
    decoder = _decoder(tmp_path, family)
    starts = []
    monkeypatch.setattr(
        decoder, "_start_rs", lambda: starts.append(decoder.cached_vfo_state.copy())
    )
    monkeypatch.setattr(decoder, "_write_iq", lambda _samples: None)
    message = {
        "samples": np.ones(8191, dtype=np.complex64),
        "sample_rate": 240000,
        "center_freq": 403_000_000,
        "iq_sequence": 1,
        "vfo_states": {1: decoder.cached_vfo_state.copy()},
    }
    decoder._process_iq(message)
    decoder._process_iq({**message, "iq_sequence": 2})
    assert len(starts) == 1
    decoder.decoder_report = REPORT
    decoder.confirmed = True
    decoder._process_iq({**message, "iq_sequence": 4})
    assert decoder.decoder_report is None
    assert not decoder.confirmed
    assert decoder.active_type == (None if family == "auto" else family)
    assert len(starts) == 2
    assert decoder.stats["iq_discontinuities"] == 1
    decoder._process_iq(
        {
            **message,
            "iq_sequence": 5,
            "vfo_states": {1: {**message["vfo_states"][1], "center_freq": 403_010_000}},
        }
    )
    assert len(starts) == 3
    assert starts[-1]["center_freq"] == 403_010_000


def test_missing_binary_reports_error_and_stops(tmp_path, monkeypatch):
    decoder = _decoder(tmp_path)
    monkeypatch.setattr(shutil, "which", lambda _program: None)
    decoder.run()
    statuses = list(decoder.data_queue.queue)
    assert statuses[-1]["status"] == "error"
    assert "rs41mod" in statuses[-1]["info"]["error"]
    assert decoder.running.value == 0


def _transmission(input_rate=250000, offset=43210):
    # RS41 transmits whitened bytes, LSB first, using 4800-baud GFSK.
    whitening = bytes.fromhex(
        "96833e51b14908983205590ef944c6262160c2ea795d6da15469470cdce85cf1"
        "f776827f0799a22c937c3063f5102e61d0bcb4b606aaf423786e3baebf7b4cc1"
    )
    transmitted = bytes(value ^ whitening[i % 64] for i, value in enumerate(FRAME))
    data = b"\x55" * 80 + (transmitted + b"\x55" * 80) * 3
    bits = np.unpackbits(np.frombuffer(data, dtype=np.uint8), bitorder="little")
    count = int(len(bits) * input_rate / 4800)
    symbols = bits[(np.arange(count) * 4800 // input_rate).astype(int)].astype(float) * 2 - 1
    # Smooth the instantaneous frequency to approximate a BT=0.5 GFSK transmitter.
    kernel = signal.windows.gaussian(81, std=input_rate / 4800 * 0.18)
    symbols = signal.convolve(symbols, kernel / kernel.sum(), mode="same")
    phase = np.cumsum(2 * np.pi * (offset + 2400 * symbols) / input_rate)
    return np.exp(1j * phase).astype(np.complex64)


@pytest.mark.skipif(
    not all(shutil.which(p) for p in ("rs41mod", "dfm09mod", "m10m20mod", "dft_detect")),
    reason="RS tools are not installed",
)
@pytest.mark.parametrize("processing_rate", [48000, 96000])
@pytest.mark.parametrize("family", ["rs41", "dfm", "m10", "m20"])
@pytest.mark.parametrize("automatic", [False, True])
def test_real_rs_process_decodes_resampled_iq_and_stops_cleanly(
    tmp_path, processing_rate, family, automatic
):
    iq_queue, output_queue = multiprocessing.Queue(), multiprocessing.Queue()
    decoder = RadiosondeDecoder(
        iq_queue,
        output_queue,
        "real-rs-test",
        DecoderConfigService().get_config(
            "radiosonde",
            overrides={
                "radiosonde_sample_rate": processing_rate,
                "radiosonde_type": (
                    "auto" if automatic else {"m10": "m10m20", "m20": "m10m20"}.get(family, family)
                ),
            },
        ),
        output_dir=str(tmp_path),
        vfo=1,
    )
    decoder.start()
    events = []
    children = []
    try:
        iq = _transmission() if family == "rs41" else _other_transmission(family)
        for index, start in enumerate(range(0, len(iq), 8191)):
            iq_queue.put(
                {
                    "samples": iq[start : start + 8191],
                    "sample_rate": 250000,
                    "center_freq": 403_000_000,
                    "iq_sequence": index,
                    "vfo_states": {
                        1: {"center_freq": 403_043_210, "bandwidth": 20000, "active": True}
                    },
                }
            )
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            try:
                event = output_queue.get(timeout=0.1)
                events.append(event)
                if event["type"] == "decoder-output":
                    break
            except queue.Empty:
                if not decoder.is_alive():
                    break
        outputs = [event for event in events if event["type"] == "decoder-output"]
        assert outputs, events
        report = outputs[0]["output"]["telemetry"]["telemetry"]["values"]
        assert report["type"] == family.upper()
        assert (
            report["id"]
            == {
                "rs41": "TEST0042",
                "dfm": "DFM-23000042",
                "m10": "M10-203-1-01605",
                "m20": "M20-702-7-01032",
            }[family]
        )
        assert report["alt"] == pytest.approx(1000, abs=1)
        recorded = Path(outputs[0]["output"]["filepath"]).read_bytes()
        if family != "dfm":
            expected = bytes.fromhex(
                (Path(__file__).parent / f"fixtures/radiosonde/{family}.hex").read_text()
            )
            assert recorded == expected
        else:
            assert len(recorded) == 33
        if automatic:
            assert any(e.get("info", {}).get("phase") == "detecting" for e in events)
            assert any(e.get("info", {}).get("phase") == "confirming" for e in events)
        children = psutil.Process(decoder.pid).children(recursive=True)
        assert children
    finally:
        decoder.stop()
        decoder.join(timeout=5)
        if decoder.is_alive():
            decoder.kill()
            decoder.join(timeout=2)
        # An aborted test must not wait on unread IQ queue feeder data.
        iq_queue.cancel_join_thread()
        iq_queue.close()
        output_queue.close()
    assert decoder.exitcode == 0
    assert not any(child.is_running() for child in children)


def _other_transmission(family, input_rate=250000, offset=43210):
    fixture = (Path(__file__).parent / f"fixtures/radiosonde/{family}.hex").read_text()
    if family == "dfm":
        bits = []
        for line in fixture.splitlines():
            encoded = "".join(line.split(">", 1)[1].split())
            # RS rawhex prints the four bits of each nibble least significant first.
            data = [int(c, 16) >> j & 1 for c in encoded for j in range(4)]
            packet = [int(c) for c in "0100010111001111"] + data
            bits += [symbol for bit in packet for symbol in (1 - bit, bit)]
        baud = 2500
    else:
        frame = bytes.fromhex(fixture)
        bits = []
        for _ in range(8):
            bits += [int(c) for c in "10011001100110010100110010011001"]
            # The sync word fixes the differential encoder's starting polarity.
            previous = 1
            # M10/M20 use differential Manchester: a one retains the previous
            # decoded Manchester polarity, a zero changes it.
            for bit in np.unpackbits(np.frombuffer(frame, dtype=np.uint8)):
                previous ^= 1 ^ int(bit)
                bits += [1 - previous, previous]
            bits += [0, 1] * 1000  # Allow the codec to finish its longest frame read.
        baud = 9615 if family == "m10" else 9600
    symbols = np.array(bits, dtype=np.float64) * 2 - 1
    count = int(len(symbols) * input_rate / baud)
    values = symbols[(np.arange(count) * baud // input_rate).astype(int)]
    phase = np.cumsum(2 * np.pi * (offset + 3000 * values) / input_rate)
    return np.exp(1j * phase).astype(np.complex64)


@pytest.mark.parametrize(
    "detected,family", [("RS41", "rs41"), ("DFM9", "dfm"), ("M10", "m10m20"), ("M20", "m10m20")]
)
def test_detection_selects_supported_family_only_and_replays_bounded_history(
    tmp_path, monkeypatch, detected, family
):
    decoder = _decoder(tmp_path, "auto")
    decoder._handle_stdout(b"RS92: 0.999")
    assert decoder.detected_type is None
    decoder._handle_stdout(f"{detected}: -0.9810 , +2.0Hz".encode())
    assert decoder.detected_type == family
    assert not decoder.confirmed
    decoder._remember_iq(np.ones(10 * decoder.sample_rate, dtype=np.complex64))
    assert decoder.history_samples == decoder.HISTORY_SECONDS * decoder.sample_rate
    writes = []
    monkeypatch.setattr(decoder, "_start_rs", lambda: None)
    monkeypatch.setattr(decoder, "_write_iq", lambda chunk: writes.append(chunk))
    decoder._select_receiver(family)
    assert sum(map(len, writes)) == decoder.history_samples
    assert not decoder.confirmed
    assert decoder.active_type == family


def test_decode_loss_reacquires_but_manual_selection_stays_fixed(tmp_path, monkeypatch):
    for mode in ("auto", "rs41"):
        decoder = _decoder(tmp_path, mode)
        decoder.active_type = "rs41"
        decoder.confirmed = True
        decoder.stream_samples = 21 * decoder.sample_rate
        decoder.rs_process = type("LiveProcess", (), {"poll": lambda self: None})()
        switches = []
        monkeypatch.setattr(decoder, "_read_output", lambda: None)
        monkeypatch.setattr(decoder, "_select_receiver", switches.append)
        decoder._service_receiver()
        assert switches == ([None] if mode == "auto" else [])


@pytest.mark.parametrize(
    "family,program", [("dfm", "dfm09mod"), ("m10", "m10m20mod"), ("m20", "m10m20mod")]
)
def test_other_families_save_live_and_reparse_the_same_report(tmp_path, family, program):
    if not shutil.which(program):
        pytest.skip("RS codec is not installed")
    fixture = (Path(__file__).parent / f"fixtures/radiosonde/{family}.hex").read_bytes()
    options = (
        ["--rawhex", "--json", "--rawecc", "--auto"]
        if family == "dfm"
        else ["--rawhex", "--raw", "--json", "--silent"]
    )
    result = subprocess.run([program, *options], input=fixture, capture_output=True, check=True)
    decoder = _decoder(tmp_path / "data/decoded", "dfm" if family == "dfm" else "m10m20")
    for line in result.stdout.splitlines():
        decoder._handle_stdout(line)
    outputs = [
        event["output"] for event in decoder.data_queue.queue if event["type"] == "decoder-output"
    ]
    assert outputs
    output = outputs[-1]
    url = f"/decoded/{Path(output['filepath']).relative_to(tmp_path / 'data/decoded').as_posix()}"
    assert reparse_packet(tmp_path, url)["telemetry"] == output["telemetry"]
    values = output["telemetry"]["telemetry"]["values"]
    assert values["type"] == family.upper()
    assert values["alt"] == 1000
    # Reports without a preceding raw frame must never reuse a prior packet.
    before = decoder.packet_count
    decoder._handle_stdout(json.dumps(decoder.decoder_report).encode())
    assert decoder.packet_count == before


async def test_live_vfo_settings_start_and_restart_with_selected_family_and_rate(monkeypatch):
    session = "sonde-vfo-test"
    starts = []
    entries = {}

    def start_decoder(**kwargs):
        config = DecoderConfigService().get_config(
            "radiosonde", overrides=kwargs["decoder_param_overrides"]
        )
        starts.append(config)
        entries[1] = {"instance": SimpleNamespace(), "config": config}
        return True

    processes = SimpleNamespace(
        processes={"playback": {"data_queue": object(), "decoders": {session: entries}}},
        get_active_decoder=lambda _sdr, _sid, vfo: entries.get(vfo, {}).get("instance"),
        start_decoder=start_decoder,
        stop_decoder=lambda _sdr, _sid, vfo: entries.pop(vfo, None),
    )
    manager = VFOManager()
    monkeypatch.setattr(manager, "_session_vfo_states", {})
    monkeypatch.setattr(vfohandlers, "_decoder_param_overrides_cache", {})
    monkeypatch.setattr(vfohandlers, "process_manager", processes)
    monkeypatch.setattr(vfohandlers.session_tracker, "get_session_sdr", lambda _sid: "playback")
    manager.update_vfo_state(session, 1, center_freq=403000000, locked_transmitter_id="")

    async def apply(**updates):
        result = await vfohandlers.update_vfo_parameters(
            None, {"vfoNumber": 1, **updates}, logging.getLogger(__name__), session
        )
        assert result["success"]

    await apply(
        active=True,
        decoder="radiosonde",
        parametersEnabled=True,
        radiosonde_type="dfm",
        radiosonde_sample_rate=96000,
    )
    assert len(starts) == 1
    assert (starts[-1].radiosonde_type, starts[-1].radiosonde_sample_rate) == ("dfm", 96000)
    await apply(radiosonde_type="m10m20", radiosonde_sample_rate=48000)
    assert len(starts) == 2
    assert (starts[-1].radiosonde_type, starts[-1].radiosonde_sample_rate) == ("m10m20", 48000)
    await apply(radiosonde_type="m10m20", radiosonde_sample_rate=48000)
    assert len(starts) == 2
    await apply(parametersEnabled=False)
    assert starts[-1].radiosonde_type == "auto"
    assert starts[-1].radiosonde_sample_rate == 48000


@pytest.mark.parametrize("family", ["m10", "m20"])
def test_damaged_meteomodem_frames_and_wrong_report_identity_are_rejected(family):
    payload = bytes.fromhex(
        (Path(__file__).parent / f"fixtures/radiosonde/{family}.hex").read_text()
    )
    offset, length = (0x12, 3) if family == "m20" else (0x5D, 5)
    report = {
        "type": family.upper(),
        "id": "test",
        "frame": 1,
        "rawid": f"{family.upper()}_{payload[offset:offset+length].hex().upper()}",
    }
    parser = RadiosondeParser()
    parser.parse(payload, report)
    damaged = payload[:-1] + bytes([payload[-1] ^ 1])
    with pytest.raises(ValueError, match="checksum"):
        parser.parse(damaged, report)
    with pytest.raises(ValueError, match="serial"):
        parser.parse(payload, {**report, "rawid": "wrong"})


@pytest.mark.skipif(
    not all(shutil.which(p) for p in ("rs41mod", "dfm09mod", "m10m20mod", "dft_detect")),
    reason="RS tools are not installed",
)
def test_real_auto_receiver_reacquires_a_different_family_after_signal_loss(tmp_path):
    decoder = _decoder(tmp_path, "auto")
    sequence = 0

    def feed(iq):
        nonlocal sequence
        for start in range(0, len(iq), 8191):
            decoder._process_iq(
                {
                    "samples": iq[start : start + 8191],
                    "sample_rate": 250000,
                    "center_freq": 403000000,
                    "iq_sequence": sequence,
                    "vfo_states": {
                        1: {"center_freq": 403043210, "bandwidth": 20000, "active": True}
                    },
                }
            )
            sequence += 1

    def wait_for_family(family):
        deadline = time.monotonic() + 3
        while time.monotonic() < deadline:
            decoder._read_output(0.01)
            decoder._service_receiver()
            if decoder.confirmed and decoder.decoder_report["type"] == family:
                return
        pytest.fail(f"No confirmed {family} report; state={decoder.status}/{decoder.active_type}")

    try:
        feed(_transmission())
        wait_for_family("RS41")
        first_codec = decoder.rs_process
        # Flush the eight-second IQ history and exceed the confirmed codec's
        # loss timer without retuning or injecting an IQ sequence gap.
        quiet = np.zeros(250000, dtype=np.complex64)
        for _ in range(22):
            feed(quiet)
        assert decoder.active_type is None
        assert first_codec.poll() is not None
        detector = decoder.rs_process
        feed(_other_transmission("m20"))
        wait_for_family("M20")
        assert detector.poll() is not None
        assert decoder.stats["iq_discontinuities"] == 0
        types = {
            event["output"]["telemetry"]["telemetry"]["values"]["type"]
            for event in decoder.data_queue.queue
            if event["type"] == "decoder-output"
        }
        assert types == {"RS41", "M20"}
    finally:
        last_process = decoder.rs_process
        decoder._stop_rs()
    assert last_process.poll() is not None
