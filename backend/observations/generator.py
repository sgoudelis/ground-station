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

"""Core observation generation logic."""

import traceback
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from common.common import logger
from crud import locations as crud_locations
from crud.monitoredsatellites import (
    fetch_enabled_monitored_satellites,
    fetch_monitored_satellites,
    mark_observation_as_generated,
)
from crud.satellites import fetch_satellites
from crud.scheduledobservations import (
    add_scheduled_observation,
    delete_scheduled_observations,
    edit_scheduled_observation,
)
from db.models import ScheduledObservations
from observations.conflicts import (
    find_any_time_conflict,
    find_overlapping_observation,
    should_update_observation,
)
from observations.constants import (
    CONFLICT_STRATEGY_FORCE,
    CONFLICT_STRATEGY_PRIORITY,
    DEFAULT_CONFLICT_STRATEGY,
    STATUS_CANCELLED,
    STATUS_COMPLETED,
    STATUS_FAILED,
    STATUS_MISSED,
    STATUS_SCHEDULED,
)
from orbits import CentralBody, OrbitServiceError, get_propagation_input
from tracking.elcalculator import calculate_elevation_crossing_time
from tracking.passes import calculate_next_events

# CONFLICT RESOLUTION STRATEGY
# Options: "priority", "skip", "force"
# - priority: Keep passes with higher peak elevation
# - skip: Skip all conflicting passes and log
# - force: Schedule anyway, allow overlaps
CONFLICT_RESOLUTION_STRATEGY = DEFAULT_CONFLICT_STRATEGY


def _normalize_resource_id(resource_id: Any) -> Optional[str]:
    if resource_id is None:
        return None
    value = str(resource_id).strip()
    if not value or value.lower() == "none":
        return None
    return value


def _extract_sdr_ids_from_sessions(sessions: Any) -> set[str]:
    sdr_ids: set[str] = set()
    if not isinstance(sessions, list):
        return sdr_ids
    for session in sessions:
        if not isinstance(session, dict):
            continue
        sdr_id = _normalize_resource_id((session.get("sdr") or {}).get("id"))
        if sdr_id:
            sdr_ids.add(sdr_id)
    return sdr_ids


def _extract_candidate_resources(monitored_sat: dict) -> dict:
    sessions = monitored_sat.get("sessions") or []
    sdr_ids = _extract_sdr_ids_from_sessions(sessions)
    rotator_id = _normalize_resource_id((monitored_sat.get("rotator") or {}).get("id"))
    rig_id = _normalize_resource_id((monitored_sat.get("rig") or {}).get("id"))
    return {
        "sdr_ids": sdr_ids,
        "rotator_id": rotator_id,
        "rig_id": rig_id,
    }


def _extract_observation_resources(observation: ScheduledObservations) -> dict:
    sdr_ids = _extract_sdr_ids_from_sessions(observation.sessions or [])
    fallback_sdr_id = _normalize_resource_id(observation.sdr_id)
    if fallback_sdr_id:
        sdr_ids.add(fallback_sdr_id)
    return {
        "sdr_ids": sdr_ids,
        "rotator_id": _normalize_resource_id(observation.rotator_id),
        "rig_id": _normalize_resource_id(observation.rig_id),
    }


def _get_conflict_reasons(candidate_resources: dict, existing_resources: dict) -> list[str]:
    reasons: list[str] = []
    if candidate_resources["sdr_ids"] and existing_resources["sdr_ids"]:
        if candidate_resources["sdr_ids"].intersection(existing_resources["sdr_ids"]):
            reasons.append("sdr")
    if (
        candidate_resources["rig_id"]
        and existing_resources["rig_id"]
        and candidate_resources["rig_id"] == existing_resources["rig_id"]
    ):
        reasons.append("rig")
    if (
        candidate_resources["rotator_id"]
        and existing_resources["rotator_id"]
        and candidate_resources["rotator_id"] == existing_resources["rotator_id"]
    ):
        reasons.append("rotator")
    return reasons


