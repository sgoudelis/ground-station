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

import traceback
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Union, cast

from sqlalchemy import and_, delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from common.common import logger, serialize_object
from db.models import Preferences, PreferenceScope, TrackingState, UserRole, Users

INTEGRATION_PREFERENCE_DEFAULTS: Dict[str, str] = {
    "stadia_maps_api_key": "",  # Stadia map tiles API key used by frontend map providers.
    "gemini_api_key": "",  # Google Gemini API key for transcription
    "deepgram_api_key": "",  # Deepgram API key for transcription
    "google_translate_api_key": "",  # Google Cloud Translation API key for translating Deepgram transcriptions
}

INTEGRATION_PREFERENCE_KEYS = tuple(INTEGRATION_PREFERENCE_DEFAULTS.keys())

USER_PREFERENCE_DEFAULTS: Dict[str, str] = {
    "timezone": "Europe/Athens",
    "locale": "browser",  # Locale for date/time/number formatting (e.g., en-US, en-GB, el-GR)
    "language": "en_US",
    "theme": "auto",
    "toast_position": "bottom-center",
    **INTEGRATION_PREFERENCE_DEFAULTS,
}

SYSTEM_PREFERENCE_DEFAULTS: Dict[str, str] = {}


def _to_uuid(value: Union[uuid.UUID, str]) -> uuid.UUID:
    if isinstance(value, uuid.UUID):
        return value
    return uuid.UUID(str(value))


def _combined_preferences(
    defaults: Dict[str, str], rows: List[Preferences]
) -> List[Dict[str, Any]]:
    rows_by_name = {str(row.name): row for row in rows}
    combined = [
        {
            "id": rows_by_name[key].id if key in rows_by_name else None,
            "name": key,
            "value": rows_by_name[key].value if key in rows_by_name else value,
        }
        for key, value in defaults.items()
    ]
    return cast(List[Dict[str, Any]], serialize_object(combined))


def _normalize_preference_value(value: object) -> str:
    if value is None:
        return ""
    return str(value)


async def fetch_preference(session: AsyncSession, preference_id: Union[uuid.UUID, str]) -> dict:
    """Fetch a single preference by UUID."""
    try:
        preference_uuid = _to_uuid(preference_id)
        stmt = select(Preferences).filter(Preferences.id == preference_uuid)
        result = await session.execute(stmt)
        preference = serialize_object(result.scalar_one_or_none())
        return {"success": True, "data": preference, "error": None}
    except Exception as exc:
        logger.error(f"Error fetching preference: {exc}")
        logger.error(traceback.format_exc())
        return {"success": False, "error": str(exc)}


async def fetch_user_preferences(session: AsyncSession, user_id: Union[uuid.UUID, str]) -> dict:
    """Fetch user-scoped preferences for a specific authenticated user."""
    try:
        user_uuid = _to_uuid(user_id)
        stmt = select(Preferences).where(
            and_(
                Preferences.scope == PreferenceScope.USER.value,
                Preferences.user_id == user_uuid,
            )
        )
        result = await session.execute(stmt)
        rows = result.scalars().all()
        return {
            "success": True,
            "data": _combined_preferences(USER_PREFERENCE_DEFAULTS, rows),
            "error": None,
        }
    except Exception as exc:
        logger.error(f"Error fetching user preferences: {exc}")
        logger.error(traceback.format_exc())
        return {"success": False, "error": str(exc)}


async def fetch_system_preferences(session: AsyncSession) -> dict:
    """Fetch global system-scoped preferences."""
    try:
        stmt = select(Preferences).where(
            and_(
                Preferences.scope == PreferenceScope.SYSTEM.value,
                Preferences.user_id.is_(None),
            )
        )
        result = await session.execute(stmt)
        rows = result.scalars().all()
        return {
            "success": True,
            "data": _combined_preferences(SYSTEM_PREFERENCE_DEFAULTS, rows),
            "error": None,
        }
    except Exception as exc:
        logger.error(f"Error fetching system preferences: {exc}")
        logger.error(traceback.format_exc())
        return {"success": False, "error": str(exc)}


async def fetch_system_preferences_map(session: AsyncSession) -> Dict[str, str]:
    """Fetch global system preferences as a simple key/value map with defaults."""
    reply = await fetch_system_preferences(session)
    if not reply.get("success"):
        return dict(SYSTEM_PREFERENCE_DEFAULTS)
    return {
        str(item.get("name")): _normalize_preference_value(item.get("value"))
        for item in (reply.get("data") or [])
    }


