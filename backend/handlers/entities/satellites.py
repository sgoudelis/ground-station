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

"""Satellite data handlers."""

from typing import Any, Dict, List, Optional, Union

import crud
from celestial.bodycatalog import search_celestial_bodies
from celestial.spacecraftindex import search_spacecraft_index
from db import AsyncSessionLocal
from server import runtimestate
from tasks.registry import get_task
from tracker.data import compiled_satellite_data
from tracker.runner import get_all_tracker_managers


def _split_query_token(query: str) -> tuple[str, str]:
    """Return normalized leading token and optional trailing query text."""
    raw_query = str(query or "").strip().lower()
    if not raw_query:
        return "", ""

    parts = raw_query.split(maxsplit=1)
    token = "".join(ch for ch in parts[0] if ch.isalnum())
    if token.endswith("s") and len(token) > 3:
        token = token[:-1]
    tail = parts[1].strip() if len(parts) > 1 else ""
    return token, tail


def _starts_with_any(token: str, prefixes: List[str]) -> bool:
    """Prefix matching used for type-hint autocomplete tokens (e.g. `moo`)."""
    if len(token) < 2:
        return False
    return any(prefix.startswith(token) for prefix in prefixes)


def _resolve_target_search_hints(query: str) -> Dict[str, Any]:
    """Resolve optional query type hints for mission/body grouped autocomplete."""
    token, tail = _split_query_token(query)

    mission_group = _starts_with_any(token, ["mission", "spacecraft"])
    moon_group = _starts_with_any(token, ["moon"])
    planet_group = _starts_with_any(token, ["planet"])
    body_group = moon_group or planet_group or _starts_with_any(token, ["body", "celestial"])

    body_type: Optional[str] = None
    if moon_group:
        body_type = "moon"
    elif planet_group:
        body_type = "planet"

    return {
        "mission_group": mission_group,
        "body_group": body_group,
        "body_type": body_type,
        "tail_query": tail or None,
    }


def _build_mission_transmitter_target_key(mission: Dict[str, Any]) -> str:
    command = str(mission.get("command") or "").strip()
    return f"mission:{command}" if command else ""


def _build_body_transmitter_target_key(body_id: str) -> str:
    return crud.transmitters.build_target_key(target_type="body", body_id=body_id) or ""


async def get_satellites(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Union[bool, list]]:
    """
    Get list of satellites.

    Args:
        sio: Socket.IO server instance
        data: Filter parameters
        logger: Logger instance
        sid: Socket.IO session ID

    Returns:
        Dictionary with success status and satellite data
    """
    async with AsyncSessionLocal() as dbsession:
        logger.debug(f"Getting satellites, data: {data}")
        satellites = await crud.satellites.fetch_satellites(dbsession, data)
        return {"success": satellites["success"], "data": satellites.get("data", [])}


async def get_satellite(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Union[bool, dict]]:
    """
    Get single satellite with complete details (position, coverage, etc.).

    Args:
        sio: Socket.IO server instance
        data: Satellite identifier
        logger: Logger instance
        sid: Socket.IO session ID

    Returns:
        Dictionary with success status and satellite data
    """
    async with AsyncSessionLocal() as dbsession:
        logger.debug(f"Getting satellite data for norad id, data: {data}")
        try:
            satellite_data = await compiled_satellite_data(dbsession, data)
            return {"success": True, "data": satellite_data}
        except Exception as e:
            logger.error(f"Error: {e}")
            return {"success": False, "data": {}}


async def get_satellites_for_group_id(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Union[bool, list]]:
    """
    Get satellites for a specific group ID with their transmitters.

    Args:
        sio: Socket.IO server instance
        data: Group ID
        logger: Logger instance
        sid: Socket.IO session ID

    Returns:
        Dictionary with success status and satellites data
    """
    async with AsyncSessionLocal() as dbsession:
        logger.debug(f"Getting satellites for group id, data: {data}")
        satellites = await crud.satellites.fetch_satellites_for_group_id(dbsession, data)

        # Get transmitters for each satellite
        if satellites:
            for satellite in satellites.get("data", []):
                transmitters = await crud.transmitters.fetch_transmitters_for_satellite(
                    dbsession, satellite["norad_id"]
                )
                satellite["transmitters"] = transmitters["data"]
        else:
            logger.debug(f"No satellites found for group id: {data}")

        return {"success": satellites["success"], "data": satellites.get("data", [])}