def _build_pass_id(monitored_satellite_id: str, norad_id: int, pass_data: dict) -> str:
    return (
        f"{monitored_satellite_id}:{norad_id}:"
        f"{pass_data.get('event_start', '')}:{pass_data.get('event_end', '')}"
    )


async def cleanup_old_observations(session: AsyncSession) -> int:
    """
    Delete completed, failed, cancelled, and missed observations that are over 24 hours old.

    Args:
        session: Database session

    Returns:
        Number of observations deleted
    """
    try:
        cutoff_time = datetime.now(timezone.utc) - timedelta(hours=24)

        # Find completed, failed, cancelled, or missed observations older than 24 hours
        stmt = select(ScheduledObservations).filter(
            and_(
                ScheduledObservations.status.in_(
                    [STATUS_COMPLETED, STATUS_FAILED, STATUS_CANCELLED, STATUS_MISSED]
                ),
                ScheduledObservations.event_end < cutoff_time,
            )
        )

        result = await session.execute(stmt)
        old_observations = result.scalars().all()

        if old_observations:
            observation_ids = [obs.id for obs in old_observations]
            logger.info(
                f"Cleaning up {len(observation_ids)} old observations (completed/failed/cancelled/missed) older than 24 hours"
            )

            # Delete the observations
            await delete_scheduled_observations(session, observation_ids)
            return len(observation_ids)

        return 0

    except Exception as e:
        logger.error(f"Error cleaning up old observations: {e}")
        logger.error(traceback.format_exc())
        return 0


async def generate_observations_for_monitored_satellites(
    session: AsyncSession,
    monitored_satellite_id: Optional[str] = None,
    dry_run: bool = False,
    user_conflict_overrides: Optional[dict] = None,
) -> dict:
    """
    Generate scheduled observations for monitored satellites.

    Args:
        session: Database session
        monitored_satellite_id: Optional ID to generate for specific satellite, or None for all
        dry_run: If True, only preview conflicts without creating/modifying observations
        user_conflict_overrides: Dict mapping conflict IDs to actions ("keep" or "replace")

    Returns:
        Dict with success status, statistics, and any errors.
        In dry_run mode, includes "conflicts" and "no_conflicts" arrays.
    """
    try:
        mode = "DRY-RUN" if dry_run else "LIVE"
        logger.info(
            f"Starting observation generation ({mode}) with conflict strategy: {CONFLICT_RESOLUTION_STRATEGY}"
        )

        # Clean up old completed observations (skip in dry-run mode)
        if not dry_run:
            deleted_count = await cleanup_old_observations(session)
            if deleted_count > 0:
                logger.info(f"Cleaned up {deleted_count} old completed observations")

        # Fetch monitored satellites
        if monitored_satellite_id:
            result = await fetch_monitored_satellites(session, monitored_satellite_id)
            if not result["success"]:
                return {
                    "success": False,
                    "error": result.get("error", "Unknown error"),
                    "data": None,
                }
            monitored_sats = [result["data"]] if result["data"] else []
        else:
            result = await fetch_enabled_monitored_satellites(session)
            if not result["success"]:
                return {
                    "success": False,
                    "error": result.get("error", "Unknown error"),
                    "data": None,
                }
            monitored_sats = result["data"] or []

        # Targeted generation must respect the same enabled flag as background generation.
        monitored_sats = [mon_sat for mon_sat in monitored_sats if mon_sat.get("enabled", True)]

        if not monitored_sats:
            return {
                "success": True,
                "data": {"generated": 0, "updated": 0, "skipped": 0, "satellites_processed": 0},
                "error": None,
            }

        # Fetch ground station location (get first location from database)
        locations_result = await crud_locations.fetch_all_locations(session)
        if not locations_result["success"]:
            return {
                "success": False,
                "error": f"Failed to fetch locations: {locations_result['error']}",
            }

        locations = locations_result["data"] or []
        if not locations:
            logger.warning("No ground station location found in database")
            return {
                "success": False,
                "error": "No ground station location found. Please add a location in the settings.",
            }

        # Use first location as home location (same as tracking system does)
        home_location = {"lat": float(locations[0]["lat"]), "lon": float(locations[0]["lon"])}

        stats = {"generated": 0, "updated": 0, "skipped": 0, "satellites_processed": 0}
        conflicting_passes = []
        no_conflict_passes = []

        # Process each monitored satellite
        for mon_sat in monitored_sats:
            try:
                result = await _generate_observations_for_satellite(
                    session, mon_sat, home_location, dry_run, user_conflict_overrides
                )
                stats["satellites_processed"] += 1
                stats["generated"] += result.get("generated", 0)
                stats["updated"] += result.get("updated", 0)
                stats["skipped"] += result.get("skipped", 0)

                if dry_run:
                    conflicting_passes.extend(result.get("conflicting_passes", []))
                    no_conflict_passes.extend(result.get("no_conflict_passes", []))
                else:
                    # Flush changes so subsequent satellites can see these observations in conflict detection
                    await session.flush()

            except Exception as e:
                logger.error(
                    f"Error generating observations for monitored satellite {mon_sat['id']}: {e}"
                )
                logger.error(traceback.format_exc())
                # Continue processing other satellites

        if not dry_run:
            await session.commit()

        result_data = {
            "success": True,
            "data": stats,
            "error": None,
            "dry_run": dry_run,
            "current_strategy": CONFLICT_RESOLUTION_STRATEGY,
        }

        if dry_run:
            result_data["conflicting_passes"] = conflicting_passes
            result_data["no_conflict_passes"] = no_conflict_passes
            # Backward-compatible aliases for older clients.
            result_data["conflicts"] = conflicting_passes
            result_data["no_conflicts"] = no_conflict_passes

        return result_data

    except Exception as e:
        await session.rollback()
        logger.error(f"Error in generate_observations_for_monitored_satellites: {e}")
        logger.error(traceback.format_exc())
        return {"success": False, "error": str(e)}


