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
import random
import re
import string
import traceback
import uuid
from typing import Any, Dict, List, Optional, Union
from urllib.parse import parse_qs, urlparse

from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from common.common import logger, serialize_object
from common.utils import convert_strings_to_uuids
from db.models import (
    Groups,
    OrbitalSources,
    OrbitalSourceSyncState,
    SatelliteGroupType,
    SatelliteOrbits,
    Satellites,
    Transmitters,
)
from tlesync.celestrak import (
    build_celestrak_gp_url,
    celestrak_group_from_url,
    is_celestrak_url,
    validate_celestrak_source,
)
from tlesync.sourcestate import clear_source_suspension
from tlesync.utils import normalize_satellite_ids

SUPPORTED_AUTH_TYPES = {"none", "basic", "token"}
SUPPORTED_QUERY_MODES = {"url"}
LEGACY_PROVIDER_ALIASES: Dict[str, str] = {}
SPACE_TRACK_GP_BASE_URL = "https://www.space-track.org/basicspacedata/query/class/gp"


def _clean_optional_text(value: Any) -> Optional[str]:
    if value is None:
        return None
    text = str(value).strip()
    return text if text else None


def _coerce_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered in {"1", "true", "yes", "on"}:
            return True
        if lowered in {"0", "false", "no", "off"}:
            return False
    raise ValueError(f"Invalid boolean value: {value}")


def _coerce_optional_uuid(value: Any) -> Optional[uuid.UUID]:
    if value is None:
        return None
    if isinstance(value, uuid.UUID):
        return value
    text = str(value).strip()
    if not text:
        return None
    return uuid.UUID(text)


def _infer_provider(url: Optional[str]) -> str:
    lowered = (url or "").lower()
    if is_celestrak_url(url):
        return "celestrak"
    if "space-track" in lowered:
        return "space_track"
    return "generic_http"


def _normalize_provider(provider: Optional[str], url: Optional[str]) -> str:
    normalized = (_clean_optional_text(provider) or _infer_provider(url)).lower()
    return LEGACY_PROVIDER_ALIASES.get(normalized, normalized)


def _infer_adapter(provider: str, source_format: str) -> str:
    if provider == "space_track":
        return "space_track_gp"
    if source_format == "omm":
        return "http_omm"
    return "http_3le"


def _normalize_norad_ids(value: Any) -> List[int]:
    candidate = value
    if isinstance(candidate, str):
        cleaned = candidate.strip()
        if not cleaned:
            return []
        try:
            parsed = json.loads(cleaned)
            if isinstance(parsed, str):
                candidate = re.split(r"[\s,]+", parsed.strip())
            else:
                candidate = parsed
        except json.JSONDecodeError:
            candidate = re.split(r"[\s,]+", cleaned)
    elif candidate is None:
        return []
    elif isinstance(candidate, (int, float)):
        candidate = [candidate]

    if not isinstance(candidate, (list, tuple, set)):
        return []

    normalized: List[int] = []
    seen: set[int] = set()
    for item in candidate:
        try:
            norad_id = int(item)
        except (TypeError, ValueError):
            continue
        if norad_id <= 0 or norad_id in seen:
            continue
        normalized.append(norad_id)
        seen.add(norad_id)
    return normalized


