import asyncio
import hashlib
import json
import logging
import multiprocessing
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Union

import numpy as np
import setproctitle
from skyfield.api import Loader, Topos

import crud
from common.common import ModelEncoder
from db import AsyncSessionLocal
from orbits import CentralBody, build_skyfield_satellite, get_propagation_input

from .passes import calculate_next_events

# Create logger
logger = logging.getLogger("passes-worker")

# Create a simple in-memory cache (no multiprocessing needed since cache is only accessed from main process)
_cache: Dict[str, tuple] = {}

# Create a persistent worker pool (reused across all calculations to avoid repeated pool creation/destruction)
_worker_pool = None


def _get_worker_pool():
    """Get or create the persistent worker pool"""
    global _worker_pool
    if _worker_pool is None:
        logger.info("Creating persistent worker pool for satellite pass calculations")
        # This pool starts after HTTP clients connect. Forking would keep their
        # sockets open in the worker after Uvicorn closes them, leaving nginx
        # reusing connections that no web-server process can read.
        _worker_pool = multiprocessing.get_context("spawn").Pool(
            processes=1, initializer=_named_worker_init
        )
    return _worker_pool


def _generate_cache_key(tle_groups, homelat, homelon, hours, above_el, step_minutes):
    """Generate a unique cache key from function parameters, excluding hours"""
    # Create a string representation of the parameters, excluding hours
    # since we'll handle time separately
    params_str = json.dumps(
        {
            "tle_groups": tle_groups,
            "homelat": homelat,
            "homelon": homelon,
            "above_el": above_el,
            "step_minutes": step_minutes,
        },
        sort_keys=True,
    )

    # Hash the parameters string to create a compact key
    return hashlib.md5(params_str.encode()).hexdigest()


def _orbit_cache_identity(satellite, propagation_input):
    """Use canonical OMM elements even when a compatibility TLE also exists."""
    identity = [satellite["norad_id"], propagation_input.tle1, propagation_input.tle2]
    if propagation_input.model_kind.value == "omm":
        identity.append(satellite.get("orbit_payload"))
    return identity


def _named_worker_init():
    """Initialize worker process with a descriptive name"""
    # Set process title for system monitoring tools
    setproctitle.setproctitle("Ground Station - SatellitePassWorker")

    # Set multiprocessing process name
    multiprocessing.current_process().name = "Ground Station - SatellitePassWorker"


