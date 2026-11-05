# Copyright (c) 2026 Efstratios Goudelis
# SPDX-License-Identifier: GPL-3.0-or-later
"""Device-scoped operator commands using the shared command registry."""

import asyncio
import math
import time

from controllers.rotator import StopUnconfirmed
from hardware.errors import ControlReleased
from hardware.service import hardware
from tracker.operations import operations, validate_external_request


class ControlChanged(RuntimeError):
    pass


async def submit_device_command(kind, device_id, action, details, request):
    if kind not in {"rotator", "rig"}:
        raise ValueError("Unknown device kind")
    actions = {"connect", "disconnect", "take-control", "release", "stop"}
    if kind == "rotator":
        actions.update({"move", "park", "unpark"})
    if action not in actions:
        raise ValueError("Unsupported device action")
    validate_external_request(request, operations.epoch)
    owner = f"manual:{kind}:{device_id}"
    existing = operations.existing(request.get("command_id"), owner)
    if existing:
        return existing
    hardware.owners[owner] = {"type": "manual", "id": owner}
    worker = hardware.devices.get((kind, device_id))
    snapshot = worker.snapshot if worker else {}
    expected = request.get("generation")
    if action != "stop" and expected != snapshot.get("generation"):
        raise ValueError("Device control changed; refresh before retrying")
    if action == "move":
        position = request.get("position") or {}
        az, el = position.get("az"), position.get("el")
        if not all(isinstance(v, (int, float)) and math.isfinite(v) for v in (az, el)):
            raise ValueError("Position must contain finite coordinates")
        if snapshot.get("data", {}).get("parked"):
            raise ValueError("Unpark the rotator before moving it")
    previous_owner = snapshot.get("owner")
    previous_identity = hardware.owners.get(previous_owner or "", {})
    if previous_identity.get("type") == "observation" and action not in {"stop", "disconnect"}:
        raise ValueError("Device is controlled by a scheduled observation")
    if hardware.reservations.get((kind, device_id)) and action not in {"stop", "disconnect"}:
        raise ValueError("Device is reserved by a scheduled observation")
    if (
        previous_owner
        and previous_owner != owner
        and action
        not in {
            "take-control",
            "stop",
            "disconnect",
        }
    ):
        raise ValueError("Take manual control before commanding this device")
    async with operations.lock:
        existing = operations.existing(request.get("command_id"), owner)
        if existing:
            return existing
        # Operator Stop/Disconnect may interrupt any producer. Acceptance alone
        # cannot cancel its work; wait for the worker to fence old writes.
        command = operations.accept(
            owner,
            {f"{kind}_id": device_id},
            {f"{kind}_id": device_id},
            {**request, "action": action},
            allow_handoff=action in {"take-control", "stop", "disconnect"},
            device_snapshot=snapshot,
        )
    hardware.spawn(
        execute_device_command(kind, device_id, action, details, owner, command, expected)
    )
    return command


async def wait_position(kind, device_id, generation, command, target=None):
    hits, sequence = 0, None
    while time.time() < command["deadline"]:
        worker = hardware.devices[(kind, device_id)]
        snapshot = worker.snapshot
        if snapshot.get("generation") != generation:
            raise ControlChanged("Device control changed before movement completed")
        data = snapshot.get("data", {})
        if data.get("position_sequence") != sequence:
            sequence = data.get("position_sequence")
            if data.get("error"):
                raise RuntimeError(data.get("error_message") or "Hardware communication failed")
            reached = data.get("stopped") and not data.get("motion_unconfirmed")
            if target:
                reached = all(
                    abs(float(data.get(axis, float("inf"))) - target[axis]) <= tolerance
                    for axis, tolerance in (
                        ("az", float(worker.details.get("aztolerance", 2))),
                        ("el", float(worker.details.get("eltolerance", 2))),
                    )
                )
            hits = hits + 1 if reached else 0
            if hits >= (2 if target else 1):
                return
        await asyncio.sleep(0.1)
    raise TimeoutError("Device did not confirm completion before its deadline")


