"""Manual VFO ADS-B reception through a stdin-fed readsb child process."""

import json
import logging
import os
import queue
import selectors
import shutil
import subprocess
import sys
import tempfile
import time
import uuid

import numpy as np
import psutil
from scipy import signal

from common.adsb import aircraft_record
from common.adsbstorage import AdsbStorage
from common.aircraft import AircraftDatabase, aircraft_database
from common.iqsamples import require_complex64
from common.resampler import StreamResampler
from demodulators.basedecoderprocess import BaseDecoderProcess

logger = logging.getLogger("adsbdecoder")
SAMPLE_RATE = 2_400_000
BANDWIDTH = 2_000_000


class AdsbChannel:
    def __init__(self, input_rate, offset):
        self.rate = input_rate
        self.offset = offset
        self.phase = 0.0
        self.resampler = StreamResampler(input_rate, SAMPLE_RATE)
        self.taps = signal.firwin(65, BANDWIDTH / 2, fs=SAMPLE_RATE)
        self.state = np.zeros(len(self.taps) - 1, dtype=np.complex128)

    def process(self, samples):
        if self.offset:
            increment = -2 * np.pi * self.offset / self.rate
            oscillator = np.exp(1j * (self.phase + increment * np.arange(len(samples))))
            self.phase = (self.phase + increment * len(samples)) % (2 * np.pi)
            samples = samples * oscillator
        samples = self.resampler.process(samples)
        filtered, state = signal.lfilter(self.taps, [1.0], samples, zi=self.state)
        self.state = np.asarray(state, dtype=np.complex128)
        # readsb accepts interleaved signed integers, not complex float samples.
        values = np.ascontiguousarray(filtered, dtype=np.complex64).view(np.float32)
        return (np.clip(values, -1, 1) * 32767).astype("<i2").tobytes()


