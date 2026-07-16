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
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Set

import requests
from sqlalchemy import delete, select

from db.models import Groups, SatelliteGroupType, SatelliteOrbits, Satellites, Transmitters

TRANSMITTER_ID_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
TRANSMITTER_ID_ALPHABET_SET = set(TRANSMITTER_ID_ALPHABET)
TRANSMITTER_ID_BASE = len(TRANSMITTER_ID_ALPHABET)
TRANSMITTER_ID_LENGTH = 22


def uuid_to_short_transmitter_id(value: uuid.UUID | str) -> str:
    """Encode a UUID as a SatNOGS-style 22-char transmitter id."""
    uid = value if isinstance(value, uuid.UUID) else uuid.UUID(str(value).strip())
    number = uid.int
    encoded = []

    while number:
        number, remainder = divmod(number, TRANSMITTER_ID_BASE)
        encoded.append(TRANSMITTER_ID_ALPHABET[remainder])

    if not encoded:
        encoded.append(TRANSMITTER_ID_ALPHABET[0])

    return "".join(reversed(encoded)).rjust(
        TRANSMITTER_ID_LENGTH,
        TRANSMITTER_ID_ALPHABET[0],
    )


def normalize_external_transmitter_id(value: Any) -> Optional[str]:
    """
    Normalize external transmitter ids to the internal SatNOGS-style id scheme.

    - Keep existing SatNOGS-style ids unchanged.
    - Convert UUID strings to SatNOGS-style ids.
    - Preserve unknown non-empty formats as-is for compatibility.
    """
    if value is None:
        return None

    text = str(value).strip()
    if not text:
        return None

    if len(text) == TRANSMITTER_ID_LENGTH and set(text).issubset(TRANSMITTER_ID_ALPHABET_SET):
        return text

    try:
        return uuid_to_short_transmitter_id(text)
    except (ValueError, TypeError, AttributeError):
        return text


def create_initial_sync_state():
    """
    Create the initial synchronization state structure.

    Returns:
        dict: Initial sync state dictionary
    """
    return {
        "status": "inprogress",
        "progress": 0,
        "message": "Starting satellite data synchronization",
        "success": None,
        "last_update": datetime.now(timezone.utc).isoformat(),
        "active_sources": [],
        "completed_sources": [],
        "errors": [],
        "stats": {"satellites_processed": 0, "transmitters_processed": 0, "groups_processed": 0},
        "newly_added": {"satellites": [], "transmitters": []},
        "removed": {"satellites": [], "transmitters": []},
        "modified": {"satellites": [], "transmitters": []},
    }


def create_progress_tracker(progress_phases, sync_state, sync_state_manager):
    """
    Create a progress tracking function with monotonic guarantees.

    Args:
        progress_phases (dict): Dictionary of phase names and their weights
        sync_state (dict): The sync state dictionary to update
        sync_state_manager: The state manager instance

    Returns:
        tuple: (update_progress function, completed_phases set, highest_progress counter)
    """
    completed_phases: Set[str] = set()
    highest_progress = [0]  # Use list to make it mutable in closure

    def update_progress(phase, completed, total=1, message=None):
        """Update progress for a specific phase based on completion percentage with monotonic guarantee"""
        if total <= 0:
            phase_percentage = 0
        else:
            phase_percentage = min(1.0, completed / total)

        # Calculate overall progress
        overall_progress = 0
        for p, weight in progress_phases.items():
            if p == phase:
                overall_progress += weight * phase_percentage
            elif p in completed_phases:
                overall_progress += weight

        # Round the calculated progress
        calculated_progress = round(overall_progress)

        # Ensure progress never decreases
        if calculated_progress < highest_progress[0]:
            sync_state["progress"] = highest_progress[0]
        else:
            sync_state["progress"] = calculated_progress
            highest_progress[0] = calculated_progress

        if message:
            sync_state["message"] = message
        sync_state["last_update"] = datetime.now(timezone.utc).isoformat()
        sync_state_manager.set_state(sync_state)
        return sync_state

    return update_progress, completed_phases, highest_progress


