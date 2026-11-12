# Copyright (c) 2026 Efstratios Goudelis
# SPDX-License-Identifier: GPL-3.0-or-later

"""Administrator-only feedback settings over the existing Socket.IO RPC."""

from feedback.service import feedback_service


async def get_feedback(sio, data, logger, sid):
    return {"success": True, "data": await feedback_service.status(preview=True)}


async def update_feedback(sio, data, logger, sid):
    try:
        return {"success": True, "data": await feedback_service.configure(data)}
    except ValueError as exc:
        return {"success": False, "error": str(exc)}


def register_handlers(registry):
    registry.register_batch(
        {
            "feedback.get": (get_feedback, "api_call"),
            "feedback.update": (update_feedback, "api_call"),
        }
    )
