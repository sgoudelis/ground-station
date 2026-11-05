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

"""Scheduler handlers for scheduled observations and monitored satellites."""

from typing import Any, Dict, List, Optional, Union

import crud.monitoredsatellites as crud_satellites
import crud.scheduledobservations as crud_observations
import observations.events as obs_events
from db import AsyncSessionLocal
from observations.constants import STATUS_FAILED
from observations.events import emit_scheduled_observations_changed
from observations.generator import generate_observations_for_monitored_satellites
from observations.validation import validate_observation_pass, validate_transmitter_frequencies

# ============================================================================
# SCHEDULED OBSERVATIONS
# ============================================================================


async def get_scheduled_observations(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Union[bool, List, str, None]]:
    """
    Get all scheduled observations or a single observation by ID.

    Args:
        sio: Socket.IO server instance
        data: Optional dict with 'observation_id' key to fetch single observation
        logger: Logger instance
        sid: Socket.IO session ID

    Returns:
        Dictionary with success status and observations list or single observation
    """
    observation_id = data.get("observation_id") if data else None
    async with AsyncSessionLocal() as dbsession:
        result = await crud_observations.fetch_scheduled_observations(dbsession, observation_id)
        return {
            "success": result["success"],
            "data": result.get("data", [] if not observation_id else None),
        }


async def create_scheduled_observation(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Union[bool, Dict, str, None]]:
    """
    Create a new scheduled observation.

    Args:
        sio: Socket.IO server instance
        data: Observation data
        logger: Logger instance
        sid: Socket.IO session ID

    Returns:
        Dictionary with success status and created observation
    """
    if not data:
        logger.error("No data provided")
        return {"success": False, "error": "No data provided"}

    observation_id = data.get("id")
    if not observation_id:
        logger.error("No ID provided in observation data")
        return {"success": False, "error": "Observation ID is required"}

    # A selected pass is required for both database timing and scheduler jobs.
    validation_result = validate_observation_pass(data)
    if not validation_result["success"]:
        return {"success": False, "error": validation_result["error"]}

    # Validate transmitter frequencies against SDR configuration
    validation_result = validate_transmitter_frequencies(data)
    if not validation_result["success"]:
        logger.error(f"Frequency validation failed: {validation_result['error']}")
        return {"success": False, "error": validation_result["error"]}

    async with AsyncSessionLocal() as dbsession:
        result = await crud_observations.add_scheduled_observation(dbsession, data)

        # Sync to APScheduler if successful
        if result["success"]:
            if obs_events.observation_sync:
                sync_result = await obs_events.observation_sync.sync_observation(observation_id)

                # Check if APScheduler sync failed
                if not sync_result.get("success"):
                    error_msg = f"Failed to schedule in APScheduler: {sync_result.get('error')}"
                    logger.error(error_msg)

                    # Delete the observation since it can't be scheduled
                    await crud_observations.delete_scheduled_observations(
                        dbsession, [observation_id]
                    )

                    return {
                        "success": False,
                        "error": error_msg,
                    }

            # Emit event to all clients that observations have changed
            await emit_scheduled_observations_changed()

        return {
            "success": result["success"],
            "data": result.get("data"),
            "error": result.get("error"),
        }


async def update_scheduled_observation(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Union[bool, Dict, str, None]]:
    """
    Update an existing scheduled observation.

    Args:
        sio: Socket.IO server instance
        data: Observation data with ID
        logger: Logger instance
        sid: Socket.IO session ID

    Returns:
        Dictionary with success status and updated observation
    """
    if not data:
        logger.error("No data provided")
        return {"success": False, "error": "No data provided"}

    observation_id = data.get("id")
    if not observation_id:
        logger.error("No ID provided in observation data")
        return {"success": False, "error": "Observation ID is required"}

    # Validate before updating so an invalid pass cannot replace saved timing.
    validation_result = validate_observation_pass(data)
    if not validation_result["success"]:
        return {"success": False, "error": validation_result["error"]}

    # Validate transmitter frequencies against SDR configuration
    validation_result = validate_transmitter_frequencies(data)
    if not validation_result["success"]:
        logger.error(f"Frequency validation failed: {validation_result['error']}")
        return {"success": False, "error": validation_result["error"]}

    async with AsyncSessionLocal() as dbsession:
        result = await crud_observations.edit_scheduled_observation(dbsession, data)

        # Sync to APScheduler if successful
        if result["success"]:
            if obs_events.observation_sync:
                sync_result = await obs_events.observation_sync.sync_observation(observation_id)

                # Check if APScheduler sync failed
                if not sync_result.get("success"):
                    error_msg = f"Failed to reschedule in APScheduler: {sync_result.get('error')}"
                    logger.error(error_msg)

                    # Mark observation as failed in database
                    async with AsyncSessionLocal() as status_session:
                        await crud_observations.update_scheduled_observation_status(
                            status_session, observation_id, STATUS_FAILED, error_msg
                        )

                    return {
                        "success": False,
                        "error": error_msg,
                    }

            # Emit event to all clients that observations have changed
            await emit_scheduled_observations_changed()

        return {
            "success": result["success"],
            "data": result.get("data"),
            "error": result.get("error"),
        }