def _normalize_source_payload(payload: Dict[str, Any]) -> Dict[str, Any]:
    normalized = dict(payload)
    normalized["name"] = _clean_optional_text(normalized.get("name"))
    normalized["url"] = _clean_optional_text(normalized.get("url"))

    source_format = _clean_optional_text(normalized.get("format")) or "3le"
    normalized["format"] = source_format.lower()

    normalized["provider"] = _normalize_provider(normalized.get("provider"), normalized["url"])

    # CelesTrak is intentionally a constrained source type. The UI sends a
    # group selection; the server is still authoritative and builds the URL so
    # API callers cannot bypass the GP/CSV contract with a hand-written URL.
    if normalized["provider"] == "celestrak":
        selected_group = _clean_optional_text(normalized.pop("celestrak_group", None))
        if selected_group is None:
            selected_group = celestrak_group_from_url(normalized["url"] or "")
            existing_query = parse_qs(urlparse(normalized["url"] or "").query)
            if existing_query.get("FORMAT", [""])[0].lower() != "csv":
                raise ValueError("CelesTrak sources must request FORMAT=CSV")
        if selected_group is None:
            raise ValueError("CelesTrak sources require a supported source group")
        normalized["url"] = build_celestrak_gp_url(selected_group)
        normalized["format"] = "omm"
        normalized["adapter"] = "http_omm"
    elif is_celestrak_url(normalized["url"]):
        # Convert known canonical legacy URLs during their next edit. Unknown
        # historical CelesTrak URLs were disabled by the remediation migration
        # and must be recreated through the constrained source type.
        selected_group = celestrak_group_from_url(normalized["url"])
        if selected_group is None:
            raise ValueError("CelesTrak sources require a supported source group")
        normalized["provider"] = "celestrak"
        normalized["url"] = build_celestrak_gp_url(selected_group)
        normalized["format"] = "omm"
        normalized["adapter"] = "http_omm"

    query_mode = (_clean_optional_text(normalized.get("query_mode")) or "url").lower()
    if query_mode == "group_norad":
        query_mode = "url"
    if query_mode not in SUPPORTED_QUERY_MODES:
        raise ValueError(
            f"Invalid query_mode '{query_mode}'. Expected one of: {sorted(SUPPORTED_QUERY_MODES)}"
        )
    normalized["query_mode"] = query_mode
    normalized["group_id"] = _coerce_optional_uuid(normalized.get("group_id"))
    normalized["norad_ids"] = _normalize_norad_ids(normalized.get("norad_ids"))

    adapter = _clean_optional_text(normalized.get("adapter")) or _infer_adapter(
        normalized["provider"], normalized["format"]
    )
    normalized["adapter"] = adapter.lower()

    if normalized["provider"] == "celestrak":
        normalized["format"] = "omm"
        normalized["adapter"] = "http_omm"

    if is_celestrak_url(normalized["url"]):
        # CelesTrak is intentionally handled as a stricter subset of generic
        # HTTP sources. Other providers may continue to offer 3LE feeds.
        validate_celestrak_source(normalized["url"], normalized["format"], normalized["adapter"])

    if "enabled" in normalized:
        normalized["enabled"] = _coerce_bool(normalized.get("enabled"))
    else:
        normalized["enabled"] = True

    normalized["show_on_earth_view"] = _coerce_bool(normalized.get("show_on_earth_view", True))

    if "priority" in normalized and normalized.get("priority") is not None:
        normalized["priority"] = int(normalized["priority"])
    else:
        normalized["priority"] = 100

    # Non-Earth orbit propagation is not implemented. Keep this fixed even
    # for API callers so a source cannot be saved in an unusable state.
    normalized["central_body"] = "earth"

    auth_type = (_clean_optional_text(normalized.get("auth_type")) or "none").lower()
    if auth_type not in SUPPORTED_AUTH_TYPES:
        raise ValueError(
            f"Invalid auth_type '{auth_type}'. Expected one of: {sorted(SUPPORTED_AUTH_TYPES)}"
        )
    normalized["auth_type"] = auth_type

    normalized["username"] = _clean_optional_text(normalized.get("username"))
    normalized["password"] = _clean_optional_text(normalized.get("password"))

    raw_config = normalized.get("config")
    if raw_config is None:
        normalized["config"] = None
    elif isinstance(raw_config, (dict, list)):
        normalized["config"] = raw_config
    elif isinstance(raw_config, str):
        raw_config = raw_config.strip()
        if not raw_config:
            normalized["config"] = None
        else:
            parsed = json.loads(raw_config)
            if not isinstance(parsed, (dict, list)):
                raise ValueError("config must be a JSON object or JSON array")
            normalized["config"] = parsed
    else:
        raise ValueError("config must be a dict, list, JSON string, or null")

    if not normalized["name"]:
        raise ValueError("Missing required field: name")
    if normalized["provider"] == "space_track":
        normalized["url"] = normalized["url"] or SPACE_TRACK_GP_BASE_URL
    if not normalized["url"]:
        raise ValueError("Missing required field: url")

    if normalized["provider"] == "space_track":
        normalized["query_mode"] = "url"
        normalized["group_id"] = None
        normalized["adapter"] = "space_track_gp"
        if not normalized["norad_ids"]:
            raise ValueError("space_track sources require at least one NORAD ID in norad_ids")
        if auth_type != "basic":
            raise ValueError("space_track_gp adapter requires auth_type='basic'")
    else:
        normalized["norad_ids"] = None

    if auth_type == "none":
        normalized["username"] = None
        normalized["password"] = None
    elif auth_type == "basic":
        if not normalized["username"] or not normalized["password"]:
            raise ValueError("auth_type='basic' requires username and password")
    elif auth_type == "token":
        if not normalized["password"]:
            raise ValueError("auth_type='token' requires password field to hold the token value")

    allowed_fields = {column.name for column in OrbitalSources.__table__.columns}
    return {key: value for key, value in normalized.items() if key in allowed_fields}