def sync_fetch(url: str) -> Optional[requests.Response]:
    """
    Synchronously fetch data from a URL.

    Args:
        url (str): The URL to fetch

    Returns:
        requests.Response or None: The response object
    """
    reply = requests.get(url, timeout=15)
    return reply


async def async_fetch(url: str, executor: ThreadPoolExecutor) -> Optional[requests.Response]:
    """
    Asynchronously fetch data from a URL using a thread pool executor.

    Args:
        url (str): The URL to fetch
        executor (ThreadPoolExecutor): The thread pool executor to use

    Returns:
        requests.Response or None: The response object
    """
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(executor, sync_fetch, url)


def resolve_sync_source_urls(config_value: Any, default_url: str) -> List[str]:
    """
    Normalize configured sync source URLs into a usable list.

    Behavior:
    - If config value is a non-empty string, return [string].
    - If config value is a list/tuple, keep non-empty strings only.
    - If config value is missing, invalid, or resolves to an empty list,
      return [default_url].
    """
    if isinstance(config_value, str):
        cleaned = config_value.strip()
        return [cleaned] if cleaned else [default_url]

    if isinstance(config_value, (list, tuple)):
        normalized = []
        for value in config_value:
            if isinstance(value, str):
                cleaned = value.strip()
                if cleaned:
                    normalized.append(cleaned)
        return normalized if normalized else [default_url]

    return [default_url]


def parse_norad_id_from_line1(line1: str) -> int:
    """
    Parses the NORAD ID from the TLE's first line.
    Assumes the NORAD ID is located at indices 2..6 in the string.

    :param line1: TLE line1 string (e.g. '1 25544U 98067A   23109.65481637 ...').
    :return: The integer NORAD ID extracted from line1.
    """
    norad_str = line1[2:7].strip()
    return int(norad_str)


def get_norad_id_from_tle(tle: str) -> int:
    """
    Extracts the NORAD ID from a TLE (Two-Line Element) string.

    Parameters:
        tle (str): A TLE string that may include a satellite name line or just the two standard TLE lines.

    Returns:
        int: The NORAD ID extracted from the first TLE data line.

    Raises:
        ValueError: If a valid first data line is not found in the input.
    """
    # Split the TLE into individual lines and remove any surrounding whitespace.
    lines = tle.strip().splitlines()

    tle_line = None
    # Loop through the lines to find the first TLE data line
    for line in lines:
        if line.startswith("1 "):
            tle_line = line
            break

    if tle_line is None:
        raise ValueError(
            f"A valid TLE first data line was not found in the provided input (TLE: {tle})"
        )

    # According to the TLE format, NORAD ID is within columns 3 to 7 (1-indexed)
    # For Python (0-indexed), this translates to positions [2:7].
    norad_id_str = tle_line[2:7].strip()

    try:
        return int(norad_id_str)
    except ValueError as e:
        raise ValueError("Failed to convert the extracted NORAD ID to an integer.") from e


def detect_duplicate_satellites(celestrak_list, logger):
    """
    Detect satellites that appear in multiple TLE sources with potentially different names.

    Args:
        celestrak_list: List of satellite TLE data from all sources
        logger: Logger instance for reporting

    Returns:
        dict: Contains duplicate information and deduplicated list
    """
    # Track satellites by NORAD ID
    satellites_by_norad: Dict[int, Dict[str, Any]] = {}
    duplicates_info: Dict[int, Dict[str, Any]] = {}

    for sat in celestrak_list:
        norad_id = _extract_norad_id_from_record(sat)

        if norad_id not in satellites_by_norad:
            # First occurrence of this satellite
            satellites_by_norad[norad_id] = sat
            duplicates_info[norad_id] = {
                "names": [sat["name"]],
                "occurrences": 1,
                "is_duplicate": False,
            }
        else:
            # Duplicate found
            duplicates_info[norad_id]["occurrences"] += 1
            duplicates_info[norad_id]["is_duplicate"] = True

            # Add the name if it's different
            if sat["name"] not in duplicates_info[norad_id]["names"]:
                duplicates_info[norad_id]["names"].append(sat["name"])

            # Keep the satellite entry with the most recent TLE or prefer certain naming conventions
            # For now, we'll keep the first one found, but you could implement preference logic here
            if hasattr(logger, "debug") and callable(logger.debug):
                logger.debug(
                    f"Duplicate satellite detected - NORAD ID: {norad_id}, "
                    f"Names: {duplicates_info[norad_id]['names']}, "
                    f"Occurrences: {duplicates_info[norad_id]['occurrences']}"
                )

    # Create deduplicated list
    deduplicated_list = list(satellites_by_norad.values())

    # Report duplicates
    duplicate_count = sum(1 for info in duplicates_info.values() if info["is_duplicate"])
    total_duplicates = sum(
        info["occurrences"] - 1 for info in duplicates_info.values() if info["is_duplicate"]
    )

    logger.info(
        f"Duplicate detection complete: {duplicate_count} unique satellites have duplicates, "
        f"{total_duplicates} total duplicate entries found"
    )
    logger.info(
        f"Original list: {len(celestrak_list)} satellites, "
        f"Deduplicated list: {len(deduplicated_list)} satellites"
    )

    return {
        "duplicates_info": duplicates_info,
        "deduplicated_list": deduplicated_list,
        "duplicate_count": duplicate_count,
        "total_duplicates": total_duplicates,
    }


