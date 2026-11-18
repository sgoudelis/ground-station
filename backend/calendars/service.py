# Copyright (c) 2026 Efstratios Goudelis
# SPDX-License-Identifier: GPL-3.0-or-later

"""Read calendar entries without generating passes or changing scheduler state."""

import math
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from calendars.schemas import (
    CalendarEvent,
    CalendarFrequency,
    CalendarRange,
    CalendarSatellite,
    ObservationDetails,
)
from db.models import ScheduledObservations


def observation_frequencies(sessions: list[dict[str, Any]]) -> list[CalendarFrequency]:
    channels: dict[tuple[float, str | None], CalendarFrequency] = {}
    for session in sessions:
        sdr = session.get("sdr") or {}
        tasks = session.get("tasks") or []
        # IQ-only sessions still have a real receiver center frequency. Never
        # invent a channel or unit when the stored configuration has no value.
        configs = [task.get("config") or {} for task in tasks] or [{}]
        for config in configs:
            frequency = config.get("frequency") or sdr.get("center_frequency")
            if (
                isinstance(frequency, bool)
                or not isinstance(frequency, (int, float))
                or not math.isfinite(frequency)
                or frequency <= 0
            ):
                continue
            mode = config.get("modulation") or config.get("demodulator")
            mode = mode.upper() if isinstance(mode, str) and mode.lower() != "none" else None
            key = (float(frequency), mode)
            channels[key] = CalendarFrequency(hz=frequency, mode=mode)
    # Multiple tasks can describe the same receive frequency, with only the
    # audio task supplying its modulation. Prefer that detail to a duplicate
    # entry without a mode; retain distinct known modes on the same frequency.
    known_modes = {frequency for frequency, mode in channels if mode}
    return [
        channel
        for (frequency, mode), channel in channels.items()
        if mode or frequency not in known_modes
    ]


def observation_event(row: ScheduledObservations) -> CalendarEvent:
    return CalendarEvent(
        id=f"observations:{row.id}",
        source="observations",
        source_id=row.id,
        title=row.name,
        kind="observation",
        start=row.task_start or row.event_start,
        end=row.task_end or row.event_end,
        satellites=[
            CalendarSatellite(
                name=(row.satellite_config or {}).get("name") or str(row.norad_id),
                norad_id=row.norad_id,
            )
        ],
        frequencies=observation_frequencies(row.sessions or []),
        status=row.status.value,
        enabled=row.enabled,
        observation=ObservationDetails(
            monitored_satellite_id=row.monitored_satellite_id,
            pass_start=row.event_start,
            pass_end=row.event_end,
            peak_altitude=(row.pass_config or {}).get("peak_altitude"),
        ),
    )


async def calendar_events(session: AsyncSession, window: CalendarRange) -> dict[str, Any]:
    start, end = window.utc_bounds()
    task_start = func.coalesce(ScheduledObservations.task_start, ScheduledObservations.event_start)
    task_end = func.coalesce(ScheduledObservations.task_end, ScheduledObservations.event_end)
    # Overlap, not start-date containment, includes observations crossing into
    # this view. The same exclusive-end rule is used by the frontend day grid.
    rows = (
        (
            await session.execute(
                select(ScheduledObservations)
                .where(task_start < end, task_end > start, task_end > task_start)
                .order_by(task_start, ScheduledObservations.id)
            )
        )
        .scalars()
        .all()
    )
    return {
        "range": window.model_dump(mode="json"),
        "events": [observation_event(row).model_dump(mode="json") for row in rows],
        "sources": [{"id": "observations"}],
    }
