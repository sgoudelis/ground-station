"""Read historical metadata without spreading old shapes into UI components."""

from copy import deepcopy
from typing import Any

from .aprsparser import APRSParser
from .result import SCHEMA_VERSION, normalize_result


def normalize_metadata(metadata: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(metadata, dict):
        raise ValueError("Packet metadata must be an object")
    metadata = deepcopy(metadata)
    result = metadata.get("telemetry") or {}
    if not isinstance(result, dict):
        raise ValueError("Saved telemetry must be an object")
    if result.get("schema_version") == SCHEMA_VERSION and isinstance(result.get("payload"), dict):
        return metadata
    if result.get("schema_version") is not None:
        raise ValueError("Unsupported telemetry schema version")
    data = result.get("telemetry") or {}
    if not isinstance(data, dict):
        raise ValueError("Saved telemetry contents must be an object")
    for key in ("values", "field_info", "raw_fields", "rawFields"):
        if data.get(key) is not None and not isinstance(data[key], dict):
            raise ValueError(f"Saved telemetry {key} must be an object")
    name = result.get("parser") or ""
    profile = data.get("spec") or {
        "COLIBRI-S": "colibri",
        "RS52S": "rs52s",
        "UWE-4": "uwe4",
        "LASARSAT": "lasarsat",
    }.get(data.get("satellite") or "", "")
    if not profile:
        for token, identifier in (
            ("Colibri", "colibri"),
            ("Rs52s", "rs52s"),
            ("Geoscan", "geoscan"),
            ("Uwe4", "uwe4"),
            ("Lasarsat", "lasarsat"),
        ):
            if token in name:
                profile = identifier
                break
    # Field-name heuristics are confined to old, unversioned captures.
    if not profile:
        keys = list((data.get("values") or {}).keys())
        if any(key.startswith("batt_a_") or key.startswith("batt_b_") for key in keys):
            profile = "uwe4"
        elif any(key.startswith("eps_") for key in keys):
            profile = "geoscan"
    if (metadata.get("decoder") or {}).get("type") == "aprs" and data.get("format") != "aprs":
        raw_hex = (result.get("raw") or {}).get("payload_hex")
        if raw_hex:
            body = bytes.fromhex(raw_hex)
        else:
            body = (data.get("ascii") or "").encode("utf-8")
        result["telemetry"] = APRSParser.parse(
            body, destination=(result.get("frame") or {}).get("destination")
        )
        profile = "aprs"
    result.setdefault("success", not bool(result.get("error")))
    metadata["telemetry"] = normalize_result(result, profile)
    # Adapting a saved interpretation is different from running today's parser.
    metadata["telemetry"]["parser_revision"] = 0
    return metadata