async def query_existing_data(dbsession, logger):
    """
    Query existing satellites and transmitters from the database.

    Args:
        dbsession: Database session
        logger: Logger instance

    Returns:
        dict: Contains existing data information
    """
    existing_satellite_norad_ids = set()
    existing_transmitter_uuids = set()
    existing_satellites = {}
    existing_transmitters = {}

    try:
        # Query existing satellites
        satellite_result = await dbsession.execute(select(Satellites))
        for row in satellite_result.scalars().all():
            existing_satellite_norad_ids.add(row.norad_id)
            # Store the current satellite data for comparison
            existing_satellites[row.norad_id] = {
                "name": row.name,
                "sat_id": row.sat_id,
                "status": row.status,
                "tle1": row.tle1,
                "tle2": row.tle2,
                "operator": row.operator,
                "countries": row.countries,
                "is_frequency_violator": row.is_frequency_violator,
            }

        # Query existing transmitters
        transmitter_result = await dbsession.execute(select(Transmitters))
        for row in transmitter_result.scalars().all():
            existing_transmitter_uuids.add(row.id)
            # Store the current transmitter data for comparison
            existing_transmitters[row.id] = {
                "description": row.description,
                "alive": row.alive,
                "type": row.type,
                "downlink_low": row.downlink_low,
                "downlink_high": row.downlink_high,
                "mode": row.mode,
                "status": row.status,
                "frequency_violation": row.frequency_violation,
                "source": row.source,
            }

        logger.info(
            f"Found {len(existing_satellite_norad_ids)} existing satellites and {len(existing_transmitter_uuids)} existing transmitters in database"
        )

    except Exception as e:
        logger.error(f"Error querying existing data: {e}")
        # Return empty data structures if query fails

    return {
        "satellite_norad_ids": existing_satellite_norad_ids,
        "transmitter_uuids": existing_transmitter_uuids,
        "satellites": existing_satellites,
        "transmitters": existing_transmitters,
    }


def create_satellite_from_tle_data(sat, norad_id):
    """
    Create a Satellites object from TLE data.

    Args:
        sat (dict): Satellite TLE data
        norad_id (int): NORAD ID

    Returns:
        Satellites: The created satellite object
    """
    return Satellites(
        norad_id=norad_id,
        name=sat["name"],
        source="tlesync",
        name_other=None,
        alternative_name=None,
        image=None,
        sat_id=None,
        tle1=sat["line1"],
        tle2=sat["line2"],
        status=None,
        decayed=None,
        launched=None,
        deployed=None,
        website=None,
        operator=None,
        countries=None,
        citation=None,
        is_frequency_violator=None,
        associated_satellites=None,
    )


