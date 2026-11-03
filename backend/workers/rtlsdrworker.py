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


import logging
import time
import warnings
from typing import Any, Dict

import numpy as np
import psutil

from common.errors import format_device_error
from common.iqsamples import require_complex64

# Suppress a very specific third-party warning emitted at import-time by pyrtlsdr
# Context: pyrtlsdr (or its transitive imports) currently uses setuptools.pkg_resources,
# which is deprecated and scheduled for removal. We keep Setuptools pinned (<81) to avoid
# breakage, and we filter only this exact warning to keep logs clean until upstream fixes it.
# Remove this filter once pyrtlsdr stops using pkg_resources.
warnings.filterwarnings(
    "ignore",
    category=UserWarning,
    message=r"pkg_resources is deprecated as an API",
)
import rtlsdr  # noqa: E402 - import after warning filter by design

from workers.rtlsdrtcpclient import RtlSdrTcpClient  # noqa: E402 - follows filtered import

# Configure logging for the worker process
logger = logging.getLogger("rtlsdr-worker")


def _format_worker_error(stage: str, error: Exception, config: Dict[str, Any]) -> str:
    """Add the attempted USB serial or rtl_tcp endpoint to the native error."""
    backend = "RTL-SDR"
    context: Dict[str, Any] = {}
    if isinstance(config, dict) and config:
        if config.get("connection_type") == "tcp":
            backend = "RTL-SDR TCP"
            host = config.get("host", "127.0.0.1")
            port = config.get("port", 1234)
            context["endpoint"] = f"{host}:{port}"
        else:
            backend = "RTL-SDR USB"
            context["serial"] = config.get("serial_number")
    return str(format_device_error(backend, stage, error, **context))


