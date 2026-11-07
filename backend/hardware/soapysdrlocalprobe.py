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


import logging.config
from typing import Any, Dict, List, Optional, Set, TypedDict

import SoapySDR
import yaml
from SoapySDR import SOAPY_SDR_RX, SOAPY_SDR_TX

from common.errors import format_device_error
from common.logconfig import resolve_log_config_path

# Load logger configuration
with open(resolve_log_config_path(None), "r", encoding="utf-8") as f:
    config = yaml.safe_load(f)
    logging.config.dictConfig(config)

logger = logging.getLogger("soapylocal-probe")


class AntennaInfo(TypedDict):
    rx: List[str]
    tx: List[str]


class FrequencyRange(TypedDict):
    min: float
    max: float


class ClockInfo(TypedDict):
    ref_locked: Optional[str]
    clock_source: Optional[str]
    available_sensors: List[str]
    available_settings: Dict[str, Dict[str, Optional[str]]]


class SDRData(TypedDict):
    rates: List[float]
    gains: List[float]
    has_soapy_agc: bool
    antennas: AntennaInfo
    frequency_ranges: Dict[str, FrequencyRange]
    clock_info: ClockInfo
    temperature: Dict[str, str]
    capabilities: Dict[str, Any]


class ProbeReply(TypedDict):
    success: Optional[bool]
    data: Optional[SDRData]
    error: Optional[str]
    log: List[str]


