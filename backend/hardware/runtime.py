# Copyright (c) 2026 Efstratios Goudelis
# SPDX-License-Identifier: GPL-3.0-or-later
"""One physical device, its transport, and its control generation."""

import asyncio
import math
import time
import uuid
from collections import deque
from types import SimpleNamespace
from typing import Any

from common.common import serialize_object
from controllers.rig import RigController
from controllers.rotator import RotatorController, StopRejected, StopUnconfirmed
from hardware.errors import ControlReleased
from hardware.rigcontrol import RigExecution


class DeviceRuntime:
    UPDATE_TIMEOUT = 15.0

    def __init__(self, kind, device_id, details, epoch, controller=None):
        self.kind, self.device_id = kind, str(device_id)
        self.details, self.epoch = dict(details), epoch
        self.controller: Any = controller
        self.owner: str | None = None
        # Remember deliberate releases so late requests detach quietly, even if
        # another owner has since taken control. Faults never enter this history.
        self.released_controls: deque[tuple[str | None, str]] = deque(maxlen=32)
        self.generation = str(uuid.uuid4())
        self.worker_generation = str(uuid.uuid4())
        self.started_at = time.time()
        self.sequence = 0
        self.lock = asyncio.Lock()
        self.last_update = time.monotonic()
        self.last_seen = time.monotonic()
        self.motion_revision = 0
        self._stationary: tuple[float, float] | None = None
        self._stationary_since = 0.0
        self._stationary_hits = 0
        self.target: tuple[float, float] | None = None
        self.park_target = False
        self.arrival_hits = 0
        self.data: dict[str, Any] = dict(
            connected=False,
            tracking=False,
            stopped=False,
            slewing=False,
            parked=False,
            motion_unconfirmed=bool(details.get("_motion_unconfirmed")),
            error=False,
            stop_supported=details.get("stop_supported", True),
            stop_warning=None,
        )
        self.rig_context = SimpleNamespace(
            rig_controller=None,
            rig_details=self.details,
            rig_data={},
            current_rig_state="tracking",
            input_hardware={},
        )
        self.rig_handler = RigExecution(self.rig_context)

    def snapshot(self):
        self.sequence += 1
        return dict(
            kind=self.kind,
            device_id=self.device_id,
            epoch=self.epoch,
            generation=self.generation,
            worker_generation=self.worker_generation,
            worker_started_at=self.started_at,
            sequence=self.sequence,
            observed_at=time.time(),
            owner=self.owner,
            # Orbit inputs can propagate NumPy scalars into position/status
            # fields. Both Socket.IO and REST need native JSON values here.
            data=serialize_object(self.data),
        )

    async def connect(self):
        if self.data["connected"] and not self.data["error"]:
            return
        if self.controller and self.data["error"]:
            await self.controller.close()
            self.controller = None
        if self.controller is None:
            factory = RotatorController if self.kind == "rotator" else RigController
            self.controller = factory(host=self.details["host"], port=self.details["port"])
        await self.controller.connect()
        self.data.update(connected=True, error=False, error_message=None)
        self.rig_context.rig_controller = self.controller
        await self.poll()

    def _check(self, request, *, owner=True):
        if request.get("epoch") != self.epoch:
            raise RuntimeError("Hardware service restarted; refresh device state")
        if time.time() > request.get("deadline", 0):
            raise RuntimeError("Hardware request expired before execution")
        if owner and (
            request.get("owner") != self.owner or request.get("generation") != self.generation
        ):
            if (request.get("owner"), request.get("generation")) in self.released_controls:
                raise ControlReleased(
                    "Device control changed; previous owner released control", kind=self.kind
                )
            raise RuntimeError("Device control changed; acquire control before retrying")
        if owner:
            self.last_seen = time.monotonic()

    def _fence(self):
        # A generation belongs to exactly one ownership interval. Even the same
        # producer reacquiring control cannot replay work from an earlier interval.
        self.generation = str(uuid.uuid4())
        self.motion_revision += 1
        self.data["tracking"] = False
        self.target = None
        # A new producer's first frequency must not wait for the old producer's
        # retune interval, which can be configured as long as a minute.
        self.rig_handler.last_vfo_update_time = 0.0

    def validate_position(self, az, el, manual=False):
        if not all(isinstance(v, (int, float)) and math.isfinite(v) for v in (az, el)):
            raise ValueError("Position must contain finite coordinates")
        maximum = float(self.details.get("maxaz", 360))
        if manual and self.details.get("azimuth_mode") == "0_450":
            maximum = min(maximum, 360)
        if not (
            float(self.details.get("minaz", 0)) <= az <= maximum
            and float(self.details.get("minel", 0)) <= el <= float(self.details.get("maxel", 90))
        ):
            raise ValueError("Position is outside the configured device limits")

    async def poll(self):
        if not self.data["connected"]:
            return
        try:
            await self._poll()
        except Exception as error:
            await self.transport_failed(error)
            raise

    async def transport_failed(self, error):
        # A failed read leaves protocol framing uncertain. Discard the stream
        # once, fence producer writes, and require an explicit reconnect.
        uncertain = self.kind == "rotator" and any(
            self.data.get(field)
            for field in ("tracking", "slewing", "park_requested", "motion_unconfirmed")
        )
        self._fence()
        self.owner = None
        self._stationary = None
        self.data.update(connected=False, error=True, error_message=str(error))
        if uncertain:
            self.data.update(motion_unconfirmed=True, stopped=False)
        if self.controller:
            await self.controller.close()

    async def _poll(self):
        if self.kind == "rig":
            self.data["frequency"] = await self.controller.get_frequency()
            return
        az, el = await self.controller.get_position()
        if self.details.get("azimuth_mode") == "0_450" and 0 <= az <= 360:
            candidates = [
                az + turn * 360
                for turn in (-1, 0, 1)
                if self.details.get("minaz", 0) <= az + turn * 360 <= self.details.get("maxaz", 450)
            ]
            reference = self.target[0] if self.target else self.data.get("az", az)
            if candidates:
                az = min(candidates, key=lambda value: abs(value - reference))
        self.data.update(
            az=az,
            el=el,
            position_sequence=self.data.get("position_sequence", 0) + 1,
            position_observed_at=time.time(),
        )
        if self.data["motion_unconfirmed"]:
            if (
                self._stationary is None
                or max(abs(az - self._stationary[0]), abs(el - self._stationary[1])) > 0.05
            ):
                self._stationary = (az, el)
                self._stationary_since = time.monotonic()
                self._stationary_hits = 1
            else:
                self._stationary_hits += 1
                if self._stationary_hits >= 3 and time.monotonic() - self._stationary_since >= 2:
                    self.data.update(motion_unconfirmed=False, stopped=True, slewing=False)
        if self.target and not self.data["motion_unconfirmed"]:
            az_tol = float(
                self.details.get("aztolerance", self.details.get("az_tolerance", 2)) or 2
            )
            el_tol = float(
                self.details.get("eltolerance", self.details.get("el_tolerance", 2)) or 2
            )
            reached = abs(az - self.target[0]) <= az_tol and abs(el - self.target[1]) <= el_tol
            self.arrival_hits = self.arrival_hits + 1 if reached else 0
            self.data.update(slewing=not reached, stopped=reached)
            if self.park_target:
                self.data["parked"] = self.arrival_hits >= 2

    async def stop(self):
        self.motion_revision += 1
        self.target = None
        self._stationary = None
        self.data.update(
            tracking=False,
            slewing=False,
            stopped=False,
            parked=False,
            park_requested=False,
            motion_unconfirmed=True,
            stop_warning=None,
        )
        if not self.details.get("stop_supported", True):
            self.data["stop_warning"] = "Controller Stop is unsupported; tracking updates paused"
            raise StopUnconfirmed(self.data["stop_warning"])
        try:
            if not await self.controller.stop():
                raise StopRejected("Rotator rejected Stop")
        except StopRejected as error:
            self.data["stop_warning"] = str(error)
            raise
        except Exception as error:
            self.data["stop_warning"] = f"Physical Stop is unconfirmed: {error}"
            # Never read position on a stream with an unanswered Stop reply.
            try:
                await self.controller.recover_position()
                self.data["connected"] = True
            except Exception as recovery_error:
                await self.transport_failed(recovery_error)
            raise StopUnconfirmed(f"Physical Stop is unconfirmed: {error}") from error

    async def disconnect(self):
        previous_control = (self.owner, self.generation)
        active = any(
            self.data.get(field)
            for field in ("tracking", "slewing", "park_requested", "motion_unconfirmed")
        )
        self._fence()
        if self.kind == "rotator" and active:
            # Closing the transport does not stop the mount's last movement.
            # Keep new motion barred until fresh readings confirm stationarity.
            self._stationary = None
            self.data.update(motion_unconfirmed=True, stopped=False)
            self.data["stop_warning"] = self.data.get("stop_warning") or (
                "Disconnected without issuing Stop; antenna motion is unconfirmed"
            )
        try:
            if self.controller:
                await self.controller.close()
        finally:
            self.owner = None
            self.data.update(
                connected=False,
                tracking=False,
                slewing=False,
                parked=False,
                park_requested=False,
                error=False,
                error_message=None,
            )
        if previous_control[0] is not None:
            self.released_controls.append(previous_control)
        return {
            key: self.data.get(key)
            for key in ("connected", "motion_unconfirmed", "stopped", "stop_warning")
        }

    async def quiesce(self):
        was_active = (
            self.data.get("tracking") or self.data.get("slewing") or self.data.get("park_requested")
        )
        self._fence()
        if (
            self.kind == "rotator"
            and self.data["connected"]
            and (was_active or self.data["motion_unconfirmed"])
        ):
            try:
                await self.stop()
            except (StopRejected, StopUnconfirmed):
                # Handoff may proceed once fresh telemetry proves stationarity,
                # including controllers whose firmware cannot execute Stop.
                if not self.data["connected"]:
                    raise
            deadline = time.monotonic() + 10
            while self.data["motion_unconfirmed"] and time.monotonic() < deadline:
                await self.poll()
                await asyncio.sleep(0.5)
            if self.data["motion_unconfirmed"]:
                raise StopUnconfirmed("Stationary motion could not be confirmed")

    async def execute(self, request):
        async with self.lock:
            self._check(request, owner=False)
            method = request["method"]
            payload = request.get("payload", {})
            if method == "acquire":
                if not request.get("owner"):
                    raise ValueError("A control owner is required")
                if request.get("generation") and request["generation"] != self.generation:
                    # A queued manual command cannot reacquire its old lease in
                    # the gap between release and the tracker's acquisition.
                    self._check(request)
                if self.owner is not None and self.owner != request["owner"]:
                    raise RuntimeError("Device is controlled by another owner")
                await self.connect()
                if self.owner != request["owner"]:
                    # Connecting must remain available while fresh readings establish
                    # stationarity. Position and park commands enforce the motion guard.
                    self._fence()
                    self.owner = request["owner"]
                # Acquisition proves the producer is alive. Give it a fresh timeout
                # before the watchdog can run ahead of its first position/tune request.
                self.last_update = self.last_seen = time.monotonic()
                return dict(generation=self.generation, data=self.data.copy())
            if method == "release":
                if request.get("generation") and request["generation"] != self.generation:
                    raise RuntimeError("Device control changed before handoff")
                # The supervisor uses release during handoff and worker death.
                # Fence first, even if Stop later fails, so old writes stay barred.
                previous_control = (self.owner, self.generation)
                try:
                    await self.quiesce()
                finally:
                    self.owner = None
                # Only a successful handoff is an expected release. Failed Stop,
                # transport errors, and watchdog expiry must remain real errors.
                if previous_control[0] is not None:
                    self.released_controls.append(previous_control)
                return True
            if method == "emergency_stop":
                previous_control = (self.owner, self.generation)
                self._fence()
                self.owner = None
                await self.stop()
                if previous_control[0] is not None:
                    self.released_controls.append(previous_control)
                return True
            if method == "disconnect" and (
                request.get("owner") != self.owner or request.get("generation") != self.generation
            ):
                if payload.get("operator"):
                    # Operator requests must report a race instead of claiming
                    # success while a new owner's socket remains connected.
                    raise RuntimeError("Device control changed before disconnect")
                # The old producer may acknowledge detachment after a handoff.
                # It must never close the new owner's persistent connection.
                return True
            self._check(request)
            if method == "heartbeat":
                self.last_update = time.monotonic()
                self.data["tracking"] = True
                return True
            if method == "configure":
                settings = payload["settings"]
                if not self.data["connected"] and any(
                    self.details.get(key) != settings.get(key, self.details.get(key))
                    for key in ("host", "port")
                ):
                    self.controller = None
                self.details.update(settings)
                self.data["stop_supported"] = self.details.get("stop_supported", True)
                self.rig_context.rig_details = self.details
                return True
            if method == "mode":
                self.data.update(
                    tracking=payload["mode"] == "tracking", parked=False, park_requested=False
                )
                self.last_update = time.monotonic()
                return True
            if method == "disconnect":
                return await self.disconnect()
            if not self.data["connected"]:
                raise RuntimeError("Device is disconnected")
            if method == "frequency":
                await self.poll()
                return self.data["frequency"]
            if method == "tune":
                self.last_update = time.monotonic()
                self.data["tracking"] = True
                state = payload["state"]
                self.rig_context.rig_data = dict(payload["data"])
                for field in ("transmitter_id", "vfo1", "vfo2", "rig_vfo"):
                    setattr(self.rig_context, f"current_{field}", state.get(field, "none"))
                await self.rig_handler.control_rig_frequency()
                self.data.update(
                    {
                        key: value
                        for key, value in self.rig_context.rig_data.items()
                        if key in {"vfo1", "vfo2", "active_tx_control_mode", "radio_mode"}
                    }
                )
                return dict(self.rig_context.rig_data)
            if method in {"position", "park"}:
                if payload.get("az") is not None:
                    if self.data["motion_unconfirmed"]:
                        raise StopUnconfirmed("Wait for stationary position readings")
                    az, el = payload["az"], payload["el"]
                    self.validate_position(az, el, payload.get("manual", False))
                    generator = self.controller.set_position(az, el)
                    try:
                        result = await anext(generator)
                    finally:
                        await generator.aclose()
                    self.motion_revision += 1
                    self.target = (az, el)
                    self.park_target = method == "park"
                    self.arrival_hits = 0
                    self.data.update(
                        slewing=bool(result[2]),
                        stopped=not result[2],
                        parked=False,
                        park_requested=False,
                    )
                    return True if method == "park" else result
                if method == "park":
                    if self.data["motion_unconfirmed"]:
                        raise StopUnconfirmed("Wait for stationary position readings")
                    result = await self.controller.park()
                    self.data.update(park_requested=bool(result), tracking=False)
                    return result
                await self.poll()
                return self.data["az"], self.data["el"]
            if method == "stop":
                await self.stop()
                self.last_update = time.monotonic()
                return True
            if method == "recover":
                result = await self.controller.recover_position()
                self.data["connected"] = True
                return result
            raise ValueError(f"Unsupported device operation: {method}")

    async def tick(self):
        async with self.lock:
            now = time.monotonic()
            expired_target = self.data["tracking"] and now - self.last_update > self.UPDATE_TIMEOUT
            lost_producer = (
                self.owner
                and self.owner.startswith("tracker:")
                and (now - self.last_seen > self.UPDATE_TIMEOUT)
            )
            if self.owner and (expired_target or lost_producer):
                try:
                    await self.quiesce()
                finally:
                    self.owner = None
            await self.poll()
