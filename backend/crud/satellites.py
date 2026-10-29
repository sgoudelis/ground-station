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

import json
import re
import traceback
import uuid
from datetime import datetime, time, timezone
from typing import Any, Dict, List, Optional, Union

from pydantic.v1 import UUID4
from sqlalchemy import String, and_, delete, exists, func, insert, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from common.common import logger, serialize_object
from common.orbitcompat import export_omm_tle
from crud.groups import fetch_satellite_group
from db.models import Groups, SatelliteGroupType, SatelliteOrbits, Satellites, Transmitters

DATETIME_FIELDS = {"decayed", "launched", "deployed", "added", "updated"}
SUPPORTED_CENTRAL_BODIES = {"earth", "moon", "mars"}
SUPPORTED_ORBIT_MODEL_KINDS = {"tle", "omm"}
TRANSMITTER_LOOKUP_CHUNK_SIZE = 400

# These boundaries mirror the labels shown in the catalog. Keeping the values
# in hertz lets band and custom-range filters share the same overlap logic.
CATALOG_FREQUENCY_BANDS = {
    "ELF": (3, 30),
    "SLF": (30, 300),
    "ULF": (300, 3_000),
    "VLF": (3_000, 30_000),
    "LF": (30_000, 300_000),
    "MF": (300_000, 3_000_000),
    "HF": (3_000_000, 30_000_000),
    "VHF": (30_000_000, 300_000_000),
    "UHF": (300_000_000, 1_000_000_000),
    "L-band": (1_000_000_000, 2_000_000_000),
    "S-band": (2_000_000_000, 4_000_000_000),
    "C-band": (4_000_000_000, 8_000_000_000),
    "X-band": (8_000_000_000, 12_000_000_000),
    "Ku-band": (12_000_000_000, 18_000_000_000),
    "K-band": (18_000_000_000, 27_000_000_000),
    "Ka-band": (27_000_000_000, 40_000_000_000),
    "V-band": (40_000_000_000, 75_000_000_000),
    "W-band": (75_000_000_000, 110_000_000_000),
    "mm-band": (110_000_000_000, 300_000_000_000),
}


def _coerce_datetime(value):
    if value is None:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)
    if isinstance(value, str):
        if not value.strip():
            return None
        try:
            if value.endswith("Z"):
                value = value.replace("Z", "+00:00")
            return datetime.fromisoformat(value)
        except ValueError:
            logger.warning(f"Failed to parse datetime value: {value}")
            return None
    return value


def _coerce_optional_text(value: Any) -> Optional[str]:
    if value is None:
        return None
    text = str(value).strip()
    return text if text else None


def _coerce_optional_int(value: Any) -> Optional[int]:
    if value is None:
        return None
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, int):
        return value
    text = str(value).strip()
    if not text:
        return None
    try:
        return int(text)
    except ValueError:
        return None


def _coerce_optional_uuid(value: Any) -> Optional[uuid.UUID]:
    if value is None:
        return None
    if isinstance(value, uuid.UUID):
        return value
    text = str(value).strip()
    if not text:
        return None
    return uuid.UUID(text)


def _coerce_optional_json_dict(value: Any) -> Optional[Dict[str, Any]]:
    if value is None:
        return None
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        parsed = json.loads(text)
        if isinstance(parsed, dict):
            return parsed
    raise ValueError("orbit.omm_payload must be a JSON object")


def _normalize_orbit_payload(
    payload: Dict[str, Any],
    satellite_id: int,
    fallback_tle1: Optional[str] = None,
    fallback_tle2: Optional[str] = None,
) -> Dict[str, Any]:
    if not isinstance(payload, dict):
        raise ValueError("orbit payload must be an object")

    model_kind = (
        str(payload.get("model_kind") or payload.get("orbit_format") or "tle").strip().lower()
    )
    if model_kind not in SUPPORTED_ORBIT_MODEL_KINDS:
        raise ValueError(
            f"Invalid orbit model_kind '{model_kind}'. Expected one of: {sorted(SUPPORTED_ORBIT_MODEL_KINDS)}"
        )

    central_body = str(payload.get("central_body") or "earth").strip().lower()
    if central_body not in SUPPORTED_CENTRAL_BODIES:
        raise ValueError(
            f"Invalid orbit central_body '{central_body}'. Expected one of: {sorted(SUPPORTED_CENTRAL_BODIES)}"
        )

    # An explicitly empty field clears the previous compatibility cache.
    raw_tle1 = payload["tle1"] if "tle1" in payload else fallback_tle1
    raw_tle2 = payload["tle2"] if "tle2" in payload else fallback_tle2
    tle1: Optional[str] = str(raw_tle1 or "").strip() or None
    tle2: Optional[str] = str(raw_tle2 or "").strip() or None
    epoch = _coerce_datetime(payload.get("epoch") or payload.get("orbit_epoch"))
    omm_payload = _coerce_optional_json_dict(payload.get("omm_payload"))
    source_id = _coerce_optional_uuid(payload.get("source_id"))
    source_object_id = _coerce_optional_text(payload.get("source_object_id")) or str(satellite_id)
    source_updated_at = _coerce_datetime(payload.get("source_updated_at"))

    if model_kind == "tle":
        if not tle1:
            raise ValueError("Missing required field: orbit.tle1")
        if not tle2:
            raise ValueError("Missing required field: orbit.tle2")
        omm_payload = None
    else:
        if omm_payload is None:
            raise ValueError("Missing required field: orbit.omm_payload")
        # Never retain TLE lines from the previous orbit when OMM becomes canonical.
        # For representable catalogue numbers, derive the cache from these OMM elements.
        if central_body == "earth":
            tle1, tle2 = export_omm_tle(omm_payload, satellite_id)
        else:
            tle1, tle2 = None, None

    return {
        "central_body": central_body,
        "model_kind": model_kind,
        "epoch": epoch,
        "tle1": tle1 or None,
        "tle2": tle2 or None,
        "omm_payload": omm_payload,
        "source_id": source_id,
        "source_object_id": source_object_id,
        "source_updated_at": source_updated_at,
    }


