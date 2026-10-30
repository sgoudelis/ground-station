# Copyright (c) 2026 Efstratios Goudelis
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

"""SPUTNIX USP messages in UMKA-1 (RS40S) and SAKHACUBE-CHOLBON (RS18S) AX.25 frames.

Message body layouts are Kaitai specs (``specs/usp_uhf.ksy``, ``usp_power.ksy``
and ``usp_adcs.ksy``, generated into ``gen/``); this module keeps what a byte
layout cannot express: the TLV message framing with per-message status, the
human labels/units the values tab shows, flag-bit expansion, NaN handling and
the time_utc conversion. Layouts follow SPUTNIX's UHF_msgid, PS3_msgid and
OBCU_msgid resources, cross-checked against SatsDecoder's systems/usp.py. See
docs/UMKA_TELEMETRY.md for references, units and capture examples. USP
deframers already remove FEC and the outer encapsulation; there is no AX.25
FCS to remove from this payload.
"""

import math
import struct
from datetime import datetime, timezone
from typing import Any

from .kaitai import decode_spec, split_spec_fields

# key -> (label, unit); table order drives values/field_info presentation order,
# matching the previous hand-coded field tables.
UHF_LABELS: dict[str, tuple[str, str]] = {
    "amplifier_temperature": ("Amplifier temperature", "°C"),
    "radio_temperature": ("Radio temperature", "°C"),
    "received_signal_strength": ("Received signal strength", "dBm"),
    "idle_signal_strength": ("Idle signal strength", "dBm"),
    "forward_power": ("Forward RF power", "dBm"),
    "reflected_power": ("Reflected RF power", "dBm"),
    "reset_count": ("Radio reset count", ""),
    "radio_flags": ("Radio flags", ""),
    "time_unix_s": ("Radio time", "s"),
    "uptime": ("Radio uptime", "s"),
    "receive_bitrate": ("Receive bitrate", "bit/s"),
    "current": ("Radio current", "mA"),
    "input_voltage": ("Radio input voltage", "V"),
}

POWER_LABELS: dict[str, tuple[str, str]] = {
    **{f"panel_voltage_{i + 1}": (f"Solar panel {i + 1} voltage", "V") for i in range(3)},
    **{f"panel_current_{i + 1}": (f"Solar panel {i + 1} current", "mA") for i in range(3)},
    "battery_current": ("Battery current", "mA"),
    **{f"channel_current_{i + 1}": (f"Output channel {i + 1} current", "mA") for i in range(4)},
    **{f"battery_temperature_{i + 1}": (f"Battery temperature {i + 1}", "°C") for i in range(4)},
    "battery_voltage": ("Battery voltage", "V"),
    "record_id": ("Power telemetry sequence", ""),
    "time_unix_s": ("Power system time", "s"),
    "reset_count": ("Power system reset count", ""),
    "reset_reason": ("Power system reset reason", ""),
}


# Legacy table order: all quaternions, then all angular velocities (the wire
# layout interleaves them per attitude solution block).
ADCS_LABELS: dict[str, tuple[str, str]] = {
    "time_unix_us": ("Attitude-control time", "µs"),
    "uptime": ("Attitude-control uptime", "s"),
    **{
        f"{prefix}_quaternion_{axis}": (f"{label} quaternion {axis}", "")
        for prefix, label in (("eci", "ECI"), ("orb", "Orbital"), ("forced", "Forced ECI"))
        for axis in "wxyz"
    },
    **{
        f"{prefix}_angular_velocity_{axis}": (f"{label} angular velocity {axis}", "°/s")
        for prefix, label in (("eci", "ECI"), ("orb", "Orbital"), ("forced", "Forced ECI"))
        for axis in "xyz"
    },
    "latitude": ("Latitude", "°"),
    "longitude": ("Longitude", "°"),
    "altitude": ("Altitude", "m"),
    "task_type": ("Attitude-control task type", ""),
    "task_count": ("Scheduled attitude-control tasks", ""),
    "wheel_speed_x_plus": ("Reaction wheel +X speed", "rpm"),
    "wheel_speed_x_minus": ("Reaction wheel −X speed", "rpm"),
    "wheel_speed_y_plus": ("Reaction wheel +Y speed", "rpm"),
    "wheel_speed_y_minus": ("Reaction wheel −Y speed", "rpm"),
}

