import logging
from unittest.mock import AsyncMock, Mock

import pytest

from handlers.entities import sdr as sdrhandlers
from handlers.entities import vfo as vfohandlers
from hardware import parameters as sdrparameters
from session.background import background_sessions
from session.tracker import session_tracker
from vfos.state import VFOManager


@pytest.fixture(autouse=True)
def receivingstate(monkeypatch):
    monkeypatch.setattr(background_sessions, "sessions", {})
    monkeypatch.setattr(background_sessions, "controllers", {})


class _DbSession:
    async def __aenter__(self):
        return object()

    async def __aexit__(self, *_args):
        return False


class _SocketServer:
    def __init__(self):
        self.entered = []
        self.left = []
        self.emitted = []

    async def enter_room(self, session_id, room):
        self.entered.append((session_id, room))

    async def leave_room(self, session_id, room):
        self.left.append((session_id, room))

    async def emit(self, *_args, **_kwargs):
        self.emitted.append((_args, _kwargs))


@pytest.mark.asyncio
async def test_start_failure_returns_error_without_emitting_second_event(monkeypatch):
    monkeypatch.setattr(sdrhandlers, "AsyncSessionLocal", _DbSession)
    monkeypatch.setattr(sdrhandlers.process_manager, "processes", {})
    monkeypatch.setattr(
        sdrhandlers.crud.hardware,
        "fetch_sdr",
        AsyncMock(return_value={"success": True, "data": {"id": "sdr-a", "type": "airspy"}}),
    )
    monkeypatch.setattr(sdrhandlers.session_service, "session_exists", lambda _sid: True)
    monkeypatch.setattr(
        sdrhandlers.session_service, "get_session_config", lambda _sid: {"sdr_id": "sdr-a"}
    )
    monkeypatch.setattr(
        sdrhandlers.session_service,
        "start_streaming",
        AsyncMock(side_effect=RuntimeError("AIRSPY_ERROR_NOT_FOUND (code -5)")),
    )
    sio = _SocketServer()

    response = await sdrhandlers.sdr_command_routing(
        sio, "start-streaming", {"selectedSDRId": "sdr-a"}, logging.getLogger(__name__), "viewer"
    )

    assert response["success"] is False
    assert response["error"] == "Failed to start SDR stream: AIRSPY_ERROR_NOT_FOUND (code -5)"
    assert sio.emitted == []


def _set_active_sdr(monkeypatch):
    process_info = {
        "clients": {"internal:obs-123"},
        "config": {"center_freq": 145_800_000, "sample_rate": 2_048_000, "gain": 20},
    }
    monkeypatch.setattr(sdrhandlers, "AsyncSessionLocal", _DbSession)
    processes = {"sdr-a": process_info}
    monkeypatch.setattr(sdrhandlers.process_manager, "processes", processes)
    monkeypatch.setattr(sdrhandlers.process_manager.lifecycle_manager, "processes", processes)
    monkeypatch.setattr(
        sdrhandlers.process_manager, "is_sdr_process_running", lambda sdr_id: sdr_id == "sdr-a"
    )
    return process_info


def test_lists_other_clients():
    original_processes = sdrhandlers.process_manager.processes
    sdrhandlers.process_manager.processes = {
        "sdr-a": {
            "clients": {"caller-session", "other-session", "internal:obs-123"},
        }
    }
    try:
        other_clients = sdrhandlers._list_other_sdr_clients("sdr-a", "caller-session")
    finally:
        sdrhandlers.process_manager.processes = original_processes

    assert other_clients == ["internal:obs-123", "other-session"]


def test_builds_conflict_payload_with_internal_flag(monkeypatch):
    monkeypatch.setattr(
        sdrhandlers.session_tracker,
        "get_session_metadata",
        lambda sid: {"username": "observer"} if sid == "other-session" else {},
    )

    conflict = sdrhandlers._build_sdr_in_use_conflict(
        "sdr-a",
        ["internal:obs-123", "other-session"],
        operation="start-streaming",
    )

    assert conflict["error_code"] == sdrhandlers.SDR_IN_USE_CONFLICT_CODE
    assert conflict["sdr_id"] == "sdr-a"
    assert conflict["other_session_count"] == 2
    assert conflict["includes_internal_observation"] is True
    assert any(
        session.get("session_id") == "other-session" and session.get("username") == "observer"
        for session in conflict["other_sessions"]
    )


