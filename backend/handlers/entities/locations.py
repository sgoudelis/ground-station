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

"""Location handlers."""

from typing import Any, Dict, Optional, Union

import crud
from common.timezones import timezone_for_coordinates
from db import AsyncSessionLocal
from tracker.runner import get_all_tracker_managers


async def get_location_timezone(sio: Any, data: Optional[Dict], logger: Any, sid: str) -> Dict:
    """Preview the station timezone without saving a location during setup."""
    if not isinstance(data, dict):
        return {"success": False, "error": "Latitude and longitude are required."}
    try:
        timezone = timezone_for_coordinates(data.get("lat"), data.get("lon"))
        return {"success": True, "data": {"timezone": timezone}}
    except ValueError as exc:
        return {"success": False, "error": str(exc)}


async def get_locations(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Union[bool, list]]:
    """
    Get all locations.

    Args:
        sio: Socket.IO server instance
        data: Not used
        logger: Logger instance
        sid: Socket.IO session ID

    Returns:
        Dictionary with success status and locations
    """
    async with AsyncSessionLocal() as dbsession:
        logger.debug("Getting all locations")
        locations = await crud.locations.fetch_all_locations(dbsession)
        return {"success": locations["success"], "data": locations.get("data", [])}


async def submit_location(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Union[bool, str, None]]:
    """
    Add a new location.

    Args:
        sio: Socket.IO server instance
        data: Location details
        logger: Logger instance
        sid: Socket.IO session ID

    Returns:
        Dictionary with success status
    """
    # An empty payload has defaults in CRUD; missing data must still fail.
    if data is None:
        return {"success": False, "data": None, "error": "Location data is required"}
    async with AsyncSessionLocal() as dbsession:
        logger.debug(f"Adding location, data: {data}")
        add_reply = await crud.locations.add_location(dbsession, data)
        if add_reply.get("success"):
            for manager in get_all_tracker_managers().values():
                await manager.notify_locations_changed()
        return {
            "success": add_reply["success"],
            "data": add_reply.get("data"),
            "error": add_reply.get("error"),
        }


async def edit_location(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Union[bool, None]]:
    """
    Edit an existing location.

    Args:
        sio: Socket.IO server instance
        data: Location ID and updated details
        logger: Logger instance
        sid: Socket.IO session ID

    Returns:
        Dictionary with success status
    """
    async with AsyncSessionLocal() as dbsession:
        logger.debug(f"Editing location, data: {data}")
        edit_reply = await crud.locations.edit_location(dbsession, data or {})
        if edit_reply.get("success"):
            for manager in get_all_tracker_managers().values():
                await manager.notify_locations_changed()
        return {
            "success": edit_reply["success"],
            "data": edit_reply.get("data"),
            "error": edit_reply.get("error"),
        }


async def delete_location(
    sio: Any, data: str, logger: Any, sid: str
) -> Dict[str, Union[bool, None]]:
    """
    Delete a location.

    Args:
        sio: Socket.IO server instance
        data: Location identifier
        logger: Logger instance
        sid: Socket.IO session ID

    Returns:
        Dictionary with success status
    """
    async with AsyncSessionLocal() as dbsession:
        logger.debug(f"Delete location, data: {data}")
        delete_reply = await crud.locations.delete_location(dbsession, data)
        if delete_reply.get("success"):
            for manager in get_all_tracker_managers().values():
                await manager.notify_locations_changed()
        return {"success": delete_reply["success"], "data": None}


def register_handlers(registry):
    """Register location handlers with the command registry."""
    registry.register_batch(
        {
            "get-locations": (get_locations, "api_call"),
            "get-location-timezone": (get_location_timezone, "api_call"),
            "submit-location": (submit_location, "api_call"),
            "edit-location": (edit_location, "api_call"),
            "delete-location": (delete_location, "api_call"),
        }
    )