async def _upsert_satellite_orbit(
    session: AsyncSession,
    satellite_id: int,
    orbit_payload: Dict[str, Any],
    now: Optional[datetime] = None,
) -> None:
    central_body = orbit_payload["central_body"]
    now_value = now or datetime.now(timezone.utc)
    orbit_result = await session.execute(
        select(SatelliteOrbits).filter(
            SatelliteOrbits.satellite_norad_id == satellite_id,
            SatelliteOrbits.central_body == central_body,
        )
    )
    orbit_row = orbit_result.scalar_one_or_none()
    if orbit_row is None:
        session.add(
            SatelliteOrbits(
                satellite_norad_id=satellite_id,
                central_body=central_body,
                model_kind=orbit_payload["model_kind"],
                epoch=orbit_payload["epoch"],
                tle1=orbit_payload["tle1"],
                tle2=orbit_payload["tle2"],
                omm_payload=orbit_payload["omm_payload"],
                source_id=orbit_payload["source_id"],
                source_object_id=orbit_payload["source_object_id"],
                source_updated_at=orbit_payload["source_updated_at"],
                first_seen_at=now_value,
                changed_at=now_value,
                added=now_value,
                updated=now_value,
            )
        )
        return

    previous_content = (
        orbit_row.model_kind,
        orbit_row.epoch,
        orbit_row.tle1,
        orbit_row.tle2,
        orbit_row.omm_payload,
    )
    next_content = (
        orbit_payload["model_kind"],
        orbit_payload["epoch"],
        orbit_payload["tle1"],
        orbit_payload["tle2"],
        orbit_payload["omm_payload"],
    )
    orbit_row.model_kind = orbit_payload["model_kind"]
    orbit_row.epoch = orbit_payload["epoch"]
    orbit_row.tle1 = orbit_payload["tle1"]
    orbit_row.tle2 = orbit_payload["tle2"]
    orbit_row.omm_payload = orbit_payload["omm_payload"]
    orbit_row.source_id = orbit_payload["source_id"]
    orbit_row.source_object_id = orbit_payload["source_object_id"]
    orbit_row.source_updated_at = orbit_payload["source_updated_at"]
    if previous_content != next_content:
        orbit_row.changed_at = now_value
    orbit_row.updated = now_value


async def _attach_primary_earth_orbits(
    session: AsyncSession, satellites: List[Dict[str, Any]]
) -> None:
    if not satellites:
        return

    norad_ids: List[int] = []
    for satellite in satellites:
        norad_id = _coerce_optional_int(satellite.get("norad_id"))
        if norad_id is None:
            continue
        norad_ids.append(norad_id)

    if not norad_ids:
        return

    orbit_result = await session.execute(
        select(SatelliteOrbits).filter(
            SatelliteOrbits.central_body == "earth",
            SatelliteOrbits.satellite_norad_id.in_(norad_ids),
        )
    )
    orbit_rows = orbit_result.scalars().all()
    orbit_by_norad: Dict[int, Dict[str, Any]] = {}
    for orbit_row in orbit_rows:
        orbit_by_norad[int(orbit_row.satellite_norad_id)] = serialize_object(orbit_row)

    for satellite in satellites:
        norad_id = _coerce_optional_int(satellite.get("norad_id"))
        if norad_id is None:
            continue

        orbit = orbit_by_norad.get(norad_id)
        if orbit is None:
            satellite.setdefault("orbit_format", "tle")
            satellite.setdefault("orbit_model_kind", "tle")
            satellite.setdefault("orbit_central_body", "earth")
            satellite.setdefault("orbit_epoch", None)
            satellite.setdefault("orbit_payload", None)
            satellite.setdefault("orbit_fetched_at", None)
            satellite.setdefault("orbit_first_seen_at", None)
            satellite.setdefault("orbit_changed_at", None)
            continue

        model_kind = str(orbit.get("model_kind") or "tle").strip().lower() or "tle"
        satellite["orbit_format"] = model_kind
        satellite["orbit_model_kind"] = model_kind
        satellite["orbit_central_body"] = str(orbit.get("central_body") or "earth").strip().lower()
        satellite["orbit_epoch"] = orbit.get("epoch")
        satellite["orbit_payload"] = orbit.get("omm_payload")
        satellite["orbit_source_id"] = orbit.get("source_id")
        satellite["orbit_source_object_id"] = orbit.get("source_object_id")
        satellite["orbit_source_updated_at"] = orbit.get("source_updated_at")
        satellite["orbit_fetched_at"] = orbit.get("fetched_at")
        satellite["orbit_first_seen_at"] = orbit.get("first_seen_at")
        satellite["orbit_changed_at"] = orbit.get("changed_at")
        if orbit.get("tle1"):
            satellite["tle1"] = orbit["tle1"]
        if orbit.get("tle2"):
            satellite["tle2"] = orbit["tle2"]


