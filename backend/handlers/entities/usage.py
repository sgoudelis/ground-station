# Copyright (c) 2026 Efstratios Goudelis. SPDX-License-Identifier: GPL-3.0-or-later
"""Administrator-only activity sharing settings."""

from usage.service import usage_service


async def get_usage(sio, data, logger, sid):
    return {"success": True, "data": await usage_service.status()}


async def update_usage(sio, data, logger, sid):
    try:
        return {"success": True, "data": await usage_service.configure(data)}
    except ValueError as exc:
        return {"success": False, "error": str(exc)}


def register_handlers(registry):
    registry.register_batch(
        {"usage.get": (get_usage, "api_call"), "usage.update": (update_usage, "api_call")}
    )