async def fetch_integration_preferences_map(
    session: AsyncSession,
    user_id: Union[uuid.UUID, str, None] = None,
) -> Dict[str, str]:
    """
    Fetch integration/API-key preferences with per-user priority.

    Priority order:
    1. Explicit user-scoped rows for `user_id` when provided.
    2. Canonical admin user rows (or first user) when `user_id` is absent.
    3. Legacy system/bootstrap rows as backwards-compatible fallback.
    """
    result: Dict[str, str] = dict(INTEGRATION_PREFERENCE_DEFAULTS)
    resolved_user_id: Union[uuid.UUID, None] = None

    if user_id:
        try:
            resolved_user_id = _to_uuid(user_id)
        except Exception:
            logger.warning("Ignoring invalid user_id when fetching integration preferences")

    if resolved_user_id is None and user_id is None:
        canonical_admin_id = (
            await session.execute(
                select(Users.id)
                .where(Users.role == UserRole.ADMIN.value)
                .order_by(Users.created_at.asc())
                .limit(1)
            )
        ).scalar_one_or_none()
        canonical_user_id = (
            canonical_admin_id
            or (
                await session.execute(select(Users.id).order_by(Users.created_at.asc()).limit(1))
            ).scalar_one_or_none()
        )
        resolved_user_id = canonical_user_id

    if resolved_user_id is not None:
        user_rows = (
            (
                await session.execute(
                    select(Preferences).where(
                        and_(
                            Preferences.scope == PreferenceScope.USER.value,
                            Preferences.user_id == resolved_user_id,
                            Preferences.name.in_(INTEGRATION_PREFERENCE_KEYS),
                        )
                    )
                )
            )
            .scalars()
            .all()
        )

        for row in user_rows:
            name = str(row.name)
            if name in result:
                result[name] = _normalize_preference_value(row.value)

    # Compatibility fallback for databases that still carry system/bootstrap copies.
    fallback_rows = (
        (
            await session.execute(
                select(Preferences).where(
                    and_(
                        Preferences.scope.in_(
                            [PreferenceScope.SYSTEM.value, PreferenceScope.BOOTSTRAP.value]
                        ),
                        Preferences.user_id.is_(None),
                        Preferences.name.in_(INTEGRATION_PREFERENCE_KEYS),
                    )
                )
            )
        )
        .scalars()
        .all()
    )

    for row in fallback_rows:
        name = str(row.name)
        if name in result and not result[name]:
            result[name] = _normalize_preference_value(row.value)

    return result


async def set_user_preferences(
    session: AsyncSession,
    user_id: Union[uuid.UUID, str],
    preferences: List[dict],
) -> dict:
    """Upsert user-scoped preferences for a specific user."""
    try:
        user_uuid = _to_uuid(user_id)
        now = datetime.now(timezone.utc)

        if not isinstance(preferences, list) or not preferences:
            raise ValueError("No preference updates were provided.")

        requested_names = []
        normalized_updates: Dict[str, str] = {}
        for entry in preferences:
            name = str((entry or {}).get("name") or "").strip()
            if not name:
                raise ValueError("Preference name is required.")
            if name not in USER_PREFERENCE_DEFAULTS:
                raise ValueError(f"Unsupported user preference key: {name}")
            requested_names.append(name)
            normalized_updates[name] = _normalize_preference_value((entry or {}).get("value"))

        existing_rows = (
            (
                await session.execute(
                    select(Preferences).where(
                        and_(
                            Preferences.scope == PreferenceScope.USER.value,
                            Preferences.user_id == user_uuid,
                            Preferences.name.in_(requested_names),
                        )
                    )
                )
            )
            .scalars()
            .all()
        )
        existing_by_name = {str(row.name): row for row in existing_rows}

        for name, value in normalized_updates.items():
            existing = existing_by_name.get(name)
            if existing:
                # Avoid ORM no-op UPDATEs that can trip rowcount checks on SQLite.
                if _normalize_preference_value(existing.value) == value:
                    continue
                existing.value = value
                existing.updated = now
            else:
                session.add(
                    Preferences(
                        id=uuid.uuid4(),
                        user_id=user_uuid,
                        scope=PreferenceScope.USER.value,
                        name=name,
                        value=value,
                        added=now,
                        updated=now,
                    )
                )

        await session.commit()
        return await fetch_user_preferences(session, user_uuid)
    except Exception as exc:
        await session.rollback()
        logger.error(f"Error setting user preferences: {exc}")
        logger.error(traceback.format_exc())
        return {"success": False, "error": str(exc)}


