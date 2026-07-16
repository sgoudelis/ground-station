# Copyright (c) 2026 Efstratios Goudelis

from __future__ import annotations

from typing import Any, Dict

import pytest

from handlers import socket as sockethandlers
from handlers.entities import sessions as sessionhandlers


class _FakeSio:
    def __init__(self) -> None:
        self.handlers: Dict[str, Any] = {}
        self.disconnect_calls: list[str] = []
        self.emit_calls: list[Dict[str, Any]] = []
        self.enter_room_calls: list[Dict[str, str]] = []
        self.leave_room_calls: list[Dict[str, str]] = []

    def on(self, event: str):
        def _decorator(handler):
            self.handlers[event] = handler
            return handler

        return _decorator

    async def emit(self, event: str, data: Any, to: str | None = None):
        self.emit_calls.append({"event": event, "data": data, "to": to})

    async def disconnect(self, sid: str):
        self.disconnect_calls.append(sid)

    async def enter_room(self, sid: str, room: str):
        self.enter_room_calls.append({"sid": sid, "room": room})

    async def leave_room(self, sid: str, room: str):
        self.leave_room_calls.append({"sid": sid, "room": room})


@pytest.fixture(autouse=True)
def _reset_socket_state(monkeypatch):
    sockethandlers.SOCKET_AUTH.clear()
    sockethandlers.SOCKET_TOKENS.clear()
    sockethandlers.SESSIONS.clear()

    monkeypatch.setattr(
        sockethandlers.session_tracker,
        "set_session_metadata",
        lambda *args, **kwargs: None,
    )

    async def _cleanup_session(_sid: str):
        return None

    monkeypatch.setattr(sockethandlers.session_service, "cleanup_session", _cleanup_session)
    monkeypatch.setattr(sockethandlers.runtimestate, "background_task_manager", None)

    yield

    sockethandlers.SOCKET_AUTH.clear()
    sockethandlers.SOCKET_TOKENS.clear()
    sockethandlers.SESSIONS.clear()


@pytest.mark.asyncio
async def test_api_call_reauthenticates_each_request(monkeypatch):
    sio = _FakeSio()
    sockethandlers.register_socketio_handlers(sio)
    connect = sio.handlers["connect"]
    api_call = sio.handlers["api.call"]

    async def _is_setup_required(force_refresh: bool = False):
        del force_refresh
        return False

    auth_calls = {"count": 0}

    async def _authenticate_token(token: str | None):
        auth_calls["count"] += 1
        assert token == "token-1"
        if auth_calls["count"] == 1:
            return {"username": "admin", "role": "admin"}
        return {"username": "admin", "role": "operator"}

    dispatch_auth_roles = []

    async def _dispatch_request(sio, cmd, data, logger, sid, registry, auth_context=None):
        del sio, cmd, data, logger, sid, registry
        dispatch_auth_roles.append(str((auth_context or {}).get("role")))
        return {"success": True, "data": {"ok": True}, "error": None}

    monkeypatch.setattr(sockethandlers.authsvc, "is_setup_required", _is_setup_required)
    monkeypatch.setattr(sockethandlers.authsvc, "authenticate_token", _authenticate_token)
    monkeypatch.setattr(sockethandlers, "dispatch_request", _dispatch_request)

    connect_reply = await connect("sid-1", {"REMOTE_ADDR": "127.0.0.1"}, {"token": "token-1"})
    assert connect_reply is not False

    reply = await api_call("sid-1", {"cmd": "fetch-preferences", "data": None})
    assert reply["success"] is True
    assert auth_calls["count"] == 2
    assert dispatch_auth_roles == ["operator"]
    assert sio.disconnect_calls == []


