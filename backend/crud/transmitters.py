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
import traceback
import uuid
from datetime import datetime, timezone
from typing import Any, Union

from sqlalchemy import delete, insert, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from common.common import logger, serialize_object
from db.models import Transmitters

NULL_MARKERS = {"", "-", None}
UNSET = object()
TRANSMITTER_ID_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
TRANSMITTER_ID_BASE = len(TRANSMITTER_ID_ALPHABET)
TRANSMITTER_ID_LENGTH = 22


def _uuid_to_short_transmitter_id(value: uuid.UUID | str) -> str:
    """Encode a UUID as a SatNOGS-style 22-char transmitter id."""
    uid = value if isinstance(value, uuid.UUID) else uuid.UUID(str(value).strip())
    number = uid.int
    encoded = []

    while number:
        number, remainder = divmod(number, TRANSMITTER_ID_BASE)
        encoded.append(TRANSMITTER_ID_ALPHABET[remainder])

    if not encoded:
        encoded.append(TRANSMITTER_ID_ALPHABET[0])

    return "".join(reversed(encoded)).rjust(
        TRANSMITTER_ID_LENGTH,
        TRANSMITTER_ID_ALPHABET[0],
    )


def _is_null_marker(value: Any) -> bool:
    return value in NULL_MARKERS or (isinstance(value, str) and value.strip() in NULL_MARKERS)


def _normalize_identifier(value: Any) -> str:
    if _is_null_marker(value):
        return ""
    return " ".join(str(value).strip().split()).lower()


def _normalize_command_key(value: Any) -> str:
    return _normalize_identifier(value)


def normalize_target_key(value: Any) -> str | None:
    if _is_null_marker(value):
        return None
    text = str(value).strip()
    if not text or ":" not in text:
        return None

    prefix, raw_suffix = text.split(":", 1)
    normalized_prefix = str(prefix or "").strip().lower()
    suffix = ""

    if normalized_prefix == "body":
        suffix = _normalize_identifier(raw_suffix)
    elif normalized_prefix == "mission":
        suffix = _normalize_identifier(raw_suffix)
    elif normalized_prefix == "missioncmd":
        suffix = _normalize_command_key(raw_suffix)
    else:
        return None

    if not suffix:
        return None
    return f"{normalized_prefix}:{suffix}"


def build_target_key(
    *,
    target_type: Any,
    mission_id: Any = None,
    command: Any = None,
    body_id: Any = None,
) -> str | None:
    normalized_target_type = str(target_type or "").strip().lower()
    if normalized_target_type == "body":
        normalized_body_id = _normalize_identifier(body_id)
        return f"body:{normalized_body_id}" if normalized_body_id else None
    if normalized_target_type == "mission":
        normalized_mission_id = _normalize_identifier(mission_id)
        if normalized_mission_id:
            return f"mission:{normalized_mission_id}"
        normalized_command = _normalize_command_key(command)
        return f"missioncmd:{normalized_command}" if normalized_command else None
    return None


