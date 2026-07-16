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

"""Tracking state handlers and emission functions."""

import asyncio
import re
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Union

import crud
from celestial.bodycatalog import get_celestial_body
from common.arguments import arguments
from common.constants import (
    RigStates,
    RotatorStates,
    SocketEvents,
    TrackerCommandScopes,
    TrackerCommandStatus,
)
from db import AsyncSessionLocal
from session.tracker import session_tracker
from tracker.contracts import InvalidTrackerIdError, get_tracking_state_name, require_tracker_id
from tracker.data import compiled_satellite_data, get_ui_tracker_state
from tracker.instances import emit_tracker_instances
from tracker.runner import (
    get_assigned_rotator_for_tracker,
    get_tracker_instances_payload,
    get_tracker_manager,
    remove_tracker_instance,
    swap_rotators_between_trackers,
)
from tracker.stateupdate import update_tracking_state_with_ownership
from tracking.events import fetch_next_events_for_satellite

TARGET_TRACKER_ID_PATTERN = re.compile(r"^target-(\d+)$")
ALLOWED_TRACKER_TARGET_TYPES = {"satellite", "mission", "body"}


def _tracker_id_required_response() -> Dict[str, Any]:
    return {
        "success": False,
        "error": "tracker_id_required",
        "message": "tracker_id is required",
    }


def _missing_new_tracker_fields(value: Dict[str, Any]) -> list[str]:
    required_fields = [
        "rotator_state",
        "rig_state",
        "rig_id",
        "rotator_id",
    ]
    target_type = _infer_target_type_from_value(value) or "satellite"
    if target_type == "mission":
        required_fields.extend(["command"])
    elif target_type == "body":
        required_fields.extend(["body_id"])
    else:
        required_fields.extend(["norad_id", "group_id"])
    missing: list[str] = []
    for field in required_fields:
        field_value = value.get(field)
        if field in {"norad_id", "group_id"}:
            if field_value in (None, "", 0):
                missing.append(field)
        else:
            if field_value is None:
                missing.append(field)
    return missing


def _infer_target_type_from_value(value: Dict[str, Any]) -> str:
    explicit_target_type = str(value.get("target_type") or "").strip().lower()
    if explicit_target_type:
        return explicit_target_type
    if str(value.get("mission_id") or "").strip():
        return "mission"
    if str(value.get("command") or "").strip():
        return "mission"
    if str(value.get("body_id") or "").strip():
        return "body"
    if value.get("norad_id") not in (None, "", 0):
        return "satellite"
    return ""


def _resolve_body_display_name(body_id: Any) -> str:
    normalized_body_id = str(body_id or "").strip().lower()
    if not normalized_body_id:
        return ""
    body = get_celestial_body(normalized_body_id) or {}
    display_name = str(body.get("name") or "").strip()
    return display_name or normalized_body_id


def _resolve_non_satellite_target_name(tracking_value: Dict[str, Any], target_type: str) -> str:
    explicit_name = str(tracking_value.get("target_name") or "").strip()
    if explicit_name:
        if target_type == "body":
            normalized_body_id = str(tracking_value.get("body_id") or "").strip().lower()
            if normalized_body_id and explicit_name.lower() == normalized_body_id:
                return _resolve_body_display_name(normalized_body_id) or explicit_name
        return explicit_name
    if target_type == "mission":
        command = str(tracking_value.get("command") or "").strip()
        return command or "mission"
    if target_type == "body":
        return _resolve_body_display_name(tracking_value.get("body_id")) or "body"
    return str(target_type or "").strip() or "target"


def _build_non_satellite_transmitter_target_key(
    tracking_value: Dict[str, Any],
    target_type: str,
) -> str:
    if target_type == "body":
        body_id = str(tracking_value.get("body_id") or "").strip().lower()
        return f"body:{body_id}" if body_id else ""
    if target_type == "mission":
        command = str(tracking_value.get("command") or "").strip()
        return f"mission:{command}" if command else ""
    return ""


def _normalize_target_update_payload(value: Dict[str, Any]) -> Dict[str, Any]:
    payload = dict(value or {})
    target_type = _infer_target_type_from_value(payload)
    if not target_type:
        return {"success": True, "value": payload}
    if target_type not in ALLOWED_TRACKER_TARGET_TYPES:
        return {
            "success": False,
            "error": "invalid_target_type",
            "message": "target_type must be one of: satellite, mission, body",
        }

    payload["target_type"] = target_type

    # Normalize mission/body identity fields while preserving rig control fields.
    if target_type == "mission":
        command = str(payload.get("command") or "").strip()
        if not command:
            return {
                "success": False,
                "error": "command_required",
                "message": "command is required for mission targets",
            }
        payload["command"] = command
        mission_id = str(payload.get("mission_id") or "").strip().lower()
        payload["mission_id"] = mission_id or None
        payload_target_name = str(payload.get("target_name") or "").strip()
        payload["target_name"] = payload_target_name or command
        payload["target_key"] = f"mission:{command}"
        payload["body_id"] = None
        payload["norad_id"] = None
        payload["group_id"] = None
    elif target_type == "body":
        body_id = str(payload.get("body_id") or "").strip().lower()
        if not body_id:
            return {
                "success": False,
                "error": "body_id_required",
                "message": "body_id is required for body targets",
            }
        payload["body_id"] = body_id
        payload_target_name = str(payload.get("target_name") or "").strip()
        canonical_body_name = _resolve_body_display_name(body_id)
        # Normalize identifier-only names (e.g. "rhea") to canonical display
        # names so mount-time and live tracker emissions stay visually stable.
        if not payload_target_name or payload_target_name.lower() == body_id:
            payload["target_name"] = canonical_body_name or body_id
        else:
            payload["target_name"] = payload_target_name
        payload["target_key"] = f"body:{body_id}"
        payload["command"] = None
        payload["mission_id"] = None
        payload["norad_id"] = None
        payload["group_id"] = None
    else:
        payload["target_key"] = None
        payload["mission_id"] = None

    return {"success": True, "value": payload}


