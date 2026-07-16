# Copyright (c) 2025 Efstratios Goudelis
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU General Public License for more details.
#
# You should have received a copy of the GNU General Public License
# along with this program. If not, see <https://www.gnu.org/licenses/>.

import ctypes
import logging
import queue
import time
from typing import Any, Dict

import numpy as np
import psutil

from common.iqsamples import require_complex64
from hardware.airspynative import (
    AirspyhfCallback,
    AirspyhfComplexFloat,
    AirspyhfDevice,
    AirspyNativeError,
    parse_serial,
)
from hardware.airspyprobe import apply_native_airspy_gain

logger = logging.getLogger("airspyhf-worker")
TARGET_BLOCKS_PER_SEC = 15


def _coerce_int(value: Any, default: int) -> int:
    try:
        return int(float(value))
    except Exception:
        return default


def _coerce_float(value: Any, default: float) -> float:
    try:
        return float(value)
    except Exception:
        return default


def _nearest_rate(rates: list[int], requested: int) -> int:
    if not rates:
        return requested
    return min(rates, key=lambda rate: abs(rate - requested))


def _compute_center_pair(
    center_freq: float, ppm_error: float, offset_freq: float
) -> tuple[float, float]:
    logical_center_freq = center_freq * (1 + ppm_error * 1e-6)
    rf_center_freq = logical_center_freq + offset_freq
    return logical_center_freq, rf_center_freq


