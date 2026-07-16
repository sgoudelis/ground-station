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

import asyncio
import json
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Any, Dict, List

import requests
from sqlalchemy import select

from common.arguments import arguments
from common.common import *  # noqa: F401,F403
from common.exceptions import SynchronizationErrorMainTLESource
from crud.orbitalsources import fetch_orbital_source
from db.models import Satellites
from handlers.entities.transmitterimport import (
    import_gr_satellites_transmitters,
    import_satdump_transmitters,
)
from tlesync.source_adapters import (
    async_fetch_source_orbit_records,
    build_space_track_norad_source_batches,
)
from tlesync.state import SatelliteSyncState
from tlesync.utils import (
    async_fetch,
    create_final_success_message,
    create_initial_sync_state,
    create_progress_tracker,
    create_satellite_from_tle_data,
    create_satellite_orbit_from_source_data,
    create_transmitter_from_satnogs_data,
    detect_duplicate_satellites,
    detect_satellite_modifications,
    detect_transmitter_modifications,
    get_satellite_by_norad_id,
    get_transmitter_info_by_norad_id,
    normalize_external_transmitter_id,
    query_existing_data,
    resolve_sync_source_urls,
    update_satellite_group_with_removal_detection,
    update_satellite_with_satnogs_data,
)
from tracker.runner import get_all_tracker_managers

DEFAULT_SATELLITE_METADATA_URL = "http://db.satnogs.org/api/satellites/?format=json"
DEFAULT_TRANSMITTER_METADATA_URL = "http://db.satnogs.org/api/transmitters/?format=json"

# Global state to track satellite synchronization progress
sync_state = create_initial_sync_state()

# Lock to prevent concurrent synchronization within the same process
# Note: This lock only works within a single process. For cross-process concurrency control,
# the BackgroundTaskManager enforces singleton task execution (only one orbital sync at a time).
_sync_lock = asyncio.Lock()


