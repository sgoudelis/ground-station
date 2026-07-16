# Copyright (c) 2026 Efstratios Goudelis
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

"""Setup mode handlers for initial bootstrap orchestration."""

from __future__ import annotations

import asyncio
import uuid
from copy import deepcopy
from datetime import datetime, timezone
from typing import Any, Dict, Optional, cast

from common import auth as authsvc
from handlers.entities import control, locations, satellites
from server import runtimestate
from server.scheduler import schedule_celestial_sync_warmup_job
from tlesync.state import sync_state_manager

CALL_STATUS_IDLE = "idle"
CALL_STATUS_PENDING = "pending"
CALL_STATUS_SUCCESS = "success"
CALL_STATUS_ERROR = "error"

SETUP_STATE_IDLE = "idle"
SETUP_STATE_RUNNING = "running"
SETUP_STATE_COMPLETED = "completed"
SETUP_STATE_FAILED = "failed"

SOAPY_SETUP_TASK_NAME = "SoapySDR Discovery (setup)"
SOCKET_EVENT_SETUP_STATUS = "setup:status"

_setup_finalize_lock = asyncio.Lock()
_setup_finalize_task: Optional[asyncio.Task] = None


def _utc_iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _new_step() -> Dict[str, str]:
    return {"status": CALL_STATUS_IDLE, "detail": ""}


def _new_finalize_state(
    *,
    job_id: Optional[str] = None,
    state: str = SETUP_STATE_IDLE,
    error: Optional[str] = None,
    started_at: Optional[str] = None,
    finished_at: Optional[str] = None,
) -> Dict[str, Any]:
    return {
        "job_id": job_id,
        "state": state,
        "error": error,
        "started_at": started_at,
        "finished_at": finished_at,
        "setup_required": True,
        "steps": {
            "location": _new_step(),
            "soapy": _new_step(),
            "orbital": _new_step(),
            "admin": _new_step(),
        },
    }


_setup_finalize_state: Dict[str, Any] = _new_finalize_state()


def _is_already_running_error(value: Any) -> bool:
    return "already running" in str(value or "").strip().lower()


def _normalize_station_type(value: Any) -> str:
    if str(value or "").strip().lower() == "mobile":
        return "mobile"
    return "stationary"


def _normalize_horizon_mask(value: Any) -> float:
    parsed = float(value or 0)
    return max(0.0, min(90.0, parsed))


def _normalize_location_payload(payload: Any) -> Dict[str, Any]:
    if not isinstance(payload, dict):
        raise ValueError("Missing location payload.")

    lat_raw = payload.get("lat")
    lon_raw = payload.get("lon")
    if lat_raw is None or lon_raw is None:
        raise ValueError("Latitude and longitude are required.")

    try:
        lat = float(lat_raw)
        lon = float(lon_raw)
    except (TypeError, ValueError) as exc:
        raise ValueError("Latitude and longitude must be valid numbers.") from exc

    if not (-90.0 <= lat <= 90.0):
        raise ValueError("Latitude must be between -90 and 90.")
    if not (-180.0 <= lon <= 180.0):
        raise ValueError("Longitude must be between -180 and 180.")

    location_payload: Dict[str, Any] = {
        "lat": lat,
        "lon": lon,
        "alt": float(payload.get("alt") or 0),
        "name": str(payload.get("name") or "").strip() or "home",
        "callsign": str(payload.get("callsign") or "").strip().upper() or None,
        "station_type": _normalize_station_type(payload.get("station_type")),
        "horizon_mask": _normalize_horizon_mask(payload.get("horizon_mask")),
    }
    if payload.get("id") is not None:
        location_payload["id"] = payload.get("id")
    return location_payload


def _normalize_finalize_payload(payload: Any) -> Dict[str, Any]:
    if not isinstance(payload, dict):
        raise ValueError("Missing finalize payload.")

    admin_payload = payload.get("admin")
    if not isinstance(admin_payload, dict):
        raise ValueError("Missing admin payload.")

    username = str(admin_payload.get("username") or "").strip()
    password = str(admin_payload.get("password") or "")
    if not username:
        raise ValueError("Username is required.")
    if not password:
        raise ValueError("Password is required.")

    return {
        "location": _normalize_location_payload(payload.get("location")),
        "admin": {
            "username": username,
            "password": password,
        },
    }


