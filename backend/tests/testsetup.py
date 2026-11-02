# Copyright (c) 2026 Efstratios Goudelis

from __future__ import annotations

import asyncio
import contextlib
from unittest.mock import AsyncMock

import pytest
import pytest_asyncio

from handlers.entities import control
from handlers.entities import setup as setuphandler


class _Sio:
    def __init__(self):
        self.events = []

    async def emit(self, event, data, to=None):
        self.events.append({"event": event, "data": data, "to": to})


class _Logger:
    def info(self, *args, **kwargs):
        del args, kwargs

    def exception(self, *args, **kwargs):
        del args, kwargs

    def debug(self, *args, **kwargs):
        del args, kwargs


@pytest_asyncio.fixture(autouse=True)
async def _reset_setup_state():
    setuphandler._setup_finalize_state = setuphandler._new_finalize_state()
    setuphandler._setup_finalize_task = None
    try:
        yield
    finally:
        task = setuphandler._setup_finalize_task
        if task is not None and not task.done():
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task
        setuphandler._setup_finalize_task = None
        setuphandler._setup_finalize_state = setuphandler._new_finalize_state()


@pytest.mark.asyncio
@pytest.mark.parametrize("legacy_discover_soapy", [False, True])
@pytest.mark.parametrize("selected_timezone", [None, "Asia/Kathmandu"])
async def test_setup_finalize_runs_backend_orchestration(
    monkeypatch, selected_timezone, legacy_discover_soapy
):
    sio = _Sio()
    logger = _Logger()
    setup_completed = False
    start_task = AsyncMock()

    async def _is_setup_required(force_refresh=False):
        del force_refresh
        return not setup_completed

    async def _submit_location(sio, data, logger, sid):
        del sio, logger, sid
        assert data["name"] == "home"
        assert data["station_type"] == "stationary"
        return {"success": True, "data": {"id": 1}}

    async def _sync_orbitals(sio, data, logger, sid):
        del sio, data, logger, sid
        return {"success": True, "task_id": "task-2"}

    async def _bootstrap_admin(
        username, password, client_ip=None, user_agent=None, initial_preferences=None
    ):
        del client_ip, user_agent
        nonlocal setup_completed
        assert username == "testadmin"
        assert password == "12345678"
        assert initial_preferences == {"timezone": selected_timezone or "America/New_York"}
        setup_completed = True
        return {"success": True, "token": "token"}

    monkeypatch.setattr(setuphandler.authsvc, "is_setup_required", _is_setup_required)
    monkeypatch.setattr(setuphandler.locations, "submit_location", _submit_location)
    monkeypatch.setattr(control, "background_task_start", start_task)
    monkeypatch.setattr(setuphandler.satellites, "sync_satellite_data", _sync_orbitals)
    monkeypatch.setattr(setuphandler.authsvc, "bootstrap_admin", _bootstrap_admin)

    finalize_reply = await setuphandler.setup_finalize(
        sio,
        {
            **({"timezone": selected_timezone} if selected_timezone else {}),
            # Older clients may still send the removed option; setup must ignore it.
            **({"discover_soapy": True} if legacy_discover_soapy else {}),
            "location": {
                "lat": 40.7128,
                "lon": -74.006,
                "alt": 120,
                "name": "home",
                "station_type": "stationary",
                "horizon_mask": 0,
            },
            "admin": {
                "username": "testadmin",
                "password": "12345678",
            },
        },
        logger,
        "sid-setup",
    )
    assert finalize_reply["success"] is True
    assert finalize_reply["data"]["state"] == "running"

    status_reply = None
    for _ in range(40):
        status_reply = await setuphandler.setup_status(sio, None, logger, "sid-setup")
        if status_reply["data"]["state"] == "completed":
            break
        await asyncio.sleep(0.01)

    assert status_reply is not None
    assert status_reply["data"]["state"] == "completed"
    assert status_reply["data"]["steps"]["location"]["status"] == "success"
    assert "soapy" not in status_reply["data"]["steps"]
    start_task.assert_not_awaited()
    assert status_reply["data"]["steps"]["orbital"]["status"] == "success"
    assert status_reply["data"]["steps"]["admin"]["status"] == "success"


@pytest.mark.asyncio
async def test_setup_finalize_returns_already_running_for_parallel_calls(monkeypatch):
    sio = _Sio()
    logger = _Logger()
    release_location_step = asyncio.Event()

    async def _is_setup_required(force_refresh=False):
        del force_refresh
        return True

    async def _submit_location(sio, data, logger, sid):
        del sio, data, logger, sid
        await release_location_step.wait()
        return {"success": True, "data": {"id": 1}}

    async def _sync_orbitals(sio, data, logger, sid):
        del sio, data, logger, sid
        return {"success": True, "task_id": "task-2"}

    async def _bootstrap_admin(
        username, password, client_ip=None, user_agent=None, initial_preferences=None
    ):
        del username, password, client_ip, user_agent, initial_preferences
        return {"success": True, "token": "token"}

    monkeypatch.setattr(setuphandler.authsvc, "is_setup_required", _is_setup_required)
    monkeypatch.setattr(setuphandler.locations, "submit_location", _submit_location)
    monkeypatch.setattr(setuphandler.satellites, "sync_satellite_data", _sync_orbitals)
    monkeypatch.setattr(setuphandler.authsvc, "bootstrap_admin", _bootstrap_admin)

    payload = {
        "location": {"lat": 38.0, "lon": 23.7, "name": "home"},
        "admin": {"username": "testadmin", "password": "12345678"},
    }

    first_reply = await setuphandler.setup_finalize(sio, payload, logger, "sid-a")
    assert first_reply["success"] is True
    assert first_reply["data"]["already_running"] is False

    second_reply = await setuphandler.setup_finalize(sio, payload, logger, "sid-b")
    assert second_reply["success"] is True
    assert second_reply["data"]["already_running"] is True
    assert second_reply["data"]["job_id"] == first_reply["data"]["job_id"]

    release_location_step.set()

    status_reply = None
    for _ in range(40):
        status_reply = await setuphandler.setup_status(sio, None, logger, "sid-a")
        if status_reply["data"]["state"] in {"completed", "failed"}:
            break
        await asyncio.sleep(0.01)

    assert status_reply is not None
    assert status_reply["data"]["state"] == "completed"