@pytest.mark.asyncio
async def test_session_snapshot_commands_work_for_authenticated_user(monkeypatch):
    sio = _FakeSio()
    sockethandlers.register_socketio_handlers(sio)
    connect = sio.handlers["connect"]
    api_call = sio.handlers["api.call"]

    async def _is_setup_required(force_refresh: bool = False):
        del force_refresh
        return False

    async def _authenticate_token(token: str | None):
        assert token == "token-snapshot"
        return {"username": "admin", "role": "admin"}

    def _get_runtime_snapshot():
        return {
            "sessions": {"sid-snapshot": {"sdr_id": "sdr-1"}},
            "sdrs": {"sdr-1": {"clients": ["sid-snapshot"]}},
        }

    def _get_session_sdr(_session_id: str):
        return "sdr-1"

    def _get_session_rig(_session_id: str):
        return "rig-1"

    def _get_session_vfo_int(_session_id: str):
        return 1

    def _get_session_ip(_session_id: str):
        return "127.0.0.1"

    def _get_session_config(_session_id: str):
        return {"band": "VHF"}

    monkeypatch.setattr(sockethandlers.authsvc, "is_setup_required", _is_setup_required)
    monkeypatch.setattr(sockethandlers.authsvc, "authenticate_token", _authenticate_token)
    monkeypatch.setattr(
        sessionhandlers.session_service, "get_runtime_snapshot", _get_runtime_snapshot
    )
    monkeypatch.setattr(sessionhandlers.session_tracker, "get_session_sdr", _get_session_sdr)
    monkeypatch.setattr(sessionhandlers.session_tracker, "get_session_rig", _get_session_rig)
    monkeypatch.setattr(
        sessionhandlers.session_tracker, "get_session_vfo_int", _get_session_vfo_int
    )
    monkeypatch.setattr(sessionhandlers.session_tracker, "get_session_ip", _get_session_ip)
    monkeypatch.setattr(sessionhandlers.session_service, "get_session_config", _get_session_config)

    connect_reply = await connect(
        "sid-snapshot",
        {"REMOTE_ADDR": "127.0.0.1"},
        {"token": "token-snapshot"},
    )
    assert connect_reply is not False

    runtime_reply = await api_call("sid-snapshot", {"cmd": "fetch_runtime_snapshot", "data": None})
    session_reply = await api_call(
        "sid-snapshot",
        {"cmd": "fetch_session_view", "data": {"session_id": "sid-snapshot"}},
    )

    assert runtime_reply["success"] is True
    assert runtime_reply["data"]["sessions"]["sid-snapshot"]["ip"] == "127.0.0.1"
    assert session_reply == {
        "success": True,
        "data": {
            "session_id": "sid-snapshot",
            "sdr_id": "sdr-1",
            "rig_id": "rig-1",
            "vfo": 1,
            "ip": "127.0.0.1",
            "config": {"band": "VHF"},
        },
        "error": None,
    }


@pytest.mark.asyncio
async def test_connect_persists_authenticated_owner_metadata(monkeypatch):
    sio = _FakeSio()
    sockethandlers.register_socketio_handlers(sio)
    connect = sio.handlers["connect"]

    async def _is_setup_required(force_refresh: bool = False):
        del force_refresh
        return False

    async def _authenticate_token(token: str | None):
        assert token == "token-owner"
        return {
            "session_id": "auth-session-1",
            "user_id": "user-123",
            "username": "owner",
            "role": "admin",
            "is_active": True,
        }

    captured_metadata: Dict[str, Any] = {}

    def _set_session_metadata(sid: str, **kwargs):
        captured_metadata["sid"] = sid
        captured_metadata["kwargs"] = kwargs

    monkeypatch.setattr(sockethandlers.authsvc, "is_setup_required", _is_setup_required)
    monkeypatch.setattr(sockethandlers.authsvc, "authenticate_token", _authenticate_token)
    monkeypatch.setattr(
        sockethandlers.session_tracker, "set_session_metadata", _set_session_metadata
    )

    connect_reply = await connect(
        "sid-owner",
        {
            "REMOTE_ADDR": "10.0.0.2",
            "HTTP_USER_AGENT": "UA/Test",
            "HTTP_ORIGIN": "https://app.local",
            "HTTP_REFERER": "https://app.local/admin/system/maintenance",
        },
        {"token": "token-owner"},
    )
    assert connect_reply is not False

    assert captured_metadata["sid"] == "sid-owner"
    metadata_kwargs = captured_metadata["kwargs"]
    assert metadata_kwargs["ip_address"] == "10.0.0.2"
    assert metadata_kwargs["user_agent"] == "UA/Test"
    assert metadata_kwargs["origin"] == "https://app.local"
    assert metadata_kwargs["referer"] == "https://app.local/admin/system/maintenance"
    assert isinstance(metadata_kwargs["connected_at"], float)
    assert metadata_kwargs["user_id"] == "user-123"
    assert metadata_kwargs["username"] == "owner"
    assert metadata_kwargs["role"] == "admin"


