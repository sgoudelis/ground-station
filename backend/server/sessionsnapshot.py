"""
Background task to emit session runtime snapshots over Socket.IO.

This module follows the same startup task pattern as systeminfo.py: expose a
single `start_session_runtime_emitter(sio, background_tasks)` function that
registers an asyncio.Task into the provided `background_tasks` set.
"""

import asyncio
from typing import Set

from common import auth as authsvc
from common.logger import logger
from pipeline.orchestration.processmanager import process_manager
from session.service import session_service
from session.tracker import session_tracker


def start_session_runtime_emitter(sio, background_tasks: Set[asyncio.Task]) -> asyncio.Task:
    """Start the session runtime snapshot emitter loop and register it in background_tasks.

    Emits 'session-runtime-snapshot' every 1 second to authenticated clients only.
    """

    async def _session_snapshot_loop():
        interval = 1.0  # Emit every 1 second for real-time monitoring

        while True:
            try:
                # Build snapshot using SessionService if available, else fallback to tracker.
                snapshot = None
                try:
                    snapshot = session_service.get_runtime_snapshot()
                except Exception as exc:
                    logger.debug(f"SessionService unavailable, using tracker fallback: {exc}")
                    try:
                        snapshot = session_tracker.get_runtime_snapshot(process_manager)
                    except Exception as fallback_exc:
                        logger.debug(f"Tracker fallback also failed: {fallback_exc}")

                # Emit snapshot to authenticated sockets only.
                if snapshot is not None:
                    await sio.emit(
                        "session-runtime-snapshot",
                        snapshot,
                        room=authsvc.AUTHENTICATED_SOCKET_ROOM,
                    )

                await asyncio.sleep(interval)
            except asyncio.CancelledError:
                break
            except Exception as exc:
                logger.error(f"Session runtime snapshot emitter error: {exc}")
                await asyncio.sleep(interval)

    task = asyncio.create_task(_session_snapshot_loop())
    background_tasks.add(task)
    logger.info("Session runtime snapshot emitter task started (1s interval)")
    return task
