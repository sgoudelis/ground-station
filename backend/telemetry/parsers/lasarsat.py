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

"""LASARSAT AX.25 information-field parser.

Field order follows the SatNOGS LASARSAT Kaitai schema:
https://gitlab.com/librespacefoundation/satnogs/satnogs-decoders/-/blob/master/ksy/lasarsat.ksy

The beacon contains ASCII integers, not binary floating-point measurements.
The published schema does not define engineering-unit scaling for these fields,
so values remain in their transmitted units.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Literal


@dataclass(frozen=True)
class BeaconField:
    """One CSV column and its presentation; tuple order is the wire order.

    Calibration is deliberately unspecified for counters, flags and text.
    Sensor/timing readings use calibrated=False until their conversion is
    documented. A missing physical unit must never imply a guessed scale.
    """

    name: str
    label: str
    group: str | None
    encoding: Literal["decimal", "hex", "text"] = "decimal"
    calibrated: bool | None = None
    unit: str = ""
    allow_nan: bool = False

    def parse(self, token: str) -> int | str | None:
        if self.allow_nan and token == "nan":
            return None
        if self.encoding == "text":
            return token
        pattern = r"[0-9A-Fa-f]+" if self.encoding == "hex" else r"[+-]?\d+"
        if not re.fullmatch(pattern, token):
            raise ValueError(f"Invalid {self.name}: {token!r}")
        return int(token, 16 if self.encoding == "hex" else 10)

    def info(self, order: int) -> dict[str, Any]:
        info = {"label": self.label, "unit": self.unit, "group": self.group, "order": order}
        if self.calibrated is not None:
            info["calibrated"] = self.calibrated
        return info


# The first column is the transmitted beacon identifier. Remaining columns
# follow the published schema's field order exactly.
BEACON_FIELDS = {
    "OBC": (
        BeaconField("obc_reset_cnt", "Reset count", "obc"),
        BeaconField("obc_uptime", "Uptime", "obc", calibrated=False),
        BeaconField("obc_uptime_tot", "Total uptime", "obc", calibrated=False),
        BeaconField("obc_temp_mcu", "MCU temperature", "temperatures", calibrated=False),
        BeaconField("obc_freemem", "Free memory", "obc", calibrated=False),
    ),
    "PSU": (
        BeaconField("psu_reset_cnt", "Reset count", "status"),
        BeaconField("psu_uptime", "Uptime", "status", calibrated=False),
        BeaconField("psu_uptime_tot", "Total uptime", "status", calibrated=False),
        BeaconField("psu_battery", "Battery reading", "power", calibrated=False),
        BeaconField("psu_temp_sys", "System temperature", "temperatures", calibrated=False),
        BeaconField("psu_temp_bat", "Battery temperature", "temperatures", calibrated=False),
        BeaconField("psu_cur_in", "Input current", "power", calibrated=False),
        BeaconField("psu_cur_out", "Output current", "power", calibrated=False),
        # Only the documented channel bits are promoted to display values.
        BeaconField("psu_ch_state_num", "Output channel bitfield", None, encoding="hex"),
        BeaconField("psu_sys_state", "System state code", "status"),
        BeaconField("psu_gnd_wdt", "Ground watchdog reading", "status", calibrated=False),
    ),
    "SOL": (
        # The schema orders positive Z/X/Y before negative Z/X/Y.
        *(
            BeaconField(
                f"sol_{reading}_{axis}{side}",
                f"{sign}{axis.upper()} {label}",
                group,
                calibrated=False,
                allow_nan=True,
            )
            for reading, label, group in (
                ("temp", "panel temperature", "panels"),
                ("diode", "diode reading", "diodes"),
            )
            for side, sign in (("p", "+"), ("n", "−"))
            for axis in "zxy"
        ),
    ),
    "MGS": (
        BeaconField(
            "mgs_temp_int_mag", "Magnetometer temperature", "temperatures", calibrated=False
        ),
        BeaconField("mgs_temp_int_gyr", "Gyroscope temperature", "temperatures", calibrated=False),
        *(
            BeaconField(
                f"mgs_int_{sensor}_{axis}", f"{axis.upper()} reading", group, calibrated=False
            )
            for sensor, group in (("mag", "magnetometer"), ("gyr", "gyroscope"))
            for axis in "xyz"
        ),
    ),
    "DOS": (
        BeaconField("dos_mode", "Mode code", "payload"),
        *(
            BeaconField(f"dos_{sensor}_{axis}", f"{axis.upper()} reading", group, calibrated=False)
            for sensor, group in (("gyr", "gyroscope"), ("mag", "magnetometer"))
            for axis in "xyz"
        ),
        BeaconField("dos_plasma", "Plasma reading", "payload", calibrated=False),
        BeaconField("dos_phd", "PHD reading", "payload", calibrated=False),
        BeaconField("dos_dozi", "DOZI reading", "payload", calibrated=False),
        BeaconField("dos_gyr_t", "Gyroscope temperature", "temperatures", calibrated=False),
        BeaconField("dos_mag_t", "Magnetometer temperature", "temperatures", calibrated=False),
        BeaconField("dos_lppa", "LPPA reading", "payload", calibrated=False),
        BeaconField("dos_bus_cur", "Bus current", "power", calibrated=False),
        BeaconField("dos_bus_vol", "Bus voltage", "power", calibrated=False),
        BeaconField("dos_uptime", "Uptime", "payload", calibrated=False),
    ),
    "NAV": (
        BeaconField("nav_week", "Week number", "navigation", calibrated=False),
        BeaconField("nav_time", "Time reading", "navigation", calibrated=False),
        *(
            BeaconField(f"nav_{key}_{axis}", f"{axis.upper()} {label}", group, calibrated=False)
            for key, label, group in (
                ("pos", "position", "position"),
                ("vel", "velocity", "velocity"),
            )
            for axis in "xyz"
        ),
        BeaconField("nav_sats", "Satellite count", "navigation"),
        BeaconField("nav_dop", "Dilution of precision", "navigation", calibrated=False),
        BeaconField("nav_ant_cur", "Antenna current", "navigation", calibrated=False),
        BeaconField("nav_volt", "Supply voltage", "navigation", calibrated=False),
        BeaconField("nav_max_snr", "Maximum SNR", "navigation", calibrated=False),
    ),
    **{
        kind: (
            BeaconField(f"{band}_uptime", "Uptime", "communications", calibrated=False),
            BeaconField(f"{band}_uptime_tot", "Total uptime", "communications", calibrated=False),
            BeaconField(f"{band}_reset_cnt", "Reset count", "communications"),
            BeaconField(f"{band}_rf_reset_cnt", "RF reset count", "communications"),
            BeaconField(
                f"{band}_trx_temp", "Transceiver temperature", "temperatures", calibrated=False
            ),
            BeaconField(f"{band}_rf_temp", "RF temperature", "temperatures", calibrated=False),
            BeaconField(
                f"{band}_pa_temp", "Amplifier temperature", "temperatures", calibrated=False
            ),
            BeaconField(f"{band}_digipeater_cnt", "Digipeater count", "communications"),
            BeaconField(
                f"{band}_last_digipeater", "Last digipeater", "communications", encoding="text"
            ),
            BeaconField(f"{band}_rx_cnt", "Received packet count", "communications"),
            BeaconField(f"{band}_tx_cnt", "Transmitted packet count", "communications"),
            BeaconField(f"{band}_act_rssi_raw", "Current RSSI", "communications", calibrated=False),
            BeaconField(f"{band}_dcd_rssi_raw", "DCD RSSI", "communications", calibrated=False),
        )
        for kind, band in (("U", "uhf"), ("V", "vhf"))
    },
}

PSU_CHANNELS = tuple(
    BeaconField(f"psu_ch{channel}_state", f"Channel {channel} enabled", "channels")
    for channel in range(7)
)


class LasarsatAx25Parser:
    """Decode a LASARSAT beacon after AX.25 addresses, control, and PID."""

    parser_id = "lasarsat"

    def parse(self, payload: bytes) -> dict[str, Any]:
        result: dict[str, Any] = {"satellite": "LASARSAT", "length": len(payload)}

        # The radio terminates beacon text with NUL. Reject embedded NULs so
        # a damaged or concatenated packet cannot yield plausible values.
        body = payload.removesuffix(b"\x00")
        try:
            beacon = body.decode("ascii")
        except UnicodeDecodeError:
            return {**result, "format": "raw", "hex": payload.hex()}

        kind, _, _ = beacon.partition(",")
        fields = BEACON_FIELDS.get(kind)
        if fields is None:
            return {**result, "format": "text", "text": beacon}

        values_text = beacon.split(",")[1:]
        if len(values_text) != len(fields) or "\x00" in beacon:
            return {
                **result,
                "format": "malformed",
                "type": kind,
                "error": f"Expected {len(fields)} {kind} fields, received {len(values_text)}",
                "text": beacon,
            }

        decoded: dict[str, Any] = {}
        for field, token in zip(fields, values_text):
            try:
                decoded[field.name] = field.parse(token)
            except ValueError as exc:
                # Discard partial readings: a malformed CSV beacon is never a
                # successful decode, even if its first columns were valid.
                return {
                    **result,
                    "format": "malformed",
                    "type": kind,
                    "error": str(exc),
                    "text": beacon,
                }

        values = {field.name: decoded[field.name] for field in fields if field.group is not None}
        field_info = {
            field.name: field.info(order)
            for order, field in enumerate(fields)
            if field.group is not None
        }

        if kind == "PSU":
            # The channel-state field is hexadecimal; bit 0 corresponds to CH0.
            state = decoded["psu_ch_state_num"]
            for channel, field in enumerate(PSU_CHANNELS):
                values[field.name] = bool(state & (1 << channel))
                field_info[field.name] = field.info(len(fields) + channel)

        # Keep the exact CSV tokens (including hex, signs and 'nan') for
        # inspection and future calibration, independent of display values.
        return {
            **result,
            "format": "beacon",
            "type": kind,
            "values": values,
            "field_info": field_info,
            "raw_fields": {field.name: token for field, token in zip(fields, values_text)},
            "text": beacon,
        }
