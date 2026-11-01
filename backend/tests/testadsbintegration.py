"""Demodulate a synthetic airborne position through the actual readsb pipe."""

import gzip
import json
import math
import queue
import threading
import time

import numpy as np
import pytest
from scipy.signal import resample_poly

from demodulators.adsbdecoder import AdsbDecoder
from pipeline.config.decoderconfigservice import DecoderConfigService

pytestmark = pytest.mark.integration


def position_frame(parity, latitude, longitude):
    # Encode matching even/odd global CPR positions, then calculate Mode S CRC.
    nl = math.floor(
        2
        * math.pi
        / math.acos(1 - (1 - math.cos(math.pi / 30)) / math.cos(math.radians(latitude)) ** 2)
    )
    dlat, dlon = 360 / (60 - parity), 360 / (nl - parity)
    yz = int(131072 * ((latitude % dlat) / dlat) + 0.5) % 131072
    xz = int(131072 * ((longitude % dlon) / dlon) + 0.5) % 131072
    value = int("8D40621D58C382D690C8AC2863A7", 16)
    value &= ~(((1 << 35) - 1) << 24)
    value |= ((parity << 34) | (yz << 17) | xz) << 24
    value &= ~0xFFFFFF
    remainder = value
    for bit in range(111, 23, -1):
        if remainder & (1 << bit):
            remainder ^= 0x1FFF409 << (bit - 24)
    return (value | remainder).to_bytes(14, "big")


def position_samples(input_rate, offset, longitude):
    # At 12 MHz the 0.5 microsecond pulses occupy exactly six samples. Resample
    # once to the SDR rate; the worker still exercises its streaming channel.
    waveform = np.zeros(1_200_000, dtype=np.complex64)
    for index in range(60):
        frame = position_frame(index % 2, 40.5, longitude)
        start = index * 18000
        for pulse_offset in (0, 12, 42, 54):
            waveform[start + pulse_offset : start + pulse_offset + 6] = 0.8
        for bit, value in enumerate(np.unpackbits(np.frombuffer(frame, dtype=np.uint8))):
            pulse = start + 96 + bit * 12 + (0 if value else 6)
            waveform[pulse : pulse + 6] = 0.8
    divisor = math.gcd(12_000_000, input_rate)
    samples = resample_poly(waveform, input_rate // divisor, 12_000_000 // divisor).astype(
        np.complex64
    )
    if offset:
        samples *= np.exp(2j * np.pi * offset * np.arange(len(samples)) / input_rate).astype(
            np.complex64
        )
    return samples


