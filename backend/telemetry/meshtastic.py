# Copyright (c) 2026 Efstratios Goudelis
# SPDX-License-Identifier: GPL-3.0-or-later
"""Meshtastic radio headers and public-channel application payloads.

Wire definitions: https://github.com/meshtastic/protobufs/tree/master/meshtastic
AES nonce: https://github.com/meshtastic/firmware/blob/master/src/mesh/CryptoEngine.cpp
"""

import base64
import math
import struct
from typing import Any

from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from google.protobuf.message import DecodeError

from .parsers.gen import meshtastic as proto
from .parsers.presentation import readable_label
from .result import normalize_result

DEFAULT_KEY = base64.b64decode("1PG7OiApB1nwvP+rz05pAQ==")
PORTS = {
    1: "Text message",
    2: "Remote hardware",
    3: "Position",
    4: "Node info",
    5: "Routing",
    6: "Admin",
    7: "Compressed text",
    8: "Waypoint",
    9: "Audio",
    10: "Detection sensor",
    11: "Alert",
    12: "Key verification",
    13: "Remote shell",
    32: "Reply",
    33: "IP tunnel",
    34: "Paxcounter",
    35: "Store and forward++",
    36: "Node status",
    37: "Mesh beacon",
    38: "Paging",
    64: "Serial",
    65: "Store and forward",
    66: "Range test",
    67: "Telemetry",
    68: "ZPS",
    69: "Simulator",
    70: "Traceroute",
    71: "Neighbor info",
    72: "ATAK plugin",
    73: "Map report",
    74: "Power stress",
    75: "LoRaWAN bridge",
    76: "Reticulum tunnel",
    77: "Cayenne",
    78: "ATAK plugin v2",
    79: "LoRa OTA",
    112: "Group alarm",
    256: "Private application",
    257: "ATAK forwarder",
}
UNITS = {
    "latitude": "°",
    "longitude": "°",
    "altitude": "m",
    "altitude_hae": "m",
    "altitude_geoidal_separation": "m",
    "ground_speed": "km/h",
    "ground_track": "°",
    "battery_level": "%",
    "voltage": "V",
    "channel_utilization": "%",
    "air_util_tx": "%",
    "uptime_seconds": "s",
    "temperature": "°C",
    "relative_humidity": "%",
    "barometric_pressure": "hPa",
    "gas_resistance": "MΩ",
    "current": "mA",
    "distance": "mm",
    "lux": "lx",
    "white_lux": "lx",
    "ir_lux": "lx",
    "uv_lux": "lx",
    "wind_direction": "°",
    "wind_speed": "m/s",
    "wind_gust": "m/s",
    "wind_lull": "m/s",
    "weight": "kg",
    "radiation": "µR/h",
    "rainfall_1h": "mm",
    "rainfall_24h": "mm",
    "soil_moisture": "%",
    "soil_temperature": "°C",
    "co2": "ppm",
    "co2_temperature": "°C",
    "co2_humidity": "%",
    "form_temperature": "°C",
    "form_humidity": "%",
    "pm_temperature": "°C",
    "pm_humidity": "%",
    "lightning_distance_km": "km",
    "reported_time": "s",
    "position_timestamp": "s",
    "timestamp_millis_adjust": "ms",
    "gps_accuracy": "mm",
    "next_update": "s",
    "one_wire_temperature": "°C",
    "form_formaldehyde": "ppb",
    **{f"ch{i}_voltage": "V" for i in range(1, 9)},
    **{f"ch{i}_current": "mA" for i in range(1, 9)},
    **{f"adc_voltage_ch{i}": "V" for i in range(8)},
    **{f"one_wire_temperature_ch{i}": "°C" for i in range(8)},
}
LABELS = {
    "packet_id": "Packet ID",
    "channel_hash": "Channel hash",
    "want_ack": "Acknowledgment requested",
    "want_response": "Response requested",
    "via_mqtt": "Via MQTT",
    "hw_model": "Hardware model code",
    "role": "Device role code",
    "id": "Node ID",
    "sats_in_view": "Satellites in view",
    "air_util_tx": "Transmit airtime",
    "reported_time": "Reported Unix time",
    "position_timestamp": "Position Unix time",
    "ground_track": "Ground track",
    "PDOP": "PDOP",
    "HDOP": "HDOP",
    "VDOP": "VDOP",
}


