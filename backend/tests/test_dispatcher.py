# Copyright (c) 2026 Efstratios Goudelis

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import pytest

from handlers.routing import dispatcher
from handlers.routing.dispatcher import dispatch_request


@dataclass
class _Route:
    handler: Any


class _Registry:
    def __init__(self, route: _Route | None):
        self._route = route

    def get_handler(self, command: str):
        del command
        return self._route


class _Logger:
    def error(self, *args, **kwargs):
        del args, kwargs

    def exception(self, *args, **kwargs):
        del args, kwargs


@pytest.fixture(autouse=True)
def _patch_auth(monkeypatch):
    async def _is_setup_required(force_refresh: bool = False):
        del force_refresh
        return False

    monkeypatch.setattr(dispatcher.auth, "is_setup_required", _is_setup_required)


async def test_dispatch_request_rejects_legacy_status_only_response():
    async def _handler(sio, data, logger, sid):
        del sio, data, logger, sid
        return {"status": "success", "message": "ok"}

    registry = _Registry(_Route(_handler))

    result = await dispatch_request(
        None,
        "cmd",
        None,
        _Logger(),
        "sid-1",
        registry,
        auth_context={"role": "admin"},
    )

    assert result["success"] is False
    assert result["data"] is None
    assert result["error"] == "Invalid handler response: missing boolean 'success'"


async def test_dispatch_request_normalizes_success_without_data_error_fields():
    async def _handler(sio, data, logger, sid):
        del sio, data, logger, sid
        return {"success": True, "message": "done"}

    registry = _Registry(_Route(_handler))

    result = await dispatch_request(
        None,
        "cmd",
        None,
        _Logger(),
        "sid-2",
        registry,
        auth_context={"role": "admin"},
    )

    assert result["success"] is True
    assert result["data"] is None
    assert result["error"] is None
    assert result["message"] == "done"


async def test_dispatch_request_rejects_missing_success_response():
    async def _handler(sio, data, logger, sid):
        del sio, data, logger, sid
        return {"message": "done"}

    registry = _Registry(_Route(_handler))

    result = await dispatch_request(
        None,
        "cmd",
        None,
        _Logger(),
        "sid-2b",
        registry,
        auth_context={"role": "admin"},
    )

    assert result["success"] is False
    assert result["data"] is None
    assert result["error"] == "Invalid handler response: missing boolean 'success'"


async def test_dispatch_request_rejects_error_only_response():
    async def _handler(sio, data, logger, sid):
        del sio, data, logger, sid
        return {"error": "failed"}

    registry = _Registry(_Route(_handler))

    result = await dispatch_request(
        None,
        "cmd",
        None,
        _Logger(),
        "sid-3",
        registry,
        auth_context={"role": "admin"},
    )

    assert result["success"] is False
    assert result["data"] is None
    assert result["error"] == "Invalid handler response: missing boolean 'success'"


async def test_dispatch_request_rejects_non_dict_handler_response():
    async def _handler(sio, data, logger, sid):
        del sio, data, logger, sid
        return "ok"

    registry = _Registry(_Route(_handler))

    result = await dispatch_request(
        None,
        "cmd",
        None,
        _Logger(),
        "sid-4",
        registry,
        auth_context={"role": "admin"},
    )

    assert result["success"] is False
    assert result["data"] is None
    assert result["error"] == "Invalid handler response: expected object"


async def test_dispatch_request_unknown_command_uses_canonical_error_shape():
    registry = _Registry(None)

    result = await dispatch_request(
        None,
        "unknown",
        None,
        _Logger(),
        "sid-5",
        registry,
        auth_context={"role": "admin"},
    )

    assert result["success"] is False
    assert result["data"] is None
    assert result["error"] == "Unknown command: unknown"


async def test_dispatch_request_handler_exception_uses_canonical_error_shape():
    async def _handler(sio, data, logger, sid):
        del sio, data, logger, sid
        raise RuntimeError("boom")

    registry = _Registry(_Route(_handler))

    result = await dispatch_request(
        None,
        "cmd",
        None,
        _Logger(),
        "sid-6",
        registry,
        auth_context={"role": "admin"},
    )

    assert result["success"] is False
    assert result["data"] is None
    assert result["error"] == "boom"


async def test_dispatch_request_rejects_non_setup_command_during_setup(monkeypatch):
    async def _is_setup_required(force_refresh: bool = False):
        del force_refresh
        return True

    def _is_command_allowed_during_setup(command: str) -> bool:
        del command
        return False

    monkeypatch.setattr(dispatcher.auth, "is_setup_required", _is_setup_required)
    monkeypatch.setattr(
        dispatcher.auth,
        "is_command_allowed_during_setup",
        _is_command_allowed_during_setup,
    )

    async def _handler(sio, data, logger, sid):
        del sio, data, logger, sid
        return {"success": True}

    registry = _Registry(_Route(_handler))

    result = await dispatch_request(
        None,
        "background-task.start",
        None,
        _Logger(),
        "sid-7",
        registry,
        auth_context=None,
    )

    assert result["success"] is False
    assert result["data"] is None
    assert result["error"] == "Setup required. Complete admin registration first."


async def test_dispatch_request_allows_setup_command_without_auth(monkeypatch):
    async def _is_setup_required(force_refresh: bool = False):
        del force_refresh
        return True

    def _is_command_allowed_during_setup(command: str) -> bool:
        return command == "setup.status"

    monkeypatch.setattr(dispatcher.auth, "is_setup_required", _is_setup_required)
    monkeypatch.setattr(
        dispatcher.auth,
        "is_command_allowed_during_setup",
        _is_command_allowed_during_setup,
    )

    async def _handler(sio, data, logger, sid):
        del sio, data, logger, sid
        return {"success": True, "data": {"state": "running"}}

    registry = _Registry(_Route(_handler))

    result = await dispatch_request(
        None,
        "setup.status",
        None,
        _Logger(),
        "sid-8",
        registry,
        auth_context=None,
    )

    assert result["success"] is True
    assert result["data"] == {"state": "running"}
    assert result["error"] is None
