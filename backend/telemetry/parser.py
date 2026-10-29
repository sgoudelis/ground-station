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

"""
Generic Telemetry Parser with Pluggable Architecture (protocol-agnostic)

Now supports multiple link-layer protocols via hints and light auto-detection:
- AX.25 (existing)
- CSP (e.g., AX100)
- CCSDS TM Space Packets (e.g., DOKA)

It delegates payload parsing to satellite/service specific parsers when available.

Comprehensive overview: signal paths, deframers, protocols, and payload parsing
==========================================================================

Legend:
- [RF]     modulation on the air
- [DEMOD]  GNU Radio demodulator (IQ/AF to soft symbols/bytes)
- [DEFR]   GNU Radio deframer/FEC chain (gr-satellites component)
- [PDU]    Higher-layer packet bytes emitted from GNU Radio
- [TP]     This TelemetryParser


FSK-family paths (FSK/GFSK/GMSK) → shared demodulator
-----------------------------------------------------

   [RF]  FSK | GFSK | GMSK
       ↓
   [DEMOD] satellites.components.demodulators.fsk_demodulator (soft symbols)
       ↓
   [DEFR] per framing (selected in backend/demodulators/fskdecoder.py):
       - AX.25      → satellites.components.deframers.ax25_deframer (G3RUH)
       - USP        → satellites.components.deframers.usp_deframer (PLS + Vit + RS + AX.25 crop)
       - GEOSCAN    → satellites.components.deframers.geoscan_deframer (fixed-size frames)
       - DOKA       → satellites.components.deframers.ccsds_concatenated_deframer (CCSDS TM)
       - AX100 ASM  → satellites.components.deframers.ax100_deframer(mode='ASM', scrambler='CCSDS')
       - AX100 RS   → satellites.components.deframers.ax100_deframer(mode='RS')
       ↓
   [PDU] bytes delivered to BaseDecoder → TelemetryParser with protocol_hint:
       - framing ax25/usp     → protocol_hint = 'ax25' (AX.25 header present)
       - framing doka         → protocol_hint = 'ccsds' (CCSDS primary header)
       - framing ax100_*      → protocol_hint = 'csp'   (CSP header)
       - framing geoscan      → protocol_hint = 'proprietary' (no standard header)


BPSK (typical CCSDS concatenated) path
--------------------------------------

   [RF]  BPSK (sometimes QPSK)
       ↓
   [DEMOD] satellites.components.demodulators.bpsk_demodulator (soft symbols)
       ↓
   [DEFR] satellites.components.deframers.ccsds_concatenated_deframer (DOKA/CCSDS)
       ↓
   [PDU] CCSDS TM Space Packet bytes → TelemetryParser with protocol_hint = 'ccsds'


TelemetryParser responsibilities (this module)
----------------------------------------------

1) Protocol choice
   - Prefer `protocol_hint` from the decoder when provided
   - Otherwise, attempt light auto-detection via `_is_ax25`, `_is_csp`, `_is_ccsds`

2) Header parsing
   - AX.25  → parse to extract src/dst callsigns, control, pid, payload
   - CSP    → parse 32-bit header (best-effort v1/v2) to get ports, flags, payload
   - CCSDS  → parse 6-byte primary header to get APID, seq, length, payload
   - Unknown/proprietary → no header parse; payload analyzed generically

3) Payload parsing (optional, pluggable)
   - Registry supports keys by protocol/satellite/service:
       ('ax25', '<CALL>' or None, None)
       ('csp',  '<satellite>' or None, <dport> or None)
       ('ccsds','<satellite>' or None, <apid>  or None)
     Backward-compatible simple keys still work for AX.25 (e.g. 'ISS' or 'TEVEL').

4) Result
   - Always returns a dict with `success`, `parser`, and `raw` fields
   - For AX.25: `frame` contains header fields; `telemetry` contains payload decode or analysis
   - For CSP/CCSDS: `headers` contains parsed header dicts; `telemetry` contains payload decode or analysis

Notes and common expectations
-----------------------------

- USP framing: output PDUs are AX.25 frames (link layer is USP, network layer is AX.25)
- DOKA: describes CCSDS concatenated coding; commonly used with BPSK, but can be carried over FSK-family too
- AX100: outputs CSP frames (AX100 ASM+Golay or RS modes handled by deframer)
- GEOSCAN: fixed-length frames without standard higher-layer headers; falls back to generic payload analysis
"""

