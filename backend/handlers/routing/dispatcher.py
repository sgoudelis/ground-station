# Copyright (c) 2025 Efstratios Goudelis
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU General Public License for more details.
#
# You should have received a copy of the GNU General Public License
# along with this program. If not, see <https://www.gnu.org/licenses/>.

"""
Generic request dispatcher for Socket.IO handlers.

This module provides a unified dispatch mechanism that routes commands
to their registered handlers via the handler registry.
"""

from contextvars import ContextVar
from typing import Any, Dict, Optional, Union

from common import auth

_auth_context_var: ContextVar[Optional[Dict[str, Any]]] = ContextVar(
    "dispatch_auth_context",
    default=None,
)


def get_auth_context() -> Optional[Dict[str, Any]]:
    """Expose the current request auth context to handlers without changing handler signatures."""
    return _auth_context_var.get()


def _normalize_dispatch_reply(
    raw_reply: Any,
) -> Dict[str, Union[bool, None, dict, list, str]]:
    """Validate and shape handler replies to the canonical envelope.

    Canonical envelope:
      - success: bool
      - data: dict|list|str|None
      - error: str|None
    """
    if not isinstance(raw_reply, dict):
        return {
            "success": False,
            "data": None,
            "error": "Invalid handler response: expected object",
        }

    normalized = dict(raw_reply)

    raw_success = normalized.get("success")
    if not isinstance(raw_success, bool):
        return {
            "success": False,
            "data": None,
            "error": "Invalid handler response: missing boolean 'success'",
        }

    normalized.setdefault("data", None)
    normalized.setdefault("error", None)
    return normalized


async def dispatch_request(
    sio: Any,
    cmd: str,
    data: Optional[Dict],
    logger: Any,
    sid: str,
    registry: Any,
    auth_context: Optional[Dict[str, Any]] = None,
) -> Dict[str, Union[bool, None, dict, list, str]]:
    """
    Generic request dispatcher using registry.

    Args:
        sio: Socket.IO server instance
        cmd: Command string specifying the action to perform
        data: Additional data for the command
        logger: Logger instance
        sid: Socket.IO session ID
        registry: Handler registry instance

    Returns:
        Dictionary containing 'success' status and any response data
    """
    command = str(cmd or "").strip()
    setup_required = await auth.is_setup_required()
    if setup_required and not auth.is_command_allowed_during_setup(command):
        return {
            "success": False,
            "data": None,
            "error": "Setup required. Complete admin registration first.",
        }

    if not setup_required:
        # All runtime command execution requires an authenticated user context.
        if not auth_context:
            return {"success": False, "data": None, "error": "Authentication required."}

        user_role = str(auth_context.get("role") or "").strip().lower()
        if not auth.is_command_allowed_for_role(command, user_role):
            return {"success": False, "data": None, "error": "Not authorized for this action."}

    route = registry.get_handler(command)

    if not route:
        logger.error(f"Unknown command: {command}")
        return {"success": False, "data": None, "error": f"Unknown command: {command}"}

    auth_token = _auth_context_var.set(auth_context)
    try:
        try:
            raw_result: Dict[str, Union[bool, None, dict, list, str]] = await route.handler(
                sio, data, logger, sid
            )
            return _normalize_dispatch_reply(raw_result)
        except Exception as e:
            logger.error(f"Error handling command '{cmd}': {str(e)}")
            logger.exception(e)
            return {"success": False, "data": None, "error": str(e)}
    finally:
        _auth_context_var.reset(auth_token)
