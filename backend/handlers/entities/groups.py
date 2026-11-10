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

"""Satellite group handlers."""

from typing import Any, Dict, Optional, Union

import crud
from db import AsyncSessionLocal
from db.models import SatelliteGroupType
from tracking.events import fetch_next_events_for_group


async def get_satellite_groups(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Union[bool, list, None]]:
    """
    Get all satellite groups.

    Args:
        sio: Socket.IO server instance
        data: Not used
        logger: Logger instance
        sid: Socket.IO session ID

    Returns:
        Dictionary with success status and satellite groups
    """
    async with AsyncSessionLocal() as dbsession:
        logger.debug(f"Getting satellite groups, data: {data}")
        satellite_groups = await crud.groups.fetch_satellite_group(dbsession)
        return {
            "success": satellite_groups["success"],
            "data": satellite_groups.get("data", []),
        }


async def get_satellite_groups_user(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Union[bool, list, None]]:
    """
    Get user-created satellite groups only.

    Args:
        sio: Socket.IO server instance
        data: Not used
        logger: Logger instance
        sid: Socket.IO session ID

    Returns:
        Dictionary with success status and user satellite groups
    """
    async with AsyncSessionLocal() as dbsession:
        logger.debug(f"Getting user satellite groups, data: {data}")
        satellite_groups = await crud.groups.fetch_satellite_group(dbsession)
        groups_data = satellite_groups.get("data") or []

        # Only return the user groups
        filtered_groups = [
            satellite_group
            for satellite_group in groups_data
            if satellite_group["type"] == SatelliteGroupType.USER
        ]

        return {"success": satellite_groups["success"], "data": filtered_groups}


async def get_satellite_groups_system(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Union[bool, list, None]]:
    """
    Get system-created satellite groups only.

    Args:
        sio: Socket.IO server instance
        data: Not used
        logger: Logger instance
        sid: Socket.IO session ID

    Returns:
        Dictionary with success status and system satellite groups
    """
    async with AsyncSessionLocal() as dbsession:
        logger.debug(f"Getting system satellite groups, data: {data}")
        satellite_groups = await crud.groups.fetch_satellite_group(dbsession)
        groups_data = satellite_groups.get("data") or []

        # Only return the system groups
        filtered_groups = [
            satellite_group
            for satellite_group in groups_data
            if satellite_group["type"] == SatelliteGroupType.SYSTEM
        ]
        return {"success": satellite_groups["success"], "data": filtered_groups}


async def submit_satellite_group(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Any]:
    """
    Add a new satellite group.

    Args:
        sio: Socket.IO server instance
        data: Satellite group details
        logger: Logger instance
        sid: Socket.IO session ID

    Returns:
        Dictionary with success status and updated satellite groups
    """
    async with AsyncSessionLocal() as dbsession:
        logger.debug(f"Adding satellite group, data: {data}")
        if (
            not isinstance(data, dict)
            or not isinstance(data.get("name"), str)
            or not data["name"].strip()
        ):
            return {"success": False, "data": [], "error": "Name is required."}

        submit_reply = await crud.groups.add_satellite_group(
            dbsession,
            {
                "name": data["name"].strip(),
                "satellite_ids": data.get("satellite_ids", []),
                "show_on_earth_view": data.get("show_on_earth_view", True),
            },
            group_type=SatelliteGroupType.USER,
        )
        if not submit_reply["success"]:
            return {"success": False, "data": [], "error": submit_reply.get("error")}

        satellite_groups = await crud.groups.fetch_satellite_group(dbsession, group_type="user")
        return {
            "success": satellite_groups["success"],
            "data": satellite_groups.get("data", []),
            "error": satellite_groups.get("error"),
        }