async def _generate_observations_for_satellite(
    session: AsyncSession,
    monitored_sat: dict,
    home_location: dict,
    dry_run: bool = False,
    user_conflict_overrides: Optional[dict] = None,
) -> dict:
    """
    Generate observations for a single monitored satellite.

    Args:
        session: Database session
        monitored_sat: Monitored satellite data
        home_location: Ground station location dict with 'lat' and 'lon'
        dry_run: If True, only preview conflicts
        user_conflict_overrides: User's conflict resolution choices

    Returns:
        Dict with statistics for this satellite
    """
    stats = {"generated": 0, "updated": 0, "skipped": 0}
    conflicting_passes = []
    no_conflict_passes = []

    if user_conflict_overrides is None:
        user_conflict_overrides = {}

    candidate_resources = _extract_candidate_resources(monitored_sat)

    # Fetch satellite TLE data
    norad_id = monitored_sat["satellite"]["norad_id"]
    sat_result = await fetch_satellites(session, norad_id=norad_id)

    if not sat_result["success"] or not sat_result["data"]:
        logger.error(f"Failed to fetch satellite data for NORAD ID {norad_id}")
        return stats

    satellite_data = sat_result["data"][0]  # fetch_satellites returns a list
    try:
        satellite_propagation_input = get_propagation_input(
            satellite_data, central_body=CentralBody.EARTH
        )
    except OrbitServiceError as e:
        logger.error("Failed to resolve orbit data for NORAD ID %s: %s", norad_id, e)
        return stats

    # Extract generation config (flattened in the dict by CRUD transform)
    min_elevation = monitored_sat.get("min_elevation", 20)
    lookahead_hours = monitored_sat.get("lookahead_hours", 24)

    logger.info(
        f"Generating observations for {satellite_data['name']} (NORAD {norad_id}): "
        f"min_elevation={min_elevation}°, lookahead={lookahead_hours}h"
    )

    # Calculate passes from horizon (above_el=0) to get complete passes
    passes_result = calculate_next_events(
        satellite_data=satellite_data,
        home_location=home_location,
        hours=lookahead_hours,
        above_el=0,  # Always calculate from horizon to get full pass times
    )

    if not passes_result["success"]:
        logger.error(
            f"Failed to calculate passes for NORAD ID {norad_id}: {passes_result['error']}"
        )
        return stats

    passes = passes_result["data"]

    # Filter passes by peak elevation to only include passes that reach min_elevation
    valid_passes = [p for p in passes if p["peak_altitude"] >= min_elevation]

    logger.info(
        f"Pass filtering for {satellite_data['name']} (NORAD {norad_id}): "
        f"total_passes={len(passes)}, min_elevation={min_elevation}°, "
        f"valid_passes={len(valid_passes)}"
    )

    # Log details of filtered passes
    if len(passes) > 0 and len(valid_passes) < len(passes):
        filtered_out = [p for p in passes if p["peak_altitude"] < min_elevation]
        logger.debug(
            f"Filtered out {len(filtered_out)} passes below {min_elevation}°: "
            f"peaks={[round(p['peak_altitude'], 1) for p in filtered_out[:5]]}"
        )

    # Process each pass
    for pass_data in valid_passes:
        try:
            # Carry the canonical orbit into derived pass data. TLE remains an
            # optional compatibility cache for five-digit catalogue entries.
            pass_data["tle1"] = satellite_propagation_input.tle1
            pass_data["tle2"] = satellite_propagation_input.tle2
            pass_data["orbit_format"] = satellite_data.get("orbit_format")
            pass_data["orbit_payload"] = satellite_data.get("orbit_payload")

            event_start = datetime.fromisoformat(pass_data["event_start"].replace("Z", "+00:00"))
            event_end = datetime.fromisoformat(pass_data["event_end"].replace("Z", "+00:00"))

            # Check for existing observation from same monitored satellite
            existing = await find_overlapping_observation(
                session, norad_id, event_start, event_end, monitored_sat["id"]
            )

            if existing:
                # Preserve observations that have started or reached a terminal state.
                if should_update_observation(existing):
                    if not dry_run:
                        await _update_observation(session, existing, monitored_sat, pass_data)
                    stats["updated"] += 1
                else:
                    stats["skipped"] += 1
            else:
                # Calculate task times for this pass to use in conflict detection
                task_start_elevation = monitored_sat.get("task_start_elevation", 10)
                task_start_time = None
                task_end_time = None

                if task_start_elevation > 0:
                    get_propagation_input(pass_data, central_body=CentralBody.EARTH)
                    satellite_tle = dict(pass_data)
                    location_result = await crud_locations.fetch_all_locations(session)
                    if (
                        location_result
                        and location_result.get("success")
                        and len(location_result.get("data", [])) > 0
                    ):
                        location = location_result["data"][0]
                        home_location_dict = {
                            "lat": location.get("lat"),
                            "lon": location.get("lon"),
                        }

                        task_start_time, task_end_time = calculate_elevation_crossing_time(
                            satellite_tle=satellite_tle,
                            home_location=home_location_dict,
                            aos_time=event_start,
                            los_time=event_end,
                            target_elevation=task_start_elevation,
                        )

                # Fall back to event times if calculation failed
                if not task_start_time:
                    task_start_time = event_start
                if not task_end_time:
                    task_end_time = event_end

                # Force strategy bypasses conflict resolution and always schedules.
                if CONFLICT_RESOLUTION_STRATEGY == CONFLICT_STRATEGY_FORCE:
                    if dry_run:
                        no_conflict_passes.append(
                            _build_pass_preview(satellite_data, pass_data, monitored_sat)
                        )
                    else:
                        await _create_observation(session, monitored_sat, pass_data)
                    stats["generated"] += 1
                    continue

                # First find overlapping windows, then keep only hardware blockers.
                time_overlaps = await find_any_time_conflict(
                    session,
                    event_start,
                    event_end,
                    task_start=task_start_time,
                    task_end=task_end_time,
                )
                pass_id = _build_pass_id(monitored_sat["id"], norad_id, pass_data)
                blocking_observations: list[tuple[ScheduledObservations, list[str]]] = []
                for overlapping_obs in time_overlaps:
                    reasons = _get_conflict_reasons(
                        candidate_resources, _extract_observation_resources(overlapping_obs)
                    )
                    if reasons:
                        blocking_observations.append((overlapping_obs, reasons))

                if not blocking_observations:
                    if dry_run:
                        no_conflict_passes.append(
                            _build_pass_preview(satellite_data, pass_data, monitored_sat)
                        )
                    else:
                        await _create_observation(session, monitored_sat, pass_data)
                    stats["generated"] += 1
                    continue

                new_elevation = pass_data["peak_altitude"]
                strategy_action = "keep_existing"
                if CONFLICT_RESOLUTION_STRATEGY == CONFLICT_STRATEGY_PRIORITY:
                    max_existing_elevation = max(
                        obs.pass_config.get("peak_altitude", 0) for obs, _ in blocking_observations
                    )
                    if new_elevation > max_existing_elevation:
                        strategy_action = "replace_blockers"
                raw_user_action = user_conflict_overrides.get(pass_id)
                user_action = raw_user_action
                if raw_user_action == "keep":
                    user_action = "keep_existing"
                elif raw_user_action == "replace":
                    user_action = "replace_blockers"
                effective_action = (
                    user_action
                    if user_action in {"keep_existing", "replace_blockers"}
                    else strategy_action
                )

                blockers_preview = []
                for conflicting_obs, reasons in blocking_observations:
                    blockers_preview.append(
                        {
                            "id": conflicting_obs.id,
                            "satellite": conflicting_obs.satellite_config.get("name", "Unknown"),
                            "norad_id": conflicting_obs.norad_id,
                            "elevation": conflicting_obs.pass_config.get("peak_altitude", 0),
                            "start": conflicting_obs.event_start.isoformat(),
                            "end": conflicting_obs.event_end.isoformat(),
                            "reasons": reasons,
                        }
                    )

                if dry_run:
                    conflicting_passes.append(
                        {
                            "pass_id": pass_id,
                            "time_window": (
                                f"{event_start.strftime('%Y-%m-%d %H:%M')} - "
                                f"{event_end.strftime('%H:%M UTC')}"
                            ),
                            "new_pass": {
                                "satellite": satellite_data["name"],
                                "norad_id": norad_id,
                                "elevation": new_elevation,
                                "start": pass_data["event_start"],
                                "end": pass_data["event_end"],
                                "monitored_satellite_id": monitored_sat["id"],
                            },
                            "blockers": blockers_preview,
                            "strategy_action": strategy_action,
                            "user_action": user_action,
                            "effective_action": effective_action,
                        }
                    )
                    if effective_action == "replace_blockers":
                        stats["generated"] += 1
                    else:
                        stats["skipped"] += 1
                    continue

                if effective_action == "replace_blockers":
                    blocking_ids = [obs.id for obs, _ in blocking_observations]
                    logger.info(
                        "CONFLICT: Replacing %s blocker observation(s) for %s " "(elevation %.1f°)",
                        len(blocking_ids),
                        satellite_data["name"],
                        new_elevation,
                    )
                    await delete_scheduled_observations(session, blocking_ids)
                    await _create_observation(session, monitored_sat, pass_data)
                    stats["generated"] += 1
                else:
                    logger.info(
                        "CONFLICT: Keeping existing observations, skipping %s " "(elevation %.1f°)",
                        satellite_data["name"],
                        new_elevation,
                    )
                    stats["skipped"] += 1

        except Exception as e:
            logger.error(f"Error processing pass for NORAD ID {norad_id}: {e}")
            logger.error(traceback.format_exc())
            continue

    result: dict = stats.copy()
    if dry_run:
        result["conflicting_passes"] = conflicting_passes
        result["no_conflict_passes"] = no_conflict_passes
        # Backward-compatible aliases for older clients.
        result["conflicts"] = conflicting_passes
        result["no_conflicts"] = no_conflict_passes

    return result