async def fetch_satellites_for_group_id(session: AsyncSession, group_id: Union[str, UUID4]) -> dict:
    """
    Fetch satellite records for the given group id along with their transmitters

    If 'satellite_id' is provided, return a single satellite record.
    Otherwise, return all satellite records with their associated transmitters.
    """
    try:
        assert group_id is not None, "group_id is required"
        if isinstance(group_id, str):
            group_id = uuid.UUID(group_id)
        elif not isinstance(group_id, uuid.UUID):
            raise ValueError(f"group_id must be a string or UUID, got {type(group_id)}")

        group = await fetch_satellite_group(session, group_id)

        if not group or not group.get("data"):
            logger.warning(f"Group with ID {group_id} not found or has no data")
            return {"success": True, "data": [], "error": None}

        satellite_ids = group["data"].get("satellite_ids") or []

        # Fetch satellites
        stmt = select(Satellites).filter(Satellites.norad_id.in_(satellite_ids))
        result = await session.execute(stmt)
        satellites = result.scalars().all()
        satellites = serialize_object(satellites)
        await _attach_primary_earth_orbits(session, satellites)

        # Auto-heal stale group references (satellites removed from DB but still present in group JSON)
        existing_satellite_ids = {satellite["norad_id"] for satellite in satellites}
        cleaned_satellite_ids = [sid for sid in satellite_ids if sid in existing_satellite_ids]
        if len(cleaned_satellite_ids) != len(satellite_ids):
            group_row = await session.get(Groups, group_id)
            if group_row:
                group_row.satellite_ids = cleaned_satellite_ids
                await session.commit()

        # Fetch transmitters in bounded batches. Large system groups can contain
        # thousands of satellites, so querying once per member is prohibitively slow.
        transmitters_by_norad: Dict[int, Dict[str, Dict[str, Any]]] = {
            satellite["norad_id"]: {} for satellite in satellites
        }
        if existing_satellite_ids:
            satellite_id_list = list(existing_satellite_ids)
            # Keep each statement below SQLite's conservative bind-variable limit.
            for start in range(0, len(satellite_id_list), TRANSMITTER_LOOKUP_CHUNK_SIZE):
                satellite_id_chunk = satellite_id_list[
                    start : start + TRANSMITTER_LOOKUP_CHUNK_SIZE
                ]
                transmitter_stmt = select(Transmitters).filter(
                    or_(
                        Transmitters.norad_cat_id.in_(satellite_id_chunk),
                        Transmitters.norad_follow_id.in_(satellite_id_chunk),
                    )
                )
                transmitter_result = await session.execute(transmitter_stmt)
                transmitters = serialize_object(transmitter_result.scalars().all())
                for transmitter in transmitters:
                    for field in ("norad_cat_id", "norad_follow_id"):
                        norad_id = transmitter.get(field)
                        if norad_id in transmitters_by_norad:
                            transmitters_by_norad[norad_id][transmitter["id"]] = transmitter

        for satellite in satellites:
            satellite["transmitters"] = list(transmitters_by_norad[satellite["norad_id"]].values())
            satellite["group_id"] = str(group_id)

        return {"success": True, "data": satellites, "error": None}

    except Exception as e:
        logger.error(
            "Error fetching satellite(s): %s (input_type=%s input=%r)",
            e,
            type(group_id).__name__,
            group_id,
        )
        logger.error(traceback.format_exc())
        return {"success": False, "error": str(e)}


def _catalog_text_list(value: Any) -> List[str]:
    """Normalize a catalog multi-select payload without accepting nested values."""
    values = value if isinstance(value, list) else [value]
    return [str(item).strip() for item in values if item is not None and str(item).strip()]


def _catalog_int(value: Any) -> Optional[int]:
    """Return a non-negative integer used by catalog numeric filters."""
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed >= 0 else None


def _catalog_date(value: Any, *, end_of_day: bool = False) -> Optional[datetime]:
    """Parse the date-only values emitted by the catalog filter controls."""
    text = str(value or "").strip()
    if not text:
        return None
    try:
        parsed_date = datetime.fromisoformat(text).date()
    except ValueError:
        return None
    boundary = time.max if end_of_day else time.min
    return datetime.combine(parsed_date, boundary, tzinfo=timezone.utc)


def _catalog_transmitter_owner_filter():
    """Match direct transmitters and records following a satellite's NORAD id."""
    return or_(
        Transmitters.norad_cat_id == Satellites.norad_id,
        Transmitters.norad_follow_id == Satellites.norad_id,
    )


def _catalog_frequency_overlap(
    low_column,
    high_column,
    minimum: Optional[int],
    maximum: Optional[int],
    *,
    maximum_exclusive: bool = False,
):
    """Match point frequencies and transmitter ranges that overlap optional bounds."""
    conditions = [low_column.is_not(None)]
    if maximum is not None:
        if maximum_exclusive:
            conditions.append(low_column < maximum)
        else:
            conditions.append(low_column <= maximum)
    if minimum is not None:
        conditions.append(func.coalesce(high_column, low_column) >= minimum)
    return and_(*conditions)