async def set_system_preferences(session: AsyncSession, preferences: List[dict]) -> dict:
    """Upsert global system-scoped preferences."""
    try:
        now = datetime.now(timezone.utc)
        if not isinstance(preferences, list) or not preferences:
            raise ValueError("No preference updates were provided.")

        requested_names = []
        normalized_updates: Dict[str, str] = {}
        for entry in preferences:
            name = str((entry or {}).get("name") or "").strip()
            if not name:
                raise ValueError("Preference name is required.")
            if name not in SYSTEM_PREFERENCE_DEFAULTS:
                raise ValueError(f"Unsupported system preference key: {name}")
            requested_names.append(name)
            normalized_updates[name] = _normalize_preference_value((entry or {}).get("value"))

        existing_rows = (
            (
                await session.execute(
                    select(Preferences).where(
                        and_(
                            Preferences.scope == PreferenceScope.SYSTEM.value,
                            Preferences.user_id.is_(None),
                            Preferences.name.in_(requested_names),
                        )
                    )
                )
            )
            .scalars()
            .all()
        )
        existing_by_name = {str(row.name): row for row in existing_rows}

        for name, value in normalized_updates.items():
            existing = existing_by_name.get(name)
            if existing:
                if _normalize_preference_value(existing.value) == value:
                    continue
                existing.value = value
                existing.updated = now
            else:
                session.add(
                    Preferences(
                        id=uuid.uuid4(),
                        user_id=None,
                        scope=PreferenceScope.SYSTEM.value,
                        name=name,
                        value=value,
                        added=now,
                        updated=now,
                    )
                )

        await session.commit()
        return await fetch_system_preferences(session)
    except Exception as exc:
        await session.rollback()
        logger.error(f"Error setting system preferences: {exc}")
        logger.error(traceback.format_exc())
        return {"success": False, "error": str(exc)}


async def claim_bootstrap_preferences(
    session: AsyncSession, user_id: Union[uuid.UUID, str]
) -> dict:
    """
    Assign bootstrap-scoped user preferences to the first created admin account.

    This is used during setup completion where preferences existed before users existed.
    """
    try:
        user_uuid = _to_uuid(user_id)
        now = datetime.now(timezone.utc)

        bootstrap_rows = (
            (
                await session.execute(
                    select(Preferences).where(Preferences.scope == PreferenceScope.BOOTSTRAP.value)
                )
            )
            .scalars()
            .all()
        )

        existing_user_rows = (
            (
                await session.execute(
                    select(Preferences).where(
                        and_(
                            Preferences.scope == PreferenceScope.USER.value,
                            Preferences.user_id == user_uuid,
                        )
                    )
                )
            )
            .scalars()
            .all()
        )
        existing_user_names = {str(row.name) for row in existing_user_rows}

        for row in bootstrap_rows:
            pref_name = str(row.name or "")
            if pref_name in existing_user_names:
                await session.execute(delete(Preferences).where(Preferences.id == row.id))
                continue
            row.scope = PreferenceScope.USER.value
            row.user_id = user_uuid
            row.updated = now
            existing_user_names.add(pref_name)

        for pref_name, pref_default in USER_PREFERENCE_DEFAULTS.items():
            if pref_name in existing_user_names:
                continue
            session.add(
                Preferences(
                    id=uuid.uuid4(),
                    user_id=user_uuid,
                    scope=PreferenceScope.USER.value,
                    name=pref_name,
                    value=pref_default,
                    added=now,
                    updated=now,
                )
            )

        await session.flush()
        return {"success": True, "error": None}
    except Exception as exc:
        logger.error(f"Error claiming bootstrap preferences: {exc}")
        logger.error(traceback.format_exc())
        return {"success": False, "error": str(exc)}


async def delete_preference(session: AsyncSession, preference_id: Union[uuid.UUID, str]) -> dict:
    """Delete a preference record by UUID."""
    try:
        preference_uuid = _to_uuid(preference_id)
        stmt = delete(Preferences).where(Preferences.id == preference_uuid).returning(Preferences)
        result = await session.execute(stmt)
        deleted = result.scalar_one_or_none()
        if not deleted:
            return {"success": False, "error": f"Preference with id {preference_uuid} not found."}
        await session.commit()
        return {"success": True, "data": None, "error": None}
    except Exception as exc:
        await session.rollback()
        logger.error(f"Error deleting a preference: {exc}")
        logger.error(traceback.format_exc())
        return {"success": False, "error": str(exc)}


