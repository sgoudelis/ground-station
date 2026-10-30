"""Generate shared Python/React contract fixtures.

Run from backend: ALEMBIC_CONTEXT=1 ./venv/bin/python -m tests.viewerfixtures
"""

import json
import struct
from pathlib import Path

from telemetry.compatibility import normalize_metadata
from telemetry.context import ParseContext
from telemetry.service import parse_packet

FIXTURES = Path(__file__).parent / "fixtures"


def captures(name):
    return json.loads((FIXTURES / f"{name}.json").read_text())


def legacy_cases():
    """Historical shapes and edge cases, without a second JS interpretation."""
    return {
        "housekeeping": {
            "parser": "proprietary+GeoscanParser",
            "telemetry": {
                "values": {
                    "mayak_id": {"value": 1, "unit": None},
                    "eps_time_unix_s": {"value": 1768248238},
                    "eps_mode_enum": {"value": 3},
                    "eps_reserve_22": {"value": 255},
                    "eps_current_platform_a": {"value": 0.222, "unit": "A"},
                    "eps_current_solar_a": {"value": 0, "unit": "A"},
                    "v_cell_v": {"value": 4.142},
                    "v_pack_v": {"value": 8.203},
                    "temp_bat1_c": {"value": 13},
                    "temp_bat2_c": {"value": 12},
                }
            },
        },
        "unavailable": {
            "telemetry": {
                "spec": "uwe4",
                "values": {
                    "batt_a_voltage_v": {"value": 4.2, "unit": "legacy unit"},
                    "batt_a_current_ma": {"error": "Sensor unavailable"},
                    "batt_b_current_ma": -171,
                    "batt_b_soc_pct": 0,
                    "batt_b_voltage_v": None,
                    "panel_pos_x_temp_c": 0,
                    "panel_neg_x_temp_c": float("nan"),
                    "custom_count": 12,
                },
                "field_info": {
                    "batt_a_voltage_v": {"label": "Measured battery voltage", "unit": "V"}
                },
            }
        },
        "colibri": {
            "telemetry": {
                "satellite": "COLIBRI-S",
                "values": {
                    "v_pack_v": 8,
                    "eps_mode_enum": 3,
                    "obc_activity": {"wheels": False, "camera": True},
                    "gnss_sat_count": 5,
                },
            }
        },
        "custom": {
            "telemetry": {
                "spec": "uwe4",
                "values": {
                    "batt_a_voltage_v": 4.2,
                    "batt_a_current_ma": 138,
                    "new_sensor_raw": 0,
                },
                "field_info": {
                    "batt_a_voltage_v": {
                        "label": "Pack voltage",
                        "unit": "V",
                        "group": "custom_sensors",
                        "order": 20,
                    },
                    "batt_a_current_ma": {
                        "label": "Pack current",
                        "unit": "mA",
                        "group": "custom_sensors",
                        "order": 10,
                    },
                    "new_sensor_raw": {
                        "label": "New sensor",
                        "group": "custom_sensors",
                        "order": 0,
                        "calibrated": False,
                    },
                },
            }
        },
        "rs52s": {
            "telemetry": {
                "spec": "rs52s",
                "values": {
                    "battery_current_a": -0.125,
                    "panel_current_a": 1.5,
                    "v_pack_v": 4.1,
                    "cpu_load_pct": 25,
                    "comm_counter": 12,
                    "reserved_16": 255,
                },
            }
        },
        "clock": {"telemetry": {"values": {}, "time_utc": "2023-11-14 22:13:20"}},
        "epoch": {"telemetry": {"values": {"eps_time_unix_s": {"value": 0}}}},
        "text": {
            "telemetry": {
                "satellite": "LASARSAT",
                "format": "text",
                "text": "Greetings from LASARSAT",
            }
        },
        "malformed": {
            "telemetry": {
                "satellite": "LASARSAT",
                "format": "malformed",
                "type": "PSU",
                "error": "Expected 11 PSU fields, received 3",
            }
        },
        "warning": {
            "parser": "proprietary+GeoscanParser",
            "telemetry": {"format": "geoscan", "warning": "GEOSCAN image packet detected."},
        },
        "messages": {
            "telemetry": {
                "format": "usp",
                "messages": [
                    {
                        "message_id": "0x4246",
                        "name": "UHF radio beacon",
                        "source": 2,
                        "destination": 1,
                        "length": 25,
                        "status": "decoded",
                        "values": {"temperature": -5, "current": 0},
                        "field_info": {
                            "temperature": {"label": "Amplifier temperature", "unit": "°C"},
                            "current": {"label": "Radio current", "unit": "mA"},
                        },
                        "raw_fields": {"temperature": -5},
                    },
                    {
                        "message_id": "0xDE21",
                        "name": "Power system telemetry",
                        "source": 4,
                        "destination": 1,
                        "length": 46,
                        "status": "decoded",
                        "values": {
                            "battery_voltage": 7.976,
                            "battery_temperature": 4.75,
                            "heater": False,
                        },
                        "field_info": {
                            "battery_voltage": {"label": "Battery voltage", "unit": "V"},
                            "battery_temperature": {"label": "Battery temperature 1", "unit": "°C"},
                            "heater": {"label": "Battery heater 1 on"},
                        },
                        "raw_fields": {"battery_voltage": 7976},
                    },
                    {"status": "non_telemetry", "name": "File transfer data"},
                    {"status": "unsupported", "name": "Unknown USP message"},
                    {
                        "status": "malformed",
                        "name": "Broken message",
                        "error": "Truncated USP message",
                    },
                ],
            }
        },
    }


