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


import json
import logging
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Dict

import numpy as np
import psutil

from common.iqsamples import require_complex64
from common.pathguard import (
    get_sigmf_allowed_roots,
    resolve_sigmf_data_path,
    resolve_sigmf_meta_path,
)

# Configure logging for the worker process
logger = logging.getLogger("sigmf-playback")
SUPPORTED_DATATYPES = {"cf32_le", "ci16_le", "ci16", "ci8", "ci8_le", "cu8", "cu8_le"}


def sigmf_playback_worker_process(
    config_queue, data_queue, stop_event, iq_queue_fft=None, iq_queue_demod=None
):
    """
    Worker process for playing back SigMF recordings.

    This function runs in a separate process to handle SigMF file playback.
    It reads IQ samples from a .sigmf-data file and streams them to the UI
    just like a real SDR would.

    Args:
        config_queue: Queue for receiving configuration from the main process
        data_queue: Queue for sending processed data back to the main process
        stop_event: Event to signal the process to stop
        iq_queue_fft: Queue for streaming raw IQ samples to FFT processor
        iq_queue_demod: Queue for streaming raw IQ samples to demodulators
    """

    # Default configuration
    sdr_id = None
    client_id = None
    config = {}
    data_file = None

    logger.info("SigMF playback worker process started")

    try:
        # Wait for initial configuration
        logger.info("Waiting for initial configuration...")
        config = config_queue.get()

        logger.info(f"Initial configuration: {config}")
        new_config = config
        old_config = config

        # Extract configuration
        sdr_id = config.get("sdr_id")
        client_id = config.get("client_id")
        recording_path = config.get("recording_path")
        fft_size = config.get("fft_size", 16384)
        fft_window = config.get("fft_window", "hanning")
        fft_averaging = config.get("fft_averaging", 6)
        fft_overlap_percent = int(config.get("fft_overlap_percent", 0) or 0)
        fft_overlap_depth = int(config.get("fft_overlap_depth", 16) or 16)
        loop_playback = config.get("loop_playback", True)  # Loop by default

        # Track whether we have IQ consumers
        has_iq_consumers = iq_queue_fft is not None or iq_queue_demod is not None

        allowed_roots = get_sigmf_allowed_roots()
        meta_path = resolve_sigmf_meta_path(recording_path, allowed_roots=allowed_roots)

        if not meta_path.exists():
            raise FileNotFoundError(f"SigMF metadata file not found: {meta_path}")

        # Read metadata
        logger.info(f"Reading SigMF metadata from: {meta_path}")
        with open(meta_path, "r") as f:
            metadata = json.load(f)

        # Extract parameters
        global_meta = metadata.get("global", {})
        sample_rate = global_meta.get("core:sample_rate", 2.048e6)
        datatype = global_meta.get("core:datatype", "cf32_le")

        if datatype not in SUPPORTED_DATATYPES:
            logger.warning(f"Datatype {datatype} may not be fully supported")

        # Get captures
        captures = metadata.get("captures", [])
        if not captures:
            logger.warning("No capture segments found, using default frequency")
            captures = [{"core:sample_start": 0, "core:frequency": 100e6}]
        else:
            captures = sorted(captures, key=lambda c: int(c.get("core:sample_start", 0) or 0))

        # Open data file
        data_path = resolve_sigmf_data_path(meta_path, allowed_roots=allowed_roots)

        if not data_path.exists():
            raise FileNotFoundError(f"SigMF data file not found: {data_path}")

        logger.info(f"Opening SigMF data file: {data_path}")
        data_file = open(data_path, "rb")

        # Calculate total recording duration
        file_size_bytes = data_path.stat().st_size
        bytes_per_sample = get_bytes_per_sample(datatype)
        if bytes_per_sample == 0:
            raise ValueError(f"Unsupported SigMF datatype: {datatype}")
        if file_size_bytes % bytes_per_sample != 0:
            logger.warning("Data file size is not aligned to sample size for %s", datatype)
        total_samples_in_file = file_size_bytes // bytes_per_sample
        total_recording_duration_seconds = total_samples_in_file / sample_rate
        logger.info(
            f"Recording duration: {total_recording_duration_seconds:.2f} seconds "
            f"({total_samples_in_file} samples)"
        )

        # Calculate samples per scan (similar to other workers)
        num_samples = calculate_samples_per_scan(sample_rate, fft_size)
        logger.info(
            f"Playback configured: rate={sample_rate/1e6:.2f} MS/s, block_size={num_samples}"
        )

        # Track current capture segment
        total_samples_read = 0
        current_capture_idx, current_freq = resolve_capture_segment(
            captures,
            sample_index=total_samples_read,
            default_frequency=captures[0].get("core:frequency", 100e6),
        )

        # Extract recording start datetime from first capture segment
        recording_start_datetime = None
        if captures and "core:datetime" in captures[0]:
            datetime_str = captures[0]["core:datetime"]
            try:
                # Parse ISO format datetime (e.g., "2025-11-29T11:07:23Z")
                recording_start_datetime = datetime.fromisoformat(
                    datetime_str.replace("Z", "+00:00")
                )
                # Treat naive datetimes as UTC for backward compatibility.
                if recording_start_datetime.tzinfo is None:
                    recording_start_datetime = recording_start_datetime.replace(tzinfo=timezone.utc)
                logger.info(f"Recording start datetime: {recording_start_datetime}")
            except Exception as e:
                logger.warning(f"Could not parse recording datetime: {e}")

        # Send streaming start signal
        data_queue.put(
            {
                "type": "streamingstart",
                "client_id": client_id,
                "message": None,
                "timestamp": time.time(),
            }
        )

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

        # CPU and memory monitoring
        process = psutil.Process()
        last_cpu_check = time.time()
        cpu_check_interval = 0.5

        logger.info("Starting SigMF playback loop")

        # Main playback loop
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
            # Check for configuration updates
            try:
                if not config_queue.empty():
                    new_config = config_queue.get_nowait()

                    # Handle configuration changes
                    if "fft_size" in new_config:
                        if old_config.get("fft_size", 0) != new_config["fft_size"]:
                            fft_size = new_config["fft_size"]
                            num_samples = calculate_samples_per_scan(sample_rate, fft_size)
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

                    if "loop_playback" in new_config:
                        if old_config.get("loop_playback", True) != new_config["loop_playback"]:
                            loop_playback = new_config["loop_playback"]
                            logger.info(f"Updated loop playback: {loop_playback}")

                    # Seek requests are best-effort runtime jumps expressed in seconds.
                    # We clamp them inside file bounds, then reposition both file cursor
                    # and playback accounting state so timing fields stay coherent.
                    if "seek_seconds" in new_config and data_file is not None:
                        requested_seek_seconds_raw = new_config.get("seek_seconds")
                        if requested_seek_seconds_raw is None:
                            logger.warning("Ignoring empty seek_seconds value")
                        else:
                            try:
                                requested_seek_seconds = float(str(requested_seek_seconds_raw))
                            except (TypeError, ValueError):
                                logger.warning(
                                    f"Ignoring invalid seek_seconds value: {requested_seek_seconds_raw}"
                                )
                            else:
                                if requested_seek_seconds < 0:
                                    requested_seek_seconds = 0.0

                                if total_samples_in_file <= 0:
                                    logger.warning(
                                        "Cannot seek playback because recording has zero samples"
                                    )
                                else:
                                    target_sample_index = int(requested_seek_seconds * sample_rate)
                                    max_sample_index = max(total_samples_in_file - 1, 0)
                                    if target_sample_index > max_sample_index:
                                        target_sample_index = max_sample_index

                                    target_byte_offset = target_sample_index * bytes_per_sample
                                    data_file.seek(target_byte_offset)
                                    total_samples_read = target_sample_index
                                    current_capture_idx, current_freq = resolve_capture_segment(
                                        captures,
                                        sample_index=target_sample_index,
                                        default_frequency=captures[0].get("core:frequency", 100e6),
                                    )
                                    logger.info(
                                        "Seeked playback to %.2fs (sample %s/%s, capture idx %s)",
                                        requested_seek_seconds,
                                        target_sample_index,
                                        total_samples_in_file,
                                        current_capture_idx,
                                    )

                    # Keep a merged view because runtime updates are usually partial payloads.
                    old_config = {**old_config, **new_config}

            except Exception as e:
                logger.error(f"Error processing configuration: {str(e)}")

            try:
                # Read samples from file
                bytes_to_read = num_samples * bytes_per_sample
                data = data_file.read(bytes_to_read)

                # Check if we reached end of file
                if len(data) < bytes_to_read:
                    if loop_playback:
                        logger.info("Reached end of recording, looping back to start")
                        data_file.seek(0)
                        total_samples_read = 0
                        current_capture_idx = 0
                        current_freq = captures[0].get("core:frequency", 100e6)
                        # Read again from the beginning
                        data = data_file.read(bytes_to_read)
                    else:
                        logger.info("Reached end of recording, stopping playback")
                        break

                if len(data) == 0:
                    logger.warning("No data read from file")
                    time.sleep(0.1)
                    continue

                # Convert bytes to complex64 samples
                samples = parse_iq_samples(data, datatype)
                samples = require_complex64(samples, source="sigmf-playback-worker")
                samples_read = len(samples)
                total_samples_read += samples_read
                stats["samples_read"] += samples_read
                stats["last_activity"] = time.time()

                # Check if we've moved into a new capture segment
                for idx in range(current_capture_idx + 1, len(captures)):
                    if total_samples_read >= captures[idx].get("core:sample_start", 0):
                        current_capture_idx = idx
                        current_freq = captures[idx].get("core:frequency", current_freq)
                        logger.info(
                            f"Moved to capture segment {idx}: freq={current_freq/1e6:.3f} MHz"
                        )

                # Remove DC offset
                samples = remove_dc_offset(samples)

                # Stream IQ data to consumers
                if has_iq_consumers:
                    try:
                        timestamp = time.time()

                        # Calculate playback timing info
                        recording_datetime = None
                        playback_elapsed_seconds = total_samples_read / sample_rate
                        playback_remaining_seconds = (
                            total_recording_duration_seconds - playback_elapsed_seconds
                        )

                        if recording_start_datetime is not None:
                            current_recording_datetime = recording_start_datetime + timedelta(
                                seconds=playback_elapsed_seconds
                            )
                            # Format as UTC ISO string with Z suffix.
                            recording_datetime = (
                                current_recording_datetime.astimezone(timezone.utc)
                                .replace(microsecond=0)
                                .isoformat()
                                .replace("+00:00", "Z")
                            )

                        # Broadcast to FFT queue
                        if iq_queue_fft is not None:
                            try:
                                if not iq_queue_fft.full():
                                    iq_message = {
                                        "samples": samples.copy(),
                                        "center_freq": current_freq,
                                        "sample_rate": sample_rate,
                                        "timestamp": timestamp,
                                        "config": {
                                            "fft_size": fft_size,
                                            "fft_window": fft_window,
                                            "fft_averaging": fft_averaging,
                                            "fft_overlap_percent": fft_overlap_percent,
                                            "fft_overlap_depth": fft_overlap_depth,
                                        },
                                    }
                                    # Add playback timing info (only for playback mode)
                                    if recording_datetime is not None:
                                        iq_message["recording_datetime"] = recording_datetime
                                    iq_message["playback_elapsed_seconds"] = (
                                        playback_elapsed_seconds
                                    )
                                    iq_message["playback_remaining_seconds"] = (
                                        playback_remaining_seconds
                                    )
                                    iq_message["playback_total_seconds"] = (
                                        total_recording_duration_seconds
                                    )

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
                                        "center_freq": current_freq,
                                        "sample_rate": sample_rate,
                                        "timestamp": timestamp,
                                    }
                                    # Add playback timing info (only for playback mode)
                                    if recording_datetime is not None:
                                        demod_message["recording_datetime"] = recording_datetime
                                    demod_message["playback_elapsed_seconds"] = (
                                        playback_elapsed_seconds
                                    )
                                    demod_message["playback_remaining_seconds"] = (
                                        playback_remaining_seconds
                                    )
                                    demod_message["playback_total_seconds"] = (
                                        total_recording_duration_seconds
                                    )

                                    iq_queue_demod.put_nowait(demod_message)
                                    stats["iq_chunks_out"] += 1
                                else:
                                    stats["queue_drops"] += 1
                            except Exception:
                                stats["queue_drops"] += 1

                    except Exception as e:
                        logger.debug(f"Could not queue IQ data: {str(e)}")

                # Timing: sleep to simulate real-time playback
                # Calculate time this block should take at the given sample rate
                block_duration = samples_read / sample_rate
                time.sleep(block_duration)

            except Exception as e:
                logger.error(f"Error processing playback data: {str(e)}")

                logger.exception(e)

                stats["errors"] += 1

                # Send error back to the main process
                data_queue.put(
                    {
                        "type": "error",
                        "client_id": client_id,
                        "message": str(e),
                        "timestamp": time.time(),
                    }
                )

                # Pause before retrying
                time.sleep(1)

    except Exception as e:
        error_msg = f"Error in SigMF playback worker process: {str(e)}"
        logger.error(error_msg)
        logger.exception(e)

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
        # Sleep for 0.5 second to allow the main process to read the data queue messages
        time.sleep(0.5)

        # Clean up resources
        logger.info(f"Cleaning up resources for SDR {sdr_id}...")
        if data_file:
            try:
                data_file.close()
                logger.info("SigMF data file closed")
            except Exception as e:
                logger.error(f"Error closing SigMF data file: {str(e)}")

        # Send termination signal
        data_queue.put(
            {
                "type": "terminated",
                "client_id": client_id,
                "sdr_id": sdr_id,
                "timestamp": time.time(),
            }
        )

        logger.info("SigMF playback worker process terminated")