def _serialize_source_sync_state(state: OrbitalSourceSyncState) -> Dict[str, Any]:
    """Expose suspension state without leaking source credentials or internals."""
    return {
        "last_success_at": state.last_success_at.isoformat() if state.last_success_at else None,
        "last_attempt_at": state.last_attempt_at.isoformat() if state.last_attempt_at else None,
        "last_http_status": state.last_http_status,
        "last_error": state.last_error,
        "suspended_at": state.suspended_at.isoformat() if state.suspended_at else None,
        "suspension_reason": state.suspension_reason,
    }


async def _attach_source_sync_state(session: AsyncSession, sources: Any) -> None:
    """Attach persistent source status to serialized API records in-place."""
    source_records = sources if isinstance(sources, list) else [sources]
    source_ids = []
    for record in source_records:
        if not isinstance(record, dict) or not record.get("id"):
            continue
        try:
            source_ids.append(uuid.UUID(str(record["id"])))
        except (TypeError, ValueError):
            continue
    if not source_ids:
        return
    result = await session.execute(
        select(OrbitalSourceSyncState).where(OrbitalSourceSyncState.source_id.in_(source_ids))
    )
    states = {str(state.source_id): state for state in result.scalars().all()}
    for record in source_records:
        if not isinstance(record, dict):
            continue
        state = states.get(str(record.get("id")))
        record["sync_state"] = _serialize_source_sync_state(state) if state else None


async def fetch_satellite_tle_source(
    session: AsyncSession, satellite_tle_source_id: Optional[Union[uuid.UUID, str]] = None
) -> dict:
    """
    Retrieve satellite TLE source records.
    If an ID is provided, fetch the specific record; otherwise, return all sources.
    """
    try:
        if satellite_tle_source_id is None:
            result = await session.execute(select(OrbitalSources))
            sources = result.scalars().all()
            sources = json.loads(json.dumps(sources, default=serialize_object))
            sources = serialize_object(sources)
            await _attach_source_sync_state(session, sources)
            return {"success": True, "data": sources}

        else:
            # Convert to UUID if it's a string
            if isinstance(satellite_tle_source_id, str):
                satellite_tle_source_id = uuid.UUID(satellite_tle_source_id)

            result = await session.execute(
                select(OrbitalSources).filter(OrbitalSources.id == satellite_tle_source_id)
            )
            source = result.scalars().first()
            if source:
                source = serialize_object(source)
                await _attach_source_sync_state(session, source)
                return {"success": True, "data": source}

            return {"success": False, "error": "Satellite TLE source not found"}

    except Exception as e:
        logger.error(f"Error fetching satellite TLE source: {e}")
        logger.error(traceback.format_exc())
        return {"success": False, "error": str(e)}


async def add_satellite_tle_source(session: AsyncSession, payload: dict) -> dict:
    """
    Create a new satellite TLE source record with the provided payload.
    """
    try:
        payload = dict(payload or {})

        # Generate random identifier string
        payload["identifier"] = "".join(random.choices(string.ascii_letters, k=16))

        payload.pop("added", None)
        payload.pop("updated", None)
        payload.pop("id", None)

        payload = _normalize_source_payload(payload)

        new_source = OrbitalSources(**payload)
        session.add(new_source)
        await session.commit()
        await session.refresh(new_source)
        new_source = serialize_object(new_source)
        return {"success": True, "data": new_source}

    except Exception as e:
        await session.rollback()
        logger.error(f"Error adding satellite TLE source: {e}")
        logger.error(traceback.format_exc())
        return {"success": False, "error": str(e)}