def _catalog_directional_frequency_filter(
    direction: str,
    minimum: Optional[int],
    maximum: Optional[int],
    *,
    maximum_exclusive: bool = False,
):
    downlink = _catalog_frequency_overlap(
        Transmitters.downlink_low,
        Transmitters.downlink_high,
        minimum,
        maximum,
        maximum_exclusive=maximum_exclusive,
    )
    uplink = _catalog_frequency_overlap(
        Transmitters.uplink_low,
        Transmitters.uplink_high,
        minimum,
        maximum,
        maximum_exclusive=maximum_exclusive,
    )
    if direction == "uplink":
        return uplink
    if direction == "either":
        return or_(downlink, uplink)
    return downlink


def _catalog_transmitter_conditions(filters: Dict[str, Any]) -> List[Any]:
    """Build conditions that one transmitter must satisfy as a unit."""
    conditions: List[Any] = []
    direction = str(filters.get("direction") or "downlink").strip().lower()
    if direction not in {"downlink", "uplink", "either"}:
        direction = "downlink"

    bands = _catalog_text_list(filters.get("bands"))
    band_ranges: List[tuple[int, int]] = []
    for band in bands:
        band_range = CATALOG_FREQUENCY_BANDS.get(band)
        if band_range is not None:
            band_ranges.append(band_range)
    if band_ranges:
        conditions.append(
            or_(
                *[
                    _catalog_directional_frequency_filter(
                        direction,
                        minimum,
                        maximum,
                        maximum_exclusive=True,
                    )
                    for minimum, maximum in band_ranges
                ]
            )
        )

    frequency_min = _catalog_int(filters.get("frequency_min_hz"))
    frequency_max = _catalog_int(filters.get("frequency_max_hz"))
    if frequency_min is not None or frequency_max is not None:
        if (
            frequency_min is not None
            and frequency_max is not None
            and frequency_min > frequency_max
        ):
            frequency_min, frequency_max = frequency_max, frequency_min
        conditions.append(
            _catalog_directional_frequency_filter(direction, frequency_min, frequency_max)
        )

    modes = [value.lower() for value in _catalog_text_list(filters.get("modes"))]
    if modes:
        conditions.append(func.lower(Transmitters.mode).in_(modes))

    transmitter_types = [
        value.lower() for value in _catalog_text_list(filters.get("transmitter_types"))
    ]
    if transmitter_types:
        conditions.append(func.lower(Transmitters.type).in_(transmitter_types))

    services = [value.lower() for value in _catalog_text_list(filters.get("services"))]
    if services:
        conditions.append(func.lower(Transmitters.service).in_(services))

    baud_min = _catalog_int(filters.get("baud_min"))
    baud_max = _catalog_int(filters.get("baud_max"))
    if baud_min is not None and baud_max is not None and baud_min > baud_max:
        baud_min, baud_max = baud_max, baud_min
    if baud_min is not None:
        conditions.append(Transmitters.baud >= baud_min)
    if baud_max is not None:
        conditions.append(Transmitters.baud <= baud_max)

    transmitter_state = str(filters.get("transmitter_state") or "").strip().lower()
    if transmitter_state == "active":
        conditions.append(Transmitters.alive.is_(True))
    elif transmitter_state == "inactive":
        conditions.append(Transmitters.alive.is_(False))

    if filters.get("unconfirmed") is True:
        conditions.append(Transmitters.unconfirmed.is_(True))

    return conditions


async def _attach_catalog_transmitters(
    session: AsyncSession,
    satellites: List[Dict[str, Any]],
) -> None:
    """Attach all transmitter rows with bounded queries instead of one query per satellite."""
    satellite_ids = [
        int(satellite["norad_id"])
        for satellite in satellites
        if satellite.get("norad_id") is not None
    ]
    transmitters_by_norad: Dict[int, Dict[str, Dict[str, Any]]] = {
        norad_id: {} for norad_id in satellite_ids
    }
    for start in range(0, len(satellite_ids), TRANSMITTER_LOOKUP_CHUNK_SIZE):
        chunk = satellite_ids[start : start + TRANSMITTER_LOOKUP_CHUNK_SIZE]
        result = await session.execute(
            select(Transmitters).filter(
                or_(
                    Transmitters.norad_cat_id.in_(chunk),
                    Transmitters.norad_follow_id.in_(chunk),
                )
            )
        )
        for transmitter in serialize_object(result.scalars().all()):
            for owner_field in ("norad_cat_id", "norad_follow_id"):
                owner_id = transmitter.get(owner_field)
                if owner_id in transmitters_by_norad:
                    transmitters_by_norad[owner_id][transmitter["id"]] = transmitter

    for satellite in satellites:
        satellite["transmitters"] = list(
            transmitters_by_norad.get(int(satellite["norad_id"]), {}).values()
        )