async def delete_scheduled_observations(
    sio: Any, data: Optional[List], logger: Any, sid: str
) -> Dict[str, Union[bool, Dict, str, None]]:
    """
    Delete one or more scheduled observations.

    Args:
        sio: Socket.IO server instance
        data: List of observation IDs to delete
        logger: Logger instance
        sid: Socket.IO session ID

    Returns:
        Dictionary with success status
    """
    if not data or not isinstance(data, list):
        logger.error("Invalid data - list of IDs required")
        return {"success": False, "error": "List of IDs required"}

    # First, check if any observations are running and cancel them
    if obs_events.observation_sync:
        async with AsyncSessionLocal() as dbsession:
            # Fetch observations to check their status
            fetch_result = await crud_observations.fetch_scheduled_observations(dbsession)
            if fetch_result["success"]:
                observations = fetch_result.get("data", [])
                running_observations = [
                    obs
                    for obs in observations
                    if obs["id"] in data and obs.get("status") == "running"
                ]

                # Cancel running observations first
                if running_observations:
                    logger.info(
                        f"Cancelling {len(running_observations)} running observation(s) before deletion"
                    )
                    for obs in running_observations:
                        obs_id = obs["id"]
                        if obs_events.observation_sync.executor:
                            cancel_result = (
                                await obs_events.observation_sync.executor.cancel_observation(
                                    obs_id
                                )
                            )
                            if not cancel_result.get("success", False):
                                logger.warning(
                                    f"Failed to cancel observation {obs_id}: {cancel_result.get('error', 'Unknown error')}"
                                )

    async with AsyncSessionLocal() as dbsession:
        result = await crud_observations.delete_scheduled_observations(dbsession, data)

        # Remove from APScheduler if successful
        if result["success"]:
            if obs_events.observation_sync:
                for observation_id in data:
                    await obs_events.observation_sync.remove_observation(observation_id)

            # Emit event to all clients that observations have changed
            await emit_scheduled_observations_changed()

        return {
            "success": result["success"],
            "data": result.get("data"),
            "error": result.get("error"),
        }


async def toggle_observation_enabled(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Union[bool, Dict, str, None]]:
    """
    Enable or disable a scheduled observation.

    Args:
        sio: Socket.IO server instance
        data: Dictionary with 'id' and 'enabled' keys
        logger: Logger instance
        sid: Socket.IO session ID

    Returns:
        Dictionary with success status
    """
    if not data:
        logger.error("No data provided")
        return {"success": False, "error": "No data provided"}

    observation_id = data.get("id")
    enabled = data.get("enabled")

    if not observation_id or enabled is None:
        logger.error("Missing id or enabled field")
        return {"success": False, "error": "ID and enabled status required"}

    async with AsyncSessionLocal() as dbsession:
        # Directly update only the enabled field
        result = await crud_observations.toggle_scheduled_observation_enabled(
            dbsession, observation_id, enabled
        )

        # Sync to APScheduler if successful
        if result["success"]:
            if obs_events.observation_sync:
                await obs_events.observation_sync.sync_observation(observation_id)

            # Emit event to all clients that observations have changed
            await emit_scheduled_observations_changed()

            return {"success": True, "data": {"id": observation_id, "enabled": enabled}}
        return {"success": result["success"], "error": result.get("error")}


async def cancel_observation(
    sio: Any, data: Optional[str], logger: Any, sid: str
) -> Dict[str, Union[bool, Dict, str, None]]:
    """
    Cancel a running observation.

    Args:
        sio: Socket.IO server instance
        data: Observation ID
        logger: Logger instance
        sid: Socket.IO session ID

    Returns:
        Dictionary with success status
    """
    if not data:
        logger.error("No observation ID provided")
        return {"success": False, "error": "Observation ID required"}

    observation_id = data

    # Cancel via executor (handles running observations properly)
    if obs_events.observation_sync and obs_events.observation_sync.executor:
        cancel_result = await obs_events.observation_sync.executor.cancel_observation(
            observation_id
        )
        if not cancel_result.get("success", False):
            return {
                "success": bool(cancel_result.get("success", False)),
                "data": cancel_result.get("data", {}),
                "error": str(cancel_result.get("error", "")),
            }

    # Remove from APScheduler
    if obs_events.observation_sync:
        await obs_events.observation_sync.remove_observation(observation_id)

    return {"success": True, "data": {"id": observation_id}}


