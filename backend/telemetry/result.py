"""Versioned results shared by files, live events and all packet viewers.

The legacy telemetry map remains available to external consumers during the
transition. New clients use payload.records and never infer satellite layouts.
"""

import math
import re
from copy import deepcopy
from typing import Any, cast, overload

from .parsers.presentation import ACTIVITY_LABELS, GROUP_TITLES, HOUSEKEEPING_FIELDS, readable_label

SCHEMA_VERSION = 1
# Bump when interpretation changes; schema_version describes the shape only.
PARSER_REVISION = 1
_CLOCKS = {"eps_time_unix_s": "power_system", "time_unix_s": "spacecraft"}
_DETAILS = {"api", "packet_id", "payload_size", "mayak_id"}


@overload
def json_safe(value: dict[str, Any]) -> dict[str, Any]: ...


@overload
def json_safe(value: Any) -> Any: ...


def json_safe(value: Any) -> Any:
    """No parser may leak NaN, bytes or non-JSON objects into metadata/events."""
    if isinstance(value, float) and not math.isfinite(value):
        return None
    if isinstance(value, bytes):
        return value.hex()
    if isinstance(value, dict):
        return {str(key): json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [json_safe(item) for item in value]
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    raise TypeError(f"Parser returned a non-JSON value: {type(value).__name__}")


def reading(entry: Any) -> tuple[Any, dict[str, Any]]:
    wrapped = isinstance(entry, dict) and ("value" in entry or "error" in entry)
    info = (
        {key: entry[key] for key in ("unit", "error") if entry.get(key) is not None}
        if wrapped
        else {}
    )
    value = None if info.get("error") else entry.get("value") if wrapped else entry
    return json_safe(value), info


def _record(data: dict[str, Any], profile: str, index: int = 0) -> dict[str, Any]:
    grouped = profile in {"geoscan", "colibri", "rs52s", "uwe4", "lasarsat"} or profile.startswith(
        "geoscan_type1_"
    )
    supplied = data.get("field_info") or {}
    raw = {**(data.get("rawFields") or {}), **(data.get("raw_fields") or {})}
    groups: dict[str, dict[str, Any]] = {}
    clocks = []
    fields = list(HOUSEKEEPING_FIELDS)
    values = data.get("values") or {}
    for key, entry in values.items():
        value, wrapper = reading(entry)
        info = {**wrapper, **supplied.get(key, {})}
        if info.get("error"):
            value = None
        if info.get("calibrated") is False:
            info["unit"] = ""
        if key in _CLOCKS:
            clocks.append({"kind": _CLOCKS[key], "value": value})
            continue
        # Reserved/header placement is defined here once, including legacy data.
        if grouped and (
            key in _DETAILS
            or key.startswith("ax25_")
            or re.search(r"(?:^|_)reserve(?:d)?(?:_|$)", key)
            or (key.endswith("_raw") and key not in HOUSEKEEPING_FIELDS and not info.get("group"))
        ):
            raw.setdefault(key, value)
            continue
        fallback = HOUSEKEEPING_FIELDS.get(key) if grouped else None
        label, unit, group_id = fallback or (readable_label(key), "", "other")
        group_id = info.get("group") or (group_id if grouped else "values")
        group = groups.setdefault(
            group_id,
            {
                "id": group_id,
                "title": GROUP_TITLES.get(group_id, readable_label(group_id)),
                "values": {},
                "field_info": {},
            },
        )
        if profile == "colibri" and key == "obc_activity" and isinstance(value, dict):
            for flag, active in value.items():
                flag_key = f"obc_activity_{flag}"
                group["values"][flag_key] = active
                group["field_info"][flag_key] = {
                    "label": ACTIVITY_LABELS.get(flag, readable_label(flag))
                }
            continue
        group["values"][key] = value
        default_order = fields.index(key) if key in fields else len(fields)
        group["field_info"][key] = {
            "label": label if grouped else key,
            "unit": unit,
            "order": default_order,
            **info,
        }
    if not clocks:
        clock = data.get("time_unix_s", data.get("time_utc"))
        if clock is not None:
            clocks.append({"kind": "spacecraft", "value": clock})
    # A USP clock belongs to its message, not to the whole received packet.
    for group in groups.values():
        for key in list(group["values"]):
            if key == "time_utc":
                clocks.append(
                    {
                        "kind": "spacecraft",
                        "label": group["field_info"][key].get("label"),
                        "value": group["values"].pop(key),
                    }
                )
        ordered = sorted(group["values"], key=lambda key: group["field_info"][key].get("order", 0))
        group["values"] = {key: group["values"][key] for key in ordered}
    ordered_groups = [key for key in GROUP_TITLES if key in groups]
    ordered_groups.extend(key for key in groups if key not in ordered_groups)
    # Some parsers repeat the same clock at the top level and in values.
    clocks = [
        clock
        for index, clock in enumerate(clocks)
        if not any(
            previous["kind"] == clock["kind"] and previous["value"] == clock["value"]
            for previous in clocks[:index]
        )
    ]
    status = data.get("status") or (
        "malformed"
        if data.get("error")
        else "non_telemetry" if data.get("warning") and not values else "decoded"
    )
    return {
        "id": str(index),
        "title": data.get("name"),
        "status": status,
        "message_id": data.get("message_id"),
        "source": data.get("source"),
        "destination": data.get("destination"),
        "length": data.get("length"),
        "error": data.get("error"),
        "warning": data.get("warning"),
        "clocks": clocks,
        "groups": [groups[key] for key in ordered_groups if groups[key]["values"]],
        "raw_fields": raw,
        "beacon_id": reading(values["mayak_id"])[0] if "mayak_id" in values else None,
    }


def _message_status(records, error):
    """Keep mixed message success visible without hiding damaged messages."""
    statuses = {record["status"] for record in records}
    failures = statuses.intersection({"malformed", "error", "unsupported"})
    if "decoded" in statuses:
        return "partial" if failures or error else "decoded"
    if error:
        return "malformed"
    for status in ("error", "malformed", "unsupported"):
        if status in statuses:
            return status
    return "non_telemetry"


def normalize_result(result: dict[str, Any], profile: str = "") -> dict[str, Any]:
    """Adapt parser output once; expected failures retain bytes and diagnostics."""
    result = deepcopy(result)
    data = result.get("telemetry") or {}
    diagnostics = list(result.get("diagnostics") or [])
    kind = data.get("format", "raw")
    status = result.get("payload_status")
    records = []
    if kind == "usp":
        records = [
            _record(message, "usp", index)
            for index, message in enumerate(data.get("messages") or [])
        ]
        status = status or _message_status(records, data.get("error"))
        kind = "telemetry"
    elif kind == "aprs":
        status = status or (
            "malformed"
            if data.get("parse_error")
            else "unsupported" if data.get("supported") is False else "decoded"
        )
    elif kind == "text":
        status = status or "decoded"
    elif "values" in data or data.get("warning") or data.get("error"):
        records = [_record(data, profile)]
        status = status or (
            "malformed"
            if data.get("error")
            else "non_telemetry" if data.get("warning") and not data.get("values") else "decoded"
        )
        kind = "telemetry"
    else:
        status = status or ("malformed" if kind == "malformed" else "unsupported")
        kind = "raw"
    for message in (result.get("error"), data.get("error"), data.get("parse_error")):
        if message and not any(item.get("message") == message for item in diagnostics):
            diagnostics.append({"stage": "payload", "code": "malformed", "message": message})
    if result.get("success") is False:
        status = status if status == "error" else "malformed"
    result.update(
        schema_version=SCHEMA_VERSION,
        parser_id=result.get("parser_id") or profile or result.get("protocol") or "raw",
        parser_revision=PARSER_REVISION,
        envelope_status=result.get("envelope_status")
        or ("parsed" if result.get("success") else "malformed"),
        payload_status=status,
        diagnostics=diagnostics,
        payload={
            "kind": kind,
            "status": status,
            "records": records,
            "satellite": data.get("satellite"),
            "beacon_type": data.get("type"),
            "aprs": data if kind == "aprs" else None,
            "text": data.get("text"),
        },
    )
    result.setdefault("raw", {"packet_hex": "", "payload_hex": "", "payload_length": 0})
    return cast(dict[str, Any], json_safe(result))


def failure_result(packet: bytes, protocol: str, error: str) -> dict[str, Any]:
    return normalize_result(
        {
            "success": False,
            "parser": "raw",
            "protocol": protocol,
            "payload_status": "error",
            "envelope_status": "error",
            "error": error,
            "diagnostics": [{"stage": "parser", "code": "internal_error", "message": error}],
            "telemetry": {"format": "raw", "hex": packet.hex()},
            "raw": {
                "packet_hex": packet.hex(),
                "payload_hex": packet.hex(),
                "payload_length": len(packet),
            },
        }
    )
