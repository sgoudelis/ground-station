"""Automatic VFO IQ detection and decoding through the upstream RS tools."""

import json
import logging
import os
import queue
import re
import selectors
import shutil
import subprocess
import time
from collections import deque
from types import SimpleNamespace
from typing import Any

import numpy as np
import psutil
from scipy import signal

from common.iqsamples import require_complex64
from common.resampler import StreamResampler
from common.sondestorage import SondeStorage
from demodulators.basedecoderprocess import BaseDecoderProcess
from telemetry.context import ParseContext
from telemetry.parser import TelemetryParser
from telemetry.radiosonde import RadiosondeParser

logger = logging.getLogger("radiosondedecoder")


class SondeChannel:
    """Translate and channelize IQ with continuous oscillator and filter state."""

    def __init__(self, input_rate, output_rate, offset, bandwidth):
        if not 0 < bandwidth < min(input_rate, output_rate) * 0.8:
            raise ValueError("Radiosonde bandwidth must be below 80% of both sample rates")
        self.input_rate = input_rate
        self.offset = offset
        self.phase = 0.0
        self.resampler = StreamResampler(input_rate, output_rate)
        # The polyphase filter rejects aliases before downsampling. Apply the
        # narrower VFO filter at the low output rate to keep wide SDR input cheap.
        self.taps = signal.firwin(129, bandwidth / 2, fs=output_rate)
        self.filter_state: np.ndarray = np.zeros(len(self.taps) - 1, dtype=np.complex128)

    def process(self, samples):
        increment = -2 * np.pi * self.offset / self.input_rate
        oscillator = np.exp(1j * (self.phase + increment * np.arange(len(samples))))
        self.phase = (self.phase + increment * len(samples)) % (2 * np.pi)
        resampled = self.resampler.process(samples * oscillator)
        if not len(resampled):
            return np.empty(0, dtype=np.complex64)
        filtered, self.filter_state = signal.lfilter(
            self.taps, [1.0], resampled, zi=self.filter_state
        )
        return np.ascontiguousarray(filtered, dtype=np.complex64)