async def search_satellites(
    session: AsyncSession,
    keyword: Union[str, int, None],
    filters: Optional[Dict[str, Any]] = None,
) -> dict:
    """
    Fetch satellite records.

    If 'keyword' is provided, return satellite records that have a matching NORAD id,
    name, or transmitter property. Structured catalog requests can include page,
    page_size, and sorting fields; enrichment then runs only for that SQL page.
    Autocomplete callers without page_size receive 20 matches by default, capped at 50.
    """
    try:
        catalog_filters = filters if isinstance(filters, dict) else {}
        stmt = select(Satellites)
        satellite_conditions: List[Any] = []

        keyword_raw = str(keyword or "").strip()
        if keyword_raw:
            # Keep phrase lookup for backwards compatibility, but add tokenized matching
            # so phrases like "GPS PRN 04" match names such as "GPS ... (PRN 04)".
            phrase_pattern = f"%{keyword_raw}%"
            transmitter_phrase_filter = exists(
                select(1)
                .select_from(Transmitters)
                .where(
                    _catalog_transmitter_owner_filter(),
                    or_(
                        Transmitters.id.ilike(phrase_pattern),
                        Transmitters.source_transmitter_id.ilike(phrase_pattern),
                        Transmitters.description.ilike(phrase_pattern),
                        Transmitters.mode.ilike(phrase_pattern),
                        Transmitters.type.ilike(phrase_pattern),
                        Transmitters.service.ilike(phrase_pattern),
                    ),
                )
            )
            phrase_filter = or_(
                Satellites.norad_id.cast(String).ilike(phrase_pattern),
                Satellites.name.ilike(phrase_pattern),
                Satellites.name_other.ilike(phrase_pattern),
                Satellites.alternative_name.ilike(phrase_pattern),
                transmitter_phrase_filter,
            )

            raw_tokens = [tok for tok in re.findall(r"[A-Za-z0-9]+", keyword_raw) if tok]
            token_filters = []
            for token in raw_tokens:
                variants = [token]

                # Expand compact PRN formats such as E29/J195 so they can match "(PRN 29)".
                prn_compact_match = re.fullmatch(r"[A-Za-z](\d{1,3})", token)
                if prn_compact_match:
                    digits = prn_compact_match.group(1)
                    variants.append(digits)
                    if len(digits) == 1:
                        variants.append(digits.zfill(2))

                if token.isdigit():
                    stripped = token.lstrip("0")
                    if stripped and stripped != token:
                        variants.append(stripped)

                variant_filters = []
                for variant in dict.fromkeys(variants):
                    pattern = f"%{variant}%"
                    transmitter_token_filter = exists(
                        select(1)
                        .select_from(Transmitters)
                        .where(
                            _catalog_transmitter_owner_filter(),
                            or_(
                                Transmitters.id.ilike(pattern),
                                Transmitters.source_transmitter_id.ilike(pattern),
                                Transmitters.description.ilike(pattern),
                                Transmitters.mode.ilike(pattern),
                                Transmitters.type.ilike(pattern),
                                Transmitters.service.ilike(pattern),
                            ),
                        )
                    )
                    variant_filters.append(
                        or_(
                            Satellites.norad_id.cast(String).ilike(pattern),
                            Satellites.name.ilike(pattern),
                            Satellites.name_other.ilike(pattern),
                            Satellites.alternative_name.ilike(pattern),
                            transmitter_token_filter,
                        )
                    )

                if variant_filters:
                    token_filters.append(or_(*variant_filters))

            if token_filters:
                combined_filter = or_(phrase_filter, and_(*token_filters))
            else:
                combined_filter = phrase_filter
            satellite_conditions.append(combined_filter)

        status = str(catalog_filters.get("status") or "").strip().lower()
        if status:
            satellite_conditions.append(func.lower(Satellites.status) == status)

        country = str(catalog_filters.get("country") or "").strip().upper()
        if country:
            normalized_countries = func.replace(func.upper(Satellites.countries), " ", "")
            satellite_conditions.append(
                or_(
                    normalized_countries == country,
                    normalized_countries.like(f"{country},%"),
                    normalized_countries.like(f"%,{country},%"),
                    normalized_countries.like(f"%,{country}"),
                )
            )

        source = str(catalog_filters.get("source") or "").strip().lower()
        if source:
            satellite_conditions.append(func.lower(Satellites.source) == source)

        launched_from = _catalog_date(catalog_filters.get("launched_from"))
        launched_to = _catalog_date(catalog_filters.get("launched_to"), end_of_day=True)
        if launched_from is not None:
            satellite_conditions.append(Satellites.launched >= launched_from)
        if launched_to is not None:
            satellite_conditions.append(Satellites.launched <= launched_to)

        group_id = str(catalog_filters.get("group_id") or "").strip()
        if group_id:
            try:
                group_result = await fetch_satellite_group(session, uuid.UUID(group_id))
                group_data = group_result.get("data") if group_result.get("success") else None
                group_satellite_ids = (group_data or {}).get("satellite_ids") or []
            except (TypeError, ValueError):
                group_satellite_ids = []
            satellite_conditions.append(Satellites.norad_id.in_(group_satellite_ids))

        transmitter_conditions = _catalog_transmitter_conditions(catalog_filters)
        transmitter_state = str(catalog_filters.get("transmitter_state") or "").strip().lower()
        requires_transmitter = bool(transmitter_conditions) or transmitter_state == "any"
        transmitter_exists = exists(
            select(1)
            .select_from(Transmitters)
            .where(
                _catalog_transmitter_owner_filter(),
                *transmitter_conditions,
            )
        )
        if transmitter_state == "none":
            satellite_conditions.append(
                ~exists(
                    select(1).select_from(Transmitters).where(_catalog_transmitter_owner_filter())
                )
            )
            if transmitter_conditions:
                # No transmitter can also satisfy an RF or transmitter-property constraint.
                satellite_conditions.append(transmitter_exists)
        elif requires_transmitter:
            satellite_conditions.append(transmitter_exists)

        if catalog_filters.get("frequency_violation") is True:
            satellite_conditions.append(
                or_(
                    Satellites.is_frequency_violator.is_(True),
                    exists(
                        select(1)
                        .select_from(Transmitters)
                        .where(
                            _catalog_transmitter_owner_filter(),
                            Transmitters.frequency_violation.is_(True),
                        )
                    ),
                )
            )

        if satellite_conditions:
            stmt = stmt.filter(*satellite_conditions)

        pagination_requested = "page_size" in catalog_filters
        page = _catalog_int(catalog_filters.get("page")) or 0
        requested_page_size = _catalog_int(catalog_filters.get("page_size"))
        page_size = min(max(requested_page_size or 10, 1), 100)

        if pagination_requested:
            count_stmt = select(func.count()).select_from(Satellites)
            if satellite_conditions:
                count_stmt = count_stmt.filter(*satellite_conditions)
            total = int(await session.scalar(count_stmt) or 0)
        else:
            total = 0

        if pagination_requested:
            sort_field = str(catalog_filters.get("sort_field") or "name").strip().lower()
            sort_direction = str(catalog_filters.get("sort_direction") or "asc").strip().lower()
            transmitter_count = (
                select(func.count(Transmitters.id))
                .where(_catalog_transmitter_owner_filter())
                .correlate(Satellites)
                .scalar_subquery()
            )
            earth_orbit_epoch = (
                select(SatelliteOrbits.epoch)
                .where(
                    SatelliteOrbits.satellite_norad_id == Satellites.norad_id,
                    SatelliteOrbits.central_body == "earth",
                )
                .correlate(Satellites)
                .scalar_subquery()
            )
            earth_orbit_fetched_at = (
                select(SatelliteOrbits.fetched_at)
                .where(
                    SatelliteOrbits.satellite_norad_id == Satellites.norad_id,
                    SatelliteOrbits.central_body == "earth",
                )
                .correlate(Satellites)
                .scalar_subquery()
            )
            earth_orbit_first_seen_at = (
                select(SatelliteOrbits.first_seen_at)
                .where(
                    SatelliteOrbits.satellite_norad_id == Satellites.norad_id,
                    SatelliteOrbits.central_body == "earth",
                )
                .correlate(Satellites)
                .scalar_subquery()
            )
            earth_orbit_changed_at = (
                select(SatelliteOrbits.changed_at)
                .where(
                    SatelliteOrbits.satellite_norad_id == Satellites.norad_id,
                    SatelliteOrbits.central_body == "earth",
                )
                .correlate(Satellites)
                .scalar_subquery()
            )
            sort_columns = {
                "name": func.lower(Satellites.name),
                "alternative_names": func.lower(
                    func.coalesce(
                        func.nullif(func.trim(Satellites.alternative_name), ""),
                        func.nullif(func.trim(Satellites.name_other), ""),
                        "",
                    )
                ),
                "norad_id": Satellites.norad_id,
                "status": func.lower(Satellites.status),
                "countries": func.lower(Satellites.countries),
                "operator": func.lower(Satellites.operator),
                "transmitters": transmitter_count,
                "decayed": Satellites.decayed,
                "launched": Satellites.launched,
                "deployed": Satellites.deployed,
                "updated": Satellites.updated,
                "orbit_epoch": earth_orbit_epoch,
                "orbit_fetched_at": earth_orbit_fetched_at,
                "orbit_first_seen_at": earth_orbit_first_seen_at,
                "orbit_changed_at": earth_orbit_changed_at,
            }
            sort_column = sort_columns.get(sort_field, sort_columns["name"])
            ordering = sort_column.desc() if sort_direction == "desc" else sort_column.asc()
            stmt = stmt.order_by(ordering, Satellites.norad_id.asc())
            stmt = stmt.offset(page * page_size).limit(page_size)
        else:
            # Bound autocomplete work in SQL before orbit, transmitter, and group enrichment.
            limit = min(_catalog_int(catalog_filters.get("limit")) or 20, 50)
            stmt = stmt.order_by(func.lower(Satellites.name), Satellites.norad_id).limit(limit)

        result = await session.execute(stmt)
        satellites = result.scalars().all()
        satellites = serialize_object(satellites)
        if not pagination_requested:
            total = len(satellites)
        await _attach_primary_earth_orbits(session, satellites)

        # The table needs full transmitter records for band chips, matching
        # details, and edit actions after the server has narrowed satellites.
        await _attach_catalog_transmitters(session, satellites)

        # Fetch groups once and attach membership in memory. The previous loop
        # repeated the same groups query once for every search result.
        all_groups_result = await session.execute(select(Groups))
        all_groups = all_groups_result.scalars().all()
        for satellite in satellites:
            norad_id = satellite["norad_id"]
            matching_groups = []
            for group in all_groups:
                if group.satellite_ids and norad_id in group.satellite_ids:
                    matching_groups.append(group)

            # Sort groups by number of member satellites (fewer first)
            matching_groups.sort(key=lambda g: len(g.satellite_ids) if g.satellite_ids else 0)

            # Add group information to the satellite
            satellite["groups"] = serialize_object(matching_groups) if matching_groups else []

        return {
            "success": True,
            "data": satellites,
            "total": total,
            "page": page,
            "page_size": page_size if pagination_requested else total,
            "error": None,
        }

    except Exception as e:
        logger.error(f"Error fetching satellite(s): {e}")
        logger.error(traceback.format_exc())
        return {"success": False, "error": str(e)}