async def edit_satellite_tle_source(
    session: AsyncSession, satellite_tle_source_id: str, payload: dict
) -> dict:
    """
    Update an existing satellite TLE source record with new values provided in payload.
    Returns a result object containing the updated record or an error message.
    """
    try:
        payload = dict(payload or {})
        payload.pop("added", None)
        payload.pop("updated", None)
        payload.pop("id", None)
        payload.pop("identifier", None)
        source_id = uuid.UUID(satellite_tle_source_id)

        result = await session.execute(
            select(OrbitalSources).filter(OrbitalSources.id == source_id)
        )
        source = result.scalars().first()
        if not source:
            return {"success": False, "error": "Satellite TLE source not found"}

        was_enabled = bool(source.enabled)
        merged_payload = {
            column.name: getattr(source, column.name) for column in OrbitalSources.__table__.columns
        }
        merged_payload.update(payload)
        normalized_payload = _normalize_source_payload(merged_payload)

        for key, value in normalized_payload.items():
            if key in {"id", "identifier", "added", "updated"}:
                continue
            if hasattr(source, key):
                setattr(source, key, value)

        # Apply shortcut visibility immediately, even when the next sync is deferred.
        await session.execute(
            update(Groups)
            .where(
                Groups.identifier == source.identifier,
                Groups.type == SatelliteGroupType.SYSTEM,
            )
            .values(show_on_earth_view=source.show_on_earth_view)
        )

        await session.commit()
        await session.refresh(source)
        if not was_enabled and source.enabled:
            # Re-enabling a source is the user's explicit acknowledgement that
            # a previously suspended configuration has been corrected.
            await clear_source_suspension(session, source.id)
        source = serialize_object(source)
        return {"success": True, "data": source}

    except Exception as e:
        await session.rollback()
        logger.error(f"Error editing satellite TLE source: {e}")
        logger.error(traceback.format_exc())
        return {"success": False, "error": str(e)}


