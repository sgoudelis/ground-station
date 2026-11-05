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

"""Tracker message handling for Socket.IO events."""

import asyncio
import logging
import math
import time
from typing import Any, Dict

from celestial.scene import build_observer_sky_bodies
from common.constants import SocketEvents
from common.events import public_events
from hardware.service import hardware
from tracker.context import OBSERVER_SKY_UPDATE, SATELLITE_TRACKING_CONTEXT, apply_context
from tracker.contracts import InvalidTrackerIdError, is_target_slot_id, require_tracker_id
from tracker.operations import operations
from tracker.runner import get_existing_tracker_manager, get_tracker_supervisor, queue_from_tracker
from vfos.updates import handle_vfo_updates_for_tracking

logger = logging.getLogger(__name__)

# Global storage for tracker stats (accessed by performance monitor)
tracker_stats: Dict[str, Any] = {}
_observer_bodies_cache: list[Dict[str, Any]] = []
_observer_bodies_cache_updated_at = 0.0
OBSERVER_BODIES_CACHE_SECONDS = 15.0
_target_visibility: dict[str, tuple[int, str, bool]] = {}


def _publish_target_visibility(tracker_id: str, data: Dict[str, Any]) -> None:
    """Emit horizon crossings from live target-slot telemetry only."""
    if not is_target_slot_id(tracker_id):
        return
    runtime = get_tracker_supervisor().get_runtime(tracker_id)
    pid = runtime.process.pid if runtime is not None else None
    if runtime is None or not runtime.process.is_alive() or pid is None:
        _target_visibility.pop(tracker_id, None)
        return
    state = data.get("tracking_state") or {}
    if state.get("target_type", "satellite") != "satellite":
        _target_visibility.pop(tracker_id, None)
        return
    norad_id = state.get("norad_id")
    if norad_id in (None, "", 0):
        _target_visibility.pop(tracker_id, None)
        return
    satellite_data = data.get("satellite_data") or {}
    try:
        elevation = float((satellite_data.get("position") or {})["el"])
    except (KeyError, TypeError, ValueError):
        return
    if not math.isfinite(elevation):
        return

    target_id = str(norad_id)
    current = (pid, target_id, elevation > 0.0)
    previous = _target_visibility.get(tracker_id)
    _target_visibility[tracker_id] = current
    # A slot first observed below the horizon has not crossed it yet.
    if previous is None or previous[:2] != current[:2]:
        if not current[2]:
            return
    elif previous[2] == current[2]:
        return
    name = str(
        (satellite_data.get("details") or {}).get("name") or state.get("target_name") or target_id
    )
    public_events.target_visibility_changed(tracker_id, target_id, name, elevation, current[2])


def _publish_hardware_changes(
    tracker_id: str, previous: Dict[str, Any], current: Dict[str, Any]
) -> None:
    """Report observed connections, ignoring repeated tracker snapshots."""
    previous_state = previous.get("tracking_state") or {}
    current_state = current.get("tracking_state") or {}
    for device in ("rotator", "rig"):
        current_data = current.get(f"{device}_data") or {}
        if "connected" not in current_data:
            continue
        previous_data = previous.get(f"{device}_data") or {}
        connected = bool(current_data["connected"])
        was_connected = bool(previous_data["connected"]) if "connected" in previous_data else None
        device_id = current_state.get(f"{device}_id")
        previous_device_id = previous_state.get(f"{device}_id")
        if was_connected is None and not connected:
            continue
        if was_connected == connected and (not connected or previous_device_id == device_id):
            continue
        public_events.tracker_hardware_changed(
            tracker_id,
            device,
            str(device_id) if device_id not in (None, "", "none") else None,
            connected,
            was_connected,
        )


