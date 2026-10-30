#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# Copyright (c) 2025 Efstratios Goudelis
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU General Public License for more details.
#
# You should have received a copy of the GNU General Public License
# along with this program. If not, see <https://www.gnu.org/licenses/>.

"""Parse a completed packet, then adapt its result for every consumer.

Radio framing/FEC stays upstream. Envelope validation and payload selection
happen here once; service.py owns capture context and byte normalization.
"""

import logging
from typing import Any

from .aprsparser import APRSParser
from .ax25parser import AX25Parser
from .ccsdsparser import CCSDSParser
from .cspparser import CSPParser
from .parsers.geoscan import GeoscanParser
from .parsers.registry import register_builtin_payload_parsers
from .result import failure_result, normalize_result

logger = logging.getLogger("telemetry.parser")


class TelemetryParser:
    def __init__(self):
        self.ax25_parser = AX25Parser()
        self.aprs_parser = APRSParser()
        self.csp_parser = CSPParser()
        self.ccsds_parser = CCSDSParser()
        self.payload_parsers: dict[tuple[Any, ...], Any] = {}
        self.lora_parsers: dict[str, Any] = {}
        register_builtin_payload_parsers(self)

    def register_payload_parser(self, identifier, parser):
        # Accept old AX.25 bindings at this API boundary; store a single key form.
        key = ("ax25", identifier, None) if isinstance(identifier, str) else identifier
        self.payload_parsers[key] = parser

    def parse(
        self,
        packet_bytes: bytes,
        protocol_hint=None,
        sat_hint=None,
        service_hint=None,
        parser_hint=None,
    ) -> dict[str, Any]:
        try:
            return self._parse(packet_bytes, protocol_hint, sat_hint, service_hint, parser_hint)
        except Exception as exc:
            # Unexpected bugs stay visible and must never interrupt packet capture.
            logger.exception("Unexpected packet parser failure")
            return failure_result(packet_bytes, protocol_hint or "unknown", str(exc))

    def _parse(self, packet: bytes, protocol_hint, sat_hint, service_hint, hint) -> dict[str, Any]:
        options = hint if isinstance(hint, dict) else {}
        protocol = protocol_hint or self._detect_protocol(packet)
        result: dict[str, Any] = {
            "protocol": protocol,
            "parser": protocol,
            "success": True,
            "envelope_status": "opaque",
            "diagnostics": [],
        }
        payload = packet
        payload_parser: Any = None
        parse_kwargs = {}
        if protocol == "ax25":
            envelope = self.ax25_parser.parse(packet)
            if not envelope["success"]:
                return self._invalid_envelope(result, packet, envelope)
            result["frame"] = self._frame(envelope)
            result["envelope_status"] = "parsed"
            payload = envelope["payload"]
            if options.get("framing") == "aprs" or options.get("parser") == "aprs":
                payload_parser = self.aprs_parser
                parse_kwargs = {"destination": envelope["destination"]}
            else:
                payload_parser = self._select_payload_parser_ax25(envelope["source"], hint)
        elif protocol in ("csp", "ccsds"):
            envelope = (
                self.csp_parser.parse(packet, version=options.get("csp_version", 1))
                if protocol == "csp"
                else self.ccsds_parser.parse(packet)
            )
            if not envelope["success"]:
                return self._invalid_envelope(result, packet, envelope)
            headers = envelope["headers"] if protocol == "csp" else envelope["primary_header"]
            result["headers"] = {"csp" if protocol == "csp" else "ccsds_primary": headers}
            result["envelope_status"] = "parsed"
            payload = envelope["payload"]
            service = (
                service_hint
                if service_hint is not None
                else headers.get("dport" if protocol == "csp" else "apid")
            )
            payload_parser = self._select_payload_parser_protocol(protocol, sat_hint, service, hint)
        elif protocol == "proprietary":
            # Native GEOSCAN headers are opaque layout fields. If there is a
            # valid encapsulated AX.25 frame, use exactly the same extractor.
            # Never reconstruct callsigns after address validation has failed.
            envelope = self.ax25_parser.parse(packet)
            if envelope["success"]:
                result["frame"] = self._frame(envelope)
                result["envelope_status"] = "parsed"
                payload = envelope["payload"]
            payload_parser = self._select_payload_parser_protocol(
                protocol, sat_hint, service_hint, hint
            )
            if payload_parser is None and options.get("framing") in (None, "geoscan"):
                payload_parser = GeoscanParser()
                size = options.get("frame_size")
                parse_kwargs = {
                    "sat_name": sat_hint,
                    "frame_size": int(size) if size is not None else None,
                }
        elif protocol == "lora":
            sat_key = (sat_hint or "").strip().upper()
            for prefix in sorted(self.lora_parsers, key=len, reverse=True):
                if sat_key.startswith(prefix):
                    payload_parser = self.lora_parsers[prefix]
                    break
        else:
            result["protocol"] = "unknown"
            result["parser"] = "raw"

        result["raw"] = {
            "packet_hex": packet.hex(),
            "payload_hex": payload.hex(),
            "payload_length": len(payload),
        }
        profile = ""
        if payload_parser is None:
            result["telemetry"] = self._fallback_telemetry(payload)
            result["payload_status"] = "unsupported"
        else:
            profile = getattr(payload_parser, "parser_id", type(payload_parser).__name__)
            result["parser_id"] = profile
            legacy_name = getattr(payload_parser, "legacy_name", type(payload_parser).__name__)
            result["parser"] = f"{protocol}+{legacy_name}"
            try:
                result["telemetry"] = payload_parser.parse(payload, **parse_kwargs)
                profile = result["telemetry"].get("spec") or profile
            except ValueError as exc:
                # A documented layout mismatch is expected input, not a bug.
                result["telemetry"] = self._fallback_telemetry(payload)
                # Preserve the historical fallback label for existing consumers;
                # parser_id still records which parser rejected the payload.
                result["parser"] = protocol
                result["payload_status"] = "malformed"
                result["diagnostics"].append(
                    {"stage": "payload", "code": "layout_mismatch", "message": str(exc)}
                )
        return normalize_result(result, profile)

    @staticmethod
    def _frame(envelope):
        return {
            key: envelope.get(key)
            for key in ("destination", "source", "control", "pid", "repeaters")
        }

    @staticmethod
    def _fallback_telemetry(payload):
        # Inspection tabs interpret bytes on demand. Do not persist redundant
        # float/integer/string guesses for every unsupported packet.
        return {
            "format": "raw",
            "hex": payload.hex(),
            "length": len(payload),
            "ascii": payload.decode("ascii", errors="replace"),
        }

    def _invalid_envelope(self, result, packet, envelope) -> dict[str, Any]:
        error = envelope.get("error", "Invalid packet envelope")
        result.update(
            success=False,
            error=error,
            envelope_status="malformed",
            payload_status="malformed",
            diagnostics=[{"stage": "envelope", "code": "invalid_envelope", "message": error}],
            telemetry=self._fallback_telemetry(packet),
            raw={
                "packet_hex": packet.hex(),
                "payload_hex": packet.hex(),
                "payload_length": len(packet),
            },
        )
        return normalize_result(result)

    @staticmethod
    def _hint_token(hint):
        token = hint.get("parser") if isinstance(hint, dict) else hint
        try:
            hash(token)
        except TypeError:
            return None
        return token

    def _select_payload_parser_ax25(self, source_callsign, hint=None):
        token = self._hint_token(hint)
        if token is not None:
            explicit = self.payload_parsers.get(("ax25", token, None)) or self.payload_parsers.get(
                token
            )
            if explicit is not None:
                return explicit
        for callsign in (source_callsign, source_callsign.split("-")[0]):
            selected = self.payload_parsers.get(("ax25", callsign, None))
            if selected is not None:
                return selected
        return self.payload_parsers.get(("ax25", None, None))

    def _select_payload_parser_protocol(self, protocol, sat_hint, service_id, legacy_hint=None):
        for key in (
            (protocol, sat_hint, service_id),
            (protocol, sat_hint, None),
            (protocol, None, service_id),
            (protocol, None, None),
        ):
            if key in self.payload_parsers:
                return self.payload_parsers[key]
        token = self._hint_token(legacy_hint)
        return self.payload_parsers.get(token) if token is not None else None

    def _detect_protocol(self, packet):
        # CSP has no reliable identifying magic. Guessing it from length hid
        # every CCSDS packet and treated arbitrary bytes as routing headers.
        if self.ax25_parser.parse(packet)["success"]:
            return "ax25"
        if self.ccsds_parser.parse(packet)["success"]:
            return "ccsds"
        return "unknown"