def _parse_target_slot_number(tracker_id: str) -> Optional[int]:
    matched = TARGET_TRACKER_ID_PATTERN.match(tracker_id)
    if not matched:
        return None
    try:
        parsed = int(matched.group(1))
    except (TypeError, ValueError):
        return None
    return parsed if parsed > 0 else None


def _resolve_max_target_slots() -> int:
    configured_limit = getattr(arguments, "max_tracker_targets", 10)
    try:
        configured_limit = int(configured_limit)
    except (TypeError, ValueError):
        configured_limit = 10
    return max(1, configured_limit)


async def emit_tracker_data(dbsession, sio, logger, tracker_id: str):
    """
    Emits satellite tracking data to the provided Socket.IO instance. This function retrieves the
    current state of satellite tracking from the database, processes the relevant satellite data,
    fetches the UI tracker state, and emits the resulting combined data to a specific event on
    the Socket.IO instance. Errors during data retrieval, processing, or emitting are logged.

    :param dbsession: Database session object used to access and query the database.
    :type dbsession: Any
    :param sio: Socket.IO server instance for emitting events.
    :type sio: AsyncServer
    :param logger: Logger object for logging errors or exceptions.
    :type logger: Any
    :return: This function does not return any value as it emits data asynchronously.
    :rtype: None
    """
    tracker_id = require_tracker_id(tracker_id)
    state_name = get_tracking_state_name(tracker_id)
    try:
        logger.debug("Sending tracker data to clients...")

        tracking_state_reply = await crud.trackingstate.get_tracking_state(
            dbsession, name=state_name
        )

        # Check if tracking state exists (not None for first-time users)
        if not tracking_state_reply.get("success") or tracking_state_reply.get("data") is None:
            logger.debug("No tracking state found, skipping tracker data emission")
            return

        tracking_value = tracking_state_reply["data"].get("value")
        if tracking_value is None:
            logger.debug("Tracking state has no value, skipping tracker data emission")
            return

        target_type = _infer_target_type_from_value(tracking_value) or "satellite"
        if target_type == "satellite":
            norad_id = tracking_value.get("norad_id", None)
            satellite_data = await compiled_satellite_data(dbsession, norad_id)
        else:
            target_name = _resolve_non_satellite_target_name(tracking_value, target_type)
            non_satellite_target_key = _build_non_satellite_transmitter_target_key(
                tracking_value, target_type
            )
            non_satellite_transmitters: List[Dict[str, Any]] = []
            if non_satellite_target_key:
                transmitters_reply = await crud.transmitters.fetch_transmitters_for_target_key(
                    dbsession, non_satellite_target_key
                )
                if transmitters_reply.get("success"):
                    non_satellite_transmitters = transmitters_reply.get("data", []) or []
            satellite_data = {
                "details": {
                    "name": target_name,
                    "target_type": target_type,
                    "mission_id": tracking_value.get("mission_id"),
                    "command": tracking_value.get("command"),
                    "body_id": tracking_value.get("body_id"),
                    "norad_id": None,
                    "is_geostationary": False,
                },
                # Do not emit placeholder position objects here; a blank position
                # causes clients to clear valid az/el until the next tracker tick.
                "paths": {"past": [], "future": []},
                "coverage": [],
                "transmitters": non_satellite_transmitters,
                "error": False,
            }
        data = {
            "tracker_id": tracker_id,
            "satellite_data": satellite_data,
            "tracking_state": tracking_value,
        }
        await sio.emit("satellite-tracking", data)
        await sio.emit(SocketEvents.SATELLITE_TRACKING_V2, data)

    except Exception as e:
        logger.error(f"Error emitting tracker data: {e}")
        logger.exception(e)