class AdsbDecoder(BaseDecoderProcess):
    def __init__(
        self, iq_queue, data_queue, session_id, config, output_dir="data/decoded", vfo=None
    ):
        super().__init__(iq_queue, data_queue, session_id, config, output_dir, vfo)
        self.sample_rate = SAMPLE_RATE
        self.receiver_id = uuid.uuid4().hex
        self.storage = AdsbStorage(output_dir, self.receiver_id)
        self.child = None
        self.selector = None
        self.temporary = None
        self.channel = None
        self.channel_key = None
        self.sequence = None
        self.buffers = {"stdout": b"", "stderr": b""}
        self.latest = {}
        self.saved = {}
        self.saved_timestamps = {}
        self.pending = {}
        self.emergencies = {}
        self.last_position = {}
        self.json_stamp = None
        self.last_poll = self.last_publish = self.last_library = 0.0
        self.status = None
        self.monitor = None
        self.samples_in = 0
        self.sdr_sample_rate = None
        self.sdr_center_freq = None
        self.aircraft_database: AircraftDatabase | None = None

    def _get_decoder_type_for_init(self):
        return "ADSB"

    def _get_decoder_type(self):
        return "adsb"

    def _send(self, kind, **values):
        message = {
            "type": kind,
            "decoder_type": "adsb",
            "decoder_id": self.decoder_id,
            "session_id": self.session_id,
            "vfo": self.vfo,
            "timestamp": time.time(),
            **values,
        }
        try:
            self.data_queue.put_nowait(message)
            return True
        except queue.Full:
            return False

    def _status(self, status, **info):
        self.status = status
        self._send("decoder-status", status=status, mode="1090ES", info=info)

    def _provenance(self):
        return {
            "receiver_id": self.receiver_id,
            "session_id": self.session_id,
            "vfo": self.vfo,
            "decoder_id": self.decoder_id,
            "signal": {
                "frequency_hz": (self.channel_key or (None, None, 1_090_000_000))[2],
                "sample_rate_hz": SAMPLE_RATE,
                "sdr_sample_rate_hz": self.sdr_sample_rate,
            },
        }

    def _start(self):
        binary = self._binary()
        if not binary:
            raise RuntimeError("readsb is not installed; install readsb or use the Docker image")
        self.temporary = tempfile.TemporaryDirectory(prefix="gs-adsb-")
        command = [
            binary,
            "--device-type",
            "ifile",
            "--ifile",
            "-",
            "--iformat",
            "SC16",
            "--raw",
            "--write-json",
            self.temporary.name,
            "--write-json-every",
            "1",
        ]
        aircraft_database.cache_clear()
        self.aircraft_database = aircraft_database()
        if self.aircraft_database.path:
            command.extend(["--db-file", str(self.aircraft_database.path), "--db-file-lt"])
            logger.info("Using aircraft database %s", self.aircraft_database.path)
        else:
            logger.warning("Aircraft database unavailable; run tools/aircraftdb.py to install it")
        # stdout must be drained while writing IQ. stdbuf prevents small raw
        # bursts from remaining hidden in C stdio until a buffer fills.
        stdbuf = shutil.which("stdbuf")
        if stdbuf:
            command = [stdbuf, "-oL", *command]
        self.child = subprocess.Popen(
            command,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            bufsize=0,
        )
        self.selector = selectors.DefaultSelector()
        for name in ("stdin", "stdout", "stderr"):
            stream = getattr(self.child, name)
            os.set_blocking(stream.fileno(), False)
            events = selectors.EVENT_WRITE if name == "stdin" else selectors.EVENT_READ
            self.selector.register(stream, events, name)
        self.json_stamp = None
        self.buffers = {"stdout": b"", "stderr": b""}

    @staticmethod
    def _binary():
        # Native installs may keep the pinned decoder beside the backend venv's
        # Python, even when that environment was launched without activation.
        return shutil.which("readsb") or shutil.which(
            "readsb", path=os.path.dirname(sys.executable)
        )

    def _read_output(self, timeout=0):
        if self.selector is None:
            return
        for key, _ in self.selector.select(timeout):
            if key.data == "stdin":
                # A full IQ pipe must wake as soon as readsb consumes input.
                # Waiting only on its output throttles quiet reception below
                # the required 9.6 MB/s, overflowing the decoder's IQ queue.
                continue
            chunk = os.read(key.fd, 65536)
            if not chunk:
                self.selector.unregister(key.fileobj)
                continue
            name = key.data
            lines = (self.buffers[name] + chunk).split(b"\n")
            self.buffers[name] = lines.pop()
            if len(self.buffers[name]) > 65536:
                raise RuntimeError("readsb emitted an oversized output line")
            for line in lines:
                if name == "stderr":
                    logger.debug("readsb: %s", line.decode(errors="replace"))
                elif self.config.adsb_capture_messages:
                    self._raw_message(line)

    def _raw_message(self, line):
        # Only DF17/18 expose an address directly. Do not guess a Comm-B
        # aircraft address from a parity field or create an 'unknown' folder.
        if not line.startswith(b"*") or not line.endswith(b";"):
            return
        try:
            frame = bytes.fromhex(line[1:-1].decode("ascii"))
        except (ValueError, UnicodeError):
            return
        if len(frame) != 14 or frame[0] >> 3 not in (17, 18):
            return
        if frame[0] >> 3 == 18 and frame[0] & 7 not in (0, 2, 6):
            return  # Non-ICAO targets require a separate identity namespace.
        # Raw stdout alone does not establish validity. DF17/18 carry plain
        # CRC parity, so validate the emitted frame before assigning a folder.
        remainder = int.from_bytes(frame, "big")
        for bit in range(111, 23, -1):
            if remainder & (1 << bit):
                remainder ^= 0x1FFF409 << (bit - 24)
        if remainder:
            return
        self.storage.append(
            "messages",
            {
                "schema_version": 1,
                "icao": frame[1:4].hex(),
                "timestamp": time.time(),
                "hex": frame.hex(),
                "df": frame[0] >> 3,
                "validation": "crc24_valid_readsb_output",
                **self._provenance(),
            },
        )

    def _poll_aircraft(self):
        if self.temporary is None:
            return
        path = os.path.join(self.temporary.name, "aircraft.json")
        try:
            stamp = os.stat(path).st_mtime_ns
            if stamp == self.json_stamp:
                return
            with open(path) as stream:
                report = json.load(stream)
        except (OSError, ValueError):
            return  # readsb atomically replaces the snapshot; startup can be empty.
        self.json_stamp = stamp
        now = time.monotonic()
        timestamp = report.get("now")
        if type(timestamp) not in (int, float):
            return
        for aircraft in report.get("aircraft", []):
            try:
                record = aircraft_record(
                    aircraft, timestamp, self._provenance(), self.aircraft_database
                )
            except (ValueError, TypeError, AttributeError):
                continue
            address = record["icao"]
            if timestamp - record["timestamp"] > 10:
                continue
            if self.latest.get(address, {}).get("timestamp", 0) >= record["timestamp"]:
                continue
            self.latest[address] = record
            self.pending[address] = record
            emergency = (record.get("emergency"), record.get("squawk"))
            changed = address in self.emergencies and emergency != self.emergencies[address]
            self.emergencies[address] = emergency
            if (
                address not in self.saved
                or now - self.saved[address] >= self.config.adsb_save_interval
                or changed
            ):
                self._save(record, now)

    def _save(self, record, now):
        address = record["icao"]
        saved = dict(record)
        # readsb repeats coordinates while receiving other fields. Keep the
        # report, but only a newly observed position may extend a saved track.
        position_at = record.get("position_timestamp")
        if position_at is not None:
            # readsb rounds seen_pos to tenths of a second. Allow for that
            # quantization rather than mistaking rounding jitter for a new fix.
            if position_at <= self.last_position.get(address, 0) + 0.15:
                saved["latitude"] = saved["longitude"] = saved["position_timestamp"] = None
            else:
                self.last_position[address] = position_at
        self.storage.append("track", saved)
        self.saved[address] = now
        self.saved_timestamps[address] = record["timestamp"]
        self.packet_count += 1

    def _service(self, force=False):
        now = time.monotonic()
        self._read_output()
        if force or now - self.last_poll >= 0.25:
            self._poll_aircraft()
            self.last_poll = now
        if force or now - self.last_publish >= 1:
            for address, record in list(self.latest.items()):
                expired = time.time() - record["timestamp"] > 60
                if (force or expired) and record["timestamp"] > self._saved_timestamp(address):
                    self._save(record, now)
                if expired:
                    self.latest.pop(address, None)
                    self.pending.pop(address, None)
                    self.saved.pop(address, None)
                    self.saved_timestamps.pop(address, None)
                    self.emergencies.pop(address, None)
                    self.last_position.pop(address, None)
            self.storage.flush()
            if self.pending and self._send("adsb-update", aircraft=list(self.pending.values())):
                self.pending.clear()
            if self.status in {"listening", "decoding"} and not force:
                self._status(
                    "decoding" if self.latest else "listening",
                    aircraft_count=len(self.latest),
                    packets_decoded=self.packet_count,
                )
            self.last_publish = now
            if self.monitor is not None and not force:
                self._send(
                    "decoder-stats",
                    perf_stats={
                        "cpu_percent": self.monitor.cpu_percent(),
                        "memory_mb": self.monitor.memory_info().rss / (1024 * 1024),
                        "packets_decoded": self.packet_count,
                        "samples_in": self.samples_in,
                        "sample_rate_hz": SAMPLE_RATE,
                        "is_sleeping": self.status == "sleeping",
                    },
                )
        if force or now - self.last_library >= 5:
            folders = self.storage.take_dirty()
            if folders and not self._send("adsb-library", folders=folders):
                self.storage.dirty.update(folders)
            self.last_library = now

    def _saved_timestamp(self, address):
        # A save interval uses a monotonic clock; final-save comparison uses
        # reception timestamps, independently of wall-clock adjustments.
        return self.saved_timestamps.get(address, 0)

    def _write(self, data):
        child = self.child
        if child is None or child.stdin is None:
            raise RuntimeError("readsb input pipe is unavailable")
        pending = memoryview(data)
        deadline = time.monotonic() + 5
        while pending and self.running.value:
            self._read_output()
            if child.poll() is not None:
                raise RuntimeError(f"readsb exited with status {child.returncode}")
            try:
                pending = pending[os.write(child.stdin.fileno(), pending) :]
            except BlockingIOError:
                self._read_output(0.01)
            if time.monotonic() > deadline:
                raise RuntimeError("readsb stopped consuming IQ samples")

    def _stop_child(self):
        if self.child is not None:
            try:
                self.child.terminate()
                try:
                    self.child.wait(timeout=1)
                except subprocess.TimeoutExpired:
                    self.child.kill()
                    self.child.wait(timeout=1)
            finally:
                self._read_output()
                if self.selector:
                    self.selector.close()
                for stream in (self.child.stdin, self.child.stdout, self.child.stderr):
                    stream.close()
                self.child = self.selector = None
        if self.temporary is not None:
            self.temporary.cleanup()
            self.temporary = None

    def _reset(self):
        self._service(force=True)
        self._stop_child()
        self.latest.clear()
        self.pending.clear()
        self.saved.clear()
        self.saved_timestamps.clear()
        self.emergencies.clear()
        self.last_position.clear()
        self.channel = self.channel_key = None

    def _process_iq(self, message):
        samples = require_complex64(message["samples"], "adsb")
        if not len(samples):
            return
        self.samples_in += len(samples)
        state = (message.get("vfo_states") or {}).get(self.vfo)
        rate = float(message["sample_rate"])
        center = float(message.get("logical_center_freq_hz") or message["center_freq"])
        frequency = float(state["center_freq"]) if state else center
        offset = frequency - center
        valid = (
            state
            and state.get("active")
            and rate >= SAMPLE_RATE
            and abs(offset) + BANDWIDTH / 2 < rate / 2
            and abs(frequency - 1_090_000_000) <= 100_000
        )
        if not valid:
            if self.channel is not None:
                self._reset()
            if self.status != "sleeping":
                self._status(
                    "sleeping",
                    reason="Tune the VFO to 1090 MHz with at least 2.4 MS/s and the full 2 MHz channel in band",
                )
            return
        sequence = message.get("iq_sequence")
        previous_sequence = self.sequence
        gap = (
            sequence is not None
            and previous_sequence is not None
            and sequence != previous_sequence + 1
        )
        self.sequence = sequence
        key = rate, center, frequency
        if key != self.channel_key or gap:
            if gap and self.channel_key is not None:
                logger.warning(
                    "Restarting readsb after an IQ queue discontinuity "
                    "(VFO%s, sequence %s -> %s, sample_rate_hz=%s)",
                    self.vfo,
                    previous_sequence,
                    sequence,
                    rate,
                )
            elif self.channel_key is not None:
                logger.info(
                    "Restarting readsb after a channel change (VFO%s, %s -> %s)",
                    self.vfo,
                    self.channel_key,
                    key,
                )
            self._reset()
            self.sdr_sample_rate, self.sdr_center_freq = rate, center
            self.channel_key = key
            self.channel = AdsbChannel(rate, offset)
            self._start()
            self._status("listening")
        channel = self.channel
        if channel is not None:
            self._write(channel.process(samples))

    def run(self):
        self.monitor = psutil.Process()
        self.monitor.cpu_percent()
        self._status("starting")
        try:
            if not self._binary():
                raise RuntimeError(
                    "readsb is not installed; install readsb or use the Docker image"
                )
            while self.running.value:
                self._service()
                try:
                    message = self.iq_queue.get(timeout=0.05)
                except queue.Empty:
                    continue
                if message is not None:
                    self._process_iq(message)
                if self.child and self.child.poll() is not None:
                    raise RuntimeError(f"readsb exited with status {self.child.returncode}")
        except Exception as exc:
            logger.exception("ADS-B decoder failed")
            self._status("error", error=str(exc))
        finally:
            try:
                self._service(force=True)
            finally:
                self._stop_child()
                self.running.value = 0
                if self.status != "error":
                    self._status("closed")