def _build_pass_preview(satellite_data: dict, pass_data: dict, monitored_sat: dict) -> dict:
    """Build a preview dict for a pass that will be created without conflict."""
    event_start = datetime.fromisoformat(pass_data["event_start"].replace("Z", "+00:00"))
    event_end = datetime.fromisoformat(pass_data["event_end"].replace("Z", "+00:00"))

    return {
        "satellite": satellite_data["name"],
        "norad_id": satellite_data["norad_id"],
        "elevation": pass_data["peak_altitude"],
        "start": pass_data["event_start"],
        "end": pass_data["event_end"],
        "time_window": f"{event_start.strftime('%Y-%m-%d %H:%M')} - {event_end.strftime('%H:%M UTC')}",
        "monitored_satellite_id": monitored_sat["id"],
    }


async def _create_observation(session: AsyncSession, monitored_sat: dict, pass_data: dict):
    """
    Create a new scheduled observation from pass data.

    Args:
        session: Database session
        monitored_sat: Monitored satellite configuration
        pass_data: Pass prediction data
    """
    satellite = monitored_sat["satellite"]
    event_start = datetime.fromisoformat(pass_data["event_start"].replace("Z", "+00:00"))
    event_end = datetime.fromisoformat(pass_data["event_end"].replace("Z", "+00:00"))

    # Calculate task start/end times based on elevation threshold
    task_start_elevation = monitored_sat.get("task_start_elevation", 10)
    task_start = None
    task_end = None

    if task_start_elevation > 0:
        # Get satellite TLE
        try:
            get_propagation_input(pass_data, central_body=CentralBody.EARTH)
            satellite_tle = dict(pass_data)
        except OrbitServiceError as e:
            logger.warning(
                "Skipping elevation crossing calculation for %s: %s", satellite["name"], e
            )
            satellite_tle = None

        # Get ground station location
        if satellite_tle is not None:
            location_result = await crud_locations.fetch_all_locations(session)
            if (
                location_result
                and location_result.get("success")
                and len(location_result.get("data", [])) > 0
            ):
                location = location_result["data"][0]
                home_location = {"lat": location.get("lat"), "lon": location.get("lon")}

                # Calculate when satellite crosses task_start_elevation (both ascending and descending)
                task_start, task_end = calculate_elevation_crossing_time(
                    satellite_tle=satellite_tle,
                    home_location=home_location,
                    aos_time=event_start,
                    los_time=event_end,
                    target_elevation=task_start_elevation,
                )

    # Fall back to event_start/event_end if calculation failed or elevation never reached
    if not task_start:
        task_start = event_start
    if not task_end:
        task_end = event_end

    # Format observation name
    obs_name = f"{satellite['name']} - {event_start.strftime('%Y-%m-%d %H:%M UTC')}"

    # Build observation data (format expected by CRUD)
    observation_data = {
        "id": f"obs-{int(datetime.now(timezone.utc).timestamp() * 1000)}",
        "name": obs_name,
        "enabled": True,
        "status": STATUS_SCHEDULED,
        "satellite": satellite,
        "pass": {
            "event_start": pass_data["event_start"],
            "event_end": pass_data["event_end"],
            "peak_altitude": pass_data["peak_altitude"],
            "start_azimuth": pass_data.get("start_azimuth"),
            "end_azimuth": pass_data.get("end_azimuth"),
            "peak_azimuth": pass_data.get("peak_azimuth"),
            "distance_at_peak": pass_data.get("distance_at_peak"),
        },
        "rotator": monitored_sat.get("rotator", {}),
        "rig": monitored_sat.get("rig", {}),
        "transmitter": {},
        "sessions": monitored_sat.get("sessions") or [],
        "task_start_elevation": monitored_sat.get("task_start_elevation", 10),
        "task_start": task_start.isoformat() if task_start else None,
        "task_end": task_end.isoformat() if task_end else None,
    }

    # Create the observation
    result = await add_scheduled_observation(session, observation_data)

    if result["success"]:
        # Mark as auto-generated
        observation_id = result["data"]["id"]
        await mark_observation_as_generated(session, observation_id, monitored_sat["id"])
        logger.info(f"Created observation: {obs_name}")
    else:
        logger.error(f"Failed to create observation: {result['error']}")