async def emit_ui_tracker_values(dbsession, sio, logger, tracker_id: str):
    """
    Call this when UI tracker values are updated

    :param dbsession:
    :param sio:
    :param logger:
    :return:
    """

    tracker_id = require_tracker_id(tracker_id)
    state_name = get_tracking_state_name(tracker_id)
    try:
        logger.debug("Sending UI tracker value to clients...")

        tracking_state_reply = await crud.trackingstate.get_tracking_state(
            dbsession, name=state_name
        )

        # Check if tracking state exists (not None for first-time users)
        if not tracking_state_reply.get("success") or tracking_state_reply.get("data") is None:
            logger.debug("No tracking state found, skipping UI tracker values emission")
            return

        tracking_value = tracking_state_reply["data"].get("value")
        if tracking_value is None:
            logger.debug("Tracking state has no value, skipping UI tracker values emission")
            return

        target_type = _infer_target_type_from_value(tracking_value) or "satellite"
        if target_type == "satellite":
            group_id = tracking_value.get("group_id", None)
            norad_id = tracking_value.get("norad_id", None)
            ui_tracker_state = await get_ui_tracker_state(group_id, norad_id, tracker_id)
            data = ui_tracker_state["data"]
        else:
            target_key = _build_non_satellite_transmitter_target_key(tracking_value, target_type)
            transmitters: List[Dict[str, Any]] = []
            if target_key:
                transmitters_reply = await crud.transmitters.fetch_transmitters_for_target_key(
                    dbsession, target_key
                )
                if transmitters_reply.get("success"):
                    transmitters = transmitters_reply.get("data", []) or []
            data = {
                "groups": [],
                "satellites": [],
                "transmitters": transmitters,
                "group_id": None,
                "norad_id": None,
                "rig_id": tracking_value.get("rig_id", "none"),
                "rotator_id": tracking_value.get("rotator_id", "none"),
                "transmitter_id": tracking_value.get("transmitter_id", "none"),
                "target_type": target_type,
                "target_key": target_key,
                "mission_id": tracking_value.get("mission_id"),
                "command": tracking_value.get("command"),
                "body_id": tracking_value.get("body_id"),
            }
        if isinstance(data, dict):
            data["tracker_id"] = tracker_id
        await sio.emit("ui-tracker-state", data)
        await sio.emit(SocketEvents.UI_TRACKER_STATE_V2, data)

    except Exception as e:
        logger.error(f"Error emitting UI tracker values: {e}")
        logger.exception(e)


async def get_tracking_state(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Any]:
    """
    Get current tracking state and emit tracker data.

    Args:
        sio: Socket.IO server instance
        data: Not used
        logger: Logger instance
        sid: Socket.IO session ID

    Returns:
        Dictionary with success status and tracking state
    """
    try:
        requested_tracker_id = require_tracker_id((data or {}).get("tracker_id"))
    except InvalidTrackerIdError:
        return _tracker_id_required_response()
    state_name = get_tracking_state_name(requested_tracker_id)
    async with AsyncSessionLocal() as dbsession:
        logger.debug(f"Fetching tracking state, data: {data}")
        tracking_state = await crud.trackingstate.get_tracking_state(dbsession, name=state_name)
        await emit_tracker_data(dbsession, sio, logger, requested_tracker_id)
        await emit_ui_tracker_values(dbsession, sio, logger, requested_tracker_id)
        response = {"success": tracking_state["success"], "data": tracking_state.get("data", [])}
        response["tracker_id"] = requested_tracker_id
        return response


