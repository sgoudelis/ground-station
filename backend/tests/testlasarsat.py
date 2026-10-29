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

"""Captured OK0LSR frames and LASARSAT beacon validation."""

import pytest

from telemetry.parser import TelemetryParser
from telemetry.parsers.lasarsat import LasarsatAx25Parser

pytestmark = pytest.mark.unit

# AX.25 UI frames captured on rfbox5 on 2026-10-26. The recorder stores one
# HDLC flag at either end; BaseDecoder removes them before telemetry parsing.
CAPTURES = {
    "SOL": "7e86a240404040609e966098a6a46103f0534f4c2c313631322c313532352c333135302c323438312c323531322c313430302c3133362c3133342c3133352c3133342c3133362c313334007e",
    "PSU": "7e86a240404040609e966098a6a46103f05053552c342c33393532343636302c35383235393338382c383134382c323330322c313736382c312c38382c37632c312c3935007e",
    "OBC": "7e86a240404040609e966098a6a46103f04f42432c3231312c323336353031322c35383234383839322c323036342c37373538007e",
    "U": "7e86a240404040609e966098a6a46103f0552c33393531373839382c35383234383238382c342c312c323834342c323837362c333038372c313931302c444c374e44522c35313835362c343135313431392c38312c3937007e",
    "MGS": "7e86a240404040609e966098a6a46103f04d47532c313836302c323237352c31333133322c2d363734392c333930352c3133362c3234392c2d3730007e",
}


@pytest.mark.parametrize("kind", CAPTURES)
def test_captured_lasarsat_frames_route_to_payload_parser(kind):
    frame = bytes.fromhex(CAPTURES[kind])[1:-1]
    result = TelemetryParser().parse(frame, protocol_hint="ax25")

    assert result["success"] is True
    assert result["parser"] == "ax25+LasarsatAx25Parser"
    assert result["frame"]["source"] == "OK0LSR-0"
    assert result["frame"]["destination"] == "CQ-0"
    assert result["telemetry"]["format"] == "beacon"
    assert result["telemetry"]["type"] == kind


def test_captured_psu_has_hex_channel_bits_and_unscaled_values():
    frame = bytes.fromhex(CAPTURES["PSU"])[1:-1]
    telemetry = TelemetryParser().parse(frame, protocol_hint="ax25")["telemetry"]
    values = telemetry["values"]

    assert values["psu_battery"] == 8148
    assert values["psu_temp_sys"] == 2302
    assert "psu_ch_state_num" not in values
    assert telemetry["raw_fields"]["psu_ch_state_num"] == "7c"
    assert [values[f"psu_ch{i}_state"] for i in range(7)] == [
        False,
        False,
        True,
        True,
        True,
        True,
        True,
    ]
    info = telemetry["field_info"]
    assert info["psu_battery"] == {
        "label": "Battery reading",
        "unit": "",
        "group": "power",
        "order": 3,
        "calibrated": False,
    }
    assert info["psu_temp_sys"]["group"] == "temperatures"
    assert info["psu_ch2_state"]["label"] == "Channel 2 enabled"
    assert info["psu_ch2_state"]["group"] == "channels"
    assert "calibrated" not in info["psu_ch2_state"]
    assert "calibrated" not in info["psu_reset_cnt"]


def test_captured_other_fields_are_signed_and_named():
    mgs = bytes.fromhex(CAPTURES["MGS"])[1:-1]
    sol = bytes.fromhex(CAPTURES["SOL"])[1:-1]
    radio = bytes.fromhex(CAPTURES["U"])[1:-1]
    parser = TelemetryParser()

    assert parser.parse(mgs, protocol_hint="ax25")["telemetry"]["values"]["mgs_int_mag_y"] == -6749
    assert parser.parse(sol, protocol_hint="ax25")["telemetry"]["values"]["sol_temp_zp"] == 1612
    assert (
        parser.parse(radio, protocol_hint="ax25")["telemetry"]["values"]["uhf_last_digipeater"]
        == "DL7NDR"
    )


def test_missing_solar_value_is_null_and_malformed_beacons_have_no_measurements():
    parser = LasarsatAx25Parser()
    solar = parser.parse(b"SOL,nan,1,2,3,4,5,6,7,8,9,10,11\x00")
    assert solar["values"]["sol_temp_zp"] is None
    assert solar["raw_fields"]["sol_temp_zp"] == "nan"
    assert solar["field_info"]["sol_temp_zp"]["calibrated"] is False

    for payload in (b"PSU,4,1,2\x00", b"OBC,1,2,bad,4,5\x00", b"MGS,1,2,3,4,5,6,7,8\x00extra"):
        result = parser.parse(payload)
        assert result["format"] == "malformed"
        assert "values" not in result


@pytest.mark.parametrize("kind", CAPTURES)
def test_captured_beacons_supply_complete_display_metadata_and_original_csv(kind):
    telemetry = TelemetryParser().parse(bytes.fromhex(CAPTURES[kind])[1:-1], protocol_hint="ax25")[
        "telemetry"
    ]
    assert telemetry["text"].startswith(kind + ",")
    assert "\x00" not in telemetry["text"]
    assert telemetry["field_info"].keys() == telemetry["values"].keys()
    orders = []
    for info in telemetry["field_info"].values():
        assert info["label"]
        assert info["group"]
        assert info["unit"] == ""  # No physical conversions have been verified.
        orders.append(info["order"])
    assert len(orders) == len(set(orders))