# message id -> (display name, expected body size, kaitai spec, labels)
LAYOUTS = {
    0x4246: ("UHF radio beacon", 25, "usp_uhf", UHF_LABELS),
    0xDE21: ("Power system telemetry", 46, "usp_power", POWER_LABELS),
    0xF210: ("Attitude-control telemetry", 125, "usp_adcs", ADCS_LABELS),
}

NON_TELEMETRY = {
    0x0118: "Command acknowledgement",
    0x0119: "Command rejection",
    0x0C20: "File transfer start",
    0x0C24: "File transfer data",
    0x0C2B: "File transfer size",
    0xDE24: "Power system acknowledgement",
    0xFFF1: "Terminal output",
}


def _add_value(message: dict[str, Any], key: str, value: Any, label: str, unit: str = "") -> None:
    message["values"][key] = value
    message["field_info"][key] = {"label": label, "unit": unit}


def _add_flags(message: dict[str, Any], value: int, flags: tuple[tuple[str, str], ...]) -> None:
    for bit, (key, label) in enumerate(flags):
        _add_value(message, key, bool(value & (1 << bit)), label)


def _decode_message(
    message: dict[str, Any], body: bytes, spec: str, labels: dict[str, tuple[str, str]]
) -> None:
    """Populate one message dict from its body using the Kaitai spec.

    Seq fields (suffixed ``_raw`` in the spec) become raw_fields under the
    suffix-stripped legacy key; computed instances become values, presented
    in label-table order with their labels/units.
    """
    fields, instances = split_spec_fields(decode_spec(spec, body), spec)
    for name, value in fields.items():
        if not name.endswith("_raw"):
            continue
        # NaN/Infinity are legal float bit patterns, but not JSON measurements.
        finite = not isinstance(value, float) or math.isfinite(value)
        message["raw_fields"][name[:-4]] = value if finite else str(value)
    for key, (label, unit) in labels.items():
        value = instances[key]
        finite = not isinstance(value, float) or math.isfinite(value)
        _add_value(message, key, value if finite else None, label, unit)

    timestamp_key = "time_unix_us" if "time_unix_us" in message["values"] else "time_unix_s"
    timestamp = message["values"].pop(timestamp_key)
    divisor = 1_000_000 if timestamp_key == "time_unix_us" else 1
    # Keep the transmitted clock in raw_fields; subsystem clocks may be unsynchronised.
    try:
        utc = datetime.fromtimestamp(timestamp / divisor, timezone.utc).isoformat()
    except (ValueError, OverflowError, OSError):
        utc = None
    label = message["field_info"].pop(timestamp_key)["label"]
    _add_value(message, "time_utc", utc, label + " (UTC)")

    # Flag-bit semantics (presentation logic a byte layout cannot express).
    message_id = message["message_id"]
    if message_id == "0x4246":
        _add_value(message, "active_schedules", body[24] & 0x1F, "Active schedules")
        _add_flags(
            message,
            body[24] >> 5,
            (
                ("reset_during_schedule", "Reset during schedule execution"),
                ("backup_schedule_active", "Backup schedule active"),
            ),
        )
    elif message_id == "0xDE21":
        # The flags occupy four little-endian bytes, not one 32-bit big-endian bitfield.
        flags = int.from_bytes(body[30:34], "little")
        _add_flags(
            message,
            flags,
            (
                ("battery_temperature_low", "Battery temperature below minimum"),
                ("battery_temperature_high", "Battery temperature above maximum"),
                ("heater_1_on", "Battery heater 1 on"),
                ("heater_2_on", "Battery heater 2 on"),
                ("heater_1_manual", "Battery heater 1 manual mode"),
                ("heater_2_manual", "Battery heater 2 manual mode"),
                ("battery_voltage_low", "Battery voltage below minimum"),
                ("battery_voltage_critical", "Battery voltage critical"),
                *(
                    (f"channel_{i}_fault", f"Output channel {i} current limit/fault")
                    for i in range(1, 5)
                ),
                *((f"channel_{i}_on", f"Output channel {i} on") for i in range(1, 5)),
                ("charger_connected", "Charger connected"),
                ("power_switch_fault", "Power switch fault"),
                *((f"aux_channel_{i}_on", f"Auxiliary channel {i} on") for i in range(1, 4)),
            ),
        )
    elif message_id == "0xF210":
        for prefix, label, offset in (
            ("eci", "ECI", 40),
            ("orb", "Orbital", 69),
            ("forced", "Forced ECI", 98),
        ):
            flags = body[offset]
            _add_value(message, prefix + "_policy", flags & 0x7F, label + " solution policy")
            _add_value(
                message, prefix + "_invalid", bool(flags & 0x80), label + " solution invalid"
            )
            if flags & 0x80:
                # An invalid solution is retained in raw_fields, but never presented as a measurement.
                for key in message["values"]:
                    if key.startswith((prefix + "_quaternion_", prefix + "_angular_velocity_")):
                        message["values"][key] = None
        _add_value(message, "gnss_invalid", bool(body[111] & 8), "GNSS solution invalid")
        _add_value(message, "ballistics_policy", body[111] & 7, "Orbit solution policy")
        _add_value(message, "reset_reason", body[124] >> 4, "Attitude-control reset reason")
        for bit, axis in enumerate(("x_plus", "x_minus", "y_plus", "y_minus")):
            if body[124] & (1 << bit):
                message["values"]["wheel_speed_" + axis] = None


