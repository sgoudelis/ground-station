"""End-to-end coverage for the raw-IQ APRS receive and output paths."""

import json
import queue
from pathlib import Path

import numpy as np

from demodulators.aprsdecoder import APRSDecoder, APRSFlowgraph, DecoderStatus
from pipeline.config.decoderconfig import DecoderConfig
from pipeline.registries.decoderregistry import DecoderRegistry
from telemetry.parser import TelemetryParser


def _ax25_address(callsign: str, final: bool = False) -> bytes:
    return bytes(ord(character) << 1 for character in callsign.ljust(6)) + bytes(
        [0x61 if final else 0x60]
    )


def _crc_x25(data: bytes) -> int:
    crc = 0xFFFF
    for value in data:
        crc ^= value
        for _ in range(8):
            crc = (crc >> 1) ^ (0x8408 if crc & 1 else 0)
    return crc ^ 0xFFFF


def _least_significant_bits(data: bytes) -> list[int]:
    return [(byte >> bit) & 1 for byte in data for bit in range(8)]


def _bit_stuff(bits: list[int]) -> list[int]:
    stuffed = []
    consecutive_ones = 0
    for bit in bits:
        stuffed.append(bit)
        consecutive_ones = consecutive_ones + 1 if bit else 0
        if consecutive_ones == 5:
            stuffed.append(0)
            consecutive_ones = 0
    return stuffed


def _aprs_frame() -> bytes:
    frame = (
        _ax25_address("APRS")
        + _ax25_address("N0CALL", final=True)
        + b"\x03\xf0>GROUND-STATION-RAW-IQ"
        + (b" " * 80)
    )
    return frame + _crc_x25(frame).to_bytes(2, "little")


def _aprs_iq(sample_rate: int, fm_deviation: int = 3000) -> np.ndarray:
    """Generate NBFM IQ whose demodulated audio is a Bell 202 AX.25 frame."""
    flag = _least_significant_bits(b"~")
    frame = _aprs_frame()
    # 540 flags place the frame across the four-second batch boundary.
    hdlc_bits = (flag * 540) + _bit_stuff(_least_significant_bits(frame)) + (flag * 30)

    nrzi_state = 0
    tones = []
    for bit in hdlc_bits:
        nrzi_state = ~(bit ^ nrzi_state) & 1
        tones.append(2200 if nrzi_state else 1200)

    output_samples = int(len(tones) * sample_rate / 1200)
    symbol_index = np.floor(np.arange(output_samples) * 1200 / sample_rate).astype(int)
    frequencies = np.asarray(tones)[symbol_index]
    audio_phase = np.cumsum(2 * np.pi * frequencies / sample_rate)
    bell202_audio = np.sin(audio_phase)

    fm_phase = np.cumsum(2 * np.pi * fm_deviation * bell202_audio / sample_rate)
    return np.exp(1j * fm_phase).astype(np.complex64)


def test_raw_iq_aprs_flowgraph_recovers_frame_across_batches():
    sample_rate = 48_000
    iq_samples = _aprs_iq(sample_rate)
    packets = []
    decoder = APRSFlowgraph(
        sample_rate=sample_rate,
        callback=lambda packet, callsigns: packets.append((packet, callsigns)),
        batch_interval=4.0,
    )

    split = sample_rate * 4
    decoder.process_samples(iq_samples[:split])
    decoder.process_samples(iq_samples[split:])
    decoder.flush_buffer()

    assert len(packets) == 1
    assert b"GROUND-STATION-RAW-IQ" in packets[0][0]
    assert packets[0][1] == {"from": "N0CALL-0", "to": "APRS-0"}


def test_chunked_sdr_translation_and_decimation_preserve_aprs_frame(tmp_path):
    """Exercise the preprocessing used by real, independently queued IQ chunks."""
    sdr_sample_rate = 240_000
    output_sample_rate = 48_000
    frequency_offset = 43_210
    chunk_size = 16_384  # Deliberately not divisible by the decimation factor.
    baseband = _aprs_iq(sdr_sample_rate)
    sample_indices = np.arange(len(baseband))
    offset_iq = baseband * np.exp(2j * np.pi * frequency_offset * sample_indices / sdr_sample_rate)

    decoder = APRSDecoder(
        queue.Queue(),
        queue.Queue(),
        "test-session",
        DecoderConfig(baudrate=1200, framing="aprs", config_source="test"),
        output_dir=str(tmp_path),
        vfo=1,
    )
    decoder.sdr_sample_rate = sdr_sample_rate
    decoder.decimation_factor = int(sdr_sample_rate / output_sample_rate)
    decoder.sample_rate = output_sample_rate
    decoder.decimation_filter = decoder._design_decimation_filter(
        decoder.INTERNAL_RF_BANDWIDTH, sdr_sample_rate
    )

    decimated_chunks = []
    for start in range(0, len(offset_iq), chunk_size):
        chunk = offset_iq[start : start + chunk_size]
        translated = decoder._frequency_translate(chunk, frequency_offset, sdr_sample_rate)
        decimated_chunks.append(decoder._decimate_iq(translated))

    packets = []
    flowgraph = APRSFlowgraph(
        sample_rate=output_sample_rate,
        callback=lambda packet, callsigns: packets.append((packet, callsigns)),
        batch_interval=20.0,
    )
    flowgraph.process_samples(np.concatenate(decimated_chunks))
    flowgraph.flush_buffer()

    assert len(packets) == 1
    assert b"GROUND-STATION-RAW-IQ" in packets[0][0]