@pytest.mark.asyncio
async def test_join_claims_worker_lifetime_without_configuring_it(monkeypatch):
    process_info = _set_active_sdr(monkeypatch)
    process_info["config_queue"] = Mock()
    monkeypatch.setitem(
        sdrparameters.sdr_parameters_cache,
        ("sdr-a", ""),
        {"gain_values": [0, 10, 20], "antennas": {"rx": ["RX", "AUX"], "tx": []}},
    )
    sio = _SocketServer()
    configure = AsyncMock()
    monkeypatch.setattr(sdrhandlers.session_service, "configure_sdr", configure)

    inspection = await sdrhandlers.sdr_command_routing(
        sio, "inspect-sdr", {"selectedSDRId": "sdr-a"}, logging.getLogger(__name__), "viewer"
    )
    joined = await sdrhandlers.sdr_command_routing(
        sio, "join-sdr", {"selectedSDRId": "sdr-a"}, logging.getLogger(__name__), "viewer"
    )

    assert inspection["data"]["conflict"]["includes_internal_observation"] is True
    assert joined["success"] is True
    assert joined["data"]["config"]["center_freq"] == 145_800_000
    assert joined["data"]["parameters"]["gain_values"] == [0, 10, 20]
    receiving_id = joined["data"]["session_id"]
    assert receiving_id != "viewer"
    assert sio.entered == [("viewer", "sdr-a"), ("viewer", receiving_id)]
    assert process_info["clients"] == {"internal:obs-123", receiving_id}
    assert process_info["joiners"] == {receiving_id}
    assert session_tracker.get_session_sdr(receiving_id) == "sdr-a"
    configure.assert_not_awaited()
    process_info["config_queue"].put.assert_not_called()

    await sdrhandlers.sdr_command_routing(
        sio, "leave-sdr", {"selectedSDRId": "sdr-a"}, logging.getLogger(__name__), "viewer"
    )
    assert sio.left == [("viewer", "sdr-a"), ("viewer", receiving_id)]
    assert process_info["joiners"] == set()
    assert process_info["clients"] == {"internal:obs-123"}
    assert session_tracker.get_session_sdr(receiving_id) is None


@pytest.mark.asyncio
async def test_join_keeps_worker_capabilities_after_saved_sdr_is_edited(monkeypatch):
    process_info = _set_active_sdr(monkeypatch)
    process_info["parameters"] = {"gain_values": [0, 10, 20]}
    monkeypatch.setattr(sdrparameters, "sdr_parameters_cache", {})

    sio = _SocketServer()
    joined = await sdrhandlers.sdr_command_routing(
        sio,
        "join-sdr",
        {"selectedSDRId": "sdr-a"},
        logging.getLogger(__name__),
        "viewer",
    )

    assert joined["success"] is True
    assert joined["data"]["parameters"] == process_info["parameters"]
    await sdrhandlers.sdr_command_routing(
        sio, "leave-sdr", {"selectedSDRId": "sdr-a"}, logging.getLogger(__name__), "viewer"
    )


