"""Adapt RS reports to the common telemetry schema without losing calibration."""

from binascii import crc_hqx
from typing import Any

from .result import json_safe


class RadiosondeParser:
    parser_id = "radiosonde_rs"
    legacy_name = "Radiosonde"

    # RS field names are preserved so the original report remains recognizable.
    FIELDS = {
        "type": ("Sonde type", ""),
        "subtype": ("Sonde model", ""),
        "id": ("Sonde serial number", ""),
        "frame": ("Frame number", ""),
        "datetime": ("Sonde time", ""),
        "ref_datetime": ("Time reference", ""),
        "ref_position": ("Altitude reference", ""),
        "lat": ("Latitude", "°"),
        "lon": ("Longitude", "°"),
        "alt": ("Altitude", "m"),
        "vel_h": ("Horizontal speed", "m/s"),
        "vel_v": ("Vertical speed", "m/s"),
        "heading": ("Heading", "°"),
        "sats": ("GPS satellites", ""),
        "temp": ("Temperature", "°C"),
        "humidity": ("Relative humidity", "%"),
        "pressure": ("Pressure", "hPa"),
        "batt": ("Battery voltage", "V"),
        "bt": ("Burst timer", "s"),
        "freq": ("Transmitter frequency", "kHz"),
        "tx_frequency": ("Reported transmitter frequency", "kHz"),
        "encrypted": ("Encrypted payload", ""),
        "rawid": ("Raw serial number", ""),
        "aprsid": ("APRS identifier", ""),
        "gpsutc_leapsec": ("GPS minus UTC", "s"),
        "diff_GPS_MSL": ("GPS minus MSL altitude", "m"),
    }

    @staticmethod
    def _validate_frame(payload, report):
        family = report["type"]
        if family == "RS41":
            if len(payload) not in (320, 518) or payload[:8] != bytes.fromhex("8635f44093df1a60"):
                raise ValueError("Invalid RS41 frame")
            # Newer firmware can put a 0x960A block before the 0x7928 status
            # block. Follow length-delimited blocks, as RS does, rather than
            # reading identity at offsets that only fit the older layout.
            position = 0x39
            while position + 4 <= len(payload):
                length = payload[position + 1]
                end = position + length + 4  # Type, length, data, little-endian CRC.
                if end > len(payload):
                    raise ValueError(f"Invalid RS41 block length at 0x{position:03x}")
                data = payload[position + 2 : end - 2]
                checksum = int.from_bytes(payload[end - 2 : end], "little")
                if crc_hqx(data, 0xFFFF) != checksum:
                    raise ValueError(f"Invalid RS41 block checksum at 0x{position:03x}")
                if payload[position] == 0x79:
                    if length != 0x28:
                        raise ValueError("Invalid RS41 status block length")
                    break
                position = end
            else:
                raise ValueError("Missing RS41 status block")
            # Pairing a report with a neighbouring frame would silently corrupt files.
            serial = data[2:10].decode("ascii", errors="replace")
            number = int.from_bytes(data[:2], "little")
            if report["id"] != serial or report["frame"] != number:
                raise ValueError(
                    "RS decoder report does not match the recorded frame "
                    f"(report id={report['id']!r}, frame={report['frame']}; "
                    f"recorded id={serial!r}, frame={number})"
                )
        elif family == "DFM":
            # RS assembles DFM navigation and identity across several frames.
            # This is the last encoded radio frame, not an independent GPS fix;
            # the saved report retains that accumulated state for reparsing.
            if len(payload) != 33:
                raise ValueError("Invalid DFM frame")
        else:
            minimum, maximum = (68, 134) if family == "M20" else (101, 165)
            if not minimum <= len(payload) <= maximum or payload[0] + 1 != len(payload):
                raise ValueError("Invalid M10/M20 frame length")
            expected = {"M10": {0x8F, 0x9F, 0xAF}, "M20": {0x20}}[family]
            if payload[1] not in expected:
                raise ValueError("M10/M20 report type does not match frame")
            # Same checksum used by upstream checkM10 (not a standard CRC-16).
            checksum = 0
            for byte in payload[:-2]:
                byte = (byte >> 1) | ((byte & 1) << 7)
                byte ^= byte >> 2
                t6 = (checksum ^ (checksum >> 2) ^ (checksum >> 4)) & 1
                t7 = ((checksum >> 1) ^ (checksum >> 3) ^ (checksum >> 5)) & 1
                t = (checksum & 0x3F) | (t6 << 6) | (t7 << 7)
                high = (checksum >> 7) & 0xFF
                high ^= high >> 2
                checksum = (((checksum & 0xFF) << 8) | (byte ^ t ^ high)) & 0xFFFF
            if int.from_bytes(payload[-2:], "big") != checksum:
                raise ValueError("Invalid M10/M20 checksum")
            offset, length = (0x12, 3) if family == "M20" else (0x5D, 5)
            rawid = f"{family}_{payload[offset:offset + length].hex().upper()}"
            if report.get("rawid") != rawid:
                raise ValueError("M10/M20 report serial does not match frame")

    def parse(self, payload: bytes, report: dict[str, Any] | None = None):
        if not isinstance(report, dict) or report.get("type") not in ("RS41", "DFM", "M10", "M20"):
            raise ValueError("Radiosonde parsing requires the saved RS decoder report")
        if (
            not isinstance(report.get("id"), str)
            or not report["id"]
            or type(report.get("frame")) is not int
            or report["frame"] < 0
        ):
            raise ValueError("Invalid radiosonde report identity")
        self._validate_frame(payload, report)

        report = json_safe(report)
        values = {key: report[key] for key in self.FIELDS if report.get(key) is not None}
        if report.get("encrypted"):
            # RS emits placeholder navigation numbers for encrypted RS41-SGM.
            for key in ("datetime", "lat", "lon", "alt", "vel_h", "vel_v", "heading", "sats"):
                values.pop(key, None)
        return {
            "format": "radiosonde",
            "name": f"{report['type']} {report['id']}",
            "values": values,
            "field_info": {
                key: {"label": self.FIELDS[key][0], "unit": self.FIELDS[key][1]} for key in values
            },
            "raw_fields": {key: value for key, value in report.items() if key not in self.FIELDS},
        }
