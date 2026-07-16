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
from ctypes import c_ubyte
from typing import Any, Dict, List, Optional

from rtlsdr import librtlsdr

logger = logging.getLogger("rtlsdr-usbenum")


def _decode_usb_string(buf: Any) -> str:
    raw = bytes(buf)
    return raw.split(b"\x00", 1)[0].decode("utf-8", errors="ignore")


def probe_available_rtl_sdrs() -> str:
    """
    List and return information about all USB-connected RTL-SDR devices.

    Returns:
        JSON string containing:
            - success: Boolean indicating success
            - data: List of device dictionaries with:
                - device_index: RTL-SDR device index
                - name: Device name reported by librtlsdr
                - manufacturer: USB manufacturer string
                - product: USB product string
                - serial: USB serial string
                - label: Human-readable label
            - error: Error message if any
            - log: List of log messages
    """

    log_messages: List[str] = []
    devices: List[Dict[str, Any]] = []
    success: Optional[bool] = None
    error: Optional[str] = None

    log_messages.append("Enumerating available RTL-SDR devices")

    try:
        count = int(librtlsdr.rtlsdr_get_device_count())
        log_messages.append(f"Found {count} RTL-SDR device(s)")

        for index in range(count):
            name_ptr = librtlsdr.rtlsdr_get_device_name(index)
            name = name_ptr.decode("utf-8", errors="ignore") if name_ptr else "RTL-SDR"

            manufacturer_buf = (c_ubyte * 256)()
            product_buf = (c_ubyte * 256)()
            serial_buf = (c_ubyte * 256)()
            res = librtlsdr.rtlsdr_get_device_usb_strings(
                index, manufacturer_buf, product_buf, serial_buf
            )

            if res == 0:
                manufacturer = _decode_usb_string(manufacturer_buf)
                product = _decode_usb_string(product_buf)
                serial = _decode_usb_string(serial_buf)
            else:
                manufacturer = ""
                product = ""
                serial = ""

            label_parts = [part for part in [product, name] if part]
            label = " / ".join(label_parts) if label_parts else "RTL-SDR"

            device_entry = {
                "device_index": index,
                "name": name,
                "manufacturer": manufacturer,
                "product": product,
                "serial": serial,
                "label": label,
                # Keep probe payload shape aligned with Soapy/UHD probes.
                # RTL-SDR devices expose a single effective RX input in this app.
                "antennas": {"rx": ["RX"], "tx": []},
            }

            log_messages.append(f"Found RTL-SDR device: {label}")
            devices.append(device_entry)

        success = True

    except Exception as exc:
        log_messages.append(f"Error: Error enumerating RTL-SDR devices: {str(exc)}")
        log_messages.append(f"Exception: {str(exc)}")
        success = False
        error = str(exc)

    reply: Dict[str, Any] = {
        "success": success,
        "data": devices,
        "error": error,
        "log": log_messages,
    }

    return json.dumps(reply)