def create_satellite_orbit_from_source_data(sat: Dict[str, Any], norad_id: int) -> SatelliteOrbits:
    """
    Create or update canonical orbit row from normalized source record.

    The sync pipeline still stores compatibility TLE in satellites table, but this
    object is now the canonical per-body orbit record.
    """

    model_kind = str(sat.get("model_kind") or "tle").strip().lower()
    if model_kind not in {"tle", "omm"}:
        model_kind = "tle"

    central_body = str(sat.get("central_body") or "earth").strip().lower()
    if central_body not in {"earth", "moon", "mars"}:
        central_body = "earth"

    source_id = sat.get("source_id")
    source_uuid = None
    if source_id:
        try:
            source_uuid = uuid.UUID(str(source_id))
        except (ValueError, TypeError):
            source_uuid = None

    orbit_epoch = sat.get("orbit_epoch")
    if isinstance(orbit_epoch, str):
        orbit_epoch = parse_date(orbit_epoch)
    elif not isinstance(orbit_epoch, datetime):
        orbit_epoch = None

    source_updated_at = sat.get("source_updated_at")
    if isinstance(source_updated_at, str):
        source_updated_at = parse_date(source_updated_at)
    elif not isinstance(source_updated_at, datetime):
        source_updated_at = orbit_epoch

    omm_payload = sat.get("orbit_payload")
    if model_kind == "omm" and not isinstance(omm_payload, dict):
        omm_payload = {}
    if model_kind != "omm":
        omm_payload = None

    tle1 = sat.get("line1")
    tle2 = sat.get("line2")
    return SatelliteOrbits(
        satellite_norad_id=norad_id,
        central_body=central_body,
        model_kind=model_kind,
        epoch=orbit_epoch,
        tle1=tle1,
        tle2=tle2,
        omm_payload=omm_payload,
        source_id=source_uuid,
        source_object_id=sat.get("source_object_id") or str(norad_id),
        source_updated_at=source_updated_at,
    )


def update_satellite_with_satnogs_data(satellite, satnogs_sat_info):
    """
    Update satellite object with SATNOGS data.

    Args:
        satellite (Satellites): The satellite object to update
        satnogs_sat_info (dict): SATNOGS satellite information

    Returns:
        dict: Satellite data for comparison
    """
    if not satnogs_sat_info:
        return {"name": satellite.name, "tle1": satellite.tle1, "tle2": satellite.tle2}

    # Preserve the TLE name (Celestrak) - store SatNOGS name as alternative
    # tle_name = satellite.name  # Save the TLE name before updating

    satellite.sat_id = satnogs_sat_info.get("sat_id", None)
    satellite.name_other = satnogs_sat_info.get("name", None)  # Store SatNOGS name as alternative
    satellite.image = satnogs_sat_info.get("image", None)
    satellite.status = satnogs_sat_info.get("status", None)
    satellite.decayed = (
        parse_date(satnogs_sat_info.get("decayed"))
        if satnogs_sat_info.get("decayed", None)
        else None
    )
    satellite.launched = (
        parse_date(satnogs_sat_info.get("launched"))
        if satnogs_sat_info.get("launched", None)
        else None
    )
    satellite.deployed = (
        parse_date(satnogs_sat_info.get("deployed"))
        if satnogs_sat_info.get("deployed", None)
        else None
    )
    satellite.website = satnogs_sat_info.get("website", None)
    satellite.operator = satnogs_sat_info.get("operator", None)
    satellite.countries = satnogs_sat_info.get("countries", None)
    satellite.telemetries = satnogs_sat_info.get("telemetries", None)
    satellite.citation = satnogs_sat_info.get("citation", None)
    satellite.is_frequency_violator = satnogs_sat_info.get("is_frequency_violator", None)
    satellite.associated_satellites = json.dumps(satnogs_sat_info.get("associated_satellites", {}))

    return {
        "name": satellite.name,
        "sat_id": satellite.sat_id,
        "status": satellite.status,
        "tle1": satellite.tle1,
        "tle2": satellite.tle2,
        "operator": satellite.operator,
        "countries": satellite.countries,
        "is_frequency_violator": satellite.is_frequency_violator,
    }


