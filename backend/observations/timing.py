# Copyright (c) 2026 Efstratios Goudelis
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Resolve task timing for individually scheduled observations."""

import asyncio
from datetime import datetime

from sqlalchemy.ext.asyncio import AsyncSession

from common.common import logger
from crud.locations import fetch_all_locations
from crud.satellites import fetch_satellites
from tracking.elcalculator import calculate_elevation_crossing_time


async def calculate_observation_task_times(session: AsyncSession, observation: dict) -> dict:
    """Derive task times from the selected pass, never from stale client task times."""
    pass_data = observation["pass"]
    event_start = datetime.fromisoformat(pass_data["event_start"].replace("Z", "+00:00"))
    event_end = datetime.fromisoformat(pass_data["event_end"].replace("Z", "+00:00"))
    task_start, task_end = None, None
    elevation = observation.get("task_start_elevation", 10)

    if elevation > 0:
        # Manual pass payloads contain timing, but not necessarily orbit data.
        # Fetch the canonical satellite record, which supports both TLE and OMM.
        norad_id = observation.get("satellite", {}).get("norad_id")
        satellite_result = await fetch_satellites(session, norad_id=norad_id) if norad_id else {}
        location_result = await fetch_all_locations(session)
        satellites = satellite_result.get("data") if satellite_result.get("success") else None
        locations = location_result.get("data") if location_result.get("success") else None
        if satellites and locations:
            # Orbit propagation must not block Socket.IO's event loop during a save.
            task_start, task_end = await asyncio.to_thread(
                calculate_elevation_crossing_time,
                satellite_tle=satellites[0],
                home_location=locations[0],
                aos_time=event_start,
                los_time=event_end,
                target_elevation=elevation,
            )
        else:
            logger.warning(
                "Using pass times for observation %s: satellite or station location unavailable",
                observation.get("id"),
            )

    # Match generated observations when the threshold is zero or crossings are unavailable.
    return {
        "task_start": (task_start or event_start).isoformat(),
        "task_end": (task_end or event_end).isoformat(),
    }
