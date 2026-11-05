# Copyright (c) 2026 Efstratios Goudelis
# SPDX-License-Identifier: GPL-3.0-or-later
"""Device outcomes shared by the runtime, supervisor, and tracker clients."""

from controllers.rotator import StopRejected, StopUnconfirmed


class ControlReleased(RuntimeError):
    """A request belongs to an owner deliberately detached from this device."""

    def __init__(self, message, *, kind):
        super().__init__(message)
        self.kind = kind


def error_from_reply(reply, kind):
    """Preserve expected releases across both hardware IPC boundaries."""
    if reply.get("error_type") == "ControlReleased":
        return ControlReleased(reply["error"], kind=kind)
    error_type = {"StopRejected": StopRejected, "StopUnconfirmed": StopUnconfirmed}.get(
        reply.get("error_type"), RuntimeError
    )
    return error_type(reply["error"])