# Target blocks per second for constant rate streaming
TARGET_BLOCKS_PER_SEC = 15


def resolve_capture_segment(captures, sample_index: int, default_frequency: float):
    """
    Resolve active capture segment and its center frequency for a sample position.
    """
    active_index = 0
    active_frequency = default_frequency

    for idx, capture in enumerate(captures):
        capture_start = int(capture.get("core:sample_start", 0) or 0)
        if sample_index < capture_start:
            break
        active_index = idx
        active_frequency = capture.get("core:frequency", active_frequency)

    return active_index, active_frequency


def calculate_samples_per_scan(sample_rate, fft_size):
    """Calculate number of samples per scan for constant block rate streaming."""
    if fft_size is None:
        fft_size = 8192

    # Calculate block size for constant rate
    num_samples = int(sample_rate / TARGET_BLOCKS_PER_SEC)

    # Round up to next power of 2 for efficient FFT processing
    num_samples = 2 ** int(np.ceil(np.log2(num_samples)))

    # Ensure minimum block size (use fft_size as floor)
    num_samples = max(num_samples, fft_size)

    # Cap at reasonable maximum (1M samples)
    num_samples = min(num_samples, 1048576)

    return num_samples


def get_bytes_per_sample(datatype: str) -> int:
    if datatype == "cf32_le":
        return 8
    if datatype in ("ci16_le", "ci16"):
        return 4
    if datatype in ("ci8", "ci8_le", "cu8", "cu8_le"):
        return 2
    return 0