class USPParser:
    """Decode a sequence of length-delimited USP messages without guessing layouts."""

    parser_id = "usp"

    def parse(self, payload: bytes) -> dict[str, Any]:
        result: dict[str, Any] = {"format": "usp", "length": len(payload), "messages": []}
        if not payload:
            result["error"] = "Empty USP payload."
            return result
        offset = 0
        while offset < len(payload):
            if len(payload) - offset < 8:
                result["error"] = f"Truncated USP header at payload byte {offset}."
                result["unparsed_hex"] = payload[offset:].hex()
                break
            message_id, source, destination, size = struct.unpack_from("<4H", payload, offset)
            layout = LAYOUTS.get(message_id)
            message: dict[str, Any] = {
                "message_id": f"0x{message_id:04X}",
                "source": source,
                "destination": destination,
                "length": size,
                "name": (
                    layout[0] if layout else NON_TELEMETRY.get(message_id, "Unknown USP message")
                ),
                "status": "unsupported",
                "values": {},
                "field_info": {},
                "raw_fields": {},
            }
            result["messages"].append(message)
            offset += 8
            body = payload[offset : offset + size]
            message["payload_hex"] = body.hex()
            if len(body) != size:
                message["status"] = "malformed"
                message["error"] = (
                    f"Truncated USP message: expected {size} bytes, received {len(body)}."
                )
                break
            # Always advance by the declared size, including unknown messages. This
            # preserves subsequent telemetry and repeated messages in a single frame.
            offset += size
            if layout:
                _, expected_size, spec, labels = layout
                if size != expected_size:
                    message["status"] = "malformed"
                    message["error"] = (
                        f"Unsupported message length: expected {expected_size} bytes, received {size}."
                    )
                    continue
                _decode_message(message, body, spec, labels)
                message["status"] = "decoded"
            elif message_id in NON_TELEMETRY:
                message["status"] = "non_telemetry"
        return result