def detect_satellite_modifications(
    norad_id, satellite_data_for_comparison, existing_satellites, sync_state, logger
):
    """
    Detect if a satellite has been modified and update sync state.

    Args:
        norad_id (int): NORAD ID of the satellite
        satellite_data_for_comparison (dict): New satellite data
        existing_satellites (dict): Existing satellite data
        sync_state (dict): Sync state to update
        logger: Logger instance

    Returns:
        bool: True if satellite was modified, False otherwise
    """
    if norad_id not in existing_satellites:
        return False

    existing_data = existing_satellites[norad_id]
    changes = {}

    for key, new_value in satellite_data_for_comparison.items():
        if key in existing_data and existing_data[key] != new_value:
            changes[key] = {"old": existing_data[key], "new": new_value}

    if changes:
        sync_state["modified"]["satellites"].append(
            {
                "norad_id": norad_id,
                "name": satellite_data_for_comparison.get("name", "Unknown"),
                "changes": changes,
            }
        )
        logger.debug(
            f"Satellite modified: {satellite_data_for_comparison.get('name', 'Unknown')} (NORAD ID: {norad_id}), changes: {changes}"
        )
        return True

    return False


def create_transmitter_from_satnogs_data(transmitter_info):
    """
    Create a Transmitters object from SATNOGS transmitter data.

    Args:
        transmitter_info (dict): SATNOGS transmitter information

    Returns:
        tuple: (Transmitters object, comparison data dict)
    """
    source_transmitter_id = transmitter_info.get("uuid", None)
    if source_transmitter_id is not None:
        source_transmitter_id = str(source_transmitter_id).strip() or None
    transmitter_uuid = normalize_external_transmitter_id(source_transmitter_id)

    transmitter_data_for_comparison = {
        "description": transmitter_info.get("description", None),
        "alive": transmitter_info.get("alive", None),
        "type": transmitter_info.get("type", None),
        "downlink_low": transmitter_info.get("downlink_low", None),
        "downlink_high": transmitter_info.get("downlink_high", None),
        "mode": transmitter_info.get("mode", None),
        "status": transmitter_info.get("status", None),
        "frequency_violation": transmitter_info.get("frequency_violation", None),
        "source": "satnogs",
    }

    transmitter = Transmitters(
        id=transmitter_uuid,
        description=transmitter_info.get("description", None),
        alive=transmitter_info.get("alive", None),
        type=transmitter_info.get("type", None),
        uplink_low=transmitter_info.get("uplink_low", None),
        uplink_high=transmitter_info.get("uplink_high", None),
        uplink_drift=transmitter_info.get("uplink_drift", None),
        downlink_low=transmitter_info.get("downlink_low", None),
        downlink_high=transmitter_info.get("downlink_high", None),
        downlink_drift=transmitter_info.get("downlink_drift", None),
        mode=transmitter_info.get("mode", None),
        mode_id=transmitter_info.get("mode_id", None),
        uplink_mode=transmitter_info.get("uplink_mode", None),
        invert=transmitter_info.get("invert", None),
        baud=transmitter_info.get("baud", None),
        sat_id=transmitter_info.get("sat_id", None),
        norad_cat_id=transmitter_info.get("norad_cat_id", None),
        norad_follow_id=transmitter_info.get("norad_follow_id", None),
        status=transmitter_info.get("status", None),
        citation=transmitter_info.get("citation", None),
        service=transmitter_info.get("service", None),
        source="satnogs",
        source_transmitter_id=source_transmitter_id,
        iaru_coordination=transmitter_info.get("iaru_coordination", None),
        iaru_coordination_url=transmitter_info.get("iaru_coordination_url", None),
        itu_notification=transmitter_info.get("itu_notification", None),
        frequency_violation=transmitter_info.get("frequency_violation", None),
        unconfirmed=transmitter_info.get("unconfirmed", None),
    )

    return transmitter, transmitter_data_for_comparison