async def edit_satellite_group(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Union[bool, list, str, None]]:
    """
    Edit an existing satellite group.

    Args:
        sio: Socket.IO server instance
        data: Satellite group ID and updated details
        logger: Logger instance
        sid: Socket.IO session ID

    Returns:
        Dictionary with success status and updated satellite groups
    """
    async with AsyncSessionLocal() as dbsession:
        logger.debug(f"Editing satellite group, data: {data}")
        if not data or "id" not in data:
            return {"success": False, "data": [], "error": "Missing satellite group ID"}

        edit_data = {
            key: data[key] for key in ("name", "satellite_ids", "show_on_earth_view") if key in data
        }
        if "name" in edit_data and isinstance(edit_data["name"], str):
            edit_data["name"] = edit_data["name"].strip()
        edit_reply = await crud.groups.edit_satellite_group(
            dbsession,
            data["id"],
            edit_data,
            group_type=SatelliteGroupType.USER,
        )
        if not edit_reply["success"]:
            return {"success": False, "data": [], "error": edit_reply.get("error")}

        satellite_groups = await crud.groups.fetch_satellite_group(dbsession, group_type="user")
        return {
            "success": satellite_groups["success"],
            "data": satellite_groups.get("data", []),
            "error": satellite_groups.get("error"),
        }


async def delete_satellite_group(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Any]:
    """
    Delete satellite groups.

    Args:
        sio: Socket.IO server instance
        data: List of satellite group IDs to delete
        logger: Logger instance
        sid: Socket.IO session ID

    Returns:
        Dictionary with success status and updated satellite groups
    """
    async with AsyncSessionLocal() as dbsession:
        logger.debug(f"Deleting satellite groups, data: {data}")
        delete_reply = await crud.groups.delete_satellite_group(
            dbsession, data or {}, group_type=SatelliteGroupType.USER
        )
        if not delete_reply["success"]:
            return {"success": False, "data": [], "error": delete_reply.get("error")}

        satellite_groups = await crud.groups.fetch_satellite_group(dbsession, group_type="user")
        return {
            "success": satellite_groups["success"],
            "data": satellite_groups.get("data", []),
            "error": satellite_groups.get("error"),
        }


async def fetch_next_passes_for_group(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Union[bool, list, float, None]]:
    """
    Fetch next passes for a satellite group.

    Args:
        sio: Socket.IO server instance
        data: Group ID, forecast hours, and optional force_recalculate flag
        logger: Logger instance
        sid: Socket.IO session ID

    Returns:
        Dictionary with success status and next passes
    """
    group_id = data.get("group_id", None) if data else None
    if not isinstance(group_id, str) or not group_id:
        return {"success": False, "data": []}
    hours = data.get("hours", 2.0) if data else 2.0
    force_recalculate = data.get("force_recalculate", False) if data else False
    logger.info(
        f"Handling request from client_id={sid}, group_id={group_id}, hours={hours}, "
        f"force_recalculate={force_recalculate} (get_next_passes_for_group)"
    )
    next_passes = await fetch_next_events_for_group(
        group_id=group_id, hours=hours, force_recalculate=force_recalculate
    )
    return {
        "success": next_passes["success"],
        "data": next_passes.get("data", []),
        "cached": next_passes.get("cached", False),
        "forecast_hours": next_passes.get("forecast_hours", 4.0),
        "pass_range_start": next_passes.get("pass_range_start"),
        "pass_range_end": next_passes.get("pass_range_end"),
    }


def register_handlers(registry):
    """Register satellite group handlers with the command registry."""
    registry.register_batch(
        {
            "get-satellite-groups": (get_satellite_groups, "api_call"),
            "get-satellite-groups-user": (get_satellite_groups_user, "api_call"),
            "get-satellite-groups-system": (get_satellite_groups_system, "api_call"),
            "submit-satellite-group": (submit_satellite_group, "api_call"),
            "edit-satellite-group": (edit_satellite_group, "api_call"),
            "delete-satellite-group": (delete_satellite_group, "api_call"),
            "fetch-next-passes-for-group": (fetch_next_passes_for_group, "api_call"),
        }
    )