async def fetch_satellites(
    session: AsyncSession, norad_id: Union[str, int, List[int], None]
) -> dict:
    """
    Fetch satellite records.

    If 'satellite_id' is provided as a single value, return the corresponding satellite record.
    If 'satellite_id' is a list, return all matching satellite records.
    Otherwise, return all satellite records.
    """
    try:
        if norad_id is None:
            # return all
            stmt = select(Satellites)
            result = await session.execute(stmt)
            satellites = result.scalars().all()

        elif isinstance(norad_id, list):
            # return all in list
            stmt = select(Satellites).filter(Satellites.norad_id.in_(norad_id))
            result = await session.execute(stmt)
            satellites = result.scalars().all()

        else:
            # return only the one
            stmt = select(Satellites).filter(Satellites.norad_id == norad_id)
            result = await session.execute(stmt)
            satellite = result.scalar_one_or_none()
            satellites = [satellite] if satellite else []

        satellites = serialize_object(satellites)
        await _attach_primary_earth_orbits(session, satellites)
        return {"success": True, "data": satellites, "error": None}

    except Exception as e:
        logger.error(f"Error fetching satellite(s): {e}")
        logger.error(traceback.format_exc())
        return {"success": False, "error": str(e)}


async def fetch_satellite_catalog_stats(session: AsyncSession) -> dict:
    """Fetch compact aggregate stats used by the satellite catalog UI."""
    try:
        satellites_count = await session.scalar(select(func.count()).select_from(Satellites))
        groups_count = await session.scalar(select(func.count()).select_from(Groups))
        user_groups_count = await session.scalar(
            select(func.count()).select_from(Groups).where(Groups.type == SatelliteGroupType.USER)
        )
        system_groups_count = await session.scalar(
            select(func.count()).select_from(Groups).where(Groups.type == SatelliteGroupType.SYSTEM)
        )
        satellite_transmitters_count = await session.scalar(
            select(func.count())
            .select_from(Transmitters)
            .where(Transmitters.norad_cat_id.is_not(None))
        )

        async def distinct_values(column) -> List[str]:
            result = await session.execute(select(column).where(column.is_not(None)).distinct())
            return sorted(
                {str(value).strip() for value in result.scalars().all() if str(value).strip()},
                key=str.casefold,
            )

        country_rows = await distinct_values(Satellites.countries)
        countries = sorted(
            {
                country.strip()
                for row in country_rows
                for country in row.split(",")
                if country.strip()
            },
            key=str.casefold,
        )
        sources = await distinct_values(Satellites.source)
        statuses = await distinct_values(Satellites.status)
        modes = await distinct_values(Transmitters.mode)
        transmitter_types = await distinct_values(Transmitters.type)
        services = await distinct_values(Transmitters.service)

        return {
            "success": True,
            "data": {
                "satellites": int(satellites_count or 0),
                "groups": int(groups_count or 0),
                "user_groups": int(user_groups_count or 0),
                "system_groups": int(system_groups_count or 0),
                "satellite_transmitters": int(satellite_transmitters_count or 0),
                "countries": countries,
                "sources": sources,
                "statuses": statuses,
                "modes": modes,
                "transmitter_types": transmitter_types,
                "services": services,
            },
            "error": None,
        }
    except Exception as e:
        logger.error(f"Error fetching satellite catalog stats: {e}")
        logger.error(traceback.format_exc())
        return {"success": False, "data": {}, "error": str(e)}


