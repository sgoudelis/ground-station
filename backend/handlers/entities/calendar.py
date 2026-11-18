# Copyright (c) 2026 Efstratios Goudelis
# SPDX-License-Identifier: GPL-3.0-or-later

"""Authenticated calendar queries through the shared command dispatcher."""

from typing import Any

from pydantic import ValidationError

from calendars.external import external_events
from calendars.schemas import CalendarRange
from calendars.service import calendar_events
from common.auth import AUTHENTICATED_SOCKET_ROOM
from db import AsyncSessionLocal
from handlers.routing.dispatcher import get_auth_context


async def get_calendar_events(sio: Any, data: Any, logger: Any, sid: str) -> dict[str, Any]:
    try:
        window = CalendarRange.model_validate(data)
    except ValidationError as exc:
        return {"success": False, "data": None, "error": exc.errors()[0]["msg"]}
    async with AsyncSessionLocal() as session:
        result = await calendar_events(session, window)
        announcements, status = await external_events.cached_events(session, window)
    result["events"].extend(announcements)
    result["sources"].append(status)
    return {"success": True, "data": result, "error": None}


async def update_external_events(sio: Any, data: Any, logger: Any, sid: str):
    context = get_auth_context() or {}
    try:
        status = await external_events.configure(data, actor=context.get("user_id"))
    except ValueError as exc:
        return {"success": False, "data": None, "error": str(exc)}
    await sio.emit("external-events-changed", {}, room=AUTHENTICATED_SOCKET_ROOM)
    return {"success": True, "data": status, "error": None}


def register_handlers(registry):
    registry.register(
        "get-calendar-events", get_calendar_events, "api_call", action="read", resource="calendar"
    )
    registry.register(
        "calendar.external.update",
        update_external_events,
        "api_call",
        action="write",
        resource="calendar",
    )
