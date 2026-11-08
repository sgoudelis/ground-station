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

"""Conflict detection helpers for observation generation."""

from datetime import datetime, timedelta, timezone
from typing import Optional, Sequence

from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from db.models import ScheduledObservations
from observations.constants import PASS_OVERLAP_TOLERANCE_MINUTES, STATUS_RUNNING, STATUS_SCHEDULED


async def find_overlapping_observation(
    session: AsyncSession,
    norad_id: int,
    event_start: datetime,
    event_end: datetime,
    monitored_satellite_id: str,
) -> Optional[ScheduledObservations]:
    """
    Check if an observation already exists for the given pass window.

    Args:
        session: Database session
        norad_id: NORAD ID of the satellite
        event_start: Start time of the pass
        event_end: End time of the pass
        monitored_satellite_id: ID of the monitored satellite generating this observation

    Returns:
        Existing ScheduledObservations object if found, None otherwise
    """
    tolerance = timedelta(minutes=PASS_OVERLAP_TOLERANCE_MINUTES)

    # Expand the search window by tolerance
    search_start = event_start - tolerance
    search_end = event_end + tolerance

    stmt = select(ScheduledObservations).filter(
        and_(
            ScheduledObservations.norad_id == norad_id,
            ScheduledObservations.monitored_satellite_id == monitored_satellite_id,
            # Check for time window overlap
            ScheduledObservations.event_start <= search_end,
            ScheduledObservations.event_end >= search_start,
        )
    )

    result = await session.execute(stmt)
    observation: Optional[ScheduledObservations] = result.scalar_one_or_none()
    return observation


def should_update_observation(existing_obs: ScheduledObservations) -> bool:
    """Return whether generation may refresh an existing observation."""
    status = getattr(existing_obs.status, "value", existing_obs.status)
    return bool(
        status == STATUS_SCHEDULED and existing_obs.event_start > datetime.now(timezone.utc)
    )


async def find_any_time_conflict(
    session: AsyncSession,
    event_start: datetime,
    event_end: datetime,
    exclude_observation_id: Optional[str] = None,
    task_start: Optional[datetime] = None,
    task_end: Optional[datetime] = None,
) -> Sequence[ScheduledObservations]:
    """
    Check if ANY enabled observations exist that overlap with this time window,
    regardless of satellite or monitored satellite.

    If task_start/task_end are provided, uses those times (actual execution window).
    Otherwise falls back to event_start/event_end (full visibility window).

    Args:
        session: Database session
        event_start: Start time of the pass (AOS)
        event_end: End time of the pass (LOS)
        exclude_observation_id: Optional observation ID to exclude (for updates)
        task_start: Optional actual task start time (when satellite reaches elevation threshold)
        task_end: Optional actual task end time (when satellite drops below elevation threshold)

    Returns:
        Sequence of all conflicting observations found, or empty sequence
    """
    tolerance = timedelta(minutes=PASS_OVERLAP_TOLERANCE_MINUTES)

    # Use task times if available, otherwise use event times
    check_start = task_start if task_start else event_start
    check_end = task_end if task_end else event_end

    # Expand the search window by tolerance
    search_start = check_start - tolerance
    search_end = check_end + tolerance

    # Check for overlaps using task_start/task_end if available, otherwise event_start/event_end
    # An observation conflicts if the execution windows overlap
    # Use COALESCE to fall back to event times for observations without task times
    conditions = [
        ScheduledObservations.enabled.is_(True),
        ScheduledObservations.status.in_([STATUS_SCHEDULED, STATUS_RUNNING]),
        # Check for time window overlap using task times (with fallback to event times)
        func.coalesce(ScheduledObservations.task_start, ScheduledObservations.event_start)
        < search_end,
        func.coalesce(ScheduledObservations.task_end, ScheduledObservations.event_end)
        > search_start,
    ]

    if exclude_observation_id:
        conditions.append(ScheduledObservations.id != exclude_observation_id)

    stmt = select(ScheduledObservations).filter(and_(*conditions))

    result = await session.execute(stmt)
    observations: Sequence[ScheduledObservations] = result.scalars().all()
    return observations
