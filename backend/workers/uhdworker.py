# flake8: noqa
# pylint: skip-file
# mypy: ignore-errors
# Native bindings are untyped; keep exports visible when checking this file directly.

import logging
import time
from typing import Any, Dict

import numpy as np
import psutil

from common.errors import format_device_error
from common.iqsamples import require_complex64
from hardware.receiver import read_uhd_receiver
from hardware.soapybandwidth import apply_bandwidth, read_bandwidth
from hardware.uhdsettings import UhdBandwidth, apply_uhd_sources
from workers.configuration import ConfigurationInbox, report_configuration_failure

# Configure logging for the worker process
logger = logging.getLogger("uhd-worker")

try:
    import uhd
except ImportError:
    uhd = None
    logging.warning("UHD library not found. UHD functionality will not be available.")


def uhd_worker_process(
    config_queue, data_queue, stop_event, iq_queue_fft=None, iq_queue_demod=None
):
    """
    Worker process for UHD operations.

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

    if uhd is None:
        error_msg = "UHD library not available. Cannot start UHD worker."
        logger.error(error_msg)
        data_queue.put(
            {"type": "error", "client_id": None, "message": error_msg, "timestamp": time.time()}
        )
        data_queue.put(
            {
                "type": "terminated",
                "client_id": None,
                "message": error_msg,
                "timestamp": time.time(),
            }
        )

        return

    # Default configuration
    UHD = None
    sdr_id = None
    client_id = None
    streamer = None
    config = {}
    stage = "reading initial configuration"

    logger.info(f"UHD worker process started for SDR {sdr_id} for client {client_id}")

    try:
        # Wait for initial configuration
        logger.info(f"Waiting for initial configuration for SDR {sdr_id} for client {client_id}...")
        config = config_queue.get()
        logger.info(f"Initial configuration: {config}")
        new_config = config
        old_config = config

        # Configure the SDR device
        sdr_id = config.get("sdr_id")
        serial_number = config.get("serial_number")
        client_id = config.get("client_id")
        fft_size = config.get("fft_size", 16384)
        fft_window = config.get("fft_window", "hanning")

        # FFT averaging configuration (passed to IQ consumers)
        fft_averaging = config.get("fft_averaging", 8)

        # FFT overlap (passed to IQ consumers)
        fft_overlap_percent = int(config.get("fft_overlap_percent", 0) or 0)
        fft_overlap_depth = int(config.get("fft_overlap_depth", 16) or 16)

        # Track whether we have IQ consumers
        has_iq_consumers = iq_queue_fft is not None or iq_queue_demod is not None

        # Connect to the UHD device
        logger.info(f"Connecting to UHD device with serial: {serial_number}...")

        # A confusing issue exists when selecting an SDR with serial=XXXXXX, some times it does
        # not work inside docker containers, the method below is a workaround to fix this issue,
        # it will look up all devices, lookup the one we want based on the serial and then use every
        # other attribute to construct the device args string.

        if serial_number:
            logger.info(f"Looking for device with serial: {serial_number}")

            # Discover all USRP devices (no type filter)
            stage = "discovering devices"
            discovered_devices = uhd.find("")
            logger.info(f"Found {len(discovered_devices)} USRP device(s)")

            # Find the device matching the serial
            stage = "selecting device"
            device_args = None
            discovered_serials = []
            for dev in discovered_devices:
                dev_string = dev.to_string()
                logger.info(f"Discovered: {dev_string}")

                # Compare the whole serial so a shorter prefix cannot select another USRP.
                parts = [part.strip() for part in dev_string.split(",")]
                device_serials = [
                    part.split("=", 1)[1] for part in parts if part.startswith("serial=")
                ]
                discovered_serials.extend(device_serials)
                if str(serial_number) in device_serials:
                    # Use the discovery string but remove the serial key to avoid lookup failure
                    # Keep other identifiers like type, name, product, addr (for network devices)
                    filtered_parts = [p for p in parts if not p.startswith("serial=")]
                    device_args = ",".join(filtered_parts)
                    logger.info(f"Matched device, using args: {device_args}")
                    break

            if not device_args:
                available = ", ".join(discovered_serials) if discovered_serials else "none reported"
                raise LookupError(
                    f"No matching USRP among {len(discovered_devices)} discovered device(s); "
                    f"available serials: {available}"
                )
        else:
            device_args = ""
            logger.info(f"No serial specified, will connect to first available device")

        # Create UHD device
        stage = "opening device"
        UHD = uhd.usrp.MultiUSRP(device_args)

        # Get device info
        device_info = UHD.get_pp_string()
        logger.info(f"Connected to UHD: {device_info}")

        # Configure the device
        stage = "configuring receiver"
        channel = config.get("channel", 0)
        sdr_settings = config.get("sdr_settings") or {}
        source_errors = apply_uhd_sources(UHD, sdr_settings)
        antenna = config.get("antenna", "RX2")

        # Set antenna
        UHD.set_rx_antenna(antenna, channel)

        # Configure basic parameters
        center_freq = config.get("center_freq", 100e6)
        sample_rate = config.get("sample_rate", 2.048e6)
        gain = config.get("gain", 25.0)
        # Add support for offset frequency (downconverter)
        offset_freq = config.get("offset_freq", 0.0)
        ppm_error = float(config.get("ppm_error", 0) or 0)
        corrected_center_freq = center_freq * (1 + ppm_error * 1e-6)
        # Frequency contract:
        # - logical_center_freq: user-facing "true RF" center for pipeline consumers
        # - actual_freq: device-reported RF/LO tune center
        # UHD may also apply DSP shift; downstream must still anchor on logical center.
        logical_center_freq = corrected_center_freq

        def _set_uhd_rx_freq(desired_center_hz: float, offset_hz: float) -> float:
            """
            Tune UHD to hardware RF center with converter offset applied.
            This intentionally avoids DSP recentering to match Soapy/RTL behavior:
            changing offset moves received spectrum unless center/VFO is also adjusted.

            Returns:
                float: Frequency reported by UHD after tuning.
            """
            UHD.set_rx_freq(uhd.types.TuneRequest(desired_center_hz + offset_hz), channel)
            return UHD.get_rx_freq(channel)

        UHD.set_rx_rate(sample_rate, channel)

        # Apply center/offset tuning
        actual_freq = _set_uhd_rx_freq(corrected_center_freq, offset_freq)
        if offset_freq != 0.0:
            logger.info(f"Applied offset frequency: {offset_freq} Hz")

        UHD.set_rx_gain(gain, channel)

        bandwidth_receiver = UhdBandwidth(UHD)
        default_bandwidth = read_bandwidth(bandwidth_receiver, 0, channel)
        bandwidth_selection = (sdr_settings.get("uhd") or {}).get("bandwidth")

        def update_bandwidth(selection):
            status = apply_bandwidth(
                bandwidth_receiver,
                0,
                channel,
                actual_rate,
                selection,
                "uhd",
                logger,
                default_bandwidth,
            )
            data_queue.put({"type": "bandwidth", "sdr_id": sdr_id, "status": status})

        def report_receiver():
            status = read_uhd_receiver(UHD, channel, logger)
            status["configuration_errors"] = source_errors.copy()
            data_queue.put({"type": "receiver", "sdr_id": sdr_id, "status": status})

        # Enable automatic DC offset correction to mitigate center spike
        UHD.set_rx_dc_offset(True, channel)
        logger.info("Enabled automatic DC offset correction")

        # Allow time for the UHD to settle
        time.sleep(0.01)

        # Verify actual settings
        actual_rate = UHD.get_rx_rate(channel)
        actual_freq = UHD.get_rx_freq(channel)
        actual_gain = UHD.get_rx_gain(channel)
        update_bandwidth(bandwidth_selection)
        report_receiver()

        if ppm_error:
            logger.info(f"Applied frequency correction: {ppm_error} ppm")

        logger.info(
            "UHD configured: "
            f"sample_rate={actual_rate}, logical_center_freq={logical_center_freq}, "
            f"rf_center_freq={actual_freq}, gain={actual_gain}, offset_freq={offset_freq}"
        )

        # Setup streaming with smaller buffer sizes to prevent overflow
        stage = "setting up RX stream"
        stream_args = uhd.usrp.StreamArgs("fc32", "sc16")
        stream_args.channels = [channel]
        # Set smaller buffer sizes to reduce latency and prevent overflow
        stream_args.args = uhd.types.DeviceAddr("num_recv_frames=128,recv_frame_size=4096")
        streamer = UHD.get_rx_stream(stream_args)

        # Calculate the number of samples based on sample rate
        num_samples = calculate_samples_per_scan(actual_rate, fft_size)

        # Create receive buffer for smaller reads to build fixed-size chunks
        read_size = min(num_samples, 8192)
        recv_buffer = np.zeros((1, read_size), dtype=np.complex64)

        # Start streaming
        stream_cmd = uhd.types.StreamCMD(uhd.types.StreamMode.start_cont)
        stream_cmd.stream_now = True
        streamer.issue_stream_cmd(stream_cmd)

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
        usb_overflow_reported = False
        stream_chunk_id = 0
        stream_sample_index = 0

        # CPU and memory monitoring
        process = psutil.Process()
        last_cpu_check = time.time()
        cpu_check_interval = 0.5

        inbox = ConfigurationInbox(config_queue)

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
            new_config = old_config
            try:
                update = inbox.get()
                if update is not None and update.get("type") == "get_center_freq":
                    update["response_queue"].put({"center_freq": logical_center_freq})
                    update = None
                if update is not None:
                    new_config = {**old_config, **update}
                    next_settings = new_config.get("sdr_settings") or {}
                    sources_changed = any(
                        (next_settings.get("uhd") or {}).get(key)
                        != (sdr_settings.get("uhd") or {}).get(key)
                        for key in ("clockSource", "timeSource")
                    )
                    next_bandwidth = (next_settings.get("uhd") or {}).get("bandwidth")
                    bandwidth_changed = (
                        sources_changed
                        or any(
                            old_config.get(key) != new_config.get(key)
                            for key in ("sample_rate", "antenna")
                        )
                        or next_bandwidth != bandwidth_selection
                    )

                    if sources_changed:
                        # Reference changes can reset the clock/rate. Pause RX,
                        # restore the requested tuning, then resume the stream.
                        command = uhd.types.StreamCMD(uhd.types.StreamMode.stop_cont)
                        streamer.issue_stream_cmd(command)
                        source_errors = apply_uhd_sources(UHD, next_settings, sdr_settings)
                        UHD.set_rx_rate(new_config["sample_rate"], channel)
                        actual_rate = UHD.get_rx_rate(channel)
                        num_samples = calculate_samples_per_scan(actual_rate, fft_size)
                        read_size = min(num_samples, 8192)
                        recv_buffer = np.zeros((1, read_size), dtype=np.complex64)
                        actual_freq = _set_uhd_rx_freq(corrected_center_freq, offset_freq)
                        command = uhd.types.StreamCMD(uhd.types.StreamMode.start_cont)
                        command.stream_now = True
                        streamer.issue_stream_cmd(command)

                    if "sample_rate" in new_config:
                        if actual_rate != new_config["sample_rate"]:
                            # Stop streaming before changing sample rate - fix stream mode
                            stream_cmd = uhd.types.StreamCMD(uhd.types.StreamMode.stop_cont)
                            streamer.issue_stream_cmd(stream_cmd)

                            UHD.set_rx_rate(new_config["sample_rate"], channel)
                            actual_rate = UHD.get_rx_rate(channel)

                            # Calculate a new number of samples
                            num_samples = calculate_samples_per_scan(actual_rate, fft_size)
                            read_size = min(num_samples, 8192)
                            recv_buffer = np.zeros((1, read_size), dtype=np.complex64)

                            # Restart streaming
                            stream_cmd = uhd.types.StreamCMD(uhd.types.StreamMode.start_cont)
                            stream_cmd.stream_now = True
                            streamer.issue_stream_cmd(stream_cmd)

                            logger.info(f"Updated sample rate: {actual_rate}")

                    if "center_freq" in new_config:
                        if center_freq != new_config["center_freq"]:
                            # Stop streaming to flush buffers
                            stream_cmd = uhd.types.StreamCMD(uhd.types.StreamMode.stop_cont)
                            streamer.issue_stream_cmd(stream_cmd)

                            # Update center frequency
                            center_freq = new_config["center_freq"]
                            corrected_center_freq = center_freq * (1 + ppm_error * 1e-6)
                            logical_center_freq = corrected_center_freq

                            actual_freq = _set_uhd_rx_freq(corrected_center_freq, offset_freq)

                            # Restart streaming
                            stream_cmd = uhd.types.StreamCMD(uhd.types.StreamMode.start_cont)
                            stream_cmd.stream_now = True
                            streamer.issue_stream_cmd(stream_cmd)

                            logger.info(
                                f"Updated center frequency: logical={logical_center_freq}, rf={actual_freq}"
                            )

                    if "offset_freq" in new_config:
                        if offset_freq != new_config["offset_freq"]:
                            # Stop streaming to flush buffers
                            stream_cmd = uhd.types.StreamCMD(uhd.types.StreamMode.stop_cont)
                            streamer.issue_stream_cmd(stream_cmd)

                            # Update offset frequency
                            offset_freq = new_config["offset_freq"]

                            actual_freq = _set_uhd_rx_freq(corrected_center_freq, offset_freq)
                            if offset_freq != 0.0:
                                logger.info(f"Updated offset frequency: {offset_freq}")
                            else:
                                logger.info("Disabled offset frequency")

                            # Restart streaming
                            stream_cmd = uhd.types.StreamCMD(uhd.types.StreamMode.start_cont)
                            stream_cmd.stream_now = True
                            streamer.issue_stream_cmd(stream_cmd)

                    if "ppm_error" in new_config:
                        new_ppm_error = float(new_config["ppm_error"] or 0)
                        if ppm_error != new_ppm_error:
                            # Stop streaming to flush buffers
                            stream_cmd = uhd.types.StreamCMD(uhd.types.StreamMode.stop_cont)
                            streamer.issue_stream_cmd(stream_cmd)

                            ppm_error = new_ppm_error
                            corrected_center_freq = center_freq * (1 + ppm_error * 1e-6)
                            logical_center_freq = corrected_center_freq

                            actual_freq = _set_uhd_rx_freq(corrected_center_freq, offset_freq)

                            # Restart streaming
                            stream_cmd = uhd.types.StreamCMD(uhd.types.StreamMode.start_cont)
                            stream_cmd.stream_now = True
                            streamer.issue_stream_cmd(stream_cmd)

                            logger.info(f"Updated frequency correction: {ppm_error} ppm")

                    if "gain" in new_config:
                        if actual_gain != new_config["gain"]:
                            UHD.set_rx_gain(new_config["gain"], channel)
                            actual_gain = UHD.get_rx_gain(channel)
                            logger.info(f"Updated gain: {actual_gain}")

                    if "fft_size" in new_config:
                        if old_config.get("fft_size", 0) != new_config["fft_size"]:
                            fft_size = new_config["fft_size"]

                            # Update num_samples when FFT size changes
                            num_samples = calculate_samples_per_scan(actual_rate, fft_size)

                            # Create receive buffer
                            read_size = min(num_samples, 8192)
                            recv_buffer = np.zeros((1, read_size), dtype=np.complex64)

                            logger.info(f"Updated FFT size: {fft_size}")

                    if "fft_window" in new_config:
                        if old_config.get("fft_window", None) != new_config["fft_window"]:
                            fft_window = new_config["fft_window"]
                            logger.info(f"Updated FFT window: {fft_window}")

                    if "fft_averaging" in new_config:
                        if old_config.get("fft_averaging", 4) != new_config["fft_averaging"]:
                            fft_averaging = new_config["fft_averaging"]
                            # FFT averaging is now handled by FFT processor
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

                    if "antenna" in new_config:
                        if old_config.get("antenna", None) != new_config["antenna"]:
                            UHD.set_rx_antenna(new_config["antenna"], channel)
                            logger.info(f"Updated antenna: {new_config['antenna']}")

                    if bandwidth_changed:
                        selection = next_bandwidth
                        if selection is None and bandwidth_selection is not None:
                            selection = "driver"
                        update_bandwidth(selection)
                        bandwidth_selection = next_bandwidth
                    if any(
                        old_config.get(key) != new_config.get(key)
                        for key in (
                            "gain",
                            "sample_rate",
                            "center_freq",
                            "offset_freq",
                            "ppm_error",
                            "antenna",
                            "sdr_settings",
                        )
                    ):
                        report_receiver()
                    sdr_settings = next_settings
                    old_config = new_config
                    # Acceptance is broadcast by the parent; this acknowledges
                    # hardware completion so decoders restart against settled IQ.
                    data_queue.put(
                        {
                            "type": "config-applied",
                            "config_revision": new_config.get("config_revision", 0),
                        }
                    )

            except Exception as e:
                error_msg = f"Error processing configuration: {str(e)}"
                logger.error(error_msg)
                logger.exception(e)

                # A failed tune must reconcile the UI with measured hardware,
                # but only if this request is still the latest one in the parent.
                report_configuration_failure(
                    data_queue,
                    new_config,
                    read_uhd_receiver(UHD, channel, logger),
                    error_msg,
                    offset=offset_freq,
                    correction=1 + ppm_error * 1e-6,
                )
                center_freq = old_config.get("center_freq", center_freq)

            try:
                # Accumulate samples until we have a full chunk
                samples_buffer = np.zeros(num_samples, dtype=np.complex64)
                buffer_position = 0

                while buffer_position < num_samples and not stop_event.is_set():
                    metadata = uhd.types.RXMetadata()
                    try:
                        num_rx_samples = streamer.recv(recv_buffer, metadata, 0.05)
                    except RuntimeError as e:
                        error_text = str(e)
                        if "LIBUSB_TRANSFER_OVERFLOW" in error_text:
                            if not usb_overflow_reported:
                                usb_overflow_reported = True
                                overflow_msg = (
                                    "USB RX overflow (LIBUSB_TRANSFER_OVERFLOW). "
                                    "Streaming has been stopped."
                                )
                                logger.error(overflow_msg)
                                data_queue.put(
                                    {
                                        "type": "error",
                                        "client_id": client_id,
                                        "message": overflow_msg,
                                        "timestamp": time.time(),
                                    }
                                )
                            stop_event.set()
                            break
                        raise

                    if metadata.error_code != uhd.types.RXMetadataErrorCode.none:
                        stats["read_errors"] += 1
                        stats["last_read_error"] = (
                            f"UHD receiver: {metadata.strerror()} (code {metadata.error_code})"
                        )
                        if metadata.error_code == uhd.types.RXMetadataErrorCode.overflow:
                            logger.warning("Receiver overflow - skipping frame")
                            continue
                        logger.warning(f"Receiver error: {metadata.strerror()} - skipping frame")
                        buffer_position = 0
                        break

                    if num_rx_samples < 256:
                        continue
                    stats.pop("last_read_error", None)

                    samples_remaining = num_samples - buffer_position
                    samples_to_add = min(num_rx_samples, samples_remaining)

                    samples_buffer[buffer_position : buffer_position + samples_to_add] = (
                        recv_buffer[0][:samples_to_add]
                    )
                    buffer_position += samples_to_add

                    stats["samples_read"] += samples_to_add
                    stats["last_activity"] = time.time()

                if buffer_position < num_samples:
                    logger.warning(
                        f"Not enough samples accumulated: {buffer_position}/{num_samples}"
                    )
                    time.sleep(0.005)
                    continue

                samples = samples_buffer[:buffer_position]
                samples = require_complex64(samples, source="uhd-worker")
                chunk_sample_count = len(samples)
                chunk_id = stream_chunk_id
                chunk_start_sample = stream_sample_index
                stream_chunk_id += 1
                stream_sample_index += chunk_sample_count

                # Stream IQ data to consumers (FFT processor, demodulators, etc.)
                # Broadcast to both queues so FFT and demodulation can work independently
                if has_iq_consumers:
                    try:
                        # Prepare IQ message with metadata
                        timestamp = time.time()

                        # Broadcast to FFT queue (for waterfall display)
                        if iq_queue_fft is not None:
                            try:
                                if not iq_queue_fft.full():
                                    iq_message = {
                                        "samples": samples.copy(),
                                        # `center_freq` is intentionally logical (not RF/LO).
                                        # Demod/decoder translation should use this invariant field.
                                        "center_freq": logical_center_freq,
                                        "logical_center_freq_hz": logical_center_freq,
                                        "rf_center_freq_hz": actual_freq,
                                        "dsp_shift_hz": 0.0,
                                        "offset_freq_hz": offset_freq,
                                        "sample_rate": actual_rate,
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
                            except Exception as e:
                                stats["queue_drops"] += 1

                        # Broadcast to demodulation queue
                        if iq_queue_demod is not None:
                            try:
                                if not iq_queue_demod.full():
                                    # Make a copy for demod queue
                                    demod_message = {
                                        "samples": samples.copy(),
                                        "center_freq": logical_center_freq,
                                        "logical_center_freq_hz": logical_center_freq,
                                        "rf_center_freq_hz": actual_freq,
                                        "dsp_shift_hz": 0.0,
                                        "offset_freq_hz": offset_freq,
                                        "sample_rate": actual_rate,
                                        "timestamp": timestamp,
                                        "stream_chunk_id": chunk_id,
                                        "stream_start_sample": chunk_start_sample,
                                        "stream_sample_count": chunk_sample_count,
                                    }
                                    iq_queue_demod.put_nowait(demod_message)
                                    stats["iq_chunks_out"] += 1
                                else:
                                    stats["queue_drops"] += 1
                            except Exception as e:
                                stats["queue_drops"] += 1

                    except Exception as e:
                        logger.debug(f"Could not queue IQ data: {str(e)}")

            except Exception as e:
                error_msg = format_device_error(
                    "UHD", "receiving samples", e, serial=config.get("serial_number")
                )
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

                # Short pause before retrying
                time.sleep(0.1)  # Reduced from 1 second

    except Exception as e:
        error_msg = format_device_error("UHD", stage, e, serial=config.get("serial_number"))
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
        if streamer:
            try:
                # Stop streaming - fix stream mode consistency
                stream_cmd = uhd.types.StreamCMD(uhd.types.StreamMode.stop_cont)
                streamer.issue_stream_cmd(stream_cmd)
                logger.info("UHD streaming stopped")
            except Exception as e:
                logger.error(f"Error stopping UHD streaming: {str(e)}")

        # Send termination signal
        data_queue.put(
            {
                "type": "terminated",
                "client_id": client_id,
                "sdr_id": sdr_id,
                "timestamp": time.time(),
            }
        )

        logger.info("UHD worker process terminated")


# Target blocks per second for constant rate streaming
TARGET_BLOCKS_PER_SEC = 15


def calculate_samples_per_scan(sample_rate, fft_size):
    """Calculate number of samples per scan for constant block rate streaming."""
    if fft_size is None:
        fft_size = 16384

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