def test_solar_wire_order_and_raw_tokens_survive_normalization():
    beacon = "SOL,nan,+000,-12,3,4,5,6,7,8,9,10,11"
    result = LasarsatAx25Parser().parse(beacon.encode("ascii") + b"\x00")
    assert result["text"] == beacon
    assert result["values"] == {
        "sol_temp_zp": None,
        "sol_temp_xp": 0,
        "sol_temp_yp": -12,
        "sol_temp_zn": 3,
        "sol_temp_xn": 4,
        "sol_temp_yn": 5,
        "sol_diode_zp": 6,
        "sol_diode_xp": 7,
        "sol_diode_yp": 8,
        "sol_diode_zn": 9,
        "sol_diode_xn": 10,
        "sol_diode_yn": 11,
    }
    assert result["raw_fields"]["sol_temp_xp"] == "+000"
    assert result["raw_fields"]["sol_temp_yp"] == "-12"
    assert result["field_info"]["sol_diode_xn"]["label"] == "−X diode reading"
    assert result["field_info"]["sol_diode_xn"]["group"] == "diodes"


@pytest.mark.parametrize(
    "beacon, expected, groups",
    [
        (
            "DOS,3,-1,0,2,-3,4,5,6,7,8,-9,10,11,12,13,14",
            {
                "dos_mode": 3,
                "dos_gyr_x": -1,
                "dos_gyr_y": 0,
                "dos_gyr_z": 2,
                "dos_mag_x": -3,
                "dos_mag_y": 4,
                "dos_mag_z": 5,
                "dos_plasma": 6,
                "dos_phd": 7,
                "dos_dozi": 8,
                "dos_gyr_t": -9,
                "dos_mag_t": 10,
                "dos_lppa": 11,
                "dos_bus_cur": 12,
                "dos_bus_vol": 13,
                "dos_uptime": 14,
            },
            {"payload", "gyroscope", "magnetometer", "temperatures", "power"},
        ),
        (
            "NAV,2410,123456,-10,0,30,-4,5,0,8,9,10,11,12",
            {
                "nav_week": 2410,
                "nav_time": 123456,
                "nav_pos_x": -10,
                "nav_pos_y": 0,
                "nav_pos_z": 30,
                "nav_vel_x": -4,
                "nav_vel_y": 5,
                "nav_vel_z": 0,
                "nav_sats": 8,
                "nav_dop": 9,
                "nav_ant_cur": 10,
                "nav_volt": 11,
                "nav_max_snr": 12,
            },
            {"navigation", "position", "velocity"},
        ),
        (
            "V,1,2,3,4,-5,6,7,8,OK1TEST,9,10,0,11",
            {
                "vhf_uptime": 1,
                "vhf_uptime_tot": 2,
                "vhf_reset_cnt": 3,
                "vhf_rf_reset_cnt": 4,
                "vhf_trx_temp": -5,
                "vhf_rf_temp": 6,
                "vhf_pa_temp": 7,
                "vhf_digipeater_cnt": 8,
                "vhf_last_digipeater": "OK1TEST",
                "vhf_rx_cnt": 9,
                "vhf_tx_cnt": 10,
                "vhf_act_rssi_raw": 0,
                "vhf_dcd_rssi_raw": 11,
            },
            {"communications", "temperatures"},
        ),
    ],
)
def test_other_beacon_types_have_correct_column_mapping_and_display_groups(
    beacon, expected, groups
):
    result = LasarsatAx25Parser().parse(beacon.encode("ascii"))
    assert result["format"] == "beacon"
    assert result["values"] == expected
    assert result["field_info"].keys() == expected.keys()
    assert {info["group"] for info in result["field_info"].values()} == groups
    assert "time_unix_s" not in result


@pytest.mark.parametrize(
    "beacon",
    [
        b"PSU,4,1,2,8148,2302,1768,1,88,nothex,1,95\x00",
        b"OBC,1,2,3,nan,5\x00",
        b"SOL,1,2,3,4,5,6,7,8,9,10,11,bad\x00",
        b"NAV,1,2,3,4,5,6,7,8,9,10,11,12\x00",
    ],
)
def test_invalid_beacons_never_publish_partial_values_or_metadata(beacon):
    result = LasarsatAx25Parser().parse(beacon)
    assert result["format"] == "malformed"
    assert "values" not in result
    assert "field_info" not in result
    assert "raw_fields" not in result
    assert result["text"] == beacon.removesuffix(b"\x00").decode("ascii")


def test_unknown_text_and_non_ascii_payloads_keep_their_fallbacks():
    parser = LasarsatAx25Parser()
    assert parser.parse(b"Hello from LASARSAT\x00")["text"] == "Hello from LASARSAT"
    result = parser.parse(b"\xff\x00")
    assert result["format"] == "raw"
    assert result["hex"] == "ff00"
    assert "values" not in result
