"""Persistent orbital-source fetch state helpers."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional, cast
from uuid import UUID

from db.models import OrbitalSources, OrbitalSourceSyncState
from tlesync.celestrak import CELESTRAK_RATE_LIMIT_SECONDS

CELESTRAK_RATE_LIMIT_NOOP_MESSAGE = (
    "No download was needed: all enabled orbit sources are CelesTrak sources that were refreshed "
    "within the last two hours. Existing orbital data remains active, and the next refresh will run "
    "automatically when these sources are eligible."
)


def all_enabled_sources_are_rate_limited(
    rate_limited_source_count: int, enabled_source_count: int
) -> bool:
    """Return whether a sync can safely complete without downloading new orbit data."""
    return enabled_source_count > 0 and rate_limited_source_count == enabled_source_count


async def get_source_sync_state(session, source_id: UUID) -> Optional[OrbitalSourceSyncState]:
    """Load a source state without creating one for untouched sources."""
    return cast(
        Optional[OrbitalSourceSyncState], await session.get(OrbitalSourceSyncState, source_id)
    )


def is_celestrak_rate_limited(state: Optional[OrbitalSourceSyncState]) -> bool:
    """Return whether a previously successful CelesTrak query is still fresh."""
    if not state or not state.last_success_at:
        return False
    return bool(
        datetime.now(timezone.utc)
        < state.last_success_at + timedelta(seconds=CELESTRAK_RATE_LIMIT_SECONDS)
    )


async def mark_celestrak_success(session, source_id: UUID) -> None:
    """Record a successful query and clear a prior suspension after user resolution."""
    now = datetime.now(timezone.utc)
    state = await session.get(OrbitalSourceSyncState, source_id)
    if state is None:
        state = OrbitalSourceSyncState(source_id=source_id)
        session.add(state)
    state.last_success_at = now
    state.last_attempt_at = now
    state.last_http_status = 200
    state.last_error = None
    state.suspended_at = None
    state.suspension_reason = None
    await session.commit()


async def mark_source_success(session, source_id: UUID) -> None:
    """Persist a successful fetch for any provider without changing its policy."""
    now = datetime.now(timezone.utc)
    state = await session.get(OrbitalSourceSyncState, source_id)
    if state is None:
        state = OrbitalSourceSyncState(source_id=source_id)
        session.add(state)
    state.last_success_at = now
    state.last_attempt_at = now
    state.last_http_status = 200
    state.last_error = None
    await session.commit()


async def mark_source_failure(
    session, source_id: UUID, reason: str, http_status: Optional[int]
) -> None:
    """Persist an attempted fetch failure without disabling a generic source."""
    now = datetime.now(timezone.utc)
    state = await session.get(OrbitalSourceSyncState, source_id)
    if state is None:
        state = OrbitalSourceSyncState(source_id=source_id)
        session.add(state)
    state.last_attempt_at = now
    state.last_http_status = http_status
    state.last_error = reason[:1000]
    await session.commit()


async def suspend_celestrak_source(
    session, source_id: UUID, reason: str, http_status: Optional[int]
) -> None:
    """Persist suspension and disable the source until a user explicitly re-enables it."""
    now = datetime.now(timezone.utc)
    state = await session.get(OrbitalSourceSyncState, source_id)
    if state is None:
        state = OrbitalSourceSyncState(source_id=source_id)
        session.add(state)
    state.last_attempt_at = now
    state.last_http_status = http_status
    state.last_error = reason[:1000]
    state.suspended_at = now
    state.suspension_reason = reason[:1000]

    source = await session.get(OrbitalSources, source_id)
    if source is not None:
        # Suspension must survive a restart and be visible in the normal source
        # list; only an explicit user edit can re-enable this source.
        source.enabled = False
    await session.commit()


async def clear_source_suspension(session, source_id: UUID) -> None:
    """Clear a suspension when a user explicitly re-enables a source."""
    state = await session.get(OrbitalSourceSyncState, source_id)
    if state is None:
        return
    state.suspended_at = None
    state.suspension_reason = None
    state.last_http_status = None
    state.last_error = None
    await session.commit()