def probe_local_soapy_sdr(sdr_details: Dict[str, Any]) -> ProbeReply:
    """
    Connect to a locally connected USB SoapySDR device and retrieve valid sample rates and gain values.

    Args:
        sdr_details: Dictionary containing SDR connection details with the following keys:
            - driver: SDR driver name (e.g., 'rtlsdr', 'hackrf', 'airspy', etc.)
            - serial: SDR serial number (optional)

    Returns:
        Dictionary containing:
            - rates: List of sample rates in Hz supported by the device
            - gains: List of valid gain values in dB
            - has_agc: Boolean indicating if automatic gain control is supported
            - antennas: Dictionary of available antennas for RX and TX
            - clock_info: Information about reference clock status and source
    """

    reply: ProbeReply = {
        "success": None,
        "data": None,
        "error": None,
        "log": [],
    }

    rates: List[float] = []
    gains: List[float] = []
    has_agc: bool = False
    antennas: AntennaInfo = {"rx": [], "tx": []}
    frequency_ranges: Dict[str, FrequencyRange] = {}
    clock_info: ClockInfo = {
        "ref_locked": None,
        "clock_source": None,
        "available_sensors": [],
        "available_settings": {},
    }
    temp_info: Dict[str, str] = {}
    capabilities: Dict[str, Any] = {}

    def _serialize_range(range_obj: Any) -> Optional[Dict[str, Any]]:
        if range_obj is None:
            return None
        if hasattr(range_obj, "minimum") and hasattr(range_obj, "maximum"):
            return {
                "min": range_obj.minimum(),
                "max": range_obj.maximum(),
                "step": range_obj.step() if hasattr(range_obj, "step") else None,
            }
        return None

    def _normalize_value(value: Any) -> Any:
        if value is None:
            return None
        if isinstance(value, str):
            if value == "":
                return None
            lowered = value.strip().lower()
            if lowered == "true":
                return True
            if lowered == "false":
                return False
            return value
        if isinstance(value, (bool, int, float)):
            return value
        if isinstance(value, dict):
            return {str(k): _normalize_value(v) for k, v in value.items()}
        if isinstance(value, (list, tuple, set)):
            return [_normalize_value(v) for v in value]
        if isinstance(value, (bytes, bytearray)):
            return str(value)
        if hasattr(value, "__iter__"):
            try:
                return [_normalize_value(v) for v in list(value)]
            except Exception:
                pass
        return str(value)

    def _normalize_setting_type(type_value: Any) -> Any:
        if isinstance(type_value, (int, float)) and not isinstance(type_value, bool):
            type_map = {
                0: "bool",
                1: "int",
                2: "float",
                3: "string",
                4: "path",
            }
            return type_map.get(int(type_value), type_value)
        return type_value

    def _postprocess_caps(caps: Dict[str, Any]) -> Dict[str, Any]:
        if not isinstance(caps, dict):
            return caps
        # Normalize empty bandwidth lists to null
        for direction in ("rx", "tx"):
            bandwidths = caps.get("bandwidths", {}).get(direction)
            if isinstance(bandwidths, list) and len(bandwidths) == 0:
                caps["bandwidths"][direction] = None
        # Normalize gain range step == 0 to null
        for direction in ("rx", "tx"):
            gain_ranges = caps.get("gain_ranges", {}).get(direction, {})
            if isinstance(gain_ranges, dict):
                for gain_name, gain_range in gain_ranges.items():
                    if isinstance(gain_range, dict) and gain_range.get("step") == 0:
                        gain_range["step"] = None
                        gain_ranges[gain_name] = gain_range
        # Normalize empty clock/time sources to null
        for key in ("clock_sources", "time_sources", "clock_rates"):
            if isinstance(caps.get(key), list) and len(caps[key]) == 0:
                caps[key] = None
        return caps

    def _collect_capabilities(device: Any, channel_index: int) -> Dict[str, Any]:
        caps: Dict[str, Any] = {
            "settings": [],
            "sensors": [],
            "sensor_values": {},
            "clock_sources": [],
            "clock_source": None,
            "clock_rates": [],
            "clock_rate": None,
            "time_sources": [],
            "time_source": None,
            "gain_elements": {"rx": [], "tx": []},
            "gain_ranges": {"rx": {}, "tx": {}},
            "bandwidths": {"rx": [], "tx": []},
            "bandwidth_ranges": {"rx": [], "tx": []},
            "sample_rate_ranges": {"rx": [], "tx": []},
            "stream_formats": {"rx": [], "tx": []},
            "native_stream_format": {"rx": None, "tx": None},
            "agc": {"supported_rx": False, "supported_tx": False, "settings": []},
            "bias_t": {"supported": False, "keys": [], "value": None},
        }

        try:
            if hasattr(device, "getSettingInfo"):
                for setting in device.getSettingInfo():
                    entry = {
                        "key": setting.key,
                        "name": getattr(setting, "name", None),
                        "description": getattr(setting, "description", None),
                        "type": _normalize_setting_type(
                            _normalize_value(getattr(setting, "type", None))
                        ),
                        "units": _normalize_value(getattr(setting, "units", None)),
                        "range": _serialize_range(getattr(setting, "range", None)),
                        "options": _normalize_value(getattr(setting, "options", None)),
                        "value": None,
                    }
                    if isinstance(entry["options"], list) and len(entry["options"]) == 0:
                        entry["options"] = None
                    if hasattr(device, "readSetting"):
                        try:
                            entry["value"] = _normalize_value(device.readSetting(setting.key))
                        except Exception:
                            pass
                    caps["settings"].append(entry)

                    key_text = f"{setting.key} {entry.get('name', '')} {entry.get('description', '')}".lower()
                    if "bias" in key_text:
                        caps["bias_t"]["supported"] = True
                        caps["bias_t"]["keys"].append(setting.key)
                        if caps["bias_t"]["value"] is None and entry.get("value") is not None:
                            caps["bias_t"]["value"] = entry.get("value")

                    if "agc" in key_text:
                        caps["agc"]["settings"].append(setting.key)
        except Exception:
            pass

        try:
            caps["sensors"] = device.listSensors()
            for sensor in caps["sensors"]:
                try:
                    caps["sensor_values"][sensor] = device.readSensor(sensor)
                except Exception:
                    pass
        except Exception:
            pass

        try:
            if hasattr(device, "listClockSources"):
                caps["clock_sources"] = device.listClockSources()
            if hasattr(device, "getClockSource"):
                caps["clock_source"] = device.getClockSource()
            if hasattr(device, "listClockRates"):
                caps["clock_rates"] = device.listClockRates()
            if hasattr(device, "getClockRate"):
                caps["clock_rate"] = device.getClockRate()
        except Exception:
            pass

        try:
            if hasattr(device, "listTimeSources"):
                caps["time_sources"] = device.listTimeSources()
            if hasattr(device, "getTimeSource"):
                caps["time_source"] = device.getTimeSource()
        except Exception:
            pass

        try:
            caps["agc"]["supported_rx"] = device.hasGainMode(SOAPY_SDR_RX, channel_index)
        except Exception:
            pass
        try:
            caps["agc"]["supported_tx"] = device.hasGainMode(SOAPY_SDR_TX, channel_index)
        except Exception:
            pass

        for direction_name, direction in ("rx", SOAPY_SDR_RX), ("tx", SOAPY_SDR_TX):
            try:
                if hasattr(device, "listGains"):
                    caps["gain_elements"][direction_name] = device.listGains(
                        direction, channel_index
                    )
                    for gain_name in caps["gain_elements"][direction_name]:
                        try:
                            gain_range = device.getGainRange(direction, channel_index, gain_name)
                            caps["gain_ranges"][direction_name][gain_name] = {
                                "min": gain_range.minimum(),
                                "max": gain_range.maximum(),
                                "step": gain_range.step() if hasattr(gain_range, "step") else None,
                            }
                        except Exception:
                            pass
            except Exception:
                pass

            try:
                if hasattr(device, "listBandwidths"):
                    caps["bandwidths"][direction_name] = device.listBandwidths(
                        direction, channel_index
                    )
            except Exception:
                pass

            try:
                caps["bandwidth_ranges"][direction_name] = [
                    {"min": item.minimum(), "max": item.maximum(), "step": item.step()}
                    for item in device.getBandwidthRange(direction, channel_index)
                ]
            except Exception:
                pass

            try:
                if hasattr(device, "getSampleRateRange"):
                    ranges = device.getSampleRateRange(direction, channel_index)
                    caps["sample_rate_ranges"][direction_name] = [
                        {
                            "min": r.minimum(),
                            "max": r.maximum(),
                            "step": r.step() if hasattr(r, "step") else None,
                        }
                        for r in ranges
                    ]
            except Exception:
                pass

            try:
                if hasattr(device, "getStreamFormats"):
                    caps["stream_formats"][direction_name] = device.getStreamFormats(
                        direction, channel_index
                    )
                if hasattr(device, "getNativeStreamFormat"):
                    fmt, full_scale = device.getNativeStreamFormat(direction, channel_index)
                    caps["native_stream_format"][direction_name] = {
                        "format": fmt,
                        "full_scale": full_scale,
                    }
            except Exception:
                pass

        return _postprocess_caps(_normalize_value(caps))

    reply["log"].append(f"INFO: Connecting to local SoapySDR device with details: {sdr_details}")

    stage = "opening device"
    try:
        # Get device parameters
        driver = sdr_details.get("driver", "")
        serial_number = sdr_details.get("serial", "")

        # Format the device args for the local connection
        device_args = f"driver={driver}"

        # Add the serial number if provided
        if serial_number:
            device_args += f",serial={serial_number}"

        # Create the device instance
        sdr = SoapySDR.Device(device_args)
        stage = "probing device capabilities"

        reply["log"].append(f"INFO: device args: {device_args}")

        # Get channel (default to 0)
        channel = sdr_details.get("channel", 0)

        # Get sample rates
        try:
            rates = sdr.listSampleRates(SOAPY_SDR_RX, channel)

            if not rates:
                raise Exception()

        except Exception as e:
            reply["log"].append(f"WARNING: Could not get sample rates: {e}")

            # Fall back to generating rates from ranges
            sample_rate_ranges = sdr.getSampleRateRange(SOAPY_SDR_RX, channel)
            rates_set: Set[int] = set()

            for rate_range in sample_rate_ranges:
                min_val = rate_range.minimum()
                max_val = rate_range.maximum()
                step = (
                    rate_range.step() if hasattr(rate_range, "step") else (max_val - min_val) / 10
                )

                if step > 0:
                    current = min_val
                    while current <= max_val:
                        rates_set.add(int(current))
                        current += step
            rates = [float(r) for r in sorted(list(rates_set))]

        # Get gain values
        gain_range = sdr.getGainRange(SOAPY_SDR_RX, channel)
        min_gain = gain_range.minimum()
        max_gain = gain_range.maximum()

        # Debug step value
        has_step = hasattr(gain_range, "step")

        step = gain_range.step() if has_step else 1.0

        # Ensure the step is positive and non-zero
        if step <= 0.001:
            step = 1.0

        max_iterations = 100
        iteration = 0

        current = min_gain

        # Calculate gain range with steps
        while current <= max_gain and iteration < max_iterations:
            gains.append(float(current))
            current += step
            iteration += 1

        # Check if automatic gain control is supported
        try:
            has_agc = sdr.hasGainMode(SOAPY_SDR_RX, channel)

        except Exception:
            reply["log"].append(
                "WARNING: Could not determine if automatic gain control is supported"
            )
            # Note: original had commented out logger.exception(e)

        # Get information about antennas
        try:
            # Get RX antennas
            antennas["rx"] = sdr.listAntennas(SOAPY_SDR_RX, channel)
            reply["log"].append(f"INFO: RX Antennas: {antennas['rx']}")

            # Get TX antennas if available
            try:
                antennas["tx"] = sdr.listAntennas(SOAPY_SDR_TX, channel)
                reply["log"].append(f"INFO: TX Antennas: {antennas['tx']}")
            except Exception as e:
                reply["log"].append(f"WARNING: Could not get TX antennas: {e}")
                # This is not critical as we might only be interested in RX

        except Exception as e:
            reply["log"].append(f"WARNING: Could not get antenna information: {e}")
            # Note: original had commented out logger.exception(e)

        # Get frequency range information
        try:
            # Get a frequency range for RX (receiving)
            rx_freq_ranges = sdr.getFrequencyRange(SOAPY_SDR_RX, channel)
            min_freq_rx = min([r.minimum() for r in rx_freq_ranges]) / 1e6  # Convert to MHz
            max_freq_rx = max([r.maximum() for r in rx_freq_ranges]) / 1e6  # Convert to MHz
            frequency_ranges["rx"] = {"min": min_freq_rx, "max": max_freq_rx}

            # Try to get a frequency range for TX (transmitting) if available
            try:
                tx_freq_ranges = sdr.getFrequencyRange(SOAPY_SDR_TX, channel)
                min_freq_tx = min([r.minimum() for r in tx_freq_ranges]) / 1e6  # Convert to MHz
                max_freq_tx = max([r.maximum() for r in tx_freq_ranges]) / 1e6  # Convert to MHz
                frequency_ranges["tx"] = {"min": min_freq_tx, "max": max_freq_tx}
            except Exception:
                reply["log"].append("INFO: Could not get TX frequency range")
                # This is not critical as we might only be interested in RX

        except Exception as e:
            reply["log"].append(f"WARNING: Could not get frequency range information: {e}")

        # Get a list of available sensors
        sensors: List[str] = []
        try:
            sensors = sdr.listSensors()
            clock_info["available_sensors"] = sensors
            reply["log"].append(f"INFO: Available sensors: {sensors}")
        except Exception as e:
            reply["log"].append(f"INFO: Could not list sensors: {e}")

        # Check reference clock status and source
        try:

            # Check if the device has a ref_locked sensor
            if "ref_locked" in sensors:
                try:
                    ref_locked = sdr.readSensor("ref_locked")
                    clock_info["ref_locked"] = ref_locked
                    reply["log"].append(f"INFO: External reference clock locked: {ref_locked}")
                except Exception as e:
                    reply["log"].append(f"WARNING: Error reading ref_locked sensor: {e}")

            # Check if the device has a clock_source sensor
            if "clock_source" in sensors:
                try:
                    clock_source = sdr.readSensor("clock_source")
                    clock_info["clock_source"] = clock_source
                    reply["log"].append(f"INFO: Current clock source: {clock_source}")
                except Exception as e:
                    reply["log"].append(f"WARNING: Error reading clock_source sensor: {e}")

            # Try to get the clock source from device settings
            try:
                clock_source = sdr.readSetting("clock_source")
                if clock_info["clock_source"] is None:  # Only set if not already set from sensor
                    clock_info["clock_source"] = clock_source
                reply["log"].append(f"INFO: Clock source from settings: {clock_source}")
            except Exception as e:
                reply["log"].append(f"INFO: Could not read clock_source setting: {e}")

            # Try to get available settings
            try:
                settings = sdr.getSettingInfo()
                for setting in settings:
                    if "clock" in setting.key.lower() or "ref" in setting.key.lower():
                        clock_info["available_settings"][setting.key] = {
                            "description": setting.description,
                            "value": (
                                sdr.readSetting(setting.key)
                                if hasattr(sdr, "readSetting")
                                else None
                            ),
                        }
                reply["log"].append(
                    f"INFO: Available clock-related settings: {list(clock_info['available_settings'].keys())}"
                )
            except Exception as e:
                reply["log"].append(f"INFO: Could not get setting info: {e}")

        except Exception as e:
            reply["log"].append(f"WARNING: Could not get reference clock information: {e}")

        # Probe for temperature info
        try:
            # Check if the device has a RFIC_TEMP sensor
            if "RFIC_TEMP" in sensors:
                try:
                    rfic_temp = sdr.readSensor("RFIC_TEMP")
                    temp_info["rfic_temp"] = rfic_temp
                    reply["log"].append(f"INFO: RFIC temperature: {rfic_temp}")
                except Exception as e:
                    reply["log"].append(f"WARNING: Error reading RFIC_TEMP sensor: {e}")

            # Check if the device has a lms7_temp sensor (for LimeSDR devices)
            if "lms7_temp" in sensors:
                try:
                    lms7_temp = sdr.readSensor("lms7_temp")
                    temp_info["lms7_temp"] = lms7_temp
                    reply["log"].append(f"INFO: LMS7 temperature: {lms7_temp}")
                except Exception as e:
                    reply["log"].append(f"WARNING: Error reading lms7_temp sensor: {e}")
        except Exception as e:
            reply["log"].append(f"WARNING: Could not get temperature information: {e}")

        reply["success"] = True

        capabilities = _collect_capabilities(sdr, channel)

    except Exception as e:
        error_message = format_device_error(
            "SoapySDR",
            stage,
            e,
            driver=sdr_details.get("driver"),
            serial=sdr_details.get("serial"),
        )
        reply["log"].append(f"ERROR: {error_message}")
        reply["success"] = False
        reply["error"] = error_message

    finally:
        reply["data"] = {
            "rates": sorted(rates),
            "gains": gains,
            "has_soapy_agc": has_agc,
            "antennas": antennas,
            "frequency_ranges": frequency_ranges,
            "clock_info": clock_info,
            "temperature": temp_info,
            "capabilities": capabilities,
        }

    return reply
