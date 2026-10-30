# Copyright (c) 2026 Efstratios Goudelis
# SPDX-License-Identifier: GPL-3.0-or-later
"""Streaming LoRa PHY receiver, integrated with the standard decoder process."""

import logging
import math
import os
import queue
import threading
import time
from fractions import Fraction
from types import SimpleNamespace
from typing import Any

import numpy as np
import pmt
import psutil
import setproctitle

os.environ.setdefault("GR_BUFFER_TYPE", "vmcirc_mmap_tmpfile")

from gnuradio import filter, gr, lora_sdr  # noqa: E402

from common.iqsamples import require_complex64  # noqa: E402
from demodulators.basedecoderprocess import BaseDecoderProcess  # noqa: E402
from demodulators.loraconfig import normalize_lora  # noqa: E402
from telemetry.parser import TelemetryParser  # noqa: E402

logger = logging.getLogger("loradecoder")


class LoRaSource(gr.sync_block):
    """Bounded IQ bridge; an empty queue is a pause, not end of stream."""

    def __init__(self):
        super().__init__(name="lora_iq_source", in_sig=None, out_sig=[np.complex64])
        self.chunks: queue.Queue = queue.Queue(maxsize=32)
        self.closed = threading.Event()
        self.pending = np.empty(0, dtype=np.complex64)

    def feed(self, samples):
        # Bound memory independently of the SDR's input chunk size.
        for start in range(0, len(samples), 65536):
            self.chunks.put(samples[start : start + 65536].copy(), timeout=0.1)

    def work(self, input_items, output_items):
        if not len(self.pending):
            try:
                self.pending = self.chunks.get(timeout=0.05)
            except queue.Empty:
                return -1 if self.closed.is_set() else 0
        count = min(len(output_items[0]), len(self.pending))
        output_items[0][:count] = self.pending[:count]
        self.pending = self.pending[count:]
        return count


class LoRaPacketSink(gr.sync_block):
    """Assemble tagged binary frames, including frames split across work calls."""

    def __init__(self, events):
        super().__init__(name="lora_packets", in_sig=[np.uint8], out_sig=None)
        self.events = events
        self.frame: dict[str, Any] | None = None
        self.payload = bytearray()
        self.dropped = 0

    def _append(self, values):
        if self.frame is None:
            return
        remaining = self.frame["pay_len"] - len(self.payload)
        self.payload.extend(values[:remaining].tobytes())
        if len(self.payload) == self.frame["pay_len"]:
            try:
                self.events.put_nowait((bytes(self.payload), self.frame))
            except queue.Full:
                self.dropped += 1
            self.frame = None
            self.payload.clear()

    def work(self, input_items, output_items):
        values = input_items[0]
        start = self.nitems_read(0)
        tags = sorted(
            self.get_tags_in_window(0, 0, len(values), pmt.intern("frame_info")),
            key=lambda t: t.offset,
        )
        position = 0
        for tag in tags:
            offset = int(tag.offset - start)
            self._append(values[position:offset])
            info = pmt.to_python(tag.value)
            self.payload.clear()
            length = int(info.get("pay_len", 0))
            self.frame = dict(info) if 1 <= length <= 255 and not info.get("err") else None
            position = offset
        self._append(values[position:])
        return len(values)