def _calculate_elevation_curve(
    satellite_data, home_location, event_start, event_end, extend_start_minutes=0
):
    """
    Calculate elevation curve for a single satellite pass with adaptive sampling.

    :param satellite_data: Dictionary containing satellite TLE data
    :param home_location: Dictionary with 'lat' and 'lon' keys
    :param event_start: ISO format start time string
    :param event_end: ISO format end time string
    :param extend_start_minutes: Minutes to extend before event_start (for first pass in timeline)
    :return: List of dictionaries with 'time' and 'elevation' keys
    """
    try:
        # Initialize Skyfield
        skyfieldloader = Loader("/tmp/skyfield-data")
        ts = skyfieldloader.timescale()

        # Create satellite and observer objects
        propagation_input = get_propagation_input(satellite_data, central_body=CentralBody.EARTH)
        satellite = build_skyfield_satellite(propagation_input, ts)
        observer = Topos(
            latitude_degrees=float(home_location["lat"]),
            longitude_degrees=float(home_location["lon"]),
        )

        # Parse times for the actual pass
        start_dt = datetime.fromisoformat(event_start.replace("Z", "+00:00"))
        end_dt = datetime.fromisoformat(event_end.replace("Z", "+00:00"))

        # Extend by requested minutes before (for first pass) and 2 minutes after to ensure curve touches horizon
        extended_start_dt = start_dt - timedelta(minutes=max(2, extend_start_minutes))
        extended_end_dt = end_dt + timedelta(minutes=2)

        # Calculate duration including the buffer
        total_duration_seconds = (extended_end_dt - extended_start_dt).total_seconds()

        # Adaptive sampling: aim for ~60-120 points per pass
        # For short passes (< 10 min), sample every 10 seconds
        # For medium passes (10-30 min), sample every 15 seconds
        # For long passes (> 30 min), sample every 30 seconds
        if total_duration_seconds < 600:  # Less than 10 minutes
            sample_interval = 10  # 10 seconds
        elif total_duration_seconds < 1800:  # Less than 30 minutes
            sample_interval = 15  # 15 seconds
        else:  # 30 minutes or more
            sample_interval = 30  # 30 seconds

        # Calculate number of samples
        num_samples = max(int(total_duration_seconds / sample_interval), 2)

        # Create time array including the buffer
        t_start = ts.from_datetime(extended_start_dt)
        t_end = ts.from_datetime(extended_end_dt)
        time_offsets = np.linspace(0, (t_end.tt - t_start.tt), num_samples)
        t_points = t_start + time_offsets

        # Calculate elevation at each time point
        difference = satellite - observer
        all_points = []

        for t in t_points:
            topocentric = difference.at(t)
            alt, az, distance = topocentric.altaz()

            all_points.append(
                {
                    "time": t.utc_iso(),
                    "elevation": round(float(alt.degrees), 2),
                    "azimuth": round(float(az.degrees), 2),
                    "distance": round(float(distance.km), 2),
                }
            )

        # Filter to only include points above horizon, plus interpolate 0° crossing points
        filtered_points: List[Dict[str, Any]] = []

        for i, point in enumerate(all_points):
            if point["elevation"] >= 0:
                # If this is the first positive point and there's a previous point
                if len(filtered_points) == 0 and i > 0:
                    prev_point = all_points[i - 1]
                    if prev_point["elevation"] < 0:
                        # Interpolate to find 0° crossing
                        ratio = (0 - prev_point["elevation"]) / (
                            point["elevation"] - prev_point["elevation"]
                        )

                        # Interpolate time
                        time_diff_seconds = (t_points[i].tt - t_points[i - 1].tt) * 86400
                        interpolated_time = t_points[i - 1].tt + (ratio * time_diff_seconds / 86400)
                        interpolated_t = ts.tt_jd(interpolated_time)

                        filtered_points.append(
                            {
                                "time": interpolated_t.utc_iso(),
                                "elevation": 0.0,
                                "azimuth": round(
                                    prev_point["azimuth"]
                                    + ratio * (point["azimuth"] - prev_point["azimuth"]),
                                    2,
                                ),
                                "distance": round(
                                    prev_point["distance"]
                                    + ratio * (point["distance"] - prev_point["distance"]),
                                    2,
                                ),
                            }
                        )

                # Add the positive elevation point
                filtered_points.append(point)

                # If next point is negative, interpolate the 0° crossing at the end
                if i < len(all_points) - 1:
                    next_point = all_points[i + 1]
                    if next_point["elevation"] < 0:
                        # Interpolate to find 0° crossing
                        ratio = (0 - point["elevation"]) / (
                            next_point["elevation"] - point["elevation"]
                        )

                        # Interpolate time
                        time_diff_seconds = (t_points[i + 1].tt - t_points[i].tt) * 86400
                        interpolated_time = t_points[i].tt + (ratio * time_diff_seconds / 86400)
                        interpolated_t = ts.tt_jd(interpolated_time)

                        filtered_points.append(
                            {
                                "time": interpolated_t.utc_iso(),
                                "elevation": 0.0,
                                "azimuth": round(
                                    point["azimuth"]
                                    + ratio * (next_point["azimuth"] - point["azimuth"]),
                                    2,
                                ),
                                "distance": round(
                                    point["distance"]
                                    + ratio * (next_point["distance"] - point["distance"]),
                                    2,
                                ),
                            }
                        )
                        break  # Stop after adding the last 0° point

        return filtered_points

    except Exception as e:
        logger.error(f"Error calculating elevation curve: {e}")
        logger.exception(e)
        return []