def viewer_fixtures():
    real = {}

    def add(name, packet, context):
        real[name] = {
            "packet": {"hex": packet.hex()},
            "parse_context": context.to_dict(),
            "telemetry": parse_packet(packet, context),
        }

    add(
        "geoscan",
        bytes.fromhex(captures("geoscan6")["full_a"]["payload_hex"]),
        ParseContext("proprietary", framing="geoscan", satellite="GEOSCAN-6", frame_size=74),
    )
    add(
        "uwe4",
        bytes.fromhex(captures("uwe4")["beacon_1"]["packet_hex"]),
        ParseContext("ax25", framing="ax25", hdlc_flags=True),
    )
    add(
        "umka",
        bytes.fromhex(captures("umka")["night"]["packet_hex"]),
        ParseContext("ax25", framing="usp", hdlc_flags=True),
    )
    add(
        "tianqi",
        bytes.fromhex(next(iter(captures("tianqi").values()))["packet_hex"]),
        ParseContext("lora", framing="lora", satellite="Tianqi-39"),
    )
    for index, capture in enumerate(captures("lasarsat")):
        add(
            f"lasarsat{index}",
            bytes.fromhex(capture["binary_hex"]),
            ParseContext.from_metadata(capture["metadata"]),
        )
    # Synthetic RS52S is pinned against the handwritten parser by testkaitai.py.
    body = struct.pack(
        "<I H H H H 4b B 3b b h h b",
        1761234567,
        175,
        40,
        50000,
        20000,
        21,
        19,
        22,
        20,
        0,
        18,
        25,
        26,
        64,
        8000,
        2000,
        -30,
    )
    add("rs52s", bytes.fromhex("86a24040404060a4a66a64a6406103f0") + body, ParseContext("ax25"))
    legacy = {
        name: normalize_metadata({"telemetry": result}) for name, result in legacy_cases().items()
    }
    legacy["aprs"] = normalize_metadata(
        {
            "decoder": {"type": "aprs"},
            "telemetry": {"telemetry": {"format": "raw", "ascii": "!L9y@)T<7Ca  GLoRa APRS|&:%X|"}},
        }
    )
    # UI fixtures deliberately exclude the retained compatibility map.
    for metadata in [*real.values(), *legacy.values()]:
        metadata["telemetry"].pop("telemetry", None)
    return {"real": real, "legacy": legacy}


if __name__ == "__main__":
    (FIXTURES / "viewer.json").write_text(
        json.dumps(viewer_fixtures(), indent=2, allow_nan=False) + "\n"
    )
