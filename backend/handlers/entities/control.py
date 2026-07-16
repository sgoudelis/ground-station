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

"""Control and maintenance handlers routed through the command registry."""

from __future__ import annotations

import os
import threading
import time
from typing import Any, Dict, Optional, cast

from db import AsyncSessionLocal
from handlers.entities.databasebackup import (
    backup_table,
    full_backup,
    full_restore,
    list_tables,
    restore_table,
)
from handlers.entities.transmitterimport import (
    import_gr_satellites_transmitters,
    import_satdump_transmitters,
)
from pipeline.orchestration.processmanager import process_manager
from server import runtimestate
from server.schedulerstate import get_orbital_sync_next_run_time
from server.shutdown import cleanup_everything
from tasks.registry import get_task
from tlesync.persist import save_orbital_sync_state
from tlesync.state import sync_state_manager

_ORBITAL_SYNC_TASK_PATTERNS = (
    "orbital data sync",
    "orbital_sync",
    "orbital-sync",
    "tle sync",
    "tle_sync",
)


def _is_orbital_sync_task(task: Dict[str, Any]) -> bool:
    """Identify orbital synchronization tasks from task manager metadata."""
    task_name = str(task.get("name", "")).lower()
    task_command = str(task.get("command", "")).lower()
    return any(
        pattern in task_name or pattern in task_command for pattern in _ORBITAL_SYNC_TASK_PATTERNS
    )


async def _stop_orbital_sync_before_restore(sio: Any, logger: Any) -> Dict[str, Any]:
    """
    Stop any running orbital sync before database restore mutates shared tables.

    Restores are destructive operations and must not race with orbital sync writes.
    """
    background_task_manager = runtimestate.background_task_manager
    if not background_task_manager:
        return {"success": False, "error": "Background task manager not initialized"}

    running_tasks = background_task_manager.get_running_tasks()
    orbital_tasks = [task for task in running_tasks if _is_orbital_sync_task(task)]
    if not orbital_tasks:
        return {"success": True, "stopped_task_ids": []}

    stopped_task_ids = []
    failed_task_ids = []
    for task in orbital_tasks:
        task_id = task.get("task_id")
        if not task_id:
            continue
        stopped = await background_task_manager.stop_task(task_id, timeout=10.0)
        if stopped:
            stopped_task_ids.append(task_id)
        else:
            failed_task_ids.append(task_id)

    if failed_task_ids:
        logger.error(
            "Failed to stop orbital sync task(s) before database restore: %s",
            ", ".join(failed_task_ids),
        )
        return {
            "success": False,
            "error": (
                "Failed to stop orbital sync before database restore. "
                f"Task IDs: {', '.join(failed_task_ids)}"
            ),
        }

    # Force sync state out of "inprogress" so UI reflects the cancellation.
    if stopped_task_ids:
        stopped_message = "Orbital synchronization stopped before database restore"
        current_state = dict(sync_state_manager.get_state() or {})
        errors = list(current_state.get("errors") or [])
        if stopped_message not in errors:
            errors.append(stopped_message)
        current_state.update(
            {
                "status": "complete",
                "progress": 100,
                "success": False,
                "message": stopped_message,
                "active_sources": [],
                "errors": errors,
            }
        )
        sync_state_manager.set_state(current_state)
        payload_state = dict(sync_state_manager.get_state() or {})
        payload_state["next_scheduled_sync_at"] = get_orbital_sync_next_run_time()
        await sio.emit("sat-sync-events", payload_state)
        try:
            async with AsyncSessionLocal() as dbsession:
                await save_orbital_sync_state(dbsession, sync_state_manager.get_state())
        except Exception:
            logger.exception("Failed to persist cancelled orbital sync state before restore")

    logger.info(
        "Stopped orbital sync task(s) before database restore: %s",
        ", ".join(stopped_task_ids) if stopped_task_ids else "none",
    )
    return {"success": True, "stopped_task_ids": stopped_task_ids}


def _typed_reply(reply: Any) -> Dict[str, Any]:
    """Normalize untyped helper responses to the registry reply contract."""
    return cast(Dict[str, Any], reply)


async def restart_service(sio: Any, data: Optional[Dict], logger: Any, sid: str) -> Dict[str, Any]:
    """Schedule a process restart after acknowledging the request."""
    logger.info(f"Service restart requested by client {sid}")

    def delayed_shutdown():
        # Delay allows Socket.IO to flush the success ack to the caller first.
        time.sleep(2)
        logger.info("Service restart requested via command API - initiating shutdown...")
        cleanup_everything()
        logger.info("Forcing container exit for restart...")
        os._exit(0)

    shutdown_thread = threading.Thread(target=delayed_shutdown, daemon=True)
    shutdown_thread.start()
    return {
        "success": True,
        "message": (
            "Service restart initiated. All processes will be stopped and container will restart "
            "in 2 seconds."
        ),
    }


async def start_monitoring(sio: Any, data: Optional[Dict], logger: Any, sid: str) -> Dict[str, Any]:
    """Enable performance monitoring on demand."""
    logger.info(f"Performance monitoring start requested by client {sid}")
    process_manager.performance_monitor.enable_monitoring()
    return {"success": True}


async def stop_monitoring(sio: Any, data: Optional[Dict], logger: Any, sid: str) -> Dict[str, Any]:
    """Disable performance monitoring on demand."""
    logger.info(f"Performance monitoring stop requested by client {sid}")
    process_manager.performance_monitor.disable_monitoring()
    return {"success": True}


async def backup_list_tables(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Any]:
    """List DB tables available for backup/export."""
    del sio, data, logger, sid
    return _typed_reply(await list_tables())


