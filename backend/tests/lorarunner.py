"""Native receiver regression, executed in a subprocess to isolate GNU Radio."""

import json
import multiprocessing
import queue
import sys
import tempfile
import time
from collections import defaultdict
from pathlib import Path

import numpy as np
import pmt
from gnuradio import blocks, gr, lora_sdr
from scipy.signal import resample_poly

from demodulators.loraconfig import normalize_lora
from demodulators.loradecoder import LoRaDecoder, LoRaFlowgraph
from pipeline.config.decoderconfig import DecoderConfig

FIXTURE = Path(__file__).parent / "fixtures" / "lora"
EXPECTED = bytes.fromhex(json.loads((FIXTURE / "expected.json").read_text())["hex"])


def samples():
    with np.load(FIXTURE / "kosar.npz") as fixture:
        return (fixture["iq"].astype(np.float32) * fixture["scale"]).view(np.complex64)


def receive(data, **overrides):
    events = queue.Queue()
    params = normalize_lora({"sf": 8, "sync_word": [0x34], **overrides})
    graph = LoRaFlowgraph(500000, 436100000, params, events)
    graph.start()
    try:
        # Deliberately split chirps and packets on irregular queue boundaries.
        start = 0
        sizes = (997, 13001, 4096, 653)
        index = 0
        while start < len(data):
            size = sizes[index % len(sizes)]
            graph.source.feed(data[start : start + size])
            start += size
            index += 1
        graph.source.feed(np.zeros(32768, dtype=np.complex64))
    finally:
        graph.close(drain=True)
    return list(events.queue)


def test_graph():
    valid = receive(samples())
    assert len(valid) == 1, valid
    assert valid[0][0] == EXPECTED
    assert valid[0][1]["crc_valid"] is True
    assert receive(samples(), sync_word=[0x12]) == []
    damaged = samples()
    damaged[125000:137500] = 0
    invalid = receive(damaged)
    assert len(invalid) == 1 and invalid[0][1]["crc_valid"] is False, invalid
    print(
        "Recorded IQ: exact payload, arbitrary chunk splits, wrong sync and failed CRC verified",
        flush=True,
    )


def transmit(payload, params):
    graph = gr.top_block()
    tag = gr.tag_t()
    tag.offset, tag.key, tag.value = 0, pmt.intern("packet_len"), pmt.from_long(len(payload))
    source = blocks.vector_source_b(list(payload), False, 1, [tag])
    sink = blocks.vector_sink_c()
    chain = [
        source,
        lora_sdr.whitening(False, True, ",", "packet_len"),
        lora_sdr.header(params["implicit_header"], params["has_crc"], params["cr"]),
        lora_sdr.add_crc(params["has_crc"]),
        lora_sdr.hamming_enc(params["cr"], params["sf"]),
        lora_sdr.interleaver(params["cr"], params["sf"], params["ldro_mode"], params["bw"]),
        lora_sdr.gray_demap(params["sf"]),
        lora_sdr.modulate(
            params["sf"], 500000, params["bw"], params["sync_word"], 32768, params["preamble_len"]
        ),
        sink,
    ]
    graph.connect(*chain)
    graph.run()
    result = np.array(sink.data(), dtype=np.complex64)
    graph.disconnect_all()
    return np.concatenate([np.zeros(16384, dtype=np.complex64), result])


def test_modes():
    payload = b"\x7e\x00\xffLoRa binary test\x00\x7e"
    for overrides in [
        {"sf": 7, "cr": 4, "implicit_header": True, "has_crc": False, "preamble_len": 12},
        {"sf": 8, "has_crc": False},
        {"sf": 11, "ldro_mode": 1},
        {"sf": 12, "ldro_mode": 2, "implicit_header": True},
    ]:
        params = normalize_lora({"sync_word": [0x34], "payload_length": len(payload), **overrides})
        valid = receive(transmit(payload, params), **params)
        assert len(valid) == 1 and valid[0][0] == payload, (params, valid)
        assert bool(valid[0][1]["crc"]) == params["has_crc"]
        if params["has_crc"]:
            assert valid[0][1]["crc_valid"] is True
    print(
        "Synthetic PHY: implicit/explicit headers, no-CRC, CR4/8, preamble12, LDRO, SF12 and binary bytes verified",
        flush=True,
    )