def node_id(number: int) -> str:
    return "Broadcast" if number == 0xFFFFFFFF else f"!{number:08x}"


class MeshtasticParser:
    parser_id = "meshtastic"

    @staticmethod
    def _header(packet):
        if not 16 < len(packet) <= 255:
            raise ValueError(
                "Meshtastic packets require a 16-byte header and an application payload"
            )
        destination, source, packet_id, flags, channel, next_hop, relay = struct.unpack(
            "<IIIBBBB", packet[:16]
        )
        if source <= 3 or source == 0xFFFFFFFF or destination <= 3:
            raise ValueError("Invalid Meshtastic node address")
        return (
            {
                "source": node_id(source),
                "destination": node_id(destination),
                "packet_id": f"0x{packet_id:08x}",
                "channel_hash": f"0x{channel:02x}",
                "hop_limit": flags & 7,
                "hop_start": flags >> 5,
                "want_ack": bool(flags & 8),
                "via_mqtt": bool(flags & 16),
                "next_hop": f"0x{next_hop:02x}",
                "relay_node": f"0x{relay:02x}",
            },
            source,
            packet_id,
        )

    @staticmethod
    def _data(payload):
        try:
            message = proto.Data.FromString(payload)
        except DecodeError:
            return None
        # A radio header has no magic marker, and AES-CTR is not authenticated.
        # Require a recognized application envelope before accepting a trial key.
        if message.portnum not in PORTS or len(message.payload) > 237:
            return None
        return message

    def parse(self, packet: bytes, *, expected: bool = False) -> dict[str, Any] | None:
        try:
            header, source, packet_id = self._header(packet)
        except ValueError as exc:
            if not expected:
                return None
            return self._result(packet, {}, {}, "malformed", str(exc))

        body = packet[16:]
        application = self._data(body)
        encryption = "Unencrypted"
        if application is None:
            # Firmware stores packet ID in eight little-endian bytes, followed
            # by the sender and a four-byte counter initially set to zero.
            nonce = struct.pack("<QII", packet_id, source, 0)
            decryptor = Cipher(algorithms.AES(DEFAULT_KEY), modes.CTR(nonce)).decryptor()
            application = self._data(decryptor.update(body) + decryptor.finalize())
            encryption = "Public default key" if application is not None else "Encrypted"
        if application is None and not expected:
            # Unidentified LoRa satellite payloads must remain opaque.
            return None

        header["encryption"] = encryption
        values = dict(header)
        telemetry: dict[str, Any] = {
            "format": "meshtastic",
            "name": "Meshtastic",
            "source": header["source"],
            "destination": header["destination"],
            "length": len(packet),
            "values": values,
            "field_info": {
                key: {"label": LABELS.get(key, readable_label(key)), "group": "mesh"}
                for key in values
            },
        }
        if application is None:
            telemetry["warning"] = (
                "Encrypted payload; the public default channel key could not decode it."
            )
            return self._result(packet, header, telemetry, "unsupported")

        header["portnum"] = application.portnum
        header["application"] = PORTS[application.portnum]
        self._add(telemetry, "application", PORTS[application.portnum], "mesh")
        self._add(telemetry, "want_response", application.want_response, "mesh")
        telemetry["name"] = f"Meshtastic {PORTS[application.portnum]}"
        telemetry["raw_fields"] = {
            "application_payload_hex": application.payload.hex(),
            "request_id": application.request_id,
            "reply_id": application.reply_id,
        }
        try:
            status = self._application(application.portnum, application.payload, telemetry)
        except (DecodeError, ValueError, UnicodeError) as exc:
            return self._result(packet, header, telemetry, "malformed", str(exc))
        return self._result(packet, header, telemetry, status)

    @staticmethod
    def _add(telemetry, key, value, group, unit=None):
        measurements = value if isinstance(value, list) else [value]
        if any(isinstance(item, float) and not math.isfinite(item) for item in measurements):
            raise ValueError(f"Invalid Meshtastic measurement: {key}")
        telemetry["values"][key] = value
        telemetry["field_info"][key] = {
            "label": LABELS.get(key, readable_label(key)),
            "unit": UNITS.get(key, "") if unit is None else unit,
            "group": group,
        }

    def _application(self, port, payload, telemetry):
        if port in (1, 10, 11, 66):
            self._add(telemetry, "message", payload.decode("utf-8"), "message")
        elif port == 3:
            self._position(payload, telemetry)
        elif port == 4:
            user = proto.User.FromString(payload)
            if not user.ListFields():
                raise ValueError("Empty Meshtastic node information")
            for field, value in user.ListFields():
                self._add(
                    telemetry,
                    field.name,
                    value.hex() if isinstance(value, bytes) else value,
                    "node",
                )
        elif port == 67:
            message = proto.Telemetry.FromString(payload)
            if message.time:
                self._add(telemetry, "reported_time", message.time, "device")
            variant = message.WhichOneof("variant")
            if variant is None:
                telemetry["warning"] = "This telemetry variant is not supported yet."
                return "unsupported"
            metrics = getattr(message, variant)
            self._add(telemetry, "telemetry_type", readable_label(variant), "mesh")
            for field, value in metrics.ListFields():
                # Values above 100 are the firmware's external-power sentinel,
                # not a percentage. Preserve that code alongside the payload.
                if field.name == "battery_level" and value > 100:
                    telemetry["raw_fields"]["battery_level_raw"] = value
                    self._add(telemetry, "power_source", "External power", variant)
                    continue
                if field.is_repeated:
                    value = list(value)
                unit = (
                    "µg/m³"
                    if field.name.startswith("pm")
                    and field.name.endswith(("standard", "environmental"))
                    else None
                )
                self._add(telemetry, field.name, value, variant, unit)
        else:
            telemetry["warning"] = f"{PORTS[port]} payload is not supported yet."
            return "unsupported"
        return "decoded"

    def _position(self, payload, telemetry):
        message = proto.Position.FromString(payload)
        if not message.ListFields():
            raise ValueError("Empty Meshtastic position")
        position = {}
        for field, value in message.ListFields():
            key = field.name
            if key in ("latitude_i", "longitude_i"):
                key = key.removesuffix("_i")
                value /= 10000000
                if abs(value) > (90 if key == "latitude" else 180):
                    raise ValueError(f"Invalid Meshtastic {key}")
                position[key] = value
            elif key in ("PDOP", "HDOP", "VDOP"):
                value /= 100
            elif key == "ground_track":
                # GPS.cpp transmits degrees * 1e5; the upstream proto comment
                # still describes an older scale. Never invent a valid bearing.
                value /= 100000
                if not 0 <= value < 360:
                    telemetry["raw_fields"]["ground_track_raw"] = message.ground_track
                    telemetry["warning"] = "Invalid ground track omitted; position is retained."
                    continue
            elif key in ("time", "timestamp"):
                key = "reported_time" if key == "time" else "position_timestamp"
            self._add(telemetry, key, value, "position")
        if "latitude" in position and "longitude" in position:
            if message.HasField("altitude"):
                position["altitude_meters"] = message.altitude
            if message.HasField("ground_speed"):
                position["speed_kmh"] = message.ground_speed
            if message.HasField("ground_track") and message.ground_track < 36000000:
                position["course_degrees"] = message.ground_track / 100000
            telemetry["position"] = position

    @staticmethod
    def _result(packet, header, telemetry, status, error=None) -> dict[str, Any]:
        # Record and packet statuses must agree, including header-only results.
        telemetry["status"] = status
        diagnostics = []
        if error:
            telemetry["error"] = error
            diagnostics.append({"stage": "payload", "code": "meshtastic_payload", "message": error})
        return normalize_result(
            {
                "protocol": "lora",
                "parser": "lora+Meshtastic",
                "parser_id": "meshtastic",
                "success": status != "malformed",
                "envelope_status": "parsed" if header else "malformed",
                "headers": {"meshtastic": header},
                "payload_status": status,
                "diagnostics": diagnostics,
                "telemetry": telemetry,
                "raw": {
                    "packet_hex": packet.hex(),
                    "payload_hex": packet[16:].hex(),
                    "payload_length": max(0, len(packet) - 16),
                },
            },
            "meshtastic",
        )
