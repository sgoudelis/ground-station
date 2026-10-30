# Copyright (c) 2026 Efstratios Goudelis
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

"""Authenticated packet preview and reparsing commands for the telemetry viewer."""

import asyncio

from common import auth
from library.inventory import get_inventory, publish_ready_artifacts
from telemetry.reparse import preview_packet, reparse_packet, view_packet


async def preview_telemetry(_sio, data, logger, _sid):
    request = data if isinstance(data, dict) else {}
    url = request.get("url")
    if not isinstance(url, str) or not url:
        return {"success": False, "error": "Packet URL is required"}
    inventory = get_inventory()
    try:
        metadata = await asyncio.to_thread(preview_packet, inventory.roots.backend, url)
    except (OSError, ValueError) as exc:
        logger.warning("Could not preview packet: %s", exc)
        return {"success": False, "error": str(exc)}
    # Previewing must not rebuild the library or publish a file-change event.
    return {"success": True, "data": metadata}


async def view_telemetry(_sio, data, logger, _sid):
    request = data if isinstance(data, dict) else {}
    url = request.get("url")
    if not isinstance(url, str) or not url:
        return {"success": False, "error": "Packet URL is required"}
    try:
        metadata = await asyncio.to_thread(view_packet, get_inventory().roots.backend, url)
    except (OSError, ValueError) as exc:
        logger.warning("Could not read packet telemetry: %s", exc)
        return {"success": False, "error": str(exc)}
    return {"success": True, "data": metadata}


async def reparse_telemetry(sio, data, logger, _sid):
    request = data if isinstance(data, dict) else {}
    url = request.get("url")
    if not isinstance(url, str) or not url:
        return {"success": False, "error": "Packet URL is required"}
    inventory = get_inventory()
    try:
        metadata = await asyncio.to_thread(reparse_packet, inventory.roots.backend, url)
    except (OSError, ValueError) as exc:
        logger.warning("Could not reparse packet: %s", exc)
        return {"success": False, "error": str(exc)}
    revision = await asyncio.to_thread(inventory.rebuild)
    publish_ready_artifacts(inventory)
    await sio.emit(
        "library.changed",
        {"revision": revision, "changes": [{"operation": "reconciled", "id": "*"}]},
        room=auth.AUTHENTICATED_SOCKET_ROOM,
    )
    return {"success": True, "data": metadata}


def register_handlers(registry):
    registry.register_batch(
        {
            "filebrowser.preview-telemetry": (preview_telemetry, "api_call"),
            "filebrowser.view-telemetry": (view_telemetry, "api_call"),
            "filebrowser.reparse-telemetry": (reparse_telemetry, "api_call"),
        }
    )
