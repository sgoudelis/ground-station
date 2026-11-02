"""Compact geographic readings from saved packet metadata."""

import math
from typing import Any

from telemetry.compatibility import normalize_metadata


def _number(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value) if math.isfinite(value) else None


def packet_positions(metadata: dict[str, Any], item_id: str, captured_at: str) -> list[dict]:
    """Keep only map data in the inventory, including historical APRS captures.

    Dates refer to reception, just as they do in the file browser. Transmitter
    clocks can be missing or wrong and must not move a packet outside its capture.
    """
    try:
        telemetry = normalize_metadata(metadata).get("telemetry", {})
        payload = telemetry.get("payload", {})
        if telemetry.get("success") is False:
            return []
        context = {
            key: metadata[key]
            for key in ("decoder", "signal", "vfo", "satellite", "transmitter")
            if isinstance(metadata.get(key), dict)
        }
        readings: list[tuple] = []
        aprs = payload.get("aprs")
        if isinstance(aprs, dict):
            position = aprs.get("position") or {}
            frame = telemetry.get("frame") or {}
            source = frame.get("source") or (metadata.get("ax25") or {}).get("from_callsign")
            entity = aprs.get("object") or aprs.get("item") or {}
            name = entity.get("name") or source or item_id
            # Objects and items belong to their reporting station; two stations
            # may report unrelated objects with the same name.
            identity = f"{source or item_id}:{name}" if entity else str(name)
            readings.append(
                (
                    "aprs",
                    identity,
                    name,
                    source,
                    position.get("latitude"),
                    position.get("longitude"),
                    position.get("altitude_meters"),
                    {
                        **context,
                        "telemetry": {
                            key: value
                            for key, value in aprs.items()
                            if key not in ("hex", "values")
                        },
                        "frame": frame,
                    },
                    {},
                )
            )
        elif (
            telemetry.get("parser_id") == "radiosonde_rs"
            or (metadata.get("decoder") or {}).get("type") == "radiosonde"
        ):
            for record in payload.get("records", []):
                values: dict[str, Any] = {}
                field_info: dict[str, Any] = {}
                for group in record.get("groups", []):
                    values.update(group.get("values") or {})
                    field_info.update(group.get("field_info") or {})
                # Encrypted RS41 reports contain placeholder coordinates.
                if values.get("encrypted"):
                    continue
                name = values.get("id") or item_id
                identity = f"{values.get('type', 'sonde')}:{name}"
                readings.append(
                    (
                        "radiosonde",
                        identity,
                        name,
                        name,
                        values.get("lat"),
                        values.get("lon"),
                        values.get("alt"),
                        {
                            **context,
                            "telemetry": values,
                            "additional": record.get("raw_fields") or {},
                        },
                        field_info,
                    )
                )

        points = []
        for index, (
            kind,
            identity,
            name,
            source,
            lat,
            lon,
            altitude,
            details,
            field_info,
        ) in enumerate(readings):
            latitude, longitude = _number(lat), _number(lon)
            if (
                latitude is None
                or longitude is None
                or not (-90 <= latitude <= 90 and -180 <= longitude <= 180)
            ):
                continue
            point = {
                "id": f"{item_id}:{index}",
                "file_id": item_id,
                "transmitter_id": f"{kind}:{identity}",
                "kind": kind,
                "name": str(name),
                "source": str(source) if source else None,
                "captured_at": captured_at,
                "latitude": latitude,
                "longitude": longitude,
                "altitude": _number(altitude),
                # Keep details in the index, but send them only once per
                # transmitter rather than repeating them along its track.
                "_details": details,
                "_field_info": field_info,
            }
            if kind == "aprs":
                # Keep the symbol with each fix so historical playback cannot
                # inherit a different station type from the latest packet.
                position = details["telemetry"]["position"]
                point.update(
                    symbol_table=position.get("symbol_table"),
                    symbol_code=position.get("symbol_code"),
                )
            elif kind == "radiosonde":
                # Flight gauges need each fix's readings during playback, not
                # the latest packet's speeds and heading from transmitter details.
                report = details["telemetry"]
                point.update(
                    groundspeed_mps=_number(report.get("vel_h")),
                    vertical_rate_mps=_number(report.get("vel_v")),
                    track_deg=_number(report.get("heading")),
                )
            points.append(point)
        return points
    except (ValueError, TypeError, AttributeError, KeyError):
        # One corrupt sidecar must not prevent other captures from appearing.
        return []
