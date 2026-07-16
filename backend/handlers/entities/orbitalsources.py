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

"""Orbital source handlers."""

from typing import Any, Dict, Optional, Union

from crud import orbitalsources as orbital_sources_crud
from db import AsyncSessionLocal
from server.schedulerstate import get_orbital_sync_next_run_time
from tlesync.persist import load_orbital_sync_state, should_hydrate_orbital_sync_state
from tlesync.state import sync_state_manager


async def get_orbital_sources(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Union[bool, list]]:
    """Get all orbital sources."""
    async with AsyncSessionLocal() as dbsession:
        logger.debug("Getting orbital sources")
        orbital_sources = await orbital_sources_crud.fetch_orbital_source(dbsession)
        return {"success": orbital_sources["success"], "data": orbital_sources.get("data", [])}


async def submit_orbital_source(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Union[bool, list]]:
    """Add a new orbital source."""
    async with AsyncSessionLocal() as dbsession:
        logger.debug(f"Adding orbital source, data: {data}")
        submit_reply = await orbital_sources_crud.add_orbital_source(dbsession, data)

        orbital_sources = await orbital_sources_crud.fetch_orbital_source(dbsession)
        return {
            "success": (orbital_sources["success"] & submit_reply["success"]),
            "data": orbital_sources.get("data", []),
        }


async def edit_orbital_source(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Union[bool, list, str]]:
    """Edit an existing orbital source."""
    async with AsyncSessionLocal() as dbsession:
        logger.debug(f"Editing orbital source, data: {data}")
        if not data or "id" not in data:
            return {"success": False, "data": [], "error": "Missing orbital source ID"}

        edit_reply = await orbital_sources_crud.edit_orbital_source(dbsession, data["id"], data)

        orbital_sources = await orbital_sources_crud.fetch_orbital_source(dbsession)
        return {
            "success": (orbital_sources["success"] & edit_reply["success"]),
            "data": orbital_sources.get("data", []),
        }


async def delete_orbital_sources(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Union[bool, list, dict, str]]:
    """Delete orbital sources."""
    async with AsyncSessionLocal() as dbsession:
        logger.debug(f"Deleting orbital source, data: {data}")
        delete_reply = await orbital_sources_crud.delete_orbital_sources(dbsession, data)

        orbital_sources = await orbital_sources_crud.fetch_orbital_source(dbsession)
        return {
            "success": (orbital_sources["success"] & delete_reply["success"]),
            "data": orbital_sources.get("data", []),
            "summary": delete_reply.get("deletion_summary", None),
            "message": delete_reply.get("data", None),
        }


async def fetch_sync_state(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Union[bool, dict]]:
    """Get orbital synchronization state."""
    del sio, data, sid
    logger.debug("Getting orbital synchronization state")

    runtime_state = sync_state_manager.get_state()
    if should_hydrate_orbital_sync_state(runtime_state):
        try:
            async with AsyncSessionLocal() as dbsession:
                persisted_state = await load_orbital_sync_state(dbsession)
            if persisted_state:
                sync_state_manager.set_state(persisted_state, touch_timestamp=False)
                runtime_state = sync_state_manager.get_state()
        except Exception:
            logger.exception("Failed to hydrate orbital sync state from tracking_state")

    # Scheduler metadata is runtime-derived and should not be persisted in tracking_state.
    # We attach it only to outgoing payloads for UI display.
    payload_state = dict(runtime_state or {})
    payload_state["next_scheduled_sync_at"] = get_orbital_sync_next_run_time()
    return {"success": True, "data": payload_state}


def register_handlers(registry):
    """Register orbital source handlers with command aliases for compatibility."""
    registry.register_batch(
        {
            # New command names.
            "get-orbital-sources": (get_orbital_sources, "api_call"),
            "submit-orbital-sources": (submit_orbital_source, "api_call"),
            "edit-orbital-source": (edit_orbital_source, "api_call"),
            "delete-orbital-sources": (delete_orbital_sources, "api_call"),
            # Legacy command aliases.
            "get-tle-sources": (get_orbital_sources, "api_call"),
            "submit-tle-sources": (submit_orbital_source, "api_call"),
            "edit-tle-source": (edit_orbital_source, "api_call"),
            "delete-tle-sources": (delete_orbital_sources, "api_call"),
            "fetch-sync-state": (fetch_sync_state, "api_call"),
        }
    )
