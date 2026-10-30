"""Parser for the APRS information field carried inside AX.25 UI frames."""

import re
from typing import Any, Callable, Dict, Optional, Tuple


class APRSParser:
    """Decode common APRS 1.x packet types into UI-friendly structured data."""

    parser_id = "aprs"
    legacy_name = "aprs"

    DATA_TYPES = {
        "!": "position_without_timestamp",
        "=": "position_without_timestamp_with_messaging",
        "/": "position_with_timestamp",
        "@": "position_with_timestamp_with_messaging",
        ";": "object",
        ")": "item",
        ":": "message",
        ">": "status",
        "T": "telemetry",
        "_": "weather",
        "?": "query",
        "<": "station_capabilities",
        "{": "user_defined",
        "}": "third_party",
        "`": "mic_e",
        "'": "mic_e_old",
    }

    _UNCOMPRESSED_POSITION = re.compile(
        r"^(?P<lat>\d{2}[0-9 ]{2}\.[0-9 ]{2}[NS])(?P<table>.)(?P<lon>\d{3}[0-9 ]{2}\.[0-9 ]{2}[EW])(?P<symbol>.)"
    )
    _BASE91_TELEMETRY = re.compile(r"\|([!-\{]{4,14})\|")
    _ALTITUDE = re.compile(r"/A=(\d{6})")
    _COURSE_SPEED = re.compile(r"^(\d{3})/(\d{3})")
    _PHG = re.compile(r"PHG([0-9A-Z]{4})")

    @classmethod
    def parse(cls, payload: bytes, destination: Optional[str] = None) -> Dict[str, Any]:
        """Parse one APRS information field without treating text as binary telemetry."""
        text = payload.decode("utf-8", errors="replace")
        result: Dict[str, Any] = {
            "format": "aprs",
            "raw": text,
            "hex": payload.hex(),
            "length": len(payload),
            "values": {},
        }
        if not text:
            result.update({"data_type": "empty", "supported": False})
            return result

        identifier = text[0]
        result["data_type_identifier"] = identifier
        result["data_type"] = cls.DATA_TYPES.get(identifier, "unknown")
        result["supported"] = identifier in cls.DATA_TYPES

        try:
            if identifier in {"!", "="}:
                cls._add_position(result, text[1:])
            elif identifier in {"/", "@"}:
                result["timestamp"] = text[1:8] if len(text) >= 8 else None
                cls._add_position(result, text[8:])
            elif identifier == ";":
                cls._parse_object(result, text)
            elif identifier == ")":
                cls._parse_item(result, text)
            elif identifier == ":":
                cls._parse_message(result, text)
            elif identifier == ">":
                cls._parse_status(result, text)
            elif identifier == "T" and text.startswith("T#"):
                cls._parse_classic_telemetry(result, text)
            elif identifier == "_":
                result["weather"] = cls._parse_weather(text[1:])
            elif identifier in {"`", "'"}:
                # Mic-E position digits are encoded in the AX.25 destination.
                result["destination_encoding"] = destination
                result["supported"] = False
                result["note"] = "Mic-E packet preserved; position decoding is not yet available."
            else:
                result["text"] = text[1:]
                if text[1:]:
                    result["values"]["text"] = text[1:]
        except (IndexError, TypeError, ValueError) as error:
            result["supported"] = False
            result["parse_error"] = str(error)

        return result

    @classmethod
    def _add_position(cls, result: Dict[str, Any], body: str) -> None:
        position, comment = cls._parse_position(body)
        if position is None:
            result["supported"] = False
            result["text"] = body
            return

        result["position"] = position
        result["values"].update(
            {
                "latitude_degrees": position["latitude"],
                "longitude_degrees": position["longitude"],
            }
        )
        cls._add_position_extensions(result, comment)

    @classmethod
    def _parse_position(cls, body: str) -> Tuple[Optional[Dict[str, Any]], str]:
        uncompressed = cls._UNCOMPRESSED_POSITION.match(body)
        if uncompressed:
            latitude, ambiguity_lat = cls._decode_degrees_minutes(uncompressed.group("lat"), 2)
            longitude, ambiguity_lon = cls._decode_degrees_minutes(uncompressed.group("lon"), 3)
            position = {
                "latitude": latitude,
                "longitude": longitude,
                "format": "uncompressed",
                "symbol_table": uncompressed.group("table"),
                "symbol_code": uncompressed.group("symbol"),
                "ambiguity": max(ambiguity_lat, ambiguity_lon),
            }
            return position, body[uncompressed.end() :]

        # Compressed APRS: table byte, four Base91 latitude bytes, four
        # longitude bytes, then the symbol code. csT is optional in practice.
        if len(body) >= 10 and all(33 <= ord(character) <= 123 for character in body[1:9]):
            latitude_value = cls._decode_base91(body[1:5])
            longitude_value = cls._decode_base91(body[5:9])
            latitude = 90.0 - latitude_value / 380926.0
            longitude = -180.0 + longitude_value / 190463.0
            if not (-90 <= latitude <= 90 and -180 <= longitude <= 180):
                return None, body
            position = {
                "latitude": round(latitude, 6),
                "longitude": round(longitude, 6),
                "format": "compressed",
                "symbol_table": body[0],
                "symbol_code": body[9],
            }
            comment_start = 10
            if len(body) >= 13 and all(33 <= ord(character) <= 123 for character in body[10:13]):
                position["compressed_extension"] = body[10:13]
                comment_start = 13
            return position, body[comment_start:]

        return None, body

    @staticmethod
    def _decode_degrees_minutes(value: str, degree_digits: int) -> Tuple[float, int]:
        hemisphere = value[-1]
        coordinate = value[:-1]
        ambiguity = coordinate.count(" ")
        normalized = coordinate.replace(" ", "5")
        degrees = int(normalized[:degree_digits])
        minutes = float(normalized[degree_digits:])
        decimal = degrees + minutes / 60.0
        if hemisphere in {"S", "W"}:
            decimal = -decimal
        return round(decimal, 6), ambiguity

    @classmethod
    def _add_position_extensions(cls, result: Dict[str, Any], comment: str) -> None:
        telemetry_match = cls._BASE91_TELEMETRY.search(comment)
        if telemetry_match:
            telemetry = cls._decode_base91_telemetry(telemetry_match.group(1))
            result["telemetry"] = telemetry
            result["values"]["telemetry_sequence"] = telemetry["sequence"]
            for index, value in enumerate(telemetry["channels"], start=1):
                result["values"][f"telemetry_channel_{index}_raw"] = value
            comment = comment[: telemetry_match.start()] + comment[telemetry_match.end() :]

        altitude = cls._ALTITUDE.search(comment)
        if altitude:
            altitude_feet = int(altitude.group(1))
            result["position"]["altitude_feet"] = altitude_feet
            result["position"]["altitude_meters"] = round(altitude_feet * 0.3048, 1)
            result["values"]["altitude_meters"] = result["position"]["altitude_meters"]

        course_speed = cls._COURSE_SPEED.match(comment)
        if course_speed:
            result["position"]["course_degrees"] = int(course_speed.group(1))
            result["position"]["speed_knots"] = int(course_speed.group(2))

        phg = cls._PHG.search(comment)
        if phg:
            result["phg"] = phg.group(1)

        cleaned_comment = comment.strip()
        if cleaned_comment:
            result["comment"] = cleaned_comment
            result["values"]["comment"] = cleaned_comment

        if result["position"].get("symbol_code") == "_":
            result["weather"] = cls._parse_weather(cleaned_comment)

    @classmethod
    def _decode_base91_telemetry(cls, encoded: str) -> Dict[str, Any]:
        values = [
            cls._decode_base91(encoded[index : index + 2]) for index in range(0, len(encoded), 2)
        ]
        return {
            "encoding": "base91",
            "sequence": values[0],
            "channels": values[1:],
            "raw": encoded,
        }

    @staticmethod
    def _decode_base91(value: str) -> int:
        decoded = 0
        for character in value:
            decoded = decoded * 91 + ord(character) - 33
        return decoded

    @classmethod
    def _parse_object(cls, result: Dict[str, Any], text: str) -> None:
        if len(text) < 18:
            raise ValueError("APRS object is too short")
        result["object"] = {
            "name": text[1:10].strip(),
            "alive": text[10] == "*",
        }
        result["timestamp"] = text[11:18]
        cls._add_position(result, text[18:])

    @classmethod
    def _parse_item(cls, result: Dict[str, Any], text: str) -> None:
        separator_positions = [
            index for index in (text.find("!", 1), text.find("_", 1)) if index > 0
        ]
        if not separator_positions:
            raise ValueError("APRS item separator is missing")
        separator = min(separator_positions)
        result["item"] = {
            "name": text[1:separator].strip(),
            "alive": text[separator] == "!",
        }
        cls._add_position(result, text[separator + 1 :])

    @staticmethod
    def _parse_message(result: Dict[str, Any], text: str) -> None:
        if len(text) < 11 or text[10] != ":":
            raise ValueError("APRS message addressee field is malformed")
        content = text[11:]
        message_id = None
        if "{" in content:
            content, message_id = content.rsplit("{", 1)
        message: Dict[str, Any] = {
            "addressee": text[1:10].strip(),
            "text": content,
        }
        if message_id:
            message["id"] = message_id
        if content.startswith("ack"):
            message["response"] = "ack"
            message["response_id"] = content[3:]
        elif content.startswith("rej"):
            message["response"] = "reject"
            message["response_id"] = content[3:]
        result["message"] = message
        result["values"].update({"addressee": message["addressee"], "message": content})

    @staticmethod
    def _parse_status(result: Dict[str, Any], text: str) -> None:
        status = text[1:]
        if len(status) >= 7 and re.match(r"^\d{6}[zh/]", status):
            result["timestamp"] = status[:7]
            status = status[7:]
        result["status"] = status
        result["values"]["status"] = status

    @staticmethod
    def _parse_classic_telemetry(result: Dict[str, Any], text: str) -> None:
        fields = text[2:].split(",")
        if not fields or not fields[0].isdigit():
            raise ValueError("APRS telemetry sequence is malformed")
        channels: list[Any] = []
        for field_value in fields[1:6]:
            try:
                channels.append(float(field_value) if "." in field_value else int(field_value))
            except ValueError:
                channels.append(field_value)
        telemetry: Dict[str, Any] = {
            "encoding": "classic",
            "sequence": int(fields[0]),
            "channels": channels,
        }
        if len(fields) > 6:
            telemetry["digital_bits"] = fields[6]
        if len(fields) > 7:
            telemetry["comment"] = ",".join(fields[7:])
        result["telemetry"] = telemetry
        result["values"]["telemetry_sequence"] = telemetry["sequence"]
        for index, channel_value in enumerate(channels, start=1):
            result["values"][f"telemetry_channel_{index}_raw"] = channel_value

    @staticmethod
    def _parse_weather(text: str) -> Dict[str, Any]:
        weather: Dict[str, Any] = {}
        patterns: Dict[str, Tuple[str, Callable[[str], Any]]] = {
            "wind_direction_degrees": (r"c(\d{3})", int),
            "wind_speed_mph": (r"s(\d{3})", int),
            "wind_gust_mph": (r"g(\d{3})", int),
            "temperature_fahrenheit": (r"t(-?\d{3})", int),
            "rain_last_hour_inches": (r"r(\d{3})", lambda value: int(value) / 100),
            "rain_last_24_hours_inches": (r"p(\d{3})", lambda value: int(value) / 100),
            "rain_since_midnight_inches": (r"P(\d{3})", lambda value: int(value) / 100),
            "pressure_mbar": (r"b(\d{5})", lambda value: int(value) / 10),
        }
        for name, (pattern, converter) in patterns.items():
            match = re.search(pattern, text)
            if match:
                weather[name] = converter(match.group(1))
        humidity = re.search(r"h(\d{2})", text)
        if humidity:
            weather["humidity_percent"] = (
                100 if humidity.group(1) == "00" else int(humidity.group(1))
            )
        return weather


__all__ = ["APRSParser"]
