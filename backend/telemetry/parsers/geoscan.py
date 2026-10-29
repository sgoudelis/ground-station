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
GEOSCAN beacon parser (dispatcher over Kaitai specs).

The Type-I field layouts are defined in ``telemetry/parsers/specs/
geoscan_type1_*.ksy``; this module only selects which spec applies to one
payload and returns the adapter's envelope. Parity with the old hand-coded
layout tables is proven in ``tests/testgeoscan.py`` against real GEOSCAN-6
captures.

Deliberate changes versus the legacy table implementation:
- Fail-fast: payloads matching no layout raise ValueError (TelemetryParser
  then emits its hex fallback) instead of a warning envelope with heuristic
  voltage/temperature candidates, which no consumer ever rendered.
- Short 66-byte-frame payloads now use the AX.25-info layout (info40 spec)
  instead of the legacy full-frame offsets, which decoded them misaligned.
- Reserve fields appear only under ``raw_fields``; engineering ``values``
  keep the legacy key names, except ``obc_activity_raw`` whose values entry
  is renamed ``obc_activity`` (raw key stays ``obc_activity_raw``).
"""

from __future__ import annotations

from typing import Any, Callable, Dict, Optional

from .kaitai import KaitaiPayloadParser

# Spec name -> registry-compatible factory (lazy module import happens inside
# the adapter's first parse, so constructing GeoscanParser stays cheap).
_SPECS: Dict[str, Callable[[], KaitaiPayloadParser]] = {
    "full74": KaitaiPayloadParser.factory("geoscan_type1_74", satellite="GEOSCAN"),
    "info56": KaitaiPayloadParser.factory("geoscan_type1_info56", satellite="GEOSCAN"),
    "full66": KaitaiPayloadParser.factory("geoscan_type1_full66", satellite="GEOSCAN"),
    "info40": KaitaiPayloadParser.factory("geoscan_type1_info40", satellite="GEOSCAN"),
}

# Image packet syncword 0x316F6B6F stored little-endian at offset 13
# (housekeeping beacons do not carry it there).
_IMAGE_SYNCWORD = bytes([0x6F, 0x6B, 0x6F, 0x31])


def _select_spec(payload_len: int, frame_size: Optional[int]) -> str:
    """Pick the spec name for one payload; ValueError when nothing fits.

    Callers in ``telemetry/parser.py`` pass ``frame_size = hint or len(payload)``,
    so a hint equal to the payload length carries no information and dispatch
    falls back to exact lengths.
    """
    layouts = {74: {72: "full74", 56: "info56"}, 66: {64: "full66", 48: "info40"}}
    if frame_size in layouts:
        spec = layouts[frame_size].get(payload_len)
        if spec is None:
            raise ValueError(
                f"GEOSCAN payload mismatch: {payload_len} bytes for frame_size {frame_size}"
            )
        return spec
    if frame_size is not None and frame_size != payload_len:
        raise ValueError(f"no GEOSCAN layout for frame_size {frame_size}")
    if payload_len == 72:
        return "full74"
    if payload_len == 56:
        return "info56"
    if payload_len == 64:
        return "full66"
    if payload_len == 48:
        return "info40"
    raise ValueError(f"no GEOSCAN layout for {payload_len}-byte payload")


class GeoscanParser:
    """Layout-driven parser for GEOSCAN payloads (see module docstring)."""

    def parse(
        self,
        payload: bytes,
        sat_name: Optional[str] = None,
        norad: Optional[int] = None,
        frame_size: Optional[int] = None,
    ) -> Dict[str, Any]:
        """Decode one GEOSCAN beacon payload.

        Raises ValueError for payloads no Type-I layout covers; the
        TelemetryParser proprietary branch converts that into hex output.
        """
        # Guard: image packet structure (Section 3.1). Image downlink frames
        # are not housekeeping; report them instead of decoding as telemetry.
        if len(payload) >= 17 and payload[13:17] == _IMAGE_SYNCWORD:
            return {
                "satellite": sat_name or "GEOSCAN",
                "format": "geoscan",
                "length": len(payload),
                "warning": (
                    "GEOSCAN image packet detected (syncword 0x316F6B6F). "
                    "Image payload is not parsed by the housekeeping decoder."
                ),
            }

        spec = _select_spec(len(payload), frame_size)
        result = _SPECS[spec]().parse(payload)
        if sat_name:
            result["satellite"] = sat_name
        return result


__all__ = ["GeoscanParser"]
