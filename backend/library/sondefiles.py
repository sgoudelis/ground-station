"""Read a sonde's identity from saved reports, including older telemetry sidecars."""

from typing import Any

from telemetry.compatibility import normalize_metadata


def sonde_identity(metadata: dict[str, Any]) -> tuple[str, str] | None:
    context = metadata.get("parse_context") or {}
    report = context.get("decoder_report") if isinstance(context, dict) else None
    if isinstance(report, dict) and report.get("type") in ("RS41", "DFM", "M10", "M20"):
        serial = report.get("id")
        if isinstance(serial, str) and serial:
            return report["type"], serial
    candidates = [report]
    # Saved reports are authoritative, but older captures may only have values.
    try:
        telemetry = normalize_metadata(metadata).get("telemetry", {})
    except (ValueError, TypeError, AttributeError):
        telemetry = {}
    if telemetry.get("parser_id") == "radiosonde_rs" or (
        isinstance(metadata.get("decoder"), dict)
        and metadata["decoder"].get("type") == "radiosonde"
    ):
        for record in (telemetry.get("payload") or {}).get("records", []):
            for group in record.get("groups", []):
                candidates.append(group.get("values"))
    for values in candidates:
        if not isinstance(values, dict):
            continue
        model, serial = values.get("type"), values.get("id")
        if model in ("RS41", "DFM", "M10", "M20") and isinstance(serial, str) and serial:
            return model, serial
    return None