# ============================================================================
# MONITORED SATELLITES
# ============================================================================


async def get_monitored_satellites(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Union[bool, List, str, None]]:
    """
    Get all monitored satellites.

    Args:
        sio: Socket.IO server instance
        data: Not used
        logger: Logger instance
        sid: Socket.IO session ID

    Returns:
        Dictionary with success status and monitored satellites list
    """
    async with AsyncSessionLocal() as dbsession:
        result = await crud_satellites.fetch_monitored_satellites(dbsession)
        return {"success": result["success"], "data": result.get("data", [])}


async def create_monitored_satellite(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Union[bool, Dict, str, None]]:
    """
    Create a new monitored satellite.

    Args:
        sio: Socket.IO server instance
        data: Monitored satellite data
        logger: Logger instance
        sid: Socket.IO session ID

    Returns:
        Dictionary with success status and created monitored satellite
    """
    if not data:
        logger.error("No data provided")
        return {"success": False, "error": "No data provided"}

    satellite_id = data.get("id")
    if not satellite_id:
        logger.error("No ID provided in monitored satellite data")
        return {"success": False, "error": "Satellite ID is required"}

    # Validate transmitter frequencies against SDR configuration
    validation_result = validate_transmitter_frequencies(data)
    if not validation_result["success"]:
        logger.error(f"Frequency validation failed: {validation_result['error']}")
        return {"success": False, "error": validation_result["error"]}

    async with AsyncSessionLocal() as dbsession:
        result = await crud_satellites.add_monitored_satellite(dbsession, data)
        return {
            "success": result["success"],
            "data": result.get("data"),
            "error": result.get("error"),
        }


async def update_monitored_satellite(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Union[bool, Dict, str, None]]:
    """
    Update an existing monitored satellite.

    Args:
        sio: Socket.IO server instance
        data: Monitored satellite data with ID
        logger: Logger instance
        sid: Socket.IO session ID

    Returns:
        Dictionary with success status and updated monitored satellite
    """
    if not data:
        logger.error("No data provided")
        return {"success": False, "error": "No data provided"}

    satellite_id = data.get("id")
    if not satellite_id:
        logger.error("No ID provided in monitored satellite data")
        return {"success": False, "error": "Satellite ID is required"}

    # Validate transmitter frequencies against SDR configuration
    validation_result = validate_transmitter_frequencies(data)
    if not validation_result["success"]:
        logger.error(f"Frequency validation failed: {validation_result['error']}")
        return {"success": False, "error": validation_result["error"]}

    async with AsyncSessionLocal() as dbsession:
        result = await crud_satellites.edit_monitored_satellite(dbsession, data)
        return {
            "success": result["success"],
            "data": result.get("data"),
            "error": result.get("error"),
        }


async def delete_monitored_satellites(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Union[bool, Dict, str, None]]:
    """
    Delete one or more monitored satellites.

    Args:
        sio: Socket.IO server instance
        data: Dictionary with 'ids' (list) and 'deleteObservations' (bool) keys
        logger: Logger instance
        sid: Socket.IO session ID

    Returns:
        Dictionary with success status
    """
    if not data or not isinstance(data, dict):
        logger.error("Invalid data - dictionary with 'ids' and 'deleteObservations' required")
        return {
            "success": False,
            "error": "Dictionary with 'ids' and 'deleteObservations' required",
        }

    ids = data.get("ids", [])
    delete_observations = data.get("deleteObservations", False)

    if not ids or not isinstance(ids, list):
        logger.error("Invalid ids - list of IDs required")
        return {"success": False, "error": "List of IDs required"}

    async with AsyncSessionLocal() as dbsession:
        result = await crud_satellites.delete_monitored_satellites(
            dbsession, ids, delete_observations=delete_observations
        )

        # If observations were deleted, emit event to refresh UI
        if result["success"] and delete_observations:
            deleted_obs_count = result.get("data", {}).get("deleted_observations", 0)
            if deleted_obs_count > 0:
                logger.info(
                    f"Deleted {deleted_obs_count} observations, emitting update event to clients"
                )
                await emit_scheduled_observations_changed()

        return {
            "success": result["success"],
            "data": result.get("data"),
            "error": result.get("error"),
        }


async def toggle_monitored_satellite_enabled(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Union[bool, Dict, str, None]]:
    """
    Enable or disable a monitored satellite.

    Args:
        sio: Socket.IO server instance
        data: Dictionary with 'id' and 'enabled' keys
        logger: Logger instance
        sid: Socket.IO session ID

    Returns:
        Dictionary with success status
    """
    if not data:
        logger.error("No data provided")
        return {"success": False, "error": "No data provided"}

    satellite_id = data.get("id")
    enabled = data.get("enabled")

    if not satellite_id or enabled is None:
        logger.error("Missing id or enabled field")
        return {"success": False, "error": "ID and enabled status required"}

    async with AsyncSessionLocal() as dbsession:
        # Directly update only the enabled field
        result = await crud_satellites.toggle_monitored_satellite_enabled(
            dbsession, satellite_id, enabled
        )
        if result["success"]:
            return {"success": True, "data": {"id": satellite_id, "enabled": enabled}}
        return {"success": result["success"], "error": result.get("error")}