async def get_satellite_catalog_stats(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Union[bool, dict, str, None]]:
    """Get aggregate satellite catalog stats for the admin catalog page."""
    async with AsyncSessionLocal() as dbsession:
        logger.debug("Getting satellite catalog stats")
        stats = await crud.satellites.fetch_satellite_catalog_stats(dbsession)
        return {
            "success": bool(stats.get("success")),
            "data": stats.get("data", {}),
            "error": stats.get("error"),
        }


async def search_satellites(
    sio: Any, data: Optional[Union[Dict[str, Any], str, int]], logger: Any, sid: str
) -> Dict[str, Union[bool, list]]:
    """
    Search satellites by keyword with their transmitters.

    Args:
        sio: Socket.IO server instance
        data: Search keyword
        logger: Logger instance
        sid: Socket.IO session ID

    Returns:
        Dictionary with success status and search results
    """
    async with AsyncSessionLocal() as dbsession:
        logger.debug(f"Searching satellites, data: {data}")
        keyword: Union[str, int, None]
        if isinstance(data, dict):
            keyword = data.get("keyword") or data.get("query")
        else:
            keyword = data
        satellites = await crud.satellites.search_satellites(dbsession, keyword=keyword)

        # Get transmitters for each satellite (same as get_satellites_for_group_id)
        if satellites:
            for satellite in satellites.get("data", []):
                transmitters = await crud.transmitters.fetch_transmitters_for_satellite(
                    dbsession, satellite["norad_id"]
                )
                satellite["transmitters"] = transmitters["data"]
        else:
            logger.debug(f"No satellites found for search keyword: {data}")

        return {"success": satellites["success"], "data": satellites.get("data", [])}