import logging
import re
from typing import Any, Dict, Optional, Tuple

from .aprsparser import APRSParser
from .ax25parser import AX25Parser
from .ccsdsparser import CCSDSParser
from .cspparser import CSPParser
from .parsers.geoscan import GeoscanParser
from .parsers.registry import register_builtin_payload_parsers
from .payloadanalyzers import PayloadAnalyzer

logger = logging.getLogger("telemetry.parser")


class TelemetryParser:
    """
    Generic telemetry parser with pluggable satellite-specific parsers

    Architecture:
    1. Parse AX.25 frame (always)
    2. Try to apply payload parser (if registered)
    3. Return structured data or fallback to hex dump
    """

    def __init__(self):
        """Initialize parser with registry for satellite-specific parsers

        Registry keys (protocol-aware):
          - ('ax25', 'CALL' or None, None)
          - ('csp', sat_hint or None, dport or None)
          - ('ccsds', sat_hint or None, apid or None)

        Backward compatibility: string keys (callsign base) for AX.25 still work.
        """
        self.ax25_parser = AX25Parser()
        self.aprs_parser = APRSParser()
        self.csp_parser = CSPParser()
        self.ccsds_parser = CCSDSParser()
        self.payload_parsers: Dict[Any, Any] = {}  # protocol-aware registry
        # LoRa payload parsers keyed by uppercase satellite-name prefix
        # (LoRa frames carry no callsign to route on).
        self.lora_parsers: Dict[str, Any] = {}
        register_builtin_payload_parsers(self)
        logger.debug("Telemetry parser initialized (protocol-agnostic)")

    def register_payload_parser(self, identifier, parser):
        """
        Register a satellite-specific payload parser

        Args:
            identifier: Satellite identifier (callsign pattern or name)
            parser: Parser object with parse(payload_bytes) method
        """
        self.payload_parsers[identifier] = parser
        logger.info(f"Registered payload parser for: {identifier}")

    def parse(
        self,
        packet_bytes: bytes,
        protocol_hint: Optional[str] = None,
        sat_hint: Optional[str] = None,
        service_hint: Optional[int] = None,
        parser_hint: Optional[Any] = None,
    ) -> Dict[str, Any]:
        """
        Parse telemetry packet with generic + pluggable approach

        Args:
            packet_bytes: Raw packet bytes (without HDLC flags 0x7E)
            protocol_hint: Optional protocol hint ('ax25','csp','ccsds')
            sat_hint: Optional satellite identifier/name
            service_hint: Optional service id (CSP dport or CCSDS APID)
            parser_hint: Optional legacy payload parser hint

        Returns:
            dict with parsed telemetry:
            {
                'parser': 'ax25',
                'frame': { AX.25 header data },
                'telemetry': { payload data },
                'raw': { original bytes }
            }
        """
        result: Dict[str, Any] = {"parser": None, "success": False}

        # Helper: coerce a parser_hint frame_size into an int when possible
        def _coerce_frame_size(hint: Optional[Any]) -> Optional[int]:
            try:
                if isinstance(hint, dict):
                    val = hint.get("frame_size")
                else:
                    val = None
                if isinstance(val, int):
                    return val
                if isinstance(val, str):
                    return int(val)
            except Exception:
                return None
            return None

        # LoRa is a PHY, not an application protocol. Satellite-specific specs
        # (matched by observation satellite name) may decode the payload;
        # anything else stays opaque hex until a parser exists for it.
        if protocol_hint == "lora":
            telemetry: Optional[Dict[str, Any]] = None
            parser_name = "lora"
            sat_key = (sat_hint or "").strip().upper()
            for prefix, lora_parser in self.lora_parsers.items():
                if not sat_key.startswith(prefix):
                    continue
                try:
                    telemetry = lora_parser.parse(packet_bytes)
                    parser_name = f"lora+{type(lora_parser).__name__}"
                except ValueError as exc:
                    # Fail-fast spec mismatch: fall back to hex below.
                    logger.info(f"LoRa payload parser '{prefix}' declined: {exc}")
                    telemetry = None
                break
            if telemetry is None:
                telemetry = self._fallback_telemetry(packet_bytes)
            return {
                "parser": parser_name,
                "protocol": "lora",
                "success": True,
                "telemetry": telemetry,
                "raw": {
                    "packet_hex": packet_bytes.hex(),
                    "payload_hex": packet_bytes.hex(),
                    "payload_length": len(packet_bytes),
                },
            }

        # Choose protocol
        protocol = None
        if protocol_hint in ("ax25", "csp", "ccsds", "proprietary"):
            protocol = protocol_hint
        else:
            # Auto-detect in simple order
            if self._is_ax25(packet_bytes):
                protocol = "ax25"
            elif self._is_csp(packet_bytes):
                protocol = "csp"
            elif self._is_ccsds(packet_bytes):
                protocol = "ccsds"
            else:
                protocol = "unknown"

        result["protocol"] = protocol

        if protocol == "ax25":
            ax25_result = self.ax25_parser.parse(packet_bytes)
            if not ax25_result.get("success"):
                result["error"] = ax25_result.get("error", "AX.25 parsing failed")
                return result
            result["parser"] = "ax25"
            result["frame"] = {
                "destination": ax25_result["destination"],
                "source": ax25_result["source"],
                "control": ax25_result["control"],
                "pid": ax25_result["pid"],
                "repeaters": ax25_result.get("repeaters"),
            }
            payload = ax25_result["payload"]
            is_aprs = isinstance(parser_hint, dict) and parser_hint.get("framing") == "aprs"
            payload_parser = self._select_payload_parser_ax25(ax25_result["source"], parser_hint)
            if is_aprs:
                result["telemetry"] = self.aprs_parser.parse(
                    payload,
                    destination=ax25_result["destination"],
                )
                result["parser"] = "ax25+aprs"
            elif payload_parser:
                try:
                    telemetry_data = payload_parser.parse(payload)
                    result["telemetry"] = telemetry_data
                    result["parser"] = f"ax25+{payload_parser.__class__.__name__}"
                except Exception as e:
                    logger.warning(f"Payload parser failed: {e}, falling back to hex")
                    result["telemetry"] = self._fallback_telemetry(payload)
            else:
                result["telemetry"] = self._fallback_telemetry(payload)
            result["success"] = True
            result["raw"] = {
                "packet_hex": packet_bytes.hex(),
                "payload_hex": payload.hex(),
                "payload_length": len(payload),
            }
            return result

        if protocol == "csp":
            csp = self.csp_parser.parse(packet_bytes)
            if not csp.get("success"):
                result["error"] = csp.get("error", "CSP parsing failed")
                # Fallback to raw payload analyzer
                result["telemetry"] = self._fallback_telemetry(packet_bytes)
                return result
            result["parser"] = "csp"
            result["headers"] = {"csp": csp["headers"]}
            payload = csp["payload"]
            # Try payload parser by protocol/sat/service (dport)
            payload_parser = self._select_payload_parser_protocol(
                protocol="csp",
                sat_hint=sat_hint,
                service_id=csp["headers"].get("dport"),
                legacy_hint=parser_hint,
            )
            if payload_parser:
                try:
                    data = payload_parser.parse(payload)
                    result["telemetry"] = data
                    result["parser"] = f"csp+{payload_parser.__class__.__name__}"
                except Exception as e:
                    logger.warning(f"CSP payload parser failed: {e}, falling back to hex")
                    result["telemetry"] = self._fallback_telemetry(payload)
            else:
                result["telemetry"] = self._fallback_telemetry(payload)
            result["success"] = True
            result["raw"] = {
                "packet_hex": packet_bytes.hex(),
                "payload_hex": payload.hex(),
                "payload_length": len(payload),
            }
            return result

        if protocol == "ccsds":
            ccsds = self.ccsds_parser.parse(packet_bytes)
            if not ccsds.get("success"):
                result["error"] = ccsds.get("error", "CCSDS parsing failed")
                result["telemetry"] = self._fallback_telemetry(packet_bytes)
                return result
            result["parser"] = "ccsds"
            result["headers"] = {"ccsds_primary": ccsds["primary_header"]}
            payload = ccsds["payload"]
            payload_parser = self._select_payload_parser_protocol(
                protocol="ccsds",
                sat_hint=sat_hint,
                service_id=ccsds["primary_header"].get("apid"),
                legacy_hint=parser_hint,
            )
            if payload_parser:
                try:
                    data = payload_parser.parse(payload)
                    result["telemetry"] = data
                    result["parser"] = f"ccsds+{payload_parser.__class__.__name__}"
                except Exception as e:
                    logger.warning(f"CCSDS payload parser failed: {e}, falling back to hex")
                    result["telemetry"] = self._fallback_telemetry(payload)
            else:
                result["telemetry"] = self._fallback_telemetry(payload)
            result["success"] = True
            result["raw"] = {
                "packet_hex": packet_bytes.hex(),
                "payload_hex": payload.hex(),
                "payload_length": len(payload),
            }
            return result

        # Proprietary payloads (e.g., GEOSCAN)
        if protocol == "proprietary":
            payload = packet_bytes

            # Some proprietary link-layers (e.g., GEOSCAN) encapsulate an AX.25 frame inside.
            # Try parsing as AX.25 first to extract callsigns and the info field.
            try:
                ax25_result = self.ax25_parser.parse(payload)
                logger.debug(
                    "proprietary→AX25 attempt | first16=%s | success=%s",
                    payload[:16].hex(),
                    ax25_result.get("success"),
                )
            except Exception as e:
                logger.debug(
                    "proprietary→AX25 parse raised: %s | first16=%s",
                    e,
                    payload[:16].hex(),
                )
                ax25_result = {"success": False}
            if ax25_result.get("success"):
                # Build AX.25 frame header for metadata
                result["frame"] = {
                    "destination": ax25_result["destination"],
                    "source": ax25_result["source"],
                    "control": ax25_result["control"],
                    "pid": ax25_result["pid"],
                    "repeaters": ax25_result.get("repeaters"),
                }
                ax25_payload = ax25_result["payload"]
                # GEOSCAN universal path: use GeoscanParser on the AX.25 info field with frame_size hint
                try:
                    fs_hint = _coerce_frame_size(parser_hint)
                    parser = GeoscanParser()
                    data = parser.parse(
                        ax25_payload,
                        sat_name=sat_hint,
                        frame_size=fs_hint or len(ax25_payload),
                    )
                    result["telemetry"] = data
                    result["parser"] = f"proprietary+{parser.__class__.__name__}"
                except Exception as e:
                    logger.warning(f"GeoscanParser failed on AX.25 info: {e}, falling back to hex")
                    result["telemetry"] = self._fallback_telemetry(ax25_payload)

                result["success"] = True
                result["raw"] = {
                    "packet_hex": packet_bytes.hex(),
                    "payload_hex": ax25_payload.hex(),
                    "payload_length": len(ax25_payload),
                }
                return result

            # If AX.25 parser failed (likely because GEOSCAN removed AX.25 FCS),
            # attempt a lightweight AX.25 header extraction (no FCS) and run
            # the AX.25 payload parser on the info field.
            try:
                if len(payload) >= 16:
                    # Control/PID sanity
                    ctl = payload[14]
                    pid = payload[15]
                    if ctl in (0x03, 0x13) and pid in (0xF0, 0xCF, 0xF3, 0x01):
                        # Decode callsigns (shift >>1)
                        dest_call = "".join(chr((payload[i] >> 1) & 0x7F) for i in range(6)).strip()
                        dest_ssid = (payload[6] >> 1) & 0x0F
                        src_call = "".join(
                            chr((payload[i] >> 1) & 0x7F) for i in range(7, 13)
                        ).strip()
                        src_ssid = (payload[13] >> 1) & 0x0F
                        info = payload[16:]
                        logger.debug(
                            "proprietary→AX25 lightweight header (no FCS) | src=%s-%d dst=%s-%d | info_len=%d",
                            src_call,
                            src_ssid,
                            dest_call,
                            dest_ssid,
                            len(info),
                        )

                        # Build result frame for metadata
                        result["frame"] = {
                            "destination": f"{dest_call}-{dest_ssid}",
                            "source": f"{src_call}-{src_ssid}",
                            "control": hex(ctl),
                            "pid": hex(pid),
                            "repeaters": None,
                        }
                        # Universal GEOSCAN path: run GeoscanParser on AX.25 info field with frame_size hint
                        try:
                            fs_hint = _coerce_frame_size(parser_hint)
                            parser = GeoscanParser()
                            data = parser.parse(
                                info,
                                sat_name=sat_hint,
                                frame_size=fs_hint or len(info),
                            )
                            result["telemetry"] = data
                            result["parser"] = f"proprietary+{parser.__class__.__name__}"
                        except Exception as e:
                            logger.warning(
                                "telemetry.parser: GeoscanParser on AX.25 info failed: %s; falling back to hex",
                                e,
                            )
                            result["telemetry"] = self._fallback_telemetry(info)

                        result["success"] = True
                        result["raw"] = {
                            "packet_hex": packet_bytes.hex(),
                            "payload_hex": info.hex(),
                            "payload_length": len(info),
                        }
                        return result
            except Exception as e:
                logger.warning("telemetry.parser: lightweight AX.25 header path error: %s", e)

            # If no encapsulated AX.25 detected, try protocol-aware proprietary parser by satellite hint
            logger.debug(
                "proprietary→no AX25; trying protocol parser (sat_hint=%s, len=%d)",
                sat_hint,
                len(payload),
            )
            # Universal proprietary path: try GeoscanParser (66/74) with frame_size hint
            try:
                fs_hint2 = _coerce_frame_size(parser_hint)

                parser = GeoscanParser()
                data = parser.parse(
                    payload,
                    sat_name=sat_hint,
                    frame_size=fs_hint2 or len(payload),
                )
                result["telemetry"] = data
                result["parser"] = f"proprietary+{parser.__class__.__name__}"
            except Exception:
                # If import or parsing fails, fall back to generic views
                result["telemetry"] = self._fallback_telemetry(payload)
                result["parser"] = "raw"

            result["success"] = True
            result["raw"] = {
                "packet_hex": packet_bytes.hex(),
                "payload_hex": payload.hex(),
                "payload_length": len(payload),
            }
            return result

        # Unknown protocol -> raw analysis only
        result["parser"] = "raw"
        result["telemetry"] = self._fallback_telemetry(packet_bytes)
        result["success"] = True
        result["raw"] = {
            "packet_hex": packet_bytes.hex(),
            "payload_hex": packet_bytes.hex(),
            "payload_length": len(packet_bytes),
        }
        return result

    def _select_payload_parser_ax25(self, source_callsign: str, hint: Optional[Any] = None):
        """
        Select appropriate payload parser based on callsign or hint

        Args:
            source_callsign: Source callsign from AX.25 header
            hint: Optional parser hint

        Returns:
            Parser object or None
        """
        # Try hint first (legacy path): only if hashable/simple types
        # Recent callers may pass a dict (e.g., {"framing": ..., "frame_size": ...})
        # which is unhashable and should not be used as a registry key here.
        if isinstance(hint, (str, int, tuple)):
            if hint in self.payload_parsers:
                return self.payload_parsers[hint]
        elif isinstance(hint, dict):
            # Optionally extract a legacy token if provided (best-effort, non-fatal)
            legacy = hint.get("parser") or hint.get("framing")
            if isinstance(legacy, (str, int, tuple)) and legacy in self.payload_parsers:
                return self.payload_parsers[legacy]

        # Normalize callsign: remove control/non-printable characters and collapse whitespace
        try:
            cleaned = re.sub(r"[^A-Za-z0-9\-]", "", source_callsign or "")
        except Exception:
            cleaned = (source_callsign or "").replace("\x00", "").strip()

        # Try exact match on original then cleaned
        if source_callsign in self.payload_parsers:
            return self.payload_parsers[source_callsign]
        if cleaned in self.payload_parsers:
            return self.payload_parsers[cleaned]

        # Try base callsign before SSID (e.g., RS67S-0 → RS67S), using cleaned variant too
        base_callsign = source_callsign.split("-")[0]
        if base_callsign in self.payload_parsers:
            return self.payload_parsers[base_callsign]
        cleaned_base = cleaned.split("-")[0] if cleaned else ""
        if cleaned_base in self.payload_parsers:
            return self.payload_parsers[cleaned_base]

        return None

    def _select_payload_parser_protocol(
        self,
        protocol: str,
        sat_hint: Optional[str],
        service_id: Optional[int],
        legacy_hint: Optional[Any] = None,
    ):
        # Highest specificity: (protocol, sat_hint, service_id)
        key: Tuple[Any, Any, Any]
        if sat_hint is not None and service_id is not None:
            key = (protocol, sat_hint, service_id)
            if key in self.payload_parsers:
                return self.payload_parsers[key]
        # Next: (protocol, sat_hint, None)
        if sat_hint is not None:
            key = (protocol, sat_hint, None)
            if key in self.payload_parsers:
                return self.payload_parsers[key]
        # Next: (protocol, None, service_id)
        if service_id is not None:
            key = (protocol, None, service_id)
            if key in self.payload_parsers:
                return self.payload_parsers[key]
        # Legacy direct hint
        if legacy_hint and legacy_hint in self.payload_parsers:
            return self.payload_parsers[legacy_hint]
        return None

    def _is_ax25(self, packet: bytes) -> bool:
        # Very light heuristic: minimum addresses + control(0x03) and pid(0xF0) common
        return len(packet) >= 16 and packet[14] in (0x03, 0x13)  # control near typical position

    def _is_csp(self, packet: bytes) -> bool:
        # CSP v2: first 4 bytes header; length field lower 6 bits; sanity check payload length
        if len(packet) < 4:
            return False
        # No strong magic; just accept as possible CSP when total length is reasonable
        return True if len(packet) >= 4 else False

    def _is_ccsds(self, packet: bytes) -> bool:
        # CCSDS primary header is 6 bytes; version bits are 0b000 in most TM packets
        if len(packet) < 6:
            return False
        version = (packet[0] & 0xE0) >> 5
        return version == 0

    def _fallback_telemetry(self, payload):
        """
        Generate generic telemetry representation for unknown formats
        Uses PayloadAnalyzer for multiple interpretation views

        Args:
            payload: Raw payload bytes

        Returns:
            dict with generic representation and analysis
        """
        telemetry = {
            "format": "raw",
            "hex": payload.hex(),
            "length": len(payload),
            "ascii": self._try_ascii(payload),
        }

        # Use PayloadAnalyzer for multiple views
        analysis = PayloadAnalyzer.analyze(payload)
        telemetry["analysis"] = analysis

        return telemetry

    def _try_ascii(self, payload):
        """Try to decode payload as ASCII, replacing invalid chars"""
        try:
            return payload.decode("ascii", errors="replace")
        except Exception:
            return None