class LoRaFlowgraph(gr.top_block):
    """Persistent filtering, resampling, synchronization, FEC and CRC chain."""

    def __init__(self, sample_rate, center_freq, params, events):
        super().__init__("Ground Station LoRa")
        bw, sf = params["bw"], params["sf"]
        if not 0 < center_freq <= 0xFFFFFFFF:
            raise ValueError("LoRa requires the actual RF frequency (1..4294967295 Hz)")
        if sample_rate < 2 * bw or int(sample_rate) != sample_rate:
            raise ValueError(
                "LoRa requires an integer IQ sample rate of at least twice its bandwidth"
            )
        self.source = LoRaSource()
        self.sink = LoRaPacketSink(events)
        factor = max(1, int(sample_rate // (4 * bw)))
        taps = filter.firdes.low_pass(1, sample_rate, 0.68 * bw, 0.24 * bw)
        channel = filter.fir_filter_ccc(factor, taps)
        chain = [self.source, channel]
        ratio = Fraction(4 * bw * factor, int(sample_rate))
        if ratio != 1:
            if max(ratio.numerator, ratio.denominator) > 10000:
                raise ValueError(
                    "Unsupported LoRa resampling ratio; choose a standard IQ sample rate"
                )
            chain.append(
                filter.rational_resampler_ccc(
                    interpolation=ratio.numerator, decimation=ratio.denominator
                )
            )
        # The RF frequency is required for native sample-frequency-offset correction.
        sync = lora_sdr.frame_sync(
            int(center_freq),
            bw,
            sf,
            params["implicit_header"],
            params["sync_word"],
            4,
            params["preamble_len"],
        )
        # GNU Radio's default complex buffers cannot hold an oversampled SF11/12
        # symbol. Reserve enough on both sides of synchronization to avoid a
        # scheduler stall (a full SF12 symbol is 16384 input samples).
        for block in [*chain, sync]:
            block.set_min_output_buffer(65536)
        header = lora_sdr.header_decoder(
            params["implicit_header"],
            params["cr"],
            params["payload_length"],
            params["has_crc"],
            params["ldro_mode"],
            False,
        )
        chain.extend(
            [
                sync,
                lora_sdr.fft_demod(True, True),
                lora_sdr.gray_mapping(True),
                lora_sdr.deinterleaver(True),
                lora_sdr.hamming_dec(True),
                header,
                lora_sdr.dewhitening(),
                lora_sdr.crc_verif(0, False),
                self.sink,
            ]
        )
        self.connect(*chain)
        self.msg_connect((header, "frame_info"), (sync, "frame_info"))
        self.chain = chain  # Keep Python/native block lifetimes tied to this graph.

    def close(self, drain=False):
        self.source.closed.set()
        if not drain:
            self.stop()
        finished = threading.Event()

        def wait():
            self.wait()
            finished.set()

        waiter = threading.Thread(target=wait, daemon=True)
        waiter.start()
        if not finished.wait(2):
            self.stop()
            if not finished.wait(2):
                raise RuntimeError("LoRa flowgraph did not stop")
        self.disconnect_all()


class LoRaDecoder(BaseDecoderProcess):
    """Receive raw IQ and publish packets through BaseDecoder's file/UI path."""

    def __init__(
        self,
        iq_queue,
        data_queue,
        session_id,
        config,
        output_dir="data/decoded",
        vfo=None,
        shm_monitor_interval=10,
        shm_restart_threshold=1000,
    ):
        super().__init__(
            iq_queue,
            data_queue,
            session_id,
            config,
            output_dir,
            vfo,
            shm_monitor_interval,
            shm_restart_threshold,
        )
        self.params = normalize_lora(config.to_dict())
        self.baudrate = 0
        self.framing = "lora"
        self.sample_rate = 4 * self.params["bw"]
        self.sdr_sample_rate = None
        self.sdr_center_freq = None
        self.cached_vfo_state: dict[str, Any] | None = None
        self.power_measurements: list[float] = []
        self.max_power_history = 100
        self.current_power_dbfs = None
        self.is_sleeping = False
        self.graph: LoRaFlowgraph | None = None
        self.phase = 0.0
        self.frame_info: dict[str, Any] = {}
        self.stream_key: tuple[float, float] | None = None
        self.previous_sequence: int | None = None
        self.previous_playback_end: float | None = None
        self.previous_frequency: float | None = None
        self._rates_previous: dict[str, int] | None = None
        self._rates_time: float | None = None
        self.last_status: str | None = None

    def _get_decoder_type_for_init(self):
        return "LoRa"

    def _get_decoder_type(self):
        return "lora"

    def _get_payload_protocol(self):
        return "lora"

    def _get_vfo_state(self):
        return SimpleNamespace(**self.cached_vfo_state) if self.cached_vfo_state else None

    def _get_decoder_specific_metadata(self):
        return {
            "spreading_factor": self.params["sf"],
            "bandwidth_hz": self.params["bw"],
            "coding_rate": f"4/{int(self.frame_info.get('cr', self.params['cr'])) + 4}",
            "crc_present": bool(self.frame_info.get("crc")),
            "crc_valid": self.frame_info.get("crc_valid") if self.frame_info.get("crc") else None,
            "frame_info": self.frame_info.copy(),
        }

    def _get_decoder_config_metadata(self):
        return {
            "source": self.config_source,
            "framing": "lora",
            "payload_protocol": "lora",
            **self.params,
        }

    def _get_demodulator_params_metadata(self):
        return {
            **self.params,
            "spreading_factor": self.params["sf"],
            "receiver_sample_rate": self.sample_rate,
        }

    def _get_filename_params(self):
        return f"SF{self.params['sf']}-BW{self.params['bw']}"

    def _get_parameters_string(self):
        return f"SF{self.params['sf']}, BW {self.params['bw'] / 1000:g} kHz"

    def _publish(self, kind, **values):
        message = {
            "type": kind,
            "decoder_type": "lora",
            "decoder_id": self.decoder_id,
            "session_id": self.session_id,
            "vfo": self.vfo,
            "timestamp": time.time(),
            **values,
        }
        try:
            self.data_queue.put_nowait(message)
            self.stats["data_messages_out"] += 1
        except queue.Full:
            self.stats["output_queue_drops"] += 1

    def _status(self, status, **info):
        self.last_status = status
        self._publish(
            "decoder-status",
            status=status,
            info={
                **self.params,
                "spreading_factor": self.params["sf"],
                "bandwidth_khz": self.params["bw"] / 1000,
                "coding_rate": f"4/{self.params['cr'] + 4}",
                **info,
            },
        )

    def _send_stats_update(self):
        now = time.monotonic()
        keys = ("iq_chunks_in", "samples_in", "data_messages_out")
        current = {key: self.stats[key] for key in keys}
        dt = now - self._rates_time if self._rates_time is not None else 0
        rates = {
            f"{key}_per_sec": (
                (current[key] - (self._rates_previous or current)[key]) / dt if dt else 0.0
            )
            for key in keys
        }
        self._rates_time, self._rates_previous = now, current
        self.stats.update(
            ingest_samples_per_sec=rates["samples_in_per_sec"],
            ingest_chunks_per_sec=rates["iq_chunks_in_per_sec"],
            is_sleeping=self.is_sleeping,
        )
        perf = self.stats.copy()
        perf["rates"] = rates
        ui = {
            **self.params,
            **self._get_power_statistics(),
            "packets_decoded": self.packet_count,
            "is_sleeping": self.is_sleeping,
            "crc_failures": self.stats["crc_failures"],
            "ingest_samples_per_sec": rates["samples_in_per_sec"],
            "ingest_chunks_per_sec": rates["iq_chunks_in_per_sec"],
            "ingest_kSps": rates["samples_in_per_sec"] / 1000,
        }
        self._publish("decoder-stats", stats=ui, perf_stats=perf, rates=rates)

    def _drain_packets(self):
        # Native work runs on scheduler threads. Persistence stays on this thread
        # so each packet's CRC/PHY metadata cannot race another callback.
        while True:
            try:
                payload, info = self.events.get_nowait()
            except queue.Empty:
                break
            if info.get("crc") and info.get("crc_valid") is not True:
                self.stats["crc_failures"] += 1
                continue
            self.frame_info = info
            self._on_packet_decoded(payload)
            self._status(
                "completed", packet_length=len(payload), **self._get_decoder_specific_metadata()
            )

    def _reset_stream(self, drain=False):
        if self.graph is not None:
            graph, self.graph = self.graph, None
            graph.close(drain=drain)
            self.stats["packet_queue_drops"] += graph.sink.dropped
            self._drain_packets()
            self.stats["stream_resets"] += 1
        self.phase = 0.0
        self.stream_key = None

    def _consume(self, iq_message):
        samples = require_complex64(iq_message["samples"], "LoRa decoder")
        if not len(samples):
            return
        self.stats["iq_chunks_in"] += 1
        self.stats["samples_in"] += len(samples)
        self.stats["last_activity"] = time.time()
        sdr_center = iq_message.get("logical_center_freq_hz", iq_message.get("center_freq"))
        rate = float(iq_message["sample_rate"])
        state = iq_message.get("vfo_states", {}).get(self.vfo)
        if not state or not state.get("active"):
            self._reset_stream()
            return
        frequency = float(state["center_freq"])
        offset = frequency - sdr_center
        # Require room for the entire channel, including the anti-alias filter.
        if rate < 2 * self.params["bw"] or abs(offset) + 0.8 * self.params["bw"] > rate / 2:
            self.stats["samples_dropped_out_of_band"] += len(samples)
            self._reset_stream()
            if not self.is_sleeping:
                self.is_sleeping = True
                self._status(
                    "sleeping", reason="LoRa channel is outside the recorded SDR bandwidth"
                )
            return
        sequence = iq_message.get("iq_sequence")
        elapsed = iq_message.get("playback_elapsed_seconds")
        key = (rate, sdr_center)
        gap = (
            sequence is not None
            and self.previous_sequence is not None
            and sequence != self.previous_sequence + 1
        )
        if elapsed is not None and self.previous_playback_end is not None:
            gap |= abs(elapsed - self.previous_playback_end) > 1.5 / rate
        # Smooth Doppler adjustments keep the oscillator/filter/synchronizer alive;
        # a manual retune beyond one channel starts a new acquisition.
        retuned = (
            self.previous_frequency is not None
            and abs(frequency - self.previous_frequency) > self.params["bw"] / 2
        )
        if self.stream_key != key or gap or retuned or iq_message.get("discontinuity"):
            self._reset_stream()
        self.previous_sequence = sequence
        self.previous_playback_end = elapsed + len(samples) / rate if elapsed is not None else None
        self.previous_frequency = frequency
        if self.graph is None:
            self.graph = LoRaFlowgraph(rate, frequency, self.params, self.events)
            self.graph.start()
            self.stream_key = key
            self._status("listening")
        self.is_sleeping = False
        if self.last_status == "completed":
            self._status("listening")
        self.cached_vfo_state = state.copy()
        self.sdr_sample_rate, self.sdr_center_freq = rate, sdr_center
        step = -2 * math.pi * offset / rate
        phases = self.phase + step * np.arange(len(samples), dtype=np.float64)
        shifted = (samples * np.exp(1j * phases)).astype(np.complex64)
        self.phase = (self.phase + step * len(samples)) % (2 * math.pi)
        if self.params["invert_iq"]:
            shifted = np.conj(shifted)
        self._update_power_measurement(self._measure_signal_power(samples))
        try:
            self.graph.source.feed(shifted)
        except queue.Full:
            # Never stitch across a dropped portion of a packet.
            self.stats["samples_dropped_overflow"] += len(samples)
            self._reset_stream()
            self._status("listening", reason="Receiver input overflow; acquisition reset")

    def run(self):
        setproctitle.setproctitle(f"Ground Station - LoRa Decoder (VFO {self.vfo})")
        os.makedirs(self.output_dir, exist_ok=True)
        self.telemetry_parser = TelemetryParser()
        self.events: queue.Queue = queue.Queue(maxsize=256)
        self.stats: dict[str, Any] = {
            key: 0
            for key in (
                "iq_chunks_in",
                "samples_in",
                "samples_dropped_out_of_band",
                "samples_dropped_overflow",
                "data_messages_out",
                "queue_timeouts",
                "packets_decoded",
                "errors",
                "crc_failures",
                "stream_resets",
                "packet_queue_drops",
                "output_queue_drops",
            )
        }
        self.stats.update(cpu_percent=0.0, memory_mb=0.0, memory_percent=0.0, last_activity=None)
        process = psutil.Process()
        process.cpu_percent()
        self._send_stats_update()
        last_tick = time.monotonic()
        self._status("listening")
        try:
            while self.running.value:
                try:
                    message = self.iq_queue.get(timeout=0.1)
                except queue.Empty:
                    self.stats["queue_timeouts"] += 1
                else:
                    if message is not None:
                        self._consume(message)
                self._drain_packets()
                if time.monotonic() - last_tick >= 1:
                    self.stats.update(
                        cpu_percent=process.cpu_percent(),
                        memory_mb=process.memory_info().rss / 1048576,
                        memory_percent=process.memory_percent(),
                    )
                    self._send_stats_update()
                    self._monitor_shared_memory()
                    last_tick = time.monotonic()
        except Exception as error:
            self.stats["errors"] += 1
            logger.exception("LoRa receiver failed")
            self._status("error", error=str(error))
        finally:
            self._reset_stream(drain=True)
            self._send_stats_update()
            self._status("idle")