def _snapshot_from_current_worker(tracker_id: str, snapshot: Dict[str, Any]) -> bool:
    """Reject queued telemetry from a worker replaced before its message was read."""
    worker_pid = snapshot.get("worker_pid")
    if worker_pid is None:
        # Older/test snapshots lack a PID; sequence and generation checks still apply.
        return True
    runtime = get_tracker_supervisor().get_runtime(tracker_id)
    return bool(runtime and runtime.process.is_alive() and runtime.process.pid == worker_pid)


async def get_live_observer_bodies() -> list[Dict[str, Any]]:
    """Cache the Sun briefly for occasional shared sky updates."""
    global _observer_bodies_cache, _observer_bodies_cache_updated_at

    now = time.monotonic()
    if (
        _observer_bodies_cache
        and now - _observer_bodies_cache_updated_at < OBSERVER_BODIES_CACHE_SECONDS
    ):
        return _observer_bodies_cache

    try:
        _observer_bodies_cache = await build_observer_sky_bodies(
            data={"past_hours": 0, "future_hours": 1, "step_minutes": 60},
            logger=logger,
        )
        _observer_bodies_cache_updated_at = now
    except Exception as exc:  # pragma: no cover - observer context must not block tracking updates
        logger.warning("Unable to calculate live observer bodies: %s", exc)
    return _observer_bodies_cache