def parse_iq_samples(data: bytes, datatype: str) -> np.ndarray:
    """
    Parse raw IQ bytes into complex64 samples based on SigMF datatype.
    """
    if datatype == "cf32_le":
        return np.frombuffer(data, dtype=np.complex64)

    if datatype in ("ci16_le", "ci16"):
        iq = np.frombuffer(data, dtype="<i2")
        if iq.size % 2:
            iq = iq[:-1]
        i = iq[0::2].astype(np.float32)
        q = iq[1::2].astype(np.float32)
        return (i + 1j * q) / 32768.0

    if datatype in ("ci8", "ci8_le"):
        iq = np.frombuffer(data, dtype=np.int8)
        if iq.size % 2:
            iq = iq[:-1]
        i = iq[0::2].astype(np.float32)
        q = iq[1::2].astype(np.float32)
        return (i + 1j * q) / 128.0

    if datatype in ("cu8", "cu8_le"):
        iq = np.frombuffer(data, dtype=np.uint8)
        if iq.size % 2:
            iq = iq[:-1]
        i = iq[0::2].astype(np.float32) - 128.0
        q = iq[1::2].astype(np.float32) - 128.0
        return (i + 1j * q) / 128.0

    logger.warning("Unsupported datatype %s, falling back to cf32_le", datatype)
    return np.frombuffer(data, dtype=np.complex64)


def remove_dc_offset(samples):
    """
    Remove DC offset by subtracting the mean
    """
    # Calculate the mean of the complex samples
    mean_i = np.mean(np.real(samples))
    mean_q = np.mean(np.imag(samples))

    # Check for invalid values (inf/nan from overflow)
    if not np.isfinite(mean_i) or not np.isfinite(mean_q):
        logger.warning(
            f"Invalid mean values detected (mean_i={mean_i}, mean_q={mean_q}), skipping DC offset removal"
        )
        return samples

    # Subtract the mean
    samples_no_dc = samples - (mean_i + 1j * mean_q)

    return samples_no_dc