def _set_step(step_key: str, status: str, detail: str = "") -> None:
    steps = cast(Dict[str, Dict[str, str]], _setup_finalize_state.get("steps") or {})
    if step_key not in steps:
        steps[step_key] = _new_step()
    steps[step_key]["status"] = status
    steps[step_key]["detail"] = str(detail or "")


async def _refresh_setup_required_in_state() -> None:
    try:
        _setup_finalize_state["setup_required"] = await authsvc.is_setup_required(
            force_refresh=True
        )
    except Exception:
        # Setup status should still be reported even if setup-required refresh fails.
        pass


def _finalize_state_snapshot() -> Dict[str, Any]:
    snapshot = deepcopy(_setup_finalize_state)
    snapshot["sync_state"] = sync_state_manager.get_state()
    return snapshot


async def _emit_setup_status(sio: Any, sid: str) -> None:
    try:
        await sio.emit(SOCKET_EVENT_SETUP_STATUS, _finalize_state_snapshot(), to=sid)
    except Exception:
        # Live updates are best-effort; polling via setup.status is still available.
        pass


async def _save_location(
    sio: Any, location_payload: Dict[str, Any], logger: Any, sid: str
) -> Dict[str, Any]:
    if location_payload.get("id") is None:
        return cast(
            Dict[str, Any], await locations.submit_location(sio, location_payload, logger, sid)
        )
    return cast(Dict[str, Any], await locations.edit_location(sio, location_payload, logger, sid))


async def _run_finalize_job(
    sio: Any,
    payload: Dict[str, Any],
    logger: Any,
    sid: str,
    job_id: str,
) -> None:
    global _setup_finalize_state
    global _setup_finalize_task

    try:
        setup_required = await authsvc.is_setup_required(force_refresh=True)
        if not setup_required:
            raise RuntimeError("Setup already completed.")

        _set_step("location", CALL_STATUS_PENDING, "Submitting location...")
        await _emit_setup_status(sio, sid)
        location_reply = await _save_location(sio, payload["location"], logger, sid)
        if not location_reply.get("success"):
            error_message = str(location_reply.get("error") or "Location submission failed.")
            _set_step("location", CALL_STATUS_ERROR, error_message)
            await _emit_setup_status(sio, sid)
            raise RuntimeError(error_message)
        _set_step("location", CALL_STATUS_SUCCESS, "Location saved.")
        await _emit_setup_status(sio, sid)

        _set_step("soapy", CALL_STATUS_PENDING, "Starting SoapySDR discovery...")
        await _emit_setup_status(sio, sid)
        soapy_reply = await control.background_task_start(
            sio,
            {
                "task_name": "soapysdr_discovery",
                "args": [],
                "kwargs": {
                    "mode": "single",
                    "refresh_interval": 120,
                },
                "name": SOAPY_SETUP_TASK_NAME,
            },
            logger,
            sid,
        )
        if soapy_reply.get("success"):
            _set_step("soapy", CALL_STATUS_SUCCESS, "Discovery task submitted.")
        elif _is_already_running_error(soapy_reply.get("error")):
            _set_step("soapy", CALL_STATUS_SUCCESS, "Discovery already running.")
        else:
            _set_step(
                "soapy",
                CALL_STATUS_ERROR,
                str(soapy_reply.get("error") or "Failed to start SoapySDR discovery."),
            )
        await _emit_setup_status(sio, sid)

        _set_step("orbital", CALL_STATUS_PENDING, "Starting orbital synchronization...")
        await _emit_setup_status(sio, sid)
        orbital_reply = await satellites.sync_satellite_data(sio, None, logger, sid)
        if orbital_reply.get("success"):
            _set_step("orbital", CALL_STATUS_SUCCESS, "Synchronization task submitted.")
        elif _is_already_running_error(orbital_reply.get("error")):
            _set_step("orbital", CALL_STATUS_SUCCESS, "Synchronization already running.")
        else:
            _set_step(
                "orbital",
                CALL_STATUS_ERROR,
                str(orbital_reply.get("error") or "Failed to start synchronization."),
            )
        await _emit_setup_status(sio, sid)

        _set_step("admin", CALL_STATUS_PENDING, "Creating admin user...")
        await _emit_setup_status(sio, sid)
        admin_reply = await authsvc.bootstrap_admin(
            username=payload["admin"]["username"],
            password=payload["admin"]["password"],
        )
        if not admin_reply.get("success"):
            error_message = str(
                admin_reply.get("error") or "Failed to create initial admin account."
            )
            _set_step("admin", CALL_STATUS_ERROR, error_message)
            await _emit_setup_status(sio, sid)
            raise RuntimeError(error_message)
        _set_step("admin", CALL_STATUS_SUCCESS, "Admin user created.")

        _setup_finalize_state["job_id"] = job_id
        _setup_finalize_state["state"] = SETUP_STATE_COMPLETED
        _setup_finalize_state["error"] = None
        _setup_finalize_state["finished_at"] = _utc_iso_now()
        await _refresh_setup_required_in_state()
        await _emit_setup_status(sio, sid)
        if not bool(_setup_finalize_state.get("setup_required")):
            # Kick a one-off celestial cache warmup after setup completion so the
            # scheduler can immediately push usable tracks without page-triggered sync.
            schedule_celestial_sync_warmup_job(runtimestate.background_task_manager, sio)
    except Exception as exc:
        _setup_finalize_state["job_id"] = job_id
        _setup_finalize_state["state"] = SETUP_STATE_FAILED
        _setup_finalize_state["error"] = str(exc)
        _setup_finalize_state["finished_at"] = _utc_iso_now()
        await _refresh_setup_required_in_state()
        await _emit_setup_status(sio, sid)
        logger.exception("Setup finalization job failed")
    finally:
        # Guard against stale task references so retries can start a fresh job.
        async with _setup_finalize_lock:
            current_task = asyncio.current_task()
            if _setup_finalize_task is current_task or (
                _setup_finalize_task is not None and _setup_finalize_task.done()
            ):
                _setup_finalize_task = None