async def delete_satellite_tle_sources(
    session: AsyncSession, satellite_tle_source_ids: Union[List[str], dict]
) -> dict:
    """
    Deletes multiple satellite TLE source records using their IDs.
    Removes the selected sources and their system groups. Member satellites,
    transmitters, and orbits are deleted only if no remaining source lists them.
    """
    try:
        assert isinstance(satellite_tle_source_ids, list), "TLE source list must be a list"

        source_ids = convert_strings_to_uuids(satellite_tle_source_ids)

        # Fetch sources that match the provided IDs
        result = await session.execute(
            select(OrbitalSources).filter(OrbitalSources.id.in_(source_ids))
        )
        sources = result.scalars().all()

        # Determine which IDs were found
        found_ids = [source.id for source in sources]
        not_found_ids = [source_id for source_id in source_ids if source_id not in found_ids]

        if not sources:
            return {"success": False, "error": "None of the Satellite TLE sources were found."}

        # Exclude the entire selection up front: sources being deleted together
        # must not preserve each other's members. Disabled sources still own data.
        remaining_groups_result = await session.execute(
            select(Groups)
            .join(OrbitalSources, Groups.identifier == OrbitalSources.identifier)
            .where(
                Groups.type == SatelliteGroupType.SYSTEM,
                OrbitalSources.id.not_in(found_ids),
            )
        )
        retained_satellite_ids = {
            norad_id
            for group in remaining_groups_result.scalars().all()
            for norad_id in normalize_satellite_ids(group.satellite_ids)
        }

        deletion_summary = []

        for source in sources:
            source_identifier = source.identifier
            source_name = source.name

            # User groups can reuse an identifier; only the system group belongs
            # to this source and should be removed with it.
            group_result = await session.execute(
                select(Groups).filter(
                    Groups.identifier == source_identifier,
                    Groups.type == SatelliteGroupType.SYSTEM,
                )
            )
            satellite_group = group_result.scalar_one_or_none()

            satellites_deleted = 0
            transmitters_deleted = 0
            group_deleted = False

            if satellite_group:
                # Normalize legacy JSON/string IDs before comparing memberships.
                satellite_norad_ids = [
                    norad_id
                    for norad_id in normalize_satellite_ids(satellite_group.satellite_ids)
                    if norad_id not in retained_satellite_ids
                ]

                if satellite_norad_ids:
                    # First, delete all transmitters associated with these satellites
                    # to avoid foreign key constraint violations
                    transmitters_result = await session.execute(
                        select(Transmitters).filter(
                            Transmitters.norad_cat_id.in_(satellite_norad_ids)
                        )
                    )
                    transmitters_to_delete = transmitters_result.scalars().all()

                    for transmitter in transmitters_to_delete:
                        await session.delete(transmitter)
                        transmitters_deleted += 1

                    # Remove every orbit model and central body explicitly because
                    # SQLite connections may not enforce ON DELETE CASCADE.
                    await session.execute(
                        delete(SatelliteOrbits).where(
                            SatelliteOrbits.satellite_norad_id.in_(satellite_norad_ids)
                        )
                    )

                    # Now delete all satellites that came from this TLE source
                    satellites_result = await session.execute(
                        select(Satellites).filter(Satellites.norad_id.in_(satellite_norad_ids))
                    )
                    satellites_to_delete = satellites_result.scalars().all()

                    for satellite in satellites_to_delete:
                        await session.delete(satellite)
                        satellites_deleted += 1

            # Retained orbits keep their data even if this source supplied it.
            # Only detach their provenance before removing the source record.
            await session.execute(
                update(SatelliteOrbits)
                .where(SatelliteOrbits.source_id == source.id)
                .values(source_id=None)
            )
            # Explicit cleanup also works when SQLite cascades are disabled.
            await session.execute(
                delete(OrbitalSourceSyncState).where(OrbitalSourceSyncState.source_id == source.id)
            )
            await session.delete(source)
            # Delete the source before its group because group_id can reference it.
            # Flush stays inside this transaction, so any later failure rolls back all sources.
            await session.flush()

            if satellite_group:
                await session.delete(satellite_group)
                group_deleted = True

            deletion_summary.append(
                {
                    "source_id": str(source.id),
                    "source_name": source_name,
                    "source_identifier": source_identifier,
                    "transmitters_deleted": transmitters_deleted,
                    "satellites_deleted": satellites_deleted,
                    "group_deleted": group_deleted,
                }
            )

        # Commit the changes
        await session.commit()

        # Construct a success message
        total_transmitters_deleted = sum(item["transmitters_deleted"] for item in deletion_summary)
        total_satellites_deleted = sum(item["satellites_deleted"] for item in deletion_summary)
        total_groups_deleted = sum(1 for item in deletion_summary if item["group_deleted"])

        message = (
            f"Successfully deleted {len(found_ids)} TLE source(s), "
            f"{total_transmitters_deleted} transmitter(s), "
            f"{total_satellites_deleted} satellite(s), and "
            f"{total_groups_deleted} satellite group(s)."
        )

        if not_found_ids:
            message += f" The following TLE source IDs were not found: {not_found_ids}."

        return {"success": True, "data": message, "deletion_summary": deletion_summary}

    except Exception as e:
        await session.rollback()
        logger.error(f"Error deleting satellite TLE sources: {e}")
        logger.error(traceback.format_exc())
        return {"success": False, "error": str(e)}


async def fetch_orbital_source(
    session: AsyncSession, orbital_source_id: Optional[Union[uuid.UUID, str]] = None
) -> dict:
    """Domain-accurate alias for fetching orbital sources."""
    return await fetch_satellite_tle_source(session, orbital_source_id)


async def add_orbital_source(session: AsyncSession, payload: dict) -> dict:
    """Domain-accurate alias for creating orbital sources."""
    return await add_satellite_tle_source(session, payload)


async def edit_orbital_source(session: AsyncSession, orbital_source_id: str, payload: dict) -> dict:
    """Domain-accurate alias for updating orbital sources."""
    return await edit_satellite_tle_source(session, orbital_source_id, payload)


async def delete_orbital_sources(
    session: AsyncSession, orbital_source_ids: Union[List[str], dict]
) -> dict:
    """Domain-accurate alias for deleting orbital sources."""
    return await delete_satellite_tle_sources(session, orbital_source_ids)