def test_meshtastic():
    payload = b"\xff\xff\xff\xffMeshtastic sync regression\x00\x7e"
    for sf in (7, 9, 11):
        params = normalize_lora({"sf": sf, "bw": 250000, "sync_word": [0x2B], "preamble_len": 16})
        # A captured SF11 Meshtastic packet uses sync bins 16 and 2008 (-40).
        # Supply hardware symbol offsets directly: the native transmitter also
        # expands byte 0x2B incorrectly, masking the receiver bug in a loopback.
        waveform = transmit(payload, {**params, "sync_word": [16, (1 << sf) - 40]})
        valid = receive(waveform, **params)
        assert len(valid) == 1 and valid[0][0] == payload, (params, valid)
        assert valid[0][1]["crc_valid"] is True
        assert receive(waveform, **{**params, "sync_word": [0x2A]}) == []
    print(
        "Meshtastic: signed sync offsets decode at SF7/9/11, exact binary payload and CRC verified",
        flush=True,
    )


def test_worker(sample_rate=500000, inverted=False):
    iq_queue, data_queue = multiprocessing.Queue(), multiprocessing.Queue()
    # On assertion failure there may be unconsumed IQ; do not hang the runner
    # waiting for a feeder thread whose consumer has already stopped.
    iq_queue.cancel_join_thread()
    params = normalize_lora({"sf": 8, "sync_word": [0x34], "invert_iq": inverted})
    config = DecoderConfig(baudrate=0, framing="lora", config_source="manual", **params)
    with tempfile.TemporaryDirectory() as output:
        decoder = LoRaDecoder(
            iq_queue, data_queue, "lora-regression", config, output_dir=output, vfo=1
        )
        decoder.start()
        received = []
        try:
            data = samples()
            if sample_rate != 500000:
                data = resample_poly(data, 8, 5).astype(np.complex64)
            if inverted:
                data = np.conj(data)
            # Exercise the real VFO mixer with a nonzero offset and logical RF center.
            offset = 37000
            data *= np.exp(2j * np.pi * offset * np.arange(len(data)) / sample_rate).astype(
                np.complex64
            )
            for index, start in enumerate(range(0, len(data), 12347)):
                iq_queue.put(
                    {
                        "samples": data[start : start + 12347],
                        "sample_rate": sample_rate,
                        "center_freq": 1,
                        "logical_center_freq_hz": 436100000 - offset,
                        "iq_sequence": index,
                        "playback_elapsed_seconds": start / sample_rate,
                        "vfo_states": {
                            1: {"active": True, "center_freq": 436100000, "bandwidth": 125000}
                        },
                    }
                )
            decoded = False
            deadline = time.monotonic() + 15
            while time.monotonic() < deadline:
                item = data_queue.get(timeout=5)
                received.append(item)
                decoded |= item["type"] == "decoder-output"
                if (
                    decoded
                    and item["type"] == "decoder-stats"
                    and item["perf_stats"]["samples_in"] == len(data)
                ):
                    break
            else:
                raise AssertionError(received)
        finally:
            decoder.stop()
            decoder.join(8)
            if decoder.is_alive():
                decoder.terminate()
                decoder.join()
                raise AssertionError("Receiver did not stop cleanly")
        assert decoder.exitcode == 0
        while True:
            try:
                received.append(data_queue.get(timeout=0.2))
            except queue.Empty:
                break
        files = list(Path(output).glob("*.bin"))
        assert len(files) == 1 and files[0].read_bytes() == EXPECTED, files
        meta = json.loads(files[0].with_suffix(".json").read_text())
        assert meta["decoder"]["crc_valid"] is True
        assert meta["telemetry"]["protocol"] == "lora"
        assert meta["signal"]["frequency_hz"] == 436100000
        stats = [item for item in received if item["type"] == "decoder-stats"][-1]
        assert stats["perf_stats"]["packets_decoded"] == 1
        assert stats["perf_stats"]["errors"] == 0
        assert stats["perf_stats"]["samples_in"] == len(data)
        assert "samples_in_per_sec" in stats["rates"]
        assert received[-1]["status"] == "idle"
    iq_queue.close()
    data_queue.close()
    print(
        "Worker: VFO shift, files, exact hex, CRC metadata, UI events, stats and shutdown verified",
        flush=True,
    )