async def add_satellite(session: AsyncSession, data: dict) -> dict:
    """
    Create and add a new satellite record.
    """
    try:
        orbit_payload_raw = data.get("orbit") if isinstance(data, dict) else None
        allowed_fields = {column.name for column in Satellites.__table__.columns}
        data = {key: value for key, value in data.items() if key in allowed_fields}

        # Validate required fields
        required_fields = ["name", "norad_id"]
        if orbit_payload_raw is None:
            required_fields.extend(["tle1", "tle2"])
        for field in required_fields:
            if field not in data:
                raise ValueError(f"Missing required field: {field}")

        orbit_payload = _normalize_orbit_payload(
            orbit_payload_raw
            or {
                "central_body": "earth",
                "model_kind": "tle",
                "tle1": data.get("tle1"),
                "tle2": data.get("tle2"),
                "source_object_id": str(data.get("norad_id") or ""),
            },
            satellite_id=int(data["norad_id"]),
            fallback_tle1=data.get("tle1"),
            fallback_tle2=data.get("tle2"),
        )
        if orbit_payload["central_body"] == "earth":
            # The legacy columns are a cache only. OMM-only records leave it
            # empty rather than fabricating a lossy TLE representation.
            data["tle1"] = orbit_payload["tle1"]
            data["tle2"] = orbit_payload["tle2"]

        now = datetime.now(timezone.utc)
        data["source"] = data.get("source") or "manual"
        data["added"] = now
        data["updated"] = now

        stmt = insert(Satellites).values(**data).returning(Satellites)
        result = await session.execute(stmt)
        await _upsert_satellite_orbit(
            session, satellite_id=int(data["norad_id"]), orbit_payload=orbit_payload, now=now
        )
        await session.commit()
        new_satellite = result.scalar_one()
        new_satellite = serialize_object(new_satellite)
        satellite_list = [new_satellite]
        await _attach_primary_earth_orbits(session, satellite_list)
        return {"success": True, "data": new_satellite, "error": None}

    except IntegrityError as e:
        await session.rollback()
        if "UNIQUE constraint failed: satellites.norad_id" in str(e):
            return {
                "success": False,
                "error": f"Satellite with NORAD ID {data.get('norad_id')} already exists.",
            }
        logger.error(f"Error adding satellite: {e}")
        logger.error(traceback.format_exc())
        return {"success": False, "error": "Failed to add satellite due to a database constraint."}
    except Exception as e:
        await session.rollback()
        logger.error(f"Error adding satellite: {e}")
        logger.error(traceback.format_exc())
        return {"success": False, "error": str(e)}