async def search_targets(
    sio: Any, data: Optional[Union[Dict[str, Any], str]], logger: Any, sid: str
) -> Dict[str, Union[bool, list, str, None]]:
    """
    Search satellites, missions, and bodies with one normalized payload.

    Satellites keep the same backend lookup behavior as get-satellite-search
    so target retargeting can preserve existing group/transmitter handling.
    """
    try:
        query = ""
        limit = 20

        if isinstance(data, str):
            query = data
        elif isinstance(data, dict):
            query = str(data.get("query") or "")
            requested_limit = data.get("limit")
            if isinstance(requested_limit, int) and requested_limit > 0:
                limit = min(requested_limit, 50)

        query = str(query or "").strip()
        if len(query) < 2:
            return {"success": True, "data": [], "error": None}

        type_hints = _resolve_target_search_hints(query)
        mission_group_hint = bool(type_hints.get("mission_group"))
        body_group_hint = bool(type_hints.get("body_group"))
        hinted_body_type = str(type_hints.get("body_type") or "").strip().lower() or None
        tail_query = str(type_hints.get("tail_query") or "").strip()

        # Reuse existing satellite search flow so results keep group and transmitter enrichment.
        satellites_reply = await search_satellites(sio, query, logger, sid)
        if not satellites_reply.get("success"):
            return {
                "success": False,
                "data": [],
                "error": satellites_reply.get("error") or "Failed to search satellites",
            }

        satellite_data = satellites_reply.get("data")
        satellite_rows: List[Dict[str, Any]] = (
            satellite_data[:limit] if isinstance(satellite_data, list) else []
        )
        mission_query = (
            tail_query
            if mission_group_hint and tail_query
            else ("" if mission_group_hint else query)
        )
        mission_rows = search_spacecraft_index(query=mission_query, limit=limit)

        if body_group_hint:
            # For type-hint searches (`moon`, `planet`, `body`), evaluate from catalog root
            # so options are grouped by entity type instead of only literal name matches.
            body_query = tail_query if tail_query else ""
            body_limit = max(limit * 5, 100)
            body_rows = search_celestial_bodies(query=body_query, limit=body_limit)
            if hinted_body_type:
                body_rows = [
                    row
                    for row in body_rows
                    if str(row.get("body_type") or "").strip().lower() == hinted_body_type
                ]
            body_rows = body_rows[:limit]
        else:
            body_rows = search_celestial_bodies(query=query, limit=limit)

        mission_target_keys = [
            _build_mission_transmitter_target_key(mission) for mission in mission_rows
        ]
        body_target_keys = [
            _build_body_transmitter_target_key(str(body.get("body_id") or "").strip().lower())
            for body in body_rows
        ]
        target_keys = [key for key in [*mission_target_keys, *body_target_keys] if key]
        transmitters_by_target_key: Dict[str, List[Dict[str, Any]]] = {}
        if target_keys:
            async with AsyncSessionLocal() as dbsession:
                transmitters_reply = await crud.transmitters.fetch_transmitters_for_target_keys(
                    dbsession,
                    target_keys,
                )
            if transmitters_reply.get("success"):
                transmitters_by_target_key = transmitters_reply.get("data", {}) or {}

        results = []

        for satellite in satellite_rows:
            norad_id = satellite.get("norad_id")
            if norad_id is None:
                continue
            name = str(satellite.get("name") or norad_id).strip()
            # Keep alias fields in the unified payload so frontend-side filtering
            # can still match queries that hit DB alias columns (e.g. name_other).
            name_other = str(satellite.get("name_other") or "").strip()
            alternative_name = str(satellite.get("alternative_name") or "").strip()
            results.append(
                {
                    "id": f"satellite:{norad_id}",
                    "target_type": "satellite",
                    "target_name": name,
                    "name": name,
                    "target_identifier": str(norad_id),
                    "norad_id": norad_id,
                    "name_other": name_other,
                    "alternative_name": alternative_name,
                    "groups": satellite.get("groups") or [],
                    "transmitters": satellite.get("transmitters") or [],
                }
            )

        for mission in mission_rows:
            command = str(mission.get("command") or "").strip()
            if not command:
                continue
            target_key = _build_mission_transmitter_target_key(mission)
            mission_id = str(mission.get("id") or "").strip().lower()
            display_name = str(mission.get("display_name") or command).strip()
            results.append(
                {
                    "id": target_key,
                    "target_type": "mission",
                    "target_key": target_key,
                    "target_name": display_name,
                    "target_identifier": command,
                    "mission_id": mission_id or None,
                    "command": command,
                    "display_name": display_name,
                    "transmitters": transmitters_by_target_key.get(target_key, []),
                    "mission_status": str(mission.get("mission_status") or "unknown")
                    .strip()
                    .lower(),
                    "status_label": str(mission.get("status_label") or "").strip(),
                }
            )

        for body in body_rows:
            body_id = str(body.get("body_id") or "").strip().lower()
            if not body_id:
                continue
            target_key = _build_body_transmitter_target_key(body_id)
            body_name = str(body.get("name") or body_id).strip()
            results.append(
                {
                    "id": target_key or f"body:{body_id}",
                    "target_type": "body",
                    "target_key": target_key,
                    "target_name": body_name,
                    "target_identifier": body_id,
                    "body_id": body_id,
                    "name": body_name,
                    "transmitters": transmitters_by_target_key.get(target_key, []),
                    "body_type": str(body.get("body_type") or "").strip(),
                    "parent_body_id": str(body.get("parent_body_id") or "").strip().lower(),
                }
            )

        return {"success": True, "data": results, "error": None}
    except Exception as exc:
        logger.error(f"Failed searching unified targets: {exc}")
        return {"success": False, "error": str(exc), "data": []}


async def delete_satellite(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Union[bool, list]]:
    """
    Delete a satellite.

    Args:
        sio: Socket.IO server instance
        data: Satellite identifier
        logger: Logger instance
        sid: Socket.IO session ID

    Returns:
        Dictionary with success status and updated satellites list
    """
    async with AsyncSessionLocal() as dbsession:
        logger.debug(f"Delete satellite, data: {data}")
        delete_reply = await crud.satellites.delete_satellite(dbsession, data)

        satellites = await crud.satellites.fetch_satellites(dbsession, None)
        return {
            "success": (satellites["success"] & delete_reply["success"]),
            "data": satellites.get("data", []),
        }


