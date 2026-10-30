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

"""Generic adapter exposing Kaitai (.ksy) payload specs as registry parsers.

Spec files live in ``specs/`` and their generated Python modules in ``gen/``
(regenerate with ``backend/kaitaigen.sh``). ``TelemetryParser`` only requires a
``parse(payload) -> dict`` method, so the registry can hold these instances
directly and ``telemetry/parser.py`` stays untouched.

Output envelope mirrors the hand-written parsers:
  {"satellite", "format": "kaitai", "length", "values": {...}, "field_info": {...}}
plus ``raw_fields`` for spec fields suffixed ``_raw``, and top-level
``time_unix_s``/``time_utc`` when the spec carries a unix timestamp.

Decoding is fail-fast by design (user decision 2026-10): truncated frames or
failed validations raise ValueError, which TelemetryParser turns into the hex
fallback, instead of emitting partially decoded values.
"""

from __future__ import annotations

import importlib
import struct
from datetime import datetime, timezone
from functools import partial
from io import BytesIO
from typing import Any, Callable, Dict, Optional

import kaitaistruct
from kaitaistruct import KaitaiStream, KaitaiStruct

from .presentation import field_info

# Exceptions that mean "this packet does not match the spec", not "bug in us".
_SPEC_MISMATCH = (EOFError, kaitaistruct.KaitaiStructError, struct.error, IndexError, UnicodeError)

# Per-spec generated classes, keyed by spec name.
_generated: Dict[str, Any] = {}


def load_generated_class(spec: str) -> Any:
    """Import and return the generated root class for one spec name."""
    cls = _generated.get(spec)
    if cls is None:
        module = importlib.import_module(f"telemetry.parsers.gen.{spec}")
        # The compiler CamelCases the spec id (rs52s -> Rs52s,
        # geoscan_type1_74 -> GeoscanType174); fall back to scanning for
        # the generated struct if that ever stops holding true.
        name = "".join(part[:1].upper() + part[1:] for part in spec.split("_"))
        cls = getattr(module, name, None)
        if cls is None:
            candidates = [
                obj
                for obj in vars(module).values()
                if isinstance(obj, type)
                and issubclass(obj, KaitaiStruct)
                and obj is not KaitaiStruct
                and obj.__module__ == module.__name__
            ]
            if len(candidates) != 1:
                raise ValueError(f"cannot locate generated class for spec '{spec}'")
            cls = candidates[0]
        _generated[spec] = cls
    return cls


def decode_spec(spec: str, payload: bytes) -> Any:
    """Parse one payload with a spec's generated class.

    Raises ValueError (the repo's spec-mismatch contract) on short or invalid
    data; returns the raw Kaitai struct so callers can pick their own view of
    fields (the generic adapter and USP consume it differently).
    """
    cls = load_generated_class(spec)
    try:
        return cls(KaitaiStream(BytesIO(payload)))
    except _SPEC_MISMATCH as exc:
        raise ValueError(f"{spec} payload mismatch: {exc}") from exc


def split_spec_fields(
    parsed: KaitaiStruct, spec: str = ""
) -> "tuple[Dict[str, Any], Dict[str, Any]]":
    """Split a parsed struct into (seq fields, computed instances), plain JSON.

    Seq-field dict keeps the spec's declaration order (vars() assignment
    order); instance values are computed lazily by the generated class.
    """
    raw: Dict[str, Any] = {}
    for name, value in vars(parsed).items():
        if not name.startswith("_"):
            raw[name] = KaitaiPayloadParser._plain(value)
    values: Dict[str, Any] = {}
    prefix = f"{spec} " if spec else ""
    for name in dir(type(parsed)):
        if name.startswith("_") or not isinstance(getattr(type(parsed), name), property):
            continue
        try:
            value = getattr(parsed, name)
        except _SPEC_MISMATCH as exc:
            raise ValueError(f"{prefix}instance '{name}' mismatch: {exc}") from exc
        if value is not None:
            values[name] = KaitaiPayloadParser._plain(value)
    return raw, values


