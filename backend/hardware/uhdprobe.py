# flake8: noqa
# pylint: skip-file
# type: ignore

import logging
import logging.config
import os
import sys

import yaml

from common.errors import format_device_error
from common.logconfig import resolve_log_config_path

# Try to import UHD with path handling
uhd = None
try:
    # Add common UHD installation paths
    uhd_paths = [
        "/usr/local/lib/python3.12/site-packages",
        "/usr/lib/python3/dist-packages",
        "/opt/uhd/lib/python3.12/site-packages",
    ]

    for path in uhd_paths:
        if os.path.exists(os.path.join(path, "uhd")) and path not in sys.path:
            sys.path.insert(0, path)
            break

    import uhd
except ImportError as e:
    pass

# Load logger configuration
try:
    with open(resolve_log_config_path(None), "r", encoding="utf-8") as f:
        config = yaml.safe_load(f)
        logging.config.dictConfig(config)
except Exception as e:
    logging.basicConfig(level=logging.INFO)

logger = logging.getLogger("uhd-probe")


def probe_local_uhd_usrp(sdr_details):
    """
    Connect to a locally connected USRP device and retrieve valid sample rates and gain values.

    Args:
        sdr_details: Dictionary containing SDR connection details with the following keys:
            - device_args: UHD device arguments string (optional, will be constructed if not provided)
            - serial: USRP serial number (used to identify specific device)
            - channel: Channel number (default 0)

    Returns:
        Dictionary containing:
            - rates: List of sample rates in Hz supported by the device
            - gains: List of valid gain values in dB
            - has_agc: Boolean indicating if automatic gain control is supported
            - antennas: Dictionary of available antennas for RX and TX
            - frequency_ranges: Information about frequency ranges
            - clock_info: Information about reference clock status and source
    """

    reply: dict = {"success": None, "data": None, "error": None, "log": []}

    if uhd is None:
        reply["success"] = False
        reply["error"] = "UHD library not available"
        reply["log"].append(
            "ERROR: UHD library not found. Please ensure UHD Python bindings are installed."
        )
        return reply

    rates = []
    gains = []
    has_agc = False
    antennas = {"rx": [], "tx": []}
    frequency_ranges = {}
    clock_info = {}
    capabilities = {
        "agc": {"supported_rx": False, "supported_tx": False, "settings": []},
        "bandwidths": {"rx": [], "tx": []},
        "bandwidth_ranges": {"rx": [], "tx": []},
        "bias_t": {"supported": False, "keys": [], "value": None},
        "clock_rate": None,
        "clock_rates": [],
        "clock_source": None,
        "clock_sources": [],
        "gain_elements": {"rx": [], "tx": []},
        "gain_ranges": {"rx": {}, "tx": {}},
        "native_stream_format": {"rx": None, "tx": None},
        "sensor_values": {},
        "sensors": [],
        "settings": [],
        "stream_formats": {"rx": [], "tx": []},
        "time_source": None,
        "time_sources": [],
    }

    reply["log"].append(f"INFO: Connecting to local UHD/USRP device with details: {sdr_details}")

    usrp = None
    stage = "preparing device selection"
    try:
        # Get device parameters
        base_device_args = sdr_details.get("device_args", "")
        serial_number = sdr_details.get("serial", "")
        channel = sdr_details.get("channel", 0)

        # A confusing issue exists when selecting an SDR with serial=XXXXXX, some times it does
        # not work inside docker containers, the method below is a workaround to fix this issue,
        # it will look up all devices, lookup the one we want based on the serial and then use every
        # other attribute to construct the device args string.

        if serial_number:
            reply["log"].append(f"INFO: Looking for device with serial: {serial_number}")

            # Discover all USRP devices (no type filter)
            stage = "discovering devices"
            discovered_devices = uhd.find("")
            reply["log"].append(f"INFO: Found {len(discovered_devices)} USRP device(s)")

            # Find the device matching the serial
            stage = "selecting device"
            device_args = None
            discovered_serials = []
            for dev in discovered_devices:
                dev_string = dev.to_string()
                reply["log"].append(f"INFO: Discovered: {dev_string}")

                # Match the whole serial and retain discovered serials for the error reply.
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
                    reply["log"].append(f"INFO: Matched device, using args: {device_args}")
                    break

            if not device_args:
                available = ", ".join(discovered_serials) if discovered_serials else "none reported"
                raise LookupError(
                    f"No matching USRP among {len(discovered_devices)} discovered device(s); "
                    f"available serials: {available}"
                )
        else:
            # No serial specified, use base_device_args or discover first device
            if base_device_args:
                device_args = base_device_args
                reply["log"].append(f"INFO: No serial specified, using base args: {device_args}")
            else:
                device_args = ""
                reply["log"].append(
                    f"INFO: No serial or args specified, will connect to first device"
                )

        if base_device_args and serial_number:
            device_args += "," + base_device_args

        reply["log"].append(f"INFO: Final device args: '{device_args}', channel: {channel}")

        # Create the USRP device instance
        stage = "opening device"
        usrp = uhd.usrp.MultiUSRP(device_args)
        stage = "probing device capabilities"

        # Get device information
        device_info = usrp.get_pp_string()
        reply["log"].append(f"INFO: Connected to device: {usrp.get_mboard_name()}")
        reply["log"].append(f"INFO: RX Subdevice: {usrp.get_rx_subdev_name(channel)}")

        # Verify we connected to the correct device by checking serial if specified
        if serial_number:
            try:
                # Try different ways to get the serial number
                try:
                    # Method 1: Try getting from mboard sensor
                    connected_serial = usrp.get_mboard_sensor("serial", 0).value
                    reply["log"].append(f"INFO: Connected device serial: {connected_serial}")
                except:
                    # Method 2: Try getting from device args in pp_string
                    pp_string = usrp.get_pp_string()
                    if "serial=" in pp_string:
                        # Extract serial from the pretty print string
                        lines = pp_string.split("\n")
                        for line in lines:
                            if "serial" in line.lower():
                                reply["log"].append(f"INFO: Device info contains: {line.strip()}")
                                break
                    else:
                        reply["log"].append(
                            "INFO: Serial verification skipped - not available in device info"
                        )

            except Exception as e:
                reply["log"].append(f"INFO: Could not verify device serial number: {e}")

        # Get sample rates - Fix the meta_range_t iteration issue
        try:
            # Get the rate range object
            rate_range = usrp.get_rx_rates(channel)
            rates = []

            # Check if it's iterable (some UHD versions return different types)
            try:
                # Try to iterate directly
                rates = [int(rate) for rate in rate_range]
            except TypeError:
                # If not iterable, it might be a meta_range_t object
                # For USRP devices, generate standard decimation-based rates
                master_clock_rate = usrp.get_master_clock_rate()
                reply["log"].append(f"INFO: Master clock rate: {master_clock_rate} Hz")

                # Get min/max from range if available
                min_rate = None
                max_rate = None
                if hasattr(rate_range, "start") and hasattr(rate_range, "stop"):
                    min_rate = rate_range.start()
                    max_rate = rate_range.stop()
                    reply["log"].append(f"INFO: Rate range: {min_rate} to {max_rate} Hz")

                # Generate standard USRP sample rates based on decimation
                # Common decimation factors for USRP B210 series
                decimations = [
                    4,
                    5,
                    8,
                    10,
                    16,
                    20,
                    25,
                    32,
                    40,
                    50,
                    64,
                    80,
                    100,
                    128,
                    160,
                    200,
                    256,
                    320,
                    400,
                    512,
                    640,
                    800,
                    1024,
                ]

                for dec in decimations:
                    rate = int(master_clock_rate / dec)

                    # Apply range constraints if available
                    if min_rate is not None and max_rate is not None:
                        if min_rate <= rate <= max_rate:
                            rates.append(rate)
                    else:
                        # Use reasonable minimum rate
                        if rate >= 61035:  # Minimum reasonable rate for B210
                            rates.append(rate)

                # Add some common standard rates that might not be covered by decimation
                standard_rates = [
                    20000000,
                    16000000,
                    10000000,
                    8000000,
                    5000000,
                    4000000,
                    2000000,
                    1000000,
                    800000,
                    500000,
                    400000,
                    250000,
                    200000,
                ]

                for rate in standard_rates:
                    if min_rate is not None and max_rate is not None:
                        if min_rate <= rate <= max_rate and rate not in rates:
                            rates.append(rate)
                    else:
                        if rate >= 61035 and rate not in rates:  # Minimum for B210
                            rates.append(rate)

            if not rates:
                # Final fallback: use common USRP B210 rates
                reply["log"].append("INFO: Using fallback sample rates")
                rates = [
                    20000000,
                    16000000,
                    10000000,
                    8000000,
                    5000000,
                    4000000,
                    2000000,
                    1600000,
                    1000000,
                    800000,
                    500000,
                    400000,
                    320000,
                    250000,
                    200000,
                    160000,
                    125000,
                    100000,
                    80000,
                ]

            # Remove duplicates and sort
            rates = sorted(list(set(rates)), reverse=True)  # Sort from highest to lowest
            reply["log"].append(f"INFO: Found {len(rates)} sample rates")

        except Exception as e:
            reply["log"].append(f"WARNING: Could not get sample rates: {e}")
            # Fallback to common USRP B210 rates
            rates = [
                20000000,
                16000000,
                10000000,
                8000000,
                5000000,
                4000000,
                2000000,
                1600000,
                1000000,
                800000,
                500000,
                400000,
                320000,
                250000,
                200000,
                160000,
                125000,
                100000,
                80000,
            ]

        # Get gain values
        try:
            gain_range = usrp.get_rx_gain_range(channel)
            min_gain = gain_range.start()
            max_gain = gain_range.stop()
            step = gain_range.step()

            if step <= 0:
                step = 1.0  # Default step if not specified or invalid

            reply["log"].append(f"INFO: Gain range: {min_gain} to {max_gain} dB, step: {step} dB")

            # Generate gain values
            current = min_gain
            max_iterations = 100
            iteration = 0

            while current <= max_gain and iteration < max_iterations:
                gains.append(round(float(current), 1))
                current += step
                iteration += 1

            # Ensure we include the maximum gain
            if gains and gains[-1] != max_gain:
                gains.append(round(float(max_gain), 1))

        except Exception as e:
            reply["log"].append(f"WARNING: Could not get gain range: {e}")
            # Fallback to common USRP gain values
            gains = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75]

        # Check if automatic gain control is supported (USRP typically doesn't have hardware AGC)
        has_agc = False
        try:
            # Some USRPs might have AGC capability through specific gain elements
            gain_names = usrp.get_rx_gain_names(channel)
            reply["log"].append(f"INFO: Available gain elements: {list(gain_names)}")
            # Most USRPs don't have built-in AGC, this is typically handled in software
        except Exception as e:
            reply["log"].append(f"INFO: Could not get gain element names: {e}")

        # Gain elements + ranges (RX/TX)
        try:
            rx_gain_names = list(usrp.get_rx_gain_names(channel))
            capabilities["gain_elements"]["rx"] = rx_gain_names
            for name in rx_gain_names:
                try:
                    gr = usrp.get_rx_gain_range(name, channel)
                    capabilities["gain_ranges"]["rx"][name] = {
                        "min": gr.start(),
                        "max": gr.stop(),
                        "step": gr.step() or None,
                    }
                except Exception as e:
                    reply["log"].append(f"INFO: Could not get RX gain range for {name}: {e}")
        except Exception as e:
            reply["log"].append(f"INFO: Could not get RX gain element names: {e}")

        try:
            tx_gain_names = list(usrp.get_tx_gain_names(channel))
            capabilities["gain_elements"]["tx"] = tx_gain_names
            for name in tx_gain_names:
                try:
                    gr = usrp.get_tx_gain_range(name, channel)
                    capabilities["gain_ranges"]["tx"][name] = {
                        "min": gr.start(),
                        "max": gr.stop(),
                        "step": gr.step() or None,
                    }
                except Exception as e:
                    reply["log"].append(f"INFO: Could not get TX gain range for {name}: {e}")
        except Exception as e:
            reply["log"].append(f"INFO: Could not get TX gain element names: {e}")

        # Get antenna information
        try:
            # Get RX antennas
            rx_antennas = usrp.get_rx_antennas(channel)
            antennas["rx"] = list(rx_antennas)
            reply["log"].append(f"INFO: RX Antennas: {antennas['rx']}")

            # Get TX antennas if available
            try:
                tx_antennas = usrp.get_tx_antennas(channel)
                antennas["tx"] = list(tx_antennas)
                reply["log"].append(f"INFO: TX Antennas: {antennas['tx']}")
            except Exception as e:
                reply["log"].append(f"INFO: TX antennas not available or accessible: {e}")
                antennas["tx"] = []

        except Exception as e:
            reply["log"].append(f"WARNING: Could not get antenna information: {e}")

        # Get frequency range information
        try:
            # Get RX frequency range
            rx_freq_range = usrp.get_rx_freq_range(channel)
            frequency_ranges["rx"] = {
                "min": rx_freq_range.start() / 1e6,  # Convert to MHz
                "max": rx_freq_range.stop() / 1e6,  # Convert to MHz
                "step": rx_freq_range.step() / 1e6,  # Convert to MHz
            }
            reply["log"].append(
                f"INFO: RX frequency range: {frequency_ranges['rx']['min']:.1f} - {frequency_ranges['rx']['max']:.1f} MHz"
            )

            # Try to get TX frequency range if available
            try:
                tx_freq_range = usrp.get_tx_freq_range(channel)
                frequency_ranges["tx"] = {
                    "min": tx_freq_range.start() / 1e6,  # Convert to MHz
                    "max": tx_freq_range.stop() / 1e6,  # Convert to MHz
                    "step": tx_freq_range.step() / 1e6,  # Convert to MHz
                }
                reply["log"].append(
                    f"INFO: TX frequency range: {frequency_ranges['tx']['min']:.1f} - {frequency_ranges['tx']['max']:.1f} MHz"
                )
            except Exception as e:
                reply["log"].append(f"INFO: TX frequency range not available: {e}")

        except Exception as e:
            reply["log"].append(f"WARNING: Could not get frequency range information: {e}")

        # Get bandwidth range information (if supported)
        try:
            rx_bw_range = usrp.get_rx_bandwidth_range(channel)
            capabilities["bandwidths"]["rx"] = [rx_bw_range.start(), rx_bw_range.stop()]
            capabilities["bandwidth_ranges"]["rx"] = [
                {
                    "min": rx_bw_range.start(),
                    "max": rx_bw_range.stop(),
                    "step": rx_bw_range.step(),
                }
            ]
        except Exception as e:
            reply["log"].append(f"INFO: RX bandwidth range not available: {e}")

        try:
            tx_bw_range = usrp.get_tx_bandwidth_range(channel)
            capabilities["bandwidths"]["tx"] = [tx_bw_range.start(), tx_bw_range.stop()]
            capabilities["bandwidth_ranges"]["tx"] = [
                {
                    "min": tx_bw_range.start(),
                    "max": tx_bw_range.stop(),
                    "step": tx_bw_range.step(),
                }
            ]
        except Exception as e:
            reply["log"].append(f"INFO: TX bandwidth range not available: {e}")

        # Get clock and time source information
        try:
            clock_info = {
                "ref_locked": None,
                "clock_source": None,
                "time_source": None,
                "available_clock_sources": [],
                "available_time_sources": [],
                "master_clock_rate": None,
            }

            # Get available clock sources
            try:
                clock_sources = usrp.get_clock_sources(0)  # mboard 0
                clock_info["available_clock_sources"] = list(clock_sources)
                capabilities["clock_sources"] = list(clock_sources)
                reply["log"].append(
                    f"INFO: Available clock sources: {clock_info['available_clock_sources']}"
                )
            except Exception as e:
                reply["log"].append(f"INFO: Could not get clock sources: {e}")

            # Get current clock source
            try:
                current_clock_source = usrp.get_clock_source(0)  # mboard 0
                clock_info["clock_source"] = current_clock_source
                capabilities["clock_source"] = current_clock_source
                reply["log"].append(f"INFO: Current clock source: {current_clock_source}")
            except Exception as e:
                reply["log"].append(f"INFO: Could not get current clock source: {e}")

            # Get available time sources
            try:
                time_sources = usrp.get_time_sources(0)  # mboard 0
                clock_info["available_time_sources"] = list(time_sources)
                capabilities["time_sources"] = list(time_sources)
                reply["log"].append(
                    f"INFO: Available time sources: {clock_info['available_time_sources']}"
                )
            except Exception as e:
                reply["log"].append(f"INFO: Could not get time sources: {e}")

            # Get current time source
            try:
                current_time_source = usrp.get_time_source(0)  # mboard 0
                clock_info["time_source"] = current_time_source
                capabilities["time_source"] = current_time_source
                reply["log"].append(f"INFO: Current time source: {current_time_source}")
            except Exception as e:
                reply["log"].append(f"INFO: Could not get current time source: {e}")

            # Get master clock rate
            try:
                master_clock_rate = usrp.get_master_clock_rate()
                clock_info["master_clock_rate"] = master_clock_rate
                capabilities["clock_rate"] = master_clock_rate
                reply["log"].append(f"INFO: Master clock rate: {master_clock_rate} Hz")
            except Exception as e:
                reply["log"].append(f"INFO: Could not get master clock rate: {e}")

            # Check reference lock status (if available)
            try:
                # Some USRPs have a ref_locked sensor
                sensors = usrp.get_mboard_sensor_names(0)
                if "ref_locked" in sensors:
                    ref_locked = usrp.get_mboard_sensor("ref_locked", 0)
                    clock_info["ref_locked"] = ref_locked.to_bool()
                    capabilities["sensors"].append("ref_locked")
                    capabilities["sensor_values"]["ref_locked"] = ref_locked.to_bool()
                    reply["log"].append(f"INFO: Reference locked: {clock_info['ref_locked']}")
                else:
                    reply["log"].append("INFO: Reference lock sensor not available")
            except Exception as e:
                reply["log"].append(f"INFO: Could not check reference lock status: {e}")

        except Exception as e:
            reply["log"].append(f"WARNING: Could not get clock/time source information: {e}")

        reply["success"] = True

    except Exception as e:
        error_message = format_device_error(
            "UHD",
            stage,
            e,
            serial=sdr_details.get("serial"),
        )
        reply["log"].append(f"ERROR: {error_message}")
        reply["success"] = False
        reply["error"] = error_message

    finally:
        # Clean up - UHD handles device cleanup automatically
        reply["data"] = {
            "rates": sorted(rates, reverse=True),  # Sort from highest to lowest like SoapySDR
            "gains": gains,
            "has_uhd_agc": has_agc,
            "antennas": antennas,
            "frequency_ranges": frequency_ranges,
            "clock_info": clock_info,
            "capabilities": capabilities,
        }

    return reply


# For compatibility with the utils.py import structure
def probe_uhd_usrp(sdr_details):
    """Wrapper function for compatibility with existing code"""
    return probe_local_uhd_usrp(sdr_details)