class RadiosondeDecoder(BaseDecoderProcess):
    """One detector or codec per VFO; BaseDecoder owns files and UI events."""

    PROGRAMS = {"rs41": "rs41mod", "dfm": "dfm09mod", "m10m20": "m10m20mod"}
    DETECTED_TYPES = {"RS41": "rs41", "DFM9": "dfm", "M10": "m10m20", "M20": "m10m20"}
    REPORT_TYPES = {"rs41": {"RS41"}, "dfm": {"DFM"}, "m10m20": {"M10", "M20"}}
    HISTORY_SECONDS = 8
    LOSS_SECONDS = 20

    def __init__(
        self,
        iq_queue,
        data_queue,
        session_id,
        config,
        output_dir="data/decoded",
        vfo=None,
    ):
        super().__init__(iq_queue, data_queue, session_id, config, output_dir, vfo)
        self.family = config.radiosonde_type
        if self.family not in ("auto", *self.PROGRAMS):
            raise ValueError("Unsupported radiosonde type")
        self.active_type = None if self.family == "auto" else self.family
        self.baudrate = config.baudrate
        self.framing = config.framing
        self.sample_rate: int = config.radiosonde_sample_rate
        if self.sample_rate not in (48_000, 96_000):
            raise ValueError("Radiosonde sample rate must be 48000 or 96000")
        self.satellite = config.satellite or {}
        self.transmitter = config.transmitter or {}
        self.sdr_sample_rate = None
        self.sdr_center_freq = None
        self.cached_vfo_state: dict[str, Any] | None = None
        self.power_measurements = []
        self.current_power_dbfs = None
        self.rs_process: subprocess.Popen[bytes] | None = None
        self.selector: selectors.BaseSelector | None = None
        self.buffers = {}
        self.pending_frame = None
        self.decoder_report = None
        self.channel: SondeChannel | None = None
        self.channel_key = None
        self.last_sequence = None
        self.last_frame_key = None
        self.status = None
        self.detected_type = None
        self.detection_score = None
        self.confirmed = False
        self.iq_history: deque[np.ndarray] = deque()
        self.history_samples = 0
        self.stream_samples = 0
        self.last_report_sample = 0
        self.last_packet_at = time.monotonic()
        self.sonde_storage = SondeStorage(output_dir, session_id, vfo)
        os.makedirs(self.output_dir, exist_ok=True)

    def _get_decoder_type_for_init(self):
        return "Radiosonde"

    def _get_decoder_type(self):
        return "radiosonde"

    def _get_vfo_state(self):
        return SimpleNamespace(**self.cached_vfo_state) if self.cached_vfo_state else None

    def _get_decoder_specific_metadata(self):
        return {
            "model": (self.decoder_report or {}).get("type", self.active_type or "auto"),
            "program": self.PROGRAMS.get(self.active_type or "", "dft_detect"),
            "sample_rate_hz": self.sample_rate,
        }

    def _get_filename_params(self):
        return (self.decoder_report or {}).get("type", self.active_type or "auto")

    def _get_parameters_string(self):
        return f"{self._get_filename_params()}, {self.sample_rate // 1000} kS/s IQ"

    def _get_payload_protocol(self):
        return "radiosonde"

    def _get_packet_output_dir(self, timestamp):
        # Resolve each validated report independently: a receiver can switch
        # serials without restarting, including inside an observation bundle.
        report = self.decoder_report
        if report is None:
            raise ValueError("A validated radiosonde report is required before saving")
        return str(self.sonde_storage.packet_directory(report["type"], report["id"], timestamp))

    def _get_parse_context(self):
        # RS has already interpreted calibration accumulated over earlier frames.
        # Persist that report so reparsing this one .bin retains those readings.
        return ParseContext(
            protocol="radiosonde", framing=self.framing, decoder_report=self.decoder_report
        )

    def _get_decoder_config_metadata(self):
        return {
            **super()._get_decoder_config_metadata(),
            "radiosonde_type": self.family,
            "radiosonde_sample_rate": self.sample_rate,
        }

    def _get_demodulator_params_metadata(self):
        return {
            "input": "resampled_iq",
            "sample_format": "complex_float32",
            "sample_rate_hz": self.sample_rate,
            "rf_bandwidth_hz": (self.cached_vfo_state or {}).get("bandwidth"),
            "program": self.PROGRAMS.get(self.active_type or "", "dft_detect"),
        }

    def _send_status(self, status, **info):
        self.status = status
        mode = (self.decoder_report or {}).get("type", self.active_type or "Auto")
        self._send_message(
            {
                "type": "decoder-status",
                "status": status,
                "mode": mode,
                "info": {
                    "mode": mode,
                    "framing": self.framing,
                    "baudrate": self.baudrate,
                    "packets_decoded": self.packet_count,
                    **self._get_power_statistics(),
                    **info,
                },
            }
        )

    def _send_message(self, message):
        message.update(
            decoder_type="radiosonde",
            decoder_id=self.decoder_id,
            session_id=self.session_id,
            vfo=self.vfo,
            timestamp=time.time(),
        )
        try:
            self.data_queue.put_nowait(message)
            self.stats["data_messages_out"] += 1
        except queue.Full:
            pass

    def _start_rs(self):
        program = self.PROGRAMS.get(self.active_type or "", "dft_detect")
        binary = shutil.which(program)
        if not binary:
            raise RuntimeError(f"{program} is not installed; install RS or use the Docker image")
        # RS41 uses buffered stdio. Line buffering keeps raw/JSON pairs available
        # immediately even when stdout is a pipe rather than a terminal.
        stdbuf = shutil.which("stdbuf")
        if not stdbuf:
            raise RuntimeError("stdbuf is required for streaming RS decoder output")
        if self.active_type is None:
            # Two matching hits reduce false selections; restrict scanning to
            # families for which Ground Station has both a codec and a parser.
            options = ["--IQ", "0", "--types", "RS41,DFM9,M10", "-d2"]
        elif self.active_type == "dfm":
            # DFM JSON combines several frames. Preserve the most recent encoded
            # radio frame (33 bytes, excluding sync) using RS's rawhex format.
            options = ["--iq2", "--json", "--rawecc", "--ptu", "--auto"]
        else:
            options = ["--iq2", "--json", "--raw", "--silent", "--ptu"]
            if self.active_type == "m10m20":
                options += ["-vv"]  # Include humidity in M10 JSON.
        command = [stdbuf, "-oL", binary, *options, "-", str(self.sample_rate), "32"]
        self.rs_process = subprocess.Popen(
            command,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            bufsize=0,
        )
        self.selector = selectors.DefaultSelector()
        self.buffers = {"stdout": b"", "stderr": b""}
        for name in ("stdin", "stdout", "stderr"):
            stream = getattr(self.rs_process, name)
            os.set_blocking(stream.fileno(), False)
            if name != "stdin":
                self.selector.register(stream, selectors.EVENT_READ, name)
        self.pending_frame = None
        self.detected_type = None

    def _handle_stdout(self, line):
        line = line.strip()
        if not line:
            return
        if self.active_type is None:
            match = re.match(rb"^(RS41|DFM9|M10|M20):\s*(-?\d+\.\d+)", line)
            if match:
                self.detected_type = self.DETECTED_TYPES[match[1].decode("ascii")]
                self.detection_score = float(match[2])
            return
        if not line.startswith(b"{"):
            if self.active_type == "dfm":
                # --rawecc emits three encoded/interleaved blocks. Human status
                # lines may follow before the assembled JSON, so ignore those.
                match = re.fullmatch(
                    rb"[+-]<[^>]+>\s+([0-9A-Fa-f]{14})\s+([0-9A-Fa-f]{26})\s+([0-9A-Fa-f]{26})",
                    line,
                )
                if match:
                    self.pending_frame = bytes.fromhex(b"".join(match.groups()).decode("ascii"))
                elif line.startswith((b"+<", b"-<")):
                    self.pending_frame = None
                return
            # RS41 and M10/M20 emit one hex frame immediately before its JSON.
            self.pending_frame = None
            token = line.split(None, 1)[0]
            if re.fullmatch(rb"[0-9A-Fa-f]+", token) and len(token) % 2 == 0:
                self.pending_frame = bytes.fromhex(token.decode("ascii"))
            return
        frame, self.pending_frame = self.pending_frame, None
        if frame is None:
            return
        try:
            report = json.loads(line)
            if (
                not isinstance(report, dict)
                or report.get("type") not in self.REPORT_TYPES[self.active_type]
            ):
                raise ValueError("Report type does not match selected decoder")
            RadiosondeParser().parse(frame, report=report)
        except (ValueError, TypeError):
            self.stats["errors"] += 1
            logger.warning("Discarding an unmatched or malformed radiosonde report")
            return
        self.confirmed = True
        self.last_report_sample = self.stream_samples
        self.last_packet_at = time.monotonic()
        key = (report["id"], report["frame"], frame)
        # A replay can repeat the last accepted frame. It still proves that the
        # selected codec is receiving, but must not create a duplicate artifact.
        if key == self.last_frame_key:
            return
        self.last_frame_key = key
        self.decoder_report = report
        self.framing = report["type"].lower()
        self.baudrate = {"RS41": 4800, "DFM": 2500, "M10": 9616, "M20": 9600}[report["type"]]
        self._on_packet_decoded(frame)
        self._send_status("decoding", sonde_id=report["id"], frame=report["frame"])

    def _read_output(self, timeout=0):
        selector = self.selector
        if selector is None:
            return
        for key, _ in selector.select(timeout):
            chunk = os.read(key.fd, 65536)
            if not chunk:
                selector.unregister(key.fileobj)
                continue
            name = key.data
            buffered = self.buffers[name] + chunk
            lines = buffered.split(b"\n")
            self.buffers[name] = lines.pop()
            if len(self.buffers[name]) > 65536:
                raise RuntimeError("RS decoder emitted an oversized output line")
            # Drain stderr silently: RS emits routine diagnostics on every restart.
            for line in lines:
                if name == "stdout":
                    self._handle_stdout(line)

    def _write_iq(self, samples):
        # Nonblocking writes allow output draining and stop requests while RS
        # consumes samples. Never skip a partial write and splice the IQ stream.
        process = self.rs_process
        if process is None or process.stdin is None:
            raise RuntimeError("RS decoder is not running")
        pending = memoryview(samples.astype("<c8", copy=False)).cast("B")
        deadline = time.monotonic() + 5
        while pending and self.running.value:
            self._read_output()
            if self.active_type is None and self.detected_type:
                return  # The entire current chunk is retained for codec replay.
            if process.poll() is not None:
                self._read_output(0.01)
                if self.active_type is None and self.detected_type:
                    return
                raise RuntimeError(f"RS process exited with status {process.returncode}")
            try:
                written = os.write(process.stdin.fileno(), pending)
                pending = pending[written:]
            except BlockingIOError:
                self._read_output(0.01)
            except BrokenPipeError:
                self._read_output(0.05)
                if self.active_type is None and self.detected_type:
                    return
                raise
            if time.monotonic() > deadline:
                raise RuntimeError("RS decoder stopped consuming IQ samples")

    def _stop_rs(self):
        process = self.rs_process
        if process is None:
            return
        # Do not drain into a new VFO context: buffered output belongs to the
        # old channel. Kill and reap before replacing its reception metadata.
        try:
            if process.poll() is None:
                process.terminate()
            try:
                process.wait(timeout=1)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=1)
        finally:
            if self.selector is not None:
                self.selector.close()
            for stream in (process.stdin, process.stdout, process.stderr):
                if stream:
                    stream.close()
            self.rs_process = None
            self.selector = None
            self.pending_frame = None

    def _reset_receiver(self):
        # Retunes and missing IQ invalidate DSP state, detection and calibration.
        self._stop_rs()
        self.channel = None
        self.channel_key = None
        self.active_type = None if self.family == "auto" else self.family
        self.framing = self.family
        self.baudrate = self.config.baudrate
        self.decoder_report = None
        self.last_frame_key = None
        self.detected_type = None
        self.detection_score = None
        self.confirmed = False
        self.iq_history.clear()
        self.history_samples = self.stream_samples = self.last_report_sample = 0

    def _remember_iq(self, samples):
        if not len(samples):
            return
        limit = self.HISTORY_SECONDS * self.sample_rate
        self.iq_history.append(samples[-limit:].copy())
        self.history_samples += min(len(samples), limit)
        # Bound by sample count, including a partial oldest chunk.
        while self.history_samples > limit:
            excess = self.history_samples - limit
            oldest = self.iq_history.popleft()
            if len(oldest) > excess:
                self.iq_history.appendleft(oldest[excess:])
            self.history_samples -= min(len(oldest), excess)

    def _select_receiver(self, family):
        # Switch only between writes, never from a stdout callback: that would
        # splice IQ into the wrong process or close pipes while they are in use.
        self._stop_rs()
        self.active_type = family
        self.decoder_report = None
        self.confirmed = False
        self.framing = family or "auto"
        self.baudrate = {"rs41": 4800, "dfm": 2500, "m10m20": 9600}.get(family, 0)
        self.last_report_sample = self.stream_samples
        self._start_rs()
        self._send_status(
            "listening",
            phase="detecting" if family is None else "confirming",
            detection_score=self.detection_score,
        )
        # Replay preserves the headers consumed by the detector. The channel's
        # oscillator/resampler state continues forward without being reset.
        for chunk in self.iq_history:
            self._write_iq(chunk)
            if family is None and self.detected_type:
                break

    def _service_receiver(self):
        if self.rs_process is None:
            return
        self._read_output()
        if self.active_type is None and self.detected_type:
            self._select_receiver(self.detected_type)
            return
        if self.rs_process.poll() is not None:
            self._read_output(0.01)
            if self.active_type is None and self.detected_type:
                self._select_receiver(self.detected_type)
                return
            raise RuntimeError(f"RS process exited with status {self.rs_process.returncode}")
        # Count received IQ time, so recordings and live reception behave alike.
        # DFM needs a longer initial window to assemble navigation/config frames.
        timeout = 60 if self.active_type == "dfm" and not self.confirmed else self.LOSS_SECONDS
        if (
            self.family == "auto"
            and self.active_type is not None
            and self.stream_samples - self.last_report_sample > timeout * self.sample_rate
        ):
            self._select_receiver(None)

    def _process_iq(self, message):
        samples = require_complex64(message["samples"], "radiosonde")
        if not len(samples):
            return
        self.stats["iq_chunks_in"] += 1
        self.stats["samples_in"] += len(samples)
        self.stats["last_activity"] = time.time()
        state = (message.get("vfo_states") or {}).get(self.vfo)
        sequence = message.get("iq_sequence")
        gap = (
            sequence is not None
            and self.last_sequence is not None
            and sequence != self.last_sequence + 1
        )
        self.last_sequence = sequence
        rate = float(message["sample_rate"])
        center = float(message.get("logical_center_freq_hz") or message["center_freq"])
        offset = float(state["center_freq"]) - center if state else 0
        bandwidth = float(state.get("bandwidth", 20000)) if state else 20000
        if not state or not state.get("active") or abs(offset) + bandwidth / 2 >= rate / 2:
            self._reset_receiver()
            self.stats["samples_dropped_out_of_band"] += len(samples)
            if self.status != "sleeping":
                self._send_status("sleeping", reason="VFO inactive or outside SDR bandwidth")
            return
        channel_key = (rate, center, offset, bandwidth)
        if gap or channel_key != self.channel_key:
            self._reset_receiver()
            self.sdr_sample_rate, self.sdr_center_freq = rate, center
            self.cached_vfo_state = state.copy()
            self.channel = SondeChannel(rate, self.sample_rate, offset, bandwidth)
            self._start_rs()
            self.channel_key = channel_key
            self.stats["iq_discontinuities"] += int(gap)
            self._send_status(
                "listening", phase="detecting" if self.active_type is None else "confirming"
            )
        assert self.channel is not None
        filtered = self.channel.process(samples)
        self._update_power_measurement(self._measure_signal_power(filtered))
        self.stream_samples += len(filtered)
        if self.family == "auto":
            self._remember_iq(filtered)
        self._write_iq(filtered)
        self._service_receiver()
        self.stats["samples_out"] += len(filtered)

    def run(self):
        self.telemetry_parser = TelemetryParser()
        self.stats: dict[str, Any] = {
            "iq_chunks_in": 0,
            "samples_in": 0,
            "samples_out": 0,
            "samples_dropped_out_of_band": 0,
            "iq_discontinuities": 0,
            "data_messages_out": 0,
            "queue_timeouts": 0,
            "packets_decoded": 0,
            "last_activity": None,
            "errors": 0,
        }
        monitor = psutil.Process()
        monitor.cpu_percent()
        last_stats = self.last_packet_at = time.monotonic()
        self._send_status("starting")
        try:
            # Fail visibly even if the selected VFO is currently out of band.
            required = (
                ["dft_detect", *self.PROGRAMS.values()]
                if self.family == "auto"
                else [self.PROGRAMS[self.family]]
            )
            missing = [program for program in required if not shutil.which(program)]
            if missing:
                raise RuntimeError(
                    f"Missing RS tools: {', '.join(missing)}; install RS or use the Docker image"
                )
            self._send_status("listening")
            while self.running.value:
                self._service_receiver()
                try:
                    message = self.iq_queue.get(timeout=0.05)
                except queue.Empty:
                    self.stats["queue_timeouts"] += 1
                else:
                    if message is not None:
                        self._process_iq(message)
                now = time.monotonic()
                if self.status == "decoding" and now - self.last_packet_at > 3:
                    self._send_status("listening")
                if now - last_stats >= 1:
                    self.stats.update(
                        cpu_percent=monitor.cpu_percent(),
                        memory_mb=monitor.memory_info().rss / (1024 * 1024),
                        sample_rate_hz=self.sample_rate,
                        is_sleeping=self.status == "sleeping",
                    )
                    self._send_message(
                        {
                            "type": "decoder-stats",
                            "stats": {**self.stats, **self._get_power_statistics()},
                            "perf_stats": self.stats.copy(),
                        }
                    )
                    last_stats = now
        except Exception as exc:
            self.stats["errors"] += 1
            logger.exception("Radiosonde decoder failed")
            self._send_status("error", error=str(exc))
        finally:
            self._stop_rs()
            self.running.value = 0
            if self.status != "error":
                self._send_status("stopped")