@pytest.mark.asyncio
async def test_joiner_vfo_uses_own_consumer_and_cannot_tune_outside_live_band(monkeypatch):
    process_info = _set_active_sdr(monkeypatch)
    sio = _SocketServer()
    starts = []
    monkeypatch.setattr(
        sdrhandlers,
        "start_demodulator_for_mode",
        lambda mode, sdr_id, session_id, _logger, vfo_number=None: starts.append(
            (mode, sdr_id, session_id, vfo_number)
        )
        or True,
    )
    monkeypatch.setattr(vfohandlers, "handle_vfo_decoder_state", AsyncMock())

    await sdrhandlers.sdr_command_routing(
        sio, "join-sdr", {"selectedSDRId": "sdr-a"}, logging.getLogger(__name__), "viewer"
    )
    receiving_id = background_sessions.resolve("viewer")
    accepted = await vfohandlers.update_vfo_parameters(
        sio,
        {"vfoNumber": 1, "frequency": 145_810_000, "mode": "FM", "active": True},
        logging.getLogger(__name__),
        "viewer",
    )
    rejected = await vfohandlers.update_vfo_parameters(
        sio,
        {"vfoNumber": 1, "frequency": 150_000_000, "mode": "FM", "active": True},
        logging.getLogger(__name__),
        "viewer",
    )

    assert accepted["success"] is True
    assert rejected["success"] is False
    assert "live SDR bandwidth" in rejected["error"]
    assert starts == [("FM", "sdr-a", receiving_id, 1)]
    assert process_info["clients"] == {"internal:obs-123", receiving_id}
    assert process_info["config"]["center_freq"] == 145_800_000
    assert VFOManager().get_vfo_state(receiving_id, 1).center_freq == 145_810_000

    await sdrhandlers.sdr_command_routing(
        sio, "leave-sdr", {"selectedSDRId": "sdr-a"}, logging.getLogger(__name__), "viewer"
    )
    assert receiving_id not in VFOManager().get_all_session_ids()


@pytest.mark.asyncio
async def test_disconnect_detaches_joiner_without_stopping_observation(monkeypatch):
    from session import service as service_module

    process_info = _set_active_sdr(monkeypatch)
    sio = _SocketServer()
    monkeypatch.setattr(service_module.runtimestate, "process_manager", sdrhandlers.process_manager)
    monkeypatch.setattr(sdrhandlers.process_manager.lifecycle_manager, "sio", sio)
    stop_process = AsyncMock()
    monkeypatch.setattr(sdrhandlers.process_manager, "stop_sdr_process", stop_process)

    await sdrhandlers.sdr_command_routing(
        sio, "join-sdr", {"selectedSDRId": "sdr-a"}, logging.getLogger(__name__), "viewer"
    )
    receiving_id = background_sessions.resolve("viewer")
    await service_module.session_service.disconnect_session("viewer")

    assert process_info["clients"] == {"internal:obs-123"}
    assert process_info["joiners"] == set()
    assert session_tracker.get_session_sdr(receiving_id) is None
    assert sio.left == [("viewer", "sdr-a"), ("viewer", receiving_id)]
    stop_process.assert_not_awaited()