# ============================================================================
# OBSERVATION GENERATION
# ============================================================================


async def regenerate_observations(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Union[bool, Dict[str, int], str, None]]:
    """
    Regenerate scheduled observations for monitored satellites.

    Args:
        sio: Socket.IO server instance
        data: Optional dict with:
            - monitored_satellite_id: ID to regenerate for specific satellite
            - dry_run: If True, only preview conflicts without executing
            - user_conflict_overrides: Dict mapping conflict IDs to actions
        logger: Logger instance
        sid: Socket.IO session ID

    Returns:
        Dictionary with success status and generation statistics
        In dry_run mode, includes conflicts and no_conflicts arrays
    """
    monitored_satellite_id = data.get("monitored_satellite_id") if data else None
    dry_run = data.get("dry_run", False) if data else False
    user_conflict_overrides = data.get("user_conflict_overrides", {}) if data else {}

    mode = "DRY-RUN preview" if dry_run else "regeneration"
    logger.info(
        f"Starting observation {mode} for {'all satellites' if not monitored_satellite_id else f'satellite {monitored_satellite_id}'}"
    )

    async with AsyncSessionLocal() as dbsession:
        result = await generate_observations_for_monitored_satellites(
            dbsession, monitored_satellite_id, dry_run, user_conflict_overrides
        )

        if result["success"] and not dry_run:
            # Emit event to all clients that observations have changed (skip in dry-run)
            await emit_scheduled_observations_changed()

            stats = result.get("data", {})
            logger.info(
                f"Observation generation complete: "
                f"{stats.get('generated', 0)} created, "
                f"{stats.get('updated', 0)} updated, "
                f"{stats.get('skipped', 0)} skipped, "
                f"{stats.get('satellites_processed', 0)} satellites processed"
            )

            # Sync all observations to APScheduler
            if obs_events.observation_sync:
                sync_result = await obs_events.observation_sync.sync_all_observations()
                if sync_result["success"]:
                    sync_stats = sync_result.get("stats", {})
                    logger.info(
                        f"APScheduler sync complete: {sync_stats.get('scheduled', 0)} scheduled"
                    )
        elif result["success"] and dry_run:
            conflicting_passes = result.get("conflicting_passes", result.get("conflicts", []))
            no_conflict_passes = result.get("no_conflict_passes", result.get("no_conflicts", []))
            logger.info(
                f"Dry-run complete: {len(conflicting_passes)} conflicting passes detected, "
                f"{len(no_conflict_passes)} passes without conflicts"
            )

        return {
            "success": bool(result.get("success", False)),
            "data": result.get("data", {}),
            "dry_run": result.get("dry_run", False),
            "current_strategy": result.get("current_strategy", ""),
            "conflicting_passes": result.get("conflicting_passes", result.get("conflicts", [])),
            "no_conflict_passes": result.get("no_conflict_passes", result.get("no_conflicts", [])),
            # Backward-compatible aliases for older clients.
            "conflicts": result.get("conflicting_passes", result.get("conflicts", [])),
            "no_conflicts": result.get("no_conflict_passes", result.get("no_conflicts", [])),
            "error": str(result.get("error", "")),
        }


def register_handlers(registry):
    """Register scheduler handlers with the command registry."""
    registry.register_batch(
        {
            # Scheduled observations
            "get-scheduled-observations": (get_scheduled_observations, "api_call"),
            "create-scheduled-observation": (create_scheduled_observation, "api_call"),
            "update-scheduled-observation": (update_scheduled_observation, "api_call"),
            "delete-scheduled-observations": (delete_scheduled_observations, "api_call"),
            "toggle-observation-enabled": (toggle_observation_enabled, "api_call"),
            "cancel-observation": (cancel_observation, "api_call"),
            # Monitored satellites
            "get-monitored-satellites": (get_monitored_satellites, "api_call"),
            "create-monitored-satellite": (create_monitored_satellite, "api_call"),
            "update-monitored-satellite": (update_monitored_satellite, "api_call"),
            "delete-monitored-satellites": (delete_monitored_satellites, "api_call"),
            "toggle-monitored-satellite-enabled": (
                toggle_monitored_satellite_enabled,
                "api_call",
            ),
            # Observation generation
            "regenerate-observations": (regenerate_observations, "api_call"),
        }
    )