def detect_transmitter_modifications(
    transmitter_uuid,
    transmitter_data_for_comparison,
    existing_transmitters,
    sync_state,
    satellite_name,
    norad_id,
    logger,
):
    """
    Detect if a transmitter has been modified and update sync state.

    Args:
        transmitter_uuid (str): UUID of the transmitter
        transmitter_data_for_comparison (dict): New transmitter data
        existing_transmitters (dict): Existing transmitter data
        sync_state (dict): Sync state to update
        satellite_name (str): Name of the satellite this transmitter belongs to
        norad_id (int): NORAD ID of the satellite
        logger: Logger instance

    Returns:
        bool: True if transmitter was modified, False otherwise
    """
    if transmitter_uuid not in existing_transmitters:
        return False

    existing_data = existing_transmitters[transmitter_uuid]
    changes = {}

    for key, new_value in transmitter_data_for_comparison.items():
        if key in existing_data and existing_data[key] != new_value:
            changes[key] = {"old": existing_data[key], "new": new_value}

    if changes:
        sync_state["modified"]["transmitters"].append(
            {
                "uuid": transmitter_uuid,
                "description": transmitter_data_for_comparison.get("description", "Unknown"),
                "satellite_name": satellite_name,
                "norad_id": norad_id,
                "changes": changes,
            }
        )
        logger.info(
            f"Transmitter modified: {transmitter_data_for_comparison.get('description', 'Unknown')} for satellite {satellite_name} (UUID: {transmitter_uuid}), changes: {changes}"
        )
        return True

    return False


def create_final_success_message(count_sats, count_transmitters, sync_state):
    """
    Create a detailed success message for synchronization completion.

    Args:
        count_sats (int): Number of satellites processed
        count_transmitters (int): Number of transmitters processed
        sync_state (dict): Current sync state

    Returns:
        str: Formatted success message
    """
    new_satellites_count = len(sync_state["newly_added"]["satellites"])
    new_transmitters_count = len(sync_state["newly_added"]["transmitters"])
    removed_satellites_count = len(sync_state["removed"]["satellites"])
    removed_transmitters_count = len(sync_state["removed"]["transmitters"])
    modified_satellites_count = len(sync_state["modified"]["satellites"])
    modified_transmitters_count = len(sync_state["modified"]["transmitters"])

    success_message = (
        f"Successfully synchronized {count_sats} satellites and {count_transmitters} transmitters"
    )

    if new_satellites_count > 0 or new_transmitters_count > 0:
        success_message += (
            f" (New: {new_satellites_count} satellites, {new_transmitters_count} transmitters)"
        )

    if modified_satellites_count > 0 or modified_transmitters_count > 0:
        success_message += f" (Modified: {modified_satellites_count} satellites, {modified_transmitters_count} transmitters)"

    if removed_satellites_count > 0 or removed_transmitters_count > 0:
        success_message += f" (Removed: {removed_satellites_count} satellites, {removed_transmitters_count} transmitters)"

    return success_message


def parse_date(date_str: str) -> datetime:
    """
    Parses a date string in ISO 8601 format with an optional 'Z' suffix
    indicating UTC time and converts it to a datetime object.

    :param date_str: The ISO 8601 formatted date string, which may
        include a 'Z' suffix indicating UTC time.
    :type date_str: str
    :return: A datetime object corresponding to the provided date
        string.
    :rtype: datetime
    """
    date_str = date_str.replace("Z", "+00:00")
    return datetime.fromisoformat(date_str)


def get_norad_ids(tle_objects: list) -> list:
    """
    Extracts the NORAD ID from the 'line1' field in each object of the list.

    :param tle_objects: A list of dictionaries containing {'name', 'line1', 'line2'}.
    :return: A list of integer NORAD IDs.
    """
    return [_extract_norad_id_from_record(obj) for obj in tle_objects]


def normalize_satellite_ids(value: Any) -> List[int]:
    """
    Normalize group satellite membership into unique integer NORAD IDs.

    Older SQLite rows may contain a JSON string inside the JSON column, while
    newer rows use normal arrays. Accept both so source queries can use either.
    """
    if value is None:
        return []

    candidate = value
    for _ in range(2):
        if isinstance(candidate, str):
            cleaned = candidate.strip()
            if not cleaned:
                return []
            try:
                candidate = json.loads(cleaned)
            except json.JSONDecodeError:
                return []
        else:
            break

    if not isinstance(candidate, (list, tuple, set)):
        return []

    normalized: List[int] = []
    seen: Set[int] = set()
    for item in candidate:
        try:
            norad_id = int(item)
        except (TypeError, ValueError):
            continue
        if norad_id <= 0 or norad_id in seen:
            continue
        normalized.append(norad_id)
        seen.add(norad_id)
    return normalized


