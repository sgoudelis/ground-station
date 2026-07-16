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
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Union

from pydantic.v1 import UUID4
from sqlalchemy import String, and_, delete, func, insert, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from common.common import logger, serialize_object
from crud.groups import fetch_satellite_group
from db.models import Groups, SatelliteGroupType, SatelliteOrbits, Satellites, Transmitters

DATETIME_FIELDS = {"decayed", "launched", "deployed", "added", "updated"}
SUPPORTED_CENTRAL_BODIES = {"earth", "moon", "mars"}
SUPPORTED_ORBIT_MODEL_KINDS = {"tle", "omm"}


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

    tle1 = str(payload.get("tle1") or fallback_tle1 or "").strip()
    tle2 = str(payload.get("tle2") or fallback_tle2 or "").strip()
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
        # Current runtime OMM compatibility path still propagates from TLE.
        if not tle1 or not tle2:
            raise ValueError(
                "OMM editing currently requires orbit.tle1 and orbit.tle2 for runtime propagation compatibility"
            )

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
                added=now_value,
                updated=now_value,
            )
        )
        return

    orbit_row.model_kind = orbit_payload["model_kind"]
    orbit_row.epoch = orbit_payload["epoch"]
    orbit_row.tle1 = orbit_payload["tle1"]
    orbit_row.tle2 = orbit_payload["tle2"]
    orbit_row.omm_payload = orbit_payload["omm_payload"]
    orbit_row.source_id = orbit_payload["source_id"]
    orbit_row.source_object_id = orbit_payload["source_object_id"]
    orbit_row.source_updated_at = orbit_payload["source_updated_at"]
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

        # Fetch transmitters for each satellite and add group_id
        for satellite in satellites:
            stmt = select(Transmitters).filter(Transmitters.norad_cat_id == satellite["norad_id"])
            result = await session.execute(stmt)
            transmitters = result.scalars().all()
            satellite["transmitters"] = serialize_object(transmitters)
            # Add the group_id to each satellite object
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


async def search_satellites(session: AsyncSession, keyword: Union[str, int, None]) -> dict:
    """
    Fetch satellite records.

    If 'keyword' is provided, return a list of satellite records that have a matching norad_id
    or part of it, or a name or part of it. Otherwise, return all satellite records.
    Each satellite will include information about which groups it belongs to.
    """
    try:
        if keyword is None:
            stmt = select(Satellites)
        else:
            keyword_raw = str(keyword).strip()
            if not keyword_raw:
                stmt = select(Satellites)
            else:
                # Keep phrase lookup for backwards compatibility, but add tokenized matching
                # so phrases like "GPS PRN 04" match names such as "GPS ... (PRN 04)".
                phrase_pattern = f"%{keyword_raw}%"
                phrase_filter = or_(
                    Satellites.norad_id.cast(String).ilike(phrase_pattern),
                    Satellites.name.ilike(phrase_pattern),
                    Satellites.name_other.ilike(phrase_pattern),
                    Satellites.alternative_name.ilike(phrase_pattern),
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
                        variant_filters.append(
                            or_(
                                Satellites.norad_id.cast(String).ilike(pattern),
                                Satellites.name.ilike(pattern),
                                Satellites.name_other.ilike(pattern),
                                Satellites.alternative_name.ilike(pattern),
                            )
                        )

                    if variant_filters:
                        token_filters.append(or_(*variant_filters))

                if token_filters:
                    combined_filter = or_(phrase_filter, and_(*token_filters))
                else:
                    combined_filter = phrase_filter

                stmt = select(Satellites).filter(combined_filter)
        result = await session.execute(stmt)
        satellites = result.scalars().all()
        satellites = serialize_object(satellites)
        await _attach_primary_earth_orbits(session, satellites)

        # For each satellite, find which groups it belongs to
        for satellite in satellites:
            norad_id = satellite["norad_id"]

            # Get all groups and filter them in Python since JSON querying can be database-specific
            all_groups_stmt = select(Groups)
            all_groups_result = await session.execute(all_groups_stmt)
            all_groups = all_groups_result.scalars().all()

            # Filter groups that contain this satellite's NORAD ID
            matching_groups = []
            for group in all_groups:
                if group.satellite_ids and norad_id in group.satellite_ids:
                    matching_groups.append(group)

            # Sort groups by number of member satellites (fewer first)
            matching_groups.sort(key=lambda g: len(g.satellite_ids) if g.satellite_ids else 0)

            # Add group information to the satellite
            satellite["groups"] = serialize_object(matching_groups) if matching_groups else []

        return {"success": True, "data": satellites, "error": None}

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

        return {
            "success": True,
            "data": {
                "satellites": int(satellites_count or 0),
                "groups": int(groups_count or 0),
                "user_groups": int(user_groups_count or 0),
                "system_groups": int(system_groups_count or 0),
                "satellite_transmitters": int(satellite_transmitters_count or 0),
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
        allowed_fields = {column.name for column in Satellites.__table__.columns}
        data = {key: value for key, value in data.items() if key in allowed_fields}

        # Validate required fields
        required_fields = ["name", "norad_id", "tle1", "tle2"]
        for field in required_fields:
            if field not in data:
                raise ValueError(f"Missing required field: {field}")

        now = datetime.now(timezone.utc)
        data["source"] = data.get("source") or "manual"
        data["added"] = now
        data["updated"] = now

        stmt = insert(Satellites).values(**data).returning(Satellites)
        result = await session.execute(stmt)
        orbit_payload = _normalize_orbit_payload(
            {
                "central_body": "earth",
                "model_kind": "tle",
                "tle1": data.get("tle1"),
                "tle2": data.get("tle2"),
                "source_object_id": str(data.get("norad_id") or ""),
            },
            satellite_id=int(data["norad_id"]),
        )
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
    First deletes all associated transmitters due to foreign key constraint.
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
