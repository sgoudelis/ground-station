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

"""Transmitter handlers."""

from typing import Any, Dict, Optional, Union, cast

import crud
from db import AsyncSessionLocal
from tracker.runner import get_all_tracker_managers


def _resolve_owner_from_payload(
    data: Optional[Dict[str, Any]]
) -> tuple[Optional[int], Optional[str]]:
    payload = data or {}
    norad_cat_id_raw = payload.get("norad_cat_id")
    if norad_cat_id_raw in (None, "", "-"):
        norad_cat_id_raw = payload.get("satelliteId")
    if norad_cat_id_raw in (None, "", "-"):
        norad_cat_id = None
    else:
        try:
            norad_cat_id = int(str(norad_cat_id_raw).strip())
        except (TypeError, ValueError):
            norad_cat_id = None

    target_key = crud.transmitters.normalize_target_key(payload.get("target_key"))
    return norad_cat_id, target_key


async def _fetch_transmitters_for_owner(
    dbsession: Any,
    *,
    norad_cat_id: Optional[int],
    target_key: Optional[str],
) -> Dict[str, Any]:
    if norad_cat_id:
        return cast(
            Dict[str, Any],
            await crud.transmitters.fetch_transmitters_for_satellite(dbsession, norad_cat_id),
        )
    if target_key:
        return cast(
            Dict[str, Any],
            await crud.transmitters.fetch_transmitters_for_target_key(dbsession, target_key),
        )
    return {"success": False, "data": [], "error": "transmitter owner is required"}


async def _notify_transmitters_changed(
    *,
    norad_cat_id: Optional[int],
    target_key: Optional[str],
) -> None:
    for manager in get_all_tracker_managers().values():
        if norad_cat_id:
            await manager.notify_transmitters_changed(norad_cat_id)
            continue
        if target_key:
            await manager.notify_non_satellite_transmitters_changed(target_key)


async def submit_transmitter(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Union[bool, list]]:
    """
    Add a new transmitter.

    Args:
        sio: Socket.IO server instance
        data: Transmitter details including norad_cat_id
        logger: Logger instance
        sid: Socket.IO session ID

    Returns:
        Dictionary with success status and updated transmitters for the satellite
    """
    async with AsyncSessionLocal() as dbsession:
        logger.debug(f"Adding transmitter, data: {data}")
        add_reply = await crud.transmitters.add_transmitter(dbsession, data)
        norad_cat_id, target_key = _resolve_owner_from_payload(data)
        if add_reply.get("success"):
            add_data = add_reply.get("data") or {}
            norad_cat_id = add_data.get("norad_cat_id", norad_cat_id)
            target_key = crud.transmitters.normalize_target_key(
                add_data.get("target_key") or target_key
            )

        if not norad_cat_id and not target_key:
            return {"success": add_reply.get("success", False), "data": []}

        transmitters = await _fetch_transmitters_for_owner(
            dbsession,
            norad_cat_id=norad_cat_id,
            target_key=target_key,
        )
        if transmitters.get("success"):
            await _notify_transmitters_changed(norad_cat_id=norad_cat_id, target_key=target_key)
        return {
            "success": (transmitters["success"] & add_reply["success"]),
            "data": transmitters.get("data", []),
        }


async def edit_transmitter(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Union[bool, list]]:
    """
    Edit an existing transmitter.

    Args:
        sio: Socket.IO server instance
        data: Transmitter ID and updated details
        logger: Logger instance
        sid: Socket.IO session ID

    Returns:
        Dictionary with success status and updated transmitters for the satellite
    """
    async with AsyncSessionLocal() as dbsession:
        logger.debug(f"Editing transmitter, data: {data}")
        transmitter_id = data.get("id") if data else None
        edit_reply = await crud.transmitters.edit_transmitter(dbsession, data)
        logger.info(edit_reply)
        norad_cat_id, target_key = _resolve_owner_from_payload(data)
        if edit_reply.get("success"):
            edit_data = edit_reply.get("data") or {}
            norad_cat_id = edit_data.get("norad_cat_id", norad_cat_id)
            target_key = crud.transmitters.normalize_target_key(
                edit_data.get("target_key") or target_key
            )
        if not norad_cat_id and not target_key and transmitter_id:
            fetch_reply = await crud.transmitters.fetch_transmitter(dbsession, transmitter_id)
            fetched = fetch_reply.get("data") or {}
            norad_cat_id = fetched.get("norad_cat_id")
            target_key = crud.transmitters.normalize_target_key(fetched.get("target_key"))
        transmitters = await _fetch_transmitters_for_owner(
            dbsession,
            norad_cat_id=norad_cat_id,
            target_key=target_key,
        )
        if transmitters.get("success"):
            await _notify_transmitters_changed(norad_cat_id=norad_cat_id, target_key=target_key)
        return {
            "success": (transmitters["success"] & edit_reply["success"]),
            "data": transmitters.get("data", []),
        }


async def delete_transmitter(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Union[bool, list]]:
    """
    Delete a transmitter.

    Args:
        sio: Socket.IO server instance
        data: Transmitter ID and norad_cat_id
        logger: Logger instance
        sid: Socket.IO session ID

    Returns:
        Dictionary with success status and updated transmitters for the satellite
    """
    async with AsyncSessionLocal() as dbsession:
        logger.debug(f"Deleting transmitter, data: {data}")
        transmitter_id = data.get("transmitter_id") if data else None
        norad_cat_id, target_key = _resolve_owner_from_payload(data)
        if transmitter_id and not norad_cat_id and not target_key:
            fetch_reply = await crud.transmitters.fetch_transmitter(dbsession, transmitter_id)
            fetch_data = fetch_reply.get("data") or {}
            norad_cat_id = fetch_data.get("norad_cat_id")
            target_key = crud.transmitters.normalize_target_key(fetch_data.get("target_key"))
        delete_reply = await crud.transmitters.delete_transmitter(dbsession, transmitter_id)
        transmitters = await _fetch_transmitters_for_owner(
            dbsession,
            norad_cat_id=norad_cat_id,
            target_key=target_key,
        )
        if transmitters.get("success"):
            await _notify_transmitters_changed(norad_cat_id=norad_cat_id, target_key=target_key)
        return {
            "success": (transmitters["success"] & delete_reply["success"]),
            "data": transmitters.get("data", []),
        }


async def get_transmitters(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Union[bool, list, str, None]]:
    """Fetch transmitters for either a satellite owner or a non-satellite target key."""
    norad_cat_id, target_key = _resolve_owner_from_payload(data)
    if not norad_cat_id and not target_key:
        return {"success": False, "data": [], "error": "transmitter owner is required"}

    async with AsyncSessionLocal() as dbsession:
        transmitters = await _fetch_transmitters_for_owner(
            dbsession,
            norad_cat_id=norad_cat_id,
            target_key=target_key,
        )

    return {
        "success": bool(transmitters.get("success")),
        "data": transmitters.get("data", []),
        "error": cast(Optional[str], transmitters.get("error")),
    }


def register_handlers(registry):
    """Register transmitter handlers with the command registry."""
    registry.register_batch(
        {
            "get-transmitters": (get_transmitters, "api_call"),
            "submit-transmitter": (submit_transmitter, "api_call"),
            "edit-transmitter": (edit_transmitter, "api_call"),
            "delete-transmitter": (delete_transmitter, "api_call"),
        }
    )