class KaitaiPayloadParser:
    """Registry-compatible wrapper around one generated Kaitai struct."""

    # Explicit spec identifiers are independent of the adapter class name.
    SPEC: Optional[str] = None
    SATELLITE: Optional[str] = None

    def __init__(self, spec: Optional[str] = None, satellite: Optional[str] = None) -> None:
        spec_id = spec or self.SPEC
        if not spec_id:
            raise ValueError("KaitaiPayloadParser requires a spec name")
        # Narrow to str after validation so lookups below stay type-safe.
        self.spec: str = spec_id
        self.parser_id = spec_id
        self.legacy_name = spec_id[:1].upper() + spec_id[1:] + "Parser"
        self.satellite = satellite if satellite is not None else self.SATELLITE

    @classmethod
    def factory(
        cls, spec: str, satellite: Optional[str] = None
    ) -> Callable[[], "KaitaiPayloadParser"]:
        """Build a zero-arg callable for registry registration."""
        return partial(cls, spec=spec, satellite=satellite)

    def parse(self, payload: bytes) -> Dict[str, Any]:
        """Decode one payload into engineering units; ValueError if it mismatches."""
        parsed = decode_spec(self.spec, payload)
        values: Dict[str, Any] = {}
        raw_fields: Dict[str, Any] = {}
        self._flatten(parsed, self.spec, values, raw_fields)

        out: Dict[str, Any] = {
            "satellite": self.satellite or self.spec,
            "format": "kaitai",
            "spec": self.spec,
            "length": len(payload),
            "values": values,
            "field_info": field_info(self.spec, values),
        }
        if raw_fields:
            out["raw_fields"] = raw_fields
        # Keep the timestamp conveniences the hand-written parsers emitted.
        ts = values.get("time_unix_s", values.get("eps_time_unix_s"))
        if isinstance(ts, int):
            out["time_unix_s"] = ts
            try:
                out["time_utc"] = datetime.fromtimestamp(ts, tz=timezone.utc).strftime(
                    "%Y-%m-%d %H:%M:%S"
                )
            except (OverflowError, OSError, ValueError):
                pass
        return out

    @classmethod
    def _flatten(
        cls,
        node: KaitaiStruct,
        spec: str,
        values: Dict[str, Any],
        raw_fields: Dict[str, Any],
    ) -> None:
        """Walk a struct tree; ``*_raw`` fields go to raw_fields, rest to values.

        Sub-structs (switch-selected payloads such as UWE-4's hskp) are
        flattened into the same maps: telemetry consumers expect one flat
        value dict, not nested JSON. Computed instances are collected per
        node after that node's wire fields, preserving wire order overall.
        """
        for name, value in vars(node).items():
            if name.startswith("_"):
                continue
            if isinstance(value, KaitaiStruct):
                cls._flatten(value, spec, values, raw_fields)
            elif isinstance(value, list) and any(isinstance(v, KaitaiStruct) for v in value):
                for item in value:
                    if isinstance(item, KaitaiStruct):
                        cls._flatten(item, spec, values, raw_fields)
            elif name.endswith("_raw"):
                raw_fields[name] = cls._plain(value)
            else:
                values[name] = cls._plain(value)
        # Computed instances are lazy properties on the generated class.
        for name in dir(type(node)):
            if name.startswith("_") or not isinstance(getattr(type(node), name), property):
                continue
            try:
                value = getattr(node, name)
            except _SPEC_MISMATCH as exc:
                raise ValueError(f"{spec} instance '{name}' mismatch: {exc}") from exc
            if value is None or isinstance(value, KaitaiStruct):
                continue
            # setdefault: a wire field with the same name wins over an instance.
            if name.endswith("_raw"):
                raw_fields.setdefault(name, cls._plain(value))
            else:
                values.setdefault(name, cls._plain(value))

    @classmethod
    def _plain(cls, value: Any) -> Any:
        """Convert Kaitai values to JSON-safe plain Python."""
        if isinstance(value, KaitaiStruct):
            return {
                name: cls._plain(val)
                for name, val in vars(value).items()
                if not name.startswith("_")
            }
        if isinstance(value, (bytes, bytearray)):
            # Kaitai returns raw bytes for byte fields; hex keeps telemetry JSON-safe.
            return bytes(value).hex()
        if isinstance(value, list):
            return [cls._plain(item) for item in value]
        return value


__all__ = ["KaitaiPayloadParser", "decode_spec", "load_generated_class", "split_spec_fields"]
