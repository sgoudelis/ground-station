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

"""Socket commands for the filesystem-backed library inventory.

List and delete commands return normal RPC acknowledgements.  Broadcasts are
reserved for compact change notifications, so a browser never receives another
client's full library listing.  Purges stream progress events because deleting
multi-gigabyte sweeps outgrows a single request/response exchange.
"""

from __future__ import annotations

import asyncio
import time
from typing import Any, Dict, List, Optional

from common import auth as authsvc
from library.inventory import _parse_cutoff, get_inventory, publish_ready_artifacts
from library.search import normalize_search

# A purge executes in a worker thread inside this server process (the
# inventory is a process-local singleton, so child processes cannot use it).
# This guard keeps concurrent purge requests from racing each other.
_purge_state = {"running": False}
_purge_tasks: set = set()


async def _emit_changed(sio: Any, revision: int, changes: List[Dict[str, str]]) -> None:
    """Tell authenticated clients which stable library IDs changed."""
    await sio.emit(
        "library.changed",
        {"revision": revision, "changes": changes},
        room=authsvc.AUTHENTICATED_SOCKET_ROOM,
    )


async def query_library(_sio: Any, data: Optional[Dict], _logger: Any, _sid: str) -> Dict[str, Any]:
    """Return one compact server-side page from the rebuildable inventory."""
    request = data if isinstance(data, dict) else {}
    try:
        search = normalize_search(request.get("search"))
    except ValueError as exc:
        return {"success": False, "error": str(exc)}
    result = await asyncio.to_thread(
        get_inventory().query,
        request.get("filters"),
        request.get("sortBy", "created"),
        request.get("sortOrder", "desc"),
        request.get("page", 1),
        request.get("pageSize", 25),
        request.get("sessionId"),
        request.get("observationId"),
        search,
    )
    return {"success": True, "data": result}


async def get_library_item(
    _sio: Any, data: Optional[Dict], _logger: Any, _sid: str
) -> Dict[str, Any]:
    """Return expensive nested metadata for one explicitly opened item."""
    item_id = (data or {}).get("id")
    if not isinstance(item_id, str) or not item_id:
        return {"success": False, "error": "id is required"}
    item = await asyncio.to_thread(get_inventory().detail, item_id)
    if item is None:
        return {"success": False, "error": "Library item not found"}
    return {"success": True, "data": item}


async def reconcile_library(
    sio: Any, _data: Optional[Dict], _logger: Any, _sid: str
) -> Dict[str, Any]:
    """Rebuild the process-local inventory after an external storage change."""
    inventory = get_inventory()
    revision = await asyncio.to_thread(inventory.rebuild)
    publish_ready_artifacts(inventory)
    await _emit_changed(sio, revision, [{"operation": "reconciled", "id": "*"}])
    return {"success": True, "data": {"revision": revision}}


async def delete_library_items(
    sio: Any, data: Optional[Dict], _logger: Any, _sid: str
) -> Dict[str, Any]:
    """Delete one or more stable IDs and report success for every requested item."""
    request = data if isinstance(data, dict) else {}
    item_ids = request.get("ids")
    if (
        not isinstance(item_ids, list)
        or not item_ids
        or not all(isinstance(item_id, str) and item_id for item_id in item_ids)
    ):
        return {"success": False, "error": "ids must be a non-empty list of item IDs"}

    inventory = get_inventory()
    result = await asyncio.to_thread(inventory.delete, item_ids)
    publish_ready_artifacts(inventory)
    changes = [
        {"operation": "deleted", "id": entry["id"]}
        for entry in result["results"]
        if entry["success"]
    ]
    if changes:
        await _emit_changed(sio, result["revision"], changes)
    return {"success": True, "data": result}


async def purge_preview_library(
    _sio: Any, data: Optional[Dict], _logger: Any, _sid: str
) -> Dict[str, Any]:
    """Aggregate items older than a cutoff without deleting anything."""
    request = data if isinstance(data, dict) else {}
    cutoff = request.get("cutoff")
    if not isinstance(cutoff, str) or not cutoff:
        return {"success": False, "error": "cutoff must be an ISO datetime string"}
    try:
        result = await asyncio.to_thread(get_inventory().purge_preview, cutoff)
    except ValueError as exc:
        return {"success": False, "error": str(exc)}
    return {"success": True, "data": result}


async def purge_library(sio: Any, data: Optional[Dict], logger: Any, _sid: str) -> Dict[str, Any]:
    """Start a date-based purge; progress and completion stream via events.

    The RPC reply only confirms the job started.  ``library_purge_progress``
    events stream while the sweep runs and a single ``library_purge_done``
    event carries the terminal summary to every authenticated client.
    """
    request = data if isinstance(data, dict) else {}
    cutoff = request.get("cutoff")
    if not isinstance(cutoff, str) or not cutoff:
        return {"success": False, "error": "cutoff must be an ISO datetime string"}
    try:
        _parse_cutoff(cutoff)
    except ValueError as exc:
        return {"success": False, "error": str(exc)}
    if _purge_state["running"]:
        return {"success": False, "error": "A purge is already running"}
    _purge_state["running"] = True
    loop = asyncio.get_running_loop()

    last_emit = 0.0

    def on_progress(progress: Dict[str, Any]) -> None:
        """Forward worker-thread progress, throttled to keep the socket light."""
        nonlocal last_emit
        now = time.monotonic()
        final = progress["done"] >= progress["total"]
        if not final and now - last_emit < 0.1:
            return
        last_emit = now
        try:
            asyncio.run_coroutine_threadsafe(
                sio.emit(
                    "library_purge_progress",
                    {"phase": "running", **progress},
                    room=authsvc.AUTHENTICATED_SOCKET_ROOM,
                ),
                loop,
            )
        except RuntimeError:
            # Event loop already shutting down; progress is moot.
            pass

    async def run_purge() -> None:
        try:
            result = await asyncio.to_thread(get_inventory().purge, cutoff, on_progress)
            if result["deleted"]:
                await _emit_changed(
                    sio, result["revision"], [{"operation": "reconciled", "id": "*"}]
                )
            await sio.emit(
                "library_purge_done",
                {"phase": "done", "success": True, **result},
                room=authsvc.AUTHENTICATED_SOCKET_ROOM,
            )
        except Exception as exc:  # noqa: BLE001 - terminal failure must reach every client
            logger.exception("Library purge failed")
            await sio.emit(
                "library_purge_done",
                {"phase": "done", "success": False, "error": str(exc)},
                room=authsvc.AUTHENTICATED_SOCKET_ROOM,
            )
        finally:
            _purge_state["running"] = False

    task = asyncio.create_task(run_purge())
    _purge_tasks.add(task)
    task.add_done_callback(_purge_tasks.discard)
    return {"success": True, "data": {"started": True}}


def register_handlers(registry: Any) -> None:
    """Register the new inventory protocol under the File Browser namespace."""
    registry.register_batch(
        {
            "filebrowser.query": (query_library, "api_call"),
            "filebrowser.item": (get_library_item, "api_call"),
            "filebrowser.reconcile": (reconcile_library, "api_call"),
            "filebrowser.delete": (delete_library_items, "api_call"),
            "filebrowser.purge-preview": (purge_preview_library, "api_call"),
            "filebrowser.purge": (purge_library, "api_call"),
        }
    )
