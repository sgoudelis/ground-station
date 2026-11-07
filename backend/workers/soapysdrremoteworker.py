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
from typing import Any, Dict, List

import numpy as np
import psutil
import SoapySDR
from SoapySDR import SOAPY_SDR_CF32, SOAPY_SDR_RX

from common.errors import format_device_error
from common.iqsamples import require_complex64
from hardware.receiver import read_soapy_receiver
from hardware.soapybandwidth import apply_bandwidth, read_bandwidth
from workers.configuration import ConfigurationInbox, report_configuration_failure

# Configure logging for the worker process
logger = logging.getLogger("soapysdr-remote")


def _normalize_setting_value(value: Any) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


def _get_bias_setting_keys(sdr: SoapySDR.Device) -> List[str]:
    keys: List[str] = []
    if not hasattr(sdr, "getSettingInfo"):
        return keys
    try:
        for setting in sdr.getSettingInfo():
            key_text = f"{setting.key} {getattr(setting, 'name', '')} {getattr(setting, 'description', '')}"
            if "bias" in key_text.lower():
                keys.append(setting.key)
    except Exception as e:
        logger.warning(f"Failed to enumerate bias settings: {e}")
    return keys


def _apply_soapy_settings(
    sdr: SoapySDR.Device,
    channel: int,
    sdr_settings: Dict[str, Any],
    bias_t: Any,
    bias_setting_keys: List[str],
    soapy_agc: bool,
) -> None:
    if not isinstance(sdr_settings, dict):
        sdr_settings = {}

    # Bias-T via settings
    if bias_t is not None and bias_setting_keys:
        try:
            value = _normalize_setting_value(bool(bias_t))
            for key in bias_setting_keys:
                sdr.writeSetting(key, value)
            logger.info(f"Updated Bias-T via Soapy settings: {value}")
        except Exception as e:
            logger.warning(f"Failed to update Bias-T via Soapy settings: {e}")

    # Bit packing via settings
    if "bitpack" in sdr_settings and sdr_settings["bitpack"] is not None:
        try:
            value = _normalize_setting_value(bool(sdr_settings["bitpack"]))
            sdr.writeSetting("bitpack", value)
            logger.info(f"Updated Soapy setting bitpack: {value}")
        except Exception as e:
            logger.warning(f"Failed to update Soapy setting bitpack: {e}")

    # Clock and time sources
    clock_source = sdr_settings.get("clockSource")
    if clock_source:
        try:
            sdr.setClockSource(clock_source)
            logger.info(f"Updated clock source: {clock_source}")
        except Exception as e:
            logger.warning(f"Failed to update clock source: {e}")

    time_source = sdr_settings.get("timeSource")
    if time_source:
        try:
            sdr.setTimeSource(time_source)
            logger.info(f"Updated time source: {time_source}")
        except Exception as e:
            logger.warning(f"Failed to update time source: {e}")

    # Per-element gains (RX only)
    gains = sdr_settings.get("gains")
    if isinstance(gains, dict) and not soapy_agc:
        for name, value in gains.items():
            if value is None:
                continue
            try:
                sdr.setGain(SOAPY_SDR_RX, channel, name, float(value))
                logger.info(f"Updated gain element {name}: {value} dB")
            except Exception as e:
                logger.debug(f"Failed to update gain element {name}: {e}")


# Target blocks per second for constant rate streaming
# This determines block size: block_size = sample_rate / TARGET_BLOCKS_PER_SEC
# Lower rate = larger blocks, less overhead, higher latency
# Higher rate = smaller blocks, more overhead, lower latency
# Recommended: 10-15 blocks/sec for balance between latency and performance
TARGET_BLOCKS_PER_SEC = 15