async def set_tracking_state(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Any]:
    """
    Update tracking state and emit tracker data.

    Args:
        sio: Socket.IO server instance
        data: Tracking state updates (format: {"name": "satellite-tracking", "value": {...}})
        logger: Logger instance
        sid: Socket.IO session ID

    Returns:
        Dictionary with success status and updated tracking state
    """
    logger.info(f"Updating satellite tracking state, data: {data}")

    try:
        tracker_id = require_tracker_id((data or {}).get("tracker_id"))
    except InvalidTrackerIdError:
        return _tracker_id_required_response()

    # Extract the value from the data structure
    value = data.get("value", {}) if data else {}
    value = value if isinstance(value, dict) else {}
    normalized_payload = _normalize_target_update_payload(value)
    if not normalized_payload.get("success"):
        return normalized_payload
    value = normalized_payload["value"]

    existing_payload = get_tracker_instances_payload()
    existing_instances = existing_payload.get("instances", []) if existing_payload else []
    existing_tracker_ids = {
        require_tracker_id(instance.get("tracker_id"))
        for instance in existing_instances
        if instance and instance.get("tracker_id")
    }
    is_new_tracker = tracker_id not in existing_tracker_ids
    if is_new_tracker:
        target_slot_number = _parse_target_slot_number(tracker_id)
        if target_slot_number is not None:
            max_target_slots = _resolve_max_target_slots()
            existing_target_tracker_ids = {
                existing_tracker_id
                for existing_tracker_id in existing_tracker_ids
                if _parse_target_slot_number(existing_tracker_id) is not None
            }
            active_target_count = len(existing_target_tracker_ids)
            if target_slot_number > max_target_slots or active_target_count >= max_target_slots:
                if target_slot_number > max_target_slots:
                    message = (
                        f"Tracker slot '{tracker_id}' exceeds configured target slot limit "
                        f"({max_target_slots})."
                    )
                    reason = "slot_out_of_range"
                else:
                    message = (
                        f"Maximum number of active targets reached ({max_target_slots}). "
                        f"Delete an existing target before creating '{tracker_id}'."
                    )
                    reason = "active_limit_reached"
                return {
                    "success": False,
                    "error": "tracker_slot_limit_reached",
                    "message": message,
                    "data": {
                        "tracker_id": tracker_id,
                        "limit": max_target_slots,
                        "active_targets": active_target_count,
                        "reason": reason,
                    },
                }

        missing_fields = _missing_new_tracker_fields(value)
        if missing_fields:
            return {
                "success": False,
                "error": "tracker_create_requires_fields",
                "message": (
                    f"Cannot create tracker '{tracker_id}' without required fields: "
                    f"{', '.join(missing_fields)}"
                ),
                "data": {
                    "tracker_id": tracker_id,
                    "missing_fields": missing_fields,
                },
            }

    update_reply: Dict[str, Any] = await update_tracking_state_with_ownership(
        tracker_id=tracker_id, value=value, requester_sid=sid
    )
    if not update_reply.get("success"):
        if update_reply.get("error") == "rotator_in_use":
            logger.warning(
                "Rotator ownership conflict while setting tracking state "
                "(requester_sid=%s, tracker_id=%s, requested_rotator_id=%s, owner_tracker_id=%s)",
                sid,
                tracker_id,
                value.get("rotator_id"),
                (update_reply.get("data") or {}).get("owner_tracker_id"),
            )
        return update_reply
    result = update_reply.get("result", {})
    command_id = result.get("command_id")

    command_scope = result.get("command_scope", TrackerCommandScopes.TRACKING)
    requested_state = {
        "rotator_state": value.get("rotator_state"),
        "rig_state": value.get("rig_state"),
    }
    if command_id:
        await sio.emit(
            SocketEvents.TRACKER_COMMAND_STATUS,
            {
                "command_id": command_id,
                "tracker_id": tracker_id,
                "status": TrackerCommandStatus.SUBMITTED,
                "scope": command_scope,
                "requested_state": requested_state,
            },
        )

    # Track session's rig and VFO selection
    if value:
        rig_id = value.get("rig_id")
        rig_vfo = value.get("rig_vfo")
        rig_state = value.get("rig_state")

        if rig_id and rig_id != "none":
            session_tracker.set_session_rig(sid, rig_id)
            logger.debug(f"Session {sid} tracking rig {rig_id}")

        if rig_vfo and rig_vfo != "none":
            session_tracker.set_session_vfo(sid, rig_vfo)
            logger.debug(f"Session {sid} selected VFO {rig_vfo}")

        # Unlock VFOs when tracking stops for this SDR
        if rig_state == RigStates.STOPPED and rig_id and rig_id != "none":
            # Note: VFO locking state (lockedTransmitterId) is UI-only and managed by the frontend
            # No backend action needed when tracking stops
            logger.info(f"Tracking stopped for session {sid}")

    # Emit so that any open browsers are also informed of any change
    async with AsyncSessionLocal() as dbsession:
        await emit_tracker_data(dbsession, sio, logger, tracker_id)
        await emit_ui_tracker_values(dbsession, sio, logger, tracker_id)
    await emit_tracker_instances(sio)

    return {
        "success": result.get("success", False),
        "data": {
            "tracker_id": tracker_id,
            "value": result.get("data", {}).get("value", value),
            "command_id": command_id,
            "command_scope": command_scope,
            "requested_state": requested_state,
        },
    }