async def set_map_settings(session: AsyncSession, data: dict) -> dict:
    """
    Updates satellite tracking state or inserts new settings into the database.

    This function handles updating settings for satellite tracking by name. If a
    record with the given name exists, it will update the existing record. Otherwise,
    it will insert a new record with the provided data. The updated/created record
    is serialized and returned alongside the success status. In case of errors,
    a failure status and error message are returned, and the transaction is rolled back.

    :param session:
        An AsyncSession instance for handling database operations.
    :param data:
        A dictionary containing the satellite tracking settings to set. The keys
        must include 'name' and 'value'. Additional keys will be used to update
        or insert the record.
    :return:
        A dictionary containing the success status, serialized record data if
        successful, and error information in case of failure.
    """
    try:
        assert data.get("name", None) is not None, "name is required when setting map settings"
        assert data.get("value", None) is not None, "value is required when setting map settings"

        now = datetime.now(timezone.utc)
        data["updated"] = now

        existing_rows_result = await session.execute(
            select(TrackingState).where(TrackingState.name == data["name"])
        )
        existing_rows = existing_rows_result.scalars().all()
        existing_record = None
        duplicate_ids = []

        if existing_rows:
            # Keep the most recently updated row as canonical and remove duplicates.
            ordered = sorted(
                existing_rows,
                key=lambda row: row.updated
                or row.added
                or datetime.min.replace(tzinfo=timezone.utc),
                reverse=True,
            )
            existing_record = ordered[0]
            duplicate_ids = [row.id for row in ordered[1:]]
            if duplicate_ids:
                await session.execute(
                    delete(TrackingState).where(TrackingState.id.in_(duplicate_ids))
                )
                logger.warning(
                    f"Removed {len(duplicate_ids)} duplicate tracking_state rows for name='{data['name']}'"
                )

        if existing_record:
            for key, value in data.items():
                setattr(existing_record, key, value)
            new_record = existing_record
        else:
            new_record = TrackingState(**data)

        await session.merge(new_record)
        await session.commit()
        new_record = serialize_object(new_record)
        return {"success": True, "data": new_record, "error": None}

    except Exception as e:
        await session.rollback()
        logger.error(f"Error storing map settings: {e}")
        logger.error(traceback.format_exc())
        return {"success": False, "data": None, "error": str(e)}


async def get_map_settings(session: AsyncSession, name: str) -> dict:
    """
    Retrieve map settings for the given name.

    This asynchronous function queries the database to fetch the map
    settings related to satellite tracking state. If data is successfully
    retrieved, it returns the settings in a structured format. If no data is
    found, an empty dictionary is provided. In case of an error during
    execution, the function logs the error and returns a failure response.

    :param session: Database session instance to execute queries
    :param name: The name identifier related to the map settings
    :return: A dictionary containing either the map settings 'data'
        or an empty dictionary and a 'success' status indicating
        the operation's outcome
    """
    try:
        # Query map settings from the database using the provided name
        map_settings = await session.execute(
            select(TrackingState).where(TrackingState.name == name)
        )
        map_settings_rows = map_settings.scalars().all()

        if not map_settings_rows:
            return {"success": True, "data": {}}

        ordered = sorted(
            map_settings_rows,
            key=lambda row: row.updated or row.added or datetime.min.replace(tzinfo=timezone.utc),
            reverse=True,
        )
        map_settings_row = ordered[0]

        # Best-effort cleanup of duplicates for this key.
        duplicate_ids = [row.id for row in ordered[1:]]
        if duplicate_ids:
            await session.execute(delete(TrackingState).where(TrackingState.id.in_(duplicate_ids)))
            await session.commit()
            logger.warning(
                f"Removed {len(duplicate_ids)} duplicate tracking_state rows while reading name='{name}'"
            )

        map_settings_row = serialize_object(map_settings_row)
        return {"success": True, "data": map_settings_row}

    except Exception as e:
        logger.error(f"Error retrieving map settings: {str(e)}")
        logger.exception(e)
        return {"success": False, "data": {}, "error": str(e)}
