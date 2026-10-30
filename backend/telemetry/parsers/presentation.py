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


# Shared display defaults also normalize metadata recorded before field_info.
HOUSEKEEPING_FIELDS = {
    "v_pack_v": ("Battery pack voltage", "V", "power"),
    "v_cell_v": ("Battery cell voltage", "V", "power"),
    "vbus_v": ("Bus voltage", "V", "power"),
    "eps_current_platform_a": ("Platform current", "A", "power"),
    "eps_current_solar_a": ("Solar current", "A", "power"),
    "battery_current_a": ("Battery current", "A", "power"),
    "panel_current_a": ("Solar panel current", "A", "power"),
    "temp_bat1_c": ("Battery 1 temperature", "°C", "power"),
    "temp_bat2_c": ("Battery 2 temperature", "°C", "power"),
    "eps_mode_enum": ("Operating mode", "", "power"),
    "cpu_load_pct": ("CPU load", "%", "obc"),
    "obc_counter": ("Onboard computer counter", "", "obc"),
    "obc_activity": ("Onboard computer activity", "", "obc"),
    "obc_activity_raw": ("Onboard computer activity", "", "obc"),
    "gnss_sat_count": ("GNSS satellite count", "", "obc"),
    "camera_media_files_count": ("Camera media file count", "", "obc"),
    "comm_counter": ("Communications counter", "", "communications"),
    "rssi_dbm": ("Received signal strength", "dBm", "communications"),
    "rssi_last_dbm": ("Last received signal strength", "dBm", "communications"),
    "rssi_min_dbm": ("Minimum received signal strength", "dBm", "communications"),
    "tx_packets_count": ("Transmitted packet count", "", "communications"),
    "qso_received_count": ("Received QSO count", "", "communications"),
    "uptime_s": ("Uptime", "s", "status"),
    "power_consumption_mw": ("Power consumption", "mW", "status"),
    "obc_temp_c": ("Onboard computer temperature", "°C", "status"),
    "beacon_rate_s": ("Beacon interval", "s", "communications"),
    "freq_khz": ("Downlink frequency", "kHz", "communications"),
    "message": ("Radio message", "", "communications"),
    "temp_x_p_c": ("+X panel temperature", "°C", "obc"),
    "temp_x_n_c": ("−X panel temperature", "°C", "obc"),
    "temp_y_p_c": ("+Y panel temperature", "°C", "obc"),
    "temp_y_n_c": ("−Y panel temperature", "°C", "obc"),
    "temp_z_p_c": ("+Z panel temperature", "°C", "obc"),
    "temp_z_n_c": ("−Z panel temperature", "°C", "obc"),
    "batt_a_voltage_v": ("Battery A voltage", "V", "battery_a"),
    "batt_a_current_ma": ("Battery A current", "mA", "battery_a"),
    "batt_a_soc_pct": ("Battery A state of charge", "%", "battery_a"),
    "batt_a_temp_c": ("Battery A temperature", "°C", "battery_a"),
    "batt_b_voltage_v": ("Battery B voltage", "V", "battery_b"),
    "batt_b_current_ma": ("Battery B current", "mA", "battery_b"),
    "batt_b_soc_pct": ("Battery B state of charge", "%", "battery_b"),
    "batt_b_temp_c": ("Battery B temperature", "°C", "battery_b"),
    "panel_pos_x_temp_c": ("+X panel temperature", "°C", "panels"),
    "panel_neg_x_temp_c": ("−X panel temperature", "°C", "panels"),
    "panel_pos_y_temp_c": ("+Y panel temperature", "°C", "panels"),
    "panel_neg_y_temp_c": ("−Y panel temperature", "°C", "panels"),
    "panel_pos_z_temp_c": ("+Z panel temperature", "°C", "panels"),
    "panel_neg_z_temp_c": ("−Z panel temperature", "°C", "panels"),
}

GROUP_TITLES = {
    "battery_a": "Battery A",
    "battery_b": "Battery B",
    "status": "Satellite status",
    "panels": "Panel temperatures",
    "power": "Power system",
    "obc": "Onboard computer",
    "temperatures": "Temperatures",
    "channels": "Output channels",
    "communications": "Communications",
    "diodes": "Diode readings",
    "magnetometer": "Magnetometer",
    "gyroscope": "Gyroscope",
    "payload": "Payload",
    "navigation": "Navigation status",
    "position": "Position",
    "velocity": "Velocity",
    "other": "Other telemetry",
    "values": "Engineering Values",
}
ACTIVITY_LABELS = {
    "wheels": "Reaction wheels",
    "coils": "Magnetic coils",
    "ins": "Inertial navigation",
    "camera": "Camera",
    "panel_x_p": "+X panel",
    "panel_x_n": "−X panel",
    "panel_y_p": "+Y panel",
    "panel_y_n": "−Y panel",
}


def readable_label(key: str) -> str:
    return key.replace("_", " ").capitalize()
