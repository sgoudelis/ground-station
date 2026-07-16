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

"""Persistence helpers for orbital synchronization state snapshots."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from common.logger import logger
from db.models import TrackingState

ORBITAL_SYNC_STATE_NAME = "orbital-sync:global"


def is_terminal_orbital_sync_state(state: Dict[str, Any]) -> bool:
    """Return True when the sync state reached a terminal status."""
    return str((state or {}).get("status") or "").strip().lower() == "complete"


def should_hydrate_orbital_sync_state(runtime_state: Optional[Dict[str, Any]]) -> bool:
    """
    Determine whether runtime state still looks like a fresh boot default.

    We hydrate only when state has not been updated in-process yet. This prevents
    replacing fresh in-memory progress with older persisted snapshots.
    """
    if not isinstance(runtime_state, dict):
        return True

    if runtime_state.get("last_update"):
        return False

    status = str(runtime_state.get("status") or "").strip().lower()
    if status and status != "idle":
        return False

    return not str(runtime_state.get("message") or "").strip()


async def load_orbital_sync_state(session: AsyncSession) -> Optional[Dict[str, Any]]:
    """Load the persisted orbital sync snapshot from tracking_state."""
    result = await session.execute(
        select(TrackingState).where(TrackingState.name == ORBITAL_SYNC_STATE_NAME)
    )
    row = result.scalar_one_or_none()
    if row is None or not isinstance(row.value, dict):
        return None
    return dict(row.value)


async def save_orbital_sync_state(session: AsyncSession, state: Dict[str, Any]) -> bool:
    """Upsert orbital sync snapshot under a dedicated tracking_state key."""
    if not isinstance(state, dict):
        return False

    try:
        result = await session.execute(
            select(TrackingState).where(TrackingState.name == ORBITAL_SYNC_STATE_NAME)
        )
        row = result.scalar_one_or_none()
        now = datetime.now(timezone.utc)

        if row is None:
            row = TrackingState(
                name=ORBITAL_SYNC_STATE_NAME,
                value=dict(state),
                added=now,
                updated=now,
            )
            session.add(row)
        else:
            row.value = dict(state)
            row.updated = now

        await session.commit()
        return True
    except Exception:
        await session.rollback()
        logger.exception("Failed to persist orbital sync state snapshot")
        return False