@pytest.mark.asyncio
async def test_joiner_keeps_worker_alive_after_owner_leaves_and_stops_it_last(monkeypatch):
    process_info = _set_active_sdr(monkeypatch)
    process_info["clients"] = {"owner"}
    process_info["process"] = Mock(is_alive=Mock(return_value=False))
    process_info["stop_event"] = Mock()
    sio = _SocketServer()
    lifecycle = sdrhandlers.process_manager.lifecycle_manager
    monkeypatch.setattr(lifecycle, "sio", sio)
    for manager, method in (
        (lifecycle.demodulator_manager, "stop_demodulator"),
        (lifecycle.recorder_manager, "stop_recorder"),
        (lifecycle.decoder_manager, "stop_decoder"),
        (lifecycle.audio_recorder_manager, "stop_audio_recorder"),
    ):
        monkeypatch.setattr(manager, method, Mock())
    if lifecycle.transcription_manager:
        monkeypatch.setattr(lifecycle.transcription_manager, "stop_transcription", Mock())

    joined = await sdrhandlers.sdr_command_routing(
        sio, "join-sdr", {"selectedSDRId": "sdr-a"}, logging.getLogger(__name__), "joiner"
    )
    assert joined["success"] is True
    receiving_id = joined["data"]["session_id"]
    VFOManager().update_vfo_state(receiving_id, 1, center_freq=145_810_000, active=True)

    await lifecycle.stop_sdr_process("sdr-a", "owner")

    assert sdrhandlers.process_manager.processes["sdr-a"] is process_info
    assert process_info["clients"] == {receiving_id}
    assert process_info["joiners"] == {receiving_id}
    assert not process_info["stop_event"].set.called
    assert session_tracker.get_session_sdr(receiving_id) == "sdr-a"
    assert VFOManager().get_vfo_state(receiving_id, 1).active is True
    starts = []
    monkeypatch.setattr(
        sdrhandlers,
        "start_demodulator_for_mode",
        lambda mode, sdr_id, session_id, _logger, vfo_number=None: starts.append(
            (mode, sdr_id, session_id, vfo_number)
        )
        or True,
    )
    monkeypatch.setattr(vfohandlers, "handle_vfo_decoder_state", AsyncMock())
    vfo_reply = await vfohandlers.update_vfo_parameters(
        sio,
        {"vfoNumber": 1, "frequency": 145_820_000, "mode": "FM", "active": True},
        logging.getLogger(__name__),
        "joiner",
    )
    assert vfo_reply["success"] is True
    assert starts == [("FM", "sdr-a", receiving_id, 1)]

    left = await sdrhandlers.sdr_command_routing(
        sio, "leave-sdr", {"selectedSDRId": "sdr-a"}, logging.getLogger(__name__), "joiner"
    )

    assert left["success"] is True
    assert "sdr-a" not in sdrhandlers.process_manager.processes
    process_info["stop_event"].set.assert_called_once()
    assert session_tracker.get_session_sdr(receiving_id) is None
    assert receiving_id not in VFOManager().get_all_session_ids()
    assert sio.left == [("owner", "sdr-a"), ("joiner", "sdr-a"), ("joiner", receiving_id)]


@pytest.mark.asyncio
async def test_worker_failure_detaches_joiner_without_recursive_teardown(monkeypatch):
    process_info = _set_active_sdr(monkeypatch)
    process_info["clients"] = {"owner", "joiner"}
    process_info["joiners"] = {"joiner"}
    process_info["process"] = Mock(is_alive=Mock(return_value=False))
    process_info["stop_event"] = Mock()
    sio = _SocketServer()
    lifecycle = sdrhandlers.process_manager.lifecycle_manager
    monkeypatch.setattr(lifecycle, "sio", sio)
    for manager, method in (
        (lifecycle.demodulator_manager, "stop_demodulator"),
        (lifecycle.recorder_manager, "stop_recorder"),
        (lifecycle.decoder_manager, "stop_decoder"),
    ):
        monkeypatch.setattr(manager, method, Mock())
    if lifecycle.transcription_manager:
        monkeypatch.setattr(lifecycle.transcription_manager, "stop_transcription", Mock())
    session_tracker.register_session_streaming("joiner", "sdr-a")

    await lifecycle.stop_sdr_process("sdr-a")

    assert "sdr-a" not in sdrhandlers.process_manager.processes
    assert session_tracker.get_session_sdr("joiner") is None
    assert set(sio.left) == {("joiner", "sdr-a"), ("owner", "sdr-a")}


@pytest.mark.asyncio
async def test_joiner_cannot_reconfigure_when_it_is_only_remaining_client(monkeypatch):
    process_info = _set_active_sdr(monkeypatch)
    process_info["clients"] = {"viewer"}
    process_info["joiners"] = {"viewer"}
    monkeypatch.setattr(
        sdrhandlers.crud.hardware,
        "fetch_sdr",
        AsyncMock(
            return_value={
                "success": True,
                "data": {
                    "id": "sdr-a",
                    "type": "rtlsdrusbv3",
                    "serial": "123",
                    "frequency_min": 24,
                    "frequency_max": 1766,
                },
            }
        ),
    )
    configure = AsyncMock()
    monkeypatch.setattr(sdrhandlers.session_service, "configure_sdr", configure)

    response = await sdrhandlers.sdr_command_routing(
        _SocketServer(),
        "configure-sdr",
        {"selectedSDRId": "sdr-a", "centerFrequency": 145_800_000},
        logging.getLogger(__name__),
        "viewer",
    )

    assert response["error_code"] == "sdr_in_use_conflict"
    assert "Take Over" in response["error"]
    assert response["data"]["other_session_count"] == 0
    configure.assert_not_awaited()