async def setup_finalize(sio: Any, data: Optional[Dict], logger: Any, sid: str) -> Dict[str, Any]:
    global _setup_finalize_state
    global _setup_finalize_task

    try:
        payload = _normalize_finalize_payload(data or {})
    except ValueError as exc:
        return {"success": False, "error": str(exc)}

    setup_required = await authsvc.is_setup_required(force_refresh=True)
    if not setup_required:
        return {"success": False, "error": "Setup already completed."}

    async with _setup_finalize_lock:
        if _setup_finalize_task is not None and not _setup_finalize_task.done():
            await _refresh_setup_required_in_state()
            return {
                "success": True,
                "data": {
                    "accepted": True,
                    "already_running": True,
                    "job_id": _setup_finalize_state.get("job_id"),
                    "state": _setup_finalize_state.get("state"),
                },
            }

        job_id = str(uuid.uuid4())
        _setup_finalize_state = _new_finalize_state(
            job_id=job_id,
            state=SETUP_STATE_RUNNING,
            started_at=_utc_iso_now(),
            finished_at=None,
        )
        await _refresh_setup_required_in_state()
        await _emit_setup_status(sio, sid)
        _setup_finalize_task = asyncio.create_task(
            _run_finalize_job(sio, payload, logger, sid, job_id)
        )

    return {
        "success": True,
        "data": {
            "accepted": True,
            "already_running": False,
            "job_id": job_id,
            "state": SETUP_STATE_RUNNING,
        },
    }


async def setup_status(sio: Any, data: Optional[Dict], logger: Any, sid: str) -> Dict[str, Any]:
    del sio, data, logger, sid
    await _refresh_setup_required_in_state()
    return {"success": True, "data": _finalize_state_snapshot()}


async def setup_restore(sio: Any, data: Optional[Dict], logger: Any, sid: str) -> Dict[str, Any]:
    setup_required = await authsvc.is_setup_required(force_refresh=True)
    if not setup_required:
        return {"success": False, "error": "Setup already completed."}

    payload = data or {}
    sql = str(payload.get("sql") or "")
    if not sql.strip():
        return {"success": False, "error": "Missing sql parameter"}

    return cast(
        Dict[str, Any],
        await control.backup_full_restore(
            sio,
            {
                "sql": sql,
                "drop_tables": bool(payload.get("drop_tables", True)),
            },
            logger,
            sid,
        ),
    )


def register_handlers(registry: Any) -> None:
    registry.register_batch(
        {
            "setup.finalize": (setup_finalize, "api_call"),
            "setup.status": (setup_status, "api_call"),
            "setup.restore": (setup_restore, "api_call"),
        }
    )
