# Copyright (c) 2026 Efstratios Goudelis
# SPDX-License-Identifier: GPL-3.0-or-later

"""Authenticated definitions and execution controls for continuous observations."""

from typing import Any

from pydantic import ValidationError

from common.continuous import Definition, Identity, StrictModel, UpdateDefinition, VersionedIdentity
from crud import continuous
from db import AsyncSessionLocal
from server import runtimestate


def _with_runtime(definition: dict[str, Any]) -> dict[str, Any]:
    runtime = runtimestate.continuous_observations
    return {**definition, "runtime": runtime.snapshot(definition["id"])} if runtime else definition


async def _request(
    sio: Any, data: Any, logger: Any, model: Any, operation: Any, *, changed: bool = False
) -> dict[str, Any]:
    try:
        payload = model.model_validate(data)
        async with AsyncSessionLocal() as session:
            result = await operation(session, payload)
    except ValidationError as exc:
        # Return field paths and readable messages, never echo the entire payload.
        errors = exc.errors(include_url=False, include_context=False, include_input=False)
        message = "; ".join(
            f"{'.'.join(str(part) for part in error['loc'])}: {error['msg']}"
            for error in errors[:5]
        )
        return {"success": False, "data": None, "error": message, "code": "validation"}
    except continuous.DefinitionError as exc:
        return {"success": False, "data": None, "error": str(exc), "code": exc.code}
    except Exception:
        logger.exception("Continuous observation persistence failed")
        return {
            "success": False,
            "data": None,
            "error": "Unable to access continuous observations.",
            "code": "storage",
        }
    if changed:
        # A committed write remains successful if notification delivery fails.
        # Reconnection/list reads reconcile clients with durable storage.
        try:
            await sio.emit("continuous-observations-changed", {"id": result["id"]})
        except Exception:
            logger.exception("Unable to broadcast continuous observation changes")
    return {"success": True, "data": result, "error": None}


async def list_definitions(sio: Any, data: Any, logger: Any, sid: str) -> dict[str, Any]:
    async def fetch(session: Any, payload: Any) -> Any:
        return [_with_runtime(entry) for entry in await continuous.list_definitions(session)]

    return await _request(sio, {} if data is None else data, logger, StrictModel, fetch)


async def get_definition(sio: Any, data: Any, logger: Any, sid: str) -> dict[str, Any]:
    async def fetch(session: Any, payload: Identity) -> Any:
        return _with_runtime(await continuous.list_definitions(session, payload.id))

    return await _request(sio, data, logger, Identity, fetch)


async def create_definition(sio: Any, data: Any, logger: Any, sid: str) -> dict[str, Any]:
    return await _request(sio, data, logger, Definition, continuous.create_definition, changed=True)


async def update_definition(sio: Any, data: Any, logger: Any, sid: str) -> dict[str, Any]:
    async def update(session: Any, payload: UpdateDefinition) -> Any:
        runtime = runtimestate.continuous_observations
        if runtime is None:
            return await continuous.update_definition(session, payload)
        async with runtime.lock(payload.id):
            if runtime.active(payload.id):
                saved = await continuous.list_definitions(session, payload.id)
                current = Definition.model_validate(
                    {key: saved[key] for key in Definition.model_fields}
                )
                # Name and the next-start preference are metadata. A running
                # receiver and its channels remain immutable until stopped.
                if (
                    current.sdr.model_dump(exclude={"name"})
                    != payload.sdr.model_dump(exclude={"name"})
                    or current.vfos != payload.vfos
                ):
                    raise continuous.DefinitionError(
                        "Stop the observation before editing its receiver or VFOs.", "conflict"
                    )
            return _with_runtime(await continuous.update_definition(session, payload))

    return await _request(sio, data, logger, UpdateDefinition, update, changed=True)


async def delete_definition(sio: Any, data: Any, logger: Any, sid: str) -> dict[str, Any]:
    async def delete(session: Any, payload: VersionedIdentity) -> Any:
        runtime = runtimestate.continuous_observations
        if runtime is None:
            return await continuous.delete_definition(session, payload)
        async with runtime.lock(payload.id):
            if runtime.active(payload.id):
                raise continuous.DefinitionError(
                    "Stop the observation before deleting its definition.", "conflict"
                )
            result = await continuous.delete_definition(session, payload)
            runtime.runs.pop(payload.id, None)
            return result

    return await _request(sio, data, logger, VersionedIdentity, delete, changed=True)


async def start_observation(sio: Any, data: Any, logger: Any, sid: str) -> dict[str, Any]:
    async def start(session: Any, payload: VersionedIdentity) -> Any:
        runtime = runtimestate.continuous_observations
        if runtime is None:
            raise continuous.DefinitionError(
                "Continuous observation execution is unavailable.", "unavailable"
            )
        try:
            return {
                "id": payload.id,
                "runtime": await runtime.start(payload.id, payload.expected_updated_at),
            }
        except continuous.DefinitionError:
            raise
        except Exception as error:
            raise continuous.DefinitionError(str(error), "runtime") from error

    return await _request(sio, data, logger, VersionedIdentity, start)


async def stop_observation(sio: Any, data: Any, logger: Any, sid: str) -> dict[str, Any]:
    async def stop(session: Any, payload: Identity) -> Any:
        await continuous.list_definitions(session, payload.id)
        runtime = runtimestate.continuous_observations
        if runtime is None:
            raise continuous.DefinitionError(
                "Continuous observation execution is unavailable.", "unavailable"
            )
        try:
            return {"id": payload.id, "runtime": await runtime.stop(payload.id)}
        except Exception as error:
            raise continuous.DefinitionError(str(error), "runtime") from error

    return await _request(sio, data, logger, Identity, stop)


def register_handlers(registry: Any) -> None:
    for action, handler in (
        ("list", list_definitions),
        ("get", get_definition),
        ("create", create_definition),
        ("update", update_definition),
        ("delete", delete_definition),
        ("start", start_observation),
        ("stop", stop_observation),
    ):
        registry.register(
            f"continuous-observations.{action}",
            handler,
            "api_call",
            action=action,
            resource="continuous_observations",
        )