async def execute_device_command(
    kind, device_id, action, details, owner, command, expected_generation
):
    operations.update(command["command_id"], "started")
    generation = None
    try:
        worker = hardware.devices.get((kind, device_id))
        if action != "stop":
            if action != "disconnect" and hardware.reservations.get((kind, device_id)):
                raise ControlChanged("A scheduled observation reserved this device")
            if worker and worker.snapshot.get("generation") != expected_generation:
                raise ControlChanged("Device control changed before execution")
        if action == "stop":
            if worker is None or not worker.snapshot.get("data", {}).get("connected"):
                raise ValueError("Device is disconnected")
            if kind == "rotator":
                await hardware.call(kind, device_id, "emergency_stop")
                generation = worker.snapshot["generation"]
                await wait_position(kind, device_id, generation, command)
            else:
                await hardware.release(kind, device_id)
        elif action == "release":
            await hardware.release(kind, device_id)
        elif action == "disconnect":
            # Disconnect is an operator override, including during observations.
            # Close the existing owner directly; acquisition/release would add a
            # handoff and could reopen a device whose motion is unconfirmed.
            if worker:
                current_owner = worker.snapshot.get("owner")
                if worker.process.is_alive():
                    await hardware.call(
                        kind,
                        device_id,
                        "disconnect",
                        owner=current_owner,
                        generation=expected_generation,
                        operator=True,
                    )
                    if current_owner and hardware.on_release:
                        await hardware.on_release(current_owner, kind, device_id)
                else:
                    await hardware.release(kind, device_id)
            if hardware.on_intent:
                await hardware.on_intent(kind, device_id, False)
        else:
            if action == "take-control":
                await hardware.release(kind, device_id)
                expected_generation = worker.snapshot.get("generation") if worker else None
            if worker and not worker.process.is_alive():
                # A replacement worker creates a new generation. Its predecessor's
                # lease cannot be used to connect the replacement runtime.
                expected_generation = None
            lease = await hardware.call(
                kind,
                device_id,
                "acquire",
                owner=owner,
                generation=expected_generation,
                details=details,
            )
            generation = lease["generation"]
            if action in {"connect", "take-control"}:
                if hardware.on_intent:
                    await hardware.on_intent(kind, device_id, True)
            elif action == "unpark":
                await hardware.call(
                    kind, device_id, "mode", owner=owner, generation=generation, mode="stopped"
                )
            elif action in {"move", "park"}:
                target = (
                    command.get("position")
                    if action == "move"
                    else {
                        "az": details.get("parkaz"),
                        "el": details.get("parkel"),
                    }
                )
                await hardware.call(
                    kind,
                    device_id,
                    "position" if action == "move" else "park",
                    owner=owner,
                    generation=generation,
                    manual=action == "move",
                    **target,
                )
                if target["az"] is not None:
                    await wait_position(kind, device_id, generation, command, target)
        for superseded in command.get("supersedes", []):
            operations.update(superseded, "cancelled", "Device control transferred or stopped")
        warning = (
            worker.snapshot.get("data", {}).get("stop_warning")
            if worker and action == "disconnect"
            else None
        )
        operations.update(command["command_id"], "succeeded", warning)
    except (ControlChanged, ControlReleased) as error:
        operations.update(command["command_id"], "cancelled", str(error))
    except TimeoutError as error:
        try:
            worker = hardware.devices.get((kind, device_id))
            if (
                action in {"move", "park"}
                and kind == "rotator"
                and worker
                and worker.snapshot.get("owner") == owner
                and worker.snapshot.get("generation") == generation
            ):
                await hardware.call(kind, device_id, "emergency_stop")
        finally:
            operations.update(command["command_id"], "unknown", str(error), reconciled=True)
    except StopUnconfirmed as error:
        operations.update(command["command_id"], "unknown", str(error), reconciled=True)
    except Exception as error:
        # A newer Stop/handoff may have already cancelled this command.
        operations.update(command["command_id"], "failed", str(error))