async def _update_observation(
    session: AsyncSession, existing_obs, monitored_sat: dict, pass_data: dict
):
    """
    Update an existing scheduled observation with new pass data.

    Args:
        session: Database session
        existing_obs: Existing ScheduledObservations object
        monitored_sat: Monitored satellite configuration
        pass_data: New pass prediction data
    """
    satellite = monitored_sat["satellite"]
    event_start = datetime.fromisoformat(pass_data["event_start"].replace("Z", "+00:00"))
    event_end = datetime.fromisoformat(pass_data["event_end"].replace("Z", "+00:00"))

    # Calculate task start/end times based on elevation threshold
    task_start_elevation = monitored_sat.get("task_start_elevation", 10)
    task_start = None
    task_end = None

    if task_start_elevation > 0:
        # Get satellite TLE
        try:
            get_propagation_input(pass_data, central_body=CentralBody.EARTH)
            satellite_tle = dict(pass_data)
        except OrbitServiceError as e:
            logger.warning(
                "Skipping elevation crossing calculation for %s: %s", satellite["name"], e
            )
            satellite_tle = None

        # Get ground station location
        if satellite_tle is not None:
            location_result = await crud_locations.fetch_all_locations(session)
            if (
                location_result
                and location_result.get("success")
                and len(location_result.get("data", [])) > 0
            ):
                location = location_result["data"][0]
                home_location = {"lat": location.get("lat"), "lon": location.get("lon")}

                # Calculate when satellite crosses task_start_elevation (both ascending and descending)
                task_start, task_end = calculate_elevation_crossing_time(
                    satellite_tle=satellite_tle,
                    home_location=home_location,
                    aos_time=event_start,
                    los_time=event_end,
                    target_elevation=task_start_elevation,
                )

    # Fall back to event_start/event_end if calculation failed or elevation never reached
    if not task_start:
        task_start = event_start
    if not task_end:
        task_end = event_end

    # Format observation name
    obs_name = f"{satellite['name']} - {event_start.strftime('%Y-%m-%d %H:%M UTC')}"

    # Build updated observation data (format expected by CRUD)
    observation_data = {
        "id": existing_obs.id,
        "name": obs_name,
        "enabled": True,
        "status": existing_obs.status,
        "satellite": satellite,
        "pass": {
            "event_start": pass_data["event_start"],
            "event_end": pass_data["event_end"],
            "peak_altitude": pass_data["peak_altitude"],
            "start_azimuth": pass_data.get("start_azimuth"),
            "end_azimuth": pass_data.get("end_azimuth"),
            "peak_azimuth": pass_data.get("peak_azimuth"),
            "distance_at_peak": pass_data.get("distance_at_peak"),
        },
        "rotator": monitored_sat.get("rotator", {}),
        "rig": monitored_sat.get("rig", {}),
        "transmitter": {},
        "sessions": monitored_sat.get("sessions") or [],
        "task_start_elevation": monitored_sat.get("task_start_elevation", 10),
        "task_start": task_start.isoformat() if task_start else None,
        "task_end": task_end.isoformat() if task_end else None,
    }

    # Update the observation
    result = await edit_scheduled_observation(session, observation_data)

    if result["success"]:
        # Update generated_at timestamp
        await mark_observation_as_generated(session, existing_obs.id, monitored_sat["id"])
        logger.info(f"Updated observation: {obs_name}")
    else:
        logger.error(f"Failed to update observation: {result['error']}")
