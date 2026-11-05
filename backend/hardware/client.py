# Copyright (c) 2026 Efstratios Goudelis
# SPDX-License-Identifier: GPL-3.0-or-later
"""Tracker-side IPC adapters. Physical controllers live in device workers."""

import asyncio
import time
import uuid

from controllers.rotator import StopRejected, StopUnconfirmed


class HardwareClient:
    def __init__(self, connection):
        self.connection = connection
        self.lock = asyncio.Lock()

    async def request(self, kind, device_id, method, **payload):
        # One pipe belongs to one producer incarnation. Replies from an expired
        # request are drained by ID, never mistaken for a subsequent operation.
        async with self.lock:
            request_id = str(uuid.uuid4())
            deadline = time.time() + 40
            self.connection.send(
                dict(
                    request_id=request_id,
                    kind=kind,
                    device_id=str(device_id),
                    method=method,
                    deadline=deadline,
                    payload=payload,
                )
            )
            while time.time() < deadline:
                if self.connection.poll():
                    reply = self.connection.recv()
                    if reply.get("request_id") != request_id:
                        continue
                    if reply.get("error"):
                        error_type = {
                            "StopRejected": StopRejected,
                            "StopUnconfirmed": StopUnconfirmed,
                        }.get(reply.get("error_type"), RuntimeError)
                        raise error_type(reply["error"])
                    return reply.get("result")
                await asyncio.sleep(0.01)
            raise TimeoutError("Hardware service did not answer before the request deadline")


class DeviceProxy:
    def __init__(self, client, kind, device_id, details):
        self.client = client
        self.kind = kind
        self.device_id = str(device_id)
        self.details = details
        self.host = details["host"]
        self.port = details["port"]
        self.generation = None
        self.connected = False
        self.connection_state = {}
        self.disconnect_state = {}

    async def connect(self):
        result = await self.client.request(
            self.kind,
            self.device_id,
            "acquire",
            details=self.details,
        )
        self.generation = result["generation"]
        self.connection_state = result.get("data", {})
        self.connected = True
        return True

    async def call(self, method, **payload):
        return await self.client.request(
            self.kind,
            self.device_id,
            method,
            generation=self.generation,
            **payload,
        )

    async def disconnect(self):
        result = await self.call("disconnect")
        self.connected = False
        self.disconnect_state = result if isinstance(result, dict) else {}
        return True


class RotatorProxy(DeviceProxy):
    def __init__(self, client, device_id, details):
        super().__init__(client, "rotator", device_id, details)

    async def get_position(self):
        return tuple(await self.call("position"))

    async def set_position(self, az, el):
        yield tuple(await self.call("position", az=az, el=el))

    async def stop(self):
        return await self.call("stop")

    async def park(self, park_az=None, park_el=None):
        return await self.call("park", az=park_az, el=park_el)

    async def recover_position(self):
        return tuple(await self.call("recover"))


class RigProxy(DeviceProxy):
    def __init__(self, client, device_id, details):
        super().__init__(client, "rig", device_id, details)

    async def get_frequency(self):
        return await self.call("frequency")

    async def tune(self, state, data):
        # An entire VFO retune is one device transaction; ownership cannot change
        # between selecting a VFO, tuning it, and restoring the receive VFO.
        return await self.call("tune", state=state, data=data)
