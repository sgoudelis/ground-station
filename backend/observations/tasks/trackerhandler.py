# Copyright (c) 2025 Efstratios Goudelis
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
# General Public License for more details.
#
# You should have received a copy of the GNU General Public License
# along with this program. If not, see <https://www.gnu.org/licenses/>.

"""Temporary tracker and hardware lifecycle for automated observations."""

import asyncio
import time
from typing import Any, Dict, List, Optional

from common.logger import logger
from crud import trackingstate as trackingstate_crud
from crud import transmitters as transmitters_crud
from db import AsyncSessionLocal
from hardware.service import hardware
from tracker.contracts import get_tracking_state_name
from tracker.instances import emit_tracker_instances
from tracker.operations import TERMINAL, operations
from tracker.runner import (
    create_observation_tracker_slot,
    get_all_tracker_managers,
    get_assigned_tracker_for_rotator,
    get_tracker_manager,
    remove_tracker_instance,
)
from tracker.stateupdate import update_tracking_state_with_ownership

# Serialize observation handoffs. Worker status messages still run while this lock
# is held, so producer detachment can be confirmed before ownership moves.
_handoff_lock = asyncio.Lock()
COMMAND_TIMEOUT_SECONDS = 35
ROTATOR_SETTLE_TIMEOUT_SECONDS = 120


class TrackerHandoffError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