def get_satellite_by_norad_id(norad_id: int, satellites: List[dict]) -> Optional[dict]:
    """
    Returns the satellite object from the provided list that matches the given NORAD ID.

    Parameters:
        norad_id (int): The NORAD ID to search for.
        satellites (List[object]): A list of satellite objects which have a 'norad_id' attribute.

    Returns:
        The matching satellite object if found, otherwise None.
    """
    for satellite in satellites:
        norad_id_from_list = satellite["norad_cat_id"]
        if norad_id_from_list == norad_id:
            return satellite
    return None


def get_transmitter_info_by_norad_id(norad_id: int, transmitters: list) -> list:
    """
    Returns the satellite object from the provided list that matches the given NORAD ID.

    Parameters:
        norad_id (int): The NORAD ID to search for.
        transmitters (List[object]): A list of satellite objects which have a 'norad_id' attribute.

    Returns:
        The matching satellite object if found, otherwise None.
    """

    trxs = []

    for transmitter in transmitters:
        norad_cat_id = transmitter["norad_cat_id"]
        norad_follow_id = transmitter.get("norad_follow_id")

        # Match by either the catalog ID or the followed ID
        if norad_cat_id == norad_id or (norad_follow_id and norad_follow_id == norad_id):
            trxs.append(transmitter)
    return trxs


def simple_parse_3le(file_contents: str) -> list:
    """
    Parses satellite 3LE data from a string and returns a list of dictionaries.
    Each dictionary has "name", "line1", and "line2" keys.

    :param file_contents: str, the contents of a file with 3LE data
    :return: list of dicts, each dict containing "name", "line1", and "line2"
    """
    # Split the file contents into lines, stripping out any extra whitespace
    lines = file_contents.strip().splitlines()

    # We'll store the parsed satellite data here
    satellites = []

    # 3 lines correspond to each satellite's set
    # So we'll iterate in steps of 3
    for i in range(0, len(lines), 3):
        # Ensure we don't run out of lines
        if i + 2 < len(lines):
            name_line = lines[i].strip()
            line1 = lines[i + 1].strip()
            line2 = lines[i + 2].strip()

            satellites.append({"name": name_line, "line1": line1, "line2": line2})

    return satellites


def _extract_norad_id_from_record(record: Dict[str, Any]) -> int:
    if "norad_id" in record and record.get("norad_id") is not None:
        return int(record["norad_id"])
    return parse_norad_id_from_line1(record["line1"])