def soapysdr_remote_worker_process(
    config_queue, data_queue, stop_event, iq_queue_fft=None, iq_queue_demod=None
):
    """
    Worker process for SoapySDR operations.

    This function runs in a separate process to handle remote SoapySDR devices.
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
    rx_stream = None
    mtu = 0
    config = {}
    stage = "reading initial configuration"

    logger.info(f"Remote SoapySDR worker process started for SDR {sdr_id} for client {client_id}")

    try:
        # Wait for initial configuration
        logger.info(f"Waiting for initial configuration for SDR {sdr_id} for client {client_id}...")
        config = config_queue.get()

        logger.info(f"Initial configuration: {config}")
        new_config = config
        old_config = config

        # Configure the SoapySDR device
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

        driver = config.get("driver", "")
        serial_number = config.get("serial_number", "")

        # Connect to remote SoapySDR server
        hostname = config.get("host", "127.0.0.1")
        port = config.get("port", 55132)

        # The format should be 'remote:host=HOSTNAME:port=PORT,driver=DRIVER,serial=SERIAL'
        device_args = f"remote=tcp://{hostname}:{port},driver=remote,remote:driver={driver}"

        # Add a serial number if provided
        if serial_number:
            device_args += f",serial={serial_number}"

        # Add verified SoapyRemote parameters
        device_args += ",remote:timeout=1000000"  # 1 second timeout (in microseconds)
        device_args += ",remote:mtu=65536"  # 64KB MTU (larger for high sample rates)
        device_args += ",remote:window=524288"  # 512KB socket buffer (larger for high throughput)

        logger.info(f"Connecting to SoapySDR device with args: {device_args}")

        # Create the device instance
        bias_setting_keys: List[str] = []
        stage = "opening remote device"
        try:
            # Attempt to connect to the specified device
            sdr = SoapySDR.Device(device_args)
            stage = "reading device capabilities"

            # Get device info
            device_driver = sdr.getDriverKey()
            hardware = sdr.getHardwareKey()
            logger.info(f"Connected to {device_driver} ({hardware})")

            bias_setting_keys = _get_bias_setting_keys(sdr)

            # Query supported sample rates
            channel = config.get("channel", 0)
            supported_rates = get_supported_sample_rates(sdr, channel)
            logger.debug(f"Supported sample rate ranges: {supported_rates}")

            # Add some extra sample rates to the list
            extra_sample_rates: List[float] = []
            usable_rates = []

            for rate in extra_sample_rates:
                for rate_range in supported_rates:
                    if "minimum" in rate_range and "maximum" in rate_range:
                        if rate_range["minimum"] <= rate <= rate_range["maximum"]:
                            usable_rates.append(rate)
                            break

            logger.debug(f"Usable sample rates: {[rate/1e6 for rate in usable_rates]} MHz")

            # Now choose a sample rate that is supported
            sample_rate = config.get("sample_rate", 2.048e6)
            if usable_rates and sample_rate not in usable_rates:
                # Find the closest supported rate
                closest_rate = min(usable_rates, key=lambda x: abs(x - sample_rate))
                logger.info(
                    f"Requested sample rate {sample_rate/1e6} MHz is not supported. Using closest rate: {closest_rate/1e6} MHz"
                )
                sample_rate = closest_rate

            # Set sample rate
            sdr.setSampleRate(SOAPY_SDR_RX, channel, sample_rate)
            actual_sample_rate = sdr.getSampleRate(SOAPY_SDR_RX, channel)
            logger.debug(f"Sample rate set to {actual_sample_rate/1e6} MHz")

            # Number of samples required for each iteration
            num_samples = calculate_samples_per_scan(actual_sample_rate, fft_size)

        except Exception:
            # The outer handler includes the remote endpoint and native error.
            raise

        # Configure the device
        stage = "configuring receiver"
        center_freq = config.get("center_freq", 100e6)
        # Frequency contract:
        # - logical_center_freq: user-facing "true RF" center for pipeline consumers
        # - actual_freq: device-reported RF tune center (after offset compensation)
        logical_center_freq = center_freq
        sample_rate = config.get("sample_rate", 2.048e6)
        gain = config.get("gain", 25.4)
        antenna = config.get("antenna", "")
        channel = config.get("channel", 0)
        offset_freq = int(config.get("offset_freq", 0))
        ppm_error = float(config.get("ppm_error", 0) or 0)
        bias_t = config.get("bias_t", None)
        sdr_settings = config.get("sdr_settings", {})

        # Set sample rate
        sdr.setSampleRate(SOAPY_SDR_RX, channel, sample_rate)
        actual_sample_rate = sdr.getSampleRate(SOAPY_SDR_RX, channel)
        logger.info(f"Sample rate set to {actual_sample_rate/1e6} MHz")

        # Set center frequency
        sdr.setFrequency(SOAPY_SDR_RX, channel, center_freq + offset_freq)
        actual_freq = sdr.getFrequency(SOAPY_SDR_RX, channel)
        logger.info(
            f"Center frequency set: logical={logical_center_freq/1e6} MHz, rf={actual_freq/1e6} MHz"
        )

        # Apply ppm correction if supported
        if ppm_error:
            try:
                sdr.setFrequencyCorrection(SOAPY_SDR_RX, channel, ppm_error)
                logger.info(f"Applied frequency correction: {ppm_error} ppm")
            except Exception as e:
                logger.warning(f"Failed to apply frequency correction: {e}")

        # Set gain
        if config.get("soapy_agc", False):
            sdr.setGainMode(SOAPY_SDR_RX, channel, True)
            logger.info("Automatic gain control enabled")

        else:
            sdr.setGainMode(SOAPY_SDR_RX, channel, False)
            sdr.setGain(SOAPY_SDR_RX, channel, gain)
            actual_gain = sdr.getGain(SOAPY_SDR_RX, channel)
            logger.info(f"Gain set to {actual_gain} dB")

        # Set antenna if specified
        if antenna:
            sdr.setAntenna(SOAPY_SDR_RX, channel, antenna)
            selected_antenna = sdr.getAntenna(SOAPY_SDR_RX, channel)
            logger.info(f"Antenna set to {selected_antenna}")

        _apply_soapy_settings(
            sdr,
            channel,
            sdr_settings,
            bias_t,
            bias_setting_keys,
            config.get("soapy_agc", False),
        )

        # Readback is sent independently from requested settings so the UI can
        # show driver rounding, mode restrictions, and configuration failures.
        default_bandwidth = read_bandwidth(sdr, SOAPY_SDR_RX, channel)

        def report_receiver():
            data_queue.put(
                {
                    "type": "receiver",
                    "sdr_id": sdr_id,
                    "status": read_soapy_receiver(sdr, SOAPY_SDR_RX, channel, logger),
                }
            )

        def update_bandwidth(selection):
            status = apply_bandwidth(
                sdr,
                SOAPY_SDR_RX,
                channel,
                actual_sample_rate,
                selection,
                driver,
                logger,
                default_bandwidth=default_bandwidth,
            )
            data_queue.put({"type": "bandwidth", "sdr_id": sdr_id, "status": status})

        bandwidth_selection = (sdr_settings if isinstance(sdr_settings, dict) else {}).get(
            "bandwidth"
        )
        update_bandwidth(bandwidth_selection)
        report_receiver()

        # Enable DC offset correction for devices that support it (e.g., USRP B200/B210)
        try:
            if sdr.hasDCOffsetMode(SOAPY_SDR_RX, channel):
                sdr.setDCOffsetMode(SOAPY_SDR_RX, channel, True)
                logger.info("Enabled automatic DC offset correction")
        except Exception as e:
            logger.debug(f"DC offset correction not available or failed: {e}")

        # Set up the streaming
        stage = "setting up RX stream"
        rx_stream = sdr.setupStream(SOAPY_SDR_RX, SOAPY_SDR_CF32)

        # Now check MTU - after setupStream but before activateStream
        try:
            mtu = sdr.getStreamMTU(rx_stream)
            logger.debug(f"Stream MTU: {mtu}")
        except Exception as e:
            logger.warning(f"Could not get stream MTU: {e}")

        # Activate the stream
        sdr.activateStream(rx_stream)
        logger.debug("SoapySDR stream activated")

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
            "samples_read": 0,  # Total IQ samples read from SDR
            "iq_chunks_out": 0,  # IQ chunks sent to queues
            "read_errors": 0,  # Read errors (timeouts, overflows, etc.)
            "queue_drops": 0,  # Dropped due to full queues
            "last_activity": None,
            "errors": 0,
            "cpu_percent": 0.0,
            "memory_mb": 0.0,
            "memory_percent": 0.0,
        }
        last_stats_send = time.time()
        stats_send_interval = 1.0  # Send stats every second
        stream_chunk_id = 0
        stream_sample_index = 0

        # CPU and memory monitoring
        process = psutil.Process()
        last_cpu_check = time.time()
        cpu_check_interval = 0.5  # Update CPU usage every 0.5 seconds

        frame_counter = 0

        inbox = ConfigurationInbox(config_queue)

        # Main processing loop
        while not stop_event.is_set():
            # Update CPU and memory usage periodically
            current_time = time.time()
            if current_time - last_cpu_check >= cpu_check_interval:
                try:
                    cpu_percent = process.cpu_percent()

                    # Get memory usage
                    mem_info = process.memory_info()
                    memory_mb = mem_info.rss / (1024 * 1024)  # Convert bytes to MB
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
                    # Partial updates must not discard the chosen filter mode.
                    next_bandwidth = bandwidth_selection
                    if "sdr_settings" in new_config:
                        next_bandwidth = (new_config["sdr_settings"] or {}).get("bandwidth")
                    previous_channel = channel
                    channel = new_config.get("channel", channel)
                    if previous_channel != channel:
                        default_bandwidth = read_bandwidth(sdr, SOAPY_SDR_RX, channel)
                    bandwidth_changed = (
                        previous_channel != channel
                        or actual_sample_rate != new_config.get("sample_rate", actual_sample_rate)
                        or old_config.get("antenna")
                        != new_config.get("antenna", old_config.get("antenna"))
                        or bandwidth_selection != next_bandwidth
                    )

                    if "sample_rate" in new_config:
                        if actual_sample_rate != new_config["sample_rate"]:
                            # Deactivate stream before changing sample rate
                            sdr.deactivateStream(rx_stream)
                            sdr.closeStream(rx_stream)

                            sdr.setSampleRate(SOAPY_SDR_RX, channel, new_config["sample_rate"])
                            actual_sample_rate = sdr.getSampleRate(SOAPY_SDR_RX, channel)
                            if driver.lower() == "sdrplay":
                                # This driver resets its filter when the rate changes.
                                default_bandwidth = read_bandwidth(sdr, SOAPY_SDR_RX, channel)

                            # Setup stream again with a new sample rate
                            rx_stream = sdr.setupStream(SOAPY_SDR_RX, SOAPY_SDR_CF32)
                            sdr.activateStream(rx_stream)

                            # Number of samples required for each iteration
                            num_samples = calculate_samples_per_scan(actual_sample_rate, fft_size)

                            logger.info(f"Updated sample rate: {actual_sample_rate}")

                    if "center_freq" in new_config:
                        if center_freq != new_config["center_freq"]:
                            # Deactivate stream to flush buffers
                            sdr.deactivateStream(rx_stream)
                            sdr.closeStream(rx_stream)

                            # Set the new frequency
                            center_freq = new_config["center_freq"]
                            logical_center_freq = center_freq
                            sdr.setFrequency(SOAPY_SDR_RX, channel, center_freq + offset_freq)
                            actual_freq = sdr.getFrequency(SOAPY_SDR_RX, channel)

                            # Restart stream with the new frequency
                            rx_stream = sdr.setupStream(SOAPY_SDR_RX, SOAPY_SDR_CF32)
                            sdr.activateStream(rx_stream)

                            logger.info(
                                f"Updated center frequency: logical={logical_center_freq}, rf={actual_freq}"
                            )

                    if "fft_size" in new_config:
                        if old_config.get("fft_size", 0) != new_config["fft_size"]:
                            fft_size = new_config["fft_size"]
                            # Update num_samples when FFT size changes
                            num_samples = calculate_samples_per_scan(actual_sample_rate, fft_size)
                            logger.info(f"Updated FFT size: {fft_size}, num_samples: {num_samples}")

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

                    if "soapy_agc" in new_config:
                        if old_config.get("soapy_agc", False) != new_config["soapy_agc"]:
                            if new_config["soapy_agc"]:
                                sdr.setGainMode(SOAPY_SDR_RX, channel, True)
                                logger.info("Enabled automatic gain control")
                            else:
                                sdr.setGainMode(SOAPY_SDR_RX, channel, False)
                                if "gain" in new_config:
                                    sdr.setGain(SOAPY_SDR_RX, channel, new_config["gain"])
                                    logger.info(f"Set manual gain to {new_config['gain']} dB")

                    if "gain" in new_config and new_config.get("soapy_agc", False) is False:
                        if old_config.get("gain", 0) != new_config["gain"]:
                            sdr.setGain(SOAPY_SDR_RX, channel, new_config["gain"])
                            actual_gain = sdr.getGain(SOAPY_SDR_RX, channel)
                            logger.info(f"Updated gain: {actual_gain} dB")

                    if "antenna" in new_config:
                        if old_config.get("antenna", "") != new_config["antenna"]:
                            sdr.setAntenna(SOAPY_SDR_RX, channel, new_config["antenna"])
                            selected_antenna = sdr.getAntenna(SOAPY_SDR_RX, channel)
                            logger.info(f"Updated antenna: {selected_antenna}")

                    if "offset_freq" in new_config:
                        if old_config.get("offset_freq", 0) != new_config["offset_freq"]:
                            # Deactivate stream to flush buffers
                            sdr.deactivateStream(rx_stream)
                            sdr.closeStream(rx_stream)

                            offset_freq = int(new_config["offset_freq"])
                            sdr.setFrequency(SOAPY_SDR_RX, channel, center_freq + offset_freq)
                            actual_freq = sdr.getFrequency(SOAPY_SDR_RX, channel)

                            # Restart stream with new frequency
                            rx_stream = sdr.setupStream(SOAPY_SDR_RX, SOAPY_SDR_CF32)
                            sdr.activateStream(rx_stream)

                            logger.info(
                                f"Updated offset frequency: offset={offset_freq}, logical={logical_center_freq}, rf={actual_freq}"
                            )

                    if "ppm_error" in new_config:
                        if old_config.get("ppm_error", 0) != new_config["ppm_error"]:
                            try:
                                ppm_error = float(new_config["ppm_error"] or 0)
                                sdr.setFrequencyCorrection(SOAPY_SDR_RX, channel, ppm_error)
                                logger.info(f"Updated frequency correction: {ppm_error} ppm")
                            except Exception as e:
                                logger.warning(f"Failed to update frequency correction: {e}")

                    if "bias_t" in new_config or "sdr_settings" in new_config:
                        if old_config.get("bias_t") != new_config.get("bias_t") or old_config.get(
                            "sdr_settings"
                        ) != new_config.get("sdr_settings"):
                            _apply_soapy_settings(
                                sdr,
                                channel,
                                new_config.get("sdr_settings", {}),
                                new_config.get("bias_t", None),
                                bias_setting_keys,
                                new_config.get("soapy_agc", False),
                            )

                    if bandwidth_changed:
                        # setSampleRate resets SDRplay's filter even when its
                        # saved bandwidth selection has not changed.
                        # An older client's empty settings also restore the
                        # driver policy after an explicit filter selection.
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
                            "soapy_agc",
                            "sdr_settings",
                            "channel",
                        )
                    ):
                        report_receiver()
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
                    read_soapy_receiver(sdr, SOAPY_SDR_RX, channel, logger),
                    error_msg,
                    offset=offset_freq,
                )
                center_freq = old_config.get("center_freq", center_freq)

            try:
                # Use larger read size for better throughput at high sample rates
                # Read at least 8192 samples per call, or MTU if larger
                # This reduces overhead and prevents gaps at high sample rates
                if mtu > 0:
                    read_size = max(8192, mtu)
                else:
                    read_size = 8192
                logger.debug(f"Using read_size of {read_size} samples (MTU: {mtu})")

                # Create a buffer for the individual reads
                buffer = np.zeros(read_size, dtype=np.complex64)

                # Create an accumulation buffer for collecting enough samples
                samples_buffer = np.zeros(num_samples, dtype=np.complex64)
                buffer_position = 0

                # Add frame counter for debugging
                frame_counter += 1

                # Loop until we have enough samples or encounter too many errors
                read_count = 0
                while buffer_position < num_samples and not stop_event.is_set():
                    # Read samples from the device
                    # Use longer timeout (100ms) to accommodate larger buffers and network latency
                    sr = sdr.readStream(rx_stream, [buffer], len(buffer), timeoutUs=100000)
                    if sr.ret < 0:
                        stats["last_read_error"] = (
                            f"SoapySDR readStream: {SoapySDR.errToStr(sr.ret)} (code {sr.ret})"
                        )
                    read_count += 1

                    if sr.ret > 0:
                        stats.pop("last_read_error", None)
                        # We got samples - measure how many we actually received
                        samples_read = sr.ret
                        logger.debug(f"Read {samples_read}/{read_size} samples")

                        # Track samples read
                        stats["samples_read"] += samples_read
                        stats["last_activity"] = time.time()

                        # Calculate how many samples we can still add to our buffer
                        samples_remaining = num_samples - buffer_position
                        samples_to_add = min(samples_read, samples_remaining)

                        # Add the samples to our accumulation buffer
                        samples_buffer[buffer_position : buffer_position + samples_to_add] = buffer[
                            :samples_to_add
                        ]
                        buffer_position += samples_to_add

                        # Log progress
                        logger.debug(f"Accumulated {buffer_position}/{num_samples} samples")

                        # If we've filled our buffer, break out of the loop
                        if buffer_position >= num_samples:
                            break

                    elif sr.ret == 0:
                        # No data returned
                        logger.warning(f"Frame {frame_counter}: no data returned (sr.ret=0)")

                    elif sr.ret < 0:
                        # An error occurred, handle based on the error code.
                        # On any read error, discard the partial frame to avoid stitching
                        # non-contiguous IQ into one chunk (critical for GNSS tracking).
                        stats["read_errors"] += 1

                        if sr.ret == -1:  # SOAPY_SDR_TIMEOUT
                            logger.warning(f"Frame {frame_counter}: readStream timeout (sr.ret=-1)")
                        elif sr.ret == -2:  # SOAPY_SDR_STREAM_ERROR
                            logger.warning("Stream error detected (SOAPY_SDR_STREAM_ERROR)")
                        elif sr.ret == -3:  # SOAPY_SDR_CORRUPTION
                            logger.warning("Data corruption detected (SOAPY_SDR_CORRUPTION)")
                        elif sr.ret == -4:  # SOAPY_SDR_OVERFLOW
                            logger.warning(
                                "Buffer overflow detected (SOAPY_SDR_OVERFLOW), samples may have been lost"
                            )
                        elif sr.ret == -5:  # SOAPY_SDR_NOT_SUPPORTED
                            logger.warning("Operation not supported (SOAPY_SDR_NOT_SUPPORTED)")
                        elif sr.ret == -6:  # SOAPY_SDR_TIME_ERROR
                            logger.warning("Timestamp error detected (SOAPY_SDR_TIME_ERROR)")
                        elif sr.ret == -7:  # SOAPY_SDR_UNDERFLOW
                            logger.warning("Buffer underflow detected (SOAPY_SDR_UNDERFLOW)")
                        else:
                            logger.warning(
                                f"Frame {frame_counter}: readStream error (sr.ret={sr.ret})"
                            )

                        # Clear partial data and restart frame accumulation.
                        buffer.fill(0)
                        samples_buffer.fill(0)
                        buffer_position = 0
                        break

                    else:
                        # Error occurred
                        logger.error(f"Frame {frame_counter}: readStream error (sr.ret={sr.ret})")

                        # Clear the buffer to prevent contamination
                        buffer.fill(0)
                        samples_buffer.fill(0)

                        # Reset to skip this frame
                        buffer_position = 0
                        break

                # Check if we have enough samples for processing
                if buffer_position < num_samples:
                    logger.warning(
                        f"Not enough samples accumulated: {buffer_position}/{num_samples}"
                    )
                    time.sleep(0.005)
                    continue

                # We have enough samples to process
                samples = samples_buffer[:buffer_position]

                # Enforce pipeline contract: workers publish complex64 IQ samples.
                samples = require_complex64(samples, source="soapysdr-remote-worker")

                # Match local Soapy worker behavior: remove per-chunk DC offset bias.
                samples = remove_dc_offset(samples)
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
                        iq_message = {
                            "samples": samples.copy(),  # Copy to prevent data races
                            # `center_freq` must stay logical so demod/decoder math
                            # remains stable and independent of hardware tune offsets.
                            "center_freq": logical_center_freq,
                            "logical_center_freq_hz": logical_center_freq,
                            "rf_center_freq_hz": actual_freq,
                            "dsp_shift_hz": 0.0,
                            "offset_freq_hz": offset_freq,
                            "sample_rate": actual_sample_rate,
                            "timestamp": time.time(),
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

                        # IMPORTANT: Broadcast to demodulation queue FIRST (higher priority for audio)
                        # Audio has strict latency requirements, FFT display can tolerate drops
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
                                        "sample_rate": actual_sample_rate,
                                        "timestamp": time.time(),
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

                        # Broadcast to FFT queue (lower priority, can drop frames)
                        if iq_queue_fft is not None:
                            try:
                                if not iq_queue_fft.full():
                                    iq_queue_fft.put_nowait(iq_message)
                                    stats["iq_chunks_out"] += 1
                                else:
                                    stats["queue_drops"] += 1
                            except Exception:
                                stats["queue_drops"] += 1

                    except Exception as e:
                        logger.debug(f"Could not queue IQ data: {str(e)}")

            except Exception as e:
                error_msg = format_device_error(
                    "SoapySDR",
                    "reading samples",
                    e,
                    endpoint=f"{config.get('host', 'unknown')}:{config.get('port', 'unknown')}",
                    driver=config.get("driver"),
                    serial=config.get("serial_number"),
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

                # Pause before retrying
                time.sleep(1)

    except Exception as e:
        error_msg = format_device_error(
            "SoapySDR",
            stage,
            e,
            endpoint=f"{config.get('host', 'unknown')}:{config.get('port', 'unknown')}",
            driver=config.get("driver"),
            serial=config.get("serial_number"),
        )
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
        # Sleep for 0.5 second to allow the main process to read the data queue messages
        time.sleep(0.5)

        # Clean up resources
        logger.info(f"Cleaning up resources for SDR {sdr_id}...")
        if rx_stream and sdr:
            try:
                sdr.deactivateStream(rx_stream)
                sdr.closeStream(rx_stream)
                logger.info("SoapySDR stream closed")
            except Exception as e:
                logger.error(f"Error closing SoapySDR stream: {str(e)}")

        # Send termination signal
        data_queue.put(
            {
                "type": "terminated",
                "client_id": client_id,
                "sdr_id": sdr_id,
                "timestamp": time.time(),
            }
        )

        logger.info("SoapySDR worker process terminated")


def calculate_samples_per_scan(sample_rate, fft_size):
    """
    Calculate number of samples per scan for constant block rate streaming.

    Uses blocks-per-second approach (like OpenWebRX+) for predictable, consistent behavior:
    - Block size = sample_rate / target_blocks_per_sec
    - This ensures constant block rate regardless of sample rate
    - Makes queue management and UI synchronization predictable

    Args:
        sample_rate: SDR sample rate in Hz
        fft_size: FFT size (used as minimum block size)

    Returns:
        Number of samples per buffer (block size)
    """
    if fft_size is None:
        fft_size = 8192

    # Calculate block size for constant rate using module-level TARGET_BLOCKS_PER_SEC
    # block_size = sample_rate / blocks_per_sec
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


def get_supported_sample_rates(sdr, channel=0):
    """
    Retrieve the supported sample rates from the SoapySDR device.

    Args:
        sdr: SoapySDR device instance
        channel: Channel number (default: 0)

    Returns:
        List of dictionaries with minimum and maximum sample rates for each range
    """
    try:
        sample_rate_ranges = sdr.getSampleRateRange(SOAPY_SDR_RX, channel)
        supported_rates = []

        for rate_range in sample_rate_ranges:
            # Call the methods to get the actual values
            min_val = rate_range.minimum()
            max_val = rate_range.maximum()
            step_val = rate_range.step() if hasattr(rate_range, "step") else 0

            supported_rates.append({"minimum": min_val, "maximum": max_val, "step": step_val})

        return supported_rates
    except Exception as e:
        return [{"error": str(e)}]


def list_available_devices(hostname, port):
    """
    List all available SoapySDR devices on the remote server.

    Args:
        hostname: Remote server hostname
        port: Remote server port

    Returns:
        List of available devices
    """
    try:
        # Connect to the remote server only
        remote_args = f"remote:host={hostname}:port={port}"

        # Use SoapySDR.Device.enumerate to get available devices
        available_devices = SoapySDR.Device.enumerate(remote_args)
        return available_devices
    except Exception as e:
        return [{"error": str(e)}]