def run_events_calculation(
    satellite_data, homelat, homelon, hours, above_el, step_minutes, use_cache=False
):
    """
    Calculate satellite pass events. This function runs in a worker process.

    NOTE: Cache handling is now done in the main process (fetch_next_events_for_*)
    to keep cache operations simple and avoid any IPC overhead. This function only does computation.
    """
    # Set process name if not already set by pool initializer
    current_proc = multiprocessing.current_process()
    if current_proc.name.startswith("ForkPoolWorker"):
        setproctitle.setproctitle("Ground Station - SatellitePassWorker")
        current_proc.name = "Ground Station - SatellitePassWorker"

    # Calculate events (no cache access - handled in main process)
    events = calculate_next_events(
        satellite_data=satellite_data,  # Pass the full satellite data directly
        home_location={"lat": homelat, "lon": homelon},
        hours=hours,
        above_el=above_el,
        step_minutes=step_minutes,
    )

    events["cached"] = False

    # Enrich the events result with the forecast window
    if isinstance(events, dict):
        events["forecast_hours"] = hours

    return events


async def fetch_next_events_for_group(
    group_id: str, hours: float = 2.0, above_el=0, step_minutes=1, force_recalculate: bool = False
):
    """
    Fetches the next satellite events for a given group of satellites within a specified
    time frame. This function calculates the satellite events for a group identifier over
    a defined number of hours, altitude threshold, and minute step interval.

    :param group_id: The unique identifier of the satellite group for which satellite events
        are being fetched.
    :type group_id: str
    :param hours: The number of hours to calculate future satellite events. Defaults to 6.0.
    :type hours: float
    :param above_el: The minimum elevation in degrees above the horizon to filter satellite
        events. Defaults to 0.
    :type above_el: int
    :param step_minutes: The interval in minutes at which satellite positions are queried.
        Defaults to 1.
    :type step_minutes: int
    :param force_recalculate: If True, bypass cache and force fresh calculation. Defaults to False.
    :type force_recalculate: bool
    :return: A dictionary containing the success status, input parameters for the request,
        and the list of satellite events for the group.
    :rtype: dict
    """

    assert group_id, f"Group id is required ({group_id}, {type(group_id)})"

    start_time = time.time()
    reply: Dict[str, Union[bool, None, list, Dict, str]] = {
        "success": None,
        "data": None,
        "parameters": None,
    }
    events = []

    logger.info(
        f"Calculating events for group_id={group_id}, hours={hours}, "
        f"above_el={above_el}, step_minutes={step_minutes} (fetch_next_events_for_group)"
    )

    async with AsyncSessionLocal() as dbsession:
        try:
            # Get home location (get first location from list)
            home = await crud.locations.fetch_all_locations(dbsession)

            if not home["data"] or len(home["data"]) == 0:
                raise Exception("No home location found in the database")

            homelat = float(home["data"][0]["lat"])
            homelon = float(home["data"][0]["lon"])

            # Fetch satellite data
            satellites = await crud.satellites.fetch_satellites_for_group_id(dbsession, group_id)
            satellites = json.loads(json.dumps(satellites["data"], cls=ModelEncoder))

            # Generate cache key for this request
            tle_groups_for_cache = []
            for sat in satellites:
                propagation_input = get_propagation_input(sat, central_body=CentralBody.EARTH)
                tle_groups_for_cache.append(_orbit_cache_identity(sat, propagation_input))
            cache_key = _generate_cache_key(
                tle_groups_for_cache, homelat, homelon, hours, above_el, step_minutes
            )

            # Check cache BEFORE spawning worker process (main process only, no IPC)
            # Skip cache if force_recalculate is True
            current_time = time.time()
            result = None

            if not force_recalculate:
                try:
                    if cache_key in _cache:
                        calculation_time, valid_until, cached_result = _cache[cache_key]

                        if current_time < valid_until:
                            # Return cached result with original calculation window
                            result = {
                                "success": cached_result["success"],
                                "forecast_hours": hours,
                                "data": cached_result["data"],
                                "cached": True,
                                "pass_range_start": cached_result.get("pass_range_start"),
                                "pass_range_end": cached_result.get("pass_range_end"),
                            }
                except Exception as cache_error:
                    logger.error(
                        f"Cache error for group_id={group_id}: {cache_error} (fetch_next_events_for_group)"
                    )
            else:
                logger.info(f"Force recalculate requested, skipping cache for group_id={group_id}")

            # If no cache hit, spawn worker to calculate
            if result is None:
                # Calculate the time window for pass calculations (do this BEFORE worker calculation)
                calculation_start = datetime.now(timezone.utc)
                calculation_end = calculation_start + timedelta(hours=hours)

                logger.info("Cache miss - submitting calculation to worker pool")
                # Use persistent pool (reused across all calculations)
                pool = _get_worker_pool()
                # Submit the calculation task to the pool, passing the serialized satellites list
                # NOTE: use_cache=False because cache is handled in main process
                logger.info("Submitting calculation to worker pool")
                async_result = pool.apply_async(
                    run_events_calculation,
                    (satellites, homelat, homelon, hours, above_el, step_minutes, False),
                )
                logger.info("Waiting for worker to complete calculation")
                result = await asyncio.get_event_loop().run_in_executor(None, async_result.get)
                logger.info("Worker completed, result received")

                # Add calculation window to result (result is guaranteed to be dict here)
                if result:
                    result["pass_range_start"] = calculation_start.isoformat()
                    result["pass_range_end"] = calculation_end.isoformat()

                # Store result in cache (main process only, no IPC from worker)
                try:
                    validity_period = int((hours / 4) * 3600)
                    valid_until = time.time() + validity_period
                    _cache[cache_key] = (time.time(), valid_until, result)

                    # Clean up expired cache entries
                    expired_keys = [k for k in _cache.keys() if time.time() > _cache[k][1]]
                    for k in expired_keys:
                        del _cache[k]
                except Exception as cache_store_error:
                    logger.error(
                        f"Cache store error: {cache_store_error} (fetch_next_events_for_group)"
                    )

            if result and result.get("success", False):
                events_data = result.get("data", [])

                # Create a lookup dict for satellite names, transmitters and counts
                satellite_info = {
                    sat["norad_id"]: {
                        "name": sat["name"],
                        "alternative_name": sat.get("alternative_name", ""),
                        "name_other": sat.get("name_other", ""),
                        "transmitters": sat.get("transmitters", []),
                        "transmitter_count": len([t for t in sat.get("transmitters", [])]),
                    }
                    for sat in satellites
                }

                # Add satellite names, transmitters and counts to events
                for event in events_data:
                    event["name"] = satellite_info[event["norad_id"]]["name"]
                    event["alternative_name"] = satellite_info[event["norad_id"]][
                        "alternative_name"
                    ]
                    event["name_other"] = satellite_info[event["norad_id"]]["name_other"]
                    event["transmitters"] = satellite_info[event["norad_id"]]["transmitters"]
                    event["transmitter_count"] = satellite_info[event["norad_id"]][
                        "transmitter_count"
                    ]
                    event["id"] = f"{event['id']}_{event['norad_id']}_{event['event_start']}"

                    # Elevation curves are now calculated in the frontend for better performance
                    # Set to empty array - frontend will calculate using satellite.js
                    event["elevation_curve"] = []

                    events.append(event)

                reply["success"] = True
                reply["parameters"] = {
                    "group_id": group_id,
                    "hours": hours,
                    "above_el": above_el,
                    "step_minutes": step_minutes,
                }
                reply["data"] = events
                reply["forecast_hours"] = result.get("forecast_hours", hours)
                reply["cached"] = result.get("cached", False)
                reply["pass_range_start"] = result.get("pass_range_start")
                reply["pass_range_end"] = result.get("pass_range_end")

                elapsed_ms = (time.time() - start_time) * 1000
                logger.info(
                    f"Returned {len(events)} events for group_id={group_id}, "
                    f"cached={result.get('cached', False)}, elapsed={elapsed_ms:.1f}ms (fetch_next_events_for_group)"
                )

            else:
                raise Exception(f"Subprocess for calculating next passes failed: {result}")

        except Exception as e:
            logger.error(f"Error fetching next passes for group: {group_id}, error: {e}")
            logger.exception(e)
            reply["success"] = False
            reply["data"] = []

        finally:
            pass

    return reply