async def edit_satellite(session: AsyncSession, satellite_id: uuid.UUID, **kwargs) -> dict:
    """
    Edit an existing satellite record by updating provided fields.
    """
    try:
        try:
            normalized_satellite_id = int(satellite_id)
        except (TypeError, ValueError):
            return {"success": False, "error": f"Invalid satellite id: {satellite_id}"}

        orbit_payload_raw = kwargs.pop("orbit", None)
        allowed_fields = {column.name for column in Satellites.__table__.columns}
        kwargs = {key: value for key, value in kwargs.items() if key in allowed_fields}
        for field in DATETIME_FIELDS:
            if field in kwargs:
                kwargs[field] = _coerce_datetime(kwargs[field])

        # Check if the satellite exists
        stmt = select(Satellites).filter(Satellites.norad_id == normalized_satellite_id)
        result = await session.execute(stmt)
        satellite = result.scalar_one_or_none()
        if not satellite:
            return {
                "success": False,
                "error": f"Satellite with id {normalized_satellite_id} not found.",
            }

        normalized_orbit_payload = None
        if orbit_payload_raw is not None:
            normalized_orbit_payload = _normalize_orbit_payload(
                orbit_payload_raw,
                satellite_id=normalized_satellite_id,
                fallback_tle1=satellite.tle1,
                fallback_tle2=satellite.tle2,
            )
            if normalized_orbit_payload["central_body"] == "earth":
                # Keep legacy compatibility columns synced with the canonical Earth orbit row.
                kwargs["tle1"] = normalized_orbit_payload["tle1"]
                kwargs["tle2"] = normalized_orbit_payload["tle2"]
        elif "tle1" in kwargs or "tle2" in kwargs:
            normalized_orbit_payload = _normalize_orbit_payload(
                {
                    "central_body": "earth",
                    "model_kind": "tle",
                    "tle1": kwargs.get("tle1", satellite.tle1),
                    "tle2": kwargs.get("tle2", satellite.tle2),
                    "source_object_id": str(normalized_satellite_id),
                },
                satellite_id=normalized_satellite_id,
                fallback_tle1=satellite.tle1,
                fallback_tle2=satellite.tle2,
            )

        # Set the updated timestamp
        now = datetime.now(timezone.utc)
        kwargs["updated"] = now

        upd_stmt = (
            update(Satellites)
            .where(Satellites.norad_id == normalized_satellite_id)
            .values(**kwargs)
            .returning(Satellites)
        )
        upd_result = await session.execute(upd_stmt)
        if normalized_orbit_payload is not None:
            await _upsert_satellite_orbit(
                session,
                satellite_id=normalized_satellite_id,
                orbit_payload=normalized_orbit_payload,
                now=now,
            )
        await session.commit()
        updated_satellite = upd_result.scalar_one_or_none()
        updated_satellite = serialize_object(updated_satellite)
        satellite_list = [updated_satellite] if updated_satellite else []
        await _attach_primary_earth_orbits(session, satellite_list)
        return {"success": True, "data": updated_satellite, "error": None}

    except Exception as e:
        await session.rollback()
        logger.error(f"Error editing satellite {satellite_id}: {e}")
        logger.error(traceback.format_exc())
        return {"success": False, "error": str(e)}


async def delete_satellite(session: AsyncSession, satellite_id: Union[int, str]) -> dict:
    """
    Delete a satellite record by its NORAD ID.
    First deletes all associated transmitters and orbits in the same transaction.
    Also removes the NORAD ID from any satellite group memberships.
    """
    try:
        if isinstance(satellite_id, str):
            satellite_id = int(satellite_id.strip())
        elif not isinstance(satellite_id, int):
            raise ValueError(
                f"satellite_id must be an int or numeric string, got {type(satellite_id)}"
            )

        # First, delete all transmitters associated with this satellite
        transmitters_stmt = delete(Transmitters).where(Transmitters.norad_cat_id == satellite_id)
        await session.execute(transmitters_stmt)

        # Remove satellite membership from all groups that reference this NORAD ID
        groups_stmt = select(Groups)
        groups_result = await session.execute(groups_stmt)
        groups = groups_result.scalars().all()
        for group in groups:
            if group.satellite_ids and satellite_id in group.satellite_ids:
                group.satellite_ids = [sid for sid in group.satellite_ids if sid != satellite_id]

        # SQLite connections may not enforce ON DELETE CASCADE, so remove all
        # orbit models and central bodies explicitly before deleting the parent.
        await session.execute(
            delete(SatelliteOrbits).where(SatelliteOrbits.satellite_norad_id == satellite_id)
        )

        # Then delete the satellite
        satellite_stmt = (
            delete(Satellites).where(Satellites.norad_id == satellite_id).returning(Satellites)
        )
        result = await session.execute(satellite_stmt)
        deleted = result.scalar_one_or_none()

        if not deleted:
            return {"success": False, "error": f"Satellite with id {satellite_id} not found."}

        await session.commit()
        return {"success": True, "data": None, "error": None}

    except Exception as e:
        await session.rollback()
        logger.error(f"Error deleting satellite {satellite_id}: {e}")
        logger.error(traceback.format_exc())
        return {"success": False, "error": str(e)}