def rtlsdr_worker_process(
    config_queue, data_queue, stop_event, iq_queue_fft=None, iq_queue_demod=None
):
    """
    Worker process for RTL-SDR operations.

    This function runs in a separate process to avoid segmentation faults.
    It receives configuration through a queue, streams IQ data to separate queues,
    and sends status/error messages through data_queue.

    Args:
        config_queue: Queue for receiving configuration from the main process
        data_queue: Queue for sending processed data back to the main process
        stop_event: Event to signal the process to stop
        iq_queue_fft: Queue for streaming raw IQ samples to FFT processor
        iq_queue_demod: Queue for streaming raw IQ samples to demodulators
    """

    # Default configuration
    sdr = None
    sdr_id = None
    client_id = None
    config: Dict[str, Any] = {}
    stage = "reading initial configuration"

    logger.info(f"RTL-SDR worker process started for SDR {sdr_id} for client {client_id}")

    try:
        # Wait for initial configuration
        logger.info(f"Waiting for initial configuration for SDR {sdr_id} for client {client_id}...")
        config = config_queue.get()
        logger.info(f"Initial configuration: {config}")
        new_config = config
        old_config = config

        # Configure the SDR device
        sdr_id = config.get("sdr_id")
        client_id = config.get("client_id")
        fft_size = config.get("fft_size", 16384)
        fft_window = config.get("fft_window", "hanning")

        # FFT averaging configuration (passed to IQ consumers)
        fft_averaging = config.get("fft_averaging", 6)

        # FFT overlap (passed to IQ consumers)
        fft_overlap_percent = int(config.get("fft_overlap_percent", 0) or 0)
        fft_overlap_depth = int(config.get("fft_overlap_depth", 16) or 16)

        # Track whether we have IQ consumers
        has_iq_consumers = iq_queue_fft is not None or iq_queue_demod is not None

        # Connect to the RTL-SDR device
        stage = "opening device"
        if config.get("connection_type") == "tcp":
            hostname = config.get("host", "127.0.0.1")
            port = config.get("port", 1234)
            logger.info(f"Connecting to RTL-SDR TCP server at {hostname}:{port}...")
            sdr = RtlSdrTcpClient(hostname=hostname, port=port)
            sdr.connect()

        else:
            serial_number = config.get("serial_number", 0)
            logger.info(f"Connecting to RTL-SDR with serial number {serial_number} over USB...")
            sdr = rtlsdr.RtlSdr(serial_number=serial_number)

        if sdr is None:
            raise RuntimeError("RTL-SDR device initialization failed")

        # Configure the device
        stage = "configuring receiver"
        offset_freq = config.get("offset_freq", 0)
        # Frequency contract:
        # - logical_center_freq: user-facing "true RF" center used by demod/decoders
        # - sdr.center_freq: hardware RF tune center after converter offset compensation
        # Keep these distinct so offset changes do not redefine downstream frequency semantics.
        logical_center_freq = config.get("center_freq", 100e6)
        sdr.center_freq = logical_center_freq + offset_freq
        sdr.sample_rate = config.get("sample_rate", 2.048e6)
        sdr.gain = config.get("gain", 25.4)

        logger.info(
            "RTL-SDR configured: "
            f"sample_rate={sdr.sample_rate}, logical_center_freq={logical_center_freq}, "
            f"rf_center_freq={sdr.center_freq}, gain={sdr.gain}, offset_freq={offset_freq}"
        )

        # Calculate the number of samples based on sample rate
        num_samples = calculate_samples_per_scan(sdr.sample_rate, fft_size)

        # if we reached here, we can set the UI to streaming
        data_queue.put(
            {
                "type": "streamingstart",
                "client_id": client_id,
                "message": None,
                "timestamp": time.time(),
            }
        )
        stage = "streaming samples"

        # Performance monitoring stats
        stats: Dict[str, Any] = {
            "samples_read": 0,
            "iq_chunks_out": 0,
            "read_errors": 0,
            "queue_drops": 0,
            "last_activity": None,
            "errors": 0,
            "cpu_percent": 0.0,
            "memory_mb": 0.0,
            "memory_percent": 0.0,
        }
        last_stats_send = time.time()
        stats_send_interval = 1.0
        stream_chunk_id = 0
        stream_sample_index = 0

        # CPU and memory monitoring
        process = psutil.Process()
        last_cpu_check = time.time()
        cpu_check_interval = 0.5

        # Main processing loop
        while not stop_event.is_set():
            # Update CPU and memory usage periodically
            current_time = time.time()
            if current_time - last_cpu_check >= cpu_check_interval:
                try:
                    cpu_percent = process.cpu_percent()
                    mem_info = process.memory_info()
                    memory_mb = mem_info.rss / (1024 * 1024)
                    memory_percent = process.memory_percent()
                    stats["cpu_percent"] = cpu_percent
                    stats["memory_mb"] = memory_mb
                    stats["memory_percent"] = memory_percent
                    last_cpu_check = current_time
                except Exception as e:
                    logger.debug(f"Error updating CPU/memory usage: {e}")

            # Send stats periodically via data_queue
            if current_time - last_stats_send >= stats_send_interval:
                data_queue.put(
                    {
                        "type": "stats",
                        "client_id": client_id,
                        "sdr_id": sdr_id,
                        "stats": stats.copy(),
                        "timestamp": current_time,
                    }
                )
                last_stats_send = current_time
            # Check for new configuration without blocking
            try:
                if not config_queue.empty():
                    new_config = config_queue.get_nowait()

                    if "sample_rate" in new_config:
                        if sdr.sample_rate != new_config["sample_rate"]:
                            sdr.sample_rate = new_config["sample_rate"]

                            # Calculate the number of samples based on sample rate
                            num_samples = calculate_samples_per_scan(sdr.sample_rate, fft_size)

                            logger.info(f"Updated sample rate: {sdr.sample_rate}")

                    if "center_freq" in new_config:
                        if logical_center_freq != new_config["center_freq"]:
                            logical_center_freq = new_config["center_freq"]
                            sdr.center_freq = logical_center_freq + offset_freq
                            logger.info(
                                f"Updated center frequency: logical={logical_center_freq}, rf={sdr.center_freq}"
                            )

                    if "fft_size" in new_config:
                        if old_config.get("fft_size", 0) != new_config["fft_size"]:
                            fft_size = new_config["fft_size"]
                            # Update num_samples when FFT size changes
                            num_samples = calculate_samples_per_scan(sdr.sample_rate, fft_size)
                            logger.info(f"Updated FFT size: {fft_size}, num_samples: {num_samples}")

                    if "fft_window" in new_config:
                        if old_config.get("fft_window", None) != new_config["fft_window"]:
                            fft_window = new_config["fft_window"]
                            logger.info(f"Updated FFT window: {fft_window}")

                    if "fft_averaging" in new_config:
                        if old_config.get("fft_averaging", 4) != new_config["fft_averaging"]:
                            fft_averaging = new_config["fft_averaging"]
                            logger.info(f"Updated FFT averaging: {fft_averaging}")

                    if "fft_overlap_percent" in new_config:
                        if (
                            old_config.get("fft_overlap_percent", fft_overlap_percent)
                            != new_config["fft_overlap_percent"]
                        ):
                            fft_overlap_percent = int(new_config["fft_overlap_percent"] or 0)
                            logger.info(f"Updated FFT overlap percent: {fft_overlap_percent}%")

                    if "fft_overlap_depth" in new_config:
                        if (
                            old_config.get("fft_overlap_depth", fft_overlap_depth)
                            != new_config["fft_overlap_depth"]
                        ):
                            fft_overlap_depth = int(new_config["fft_overlap_depth"] or 16)
                            logger.info(f"Updated FFT overlap depth: {fft_overlap_depth}")

                    if "bias_t" in new_config:
                        if old_config.get("bias_t", None) != new_config["bias_t"]:
                            sdr.set_bias_tee(new_config["bias_t"])
                            logger.info(f"Updated bias-T: {new_config['bias_t']}")

                    if "rtl_agc" in new_config:
                        if old_config.get("rtl_agc", None) != new_config["rtl_agc"]:
                            sdr.set_agc_mode(new_config["rtl_agc"])
                            logger.info(f"Updated RTL AGC: {new_config['rtl_agc']}")

                    if "tuner_agc" in new_config:
                        if old_config.get("tuner_agc", None) != new_config["tuner_agc"]:
                            sdr.set_manual_gain_enabled(not new_config["tuner_agc"])  # Tuner AGC
                            logger.info(f"Updated tuner AGC: {new_config['tuner_agc']}")

                        if not new_config["tuner_agc"]:
                            sdr.gain = new_config["gain"]

                    if "offset_freq" in new_config:
                        if old_config.get("offset_freq", 0) != new_config["offset_freq"]:
                            offset_freq = new_config["offset_freq"]
                            sdr.center_freq = logical_center_freq + offset_freq
                            logger.info(
                                f"Updated offset frequency: offset={offset_freq}, logical={logical_center_freq}, rf={sdr.center_freq}"
                            )

                    old_config = new_config

            except Exception as e:
                error_msg = _format_worker_error("updating configuration", e, config)
                logger.exception(error_msg)

                # Send error back to the main process
                if data_queue:
                    data_queue.put(
                        {
                            "type": "error",
                            "client_id": client_id,
                            "message": error_msg,
                            "timestamp": time.time(),
                        }
                    )

            try:

                # Read samples
                samples = sdr.read_samples(num_samples)
                stats["samples_read"] += len(samples)
                stats["last_activity"] = time.time()

                # Enforce pipeline contract: workers publish complex64 IQ samples.
                samples = require_complex64(samples, source="rtlsdr-worker")

                # Remove DC offset
                samples = remove_dc_offset(samples)
                chunk_sample_count = len(samples)
                chunk_id = stream_chunk_id
                chunk_start_sample = stream_sample_index
                stream_chunk_id += 1
                stream_sample_index += chunk_sample_count

                # Broadcast IQ samples to consumers (FFT processor and demodulators)
                if has_iq_consumers:
                    # Message format: IQ samples + metadata
                    timestamp = time.time()

                    # Broadcast to FFT queue (for waterfall display)
                    if iq_queue_fft is not None:
                        try:
                            if not iq_queue_fft.full():
                                iq_message = {
                                    "samples": samples.copy(),
                                    # `center_freq` is intentionally logical (not hardware RF).
                                    # Downstream DSP computes translation against this field.
                                    "center_freq": logical_center_freq,
                                    "logical_center_freq_hz": logical_center_freq,
                                    "rf_center_freq_hz": sdr.center_freq,
                                    "dsp_shift_hz": 0.0,
                                    "offset_freq_hz": offset_freq,
                                    "sample_rate": sdr.sample_rate,
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
                                iq_queue_fft.put_nowait(iq_message)
                                stats["iq_chunks_out"] += 1
                            else:
                                stats["queue_drops"] += 1
                        except Exception:
                            stats["queue_drops"] += 1

                    # Broadcast to demodulation queue
                    if iq_queue_demod is not None:
                        try:
                            if not iq_queue_demod.full():
                                demod_message = {
                                    "samples": samples.copy(),
                                    "center_freq": logical_center_freq,
                                    "logical_center_freq_hz": logical_center_freq,
                                    "rf_center_freq_hz": sdr.center_freq,
                                    "dsp_shift_hz": 0.0,
                                    "offset_freq_hz": offset_freq,
                                    "sample_rate": sdr.sample_rate,
                                    "timestamp": timestamp,
                                    "stream_chunk_id": chunk_id,
                                    "stream_start_sample": chunk_start_sample,
                                    "stream_sample_count": chunk_sample_count,
                                }
                                iq_queue_demod.put_nowait(demod_message)
                                stats["iq_chunks_out"] += 1
                            else:
                                stats["queue_drops"] += 1
                        except Exception:
                            stats["queue_drops"] += 1

            except Exception as e:
                error_msg = _format_worker_error("reading samples", e, config)
                logger.exception(error_msg)

                stats["errors"] += 1

                # Send error back to the main process
                data_queue.put(
                    {
                        "type": "error",
                        "client_id": client_id,
                        "message": error_msg,
                        "timestamp": time.time(),
                    }
                )

                # Pause before retrying
                time.sleep(1)

    except Exception as e:
        error_msg = _format_worker_error(stage, e, config)
        logger.exception(error_msg)

        # Send error back to the main process
        data_queue.put(
            {
                "type": "error",
                "client_id": client_id,
                "message": error_msg,
                "timestamp": time.time(),
            }
        )

    finally:
        # Sleep for 1 second to allow the main process to read the data queue messages
        time.sleep(1)

        # Clean up resources
        logger.info(f"Cleaning up resources for SDR {sdr_id}...")
        if sdr:
            try:
                sdr.close()
                logger.info(f"RTL-SDR device with id {sdr_id} closed")
            except Exception as e:
                logger.error(f"Error closing RTL-SDR device with id {sdr_id}: {str(e)}")

        # Send termination signal
        data_queue.put(
            {
                "type": "terminated",
                "client_id": client_id,
                "sdr_id": sdr_id,
                "timestamp": time.time(),
            }
        )

        logger.info("RTL-SDR worker process terminated")


# Target blocks per second for constant rate streaming
TARGET_BLOCKS_PER_SEC = 15


def calculate_samples_per_scan(sample_rate, fft_size):
    """Calculate number of samples per scan for constant block rate streaming."""
    if fft_size is None:
        fft_size = 8192

    # Calculate block size for constant rate
    # At 1 MHz: 1,000,000 / 10 = 100,000 samples (100ms per block)
    # At 8 MHz: 8,000,000 / 10 = 800,000 samples (100ms per block)
    num_samples = int(sample_rate / TARGET_BLOCKS_PER_SEC)

    # Round up to next power of 2 for efficient FFT processing
    num_samples = 2 ** int(np.ceil(np.log2(num_samples)))

    # Ensure minimum block size (use fft_size as floor)
    num_samples = max(num_samples, fft_size)

    # Cap at reasonable maximum (1M samples)
    num_samples = min(num_samples, 1048576)

    return num_samples


def remove_dc_offset(samples):
    """
    Remove DC offset by subtracting the mean
    """
    # Calculate the mean of the complex samples
    mean_i = np.mean(np.real(samples))
    mean_q = np.mean(np.imag(samples))

    # Subtract the mean
    samples_no_dc = samples - (mean_i + 1j * mean_q)

    return samples_no_dc
