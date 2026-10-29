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

"""Labels and units for binary telemetry; byte layouts remain in the specs."""

from typing import Any

_TEMPERATURES = {
    f"temp_{axis}_{side}_c": (f"{sign}{axis.upper()} panel temperature", "°C")
    for axis in "xyz"
    for side, sign in (("p", "+"), ("n", "−"))
}
_COMMON = {
    **_TEMPERATURES,
    "time_unix_s": ("Spacecraft time", "s"),
    "v_cell_v": ("Battery cell voltage", "V"),
    "v_pack_v": ("Battery pack voltage", "V"),
    "temp_bat1_c": ("Battery 1 temperature", "°C"),
    "temp_bat2_c": ("Battery 2 temperature", "°C"),
}
_GEOSCAN = {
    **_COMMON,
    "ax25_control": ("AX.25 control", ""),
    "ax25_pid": ("AX.25 protocol identifier", ""),
    "mayak_id": ("Beacon identifier", ""),
    "eps_time_unix_s": ("Power system time", "s"),
    "eps_mode_enum": ("Power system mode", ""),
    "eps_current_platform_a": ("Platform current", "A"),
    "eps_current_solar_a": ("Solar current", "A"),
    "obc_activity": ("Onboard computer activity", ""),
    "gnss_sat_count": ("GNSS satellite count", ""),
    "camera_media_files_count": ("Camera media file count", ""),
    "vbus_v": ("Bus voltage", "V"),
    "rssi_last_dbm": ("Last received signal strength", "dBm"),
    "rssi_min_dbm": ("Minimum received signal strength", "dBm"),
    "tx_packets_count": ("Transmitted packet count", ""),
    "qso_received_count": ("Received QSO count", ""),
}
_RS52S = {
    **_COMMON,
    "battery_current_a": ("Battery current", "A"),
    "panel_current_a": ("Solar panel current", "A"),
    "reserved_16": ("Reserved byte 16", ""),
    "cpu_load_pct": ("CPU load", "%"),
    "obc_counter": ("Onboard computer counter", ""),
    "comm_counter": ("Communications counter", ""),
    "rssi_dbm": ("Received signal strength", "dBm"),
}
_UWE4 = {
    "api": ("Message type", ""),
    "packet_id": ("Packet identifier", ""),
    "payload_size": ("Payload size", "bytes"),
    "uptime_s": ("Uptime", "s"),
    "beacon_rate_s": ("Beacon interval", "s"),
    "power_consumption_mw": ("Power consumption", "mW"),
    "obc_temp_c": ("Onboard computer temperature", "°C"),
    "freq_khz": ("Downlink frequency", "kHz"),
    "message": ("Radio message", ""),
    **{
        f"batt_{battery}_{key}": (f"Battery {battery.upper()} {label}", unit)
        for battery in "ab"
        for key, label, unit in (
            ("temp_c", "temperature", "°C"),
            ("soc_pct", "state of charge", "%"),
            ("current_ma", "current", "mA"),
            ("voltage_v", "voltage", "V"),
        )
    },
    **{
        f"panel_{side}_{axis}_temp_c": (f"{sign}{axis.upper()} panel temperature", "°C")
        for axis in "xyz"
        for side, sign in (("pos", "+"), ("neg", "−"))
    },
}
_TIANQI = {
    "time_unix_s": ("Spacecraft time", "s"),
    "net_id": ("Network identifier", ""),
    "msg_type_id": ("Message type", ""),
    "sat_id": ("Fleet satellite identifier", ""),
}


def field_info(spec: str, values: dict[str, Any]) -> dict[str, dict[str, str]]:
    """Expose presentation metadata only for fields present in this packet."""
    labels = (
        _GEOSCAN
        if spec.startswith("geoscan_type1_")
        else {
            "rs52s": _RS52S,
            "uwe4": _UWE4,
            "tianqi": _TIANQI,
        }.get(spec, {})
    )
    return {
        key: {"label": labels[key][0], "unit": labels[key][1]} for key in values if key in labels
    }