async def swap_target_rotators(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Any]:
    def _normalize_rotator_id(rotator_id: Any) -> Optional[str]:
        if rotator_id is None:
            return None
        normalized = str(rotator_id).strip()
        if not normalized or normalized.lower() == "none":
            return None
        return normalized

    def _rotator_for_tracking_state(rotator_id: Optional[str]) -> str:
        return rotator_id if rotator_id is not None else "none"

    payload = data or {}
    try:
        tracker_a_id = require_tracker_id(payload.get("tracker_a_id"))
        tracker_b_id = require_tracker_id(payload.get("tracker_b_id"))
    except InvalidTrackerIdError:
        return {
            "success": False,
            "error": "tracker_ids_required",
            "message": "tracker_a_id and tracker_b_id are required",
        }

    if tracker_a_id == tracker_b_id:
        return {
            "success": False,
            "error": "swap_requires_two_distinct_trackers",
            "message": "tracker_a_id and tracker_b_id must be different",
        }

    manager_a = get_tracker_manager(tracker_a_id)
    manager_b = get_tracker_manager(tracker_b_id)
    state_a = await manager_a.get_tracking_state() or {}
    state_b = await manager_b.get_tracking_state() or {}

    state_a_rotator = state_a.get("rotator_id")
    state_b_rotator = state_b.get("rotator_id")
    assigned_rotator_a = get_assigned_rotator_for_tracker(tracker_a_id)
    assigned_rotator_b = get_assigned_rotator_for_tracker(tracker_b_id)
    effective_rotator_a = _normalize_rotator_id(assigned_rotator_a or state_a_rotator)
    effective_rotator_b = _normalize_rotator_id(assigned_rotator_b or state_b_rotator)

    if not effective_rotator_a and not effective_rotator_b:
        return {
            "success": False,
            "error": "swap_requires_assigned_rotators",
            "message": "At least one tracker must have a rotator assigned",
            "data": {
                "tracker_a_id": tracker_a_id,
                "tracker_b_id": tracker_b_id,
            },
        }

    if effective_rotator_a and effective_rotator_b and effective_rotator_a == effective_rotator_b:
        return {
            "success": False,
            "error": "swap_requires_distinct_rotators",
            "message": "Cannot swap because both trackers already use the same rotator",
            "data": {
                "tracker_a_id": tracker_a_id,
                "tracker_b_id": tracker_b_id,
                "rotator_id": effective_rotator_a,
            },
        }

    if state_a.get("rotator_state") != RotatorStates.DISCONNECTED:
        return {
            "success": False,
            "error": "swap_requires_disconnected_rotators",
            "message": f"Tracker '{tracker_a_id}' rotator must be disconnected before swapping",
            "data": {
                "tracker_id": tracker_a_id,
                "rotator_state": state_a.get("rotator_state"),
            },
        }

    if state_b.get("rotator_state") != RotatorStates.DISCONNECTED:
        return {
            "success": False,
            "error": "swap_requires_disconnected_rotators",
            "message": f"Tracker '{tracker_b_id}' rotator must be disconnected before swapping",
            "data": {
                "tracker_id": tracker_b_id,
                "rotator_state": state_b.get("rotator_state"),
            },
        }

    logger.info(
        "Swapping rotators between trackers (requester_sid=%s, tracker_a_id=%s, tracker_b_id=%s, "
        "tracker_a_rotator_id=%s, tracker_b_rotator_id=%s)",
        sid,
        tracker_a_id,
        tracker_b_id,
        effective_rotator_a,
        effective_rotator_b,
    )

    swap_result = swap_rotators_between_trackers(tracker_a_id, tracker_b_id)
    if not swap_result.get("success"):
        return {
            "success": False,
            "error": "swap_failed",
            "message": "Failed to swap rotator ownership",
            "data": swap_result,
        }

    next_rotator_a = _normalize_rotator_id(swap_result.get("tracker_a_rotator_id"))
    next_rotator_b = _normalize_rotator_id(swap_result.get("tracker_b_rotator_id"))
    previous_rotator_a = _rotator_for_tracking_state(effective_rotator_a)
    next_rotator_a_for_state = _rotator_for_tracking_state(next_rotator_a)
    next_rotator_b_for_state = _rotator_for_tracking_state(next_rotator_b)

    update_a_result = await manager_a.update_tracking_state(rotator_id=next_rotator_a_for_state)
    if not update_a_result.get("success"):
        logger.error(
            "Failed persisting swapped rotator for tracker '%s'; rolling back ownership maps",
            tracker_a_id,
        )
        swap_rotators_between_trackers(tracker_a_id, tracker_b_id)
        return {
            "success": False,
            "error": "swap_persist_failed",
            "message": f"Failed updating tracking state for tracker '{tracker_a_id}'",
            "data": {
                "tracker_id": tracker_a_id,
                "result": update_a_result,
            },
        }

    update_b_result = await manager_b.update_tracking_state(rotator_id=next_rotator_b_for_state)
    if not update_b_result.get("success"):
        logger.error(
            "Failed persisting swapped rotator for tracker '%s'; reverting both tracker updates",
            tracker_b_id,
        )
        await manager_a.update_tracking_state(rotator_id=previous_rotator_a)
        swap_rotators_between_trackers(tracker_a_id, tracker_b_id)
        return {
            "success": False,
            "error": "swap_persist_failed",
            "message": f"Failed updating tracking state for tracker '{tracker_b_id}'",
            "data": {
                "tracker_id": tracker_b_id,
                "result": update_b_result,
            },
        }

    async with AsyncSessionLocal() as dbsession:
        await emit_tracker_data(dbsession, sio, logger, tracker_a_id)
        await emit_ui_tracker_values(dbsession, sio, logger, tracker_a_id)
        await emit_tracker_data(dbsession, sio, logger, tracker_b_id)
        await emit_ui_tracker_values(dbsession, sio, logger, tracker_b_id)
    await emit_tracker_instances(sio)

    return {
        "success": True,
        "data": {
            "tracker_a_id": tracker_a_id,
            "tracker_b_id": tracker_b_id,
            "tracker_a_rotator_id": next_rotator_a_for_state,
            "tracker_b_rotator_id": next_rotator_b_for_state,
        },
    }


async def get_tracker_instances(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Union[bool, dict]]:
    return {
        "success": True,
        "data": get_tracker_instances_payload(),
    }


async def delete_tracker_instance(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Union[bool, dict, str]]:
    payload = data or {}
    try:
        tracker_id = require_tracker_id(payload.get("tracker_id"))
    except InvalidTrackerIdError:
        return _tracker_id_required_response()

    existing_payload = get_tracker_instances_payload()
    existing_instances = existing_payload.get("instances", []) if existing_payload else []
    existing_tracker_ids = {
        require_tracker_id(instance.get("tracker_id"))
        for instance in existing_instances
        if instance and instance.get("tracker_id")
    }
    if tracker_id not in existing_tracker_ids:
        return {
            "success": False,
            "error": "tracker_not_found",
            "message": f"Tracker '{tracker_id}' does not exist",
        }

    # Stop/remove tracker runtime first so it cannot race DB writes during deletion.
    # Run in a worker thread to avoid blocking the event loop if teardown stalls.
    try:
        remove_result = await asyncio.wait_for(
            asyncio.to_thread(remove_tracker_instance, tracker_id),
            timeout=6.0,
        )
    except TimeoutError:
        return {
            "success": False,
            "error": "remove_tracker_timeout",
            "message": f"Timed out while removing tracker instance '{tracker_id}'",
        }
    if not remove_result.get("success"):
        return {
            "success": False,
            "error": remove_result.get("error", "failed_removing_tracker_instance"),
            "message": f"Failed removing tracker instance '{tracker_id}'",
            "data": remove_result,
        }

    state_name = get_tracking_state_name(tracker_id)
    async with AsyncSessionLocal() as dbsession:
        delete_state_reply = await crud.trackingstate.delete_tracking_state(dbsession, state_name)
        if not delete_state_reply.get("success"):
            return {
                "success": False,
                "error": delete_state_reply.get("error", "failed_deleting_tracking_state"),
                "message": "Failed deleting tracking state row",
            }

    await emit_tracker_instances(sio)
    return {
        "success": True,
        "data": {
            "tracker_id": tracker_id,
            "tracking_state_deleted": bool(delete_state_reply.get("deleted")),
            "instances": get_tracker_instances_payload().get("instances", []),
        },
    }


