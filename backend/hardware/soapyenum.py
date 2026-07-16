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
from enum import Enum
from typing import Any, Dict, List, Optional

import SoapySDR

# Configure logging
logger = logging.getLogger("soapysdr-usbenum")

# Check for frequency range or not
check_freq_range = True


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
                if hasattr(device, "readSetting"):
                    try:
                        entry["value"] = _normalize_value(device.readSetting(setting.key))
                    except Exception:
                        pass
                caps["settings"].append(entry)
                if isinstance(entry["options"], list) and len(entry["options"]) == 0:
                    entry["options"] = None

                key_text = (
                    f"{setting.key} {entry.get('name', '')} {entry.get('description', '')}".lower()
                )
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
        caps["agc"]["supported_rx"] = device.hasGainMode(SoapySDRDirection.RX.value, channel_index)
    except Exception:
        pass
    try:
        caps["agc"]["supported_tx"] = device.hasGainMode(SoapySDRDirection.TX.value, channel_index)
    except Exception:
        pass

    for direction_name, direction in ("rx", SoapySDRDirection.RX.value), (
        "tx",
        SoapySDRDirection.TX.value,
    ):
        try:
            if hasattr(device, "listGains"):
                caps["gain_elements"][direction_name] = device.listGains(direction, channel_index)
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
                caps["bandwidths"][direction_name] = device.listBandwidths(direction, channel_index)
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


def _build_local_device_open_args_candidates(device_dict: Dict[str, Any]) -> List[Any]:
    """
    Build progressively simpler SoapySDR open arguments for local USB devices.

    Some drivers only open with the full enumerate kwargs, while others are more
    reliable with reduced args such as driver+serial.
    """
    candidates: List[Any] = []

    full_args = dict(device_dict)
    candidates.append(full_args)

    driver = str(device_dict.get("driver", "") or "").strip()
    serial = str(device_dict.get("serial", "") or "").strip()
    if serial.lower() in ("", "unknown", "none", "null"):
        serial = ""

    if driver:
        reduced_args: Dict[str, str] = {"driver": driver}
        if serial:
            reduced_args["serial"] = serial
        candidates.append(reduced_args)

        args_string = f"driver={driver}"
        if serial:
            args_string += f",serial={serial}"
        candidates.append(args_string)

    unique_candidates: List[Any] = []
    seen = set()
    for candidate in candidates:
        fingerprint = (
            json.dumps(candidate, sort_keys=True) if isinstance(candidate, dict) else str(candidate)
        )
        if fingerprint in seen:
            continue
        seen.add(fingerprint)
        unique_candidates.append(candidate)

    return unique_candidates


class SoapySDRDirection(Enum):
    """Enumeration for SoapySDR direction types"""

    RX = SoapySDR.SOAPY_SDR_RX
    TX = SoapySDR.SOAPY_SDR_TX


class SoapySDRFormat(Enum):
    """Enumeration for SoapySDR format types"""

    CS8 = SoapySDR.SOAPY_SDR_CS8
    CS16 = SoapySDR.SOAPY_SDR_CS16
    CF32 = SoapySDR.SOAPY_SDR_CF32
    CF64 = SoapySDR.SOAPY_SDR_CF64


class SoapySDRDriverType(Enum):
    """Known SoapySDR driver types for USB devices"""

    RTLSDR = "rtlsdr"
    HACKRF = "hackrf"
    AIRSPY = "airspy"
    AIRSPYHF = "airspyhf"
    BLADERF = "bladerf"
    SDRPLAY = "sdrplay"
    LIME = "lime"
    UHD = "uhd"
    UNKNOWN = "unknown"


