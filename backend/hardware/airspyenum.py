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
from typing import Any, Dict, List, Optional

from hardware.airspynative import AirspyDevice, AirspyhfDevice, AirspyNativeError, format_serial

logger = logging.getLogger("airspy-usbenum")


def _build_airspy_entry(driver: str, serial: int, rates_hz: List[int]) -> Dict[str, Any]:
    serial_text = format_serial(serial)
    rx_min_mhz = 24.0 if driver == "airspy" else 0.009
    rx_max_mhz = 1750.0 if driver == "airspy" else 260.0
    label_prefix = "Airspy" if driver == "airspy" else "Airspy HF+"
    tail = serial_text[-6:]
    return {
        "driver": driver,
        "label": f"{label_prefix} :: {tail}",
        "serial": serial_text,
        "sample_rates_hz": rates_hz,
        "frequency_ranges": {"rx": {"min": rx_min_mhz, "max": rx_max_mhz}},
        "frequency_min": rx_min_mhz,
        "frequency_max": rx_max_mhz,
        "antennas": {"rx": ["RX"], "tx": []},
    }


def probe_available_airspy_devices() -> str:
    """
    Enumerate native Airspy and Airspy HF+ devices without using SoapySDR.
    """

    log_messages: List[str] = []
    devices: List[Dict[str, Any]] = []
    success: Optional[bool] = None
    error: Optional[str] = None

    try:
        airspy_serials = AirspyDevice.list_serials()
        log_messages.append(f"Detected {len(airspy_serials)} native Airspy device(s)")
        for serial in airspy_serials:
            device = None
            try:
                device = AirspyDevice.open(serial)
                rates = device.get_samplerates()
                devices.append(_build_airspy_entry("airspy", serial, rates))
            finally:
                if device is not None:
                    device.close()

        hf_serials = AirspyhfDevice.list_serials()
        log_messages.append(f"Detected {len(hf_serials)} native Airspy HF+ device(s)")
        for serial in hf_serials:
            device = None
            try:
                device = AirspyhfDevice.open(serial)
                rates = device.get_samplerates()
                devices.append(_build_airspy_entry("airspyhf", serial, rates))
            finally:
                if device is not None:
                    device.close()

        success = True

    except AirspyNativeError as exc:
        logger.error("Native Airspy enumeration failed: %s", exc)
        log_messages.append(f"Error: {exc}")
        success = False
        error = str(exc)
    except Exception as exc:
        logger.exception("Unexpected error enumerating native Airspy devices")
        log_messages.append(f"Error: {exc}")
        success = False
        error = str(exc)

    reply = {
        "success": success,
        "data": devices,
        "error": error,
        "log": log_messages,
    }
    return json.dumps(reply)