async def backup_table_dump(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Any]:
    """Export a single table as SQL INSERT statements."""
    del sio, logger, sid
    payload = data or {}
    table_name = payload.get("table")
    if not table_name:
        return {"success": False, "error": "Missing table parameter"}
    return _typed_reply(await backup_table(table_name))


async def backup_table_restore(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Any]:
    """Restore a single table from SQL INSERT statements."""
    del sid
    payload = data or {}
    table_name = payload.get("table")
    sql = payload.get("sql")
    delete_first = payload.get("delete_first", True)
    if not table_name or not sql:
        return {"success": False, "error": "Missing table or sql parameter"}
    stop_reply = await _stop_orbital_sync_before_restore(sio, logger)
    if not stop_reply.get("success"):
        return _typed_reply(stop_reply)
    return _typed_reply(await restore_table(table_name, sql, delete_first))


async def backup_full_dump(sio: Any, data: Optional[Dict], logger: Any, sid: str) -> Dict[str, Any]:
    """Export full database schema + content."""
    del sio, data, logger, sid
    return _typed_reply(await full_backup())


async def backup_full_restore(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Any]:
    """Restore full database from SQL script."""
    del sid
    payload = data or {}
    sql = payload.get("sql")
    drop_tables = payload.get("drop_tables", True)
    if not sql:
        return {"success": False, "error": "Missing sql parameter"}
    stop_reply = await _stop_orbital_sync_before_restore(sio, logger)
    if not stop_reply.get("success"):
        return _typed_reply(stop_reply)
    return _typed_reply(await full_restore(sql, drop_tables))


async def import_satdump(sio: Any, data: Optional[Dict], logger: Any, sid: str) -> Dict[str, Any]:
    """Import transmitters from SatDump satellite list."""
    del sio, data, logger, sid
    async with AsyncSessionLocal() as session:
        return _typed_reply(await import_satdump_transmitters(session=session))


async def import_grsatellites(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Any]:
    """Import transmitters from gr-satellites."""
    del sio, data, logger, sid
    async with AsyncSessionLocal() as session:
        return _typed_reply(await import_gr_satellites_transmitters(session=session))


async def background_task_start(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Any]:
    """Start a registered background task."""
    del sio, sid
    logger.info(f"Background task start request, data: {data}")
    if not runtimestate.background_task_manager:
        return {"success": False, "error": "Background task manager not initialized"}

    payload = data or {}
    task_name = payload.get("task_name")
    if not task_name:
        return {"success": False, "error": "Missing task_name parameter"}

    args = tuple(payload.get("args", []))
    kwargs = payload.get("kwargs", {})
    name = payload.get("name")
    task_id = payload.get("task_id")

    try:
        task_func = get_task(task_name)
    except KeyError:
        return {"success": False, "error": f"Unknown task: {task_name}"}

    task_id = await runtimestate.background_task_manager.start_task(
        func=task_func, args=args, kwargs=kwargs, name=name, task_id=task_id
    )
    return {"success": True, "task_id": task_id}


async def background_task_stop(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Any]:
    """Stop a running background task."""
    del sio, sid
    logger.info(f"Background task stop request, data: {data}")
    if not runtimestate.background_task_manager:
        return {"success": False, "error": "Background task manager not initialized"}

    payload = data or {}
    task_id = payload.get("task_id")
    timeout = payload.get("timeout", 5.0)
    if not task_id:
        return {"success": False, "error": "Missing task_id parameter"}

    stopped = await runtimestate.background_task_manager.stop_task(task_id, timeout=timeout)
    if stopped:
        return {"success": True, "task_id": task_id}
    return {"success": False, "error": "Task not found or already finished"}


async def background_task_get(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Any]:
    """Fetch details for a background task."""
    del sio, sid
    logger.debug(f"Background task get request, data: {data}")
    if not runtimestate.background_task_manager:
        return {"success": False, "error": "Background task manager not initialized"}

    payload = data or {}
    task_id = payload.get("task_id")
    if not task_id:
        return {"success": False, "error": "Missing task_id parameter"}

    task_info = runtimestate.background_task_manager.get_task(task_id)
    if task_info:
        return {"success": True, "task": task_info}
    return {"success": False, "error": "Task not found"}


async def background_task_list(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Any]:
    """List background tasks, optionally only running tasks."""
    del sio, sid
    logger.debug(f"Background task list request, data: {data}")
    if not runtimestate.background_task_manager:
        return {"success": False, "error": "Background task manager not initialized"}

    payload = data or {}
    only_running = payload.get("only_running", False)
    tasks = (
        runtimestate.background_task_manager.get_running_tasks()
        if only_running
        else runtimestate.background_task_manager.get_all_tasks()
    )
    return {"success": True, "tasks": tasks}


def register_handlers(registry):
    """Register control/maintenance handlers with the command registry."""
    registry.register_batch(
        {
            "service.restart_service": (restart_service, "api_call"),
            "monitoring.start": (start_monitoring, "api_call"),
            "monitoring.stop": (stop_monitoring, "api_call"),
            "database-backup.list_tables": (backup_list_tables, "api_call"),
            "database-backup.backup_table": (backup_table_dump, "api_call"),
            "database-backup.restore_table": (backup_table_restore, "api_call"),
            "database-backup.full_backup": (backup_full_dump, "api_call"),
            "database-backup.full_restore": (backup_full_restore, "api_call"),
            "transmitter-import.satdump": (import_satdump, "api_call"),
            "transmitter-import.gr-satellites": (import_grsatellites, "api_call"),
            "background-task.start": (background_task_start, "api_call"),
            "background-task.stop": (background_task_stop, "api_call"),
            "background-task.get": (background_task_get, "api_call"),
            "background-task.list": (background_task_list, "api_call"),
        }
    )