async def fetch_next_passes(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Union[bool, list, float]]:
    """
    Fetch next passes for a satellite.

    Args:
        sio: Socket.IO server instance
        data: NORAD ID, forecast hours, and optional force_recalculate flag
        logger: Logger instance
        sid: Socket.IO session ID

    Returns:
        Dictionary with success status and next passes
    """
    norad_id = data.get("norad_id", None) if data else None
    hours = data.get("hours", 4.0) if data else 4.0
    min_elevation = data.get("min_elevation", 0) if data else 0
    force_recalculate = data.get("force_recalculate", False) if data else False
    logger.info(
        f"Handling request from client_id={sid}, norad_id={norad_id}, hours={hours}, "
        f"min_elevation={min_elevation}, force_recalculate={force_recalculate} (get_next_passes)"
    )
    # Always calculate passes from horizon (above_el=0) to get complete pass times
    next_passes = await fetch_next_events_for_satellite(
        norad_id=norad_id, hours=hours, above_el=0, force_recalculate=force_recalculate
    )

    # Filter passes by peak elevation if min_elevation is specified
    if next_passes["success"] and min_elevation > 0:
        filtered_passes = [
            p for p in next_passes.get("data", []) if p.get("peak_altitude", 0) >= min_elevation
        ]
        next_passes["data"] = filtered_passes

    return {
        "success": next_passes["success"],
        "data": next_passes.get("data", []),
        "cached": next_passes.get("cached", False),
        "forecast_hours": next_passes.get("forecast_hours", 4.0),
    }


def _coerce_float(value: Any, default: float) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _coerce_int(value: Any) -> Optional[int]:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _normalize_tracker_target_type(value: Dict[str, Any]) -> str:
    explicit_target_type = str(value.get("target_type") or "").strip().lower()
    if explicit_target_type in ALLOWED_TRACKER_TARGET_TYPES:
        return explicit_target_type
    if str(value.get("mission_id") or "").strip():
        return "mission"
    if str(value.get("command") or "").strip():
        return "mission"
    if str(value.get("body_id") or "").strip():
        return "body"
    norad_id = _coerce_int(value.get("norad_id"))
    if isinstance(norad_id, int) and norad_id > 0:
        return "satellite"
    return "satellite"


def _build_non_satellite_target_key(
    *,
    target_type: str,
    command: str = "",
    body_id: str = "",
) -> str:
    if target_type == "mission":
        normalized_command = str(command or "").strip()
        return f"mission:{normalized_command}" if normalized_command else ""
    if target_type == "body":
        normalized_body_id = str(body_id or "").strip().lower()
        return f"body:{normalized_body_id}" if normalized_body_id else ""
    return ""