def airspyhf_worker_process(
    config_queue, data_queue, stop_event, iq_queue_fft=None, iq_queue_demod=None
):
    """
    Native libairspyhf worker process.

    Queue metadata matches other workers, so the frontend/waterfall stack stays
    device-agnostic.
    """

    device = None
    client_id = None
    sdr_id = None
    sample_queue: queue.Queue[tuple[np.ndarray, int]] = queue.Queue(maxsize=12)
    fft_size = 16384
    fft_window = "hanning"
    fft_averaging = 1
    fft_overlap_percent = 0
    fft_overlap_depth = 16
    sample_rate = 768_000
    center_freq = 7.1e6
    offset_freq = 0.0
    ppm_error = 0.0
    gain = 0
    tuner_agc = True
    sdr_settings: Dict[str, Any] = {}
    logical_center_freq = center_freq
    rf_center_freq = center_freq
    stream_chunk_id = 0
    stream_sample_index = 0
    callback_ref = None
    queue_drops = 0
    callback_errors = 0
    callback_error_logs = 0
    callback_samples = 0
    callback_invocations = 0
    last_callback_at = 0.0
    process = psutil.Process()
    stats: Dict[str, Any] = {
        "samples_read": 0,
        "iq_chunks_out": 0,
        "read_errors": 0,
        "queue_drops": 0,
        "callback_errors": 0,
        "callback_invocations": 0,
        "last_activity": None,
        "errors": 0,
        "cpu_percent": 0.0,
        "memory_mb": 0.0,
        "memory_percent": 0.0,
    }
    last_stats_send = time.time()
    stats_send_interval = 1.0
    last_cpu_check = time.time()
    cpu_check_interval = 0.5
    rx_started_at = 0.0
    last_callback_warn_at = 0.0
    num_samples = 16384
    pending_samples = np.empty(0, dtype=np.complex64)

    try:
        config = config_queue.get()
        if not isinstance(config, dict):
            raise RuntimeError("Initial AirspyHF worker configuration is invalid")

        sdr_id = config.get("sdr_id")
        client_id = config.get("client_id")
        fft_size = _coerce_int(config.get("fft_size", 16384), 16384)
        fft_window = str(config.get("fft_window", "hanning"))
        fft_averaging = _coerce_int(config.get("fft_averaging", 1), 1)
        fft_overlap_percent = _coerce_int(config.get("fft_overlap_percent", 0), 0)
        fft_overlap_depth = _coerce_int(config.get("fft_overlap_depth", 16), 16)

        serial = config.get("serial_number")
        serial_value = parse_serial(serial) if serial not in (None, "", 0, "0") else None
        device = AirspyhfDevice.open(serial_value)
        available_rates = device.get_samplerates()
        requested_rate = _coerce_int(config.get("sample_rate", sample_rate), sample_rate)
        sample_rate = _nearest_rate(available_rates, requested_rate)
        device.set_samplerate(sample_rate)
        num_samples = calculate_samples_per_scan(sample_rate, fft_size)

        center_freq = _coerce_float(config.get("center_freq", center_freq), center_freq)
        offset_freq = _coerce_float(config.get("offset_freq", 0), 0)
        ppm_error = _coerce_float(config.get("ppm_error", 0), 0)
        logical_center_freq, rf_center_freq = _compute_center_pair(
            center_freq, ppm_error, offset_freq
        )
        device.set_frequency(int(rf_center_freq))

        gain = _coerce_int(config.get("gain", gain), gain)
        tuner_agc = bool(config.get("tuner_agc", tuner_agc))
        sdr_settings = config.get("sdr_settings") or {}
        if not isinstance(sdr_settings, dict):
            sdr_settings = {}
        apply_native_airspy_gain("airspyhf", device, gain, tuner_agc, False, sdr_settings)

        logger.info(
            "Native AirspyHF configured: sample_rate=%s logical_center_freq=%s rf_center_freq=%s gain=%s",
            sample_rate,
            logical_center_freq,
            rf_center_freq,
            gain,
        )

        def _airspyhf_callback(transfer_ptr):
            nonlocal queue_drops, callback_errors, callback_error_logs, callback_samples
            nonlocal callback_invocations, last_callback_at
            transfer = transfer_ptr.contents
            sample_count = int(transfer.sample_count)
            if sample_count <= 0 or not transfer.samples:
                return 0
            try:
                sample_array_type = AirspyhfComplexFloat * sample_count
                sample_structs = ctypes.cast(
                    transfer.samples, ctypes.POINTER(sample_array_type)
                ).contents
                samples_view = np.ctypeslib.as_array(sample_structs)
                complex_samples = np.empty(sample_count, dtype=np.complex64)
                complex_samples.real = samples_view["re"]
                complex_samples.imag = samples_view["im"]
                sample_queue.put_nowait((complex_samples, int(transfer.dropped_samples)))
                callback_invocations += 1
                callback_samples += sample_count
                last_callback_at = time.time()
            except queue.Full:
                queue_drops += 1
            except Exception:
                queue_drops += 1
                callback_errors += 1
                if callback_error_logs < 3:
                    callback_error_logs += 1
                    logger.exception("Native AirspyHF callback conversion failed")
            return 0

        callback_ref = AirspyhfCallback(_airspyhf_callback)
        device.start_rx(callback_ref)
        rx_started_at = time.time()

        data_queue.put(
            {
                "type": "streamingstart",
                "client_id": client_id,
                "message": None,
                "timestamp": time.time(),
            }
        )

        while not stop_event.is_set():
            now = time.time()
            if now - last_cpu_check >= cpu_check_interval:
                try:
                    stats["cpu_percent"] = process.cpu_percent()
                    mem_info = process.memory_info()
                    stats["memory_mb"] = mem_info.rss / (1024 * 1024)
                    stats["memory_percent"] = process.memory_percent()
                except Exception:
                    pass
                last_cpu_check = now

            if now - last_stats_send >= stats_send_interval:
                stats["samples_read"] = callback_samples
                stats["queue_drops"] = queue_drops
                stats["callback_errors"] = callback_errors
                stats["callback_invocations"] = callback_invocations
                data_queue.put(
                    {
                        "type": "stats",
                        "client_id": client_id,
                        "sdr_id": sdr_id,
                        "stats": stats.copy(),
                        "timestamp": now,
                    }
                )
                last_stats_send = now

            while not config_queue.empty():
                new_config = config_queue.get_nowait()
                if not isinstance(new_config, dict):
                    continue

                restart_stream = False

                if "sample_rate" in new_config:
                    requested_rate = _coerce_int(new_config.get("sample_rate"), sample_rate)
                    updated_rate = _nearest_rate(available_rates, requested_rate)
                    if updated_rate != sample_rate:
                        sample_rate = updated_rate
                        restart_stream = True

                if restart_stream and device.is_streaming():
                    device.stop_rx()
                if restart_stream:
                    device.set_samplerate(sample_rate)
                    device.start_rx(callback_ref)
                    rx_started_at = time.time()
                    num_samples = calculate_samples_per_scan(sample_rate, fft_size)
                    pending_samples = np.empty(0, dtype=np.complex64)
                    logger.info("Updated AirspyHF sample rate: %s", sample_rate)

                if "center_freq" in new_config:
                    center_freq = _coerce_float(new_config.get("center_freq"), center_freq)
                if "offset_freq" in new_config:
                    offset_freq = _coerce_float(new_config.get("offset_freq"), offset_freq)
                if "ppm_error" in new_config:
                    ppm_error = _coerce_float(new_config.get("ppm_error"), ppm_error)
                logical_center_freq, rf_center_freq = _compute_center_pair(
                    center_freq, ppm_error, offset_freq
                )
                if (
                    "center_freq" in new_config
                    or "offset_freq" in new_config
                    or "ppm_error" in new_config
                ):
                    device.set_frequency(int(rf_center_freq))

                if "gain" in new_config:
                    gain = _coerce_int(new_config.get("gain"), gain)
                if "tuner_agc" in new_config:
                    tuner_agc = bool(new_config.get("tuner_agc"))
                if "sdr_settings" in new_config and isinstance(
                    new_config.get("sdr_settings"), dict
                ):
                    sdr_settings = new_config.get("sdr_settings") or {}
                if (
                    "gain" in new_config
                    or "tuner_agc" in new_config
                    or "sdr_settings" in new_config
                ):
                    apply_native_airspy_gain(
                        "airspyhf", device, gain, tuner_agc, False, sdr_settings
                    )

                if "fft_size" in new_config:
                    next_fft_size = _coerce_int(new_config.get("fft_size"), fft_size)
                    if next_fft_size != fft_size:
                        fft_size = next_fft_size
                        num_samples = calculate_samples_per_scan(sample_rate, fft_size)
                        pending_samples = np.empty(0, dtype=np.complex64)
                if "fft_window" in new_config:
                    fft_window = str(new_config.get("fft_window", fft_window))
                if "fft_averaging" in new_config:
                    fft_averaging = _coerce_int(new_config.get("fft_averaging"), fft_averaging)
                if "fft_overlap_percent" in new_config:
                    fft_overlap_percent = _coerce_int(
                        new_config.get("fft_overlap_percent"), fft_overlap_percent
                    )
                if "fft_overlap_depth" in new_config:
                    fft_overlap_depth = _coerce_int(
                        new_config.get("fft_overlap_depth"), fft_overlap_depth
                    )

            try:
                samples, dropped_samples = sample_queue.get(timeout=0.1)
            except queue.Empty:
                idle_ref = last_callback_at if last_callback_at > 0 else rx_started_at
                idle_for = time.time() - idle_ref if idle_ref > 0 else 0.0
                if idle_for > 2.5 and (time.time() - last_callback_warn_at) > 5.0:
                    logger.warning(
                        "Native AirspyHF RX callback idle for %.2fs (cb=%s errors=%s drops=%s)",
                        idle_for,
                        callback_invocations,
                        callback_errors,
                        queue_drops,
                    )
                    last_callback_warn_at = time.time()
                continue

            samples = require_complex64(samples, source="airspyhf-worker")
            if pending_samples.size == 0:
                pending_samples = samples
            else:
                pending_samples = np.concatenate((pending_samples, samples))

            while pending_samples.size >= num_samples and not stop_event.is_set():
                chunk = pending_samples[:num_samples]
                pending_samples = pending_samples[num_samples:]
                chunk_sample_count = len(chunk)
                chunk_id = stream_chunk_id
                chunk_start_sample = stream_sample_index
                stream_chunk_id += 1
                stream_sample_index += chunk_sample_count
                timestamp = time.time()

                if iq_queue_fft is not None:
                    try:
                        if not iq_queue_fft.full():
                            iq_queue_fft.put_nowait(
                                {
                                    "samples": chunk.copy(),
                                    "center_freq": logical_center_freq,
                                    "logical_center_freq_hz": logical_center_freq,
                                    "rf_center_freq_hz": rf_center_freq,
                                    "dsp_shift_hz": 0.0,
                                    "offset_freq_hz": offset_freq,
                                    "sample_rate": sample_rate,
                                    "timestamp": timestamp,
                                    "stream_chunk_id": chunk_id,
                                    "stream_start_sample": chunk_start_sample,
                                    "stream_sample_count": chunk_sample_count,
                                    "config": {
                                        "fft_size": fft_size,
                                        "fft_window": fft_window,
                                        "fft_averaging": fft_averaging,
                                        "fft_overlap_percent": fft_overlap_percent,
                                        "fft_overlap_depth": fft_overlap_depth,
                                    },
                                }
                            )
                            stats["iq_chunks_out"] += 1
                    except Exception:
                        stats["queue_drops"] = queue_drops

                if iq_queue_demod is not None:
                    try:
                        if not iq_queue_demod.full():
                            iq_queue_demod.put_nowait(
                                {
                                    "samples": chunk.copy(),
                                    "center_freq": logical_center_freq,
                                    "logical_center_freq_hz": logical_center_freq,
                                    "rf_center_freq_hz": rf_center_freq,
                                    "dsp_shift_hz": 0.0,
                                    "offset_freq_hz": offset_freq,
                                    "sample_rate": sample_rate,
                                    "timestamp": timestamp,
                                    "stream_chunk_id": chunk_id,
                                    "stream_start_sample": chunk_start_sample,
                                    "stream_sample_count": chunk_sample_count,
                                    "dropped_samples": dropped_samples,
                                }
                            )
                    except Exception:
                        stats["queue_drops"] = queue_drops

    except Exception as exc:
        message = f"Error in native AirspyHF worker process: {exc}"
        logger.error(message)
        logger.exception(exc)
        data_queue.put(
            {
                "type": "error",
                "client_id": client_id,
                "message": message,
                "timestamp": time.time(),
            }
        )

    finally:
        time.sleep(0.5)
        if device is not None:
            try:
                if device.is_streaming():
                    device.stop_rx()
            except AirspyNativeError:
                pass
            except Exception:
                pass
            try:
                device.close()
            except Exception:
                pass

        data_queue.put(
            {
                "type": "terminated",
                "client_id": client_id,
                "sdr_id": sdr_id,
                "queue_drops": queue_drops,
                "callback_errors": callback_errors,
                "callback_invocations": callback_invocations,
                "timestamp": time.time(),
            }
        )
        logger.info("Native AirspyHF worker process terminated")


def calculate_samples_per_scan(sample_rate, fft_size):
    if fft_size is None:
        fft_size = 16384
    num_samples = int(sample_rate / TARGET_BLOCKS_PER_SEC)
    num_samples = 2 ** int(np.ceil(np.log2(num_samples)))
    num_samples = max(num_samples, fft_size)
    num_samples = min(num_samples, 1048576)
    return num_samples
