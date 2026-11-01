"""Normalize readsb reports while retaining their original units and freshness."""

import math
from datetime import datetime, timezone

from common.adsbstorage import aircraft_address


def number(value):
    return float(value) if type(value) in (int, float) and math.isfinite(value) else None


def aircraft_record(report, timestamp, provenance):
    address = aircraft_address(report.get("hex"))
    seen = number(report.get("seen"))
    position_age = number(report.get("seen_pos"))
    received = timestamp - max(0, seen or 0)
    position_at = timestamp - max(0, position_age) if position_age is not None else None
    lat, lon = number(report.get("lat")), number(report.get("lon"))
    has_position = (
        position_at is not None
        and position_age <= 10
        and lat is not None
        and lon is not None
        and -90 <= lat <= 90
        and -180 <= lon <= 180
    )

    def convert(key, factor):
        value = number(report.get(key))
        return value * factor if value is not None else None

    return {
        "schema_version": 1,
        "icao": address,
        "timestamp": received,
        "captured_at": datetime.fromtimestamp(received, timezone.utc).isoformat(
            timespec="microseconds"
        ),
        "callsign": str(report.get("flight") or "").strip() or None,
        "latitude": lat if has_position else None,
        "longitude": lon if has_position else None,
        "position_timestamp": position_at if has_position else None,
        "altitude_baro_m": convert("alt_baro", 0.3048),
        "altitude_geom_m": convert("alt_geom", 0.3048),
        "groundspeed_mps": convert("gs", 0.5144444444),
        "vertical_rate_mps": convert("baro_rate", 0.00508),
        "track_deg": number(report.get("track")),
        "squawk": report.get("squawk"),
        "emergency": report.get("emergency"),
        "on_ground": report.get("alt_baro") == "ground",
        "readsb": report,
        **provenance,
    }


def aircraft_position(record, item_id):
    if record.get("latitude") is None or record.get("longitude") is None:
        return None
    position_time = record.get("position_timestamp")
    if number(position_time) is None:
        return None
    captured = datetime.fromtimestamp(position_time, timezone.utc).isoformat(
        timespec="microseconds"
    )
    return {
        "id": item_id,
        "file_id": item_id,
        "transmitter_id": f"adsb:{record['icao']}",
        "kind": "adsb",
        "name": record.get("callsign") or record["icao"].upper(),
        "source": record["icao"].upper(),
        "captured_at": captured,
        "latitude": record["latitude"],
        "longitude": record["longitude"],
        "altitude": (
            record.get("altitude_geom_m")
            if record.get("altitude_geom_m") is not None
            else record.get("altitude_baro_m")
        ),
        "track_deg": record.get("track_deg"),
        "_details": {
            "telemetry": {key: value for key, value in record.items() if key != "readsb"},
            "readsb": record.get("readsb", {}),
        },
        "_field_info": {},
    }