async def fetch_next_events_for_satellite(
    norad_id: int, hours: float = 2.0, above_el=0, step_minutes=1, force_recalculate: bool = False
):
    """
    This function fetches the next satellite events for a specified satellite within a specified
    time frame. This function calculates the satellite events over a defined number
    of hours, altitude threshold, and minute step interval. Each event includes an elevation
    curve with adaptive sampling (30s for short passes, up to 2min for long passes).

    :param norad_id: The NORAD ID of the satellite for which events are being fetched
    :type norad_id: int
    :param hours: The number of hours to calculate future satellite events. Defaults to 2.0
    :type hours: float
    :param above_el: The minimum elevation in degrees above the horizon to filter satellite
        events. Defaults to 0.
    :type above_el: int
    :param step_minutes: The interval in minutes at which satellite positions are queried.
        Defaults to 1.
    :type step_minutes: int
    :param force_recalculate: If True, bypass cache and force fresh calculation. Defaults to False.
    :type force_recalculate: bool
    :return: A dictionary containing the success status, input parameters for the request,
        and the list of satellite events with elevation curves.
    :rtype: dict
    """

    assert norad_id, f"NORAD ID is required ({norad_id}, {type(norad_id)})"

    start_time = time.time()
    reply: Dict[str, Union[bool, None, list, Dict]] = {
        "success": None,
        "data": None,
        "parameters": None,
        "cached": False,
    }
    events = []

    logger.info(
        f"Calculating events for norad_id={norad_id}, hours={hours}, "
        f"above_el={above_el}, step_minutes={step_minutes} (fetch_next_events_for_satellite)"
    )
    async with AsyncSessionLocal() as dbsession:
        try:
            # Get home location (get first location from list)
            home = await crud.locations.fetch_all_locations(dbsession)

            if not home["data"] or len(home["data"]) == 0:
                raise Exception("No home location found in the database")

            homelat = float(home["data"][0]["lat"])
            homelon = float(home["data"][0]["lon"])

            # Fetch satellite data
            satellite_reply = await crud.satellites.fetch_satellites(dbsession, norad_id=norad_id)
            satellite = json.loads(json.dumps(satellite_reply["data"][0], cls=ModelEncoder))

            # Generate cache key for this request
            propagation_input = get_propagation_input(satellite, central_body=CentralBody.EARTH)
            tle_groups_for_cache = [_orbit_cache_identity(satellite, propagation_input)]
            cache_key = _generate_cache_key(
                tle_groups_for_cache, homelat, homelon, hours, above_el, step_minutes
            )

            # Check cache BEFORE spawning worker process (main process only, no IPC)
            # Skip cache if force_recalculate is True
            current_time = time.time()
            result = None

            if not force_recalculate:
                try:
                    if cache_key in _cache:
                        calculation_time, valid_until, cached_result = _cache[cache_key]

                        if current_time < valid_until:
                            result = {
                                "success": cached_result["success"],
                                "forecast_hours": hours,
                                "data": cached_result["data"],
                                "cached": True,
                            }
                except Exception as cache_error:
                    logger.error(
                        f"Cache error for norad_id={norad_id}: {cache_error} (fetch_next_events_for_satellite)"
                    )
            else:
                logger.info(f"Force recalculate requested, skipping cache for norad_id={norad_id}")

            # If no cache hit, spawn worker to calculate
            if result is None:
                logger.info("Cache miss - submitting calculation to worker pool")
                # Use persistent pool (reused across all calculations)
                pool = _get_worker_pool()
                # Submit the calculation task to the pool, passing the serialized satellite dict
                # NOTE: use_cache=False because cache is handled in main process
                logger.info("Submitting calculation to worker pool")
                async_result = pool.apply_async(
                    run_events_calculation,
                    (satellite, homelat, homelon, hours, above_el, step_minutes, False),
                )
                logger.info("Waiting for worker to complete calculation")
                result = await asyncio.get_event_loop().run_in_executor(None, async_result.get)
                logger.info("Worker completed, result received")

                # Store result in cache (main process only, no IPC from worker)
                try:
                    validity_period = int((hours / 4) * 3600)
                    valid_until = time.time() + validity_period
                    _cache[cache_key] = (time.time(), valid_until, result)

                    # Clean up expired cache entries
                    expired_keys = [k for k in _cache.keys() if time.time() > _cache[k][1]]
                    for k in expired_keys:
                        del _cache[k]
                except Exception as cache_store_error:
                    logger.error(
                        f"Cache store error: {cache_store_error} (fetch_next_events_for_satellite)"
                    )

            if result and result.get("success", False):
                events_for_satellite = result.get("data", [])

                home_location = {"lat": homelat, "lon": homelon}
                now_utc = datetime.now(timezone.utc)

                for event in events_for_satellite:
                    event["name"] = satellite["name"]
                    # Pass calculations do not include radio metadata; attach it here so
                    # the target table can summarize transmitter link configurations.
                    event["transmitters"] = satellite.get("transmitters", [])
                    stable_suffix = f"_{satellite['norad_id']}_{event['event_start']}"
                    base_event_id = str(event.get("id") or "").strip()
                    if not base_event_id:
                        event["id"] = f"{satellite['norad_id']}_{event['event_start']}"
                    elif base_event_id.endswith(stable_suffix):
                        event["id"] = base_event_id
                    else:
                        # Keep IDs stable across cache hits: avoid repeatedly appending suffixes.
                        event["id"] = f"{base_event_id}{stable_suffix}"

                    # Build elevation curves server-side for the target page so the UI thread
                    # does not run heavy per-pass propagation during route changes.
                    existing_curve = event.get("elevation_curve")
                    if isinstance(existing_curve, list) and len(existing_curve) > 0:
                        events.append(event)
                        continue

                    event_start = str(event.get("event_start") or "").strip()
                    event_end = str(event.get("event_end") or "").strip()
                    if not event_start or not event_end:
                        event["elevation_curve"] = []
                        events.append(event)
                        continue

                    try:
                        start_dt = datetime.fromisoformat(event_start.replace("Z", "+00:00"))
                        end_dt = datetime.fromisoformat(event_end.replace("Z", "+00:00"))
                        if start_dt.tzinfo is None:
                            start_dt = start_dt.replace(tzinfo=timezone.utc)
                        if end_dt.tzinfo is None:
                            end_dt = end_dt.replace(tzinfo=timezone.utc)

                        time_until_start_minutes = (start_dt - now_utc).total_seconds() / 60.0
                        time_since_end_minutes = (now_utc - end_dt).total_seconds() / 60.0
                        should_extend = (
                            time_until_start_minutes <= 120.0 and time_since_end_minutes <= 30.0
                        )
                        extend_start_minutes = 30 if should_extend else 0
                    except Exception:
                        # If parsing fails, still attempt curve calculation without extra extension.
                        extend_start_minutes = 0

                    event["elevation_curve"] = _calculate_elevation_curve(
                        satellite_data=satellite,
                        home_location=home_location,
                        event_start=event_start,
                        event_end=event_end,
                        extend_start_minutes=extend_start_minutes,
                    )

                    events.append(event)

                reply["success"] = True
                reply["parameters"] = {
                    "norad_id": norad_id,
                    "hours": hours,
                    "above_el": above_el,
                    "step_minutes": step_minutes,
                }
                reply["data"] = events
                reply["cached"] = result.get("cached", False)
                reply["forecast_hours"] = result.get("forecast_hours", hours)

                elapsed_ms = (time.time() - start_time) * 1000
                logger.info(
                    f"Returned {len(events)} events for norad_id={norad_id}, "
                    f"cached={result.get('cached', False)}, elapsed={elapsed_ms:.1f}ms (fetch_next_events_for_satellite)"
                )

            else:
                raise Exception(f"Subprocess for calculating next passes failed: {result}")

        except Exception as e:
            logger.error(f"Error fetching next passes for satellite: {norad_id}, error: {e}")
            logger.exception(e)
            reply["success"] = False
            reply["data"] = []

        finally:
            pass

    return reply
