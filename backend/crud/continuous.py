# Copyright (c) 2026 Efstratios Goudelis
# SPDX-License-Identifier: GPL-3.0-or-later

"""Persistence only: saving definitions never allocates receiver resources."""

from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID

from sqlalchemy import delete, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from common.continuous import Definition, UpdateDefinition, VersionedIdentity, normalize_vfo_mode
from db.models import ContinuousObservations, SDRs, SDRType


class DefinitionError(ValueError):
    def __init__(self, message: str, code: str = "validation") -> None:
        super().__init__(message)
        self.code = code


def _serialize(row: Any, receiver_name: str | None) -> dict[str, Any]:
    return {
        "id": row.id,
        "name": row.name,
        "auto_start": row.auto_start,
        "config_version": row.config_version,
        "sdr": {**row.sdr_config, "id": str(row.sdr_id), "name": receiver_name or ""},
        "vfos": [normalize_vfo_mode(vfo) for vfo in row.vfos],
        "created_at": row.created_at.isoformat(),
        "updated_at": row.updated_at.isoformat(),
    }


async def list_definitions(session: AsyncSession, identity: str | None = None) -> Any:
    query = select(ContinuousObservations, SDRs.name).outerjoin(
        SDRs, SDRs.id == ContinuousObservations.sdr_id
    )
    if identity is not None:
        query = query.where(ContinuousObservations.id == identity)
    rows = (
        await session.execute(
            query.order_by(ContinuousObservations.created_at, ContinuousObservations.id)
        )
    ).all()
    definitions = [_serialize(row, receiver_name) for row, receiver_name in rows]
    if identity is not None:
        if not definitions:
            raise DefinitionError("Continuous observation not found.", "not_found")
        return definitions[0]
    return definitions


async def _receiver(session: AsyncSession, definition: Definition) -> Any:
    receiver = await session.get(SDRs, UUID(definition.sdr.id))
    if receiver is None:
        raise DefinitionError("Select an existing receiver before saving.")
    if receiver.type == SDRType.SIGMFPLAYBACK:
        raise DefinitionError("Playback cannot be used for a continuous observation.")
    center = definition.sdr.center_frequency
    # Hardware tuning limits are configured in MHz; definitions store Hz.
    if (receiver.frequency_min is not None and center < receiver.frequency_min * 1_000_000) or (
        receiver.frequency_max is not None and center > receiver.frequency_max * 1_000_000
    ):
        raise DefinitionError("Center frequency is outside the receiver's tuning range.")
    # Native UHD isolates settings; Soapy and other drivers use the flat keys.
    settings = definition.sdr.sdr_settings
    bandwidth = (
        settings.uhd.bandwidth
        if receiver.type == SDRType.UHD and settings.uhd
        else (None if receiver.type == SDRType.UHD else settings.bandwidth)
    )
    capture = (
        min(definition.sdr.sample_rate, bandwidth)
        if isinstance(bandwidth, (int, float))
        else definition.sdr.sample_rate
    )
    for index, vfo in enumerate(definition.vfos, 1):
        if abs(vfo.frequency - center) + vfo.bandwidth / 2 > capture / 2:
            raise DefinitionError(f"VFO {index} extends outside the receiver bandwidth.")
    return receiver


def _values(definition: Definition) -> dict[str, Any]:
    config = definition.sdr.model_dump(mode="json", exclude={"id", "name"})
    config["sdr_settings"] = definition.sdr.sdr_settings.model_dump(exclude_unset=True)
    return {
        "name": definition.name,
        "auto_start": definition.auto_start,
        "sdr_id": UUID(definition.sdr.id),
        "sdr_config": config,
        "vfos": [vfo.model_dump(mode="json") for vfo in definition.vfos],
        "config_version": definition.config_version,
    }


def _same_definition(row: Any, values: dict[str, Any]) -> bool:
    # Legacy rows can still contain the inactive audio fallback. Treat the
    # equivalent exclusive representation as the same create/import retry.
    existing = {key: getattr(row, key) for key in values}
    existing["vfos"] = [normalize_vfo_mode(vfo) for vfo in row.vfos]
    return existing == values


async def create_definition(session: AsyncSession, definition: Definition) -> dict[str, Any]:
    receiver = await _receiver(session, definition)
    receiver_name = receiver.name
    values = _values(definition)
    existing = await session.get(ContinuousObservations, definition.id)
    # Client-generated IDs make retries and browser-draft import idempotent.
    # An existing, different definition is never silently overwritten.
    if existing is not None:
        if _same_definition(existing, values):
            return _serialize(existing, receiver_name)
        raise DefinitionError("A different definition already uses this ID.", "conflict")
    row = ContinuousObservations(id=definition.id, **values)
    session.add(row)
    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        existing = await session.get(ContinuousObservations, definition.id)
        if existing is not None and _same_definition(existing, values):
            return _serialize(existing, receiver_name)
        raise DefinitionError(
            "The definition could not be created; refresh and retry.", "conflict"
        ) from None
    return _serialize(row, receiver_name)


async def update_definition(session: AsyncSession, definition: UpdateDefinition) -> dict[str, Any]:
    receiver = await _receiver(session, definition)
    receiver_name = receiver.name
    expected = datetime.fromisoformat(definition.expected_updated_at)
    now = max(datetime.now(timezone.utc), expected + timedelta(microseconds=1))
    # Compare and update in one SQL statement so two editors cannot lose changes.
    row = await session.scalar(
        update(ContinuousObservations)
        .where(
            ContinuousObservations.id == definition.id,
            ContinuousObservations.updated_at == expected,
        )
        .values(**_values(definition), updated_at=now)
        .returning(ContinuousObservations)
        .execution_options(populate_existing=True)
    )
    if row is None:
        await session.rollback()
        raise DefinitionError(
            "This definition changed or was deleted. Reopen it before saving.", "conflict"
        )
    result = _serialize(row, receiver_name)
    await session.commit()
    return result


async def delete_definition(session: AsyncSession, identity: VersionedIdentity) -> dict[str, str]:
    removed = await session.scalar(
        delete(ContinuousObservations)
        .where(
            ContinuousObservations.id == identity.id,
            ContinuousObservations.updated_at
            == datetime.fromisoformat(identity.expected_updated_at),
        )
        .returning(ContinuousObservations.id)
    )
    if removed is None:
        await session.rollback()
        raise DefinitionError(
            "This definition changed or was deleted. Refresh before deleting.", "conflict"
        )
    await session.commit()
    return {"id": removed}