async def detect_and_remove_satellites(
    session, tle_source_identifier, current_satellite_ids, logger
):
    """
    Detect satellites that were removed from a TLE source and handle their removal.

    Args:
        session: SQLAlchemy async session
        tle_source_identifier: The identifier of the TLE source
        current_satellite_ids: List of current satellite NORAD IDs from the TLE source
        logger: logger object for logging messages

    Returns:
        Dict with removed satellite details including names
    """

    # Get the existing satellite group for this TLE source
    result = await session.execute(
        select(Groups).filter_by(identifier=tle_source_identifier, type=SatelliteGroupType.SYSTEM)
    )
    existing_group = result.scalar_one_or_none()

    if not existing_group or not existing_group.satellite_ids:
        # No existing group or no previous satellite IDs, nothing to remove
        return {"satellites": [], "transmitters": []}

    # Normalize legacy stringified JSON groups before comparing memberships.
    current_ids_set = set(normalize_satellite_ids(current_satellite_ids))
    previous_ids_set = set(normalize_satellite_ids(existing_group.satellite_ids))

    # Find satellites that were in the previous list but not in the current list
    removed_satellite_ids = list(previous_ids_set - current_ids_set)

    removed_data: Dict[str, List[Any]] = {"satellites": [], "transmitters": []}

    if removed_satellite_ids:
        logger.info(
            f"Detected {len(removed_satellite_ids)} removed satellites from TLE source '{tle_source_identifier}': {removed_satellite_ids}"
        )

        # Handle removal of satellites and their transmitters
        for norad_id in removed_satellite_ids:
            # Get satellite details before removing
            satellite_result = await session.execute(
                select(Satellites).filter_by(norad_id=norad_id)
            )
            satellite = satellite_result.scalar_one_or_none()

            if satellite:
                # Check if this satellite exists in other TLE sources
                other_groups_result = await session.execute(
                    select(Groups).filter(
                        Groups.identifier != tle_source_identifier,
                        Groups.type == SatelliteGroupType.SYSTEM,
                    )
                )
                other_groups = other_groups_result.scalars().all()

                # Check if the satellite exists in any other system group
                satellite_in_other_sources = False
                for group in other_groups:
                    if norad_id in normalize_satellite_ids(group.satellite_ids):
                        satellite_in_other_sources = True
                        break

                if not satellite_in_other_sources:
                    # Satellite is not in any other TLE source, safe to remove
                    logger.info(
                        f"Removing satellite {norad_id} ({satellite.name}) and its transmitters (not found in other TLE sources)"
                    )

                    # Get transmitter details before removing
                    transmitters_result = await session.execute(
                        select(Transmitters).filter_by(norad_cat_id=norad_id)
                    )
                    transmitters = transmitters_result.scalars().all()

                    # Add transmitter details to removed data
                    for transmitter in transmitters:
                        removed_data["transmitters"].append(
                            {
                                "uuid": transmitter.id,
                                "description": transmitter.description,
                                "satellite_name": satellite.name,
                                "norad_id": norad_id,
                                "downlink_low": transmitter.downlink_low,
                                "downlink_high": transmitter.downlink_high,
                                "mode": transmitter.mode,
                            }
                        )

                    # Remove transmitters first (due to foreign key constraint)
                    transmitters_delete_result = await session.execute(
                        delete(Transmitters).filter_by(norad_cat_id=norad_id)
                    )
                    transmitters_deleted = transmitters_delete_result.rowcount
                    if transmitters_deleted > 0:
                        logger.info(
                            f"Removed {transmitters_deleted} transmitters for satellite {norad_id}"
                        )

                    # Add satellite details to removed data
                    removed_data["satellites"].append(
                        {
                            "norad_id": norad_id,
                            "name": satellite.name,
                            "sat_id": satellite.sat_id,
                            "tle_source": tle_source_identifier,
                        }
                    )

                    # Remove the satellite
                    satellite_delete_result = await session.execute(
                        delete(Satellites).filter_by(norad_id=norad_id)
                    )
                    satellite_deleted = satellite_delete_result.rowcount
                    if satellite_deleted > 0:
                        logger.info(f"Removed satellite {norad_id} ({satellite.name})")
                else:
                    logger.info(
                        f"Satellite {norad_id} ({satellite.name}) found in other TLE sources, keeping it"
                    )
            else:
                logger.info(f"Satellite {norad_id} not found in database, skipping removal")

    return removed_data


async def update_satellite_group_with_removal_detection(
    session, tle_source_identifier, satellite_ids, group_name, logger
):
    """
    Update or create a satellite group and detect removed satellites.

    Args:
        session: SQLAlchemy async session
        tle_source_identifier: The identifier of the TLE source
        satellite_ids: List of current satellite NORAD IDs
        group_name: Name for the satellite group
        logger: logger object for logging messages

    Returns:
        Dict with removed satellite details including names
    """

    # First, detect and handle removed satellites
    removed_data = await detect_and_remove_satellites(
        session, tle_source_identifier, satellite_ids, logger
    )

    # Then update or create the satellite group
    result = await session.execute(
        select(Groups).filter_by(identifier=tle_source_identifier, type=SatelliteGroupType.SYSTEM)
    )
    existing_group = result.scalar_one_or_none()

    if existing_group:
        # Update the existing group
        # Keep system-group display name aligned with the current orbital source name.
        existing_group.name = group_name
        existing_group.satellite_ids = normalize_satellite_ids(satellite_ids)
        existing_group.updated = datetime.now(timezone.utc)
        logger.info(f"Updated satellite group '{group_name}' with {len(satellite_ids)} satellites")
    else:
        # Create a new group
        new_group = Groups(
            name=group_name,
            identifier=tle_source_identifier,
            type=SatelliteGroupType.SYSTEM,
            satellite_ids=normalize_satellite_ids(satellite_ids),
            added=datetime.now(timezone.utc),
            updated=datetime.now(timezone.utc),
        )
        session.add(new_group)
        logger.info(
            f"Created new satellite group '{group_name}' with {len(satellite_ids)} satellites"
        )

    return removed_data
