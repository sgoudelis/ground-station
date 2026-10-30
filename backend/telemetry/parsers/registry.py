#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# Copyright (c) 2026 Efstratios Goudelis
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
Built-in telemetry payload parser registration.

This module centralizes parser registration so new payload parsers can be
added without modifying TelemetryParser internals.
"""

from __future__ import annotations

import logging
from typing import Any, Callable, Iterable, Tuple

from .colibri_s import ColibriSGeoscanAx25Parser
from .kaitai import KaitaiPayloadParser
from .lasarsat import LasarsatAx25Parser
from .usp import USPParser

logger = logging.getLogger("telemetry.parsers.registry")


def _iter_builtin_ax25_parsers() -> Iterable[Tuple[str, Callable[[], Any]]]:
    """
    Yield built-in AX.25 callsign-keyed payload parser bindings.

    Keys are matched by TelemetryParser against AX.25 source callsign variants.
    Values are zero-arg factories: plain parser classes or KaitaiPayloadParser
    adapters backed by specs/rs52s.ksy and friends.
    """
    return (
        ("RS18S", USPParser),
        ("RS40S", USPParser),
        ("RS52S", KaitaiPayloadParser.factory("rs52s", satellite="RS52S")),
        ("RS67S", ColibriSGeoscanAx25Parser),
        ("COLIBRI-S", ColibriSGeoscanAx25Parser),
        ("OK0LSR", LasarsatAx25Parser),
        ("DP0UWH", KaitaiPayloadParser.factory("uwe4", satellite="UWE-4")),
    )


def _iter_builtin_lora_parsers() -> Iterable[Tuple[str, Callable[[], Any]]]:
    """
    Yield built-in LoRa payload parser bindings keyed by satellite-name prefix.

    LoRa frames carry no callsign, so TelemetryParser matches these against
    the uppercase observation satellite name (sat_hint).
    """
    return (("TIANQI", KaitaiPayloadParser.factory("tianqi", satellite="Tianqi")),)


def register_builtin_payload_parsers(target: Any) -> None:
    """
    Register built-in payload parsers on a TelemetryParser-like target.

    The target is expected to expose:
      - `payload_parsers` dictionary
      - `register_payload_parser(identifier, parser)`
      - `lora_parsers` dictionary (LoRa keyed by satellite-name prefix)
    """
    for key, parser_factory in _iter_builtin_ax25_parsers():
        try:
            if ("ax25", key, None) in target.payload_parsers:
                continue
            target.register_payload_parser(key, parser_factory())
        except Exception as e:
            logger.warning("Failed to register payload parser '%s': %s", key, e)
    for key, parser_factory in _iter_builtin_lora_parsers():
        try:
            if key in target.lora_parsers:
                continue
            target.lora_parsers[key] = parser_factory()
        except Exception as e:
            logger.warning("Failed to register LoRa payload parser '%s': %s", key, e)