def test_aprs_registry_uses_raw_iq_without_internal_audio_demodulator():
    capabilities = DecoderRegistry().get_capabilities("aprs")

    assert capabilities is not None
    assert capabilities.decoder_class is APRSDecoder
    assert capabilities.needs_raw_iq is True
    assert capabilities.required_demodulator is None
    assert DecoderRegistry().get_capabilities("afsk") is None


def test_aprs_decoder_writes_common_packet_and_metadata_outputs(tmp_path):
    data_queue = queue.Queue()
    config = DecoderConfig(
        baudrate=1200,
        framing="aprs",
        config_source="test",
        deviation=500,
        af_carrier=1700,
        satellite={"norad_id": 25544, "name": "ISS"},
        transmitter={
            "mode": "AFSK",
            "description": "APRS digipeater",
            "downlink_low": 145_825_000,
        },
    )
    decoder = APRSDecoder(
        queue.Queue(),
        data_queue,
        "test-session",
        config,
        output_dir=str(tmp_path),
        vfo=1,
    )
    decoder.telemetry_parser = TelemetryParser()
    decoder.stats = {"packets_decoded": 0, "data_messages_out": 0, "errors": 0}
    decoder.sample_rate = 48_000
    decoder.sdr_sample_rate = 2_400_000
    decoder.sdr_center_freq = 145_825_000
    decoder.cached_vfo_state = {
        "center_freq": 145_825_000,
        "bandwidth": 12_500,
        "active": True,
    }

    frame = _aprs_frame()
    payload = b"\x7e" + frame + b"\x7e"
    decoder._on_packet_decoded(
        payload,
        {"from": "N0CALL-0", "to": "APRS-0"},
    )

    output_message = data_queue.get_nowait()
    binary_path = Path(output_message["output"]["filepath"])
    metadata_path = Path(output_message["output"]["metadata_filepath"])
    metadata = json.loads(metadata_path.read_text())

    assert output_message["type"] == "decoder-output"
    assert output_message["decoder_type"] == "aprs"
    assert binary_path.read_bytes() == payload
    assert binary_path.parent.name.endswith(".gsaprs")
    assert binary_path.parent.parent.name == "aprs_N0CALL-0"
    assert metadata["decoder"]["type"] == "aprs"
    assert metadata["decoder_config"] == {
        "source": "test",
        "framing": "aprs",
        "payload_protocol": "ax25",
    }
    assert metadata["demodulator_parameters"]["input"] == "raw_iq"


def test_aprs_status_and_stats_power_values_are_json_serializable(tmp_path):
    data_queue = queue.Queue()
    decoder = APRSDecoder(
        queue.Queue(),
        data_queue,
        "test-session",
        DecoderConfig(baudrate=1200, framing="aprs", config_source="test"),
        output_dir=str(tmp_path),
        vfo=1,
    )
    decoder.stats = {
        "packets_decoded": 0,
        "data_messages_out": 0,
        "errors": 0,
    }

    # complex64 IQ produces a numpy.float32 power value before normalization.
    power_dbfs = decoder._measure_signal_power(
        np.asarray([0.25 + 0.25j, 0.5 + 0.5j], dtype=np.complex64)
    )
    decoder._update_power_measurement(power_dbfs)
    decoder._send_status_update(DecoderStatus.LISTENING)
    decoder._send_stats_update()

    status_message = data_queue.get_nowait()
    stats_message = data_queue.get_nowait()
    json.dumps(status_message)
    json.dumps(stats_message)
    assert isinstance(status_message["info"]["signal_power_dbfs"], float)
    assert isinstance(stats_message["stats"]["signal_power_avg_dbfs"], float)
