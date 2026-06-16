# Copyright (c) 2025 Efstratios Goudelis
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""CRUD helpers for celestial targets and persisted vector snapshots."""

from __future__ import annotations

import traceback
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy import select, text
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.exc import OperationalError
from sqlalchemy.ext.asyncio import AsyncSession

from common.common import logger, serialize_object
from db.models import CelestialTargets, CelestialVectorSnapshots

_SNAPSHOT_UPSERT_CONFLICT_MISSING_CONSTRAINT_ERROR = (
    "ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE constraint"
)
_SNAPSHOT_LOOKUP_INDEX_SQL = """
CREATE UNIQUE INDEX IF NOT EXISTS ix_celestial_vector_snapshots_lookup
ON celestial_vector_snapshots
(
    target_id,
    epoch_bucket_utc,
    past_hours,
    future_hours,
    step_minutes,
    frame,
    center
)
"""


def _normalize_target_entry(row: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": row.get("id"),
        "target_type": row.get("target_type"),
        "body_class": row.get("body_class"),
        "display_name": row.get("display_name"),
        "horizons_command": row.get("horizons_command"),
        "body_id": row.get("body_id"),
        "parent_body_id": row.get("parent_body_id"),
        "always_in_scene": bool(row.get("always_in_scene", False)),
        "enabled": bool(row.get("enabled", True)),
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
    }


def _normalize_snapshot_entry(row: Dict[str, Any]) -> Dict[str, Any]:
    position_xyz_au = row.get("position_xyz_au")
    velocity_xyz_au_per_day = row.get("velocity_xyz_au_per_day")
    orbit_samples_xyz_au = row.get("orbit_samples_xyz_au")
    orbit_sample_times_utc = row.get("orbit_sample_times_utc")
    source = row.get("source")
    horizons_signature = row.get("horizons_signature")
    fetched_at = row.get("fetched_at")
    fetched_at_iso = (
        fetched_at.astimezone(timezone.utc).isoformat()
        if isinstance(fetched_at, datetime)
        else str(fetched_at or "")
    )
    payload = {
        "position_xyz_au": position_xyz_au,
        "velocity_xyz_au_per_day": velocity_xyz_au_per_day,
        "orbit_samples_xyz_au": orbit_samples_xyz_au,
        "orbit_sample_times_utc": orbit_sample_times_utc,
        "source": source,
        "horizons_signature": horizons_signature,
        "fetched_at_utc": fetched_at_iso,
    }
    return {
        "id": row.get("id"),
        "target_id": row.get("target_id"),
        "epoch_bucket_utc": row.get("epoch_bucket_utc"),
        "past_hours": row.get("past_hours"),
        "future_hours": row.get("future_hours"),
        "step_minutes": row.get("step_minutes"),
        "frame": row.get("frame"),
        "center": row.get("center"),
        "position_xyz_au": position_xyz_au,
        "velocity_xyz_au_per_day": velocity_xyz_au_per_day,
        "orbit_samples_xyz_au": orbit_samples_xyz_au,
        "orbit_sample_times_utc": orbit_sample_times_utc,
        "horizons_signature": horizons_signature,
        "payload": payload,
        "source": source,
        "error": row.get("error"),
        "fetched_at": row.get("fetched_at"),
        "expires_at": row.get("expires_at"),
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
    }


def _is_missing_snapshot_lookup_constraint_error(exc: OperationalError) -> bool:
    return _SNAPSHOT_UPSERT_CONFLICT_MISSING_CONSTRAINT_ERROR in str(exc)


async def _ensure_snapshot_lookup_unique_index(session: AsyncSession) -> None:
    await session.execute(text(_SNAPSHOT_LOOKUP_INDEX_SQL))


async def ensure_celestial_target(
    session: AsyncSession,
    data: Dict[str, Any],
) -> dict:
    """Insert or update one celestial target row."""
    try:
        target_id = str(data.get("id") or "").strip()
        target_type = str(data.get("target_type") or "").strip().lower()
        display_name = str(data.get("display_name") or "").strip()
        if not target_id:
            return {"success": False, "error": "id is required"}
        if target_type not in {"mission", "body"}:
            return {"success": False, "error": "target_type must be one of: mission, body"}
        if not display_name:
            return {"success": False, "error": "display_name is required"}

        now_utc = datetime.now(timezone.utc)
        insert_values = {
            "id": target_id,
            "target_type": target_type,
            "body_class": str(data.get("body_class") or "").strip().lower() or None,
            "display_name": display_name,
            "horizons_command": str(data.get("horizons_command") or "").strip() or None,
            "body_id": str(data.get("body_id") or "").strip().lower() or None,
            "parent_body_id": str(data.get("parent_body_id") or "").strip().lower() or None,
            "always_in_scene": bool(data.get("always_in_scene", False)),
            "enabled": bool(data.get("enabled", True)),
            "created_at": now_utc,
            "updated_at": now_utc,
        }
        stmt = sqlite_insert(CelestialTargets).values(**insert_values)
        stmt = stmt.on_conflict_do_update(
            index_elements=[CelestialTargets.id],
            set_={
                "target_type": insert_values["target_type"],
                "body_class": insert_values["body_class"],
                "display_name": insert_values["display_name"],
                "horizons_command": insert_values["horizons_command"],
                "body_id": insert_values["body_id"],
                "parent_body_id": insert_values["parent_body_id"],
                "always_in_scene": insert_values["always_in_scene"],
                "enabled": insert_values["enabled"],
                "updated_at": now_utc,
            },
        )
        await session.execute(stmt)
        await session.commit()

        result = await session.execute(
            select(CelestialTargets).where(CelestialTargets.id == target_id)
        )
        row = result.scalar_one_or_none()
        if not row:
            return {"success": False, "error": "Upsert completed but target row was not found"}
        return {
            "success": True,
            "data": _normalize_target_entry(serialize_object(row)),
            "error": None,
        }
    except Exception as e:
        await session.rollback()
        logger.error(f"Error ensuring celestial target: {e}")
        logger.error(traceback.format_exc())
        return {"success": False, "error": str(e)}


async def fetch_celestial_target(
    session: AsyncSession,
    target_id: str,
) -> dict:
    """Fetch one celestial target by ID."""
    try:
        target_key = str(target_id or "").strip()
        if not target_key:
            return {"success": False, "error": "target_id is required"}

        result = await session.execute(
            select(CelestialTargets).where(CelestialTargets.id == target_key)
        )
        row = result.scalar_one_or_none()
        if not row:
            return {"success": True, "data": None, "error": None}
        return {
            "success": True,
            "data": _normalize_target_entry(serialize_object(row)),
            "error": None,
        }
    except Exception as e:
        logger.error(f"Error fetching celestial target: {e}")
        logger.error(traceback.format_exc())
        return {"success": False, "error": str(e)}


async def fetch_celestial_targets(
    session: AsyncSession,
    *,
    always_in_scene_only: bool = False,
    enabled_only: bool = True,
    target_type: Optional[str] = None,
) -> dict:
    """Fetch a list of celestial targets with optional filters."""
    try:
        stmt = select(CelestialTargets)
        if always_in_scene_only:
            stmt = stmt.where(CelestialTargets.always_in_scene.is_(True))
        if enabled_only:
            stmt = stmt.where(CelestialTargets.enabled.is_(True))
        if target_type:
            stmt = stmt.where(CelestialTargets.target_type == str(target_type).strip().lower())
        stmt = stmt.order_by(CelestialTargets.target_type, CelestialTargets.display_name)

        result = await session.execute(stmt)
        rows = result.scalars().all()
        data = [_normalize_target_entry(serialize_object(row)) for row in rows]
        return {"success": True, "data": data, "error": None}
    except Exception as e:
        logger.error(f"Error fetching celestial targets: {e}")
        logger.error(traceback.format_exc())
        return {"success": False, "error": str(e)}


async def fetch_celestial_vector_snapshot(
    session: AsyncSession,
    target_id: str,
    epoch_bucket_utc: datetime,
    past_hours: int,
    future_hours: int,
    step_minutes: int,
    frame: str = "heliocentric-ecliptic",
    center: str = "sun",
    valid_only: bool = True,
    as_of: Optional[datetime] = None,
) -> dict:
    """Fetch one vector snapshot by unique lookup key."""
    try:
        target_key = str(target_id or "").strip()
        if not target_key:
            return {"success": False, "error": "target_id is required"}

        now_utc = as_of or datetime.now(timezone.utc)
        stmt = select(CelestialVectorSnapshots).where(
            CelestialVectorSnapshots.target_id == target_key,
            CelestialVectorSnapshots.epoch_bucket_utc == epoch_bucket_utc,
            CelestialVectorSnapshots.past_hours == int(past_hours),
            CelestialVectorSnapshots.future_hours == int(future_hours),
            CelestialVectorSnapshots.step_minutes == int(step_minutes),
            CelestialVectorSnapshots.frame == str(frame or "heliocentric-ecliptic"),
            CelestialVectorSnapshots.center == str(center or "sun"),
        )
        if valid_only:
            stmt = stmt.where(CelestialVectorSnapshots.expires_at >= now_utc)
        stmt = stmt.order_by(CelestialVectorSnapshots.fetched_at.desc())

        result = await session.execute(stmt)
        row = result.scalars().first()
        if not row:
            return {"success": True, "data": None, "error": None}
        return {
            "success": True,
            "data": _normalize_snapshot_entry(serialize_object(row)),
            "error": None,
        }
    except Exception as e:
        logger.error(f"Error fetching celestial vector snapshot: {e}")
        logger.error(traceback.format_exc())
        return {"success": False, "error": str(e)}


async def fetch_latest_celestial_vector_snapshot(
    session: AsyncSession,
    target_id: str,
    past_hours: int,
    future_hours: int,
    step_minutes: int,
    frame: str = "heliocentric-ecliptic",
    center: str = "sun",
    valid_only: bool = False,
    as_of: Optional[datetime] = None,
) -> dict:
    """Fetch the latest vector snapshot for target + projection options."""
    try:
        target_key = str(target_id or "").strip()
        if not target_key:
            return {"success": False, "error": "target_id is required"}

        now_utc = as_of or datetime.now(timezone.utc)
        stmt = select(CelestialVectorSnapshots).where(
            CelestialVectorSnapshots.target_id == target_key,
            CelestialVectorSnapshots.past_hours == int(past_hours),
            CelestialVectorSnapshots.future_hours == int(future_hours),
            CelestialVectorSnapshots.step_minutes == int(step_minutes),
            CelestialVectorSnapshots.frame == str(frame or "heliocentric-ecliptic"),
            CelestialVectorSnapshots.center == str(center or "sun"),
        )
        if valid_only:
            stmt = stmt.where(CelestialVectorSnapshots.expires_at >= now_utc)
        stmt = stmt.order_by(
            CelestialVectorSnapshots.epoch_bucket_utc.desc(),
            CelestialVectorSnapshots.fetched_at.desc(),
        )

        result = await session.execute(stmt)
        row = result.scalars().first()
        if not row:
            return {"success": True, "data": None, "error": None}
        return {
            "success": True,
            "data": _normalize_snapshot_entry(serialize_object(row)),
            "error": None,
        }
    except Exception as e:
        logger.error(f"Error fetching latest celestial vector snapshot: {e}")
        logger.error(traceback.format_exc())
        return {"success": False, "error": str(e)}


async def fetch_latest_celestial_vector_snapshot_for_target(
    session: AsyncSession,
    target_id: str,
    valid_only: bool = False,
    as_of: Optional[datetime] = None,
) -> dict:
    """Fetch the latest vector snapshot for a target across projection options."""
    try:
        target_key = str(target_id or "").strip()
        if not target_key:
            return {"success": False, "error": "target_id is required"}

        now_utc = as_of or datetime.now(timezone.utc)
        stmt = select(CelestialVectorSnapshots).where(
            CelestialVectorSnapshots.target_id == target_key
        )
        if valid_only:
            stmt = stmt.where(CelestialVectorSnapshots.expires_at >= now_utc)
        stmt = stmt.order_by(
            CelestialVectorSnapshots.fetched_at.desc(),
            CelestialVectorSnapshots.epoch_bucket_utc.desc(),
        )

        result = await session.execute(stmt)
        row = result.scalars().first()
        if not row:
            return {"success": True, "data": None, "error": None}
        return {
            "success": True,
            "data": _normalize_snapshot_entry(serialize_object(row)),
            "error": None,
        }
    except Exception as e:
        logger.error(f"Error fetching latest celestial vector snapshot by target: {e}")
        logger.error(traceback.format_exc())
        return {"success": False, "error": str(e)}


async def upsert_celestial_vector_snapshot(
    session: AsyncSession,
    data: Dict[str, Any],
) -> dict:
    """Insert or update one celestial vector snapshot."""
    try:
        target_id = str(data.get("target_id") or "").strip()
        epoch_bucket_utc = data.get("epoch_bucket_utc")
        if not target_id:
            return {"success": False, "error": "target_id is required"}
        if not isinstance(epoch_bucket_utc, datetime):
            return {"success": False, "error": "epoch_bucket_utc datetime is required"}

        position_xyz_au = data.get("position_xyz_au")
        velocity_xyz_au_per_day = data.get("velocity_xyz_au_per_day")
        orbit_samples_xyz_au = data.get("orbit_samples_xyz_au")
        orbit_sample_times_utc = data.get("orbit_sample_times_utc")
        if position_xyz_au is None:
            return {"success": False, "error": "position_xyz_au is required"}
        if velocity_xyz_au_per_day is None:
            return {"success": False, "error": "velocity_xyz_au_per_day is required"}
        if orbit_samples_xyz_au is None:
            return {"success": False, "error": "orbit_samples_xyz_au is required"}
        if orbit_sample_times_utc is None:
            return {"success": False, "error": "orbit_sample_times_utc is required"}

        frame = str(data.get("frame") or "heliocentric-ecliptic")
        center = str(data.get("center") or "sun")
        past_hours = int(data.get("past_hours", 24))
        future_hours = int(data.get("future_hours", 24))
        step_minutes = int(data.get("step_minutes", 60))
        fetched_at = data.get("fetched_at") or datetime.now(timezone.utc)
        expires_at = data.get("expires_at")
        if not isinstance(expires_at, datetime):
            return {"success": False, "error": "expires_at datetime is required"}

        now_utc = datetime.now(timezone.utc)
        insert_values = {
            "id": str(data.get("id") or uuid.uuid4()),
            "target_id": target_id,
            "epoch_bucket_utc": epoch_bucket_utc,
            "past_hours": past_hours,
            "future_hours": future_hours,
            "step_minutes": step_minutes,
            "frame": frame,
            "center": center,
            "position_xyz_au": position_xyz_au,
            "velocity_xyz_au_per_day": velocity_xyz_au_per_day,
            "orbit_samples_xyz_au": orbit_samples_xyz_au,
            "orbit_sample_times_utc": orbit_sample_times_utc,
            "horizons_signature": data.get("horizons_signature"),
            "source": str(data.get("source") or "horizons"),
            "error": data.get("error"),
            "fetched_at": fetched_at,
            "expires_at": expires_at,
            "created_at": now_utc,
            "updated_at": now_utc,
        }
        stmt = sqlite_insert(CelestialVectorSnapshots).values(**insert_values)
        stmt = stmt.on_conflict_do_update(
            index_elements=[
                CelestialVectorSnapshots.target_id,
                CelestialVectorSnapshots.epoch_bucket_utc,
                CelestialVectorSnapshots.past_hours,
                CelestialVectorSnapshots.future_hours,
                CelestialVectorSnapshots.step_minutes,
                CelestialVectorSnapshots.frame,
                CelestialVectorSnapshots.center,
            ],
            set_={
                "position_xyz_au": insert_values["position_xyz_au"],
                "velocity_xyz_au_per_day": insert_values["velocity_xyz_au_per_day"],
                "orbit_samples_xyz_au": insert_values["orbit_samples_xyz_au"],
                "orbit_sample_times_utc": insert_values["orbit_sample_times_utc"],
                "horizons_signature": insert_values["horizons_signature"],
                "source": insert_values["source"],
                "error": insert_values["error"],
                "fetched_at": insert_values["fetched_at"],
                "expires_at": insert_values["expires_at"],
                "updated_at": now_utc,
            },
        )
        try:
            await session.execute(stmt)
        except OperationalError as exc:
            if not _is_missing_snapshot_lookup_constraint_error(exc):
                raise
            # Some restored databases were missing lookup indexes because older full backups
            # included table SQL + row data but not CREATE INDEX statements.
            logger.warning(
                "Celestial vector snapshot lookup index missing during upsert; creating index and retrying."
            )
            await session.rollback()
            await _ensure_snapshot_lookup_unique_index(session)
            await session.execute(stmt)
        await session.commit()

        result = await session.execute(
            select(CelestialVectorSnapshots).where(
                CelestialVectorSnapshots.target_id == target_id,
                CelestialVectorSnapshots.epoch_bucket_utc == epoch_bucket_utc,
                CelestialVectorSnapshots.past_hours == past_hours,
                CelestialVectorSnapshots.future_hours == future_hours,
                CelestialVectorSnapshots.step_minutes == step_minutes,
                CelestialVectorSnapshots.frame == frame,
                CelestialVectorSnapshots.center == center,
            )
        )
        row = result.scalar_one_or_none()
        if not row:
            return {"success": False, "error": "Upsert completed but snapshot row was not found"}
        return {
            "success": True,
            "data": _normalize_snapshot_entry(serialize_object(row)),
            "error": None,
        }
    except Exception as e:
        await session.rollback()
        logger.error(f"Error upserting celestial vector snapshot: {e}")
        logger.error(traceback.format_exc())
        return {"success": False, "error": str(e)}


async def ensure_celestial_targets(
    session: AsyncSession,
    rows: List[Dict[str, Any]],
) -> dict:
    """Batch upsert celestial targets in one transaction."""
    try:
        normalized: List[Dict[str, Any]] = []
        for row in rows:
            target_id = str(row.get("id") or "").strip()
            target_type = str(row.get("target_type") or "").strip().lower()
            display_name = str(row.get("display_name") or "").strip()
            if not target_id or target_type not in {"mission", "body"} or not display_name:
                continue
            normalized.append(
                {
                    "id": target_id,
                    "target_type": target_type,
                    "body_class": str(row.get("body_class") or "").strip().lower() or None,
                    "display_name": display_name,
                    "horizons_command": str(row.get("horizons_command") or "").strip() or None,
                    "body_id": str(row.get("body_id") or "").strip().lower() or None,
                    "parent_body_id": str(row.get("parent_body_id") or "").strip().lower() or None,
                    "always_in_scene": bool(row.get("always_in_scene", False)),
                    "enabled": bool(row.get("enabled", True)),
                }
            )

        if not normalized:
            return {"success": True, "data": [], "error": None}

        now_utc = datetime.now(timezone.utc)
        stmt = sqlite_insert(CelestialTargets).values(
            [
                {
                    **row,
                    "created_at": now_utc,
                    "updated_at": now_utc,
                }
                for row in normalized
            ]
        )
        stmt = stmt.on_conflict_do_update(
            index_elements=[CelestialTargets.id],
            set_={
                "target_type": stmt.excluded.target_type,
                "body_class": stmt.excluded.body_class,
                "display_name": stmt.excluded.display_name,
                "horizons_command": stmt.excluded.horizons_command,
                "body_id": stmt.excluded.body_id,
                "parent_body_id": stmt.excluded.parent_body_id,
                "always_in_scene": stmt.excluded.always_in_scene,
                "enabled": stmt.excluded.enabled,
                "updated_at": now_utc,
            },
        )
        await session.execute(stmt)
        await session.commit()

        ids = [row["id"] for row in normalized]
        result = await session.execute(select(CelestialTargets).where(CelestialTargets.id.in_(ids)))
        saved = result.scalars().all()
        data = [_normalize_target_entry(serialize_object(row)) for row in saved]
        return {"success": True, "data": data, "error": None}
    except Exception as e:
        await session.rollback()
        logger.error(f"Error ensuring celestial targets: {e}")
        logger.error(traceback.format_exc())
        return {"success": False, "error": str(e)}