def probe_available_usb_sdrs() -> str:
    """
    List and return information about all USB-connected SoapySDR devices.
    Probes each device for supported frequency ranges.

    Returns:
        JSON string containing:
            - success: Boolean indicating success
            - data: List of device dictionaries with:
                - driver: The SDR driver name
                - label: Human-readable device label
                - serial: Device serial number if available
                - is_usb: Boolean indicating if device is USB-connected
                - manufacturer: Device manufacturer if available
                - product: Product name if available
                - frequency_ranges: Dictionary of supported frequency ranges per direction
                - other device-specific attributes
            - error: Error message if any
            - log: List of log messages
    """

    log_messages: List[str] = []
    usb_devices: List[Dict[str, Any]] = []
    success: Optional[bool] = None
    error: Optional[str] = None

    log_messages.append("Enumerating available USB-connected SoapySDR devices")

    try:
        # Enumerate all available devices
        all_devices = SoapySDR.Device.enumerate()
        log_messages.append(f"Found {len(all_devices)} SoapySDR devices in total")
        log_messages.append(str(all_devices))

        for device_info in all_devices:
            device_dict = dict(device_info)

            # Check if this is a USB device
            # Most USB SDRs will have 'usb' in their driver name, serial, or path
            is_usb_device = False
            driver = device_dict.get("driver", "")

            # Common USB SDR drivers
            usb_drivers = [
                driver.value
                for driver in SoapySDRDriverType
                if driver != SoapySDRDriverType.UNKNOWN
            ]

            if any(driver.lower() == d.lower() for d in usb_drivers):
                is_usb_device = True

            # Check for USB in other fields if not already identified
            if not is_usb_device:
                for key, value in device_dict.items():
                    if isinstance(value, str) and (
                        "usb" in value.lower() or "bus" in value.lower()
                    ):
                        is_usb_device = True
                        break

            if is_usb_device:
                # Create a device entry with essential information
                device_entry = {
                    "driver": driver,
                    "label": device_dict.get("label", f"{driver} device"),
                    "serial": device_dict.get("serial", "Unknown"),
                    "is_usb": True,
                    "frequency_ranges": {},
                    "antennas": {"rx": [], "tx": []},
                }

                # Add other useful information if available
                for key in ["manufacturer", "product", "deviceId", "tuner", "name"]:
                    if key in device_dict:
                        device_entry[key] = device_dict[key]

                log_messages.append(f"Found USB SDR device: {device_entry['label']}")

                if check_freq_range:
                    # Probe device for frequency ranges
                    sdr = None
                    try:
                        # Retry with progressively simpler args to avoid silently
                        # losing antenna data for devices that reject one arg shape.
                        for candidate_args in _build_local_device_open_args_candidates(device_dict):
                            try:
                                sdr = SoapySDR.Device(candidate_args)
                                break
                            except Exception as open_error:
                                log_messages.append(
                                    "Warning: Failed to open local SoapySDR device with args "
                                    f"{candidate_args}: {str(open_error)}"
                                )

                        if sdr is None:
                            raise Exception(
                                "Failed to open SoapySDR device with available argument candidates"
                            )

                        # Get frequency ranges for all available channels (both RX and TX)
                        frequency_ranges: Dict[str, Any] = {}

                        num_rx_channels = 0
                        num_tx_channels = 0

                        # Check RX capabilities
                        try:
                            num_rx_channels = sdr.getNumChannels(SoapySDRDirection.RX.value)
                            if num_rx_channels > 0:
                                frequency_ranges["rx"] = []
                                for channel in range(num_rx_channels):
                                    # Get the frequency range for this channel
                                    ranges = sdr.getFrequencyRange(
                                        SoapySDRDirection.RX.value, channel
                                    )
                                    parsed_ranges = []
                                    for freq_range in ranges:
                                        # Convert range to dict with min, max and step values
                                        parsed_ranges.append(
                                            {
                                                "min": freq_range.minimum(),
                                                "max": freq_range.maximum(),
                                                "step": freq_range.step(),
                                            }
                                        )
                                    frequency_ranges["rx"].append(parsed_ranges)

                        except Exception as e:
                            log_messages.append(
                                f"Warning: Error probing RX frequency range: {str(e)}"
                            )

                        # Check TX capabilities
                        try:
                            num_tx_channels = sdr.getNumChannels(SoapySDRDirection.TX.value)
                            if num_tx_channels > 0:
                                frequency_ranges["tx"] = []
                                for channel in range(num_tx_channels):
                                    # Get the frequency range for this channel
                                    ranges = sdr.getFrequencyRange(
                                        SoapySDRDirection.TX.value, channel
                                    )
                                    parsed_ranges = []
                                    for freq_range in ranges:
                                        # Convert range to dict with min, max and step values
                                        parsed_ranges.append(
                                            {
                                                "min": freq_range.minimum(),
                                                "max": freq_range.maximum(),
                                                "step": freq_range.step(),
                                            }
                                        )
                                    frequency_ranges["tx"].append(parsed_ranges)

                        except Exception as e:
                            log_messages.append(
                                f"Warning: Error probing TX frequency range: {str(e)}"
                            )

                        # Add frequency range information to device entry
                        device_entry["frequency_ranges"] = frequency_ranges

                        # Add capability information to device entry
                        device_entry["capabilities"] = _collect_capabilities(sdr, 0)

                        # Include antenna ports for the add/edit SDR probe flow.
                        # Keep this contract explicit and inspect failures via logs.
                        try:
                            device_entry["antennas"]["rx"] = [
                                str(port)
                                for port in sdr.listAntennas(SoapySDRDirection.RX.value, 0)
                                if str(port).strip()
                            ]
                        except Exception as exc:
                            logger.debug(
                                "Could not probe RX antennas for %s: %s", device_entry["label"], exc
                            )
                            device_entry["antennas"]["rx"] = []

                        try:
                            device_entry["antennas"]["tx"] = [
                                str(port)
                                for port in sdr.listAntennas(SoapySDRDirection.TX.value, 0)
                                if str(port).strip()
                            ]
                        except Exception as exc:
                            logger.debug(
                                "Could not probe TX antennas for %s: %s", device_entry["label"], exc
                            )
                            device_entry["antennas"]["tx"] = []

                    except Exception as e:
                        log_messages.append(f"Warning: Error probing device capabilities: {str(e)}")
                        device_entry["frequency_ranges"] = {"error": str(e)}
                    finally:
                        try:
                            if sdr is not None and hasattr(sdr, "close"):
                                sdr.close()
                        except Exception:
                            pass

                usb_devices.append(device_entry)

        success = True

    except Exception as e:
        log_messages.append(f"Error: Error enumerating SoapySDR devices: {str(e)}")
        log_messages.append(f"Exception: {str(e)}")
        success = False
        error = str(e)

    reply: Dict[str, Any] = {
        "success": success,
        "data": usb_devices,
        "error": error,
        "log": log_messages,
    }

    return json.dumps(reply)