@pytest.mark.asyncio
async def test_api_call_disconnects_when_session_is_revoked(monkeypatch):
    sio = _FakeSio()
    sockethandlers.register_socketio_handlers(sio)
    connect = sio.handlers["connect"]
    api_call = sio.handlers["api.call"]

    async def _is_setup_required(force_refresh: bool = False):
        del force_refresh
        return False

    auth_calls = {"count": 0}

    async def _authenticate_token(token: str | None):
        auth_calls["count"] += 1
        assert token == "token-2"
        if auth_calls["count"] == 1:
            return {"username": "admin", "role": "admin"}
        return None

    async def _dispatch_request(*args, **kwargs):
        del args, kwargs
        raise AssertionError("dispatch_request should not be called when auth is invalidated")

    monkeypatch.setattr(sockethandlers.authsvc, "is_setup_required", _is_setup_required)
    monkeypatch.setattr(sockethandlers.authsvc, "authenticate_token", _authenticate_token)
    monkeypatch.setattr(sockethandlers, "dispatch_request", _dispatch_request)

    connect_reply = await connect("sid-2", {"REMOTE_ADDR": "127.0.0.1"}, {"token": "token-2"})
    assert connect_reply is not False

    reply = await api_call("sid-2", {"cmd": "fetch-preferences", "data": None})
    assert reply["success"] is False
    assert reply["error"] == "Authentication required."
    assert sio.disconnect_calls == ["sid-2"]
    assert "sid-2" not in sockethandlers.SOCKET_TOKENS
    assert "sid-2" not in sockethandlers.SOCKET_AUTH


@pytest.mark.asyncio
async def test_setup_socket_without_token_is_not_force_disconnected_after_setup_completes(
    monkeypatch,
):
    sio = _FakeSio()
    sockethandlers.register_socketio_handlers(sio)
    connect = sio.handlers["connect"]
    api_call = sio.handlers["api.call"]

    setup_required_state = {"value": True}

    async def _is_setup_required(force_refresh: bool = False):
        del force_refresh
        return setup_required_state["value"]

    async def _authenticate_token(token: str | None):
        assert token is None
        return None

    async def _dispatch_request(*args, **kwargs):
        del args, kwargs
        raise AssertionError(
            "dispatch_request should not be called once setup mode ends without auth"
        )

    monkeypatch.setattr(sockethandlers.authsvc, "is_setup_required", _is_setup_required)
    monkeypatch.setattr(sockethandlers.authsvc, "authenticate_token", _authenticate_token)
    monkeypatch.setattr(sockethandlers, "dispatch_request", _dispatch_request)

    connect_reply = await connect("sid-3", {"REMOTE_ADDR": "127.0.0.1"}, None)
    assert connect_reply is not False

    setup_required_state["value"] = False
    reply = await api_call("sid-3", {"cmd": "setup.status", "data": None})
    assert reply["success"] is False
    assert reply["error"] == "Authentication required."
    assert sio.disconnect_calls == []


@pytest.mark.asyncio
async def test_setup_socket_with_stale_token_is_not_force_disconnected_after_setup_completes(
    monkeypatch,
):
    sio = _FakeSio()
    sockethandlers.register_socketio_handlers(sio)
    connect = sio.handlers["connect"]
    api_call = sio.handlers["api.call"]

    setup_required_state = {"value": True}

    async def _is_setup_required(force_refresh: bool = False):
        del force_refresh
        return setup_required_state["value"]

    async def _authenticate_token(token: str | None):
        # Simulate stale/invalid cookie token while setup is still required.
        assert token == "stale-token"
        return None

    async def _dispatch_request(*args, **kwargs):
        del args, kwargs
        raise AssertionError(
            "dispatch_request should not be called once setup mode ends without auth"
        )

    monkeypatch.setattr(sockethandlers.authsvc, "is_setup_required", _is_setup_required)
    monkeypatch.setattr(sockethandlers.authsvc, "authenticate_token", _authenticate_token)
    monkeypatch.setattr(sockethandlers, "dispatch_request", _dispatch_request)

    connect_reply = await connect(
        "sid-4", {"REMOTE_ADDR": "127.0.0.1", "HTTP_COOKIE": "gs_session=stale-token"}, None
    )
    assert connect_reply is not False
    assert "sid-4" not in sockethandlers.SOCKET_TOKENS

    setup_required_state["value"] = False
    reply = await api_call("sid-4", {"cmd": "setup.status", "data": None})
    assert reply["success"] is False
    assert reply["error"] == "Authentication required."
    assert sio.disconnect_calls == []