@pytest.mark.asyncio
async def test_controller_cannot_join_or_leave_its_active_room(monkeypatch):
    process_info = _set_active_sdr(monkeypatch)
    process_info["clients"].add("controller")
    sio = _SocketServer()

    joined = await sdrhandlers.sdr_command_routing(
        sio, "join-sdr", {"selectedSDRId": "sdr-a"}, logging.getLogger(__name__), "controller"
    )
    left = await sdrhandlers.sdr_command_routing(
        sio, "leave-sdr", {"selectedSDRId": "sdr-a"}, logging.getLogger(__name__), "controller"
    )

    assert joined["success"] is False
    assert left["success"] is False
    assert process_info["clients"] == {"internal:obs-123", "controller"}
    assert sio.entered == []
    assert sio.left == []


@pytest.mark.asyncio
async def test_any_configure_request_needs_takeover_while_observation_uses_sdr(monkeypatch):
    _set_active_sdr(monkeypatch)
    sio = _SocketServer()
    configure = AsyncMock()
    monkeypatch.setattr(sdrhandlers.session_service, "configure_sdr", configure)
    monkeypatch.setattr(
        sdrhandlers.crud.hardware,
        "fetch_sdr",
        AsyncMock(
            return_value={
                "success": True,
                "data": {
                    "id": "sdr-a",
                    "type": "rtlsdrusbv3",
                    "serial": "123",
                    "frequency_min": 24,
                    "frequency_max": 1766,
                },
            }
        ),
    )

    # Even with the same center frequency, a new sample rate would disrupt capture.
    response = await sdrhandlers.sdr_command_routing(
        sio,
        "configure-sdr",
        {"selectedSDRId": "sdr-a", "centerFrequency": 145_800_000, "sampleRate": 1_024_000},
        logging.getLogger(__name__),
        "viewer",
    )

    assert response["error_code"] == "sdr_in_use_conflict"
    assert response["data"]["operation"] == "configure-sdr"
    configure.assert_not_awaited()

    update = AsyncMock()
    monkeypatch.setattr(sdrhandlers.process_manager, "update_configuration", update)
    approved = await sdrhandlers.sdr_command_routing(
        sio,
        "configure-sdr",
        {
            "selectedSDRId": "sdr-a",
            "centerFrequency": 145_800_000,
            "sampleRate": 1_024_000,
            "forceTakeover": True,
        },
        logging.getLogger(__name__),
        "viewer",
    )
    assert approved["success"] is True
    configure.assert_awaited_once()
    update.assert_awaited_once()


@pytest.mark.asyncio
async def test_playback_seek_requires_takeover_from_watcher(monkeypatch):
    _set_active_sdr(monkeypatch)
    process_info = sdrhandlers.process_manager.processes.pop("sdr-a")
    sdrhandlers.process_manager.processes["sigmf-playback"] = process_info
    monkeypatch.setattr(
        sdrhandlers.process_manager,
        "is_sdr_process_running",
        lambda sdr_id: sdr_id == "sigmf-playback",
    )
    update = AsyncMock()
    monkeypatch.setattr(sdrhandlers.process_manager, "update_configuration", update)
    monkeypatch.setattr(sdrhandlers.session_service, "session_exists", lambda _sid: False)

    response = await sdrhandlers.sdr_command_routing(
        _SocketServer(),
        "seek-playback",
        {"selectedSDRId": "sigmf-playback", "positionSeconds": 10},
        logging.getLogger(__name__),
        "viewer",
    )
    assert response["error_code"] == "sdr_in_use_conflict"
    update.assert_not_awaited()

    approved = await sdrhandlers.sdr_command_routing(
        _SocketServer(),
        "seek-playback",
        {"selectedSDRId": "sigmf-playback", "positionSeconds": 10, "forceTakeover": True},
        logging.getLogger(__name__),
        "viewer",
    )
    assert approved["success"] is True
    update.assert_awaited_once()
