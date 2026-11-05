# Copyright (c) 2026 Efstratios Goudelis
# SPDX-License-Identifier: GPL-3.0-or-later
"""Persistence and application integration for station-owned hardware."""

import asyncio
import logging

from sqlalchemy import select

import crud
from db import AsyncSessionLocal
from db.models import TrackingState
from hardware.service import hardware
from tracker.operations import operations
from tracker.runner import get_existing_tracker_manager, get_tracker_supervisor

logger = logging.getLogger("hardware-lifecycle")
_persistence_lock = asyncio.Lock()


async def persist_connection(kind, device_id, connected):
    # This namespace shares JSON storage, not satellite tracking validation.
    async with _persistence_lock, AsyncSessionLocal() as session:
        name = f"hardware:{kind}:{device_id}"
        row = await session.scalar(select(TrackingState).where(TrackingState.name == name))
        if row is None:
            session.add(TrackingState(name=name, value={"connected": connected}))
        else:
            row.value = {"connected": connected}
        await session.commit()


async def detach_producer(owner, kind, device_id):
    identity = hardware.owners.get(owner, {})
    if identity.get("type") not in {"tracker", "observation"}:
        return
    tracker_id = identity["id"]
    manager = get_existing_tracker_manager(tracker_id)
    if manager is None:
        return
    # Apply only the released device's fields. A rig release must not undo a
    # simultaneous rotator command, or detach a newly selected device.
    async with operations.lock:
        if hardware.owns(tracker_id, kind, device_id):
            return
        async with AsyncSessionLocal() as session:
            reply = await crud.trackingstate.get_tracking_state(
                session, name=manager.tracking_state_name
            )
            state = (reply.get("data") or {}).get("value") or {}
            if str(state.get(f"{kind}_id")) != device_id:
                return
            state = {**state, f"{kind}_state": "disconnected"}
            await crud.trackingstate.set_tracking_state(
                session,
                {
                    "name": manager.tracking_state_name,
                    "value": {f"{kind}_state": "disconnected"},
                },
            )
        manager.current_tracking_state = state
        manager._send_to_tracker("set_tracking_state", state)
        if kind == "rotator":
            get_tracker_supervisor()._release_rotator_ownership(tracker_id)
        observed = operations.observed.get(tracker_id)
        if observed:
            observed.setdefault("tracking_state", {})[f"{kind}_state"] = "disconnected"
            observed.setdefault(f"{kind}_data", {}).update(connected=False, tracking=False)


async def start_hardware(sio):
    hardware.epoch = operations.epoch
    hardware.on_snapshot = lambda snapshot: sio.emit("hardware-state", snapshot)
    hardware.on_release = detach_producer
    hardware.on_intent = persist_connection
    hardware.start()
    # Device connection intent is independent of targets. Restoring it does not
    # acquire control or replay a manual movement from the previous backend.
    async with AsyncSessionLocal() as session:
        rows = (
            (
                await session.execute(
                    select(TrackingState).where(TrackingState.name.like("hardware:%"))
                )
            )
            .scalars()
            .all()
        )
        for row in rows:
            if not (row.value or {}).get("connected"):
                continue
            _, kind, device_id = row.name.split(":", 2)
            fetch = crud.hardware.fetch_rotators if kind == "rotator" else crud.hardware.fetch_rigs
            reply = await fetch(session, **{f"{kind}_id": device_id})
            if not reply.get("success") or not reply.get("data"):
                continue
            try:
                owner = f"restore:{kind}:{device_id}"
                await hardware.call(kind, device_id, "acquire", owner=owner, details=reply["data"])
                await hardware.call(kind, device_id, "release")
            except Exception:
                logger.exception("Could not restore %s %s connection", kind, device_id)
