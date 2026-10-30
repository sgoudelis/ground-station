"""One parsing entry point for live packets, previews and explicit reparses."""

import logging
from typing import Any

from .context import ParseContext
from .parser import TelemetryParser
from .result import SCHEMA_VERSION, failure_result, json_safe

logger = logging.getLogger("telemetry.service")


def parse_packet(original: bytes, context: ParseContext, parser=None) -> dict[str, Any]:
    packet = context.packet_bytes(original)
    try:
        result = (parser or TelemetryParser()).parse(
            packet,
            protocol_hint=context.protocol,
            sat_hint=context.satellite,
            parser_hint={
                "framing": context.framing,
                "frame_size": context.frame_size,
                "csp_version": context.csp_version,
            },
        )
        if (
            not isinstance(result, dict)
            or result.get("schema_version") != SCHEMA_VERSION
            or not isinstance(result.get("payload"), dict)
        ):
            raise ValueError("Packet parser returned an invalid result")
        if result.get("payload_status") not in {
            "decoded",
            "partial",
            "unsupported",
            "non_telemetry",
            "malformed",
            "error",
        } or result.get("envelope_status") not in {"parsed", "opaque", "malformed", "error"}:
            raise ValueError("Packet parser returned invalid parsing statuses")
        # Inspection always has the complete recorded packet, including flags.
        result["raw"]["packet_hex"] = original.hex()
        return json_safe(result)
    except Exception as exc:
        # Also contain third-party/replacement parsers that do not implement
        # TelemetryParser's own failure boundary.
        logger.exception("Packet parser failed")
        return failure_result(original, context.protocol, str(exc))