async def submit_satellite(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Union[bool, list, str]]:
    """
    Add a new satellite.

    Args:
        sio: Socket.IO server instance
        data: Satellite details
        logger: Logger instance
        sid: Socket.IO session ID

    Returns:
        Dictionary with success status and updated satellites list
    """
    async with AsyncSessionLocal() as dbsession:
        logger.debug(f"Adding satellite, data: {data}")
        submit_reply = await crud.satellites.add_satellite(dbsession, data)

        satellites = await crud.satellites.fetch_satellites(dbsession, None)
        if data and data.get("norad_id"):
            for manager in get_all_tracker_managers().values():
                await manager.notify_tle_updated(data.get("norad_id"))
        return {
            "success": (satellites["success"] & submit_reply["success"]),
            "data": satellites.get("data", []),
            "error": submit_reply.get("error"),
        }


async def edit_satellite(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Union[bool, list, str]]:
    """
    Edit an existing satellite.

    Args:
        sio: Socket.IO server instance
        data: Satellite NORAD ID and updated details
        logger: Logger instance
        sid: Socket.IO session ID

    Returns:
        Dictionary with success status and updated satellites list
    """
    async with AsyncSessionLocal() as dbsession:
        logger.debug(f"Editing satellite, data: {data}")
        if not data or "norad_id" not in data:
            return {"success": False, "data": [], "error": "Missing satellite NORAD ID"}

        orbit_payload = data.get("orbit") if isinstance(data, dict) else None
        update_data = {
            key: value for key, value in data.items() if key not in {"norad_id", "orbit"}
        }
        edit_reply = await crud.satellites.edit_satellite(
            dbsession, data["norad_id"], orbit=orbit_payload, **update_data
        )

        satellites = await crud.satellites.fetch_satellites(dbsession, None)
        for manager in get_all_tracker_managers().values():
            await manager.notify_tle_updated(data.get("norad_id"))
        return {
            "success": (satellites["success"] & edit_reply["success"]),
            "data": satellites.get("data", []),
            "error": edit_reply.get("error"),
        }


async def sync_satellite_data(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Union[bool, None, str]]:
    """
    Synchronize satellite data with known orbital sources as a background task.

    This handler starts orbital synchronization as a background task, making it:
    - Visible in the task manager UI
    - Cancellable by users
    - Consistent with scheduled sync behavior

    Args:
        sio: Socket.IO server instance (not used, kept for signature compatibility)
        data: Not used
        logger: Logger instance
        sid: Socket.IO session ID

    Returns:
        Dictionary with success status and task_id
    """
    try:
        background_task_manager = runtimestate.background_task_manager
        if not background_task_manager:
            logger.error("Background task manager not initialized")
            return {"success": False, "error": "Background task manager not initialized"}

        logger.info("Starting orbital synchronization as background task (manual trigger)")

        # Get the orbital sync task function
        orbital_sync_task = get_task("orbital_sync")

        # Start as background task
        task_id = await background_task_manager.start_task(
            func=orbital_sync_task,
            args=(),
            kwargs={},
            name="Manual Orbital Data Sync",
            task_id=None,
        )

        logger.info(f"Manual orbital sync started as background task: {task_id}")
        return {"success": True, "task_id": task_id}

    except ValueError as e:
        # Singleton task already running (e.g., orbital sync already in progress)
        logger.warning(f"Orbital sync already running: {e}")
        return {"success": False, "error": str(e)}

    except Exception as e:
        logger.error(f"Error starting orbital synchronization: {e}")
        return {"success": False, "error": str(e)}


def register_handlers(registry):
    """Register satellite handlers with the command registry."""
    registry.register_batch(
        {
            "get-satellites": (get_satellites, "api_call"),
            "get-satellite": (get_satellite, "api_call"),
            "get-satellites-for-group-id": (get_satellites_for_group_id, "api_call"),
            "get-satellite-catalog-stats": (get_satellite_catalog_stats, "api_call"),
            "get-satellite-search": (search_satellites, "api_call"),
            "get-target-search": (search_targets, "api_call"),
            "submit-satellite": (submit_satellite, "api_call"),
            "edit-satellite": (edit_satellite, "api_call"),
            "delete-satellite": (delete_satellite, "api_call"),
            "sync-satellite-data": (sync_satellite_data, "api_call"),
        }
    )
