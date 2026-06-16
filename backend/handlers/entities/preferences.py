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

"""Preference and map settings handlers."""

from typing import Any, Dict, Optional, Union

import crud
from db import AsyncSessionLocal
from handlers.entities.tracking import emit_tracker_data, emit_ui_tracker_values
from handlers.routing import get_auth_context
from tracker.runner import get_all_tracker_managers


def _current_user_id() -> Optional[str]:
    """Return authenticated user id from dispatcher context for user-scoped preference operations."""
    auth_context = get_auth_context() or {}
    user_id = str(auth_context.get("user_id") or "").strip()
    return user_id or None


async def fetch_preferences(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Union[bool, list, str]]:
    """
    Fetch user-scoped preferences for the authenticated session user.

    Args:
        sio: Socket.IO server instance
        data: Not used
        logger: Logger instance
        sid: Socket.IO session ID

    Returns:
        Dictionary with success status and preferences
    """
    async with AsyncSessionLocal() as dbsession:
        logger.debug("Fetching preferences")
        user_id = _current_user_id()
        if not user_id:
            return {"success": False, "data": [], "error": "Authentication required."}
        preferences = await crud.preferences.fetch_user_preferences(dbsession, user_id)
        return {
            "success": preferences["success"],
            "data": preferences.get("data", []),
            "error": preferences.get("error"),
        }


async def update_preferences(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Union[bool, list, str]]:
    """
    Update user-scoped preferences for the authenticated session user.

    Args:
        sio: Socket.IO server instance
        data: List of preference updates
        logger: Logger instance
        sid: Socket.IO session ID

    Returns:
        Dictionary with success status and updated preferences
    """
    async with AsyncSessionLocal() as dbsession:
        logger.debug(f"Updating preferences, data: {data}")
        if not data:
            return {"success": False, "data": [], "error": "No data provided"}

        user_id = _current_user_id()
        if not user_id:
            return {"success": False, "data": [], "error": "Authentication required."}

        update_reply = await crud.preferences.set_user_preferences(dbsession, user_id, list(data))
        return {
            "success": update_reply["success"],
            "data": update_reply.get("data", []),
            "error": update_reply.get("error"),
        }


async def fetch_system_preferences(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Union[bool, list, str]]:
    """
    Fetch global/system preferences.

    These keys are station-wide and are not tied to a specific user profile.
    """
    del sio, data, sid
    async with AsyncSessionLocal() as dbsession:
        logger.debug("Fetching system preferences")
        preferences = await crud.preferences.fetch_system_preferences(dbsession)
        return {
            "success": preferences["success"],
            "data": preferences.get("data", []),
            "error": preferences.get("error"),
        }


async def update_system_preferences(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Union[bool, list, str]]:
    """
    Update global/system preferences.

    Authorization for this command is enforced centrally in dispatcher/auth policy.
    """
    del sio, sid
    async with AsyncSessionLocal() as dbsession:
        logger.debug(f"Updating system preferences, data: {data}")
        if not data:
            return {"success": False, "data": [], "error": "No data provided"}

        update_reply = await crud.preferences.set_system_preferences(dbsession, list(data))
        return {
            "success": update_reply["success"],
            "data": update_reply.get("data", []),
            "error": update_reply.get("error"),
        }


async def get_map_settings(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Union[bool, list]]:
    """
    Fetch map settings.

    Args:
        sio: Socket.IO server instance
        data: Map name
        logger: Logger instance
        sid: Socket.IO session ID

    Returns:
        Dictionary with success status and map settings
    """
    async with AsyncSessionLocal() as dbsession:
        logger.debug(f"Fetching map settings, data: {data}")
        map_settings = await crud.preferences.get_map_settings(dbsession, name=data)
        return {"success": map_settings["success"], "data": map_settings.get("data", [])}


async def set_map_settings(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Union[bool, dict]]:
    """
    Update map settings and emit tracker data.

    Args:
        sio: Socket.IO server instance
        data: Map settings updates
        logger: Logger instance
        sid: Socket.IO session ID

    Returns:
        Dictionary with success status and updated map settings
    """
    async with AsyncSessionLocal() as dbsession:
        logger.debug(f"Updating map settings, data: {data}")
        map_settings_reply = await crud.preferences.set_map_settings(dbsession, data)
        if not map_settings_reply.get("success"):
            return {
                "success": False,
                "data": map_settings_reply.get("data"),
                "error": map_settings_reply.get("error"),
            }

        # Tracker/UI tracker updates are only relevant for target-map-settings.
        # Avoid unnecessary tracking-state DB load for unrelated map setting keys.
        if data and data.get("name") == "target-map-settings":
            managers = get_all_tracker_managers()
            for tracker_id, manager in managers.items():
                await emit_tracker_data(dbsession, sio, logger, tracker_id=tracker_id)
                await emit_ui_tracker_values(dbsession, sio, logger, tracker_id=tracker_id)
                manager.notify_map_settings_changed(data.get("value", {}))

        return {
            "success": True,
            "data": map_settings_reply.get("data"),
            "error": map_settings_reply.get("error"),
        }


def register_handlers(registry):
    """Register preference handlers with the command registry."""
    registry.register_batch(
        {
            "fetch-preferences": (fetch_preferences, "api_call"),
            "update-preferences": (update_preferences, "api_call"),
            "fetch-system-preferences": (fetch_system_preferences, "api_call"),
            "update-system-preferences": (update_system_preferences, "api_call"),
            "get-map-settings": (get_map_settings, "api_call"),
            "set-map-settings": (set_map_settings, "api_call"),
        }
    )