async def handle_tracker_messages(sockio):
    """
    Continuously checks for messages from the tracker process.

    Processes messages from the tracker queue and emits them as Socket.IO events.
    Also handles VFO updates for SDR tracking when satellite-tracking events are received.

    Args:
        sockio: Socket.IO server instance for emitting events
    """
    last_hardware_reconcile = time.monotonic()
    last_observer_broadcast = 0.0
    while True:
        try:
            if time.monotonic() - last_hardware_reconcile >= 0.5:
                is_alive = get_tracker_supervisor().is_alive
                public_events.reconcile_rotator_workers(is_alive)
                public_events.reconcile_rig_workers(is_alive)
                last_hardware_reconcile = time.monotonic()
            processed = False
            if queue_from_tracker is not None and not queue_from_tracker.empty():
                message = queue_from_tracker.get_nowait()
                processed = True
                msg_type = message.get("type")
                event = message.get("event")
                data = message.get("data", {})
                if not isinstance(data, dict):
                    data = {}

                # Handle stats messages
                if msg_type == "stats":
                    try:
                        tracker_id = require_tracker_id(message.get("tracker_id"))
                    except InvalidTrackerIdError:
                        logger.debug("Dropping stats message without tracker_id")
                        await asyncio.sleep(0)
                        continue
                    tracker_stats[tracker_id] = message.get("stats", {})
                elif event:
                    try:
                        tracker_id = require_tracker_id(
                            message.get("tracker_id") or data.get("tracker_id")
                        )
                    except InvalidTrackerIdError:
                        logger.debug("Dropping tracker event '%s' without tracker_id", event)
                        await asyncio.sleep(0)
                        continue
                    data["tracker_id"] = tracker_id
                    # A queued tracker snapshot cannot reclaim hardware after
                    # its lease was transferred to a manual or scheduled owner.
                    state = data.get("tracking_state") or {}
                    for kind in ("rotator", "rig"):
                        if state.get(f"{kind}_id") and not hardware.owns(
                            tracker_id, kind, state[f"{kind}_id"]
                        ):
                            data.setdefault(f"{kind}_data", {}).update(
                                connected=False, tracking=False
                            )
                            state[f"{kind}_state"] = "disconnected"
                    if event in {SATELLITE_TRACKING_CONTEXT, SocketEvents.SATELLITE_TRACKING}:
                        if not _snapshot_from_current_worker(tracker_id, data):
                            continue
                    if event == SocketEvents.TRACKER_COMMAND_STATUS:
                        record = operations.existing(data.get("command_id"), tracker_id)
                        if record and record.get("epoch") == data.get("epoch") == operations.epoch:
                            if record.get("worker_generation") and record[
                                "worker_generation"
                            ] != data.get("worker_generation"):
                                continue
                            if data.get("worker_generation") and not record.get(
                                "worker_generation"
                            ):
                                operations.records[data["command_id"]]["worker_generation"] = data[
                                    "worker_generation"
                                ]
                            snapshot = data.get("snapshot")
                            if snapshot:
                                if not _snapshot_from_current_worker(tracker_id, snapshot):
                                    continue
                                # A result from a replaced worker cannot rewrite
                                # desired state before observation ordering runs.
                                if not operations.can_observe(snapshot):
                                    continue
                                manager = get_existing_tracker_manager(tracker_id)
                                if manager and record["status"] not in {
                                    "succeeded",
                                    "failed",
                                    "cancelled",
                                }:
                                    await manager.reconcile_operation(record, snapshot)
                                previous = operations.observed.get(tracker_id, {})
                                operations.observe(snapshot)
                                if manager is not None:
                                    _publish_hardware_changes(tracker_id, previous, snapshot)
                                    public_events.observe_rotator(tracker_id, snapshot)
                                    public_events.observe_rig(tracker_id, snapshot)
                            operations.update(
                                data["command_id"],
                                data["status"],
                                data.get("reason"),
                                snapshot,
                                reconciled=data.get("reconciled"),
                            )
                        continue
                    if event == "tracker-hardware-state":
                        async with operations.lock:
                            manager = get_existing_tracker_manager(tracker_id)
                            if manager is None:
                                # A removed worker can leave telemetry in the shared queue.
                                # Do not let that late snapshot reserve its former hardware.
                                operations.forget_tracker(tracker_id)
                                continue
                            if not operations.can_observe(data):
                                continue
                            if not _snapshot_from_current_worker(tracker_id, data):
                                continue
                            if manager.current_tracking_state:
                                data["desired_state"] = dict(manager.current_tracking_state)
                            previous = operations.observed.get(tracker_id, {})
                            operations.observe(data)
                            _publish_hardware_changes(tracker_id, previous, data)
                            public_events.observe_rotator(tracker_id, data)
                            public_events.observe_rig(tracker_id, data)
                    if event == SATELLITE_TRACKING_CONTEXT:
                        # Retain the complete context for a page opened after the
                        # worker's initial or most recent partial update.
                        if apply_context(data) is None:
                            continue
                    if event == SocketEvents.SATELLITE_TRACKING:
                        _publish_target_visibility(tracker_id, data)
                        now = time.monotonic()
                        if now - last_observer_broadcast >= OBSERVER_BODIES_CACHE_SECONDS:
                            last_observer_broadcast = now
                            observer_bodies = await get_live_observer_bodies()
                            if observer_bodies:
                                await sockio.emit(
                                    OBSERVER_SKY_UPDATE, {"observer_bodies": observer_bodies}
                                )
                    await sockio.emit(event, data)

                    # Handle VFO updates for SDR tracking
                    if event == "satellite-tracking" and data.get("rig_data"):
                        await handle_vfo_updates_for_tracking(sockio, data)

            await asyncio.sleep(0 if processed else 0.05)
        except Exception as e:  # pragma: no cover - best effort
            logger.error(f"Error handling tracker messages: {e}")
            await asyncio.sleep(1)


async def handle_command_updates(sockio):
    """Deadlines and command broadcasts must not wait for sky/VFO processing."""
    while True:
        try:
            # Deadlines do not depend on the worker producing another update.
            for expired in operations.expire():
                manager = get_existing_tracker_manager(expired["tracker_id"])
                if manager:
                    manager._send_to_tracker(
                        "cancel_operation", {"command_id": expired["command_id"]}
                    )
            while operations.outbox:
                await sockio.emit(SocketEvents.TRACKER_COMMAND_STATUS, operations.outbox.pop(0))
        except Exception:
            logger.exception("Failed publishing tracker command status")
        await asyncio.sleep(0.1)