def _coerce_required_int(value: Any, field_name: str) -> int:
    if _is_null_marker(value):
        raise ValueError(f"{field_name} is required")
    if isinstance(value, bool):
        raise ValueError(f"{field_name} must be an integer")
    try:
        return int(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{field_name} must be an integer") from exc


def _coerce_optional_int(value: Any, field_name: str) -> int | None:
    if _is_null_marker(value):
        return None
    if isinstance(value, bool):
        raise ValueError(f"{field_name} must be an integer")
    try:
        return int(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{field_name} must be an integer") from exc


def _coerce_optional_bool(value: Any, field_name: str) -> bool | None:
    if _is_null_marker(value):
        return None
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"true", "1", "yes", "on"}:
            return True
        if normalized in {"false", "0", "no", "off"}:
            return False
    if isinstance(value, int) and value in {0, 1}:
        return bool(value)
    raise ValueError(f"{field_name} must be a boolean")


def _coerce_optional_str(value: Any) -> str | None:
    if _is_null_marker(value):
        return None
    return str(value)


def _coerce_optional_json(value: Any, field_name: str) -> Any | None:
    if _is_null_marker(value):
        return None
    parsed = value
    for _ in range(4):
        if isinstance(parsed, (dict, list, bool, int, float)) or parsed is None:
            return parsed
        if not isinstance(parsed, str):
            raise ValueError(f"{field_name} must be valid JSON")
        parsed_str = parsed.strip()
        if _is_null_marker(parsed_str):
            return None
        try:
            parsed = json.loads(parsed_str)
            continue
        except json.JSONDecodeError:
            # Handle legacy double-escaped JSON string payloads.
            if parsed_str.startswith('"') and parsed_str.endswith('"'):
                inner = parsed_str[1:-1]
                parsed = inner.replace('\\\\"', '"')
                continue
            raise ValueError(f"{field_name} must be valid JSON")
    raise ValueError(f"{field_name} must be valid JSON")


def _normalize_owner_fields(payload: dict, *, for_edit: bool = False) -> dict:
    satellite_id_value = payload.pop("satelliteId", UNSET)
    norad_cat_id_value = payload.pop("norad_cat_id", UNSET)
    target_key_value = payload.pop("target_key", UNSET)

    satellite_owner_provided = satellite_id_value is not UNSET or norad_cat_id_value is not UNSET
    target_owner_provided = target_key_value is not UNSET

    if for_edit and not satellite_owner_provided and not target_owner_provided:
        return payload

    if satellite_owner_provided and target_owner_provided:
        raise ValueError("Provide either satelliteId/norad_cat_id or target_key, not both")

    if satellite_owner_provided:
        satellite_owner_value = (
            satellite_id_value if satellite_id_value is not UNSET else norad_cat_id_value
        )
        payload["norad_cat_id"] = _coerce_required_int(satellite_owner_value, "satelliteId")
        payload["target_key"] = None
        return payload

    if target_owner_provided:
        normalized_target_key = normalize_target_key(target_key_value)
        if not normalized_target_key:
            raise ValueError(
                "target_key must be in one of: mission:<id>, missioncmd:<command>, body:<id>"
            )
        payload["norad_cat_id"] = None
        payload["target_key"] = normalized_target_key
        return payload

    raise ValueError("Either satelliteId/norad_cat_id or target_key is required")


def _normalize_transmitter_payload(data: dict, for_edit: bool = False) -> dict:
    payload = dict(data)
    payload = _normalize_owner_fields(payload, for_edit=for_edit)

    optional_int_fields = {
        "uplinkLow": "uplink_low",
        "uplinkHigh": "uplink_high",
        "downlinkLow": "downlink_low",
        "downlinkHigh": "downlink_high",
        "uplinkDrift": "uplink_drift",
        "downlinkDrift": "downlink_drift",
        "baud": "baud",
    }
    for source_key, target_key in optional_int_fields.items():
        if source_key in payload:
            payload[target_key] = _coerce_optional_int(payload.pop(source_key), source_key)
        elif not for_edit:
            payload[target_key] = None

    optional_bool_fields = {"alive": "alive", "invert": "invert"}
    for source_key, target_key in optional_bool_fields.items():
        if source_key in payload:
            payload[target_key] = _coerce_optional_bool(payload[source_key], source_key)
        elif not for_edit:
            payload[target_key] = None

    if "uplinkMode" in payload:
        payload["uplink_mode"] = _coerce_optional_str(payload.pop("uplinkMode"))
    elif not for_edit:
        payload["uplink_mode"] = None

    if "itu_notification" in payload:
        payload["itu_notification"] = _coerce_optional_json(
            payload.get("itu_notification"), "itu_notification"
        )
    elif not for_edit:
        payload["itu_notification"] = None

    return payload


async def fetch_transmitters_for_satellite(session: AsyncSession, norad_id: int) -> dict:
    """
    Fetch all transmitter records associated with the given satellite NORAD id.
    Matches by either norad_cat_id or norad_follow_id.
    """
    try:
        stmt = select(Transmitters).filter(
            (Transmitters.norad_cat_id == norad_id) | (Transmitters.norad_follow_id == norad_id)
        )
        result = await session.execute(stmt)
        transmitters = result.scalars().all()
        transmitters = serialize_object(transmitters)
        return {"success": True, "data": transmitters, "error": None}

    except Exception as e:
        logger.error(f"Error fetching transmitters for satellite {norad_id}: {e}")
        logger.error(traceback.format_exc())
        return {"success": False, "error": str(e)}


async def fetch_transmitters_for_target_key(session: AsyncSession, target_key: str) -> dict:
    """Fetch all transmitters associated with a non-satellite target key."""
    try:
        normalized_target_key = normalize_target_key(target_key)
        if not normalized_target_key:
            return {"success": True, "data": [], "error": None}

        stmt = select(Transmitters).filter(Transmitters.target_key == normalized_target_key)
        result = await session.execute(stmt)
        transmitters = serialize_object(result.scalars().all())
        return {"success": True, "data": transmitters, "error": None}
    except Exception as e:
        logger.error(f"Error fetching transmitters for target key {target_key}: {e}")
        logger.error(traceback.format_exc())
        return {"success": False, "error": str(e)}


async def fetch_transmitters_for_target_keys(session: AsyncSession, target_keys: list[str]) -> dict:
    """Fetch transmitters for multiple non-satellite target keys."""
    try:
        normalized_keys = []
        seen = set()
        for target_key in target_keys:
            normalized_key = normalize_target_key(target_key)
            if not normalized_key or normalized_key in seen:
                continue
            seen.add(normalized_key)
            normalized_keys.append(normalized_key)

        if not normalized_keys:
            return {"success": True, "data": {}, "error": None}

        stmt = select(Transmitters).filter(Transmitters.target_key.in_(normalized_keys))
        result = await session.execute(stmt)
        transmitters = serialize_object(result.scalars().all())

        grouped: dict[str, list[dict]] = {target_key: [] for target_key in normalized_keys}
        for row in transmitters:
            row_target_key = normalize_target_key(row.get("target_key"))
            if not row_target_key:
                continue
            grouped.setdefault(row_target_key, []).append(row)

        return {"success": True, "data": grouped, "error": None}
    except Exception as e:
        logger.error(f"Error fetching transmitters for target keys: {e}")
        logger.error(traceback.format_exc())
        return {"success": False, "error": str(e)}


async def fetch_transmitter(session: AsyncSession, transmitter_id: Union[uuid.UUID, str]) -> dict:
    """
    Fetch a single transmitter record by its UUID or string representation.
    """
    try:
        # Since transmitter.id is a string, convert UUID to string if needed
        if isinstance(transmitter_id, uuid.UUID):
            transmitter_id = str(transmitter_id)

        stmt = select(Transmitters).filter(
            or_(
                Transmitters.id == transmitter_id,
                Transmitters.source_transmitter_id == transmitter_id,
            )
        )
        result = await session.execute(stmt)
        transmitter = result.scalar_one_or_none()
        transmitter = serialize_object(transmitter)
        return {"success": True, "data": transmitter, "error": None}

    except Exception as e:
        logger.error(f"Error fetching transmitters by transmitter id {transmitter_id}: {e}")
        logger.error(traceback.format_exc())
        return {"success": False, "error": str(e)}


async def add_transmitter(session: AsyncSession, data: dict) -> dict:
    """
    Create and add a new transmitter record.
    """
    try:
        data = _normalize_transmitter_payload(data)
        new_id = _uuid_to_short_transmitter_id(uuid.uuid4())
        now = datetime.now(timezone.utc)
        data["id"] = new_id
        data["added"] = now
        data["updated"] = now

        if _is_null_marker(data.get("source")):
            data["source"] = "manual"

        stmt = insert(Transmitters).values(**data).returning(Transmitters)

        result = await session.execute(stmt)
        await session.commit()
        new_transmitter = result.scalar_one()
        new_transmitter = serialize_object(new_transmitter)
        return {"success": True, "data": new_transmitter, "error": None}

    except Exception as e:
        await session.rollback()
        logger.error(f"Error adding transmitter: {e}")
        logger.error(traceback.format_exc())
        return {"success": False, "error": str(e)}


async def edit_transmitter(session: AsyncSession, data: dict) -> dict:
    """
    Edit an existing transmitter record by updating provided fields.
    """
    try:
        transmitter_id = data.get("id")
        if not transmitter_id:
            return {"success": False, "error": "Transmitter id is required."}

        data = dict(data)
        data.pop("id", None)
        data.pop("added", None)
        data.pop("updated", None)

        data = _normalize_transmitter_payload(data, for_edit=True)

        # Ensure the record exists first
        stmt = select(Transmitters).filter(
            or_(
                Transmitters.id == transmitter_id,
                Transmitters.source_transmitter_id == transmitter_id,
            )
        )
        result = await session.execute(stmt)
        existing = result.scalar_one_or_none()
        if not existing:
            return {"success": False, "error": f"Transmitter with id {transmitter_id} not found."}

        # Add updated timestamp
        data["updated"] = datetime.now(timezone.utc)

        upd_stmt = (
            update(Transmitters)
            .where(Transmitters.id == existing.id)
            .values(**data)
            .returning(Transmitters)
        )
        upd_result = await session.execute(upd_stmt)
        await session.commit()
        updated_transmitter = upd_result.scalar_one_or_none()
        updated_transmitter = serialize_object(updated_transmitter)
        return {"success": True, "data": updated_transmitter, "error": None}

    except Exception as e:
        await session.rollback()
        logger.error(f"Error editing transmitter: {e}")
        logger.error(traceback.format_exc())
        return {"success": False, "error": str(e)}


async def delete_transmitter(session: AsyncSession, transmitter_id: Union[uuid.UUID, str]) -> dict:
    """
    Delete a transmitter record by its UUID or string representation of UUID.
    """
    try:
        logger.info(transmitter_id)

        del_stmt = (
            delete(Transmitters)
            .where(
                or_(
                    Transmitters.id == transmitter_id,
                    Transmitters.source_transmitter_id == transmitter_id,
                )
            )
            .returning(Transmitters)
        )
        result = await session.execute(del_stmt)
        deleted = result.scalar_one_or_none()
        if not deleted:
            return {"success": False, "error": f"Transmitter with id {transmitter_id} not found."}
        await session.commit()
        return {"success": True, "data": None, "error": None}

    except Exception as e:
        await session.rollback()
        logger.error(f"Error deleting transmitter: {e}")
        logger.error(traceback.format_exc())
        return {"success": False, "error": str(e)}