class TrackerHandler:
    """Owns the pass-scoped OBS slot and its optional rotator and rig."""

    def __init__(self, sio: Optional[Any] = None):
        self.sio = sio

    async def _emit_tracker_instances_snapshot(self) -> None:
        if self.sio is not None:
            try:
                await emit_tracker_instances(self.sio)
            except Exception as exc:
                logger.warning("Failed to emit tracker instance snapshot: %s", exc)

    @staticmethod
    def _extract_transmitter_id(tasks: List[Dict[str, Any]]) -> str:
        for task in tasks:
            if task.get("type") == "decoder":
                return str(task.get("config", {}).get("transmitter_id") or "none")
        return "none"

    @staticmethod
    def _assigned(value: Any) -> bool:
        return value is not None and str(value).strip().lower() not in {"", "none"}

    @staticmethod
    async def _rig_transmitter_exists(norad_id: Any, transmitter_id: Any) -> bool:
        async with AsyncSessionLocal() as dbsession:
            reply = await transmitters_crud.fetch_transmitters_for_satellite(
                dbsession, norad_id=norad_id
            )
        return bool(
            reply.get("success")
            and any(
                str(item.get("id")) == str(transmitter_id)
                and float(item.get("downlink_low") or 0) > 0
                for item in reply.get("data") or []
            )
        )

    async def _update_and_confirm(
        self,
        tracker_id: str,
        value: Dict[str, Any],
        observation_id: str,
        *,
        timeout: float = COMMAND_TIMEOUT_SECONDS,
    ) -> None:
        deadline = time.monotonic() + timeout
        while True:
            reply = await update_tracking_state_with_ownership(
                tracker_id=tracker_id,
                value=value,
                requester_sid=f"observation:{observation_id}",
                # An explicit operation confirms a Disconnect even when the desired
                # state already says disconnected but hardware telemetry disagrees.
                operation={"action": "configure"},
            )
            if reply.get("success"):
                break
            error = str(reply.get("error") or "tracker_update_failed")
            if (
                "command is already in progress" not in error.lower()
                or time.monotonic() >= deadline
            ):
                raise TrackerHandoffError(error, str(reply.get("message") or error))
            await asyncio.sleep(0.1)
        result = reply.get("result") or {}
        command_id = result.get("command_id") or result.get("command", {}).get("command_id")
        if not command_id:
            raise TrackerHandoffError("missing_command", "Tracker update returned no command ID")

        while time.monotonic() < deadline:
            async with operations.lock:
                command = operations.existing(command_id, tracker_id)
            if command and command.get("status") in TERMINAL:
                if command["status"] == "succeeded":
                    return
                raise TrackerHandoffError(
                    "hardware_command_failed",
                    f"Tracker {tracker_id} command {command_id} {command['status']}: "
                    f"{command.get('reason') or 'no reason reported'}",
                )
            if command and command.get("status") == "unknown":
                raise TrackerHandoffError(
                    "hardware_command_unknown",
                    f"Tracker {tracker_id} command outcome is unknown: {command.get('reason')}",
                )
            await asyncio.sleep(0.1)
        raise TrackerHandoffError(
            "hardware_command_timeout",
            f"Timed out waiting for tracker {tracker_id} to confirm {value}",
        )

    async def _disconnect_slot_hardware(
        self, tracker_id: str, observation_id: str, *, rotator: bool, rig: bool
    ) -> None:
        manager = get_tracker_manager(tracker_id)
        state = await manager.get_tracking_state() or {}
        # Disconnect first, then clear each assignment. Changing an ID in the
        # same update as its state is rejected by TrackerManager.
        if rig and self._assigned(state.get("rig_id")):
            await hardware.release_tracker(tracker_id, "rig", state["rig_id"])
            await self._update_and_confirm(
                tracker_id, {"rig_state": "disconnected"}, observation_id
            )
            await self._update_and_confirm(
                tracker_id, {"rig_id": "none", "rig_vfo": "none"}, observation_id
            )
        if rotator and self._assigned(state.get("rotator_id")):
            # OBS cleanup settles the mount before closing it. Ownership handoffs
            # already quiesce hardware in _release_existing_hardware.
            await self._update_and_confirm(
                tracker_id, {"rotator_state": "disconnected"}, observation_id
            )
            await self._update_and_confirm(tracker_id, {"rotator_id": "none"}, observation_id)

    async def _release_existing_hardware(
        self,
        observation_id: str,
        rotator_id: Any,
        rig_id: Any,
        *,
        deadline: Optional[float] = None,
    ) -> None:
        slots: Dict[str, Dict[str, bool]] = {}
        rotator_owner = (
            get_assigned_tracker_for_rotator(rotator_id) if self._assigned(rotator_id) else None
        )
        if rotator_owner:
            # Any rig on the rotator's old slot also belongs to that interactive
            # setup; release it before transferring the rotator to OBS.
            slots[str(rotator_owner)] = {"rotator": True, "rig": True}

        # Manual takeover clears the rotator map but leaves the old slot's
        # selected device ID intact. Inspect states for both kinds of hardware.
        managers = get_all_tracker_managers()
        for tracker_id, manager in list(managers.items()):
            state = await manager.get_tracking_state() or {}
            if self._assigned(rotator_id) and str(state.get("rotator_id")) == str(rotator_id):
                flags = slots.setdefault(tracker_id, {})
                flags["rotator"] = True
                # An already detached rotator reference does not make this
                # slot's independently controlled rig part of the handoff.
                if state.get("rotator_state", "disconnected") != "disconnected":
                    flags["rig"] = True
            if self._assigned(rig_id) and str(state.get("rig_id")) == str(rig_id):
                slots.setdefault(tracker_id, {})["rig"] = True

        # The station owns physical connections. Its owner can exist even when
        # the tracker assignment map is empty; check the whole bundle first.
        for kind, identifier in (("rotator", rotator_id), ("rig", rig_id)):
            worker = hardware.devices.get((kind, str(identifier)))
            identity = hardware.owners.get(worker.snapshot.get("owner") or "", {}) if worker else {}
            if identity.get("type") == "observation":
                raise TrackerHandoffError(
                    f"{kind}_in_use",
                    f"{kind.title()} is in use by observation slot {identity['id']}",
                )
            owner_id = identity.get("id")
            if identity.get("type") == "tracker" and owner_id in managers:
                flags = slots.setdefault(owner_id, {})
                flags[kind] = True
                if kind == "rotator":
                    flags["rig"] = True

        for tracker_id, flags in slots.items():
            if tracker_id.startswith("obs-"):
                kind = "rotator" if flags.get("rotator") else "rig"
                raise TrackerHandoffError(
                    f"{kind}_in_use", f"{kind.title()} is in use by observation slot {tracker_id}"
                )

        # Fence the actual owners before clearing any stale slot references.
        # Release keeps the transport open and confirms rotator quiescence.
        for kind, identifier in (("rotator", rotator_id), ("rig", rig_id)):
            worker = hardware.devices.get((kind, str(identifier)))
            if worker and (
                worker.snapshot.get("owner")
                or kind == "rotator"
                and worker.snapshot.get("data", {}).get("motion_unconfirmed")
            ):
                await hardware.release(
                    kind,
                    identifier,
                    deadline=deadline,
                    stationary_timeout=(
                        ROTATOR_SETTLE_TIMEOUT_SECONDS if kind == "rotator" else None
                    ),
                )
        for tracker_id, flags in slots.items():
            await self._disconnect_slot_hardware(
                tracker_id,
                observation_id,
                rotator=flags.get("rotator", False),
                rig=flags.get("rig", False),
            )

    async def _remove_observation_tracker_instance(self, tracker_id: str) -> bool:
        try:
            # Removal flushes the worker queue; its consumer needs operations.lock.
            remove_result = await asyncio.to_thread(remove_tracker_instance, tracker_id)
            if not remove_result.get("success"):
                logger.warning(
                    "Failed to remove observation tracker %s: %s", tracker_id, remove_result
                )
                return False
            async with operations.lock:
                operations.forget_tracker(tracker_id)
            async with AsyncSessionLocal() as dbsession:
                reply = await trackingstate_crud.delete_tracking_state(
                    dbsession, get_tracking_state_name(tracker_id)
                )
            if not reply.get("success"):
                logger.warning(
                    "Failed to delete observation tracker state %s: %s", tracker_id, reply
                )
                return False
            await self._emit_tracker_instances_snapshot()
            return True
        except Exception:
            logger.exception("Error removing observation tracker %s", tracker_id)
            return False

    async def start_tracker_task(
        self,
        observation_id: str,
        satellite: Dict[str, Any],
        rotator_config: Dict[str, Any],
        tasks: List[Dict[str, Any]],
        rig_config: Optional[Dict[str, Any]] = None,
        *,
        handoff_deadline: Optional[float] = None,
    ) -> Dict[str, Any]:
        """Release interactive hardware, then create and configure a new OBS slot."""
        rig_config = rig_config or {}
        rotator_id = rotator_config.get("id")
        rig_id = rig_config.get("id")
        transmitter_id = (
            rig_config.get("transmitter_id")
            if self._assigned(rig_id)
            else self._extract_transmitter_id(tasks)
        )
        tracker_id = ""
        if not satellite.get("norad_id"):
            return {
                "success": False,
                "error": "missing_target",
                "message": "Observation has no target NORAD ID",
            }
        if self._assigned(rig_id) and not self._assigned(transmitter_id):
            return {
                "success": False,
                "error": "missing_rig_transmitter",
                "message": "Select a transmitter when using an observation rig",
            }
        if self._assigned(rig_id) and not await self._rig_transmitter_exists(
            satellite["norad_id"], transmitter_id
        ):
            return {
                "success": False,
                "error": "invalid_rig_transmitter",
                "message": "The selected rig transmitter has no downlink frequency for this satellite",
            }

        async with _handoff_lock, hardware.reserve(
            [("rotator", rotator_id), ("rig", rig_id)], observation_id
        ) as reservation:
            try:
                await self._release_existing_hardware(
                    observation_id, rotator_id, rig_id, deadline=handoff_deadline
                )
                # A long slew must not create an OBS slot after its stop job ran.
                if handoff_deadline is not None and time.time() >= handoff_deadline:
                    raise TrackerHandoffError(
                        "hardware_handoff_timeout",
                        "Observation ended before hardware handoff finished",
                    )
                resolution = create_observation_tracker_slot(observation_id)
                if not resolution.get("success"):
                    raise TrackerHandoffError(
                        str(resolution.get("error") or "slot_creation_failed"),
                        str(resolution.get("message") or "Could not create OBS slot"),
                    )
                tracker_id = str(resolution["tracker_id"])
                reservation["tracker_id"] = tracker_id
                get_tracker_manager(tracker_id)
                await self._update_and_confirm(
                    tracker_id,
                    {
                        "target_type": "satellite",
                        "target_name": str(satellite.get("name") or satellite["norad_id"]),
                        "norad_id": satellite["norad_id"],
                        "group_id": satellite.get("group_id"),
                        "command": None,
                        "body_id": None,
                        "rotator_state": (
                            "tracking"
                            if self._assigned(rotator_id) and rotator_config.get("tracking_enabled")
                            else "disconnected"
                        ),
                        "rotator_id": rotator_id if self._assigned(rotator_id) else "none",
                        "rig_state": "tracking" if self._assigned(rig_id) else "disconnected",
                        "rig_id": rig_id if self._assigned(rig_id) else "none",
                        "transmitter_id": str(transmitter_id or "none"),
                        "rig_vfo": "none",
                        "vfo1": "uplink",
                        "vfo2": "downlink",
                    },
                    observation_id,
                )
                await self._emit_tracker_instances_snapshot()
                logger.info(
                    "Started observation %s in temporary tracker %s", observation_id, tracker_id
                )
                return {
                    "success": True,
                    "tracker_id": tracker_id,
                    "created": True,
                    "reused_existing": False,
                    "ephemeral": True,
                }
            except Exception as exc:
                logger.exception("Failed to start tracker for observation %s", observation_id)
                if tracker_id:
                    cleaned = await self._stop_observation_slot(observation_id, tracker_id)
                    if not cleaned:
                        logger.error(
                            "Observation %s left tracker %s for manual cleanup",
                            observation_id,
                            tracker_id,
                        )
                return {
                    "success": False,
                    "error": (
                        exc.code if isinstance(exc, TrackerHandoffError) else "tracker_start_failed"
                    ),
                    "message": str(exc),
                }

    async def _wait_rotator_stationary(self, tracker_id: str, rotator_id: str) -> None:
        worker = hardware.devices.get(("rotator", str(rotator_id)))
        if worker is None:
            return  # Legacy/test trackers do not have a station-owned runtime.
        generation = worker.snapshot.get("generation")
        deadline = time.monotonic() + ROTATOR_SETTLE_TIMEOUT_SECONDS
        logger.info("Waiting for rotator %s to settle before cleanup of %s", rotator_id, tracker_id)
        while True:
            snapshot = worker.snapshot
            owner = hardware.owners.get(snapshot.get("owner") or "", {})
            if (
                hardware.devices.get(("rotator", str(rotator_id))) is not worker
                or not worker.process.is_alive()
                or snapshot.get("generation") != generation
                or owner.get("id") != tracker_id
            ):
                raise TrackerHandoffError(
                    "rotator_control_changed", "Rotator control changed during observation cleanup"
                )
            data = snapshot.get("data", {})
            if not data.get("connected") or data.get("error"):
                raise TrackerHandoffError(
                    "rotator_telemetry_failed",
                    data.get("error_message") or "Rotator disconnected before motion was confirmed",
                )
            if data.get("stopped") and not any(
                data.get(field)
                for field in ("tracking", "slewing", "motion_unconfirmed", "park_requested")
            ):
                logger.info("Rotator %s confirmed stationary before disconnect", rotator_id)
                return
            if time.monotonic() >= deadline:
                raise TrackerHandoffError(
                    "rotator_settle_timeout", "Rotator stationary motion could not be confirmed"
                )
            await asyncio.sleep(0.1)

    async def _stop_observation_slot(
        self, observation_id: str, tracker_id: str, *, park_rotator: bool = False
    ) -> bool:
        try:
            state = await get_tracker_manager(tracker_id).get_tracking_state() or {}
            rotator_id = state.get("rotator_id")
            if self._assigned(rotator_id) and state.get("rotator_state") != "disconnected":
                rotator_id = str(rotator_id)
                parked = False
                if park_rotator:
                    try:
                        await self._update_and_confirm(
                            tracker_id,
                            {"rotator_state": "parked"},
                            observation_id,
                            timeout=ROTATOR_SETTLE_TIMEOUT_SECONDS,
                        )
                        # Native Hamlib K acknowledges dispatch, not arrival.
                        # Keep polling until the physical mount has settled.
                        await self._wait_rotator_stationary(tracker_id, rotator_id)
                        parked = True
                    except Exception:
                        logger.exception(
                            "Could not confirm rotator parking for observation %s; trying Stop",
                            observation_id,
                        )
                if not parked:
                    try:
                        # Stop also pauses the producer and cancels queued moves.
                        await self._update_and_confirm(
                            tracker_id, {"rotator_state": "stopped"}, observation_id
                        )
                    except TrackerHandoffError as exc:
                        # Unsupported/rejected Stop may still finish its last slew.
                        # Telemetry, rather than the command result, decides safety.
                        logger.warning(
                            "Rotator Stop was not confirmed for observation %s; "
                            "waiting for stationary readings: %s",
                            observation_id,
                            exc,
                        )
                    await self._wait_rotator_stationary(tracker_id, rotator_id)
            await self._disconnect_slot_hardware(tracker_id, observation_id, rotator=True, rig=True)
        except Exception:
            logger.exception(
                "Could not confirm hardware disconnect for observation %s", observation_id
            )
            # Keep the worker and state available for a retry; removing it while
            # connected would lose the only handle on the hardware.
            return False
        return await self._remove_observation_tracker_instance(tracker_id)

    async def stop_tracker_task(
        self,
        observation_id: str,
        rotator_config: Dict[str, Any],
        tracker_context: Optional[Dict[str, Any]] = None,
    ) -> bool:
        """Settle and disconnect OBS hardware, clear assignments, and remove the OBS slot."""
        context = tracker_context or {}
        tracker_id = str(context.get("tracker_id") or "").strip()
        if not tracker_id:
            # A restored process has already dropped pass-scoped tracker rows.
            return True
        if not tracker_id.startswith("obs-"):
            logger.warning("Refusing to remove non-observation tracker %s", tracker_id)
            return False
        async with _handoff_lock:
            return await self._stop_observation_slot(
                observation_id,
                tracker_id,
                park_rotator=bool(rotator_config.get("park_after_observation")),
            )
