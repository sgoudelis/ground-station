# Copyright (c) 2026 Efstratios Goudelis
# SPDX-License-Identifier: GPL-3.0-or-later
"""Station-owned hardware supervision and producer IPC routing."""

import asyncio
import copy
import logging
import multiprocessing
import os
import time
import uuid
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable

from hardware.errors import error_from_reply
from hardware.worker import device_process

logger = logging.getLogger("hardware-service")


@dataclass
class DeviceWorker:
    process: Any
    connection: Any
    details: dict
    pending: dict = field(default_factory=dict)
    snapshot: dict = field(default_factory=dict)


class HardwareSupervisor:
    def __init__(self):
        self.epoch = str(uuid.uuid4())
        self.devices: dict[tuple[str, str], DeviceWorker] = {}
        self.clients: dict[str, Any] = {}
        self.client_ends: dict[str, Any] = {}
        self.owners: dict[str, dict[str, str]] = {}
        self.tasks: set[asyncio.Task] = set()
        self.task: asyncio.Task | None = None
        self.on_snapshot: Callable[[dict], Awaitable[Any]] | None = None
        self.on_release: Callable[[str, str, str], Awaitable[Any]] | None = None
        self.on_intent: Callable[[str, str, bool], Awaitable[Any]] | None = None
        self.reservations: dict[tuple[str, str], dict[str, Any]] = {}

    def register_tracker(self, tracker_id):
        parent, child = multiprocessing.Pipe()
        owner = f"tracker:{tracker_id}:{uuid.uuid4()}"
        self.owners[owner] = {
            "type": "observation" if tracker_id.startswith("obs-") else "tracker",
            "id": tracker_id,
        }
        self.clients[owner] = parent
        self.client_ends[owner] = child
        return child

    def tracker_started(self, tracker_id):
        # The child inherited its endpoint at fork. Keeping the parent's copy
        # open would hide child exit and accumulate descriptors on each restart.
        for owner, connection in list(self.client_ends.items()):
            if self.owners[owner]["id"] == tracker_id:
                connection.close()
                self.client_ends.pop(owner)

    def unregister_tracker(self, tracker_id):
        self.tracker_started(tracker_id)
        for owner, connection in list(self.clients.items()):
            if self.owners[owner]["id"] == tracker_id:
                connection.close()
                self.clients.pop(owner)

    def start(self):
        if self.task is None or self.task.done():
            self.task = asyncio.create_task(self.run())

    def spawn(self, coroutine):
        task = asyncio.create_task(coroutine)
        self.tasks.add(task)

        def finished(completed):
            self.tasks.discard(completed)
            if not completed.cancelled() and (error := completed.exception()):
                logger.error(
                    "Hardware background task failed: %s",
                    error,
                    exc_info=(type(error), error, error.__traceback__),
                )

        task.add_done_callback(finished)
        return task

    @asynccontextmanager
    async def reserve(self, resources, observation_id):
        # Reservation is atomic on the backend loop; no hardware I/O happens
        # while deciding whether the complete device bundle is available.
        keys = [
            (kind, str(device_id))
            for kind, device_id in resources
            if device_id not in (None, "", "none")
        ]
        if any(key in self.reservations for key in keys):
            raise RuntimeError("An observation already reserved this hardware")
        reservation = {"observation_id": observation_id, "tracker_id": None}
        for key in keys:
            self.reservations[key] = reservation
        try:
            yield reservation
        finally:
            for key in keys:
                if self.reservations.get(key) is reservation:
                    self.reservations.pop(key)

    def snapshots(self):
        result = []
        for worker in self.devices.values():
            if worker.snapshot:
                snapshot = copy.deepcopy(worker.snapshot)
                snapshot["owner"] = self.owners.get(snapshot.get("owner") or "")
                result.append(snapshot)
        return result

    def owns(self, tracker_id, kind, device_id):
        worker = self.devices.get((kind, str(device_id)))
        if worker is None:
            return True  # No runtime exists in legacy/test snapshots.
        return self.owners.get(worker.snapshot.get("owner") or "", {}).get("id") == tracker_id

    def fence_tracker_snapshot(self, tracker_id, snapshot):
        """Keep queued producer telemetry from reclaiming a transferred device."""
        state = snapshot.get("tracking_state") or {}
        for kind in ("rotator", "rig"):
            device_id = state.get(f"{kind}_id")
            if device_id and not self.owns(tracker_id, kind, device_id):
                snapshot.setdefault(f"{kind}_data", {}).update(connected=False, tracking=False)
                state[f"{kind}_state"] = "disconnected"

    def _worker(self, kind, device_id, details=None):
        key = (kind, str(device_id))
        worker = self.devices.get(key)
        if worker and not worker.process.is_alive():
            if not details:
                raise RuntimeError("Device worker ended; reconnect the device")
            # Reconnection creates a fresh transport and generation. Physical
            # motion from a crashed worker remains uncertain until observed.
            data = worker.snapshot.get("data", {})
            details = {
                **details,
                "_motion_unconfirmed": kind == "rotator"
                and any(
                    data.get(field)
                    for field in ("tracking", "slewing", "motion_unconfirmed", "park_requested")
                ),
            }
            worker.process.join(timeout=0)
            worker.connection.close()
            self.devices.pop(key)
            worker = None
        if worker:
            if details and any(worker.details.get(k) != details.get(k) for k in ("host", "port")):
                raise ValueError("Device endpoint changed; disconnect before reconnecting")
            return worker
        if kind not in {"rotator", "rig"} or not details:
            raise ValueError("Device configuration is required")
        endpoint = (str(details["host"]).strip().lower(), int(details["port"]))
        for other in self.devices.values():
            if (str(other.details["host"]).strip().lower(), int(other.details["port"])) == endpoint:
                raise ValueError("This hardware endpoint already has a device runtime")
        parent, child = multiprocessing.Pipe()
        process = multiprocessing.Process(
            target=device_process,
            args=(child, kind, str(device_id), details, self.epoch, os.getpid()),
            name=f"Ground Station - {kind}[{device_id}]",
            daemon=True,
        )
        process.start()
        child.close()
        worker = DeviceWorker(process, parent, dict(details))
        self.devices[key] = worker
        return worker

    async def call(
        self,
        kind,
        device_id,
        method,
        *,
        owner=None,
        generation=None,
        deadline=None,
        details=None,
        **payload,
    ):
        self.start()
        worker = self._worker(kind, device_id, details)
        request_id = str(uuid.uuid4())
        future = asyncio.get_running_loop().create_future()
        worker.pending[request_id] = future
        worker.connection.send(
            dict(
                request_id=request_id,
                epoch=self.epoch,
                owner=owner,
                generation=generation,
                method=method,
                deadline=deadline or time.time() + 30,
                payload=payload,
            )
        )
        try:
            reply = await asyncio.wait_for(future, timeout=35)
            if reply.get("error"):
                raise error_from_reply(reply, kind)
            return reply.get("result")
        finally:
            worker.pending.pop(request_id, None)

    async def route(self, owner, connection, request):
        try:
            kind, device_id = request["kind"], request["device_id"]
            payload = dict(request.get("payload", {}))
            details = payload.pop("details", None)
            current = self.devices.get((kind, device_id))
            held_control = current and current.snapshot.get("owner") == owner
            if request["method"] == "acquire":
                if (
                    current
                    and current.snapshot.get("owner") != owner
                    and (
                        self.owners.get(current.snapshot.get("owner") or "", {}).get("id")
                        == self.owners[owner]["id"]
                    )
                ):
                    # A replacement tracker process cannot inherit the previous
                    # process's token, even when its logical tracker ID is reused.
                    await self.release(kind, device_id)
                reservation = self.reservations.get((kind, device_id))
                if reservation and reservation["tracker_id"] != self.owners[owner]["id"]:
                    raise RuntimeError("Device is reserved by a scheduled observation")
            result = await self.call(
                kind,
                device_id,
                request["method"],
                owner=owner,
                deadline=request["deadline"],
                details=details,
                **payload,
            )
            if (
                request["method"] == "acquire" or request["method"] == "disconnect" and held_control
            ) and self.on_intent:
                await self.on_intent(kind, device_id, request["method"] == "acquire")
            reply = {"result": result}
        except Exception as error:
            reply = {"error": str(error), "error_type": type(error).__name__}
        try:
            connection.send({"request_id": request["request_id"], **reply})
        except (BrokenPipeError, OSError):
            pass

    async def release(self, kind, device_id):
        worker = self.devices.get((kind, str(device_id)))
        if worker is None:
            return
        previous = worker.snapshot.get("owner")
        if worker.process.is_alive():
            await self.call(
                kind, device_id, "release", generation=worker.snapshot.get("generation")
            )
        else:
            # A dead worker cannot acknowledge release. Revoke its cached owner
            # so takeover can reconnect, retaining all evidence of possible motion.
            worker.snapshot.update(
                owner=None,
                generation=str(uuid.uuid4()),
                sequence=worker.snapshot.get("sequence", 0) + 1,
                observed_at=time.time(),
            )
            worker.snapshot.setdefault("data", {}).update(
                connected=False,
                error=True,
                error_message="Device worker exited; reconnect the device",
            )
            if self.on_snapshot and worker.snapshot.get("device_id"):
                public = copy.deepcopy(worker.snapshot)
                public["owner"] = None
                await self.on_snapshot(public)
        if previous and self.on_release:
            await self.on_release(previous, kind, str(device_id))

    async def release_tracker(self, tracker_id, kind=None, device_id=None):
        for (device_kind, identifier), worker in list(self.devices.items()):
            owner = self.owners.get(worker.snapshot.get("owner") or "", {})
            if (
                owner.get("id") == tracker_id
                and (kind is None or device_kind == kind)
                and (device_id is None or identifier == str(device_id))
            ):
                await self.release(device_kind, identifier)

    def validate_edit(self, kind, device_id, changes):
        worker = self.devices.get((kind, str(device_id)))
        if (
            worker
            and (worker.pending or worker.snapshot.get("data", {}).get("connected"))
            and any(
                key in changes and str(changes[key]) != str(worker.details.get(key))
                for key in ("host", "port")
            )
        ):
            raise ValueError("Disconnect the device before changing its endpoint")

    def validate_delete(self, kind, device_ids):
        for device_id in device_ids:
            worker = self.devices.get((kind, str(device_id)))
            if worker and (worker.pending or worker.snapshot.get("data", {}).get("connected")):
                raise ValueError("Disconnect the device before deleting it")

    async def configure(self, kind, device_id, details):
        worker = self.devices.get((kind, str(device_id)))
        if worker is None:
            return
        if details and not worker.process.is_alive():
            worker.details = dict(details)
            return
        if not details:
            # Deletion retires the runtime. Ordinary edits keep its motion guard,
            # including edits made after an unconfirmed Stop and Disconnect.
            worker.connection.send({"method": "shutdown"})
            await asyncio.to_thread(worker.process.join, 2)
            if worker.process.is_alive():
                worker.process.terminate()
                await asyncio.to_thread(worker.process.join, 1)
            worker.connection.close()
            self.devices.pop((kind, str(device_id)))
            return
        await self.call(
            kind,
            device_id,
            "configure",
            owner=worker.snapshot.get("owner"),
            generation=worker.snapshot.get("generation"),
            details=None,
            settings=details,
        )
        worker.details = dict(details)

    async def run(self):
        while True:
            for owner, connection in list(self.clients.items()):
                try:
                    while connection.poll():
                        self.spawn(self.route(owner, connection, connection.recv()))
                except (EOFError, OSError):
                    connection.close()
                    self.clients.pop(owner, None)
            for (kind, device_id), worker in list(self.devices.items()):
                try:
                    while worker.connection.poll():
                        reply = worker.connection.recv()
                        if "snapshot" in reply:
                            snapshot = reply["snapshot"]
                            previous_owner = worker.snapshot.get("owner")
                            worker.snapshot = snapshot
                            if self.on_snapshot:
                                public = copy.deepcopy(snapshot)
                                public["owner"] = self.owners.get(snapshot.get("owner") or "")
                                self.spawn(self.on_snapshot(public))
                            if previous_owner and not snapshot.get("owner") and self.on_release:
                                self.spawn(self.on_release(previous_owner, kind, device_id))
                        else:
                            future = worker.pending.get(reply.get("request_id"))
                            if future and not future.done():
                                future.set_result(reply)
                    if not worker.process.is_alive():
                        raise RuntimeError("Device worker exited; physical state is unconfirmed")
                except (EOFError, OSError, RuntimeError) as error:
                    for future in worker.pending.values():
                        if not future.done():
                            future.set_exception(RuntimeError(str(error)))
                    if worker.snapshot.get("data", {}).get("connected"):
                        worker.snapshot["data"].update(
                            connected=False, error=True, error_message=str(error)
                        )
                        worker.snapshot["sequence"] += 1
                        if self.on_snapshot:
                            public = copy.deepcopy(worker.snapshot)
                            public["owner"] = self.owners.get(public.get("owner") or "")
                            self.spawn(self.on_snapshot(public))
            await asyncio.sleep(0.01)

    async def shutdown(self):
        # Tracker producers must already be stopped before device teardown.
        for worker in self.devices.values():
            if worker.process.is_alive():
                worker.connection.send({"method": "shutdown"})
        for worker in self.devices.values():
            await asyncio.to_thread(worker.process.join, 12)
            if worker.process.is_alive():
                worker.process.terminate()
                await asyncio.to_thread(worker.process.join, 1)
            worker.connection.close()
        if self.task:
            self.task.cancel()
            await asyncio.gather(self.task, return_exceptions=True)
        for task in self.tasks:
            task.cancel()
        await asyncio.gather(*self.tasks, return_exceptions=True)
        for connection in self.clients.values():
            connection.close()
        for connection in self.client_ends.values():
            connection.close()
        self.devices.clear()
        self.clients.clear()
        self.client_ends.clear()
        self.tasks.clear()
        self.task = None


hardware = HardwareSupervisor()