def _parse_iso_to_ms(value: Any) -> Optional[int]:
    if not isinstance(value, str):
        return None
    text = value.strip()
    if not text:
        return None
    try:
        dt = datetime.fromisoformat(text.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return int(dt.timestamp() * 1000)
    except (TypeError, ValueError):
        return None


def _pick_active_or_upcoming_pass(
    *,
    candidate_passes: list[Dict[str, Any]],
    now_ms: int,
    min_elevation: float,
) -> tuple[Optional[Dict[str, Any]], Optional[Dict[str, Any]]]:
    filtered_passes = [
        p
        for p in candidate_passes
        if _coerce_float(p.get("peak_altitude", p.get("peak_elevation_deg")), 0.0) >= min_elevation
    ]

    active_pass: Optional[Dict[str, Any]] = None
    next_pass: Optional[Dict[str, Any]] = None
    next_start_ms: Optional[int] = None
    for entry in filtered_passes:
        start_ms = _parse_iso_to_ms(entry.get("event_start"))
        end_ms = _parse_iso_to_ms(entry.get("event_end"))
        if start_ms is None or end_ms is None:
            continue
        if start_ms <= now_ms < end_ms:
            active_end_ms = (
                _parse_iso_to_ms(active_pass["event_end"])
                if active_pass is not None and "event_end" in active_pass
                else None
            )
            if active_pass is None or active_end_ms is None or end_ms < active_end_ms:
                active_pass = entry
            continue
        if start_ms > now_ms and (next_start_ms is None or start_ms < next_start_ms):
            next_pass = entry
            next_start_ms = start_ms

    return active_pass, next_pass


async def fetch_next_pass_summaries_for_trackers(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Union[bool, dict, str]]:
    """
    Fetch lightweight next-pass summaries for multiple trackers in one request.

    Request shape:
      {
        "hours": 24.0,
        "trackers": [
          {
            "tracker_id": "target-1",
            "target_type": "satellite|mission|body",
            "norad_id": 25544,
            "command": null,
            "body_id": null,
            "min_elevation": 10
          },
          ...
        ]
      }

    Response shape:
      {
        "success": true,
        "data": {
          "computed_at_ms": 1713880000000,
          "summaries": {
            "target-1": {
              "tracker_id": "target-1",
              "norad_id": 25544,
              "mode": "live|upcoming|none",
              "aos_ts": "...",
              "los_ts": "...",
              "cached": true
            }
          }
        }
      }
    """
    payload = data or {}
    hours = _coerce_float(payload.get("hours"), 24.0)
    tracker_requests = payload.get("trackers") or []
    if not isinstance(tracker_requests, list):
        return {
            "success": False,
            "error": "invalid_payload",
            "message": "trackers must be a list",
        }

    normalized_trackers = []
    for raw in tracker_requests:
        if not isinstance(raw, dict):
            continue
        try:
            tracker_id = require_tracker_id(raw.get("tracker_id"))
        except InvalidTrackerIdError:
            continue
        target_type = _normalize_tracker_target_type(raw)
        mission_id = str(raw.get("mission_id") or "").strip().lower()
        command = str(raw.get("command") or "").strip()
        body_id = str(raw.get("body_id") or "").strip().lower()
        target_key = _build_non_satellite_target_key(
            target_type=target_type,
            command=command,
            body_id=body_id,
        )
        norad_id = _coerce_int(raw.get("norad_id"))
        if target_type != "satellite":
            norad_id = None
        normalized_trackers.append(
            {
                "tracker_id": tracker_id,
                "target_type": target_type,
                "norad_id": norad_id,
                "mission_id": mission_id if target_type == "mission" else "",
                "command": command if target_type == "mission" else "",
                "body_id": body_id if target_type == "body" else "",
                "target_key": target_key,
                "min_elevation": _coerce_float(raw.get("min_elevation"), 0.0),
            }
        )

    if not normalized_trackers:
        return {
            "success": True,
            "data": {
                "computed_at_ms": int(time.time() * 1000),
                "summaries": {},
            },
        }

    now_ms = int(time.time() * 1000)

    norad_ids_set: set[int] = set()
    for tracker in normalized_trackers:
        candidate_norad_id = tracker.get("norad_id")
        if isinstance(candidate_norad_id, int) and candidate_norad_id > 0:
            norad_ids_set.add(candidate_norad_id)
    unique_norad_ids = sorted(norad_ids_set)

    passes_by_norad: Dict[int, list[Dict[str, Any]]] = {}
    cache_by_norad: Dict[int, bool] = {}
    for norad_id in unique_norad_ids:
        passes_reply = await fetch_next_events_for_satellite(
            norad_id=norad_id,
            hours=hours,
            above_el=0,
            force_recalculate=False,
        )
        if not passes_reply.get("success"):
            logger.warning(
                "Failed fetching pass summary source for norad_id=%s (sid=%s)",
                norad_id,
                sid,
            )
            passes_by_norad[norad_id] = []
            cache_by_norad[norad_id] = False
            continue

        passes_by_norad[norad_id] = passes_reply.get("data", []) or []
        cache_by_norad[norad_id] = bool(passes_reply.get("cached", False))

    unique_non_satellite_targets = {
        tracker["target_key"]: tracker
        for tracker in normalized_trackers
        if tracker["target_type"] in {"mission", "body"} and tracker.get("target_key")
    }
    passes_by_target_key: Dict[str, list[Dict[str, Any]]] = {}
    cache_by_target_key: Dict[str, bool] = {}
    if unique_non_satellite_targets:
        celestial_payload = []
        for target in unique_non_satellite_targets.values():
            target_type = target["target_type"]
            if target_type == "mission":
                command = str(target.get("command") or "").strip()
                if not command:
                    continue
                celestial_payload.append(
                    {
                        "target_type": "mission",
                        "command": command,
                        "name": command,
                    }
                )
            elif target_type == "body":
                body_id = str(target.get("body_id") or "").strip().lower()
                if not body_id:
                    continue
                body_name = _resolve_body_display_name(body_id) or body_id
                celestial_payload.append(
                    {
                        "target_type": "body",
                        "body_id": body_id,
                        "name": body_name,
                    }
                )

        if celestial_payload:
            try:
                from celestial.scene import build_celestial_tracks

                projection_payload = {
                    "past_hours": 24,
                    "future_hours": max(1, int(hours)),
                    "step_minutes": 30,
                }

                def _store_celestial_passes(celestial_passes: list[Dict[str, Any]]) -> None:
                    for item in celestial_passes:
                        if not isinstance(item, dict):
                            continue
                        target_key = str(item.get("target_key") or "").strip()
                        if not target_key:
                            continue
                        existing = passes_by_target_key.get(target_key, [])
                        existing.append(item)
                        passes_by_target_key[target_key] = existing

                celestial_tracks_reply = await build_celestial_tracks(
                    data={
                        "celestial": celestial_payload,
                        **projection_payload,
                    },
                    logger=logger,
                    force_refresh=False,
                    # Try cached vectors first for low latency and fewer Horizons calls.
                    allow_network_fetch=False,
                )
                if celestial_tracks_reply.get("success"):
                    tracks_data = celestial_tracks_reply.get("data", {}) or {}
                    celestial_passes = tracks_data.get("celestial_passes", []) or []
                    _store_celestial_passes(celestial_passes)

                    unresolved_targets = [
                        target
                        for target_key, target in unique_non_satellite_targets.items()
                        if target_key not in passes_by_target_key
                    ]
                    if unresolved_targets:
                        retry_payload = []
                        for target in unresolved_targets:
                            target_type = target["target_type"]
                            if target_type == "mission":
                                command = str(target.get("command") or "").strip()
                                if not command:
                                    continue
                                retry_payload.append(
                                    {
                                        "target_type": "mission",
                                        "command": command,
                                        "name": command,
                                    }
                                )
                            elif target_type == "body":
                                body_id = str(target.get("body_id") or "").strip().lower()
                                if not body_id:
                                    continue
                                body_name = _resolve_body_display_name(body_id) or body_id
                                retry_payload.append(
                                    {
                                        "target_type": "body",
                                        "body_id": body_id,
                                        "name": body_name,
                                    }
                                )

                        if retry_payload:
                            warm_cache_reply = await build_celestial_tracks(
                                data={
                                    "celestial": retry_payload,
                                    **projection_payload,
                                },
                                logger=logger,
                                force_refresh=False,
                                # Cold-start fallback so mission/body AOS/LOS works right after restart.
                                allow_network_fetch=True,
                            )
                            if warm_cache_reply.get("success"):
                                warm_tracks_data = warm_cache_reply.get("data", {}) or {}
                                warm_passes = warm_tracks_data.get("celestial_passes", []) or []
                                _store_celestial_passes(warm_passes)
                            else:
                                logger.warning(
                                    "Failed warming celestial pass summaries for non-satellite targets (sid=%s): %s",
                                    sid,
                                    warm_cache_reply.get("error"),
                                )

                    for target_key, target_passes in passes_by_target_key.items():
                        cache_by_target_key[target_key] = any(
                            str(entry.get("cache") or "").strip() != ""
                            for entry in target_passes
                            if isinstance(entry, dict)
                        )
                else:
                    logger.warning(
                        "Failed fetching celestial pass summaries for non-satellite targets (sid=%s): %s",
                        sid,
                        celestial_tracks_reply.get("error"),
                    )
            except Exception as exc:
                logger.warning(
                    "Celestial pass summary fetch failed for non-satellite targets (sid=%s): %s",
                    sid,
                    exc,
                )

    summaries_by_tracker_id: Dict[str, Dict[str, Any]] = {}
    for tracker in normalized_trackers:
        tracker_id = tracker["tracker_id"]
        target_type = tracker["target_type"]
        norad_id = tracker["norad_id"]
        min_elevation = tracker["min_elevation"]
        target_key = tracker.get("target_key") or ""

        summary = {
            "tracker_id": tracker_id,
            "target_type": target_type,
            "norad_id": norad_id,
            "mode": "none",
            "aos_ts": None,
            "los_ts": None,
            "cached": False,
        }

        if target_type == "satellite":
            # Satellite summaries are NORAD-based.
            if not isinstance(norad_id, int) or norad_id <= 0:
                summaries_by_tracker_id[tracker_id] = summary
                continue
            candidate_passes = passes_by_norad.get(norad_id, [])
            active_pass, next_pass = _pick_active_or_upcoming_pass(
                candidate_passes=candidate_passes,
                now_ms=now_ms,
                min_elevation=min_elevation,
            )
            summary["cached"] = bool(cache_by_norad.get(norad_id, False))
        else:
            # Mission/body summaries are keyed by celestial target identity.
            if not target_key:
                summaries_by_tracker_id[tracker_id] = summary
                continue
            candidate_passes = passes_by_target_key.get(target_key, [])
            active_pass, next_pass = _pick_active_or_upcoming_pass(
                candidate_passes=candidate_passes,
                now_ms=now_ms,
                min_elevation=min_elevation,
            )
            summary["cached"] = bool(cache_by_target_key.get(target_key, False))

        if active_pass:
            summary["mode"] = "live"
            summary["aos_ts"] = active_pass.get("event_start")
            summary["los_ts"] = active_pass.get("event_end")
        elif next_pass:
            summary["mode"] = "upcoming"
            summary["aos_ts"] = next_pass.get("event_start")
            summary["los_ts"] = next_pass.get("event_end")

        summaries_by_tracker_id[tracker_id] = summary

    return {
        "success": True,
        "data": {
            "computed_at_ms": now_ms,
            "summaries": summaries_by_tracker_id,
        },
    }


def register_handlers(registry):
    """Register tracking handlers with the command registry."""
    registry.register_batch(
        {
            "get-tracking-state": (get_tracking_state, "api_call"),
            "set-tracking-state": (set_tracking_state, "api_call"),
            "swap-target-rotators": (swap_target_rotators, "api_call"),
            "get-tracker-instances": (get_tracker_instances, "api_call"),
            "delete-tracker-instance": (delete_tracker_instance, "api_call"),
            "fetch-next-passes": (fetch_next_passes, "api_call"),
            "fetch-next-pass-summary-for-trackers": (
                fetch_next_pass_summaries_for_trackers,
                "api_call",
            ),
        }
    )