async def synchronize_satellite_data_internal(dbsession, logger, emit_callback):
    """
    Core orbital synchronization logic with pluggable callback for progress updates.

    Args:
        dbsession: Database session
        logger: Logger instance
        emit_callback: Async or sync callable that receives state dict updates.
                      Can be async (await emit_callback(state)) or sync (emit_callback(state))

    This internal function allows the same sync logic to be used in different contexts:
    - Direct Socket.IO emission (legacy)
    - Background task with queue-based messaging (new)
    - Testing with mock callbacks
    """
    global sync_state

    # Helper to call callback regardless of whether it's async or sync
    async def _emit(state):
        if asyncio.iscoroutinefunction(emit_callback):
            await emit_callback(state)
        else:
            emit_callback(state)

    async def _notify_tracker_manager(
        satellite_norad_ids: set[int],
        transmitter_norad_ids: set[int],
        transmitters_by_norad: Dict[int, List[Dict[str, Any]]],
    ) -> None:
        if not satellite_norad_ids and not transmitter_norad_ids:
            return
        try:
            for tracker_id, manager in get_all_tracker_managers().items():
                if satellite_norad_ids:
                    for norad_id in satellite_norad_ids:
                        try:
                            await manager.notify_tle_updated(norad_id)
                        except Exception as e:
                            logger.error(
                                "Notify tracker manager TLE failed "
                                "(tracker_id=%s norad_id=%s, error=%s)",
                                tracker_id,
                                norad_id,
                                e,
                            )
                if transmitter_norad_ids:
                    for norad_id in transmitter_norad_ids:
                        try:
                            manager.notify_transmitters_changed_with_items(
                                norad_id, transmitters_by_norad.get(norad_id, [])
                            )
                        except Exception as e:
                            logger.error(
                                "Notify tracker manager transmitters failed "
                                "(tracker_id=%s norad_id=%s, error=%s)",
                                tracker_id,
                                norad_id,
                                e,
                            )
        except Exception as e:
            logger.debug(f"Failed to notify tracker manager of TLE updates: {e}")

    # Try to acquire the lock without blocking
    if _sync_lock.locked():
        logger.warning("Satellite data synchronization already in progress, skipping this run")
        return

    async with _sync_lock:
        logger.info("Starting satellite data synchronization (lock acquired)")

        # Create an instance of our state manager
        sync_state_manager = SatelliteSyncState()

        # Reset the state at the beginning of synchronization
        sync_state = create_initial_sync_state()

        # Update the sync state in the manager
        sync_state_manager.set_state(sync_state)
        await _emit(sync_state)

        # Define progress weights for each phase
        progress_phases = {
            "fetch_orbital_sources": 15,  # Fetching orbital data from sources
            "fetch_satnogs_satellites": 10,  # Fetching satellite metadata from configured API(s)
            "fetch_satnogs_transmitters": 10,  # Fetching transmitter metadata from configured API(s)
            "process_satellites": 40,  # Processing satellite data
            "process_transmitters": 25,  # Processing transmitter data
        }

        # Create progress tracker
        update_progress, completed_phases, highest_progress = create_progress_tracker(
            progress_phases, sync_state, sync_state_manager
        )

        satellite_metadata_urls = resolve_sync_source_urls(
            getattr(arguments, "orbital_sync_satellite_metadata_urls", None)
            or getattr(arguments, "tle_sync_satellite_metadata_urls", None),
            DEFAULT_SATELLITE_METADATA_URL,
        )
        transmitter_metadata_urls = resolve_sync_source_urls(
            getattr(arguments, "orbital_sync_transmitter_urls", None)
            or getattr(arguments, "tle_sync_transmitter_urls", None),
            DEFAULT_TRANSMITTER_METADATA_URL,
        )
        satnogs_satellite_data: List[Dict[str, Any]] = []
        satnogs_transmitter_data: List[Dict[str, Any]] = []
        celestrak_list: List[Dict[str, Any]] = []
        group_assignments: Dict[str, List[int]] = {}

        orbital_sources_reply = await fetch_orbital_source(dbsession)
        all_sources = orbital_sources_reply.get("data", [])
        sources = [source for source in all_sources if source.get("enabled", True)]
        sources.sort(
            key=lambda source: (int(source.get("priority") or 100), source.get("name", ""))
        )
        if not sources:
            if all_sources:
                message = (
                    f"No enabled orbit sources configured "
                    f"({len(all_sources)} total source(s), 0 enabled)"
                )
            else:
                message = "No orbit sources configured"
            logger.error("%s, aborting!", message)
            sync_state["status"] = "complete"
            sync_state["progress"] = 100
            sync_state["success"] = False
            sync_state["message"] = message
            sync_state["errors"].append(message)
            sync_state["last_update"] = datetime.now(timezone.utc).isoformat()
            sync_state_manager.set_state(sync_state)
            await _emit(sync_state)
            return

        # Use a single ThreadPoolExecutor for all async_fetch calls
        with ThreadPoolExecutor(max_workers=1) as pool:
            # Fetch ephemeris from configured orbit sources.
            for i, tle_source in enumerate(sources):
                tle_source_name = tle_source["name"]
                tle_source_identifier = tle_source["identifier"]
                tle_source_url = tle_source["url"]
                group_assignments[tle_source_identifier] = []

                # Update active sources in state and progress
                progress_state = update_progress(
                    "fetch_orbital_sources", i, len(sources), f"Fetching {tle_source_url}"
                )
                sync_state["active_sources"] = [tle_source_name]
                await _emit(progress_state)

                try:
                    logger.info(f"Fetching {tle_source_url}")
                    source_provider = str(tle_source.get("provider") or "").strip().lower()
                    source_adapter = str(tle_source.get("adapter") or "").strip().lower()
                    if source_provider == "space_track" and source_adapter == "space_track_gp":
                        source_batches = build_space_track_norad_source_batches(tle_source)
                        satellite_data = []
                        for source_batch in source_batches:
                            satellite_data.extend(
                                await async_fetch_source_orbit_records(source_batch, pool)
                            )
                    else:
                        satellite_data = await async_fetch_source_orbit_records(tle_source, pool)

                    group_assignments[tle_source_identifier] = [
                        sat["norad_id"] for sat in satellite_data
                    ]

                    celestrak_list = celestrak_list + satellite_data
                    logger.info(f"Fetched {len(satellite_data)} orbits from {tle_source_url}")

                except SynchronizationErrorMainTLESource as e:
                    error_msg = f'Failed to fetch data from {tle_source["url"]}: {e.message}'
                    logger.error(error_msg)

                    # Update error in state
                    sync_state["errors"].append(error_msg)
                    sync_state["success"] = False
                    sync_state["message"] = e.message
                    sync_state["last_update"] = datetime.now(timezone.utc).isoformat() + "Z"
                    sync_state_manager.set_state(sync_state)

                    await _emit(sync_state)
                    continue

                except requests.exceptions.RequestException as e:
                    error_msg = f'Failed to fetch data from {tle_source["url"]}: {e}'
                    logger.error(error_msg)

                    # Update error in state
                    sync_state["errors"].append(error_msg)
                    sync_state["success"] = False
                    sync_state["message"] = str(e)
                    sync_state["last_update"] = datetime.now(timezone.utc).isoformat() + "Z"
                    sync_state_manager.set_state(sync_state)

                    await _emit(sync_state)
                    continue
                except Exception as e:
                    error_msg = f'Failed to parse orbit data from {tle_source["url"]}: {e}'
                    logger.error(error_msg)

                    sync_state["errors"].append(error_msg)
                    sync_state["success"] = False
                    sync_state["message"] = str(e)
                    sync_state["last_update"] = datetime.now(timezone.utc).isoformat() + "Z"
                    sync_state_manager.set_state(sync_state)

                    await _emit(sync_state)
                    continue

                # Update progress, completed sources, and emit event
                progress_state = update_progress(
                    "fetch_orbital_sources", i + 1, len(sources), f"Fetched {tle_source_url}"
                )
                await _emit(progress_state)

                logger.info(
                    f"Group {tle_source_identifier} has {len(group_assignments[tle_source_identifier])} members"
                )

                # Use the new removal detection function instead of the old group management code
                try:
                    removed_data = await update_satellite_group_with_removal_detection(
                        session=dbsession,
                        tle_source_identifier=tle_source_identifier,
                        satellite_ids=group_assignments[tle_source_identifier],
                        group_name=tle_source_name,
                        logger=logger,
                    )

                    if removed_data["satellites"] or removed_data["transmitters"]:
                        # Add removed items to the global sync state
                        sync_state["removed"]["satellites"].extend(removed_data["satellites"])
                        sync_state["removed"]["transmitters"].extend(removed_data["transmitters"])

                        removed_sats_count = len(removed_data["satellites"])
                        removed_trx_count = len(removed_data["transmitters"])
                        logger.info(
                            f"Removed {removed_sats_count} satellites and {removed_trx_count} transmitters from orbital source '{tle_source_identifier}'"
                        )

                    # Commit the changes
                    await dbsession.commit()

                except Exception as e:
                    logger.error(
                        f"Error during satellite removal detection for orbital source '{tle_source_identifier}': {e}"
                    )
                    await dbsession.rollback()

                # Update completed sources and groups processed in state
                sync_state["completed_sources"].append(tle_source_name)
                sync_state["active_sources"] = []
                sync_state["stats"]["groups_processed"] += 1
                sync_state["last_update"] = datetime.now(timezone.utc).isoformat()
                sync_state_manager.set_state(sync_state)

                # Update message for group creation/update
                progress_state = update_progress(
                    "fetch_orbital_sources",
                    i + 1,
                    len(sources),
                    f'Group {tle_source.get("name", None)} created/updated',
                )
                await _emit(progress_state)

            # Mark orbital sources phase as complete
            completed_phases.add("fetch_orbital_sources")

            if not celestrak_list:
                logger.error("No orbit data was fetched from any orbit source, aborting!")
                # Update state for error
                sync_state["status"] = "complete"
                sync_state["progress"] = 100
                sync_state["success"] = False
                sync_state["message"] = "No orbit data was fetched from any orbit source"
                sync_state["errors"].append("No orbit data was fetched from any orbit source")
                sync_state["last_update"] = datetime.now(timezone.utc).isoformat()
                sync_state_manager.set_state(sync_state)

                await _emit(sync_state)
                return

            # Detect and handle duplicate satellites
            logger.info("Detecting duplicate satellites across orbital sources...")
            duplicate_detection_result = detect_duplicate_satellites(celestrak_list, logger)

            # Log duplicate information
            if duplicate_detection_result["duplicate_count"] > 0:
                logger.warning(
                    f"Found {duplicate_detection_result['duplicate_count']} satellites "
                    f"with {duplicate_detection_result['total_duplicates']} duplicate entries"
                )

                # Note: Some satellites may legitimately appear multiple times in Celestrak data
                # (e.g., MTG-S1 appears twice). This is normal and handled by deduplication.

            # Use deduplicated list for processing
            celestrak_list = duplicate_detection_result["deduplicated_list"]
            logger.info(f"Proceeding with {len(celestrak_list)} unique satellites")

            # Fetch supplemental satellite metadata using configured sources.
            progress_state = update_progress(
                "fetch_satnogs_satellites",
                0,
                len(satellite_metadata_urls),
                "Fetching satellite metadata",
            )
            sync_state["active_sources"] = ["Satellite Metadata"]
            sync_state_manager.set_state(sync_state)
            await _emit(progress_state)

            # Try sources in order until one responds with valid JSON.
            satellite_metadata_fetched = False
            for i, satellite_metadata_url in enumerate(satellite_metadata_urls):
                progress_state = update_progress(
                    "fetch_satnogs_satellites",
                    i,
                    len(satellite_metadata_urls),
                    f"Fetching satellite metadata from {satellite_metadata_url}",
                )
                sync_state["active_sources"] = [f"Satellite Metadata: {satellite_metadata_url}"]
                sync_state_manager.set_state(sync_state)
                await _emit(progress_state)

                logger.info("Fetching satellite metadata (%s)", satellite_metadata_url)
                try:
                    response = await async_fetch(satellite_metadata_url, pool)
                    if response.status_code != 200:
                        raise requests.exceptions.RequestException(
                            f"Unable to fetch data from {satellite_metadata_url}, "
                            f"error code was {response.status_code}"
                        )

                    satnogs_satellite_data = json.loads(response.text)
                    logger.info(
                        "Fetched %s satellites from metadata source %s",
                        len(satnogs_satellite_data),
                        satellite_metadata_url,
                    )
                    sync_state["completed_sources"].append(
                        f"Satellite Metadata ({satellite_metadata_url})"
                    )
                    sync_state["active_sources"] = []
                    completed_phases.add("fetch_satnogs_satellites")
                    progress_state = update_progress(
                        "fetch_satnogs_satellites",
                        len(satellite_metadata_urls),
                        len(satellite_metadata_urls),
                        f"Satellite metadata fetched from {satellite_metadata_url}",
                    )
                    await _emit(progress_state)
                    satellite_metadata_fetched = True
                    break
                except (requests.exceptions.RequestException, json.JSONDecodeError) as e:
                    error_msg = f"Failed to fetch data from {satellite_metadata_url} ({e})"
                    logger.error(error_msg)
                    sync_state["errors"].append(error_msg)
                    sync_state["last_update"] = datetime.now(timezone.utc).isoformat()
                    sync_state_manager.set_state(sync_state)

            if not satellite_metadata_fetched:
                sync_state["active_sources"] = []
                sync_state_manager.set_state(sync_state)

            # Fetch supplemental transmitter metadata using configured sources.
            progress_state = update_progress(
                "fetch_satnogs_transmitters",
                0,
                len(transmitter_metadata_urls),
                "Fetching transmitter metadata",
            )
            sync_state["active_sources"] = ["Transmitter Metadata"]
            sync_state_manager.set_state(sync_state)
            await _emit(progress_state)

            transmitter_metadata_fetched = False
            for i, transmitter_metadata_url in enumerate(transmitter_metadata_urls):
                progress_state = update_progress(
                    "fetch_satnogs_transmitters",
                    i,
                    len(transmitter_metadata_urls),
                    f"Fetching transmitter metadata from {transmitter_metadata_url}",
                )
                sync_state["active_sources"] = [f"Transmitter Metadata: {transmitter_metadata_url}"]
                sync_state_manager.set_state(sync_state)
                await _emit(progress_state)

                logger.info("Fetching transmitter metadata (%s)", transmitter_metadata_url)
                try:
                    response = await async_fetch(transmitter_metadata_url, pool)
                    if response.status_code != 200:
                        raise requests.exceptions.RequestException(
                            f"Unable to fetch data from {transmitter_metadata_url}, "
                            f"error code was {response.status_code}"
                        )

                    satnogs_transmitter_data = json.loads(response.text)
                    logger.info(
                        "Fetched %s transmitters from metadata source %s",
                        len(satnogs_transmitter_data),
                        transmitter_metadata_url,
                    )
                    sync_state["completed_sources"].append(
                        f"Transmitter Metadata ({transmitter_metadata_url})"
                    )
                    sync_state["active_sources"] = []
                    completed_phases.add("fetch_satnogs_transmitters")
                    progress_state = update_progress(
                        "fetch_satnogs_transmitters",
                        len(transmitter_metadata_urls),
                        len(transmitter_metadata_urls),
                        f"Transmitter metadata fetched from {transmitter_metadata_url}",
                    )
                    await _emit(progress_state)
                    transmitter_metadata_fetched = True
                    break
                except (requests.exceptions.RequestException, json.JSONDecodeError) as e:
                    error_msg = f"Failed to fetch data from {transmitter_metadata_url}: {e}"
                    logger.error(error_msg)
                    sync_state["errors"].append(error_msg)
                    sync_state["last_update"] = datetime.now(timezone.utc).isoformat()
                    sync_state_manager.set_state(sync_state)

            if not transmitter_metadata_fetched:
                sync_state["active_sources"] = []
                sync_state_manager.set_state(sync_state)

        # Begin processing satellites and transmitters
        progress_state = update_progress(
            "process_satellites",
            0,
            len(celestrak_list),
            "Updating satellite data in the database...",
        )
        sync_state["active_sources"] = ["Database Update"]
        sync_state_manager.set_state(sync_state)
        await _emit(progress_state)

        # Get existing satellite and transmitter data
        existing_data = await query_existing_data(dbsession, logger)

        # We now have TLE data plus optional satellite/transmitter metadata from API sources.
        # Merge everything into the local database.
        count_sats = 0
        count_transmitters = 0
        try:
            total_satellites = len(celestrak_list)
            celestrak_norad_ids = {sat["norad_id"] for sat in celestrak_list}

            # Fetch manually-added satellites once; we'll enrich them with metadata transmitters
            # after normal TLE processing (for NORAD IDs not already covered by Celestrak data).
            manual_satellites_result = await dbsession.execute(
                select(Satellites).filter(Satellites.source == "manual")
            )
            manual_satellites = manual_satellites_result.scalars().all()
            manual_satellites_by_norad = {sat.norad_id: sat for sat in manual_satellites}
            manual_only_norad_ids = [
                norad_id
                for norad_id in manual_satellites_by_norad.keys()
                if norad_id not in celestrak_norad_ids
            ]

            # Pre-calculate total transmitters to ensure progress is accurate
            logger.info("Calculating expected transmitter count for progress tracking...")
            total_transmitters_to_process = 0
            for sat in celestrak_list:
                norad_id = sat["norad_id"]
                transmitters = get_transmitter_info_by_norad_id(norad_id, satnogs_transmitter_data)
                total_transmitters_to_process += len(transmitters)

            # Add expected transmitters for manually-added satellites that are outside
            # the currently synchronized Celestrak set.
            for norad_id in manual_only_norad_ids:
                transmitters = get_transmitter_info_by_norad_id(norad_id, satnogs_transmitter_data)
                total_transmitters_to_process += len(transmitters)

            logger.info(
                f"Expected to process {total_transmitters_to_process} transmitters in total"
            )
            if manual_only_norad_ids:
                logger.info(
                    "Found %s manual-only satellites to enrich with transmitter metadata",
                    len(manual_only_norad_ids),
                )

            processed_transmitter_uuids = set(existing_data["transmitter_uuids"])

            # Now process satellites
            for i, sat in enumerate(celestrak_list):
                norad_id = sat["norad_id"]

                # Check if this is a new satellite
                is_new_satellite = norad_id not in existing_data["satellite_norad_ids"]

                # Create satellite object
                satellite = create_satellite_from_tle_data(sat, norad_id)
                count_sats += 1

                # Update progress based on satellites processed
                progress_state = update_progress(
                    "process_satellites",
                    i + 1,
                    total_satellites,
                    f'Processing satellite {count_sats}/{total_satellites}: {sat["name"]}',
                )
                sync_state["stats"]["satellites_processed"] = count_sats
                sync_state_manager.set_state(sync_state)

                # Every 100 satellites, emit an update to avoid flooding
                if count_sats % 100 == 0 or count_sats == total_satellites:
                    await _emit(progress_state)

                # let's find the sat info from the satnogs list
                satnogs_sat_info = get_satellite_by_norad_id(norad_id, satnogs_satellite_data)

                # Update satellite with SATNOGS data and get comparison data
                satellite_data_for_comparison = update_satellite_with_satnogs_data(
                    satellite, satnogs_sat_info
                )

                # Check if satellite was modified (not new but has changes)
                if not is_new_satellite:
                    detect_satellite_modifications(
                        norad_id,
                        satellite_data_for_comparison,
                        existing_data["satellites"],
                        sync_state,
                        logger,
                    )

                # add to dbsession
                await dbsession.merge(satellite)
                orbit = create_satellite_orbit_from_source_data(sat, norad_id)
                await dbsession.merge(orbit)

                # commit session
                await dbsession.commit()

                # If this is a new satellite, add it to the newly added list
                if is_new_satellite:
                    sync_state["newly_added"]["satellites"].append(
                        {"norad_id": norad_id, "name": satellite.name, "sat_id": satellite.sat_id}
                    )

                # let's find transmitter info in the satnogs_transmitter_data list
                satnogs_transmitter_info = get_transmitter_info_by_norad_id(
                    norad_id, satnogs_transmitter_data
                )

                for j, transmitter_info in enumerate(satnogs_transmitter_info):
                    transmitter_uuid = normalize_external_transmitter_id(
                        transmitter_info.get("uuid", None)
                    )

                    # Check if this is a new transmitter
                    is_new_transmitter = transmitter_uuid not in processed_transmitter_uuids

                    # Create transmitter object and get comparison data
                    transmitter, transmitter_data_for_comparison = (
                        create_transmitter_from_satnogs_data(transmitter_info)
                    )
                    count_transmitters += 1

                    # Update progress for transmitters only if we have some to process
                    if total_transmitters_to_process > 0:
                        progress_state = update_progress(
                            "process_transmitters",
                            count_transmitters,
                            total_transmitters_to_process,
                            f"Processing transmitter {count_transmitters}/{total_transmitters_to_process}",
                        )
                        sync_state["stats"]["transmitters_processed"] = count_transmitters
                        sync_state_manager.set_state(sync_state)

                        # Every 20 transmitters, emit an update to avoid flooding
                        if count_transmitters % 20 == 0 or (
                            i == total_satellites - 1 and j == len(satnogs_transmitter_info) - 1
                        ):
                            await _emit(progress_state)

                    # Check if the transmitter was modified (not new but has changes)
                    if not is_new_transmitter:
                        detect_transmitter_modifications(
                            transmitter_uuid,
                            transmitter_data_for_comparison,
                            existing_data["transmitters"],
                            sync_state,
                            satellite.name,
                            norad_id,
                            logger,
                        )

                    await dbsession.merge(transmitter)

                    # commit session
                    await dbsession.commit()
                    processed_transmitter_uuids.add(transmitter_uuid)

                    # If this is a new transmitter, add it to the newly added list
                    if is_new_transmitter:
                        sync_state["newly_added"]["transmitters"].append(
                            {
                                "uuid": transmitter_uuid,
                                "description": transmitter.description,
                                "satellite_name": satellite.name,
                                "norad_id": norad_id,
                                "downlink_low": transmitter.downlink_low,
                                "downlink_high": transmitter.downlink_high,
                                "mode": transmitter.mode,
                            }
                        )

            # Enrich manually-added satellites (that were not part of Celestrak list)
            # with transmitter metadata from memory.
            for norad_id in manual_only_norad_ids:
                manual_satellite = manual_satellites_by_norad.get(norad_id)
                satellite_name = manual_satellite.name if manual_satellite else f"NORAD {norad_id}"
                satnogs_transmitter_info = get_transmitter_info_by_norad_id(
                    norad_id, satnogs_transmitter_data
                )

                for transmitter_info in satnogs_transmitter_info:
                    transmitter_uuid = normalize_external_transmitter_id(
                        transmitter_info.get("uuid", None)
                    )
                    is_new_transmitter = transmitter_uuid not in processed_transmitter_uuids

                    transmitter, transmitter_data_for_comparison = (
                        create_transmitter_from_satnogs_data(transmitter_info)
                    )
                    count_transmitters += 1

                    if total_transmitters_to_process > 0:
                        progress_state = update_progress(
                            "process_transmitters",
                            count_transmitters,
                            total_transmitters_to_process,
                            f"Processing transmitter {count_transmitters}/{total_transmitters_to_process}",
                        )
                        sync_state["stats"]["transmitters_processed"] = count_transmitters
                        sync_state_manager.set_state(sync_state)

                    if not is_new_transmitter:
                        detect_transmitter_modifications(
                            transmitter_uuid,
                            transmitter_data_for_comparison,
                            existing_data["transmitters"],
                            sync_state,
                            satellite_name,
                            norad_id,
                            logger,
                        )

                    await dbsession.merge(transmitter)
                    await dbsession.commit()
                    processed_transmitter_uuids.add(transmitter_uuid)

                    if is_new_transmitter:
                        sync_state["newly_added"]["transmitters"].append(
                            {
                                "uuid": transmitter_uuid,
                                "description": transmitter.description,
                                "satellite_name": satellite_name,
                                "norad_id": norad_id,
                                "downlink_low": transmitter.downlink_low,
                                "downlink_high": transmitter.downlink_high,
                                "mode": transmitter.mode,
                            }
                        )

            # Mark processing phases as complete
            completed_phases.add("process_satellites")
            completed_phases.add("process_transmitters")

            # Log summary of newly added and removed items
            new_satellites_count = len(sync_state["newly_added"]["satellites"])
            new_transmitters_count = len(sync_state["newly_added"]["transmitters"])
            removed_satellites_count = len(sync_state["removed"]["satellites"])
            removed_transmitters_count = len(sync_state["removed"]["transmitters"])
            modified_satellites_count = len(sync_state["modified"]["satellites"])
            modified_transmitters_count = len(sync_state["modified"]["transmitters"])

            logger.info(
                f"Successfully synchronized {count_sats} satellites and {count_transmitters} transmitters"
            )
            logger.info(
                f"New items added: {new_satellites_count} satellites, {new_transmitters_count} transmitters"
            )
            logger.info(
                f"Items removed: {removed_satellites_count} satellites, {removed_transmitters_count} transmitters"
            )
            logger.info(
                f"Items modified: {modified_satellites_count} satellites, {modified_transmitters_count} transmitters"
            )

            # Import gr-satellites and SatDump transmitters using the existing session
            # to avoid SQLite write-lock contention across multiple sessions.
            logger.info("Running gr-satellites transmitter import after orbital sync...")
            gr_result = await import_gr_satellites_transmitters(session=dbsession)
            logger.info("gr-satellites transmitter import result: %s", gr_result)

            logger.info("Running SatDump transmitter import after orbital sync...")
            satdump_result = await import_satdump_transmitters(session=dbsession)
            logger.info("SatDump transmitter import result: %s", satdump_result)

            # Update final state - always set to 100% when complete
            sync_state["status"] = "complete"
            sync_state["progress"] = 100
            sync_state["success"] = True

            # Create a detailed success message
            success_message = create_final_success_message(
                count_sats, count_transmitters, sync_state
            )

            sync_state["message"] = success_message
            sync_state["active_sources"] = []
            sync_state["completed_sources"].append("Database Update")
            sync_state["last_update"] = datetime.now(timezone.utc).isoformat()
            sync_state_manager.set_state(sync_state)

            await _emit(sync_state)

        except Exception as e:
            await dbsession.rollback()  # Rollback in case of error
            logger.error(f"Error while synchronizing satellite data in the db: {e}")
            logger.exception(e)

            # Update state for error
            sync_state["status"] = "complete"
            sync_state["progress"] = 100
            sync_state["success"] = False
            sync_state["message"] = f"Error: {str(e)}"
            sync_state["errors"].append(str(e))
            sync_state["last_update"] = datetime.now(timezone.utc).isoformat()
            sync_state_manager.set_state(sync_state)

            await _emit(sync_state)

        finally:
            # Skip post-sync steps if the sync did not complete successfully.
            if not sync_state.get("success"):
                await dbsession.close()
                return
            satellite_norad_ids = {
                sat.get("norad_id") for sat in sync_state.get("modified", {}).get("satellites", [])
            }
            satellite_norad_ids.update(
                {
                    sat.get("norad_id")
                    for sat in sync_state.get("newly_added", {}).get("satellites", [])
                }
            )
            satellite_norad_ids = {nid for nid in satellite_norad_ids if nid}

            transmitter_norad_ids = {
                tx.get("norad_id") for tx in sync_state.get("modified", {}).get("transmitters", [])
            }
            transmitter_norad_ids.update(
                {
                    tx.get("norad_id")
                    for tx in sync_state.get("newly_added", {}).get("transmitters", [])
                }
            )
            transmitter_norad_ids.update(
                {tx.get("norad_id") for tx in sync_state.get("removed", {}).get("transmitters", [])}
            )
            transmitter_norad_ids = {nid for nid in transmitter_norad_ids if nid}

            transmitters_by_norad: Dict[int, List[Dict[str, Any]]] = {}
            if transmitter_norad_ids:
                for transmitter in satnogs_transmitter_data:
                    norad_id = transmitter.get("norad_cat_id")
                    if norad_id in transmitter_norad_ids:
                        normalized = dict(transmitter)
                        if "id" not in normalized:
                            normalized["id"] = normalized.get("uuid")
                        transmitters_by_norad.setdefault(norad_id, []).append(normalized)

            # Fire-and-forget notifications so cleanup doesn't block on tracker IPC.
            if satellite_norad_ids or transmitter_norad_ids:
                asyncio.create_task(
                    _notify_tracker_manager(
                        satellite_norad_ids, transmitter_norad_ids, transmitters_by_norad
                    )
                )
            # Always close the session when you're done
            await dbsession.close()