@pytest.mark.parametrize(
    "input_rate,offset", [(2_400_000, 0), (4_000_000, 0), (4_000_000, 300_000)]
)
def test_readsb_receives_resampled_vfo_iq_and_saves_position(
    tmp_path, input_rate, offset, monkeypatch
):
    if not AdsbDecoder._binary():
        pytest.skip("readsb is not installed")
    database = tmp_path / "database"
    database.mkdir()
    with gzip.open(database / "aircraft.csv.gz", "wt") as stream:
        # readsb rejects snapshots smaller than 1,000 uncompressed bytes.
        for address in range(1, 65):
            stream.write(f"{address:06X};N{address};C172;00;CESSNA 172 Skyhawk;;;\n")
        stream.write("40621D;G-TEST;C172;10;CESSNA 172 Skyhawk;;;\n")
    (database / "metadata.json").write_text(
        json.dumps(
            {
                "types": {"C172": ["CESSNA 172 Skyhawk", "L1P", "L"]},
                "operators": {},
                "database": {"version": "integration-fixture"},
            }
        )
    )
    monkeypatch.setenv("GS_ADSB_DB_DIR", str(database))
    config = DecoderConfigService().get_config("adsb", overrides={"adsb_capture_messages": True})
    worker = AdsbDecoder(queue.Queue(), queue.Queue(), "integration", config, str(tmp_path), 1)
    try:
        for sequence in range(30):
            # Advance the position so readsb does not suppress the entire test
            # as repeated identical CPR reports from a stationary transponder.
            samples = position_samples(input_rate, offset, 23.1 + sequence * 0.00001)
            worker._process_iq(
                {
                    "samples": samples,
                    "sample_rate": input_rate,
                    "center_freq": 1_090_000_000 - offset,
                    "iq_sequence": sequence,
                    "vfo_states": {1: {"active": True, "center_freq": 1_090_000_000}},
                }
            )
            worker._service()
            time.sleep(0.08)
        deadline = time.monotonic() + 3
        while time.monotonic() < deadline:
            worker._service()
            if worker.latest.get("40621d", {}).get("latitude") is not None:
                break
            time.sleep(0.05)
        latest = worker.latest["40621d"]
        assert latest["latitude"] == pytest.approx(40.5, abs=0.002)
        assert latest["longitude"] == pytest.approx(23.1, abs=0.002)
        assert "--db-file" in worker.child.args
        assert "--db-file-lt" in worker.child.args
        assert latest["aircraft"]["registration"] == "G-TEST"
        assert latest["aircraft"]["model"] == "CESSNA 172 Skyhawk"
        assert latest["aircraft"]["military_status"] == "military"
        assert latest["aircraft"]["engine_type"] == "P"
        assert latest["aircraft"]["database"]["version"] == "integration-fixture"
        worker._service(force=True)
        records = [
            json.loads(line)
            for line in next(tmp_path.rglob("track_*.jsonl")).read_text().splitlines()
        ]
        assert any(record["latitude"] is not None for record in records)
        assert records[-1]["aircraft"]["registration"] == "G-TEST"
        assert next(tmp_path.rglob("messages_*.jsonl")).stat().st_size > 0
    finally:
        worker._stop_child()
    assert worker.child is None


def test_quiet_live_iq_keeps_up_without_queue_drops_or_readsb_restarts(tmp_path, monkeypatch):
    if not AdsbDecoder._binary():
        pytest.skip("readsb is not installed")
    iq_queue = queue.Queue(maxsize=10)
    worker = AdsbDecoder(
        iq_queue,
        queue.Queue(),
        "live-rate",
        DecoderConfigService().get_config("adsb"),
        str(tmp_path),
        1,
    )
    samples = np.zeros(240_000, dtype=np.complex64)
    starts = []
    dropped = []
    failures = []
    start_child = worker._start

    def start():
        start_child()
        starts.append(worker.child.pid)

    monkeypatch.setattr(worker, "_start", start)

    def produce():
        try:
            started = time.monotonic()
            # Unlike a synchronous feed, an independent producer reveals when
            # pipe backpressure prevents the worker from matching the SDR rate.
            for sequence in range(30):
                delay = started + sequence * 0.1 - time.monotonic()
                if delay > 0:
                    time.sleep(delay)
                message = {
                    "samples": samples,
                    "sample_rate": 2_400_000,
                    "center_freq": 1_090_000_000,
                    "iq_sequence": sequence,
                    "vfo_states": {1: {"active": True, "center_freq": 1_090_000_000}},
                }
                try:
                    iq_queue.put_nowait(message)
                except queue.Full:
                    dropped.append(sequence)
            deadline = time.monotonic() + 1
            while not iq_queue.empty() and time.monotonic() < deadline:
                time.sleep(0.01)
        except Exception as exc:
            failures.append(exc)
        finally:
            worker.running.value = 0

    producer = threading.Thread(target=produce, daemon=True)
    producer.start()
    try:
        worker.run()
    finally:
        worker.running.value = 0
        producer.join(timeout=5)
    assert not producer.is_alive()
    assert not failures
    assert not dropped
    assert len(starts) == 1
    assert worker.status == "closed"
    assert worker.samples_in == len(samples) * 30
    assert worker.child is None