def test_persistence():
    from telemetry.parser import TelemetryParser

    config = DecoderConfig(baudrate=0, framing="lora", config_source="manual")
    with tempfile.TemporaryDirectory() as output:
        decoder = LoRaDecoder(queue.Queue(), queue.Queue(), "binary", config, output_dir=output)
        decoder.events = queue.Queue()
        decoder.stats = defaultdict(int)
        decoder.telemetry_parser = TelemetryParser()
        payload = b"\x7e\x00\xff\x7e"
        decoder.events.put((b"bad", {"crc": 1, "crc_valid": False, "cr": 1}))
        decoder.events.put((payload, {"crc": 0, "pay_len": len(payload), "cr": 1}))
        decoder._drain_packets()
        assert decoder.packet_count == 1 and decoder.stats["crc_failures"] == 1
        file = next(Path(output).glob("*.bin"))
        assert file.read_bytes() == payload
        metadata = json.loads(file.with_suffix(".json").read_text())
        assert metadata["decoder"]["crc_present"] is False
        assert metadata["decoder"]["crc_valid"] is None
        assert metadata["telemetry"]["raw"]["payload_hex"] == payload.hex()
        assert decoder.stats["errors"] == 0
    print(
        "Persistence: corrupt packets rejected, no-CRC packets unchecked, all binary bytes retained",
        flush=True,
    )


def test_continuity():
    config = DecoderConfig(baudrate=0, framing="lora", config_source="manual", sf=8)
    decoder = LoRaDecoder(queue.Queue(), queue.Queue(), "continuity", config, vfo=1)
    decoder.events = queue.Queue()
    decoder.stats = defaultdict(int)
    message = {
        "samples": np.zeros(4096, dtype=np.complex64),
        "sample_rate": 2000000,
        "center_freq": 436600000,
        "iq_sequence": 1,
        "vfo_states": {1: {"active": True, "center_freq": 436100000, "bandwidth": 125000}},
    }
    try:
        decoder._consume(message)
        first = decoder.graph
        message["iq_sequence"] = 2
        message["vfo_states"][1]["center_freq"] += 100
        decoder._consume(message)
        assert decoder.graph is first  # ordinary Doppler update
        message["iq_sequence"] = 4
        decoder._consume(message)
        assert decoder.graph is not first  # dropped broadcaster chunk
        second = decoder.graph
        message["iq_sequence"] = 5
        message["playback_elapsed_seconds"] = 1.0
        decoder._consume(message)
        message["iq_sequence"] = 6
        message["playback_elapsed_seconds"] = 0.0
        decoder._consume(message)
        assert decoder.graph is not second  # playback seek
        message["vfo_states"][1]["center_freq"] = 438000000
        decoder._consume(message)
        assert decoder.is_sleeping and decoder.graph is None
        assert decoder.stats["samples_dropped_out_of_band"] == 4096
    finally:
        decoder._reset_stream()
    print(
        "Continuity: Doppler retains acquisition, dropped chunks and playback seeks reset it, out-of-band sleeps",
        flush=True,
    )


if __name__ == "__main__":
    {
        "graph": test_graph,
        "worker": test_worker,
        "modes": test_modes,
        "meshtastic": test_meshtastic,
        "resampled": lambda: test_worker(800000, True),
        "persistence": test_persistence,
        "continuity": test_continuity,
    }[sys.argv[1]]()
