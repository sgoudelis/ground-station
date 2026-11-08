"""Background reception keeps consumers intact and hands control to one JOINer."""

import asyncio
import logging
import queue
from threading import Event
from unittest.mock import AsyncMock, Mock

import pytest

from handlers.entities import sdr as sdrhandlers
from handlers.entities import vfo as vfohandlers
from pipeline.config.decoderconfig import DecoderConfig
from pipeline.orchestration import processlifecycle
from pipeline.streaming.iqbroadcaster import IQBroadcaster
from session import service, store, tracker
from session.background import background_sessions
from session.tracker import session_tracker
from vfos.parameters import decoder_parameter_overrides
from vfos.state import VFOManager

pytestmark = pytest.mark.unit


class Database:
    async def __aenter__(self):
        return Mock(
            execute=AsyncMock(return_value=Mock(scalar_one_or_none=Mock(return_value=None)))
        )

    async def __aexit__(self, *_args):
        return False


class Socket:
    def __init__(self):
        self.entered = []
        self.left = []
        self.emitted = []

    async def enter_room(self, sid, room):
        self.entered.append((sid, room))
        await asyncio.sleep(0)

    async def leave_room(self, sid, room):
        self.left.append((sid, room))

    async def emit(self, *args, **kwargs):
        self.emitted.append((args, kwargs))


@pytest.fixture
def receiving(monkeypatch):
    stop_event = Event()
    decoder = Mock(decoder_id="decoder-original", is_alive=Mock(return_value=True))
    pipeline = {
        "clients": {"original"},
        "joiners": set(),
        "config": {"center_freq": 145_800_000, "sample_rate": 2_048_000, "gain": 20},
        "process": Mock(is_alive=lambda: not stop_event.is_set()),
        "fft_process": None,
        "stop_event": stop_event,
        "iq_broadcaster": Mock(),
        "config_queue": Mock(),
        "demodulators": {"original": {1: {"instance": object()}}},
        "recorders": {"original": {"instance": Mock(start_time_iso="2026-11-03T10:00:00Z")}},
        "audio_recorders": {
            "original": {1: {"instance": Mock(total_samples=441_000, sample_rate=44_100)}}
        },
        "decoders": {
            "original": {
                2: {
                    "instance": decoder,
                    "config": DecoderConfig(
                        baudrate=4800, framing="ax25", config_source="manual", deviation=2400
                    ),
                }
            }
        },
    }
    socket = Socket()
    processes = {"radio": pipeline}
    manager = sdrhandlers.process_manager
    lifecycle = manager.lifecycle_manager
    monkeypatch.setattr(manager, "processes", processes)
    monkeypatch.setattr(lifecycle, "processes", processes)
    monkeypatch.setattr(lifecycle, "sio", socket)
    monkeypatch.setattr(service.runtimestate, "process_manager", manager)
    monkeypatch.setattr(service.runtimestate, "audio_consumer", None)
    monkeypatch.setattr(sdrhandlers, "AsyncSessionLocal", Database)
    monkeypatch.setattr(vfohandlers, "AsyncSessionLocal", Database)
    monkeypatch.setattr(background_sessions, "sessions", {})
    monkeypatch.setattr(background_sessions, "controllers", {})
    monkeypatch.setattr(session_tracker, "_session_sdr_map", {"original": "radio"})
    monkeypatch.setattr(session_tracker, "_session_vfo_map", {})
    monkeypatch.setattr(session_tracker, "_session_metadata", {})
    monkeypatch.setattr(session_tracker, "_session_ip_map", {})
    monkeypatch.setattr(VFOManager(), "_session_vfo_states", {})
    configs = {"original": {"sdr_id": "radio"}}
    for module in (service, store, tracker, processlifecycle, sdrhandlers):
        monkeypatch.setattr(module, "active_sdr_clients", configs)
    monkeypatch.setattr(
        sdrhandlers.crud.hardware,
        "fetch_sdr",
        AsyncMock(return_value={"success": True, "data": {"id": "radio", "type": "airspy"}}),
    )
    for consumer_manager, method in (
        (lifecycle.demodulator_manager, "stop_demodulator"),
        (lifecycle.recorder_manager, "stop_recorder"),
        (lifecycle.decoder_manager, "stop_decoder"),
        (lifecycle.audio_recorder_manager, "stop_audio_recorder"),
    ):
        monkeypatch.setattr(consumer_manager, "processes", processes)
        monkeypatch.setattr(consumer_manager, method, Mock())
    monkeypatch.setattr(lifecycle, "transcription_manager", None)
    monkeypatch.setattr(manager, "transcription_manager", None)
    decoder_parameter_overrides.clear()
    VFOManager().update_vfo_state("original", 1, center_freq=145_810_000, active=True)
    VFOManager().update_vfo_state(
        "original",
        2,
        center_freq=145_820_000,
        active=True,
        decoder="fsk",
        locked_transmitter_id="transmitter",
        doppler_status="tracking",
    )
    yield socket, pipeline, manager
    decoder_parameter_overrides.clear()


async def command(socket, cmd, sid="original", **data):
    return await sdrhandlers.sdr_command_routing(
        socket, cmd, {"selectedSDRId": "radio", **data}, logging.getLogger(__name__), sid
    )


async def detach(socket):
    assert (await command(socket, "set-background", enabled=True))["success"]
    await service.session_service.disconnect_session("original")


@pytest.fixture
def independent(receiving):
    """Model workers started with a receiving ID separate from their browser."""
    socket, pipeline, manager = receiving
    session = background_sessions.start("original", "radio")
    session_id = session.session_id
    pipeline["clients"] = {session_id}
    for key in ("demodulators", "recorders", "audio_recorders", "decoders"):
        pipeline[key][session_id] = pipeline[key].pop("original")
    store.active_sdr_clients[session_id] = store.active_sdr_clients.pop("original")
    session_tracker.unregister_session_streaming("original")
    session_tracker.register_session_streaming(session_id, "radio")
    vfos = VFOManager()._session_vfo_states
    vfos[session_id] = vfos.pop("original")
    return socket, pipeline, manager, session_id


@pytest.mark.asyncio
async def test_configure_reserves_receiving_identity_without_reconnecting_browser(receiving):
    socket, _pipeline, _manager = receiving
    session_tracker.set_session_metadata("browser", username="observer")
    reply = await command(
        socket,
        "configure-sdr",
        "browser",
        selectedSDRId="sigmf-playback",
        centerFrequency=145_800_000,
        sampleRate=2_048_000,
    )
    assert reply["success"]
    session_id = reply["data"]["session_id"]
    assert session_id != "browser"
    assert background_sessions.resolve("browser") == session_id
    assert not background_sessions.sessions[session_id].enabled
    assert store.active_sdr_clients[session_id]["client_id"] == session_id
    assert session_tracker.get_session_metadata(session_id)["username"] == "observer"
    assert ("browser", session_id) in socket.entered
    broadcaster = IQBroadcaster(queue.Queue(), "radio")
    for subscription in (f"decoder:{session_id}:vfo1", f"recorder:{session_id}"):
        assert broadcaster._extract_session_id(subscription) == session_id


@pytest.mark.asyncio
async def test_detach_keeps_consumers_and_releases_only_reception_rooms(independent):
    socket, pipeline, manager, session_id = independent
    worker = pipeline["process"]
    decoder = pipeline["decoders"][session_id][2]["instance"]
    assert (await command(socket, "set-background", enabled=True))["success"]

    assert (await command(socket, "detach-streaming"))["success"]

    assert socket.left == [("original", "radio"), ("original", session_id)]
    assert background_sessions.sessions[session_id].controller is None
    assert background_sessions.resolve("original") == "original"
    assert pipeline["clients"] == {session_id}
    assert pipeline["process"] is worker
    assert pipeline["decoders"][session_id][2]["instance"] is decoder
    assert not pipeline["stop_event"].is_set()
    for consumer in (
        manager.decoder_manager.stop_decoder,
        manager.demodulator_manager.stop_demodulator,
        manager.recorder_manager.stop_recorder,
        manager.audio_recorder_manager.stop_audio_recorder,
    ):
        consumer.assert_not_called()
    state = VFOManager().get_vfo_state(session_id, 2)
    assert state.center_freq == 145_820_000
    assert state.locked_transmitter_id == "none"
    assert state.doppler_status == "idle"


@pytest.mark.asyncio
async def test_same_browser_can_rejoin_detach_and_disconnect_without_stopping_retained_run(
    independent,
):
    socket, pipeline, _manager, session_id = independent
    assert (await command(socket, "set-background", enabled=True))["success"]
    assert (await command(socket, "detach-streaming"))["success"]

    joined = await command(socket, "join-sdr")
    assert joined["success"]
    assert joined["data"]["observation"]["session_id"] == session_id
    assert joined["data"]["observation"]["is_recording"]
    assert background_sessions.resolve("original") == session_id
    assert (await command(socket, "detach-streaming"))["success"]
    assert (await command(socket, "join-sdr", "another-browser"))["success"]

    await service.session_service.disconnect_session("original")
    assert background_sessions.sessions[session_id].controller == "another-browser"
    assert pipeline["clients"] == {session_id}
    assert not pipeline["stop_event"].is_set()


@pytest.mark.asyncio
async def test_detached_browser_can_configure_another_stream_without_overwriting_retained_run(
    independent,
):
    socket, pipeline, _manager, session_id = independent
    assert (await command(socket, "set-background", enabled=True))["success"]
    assert (await command(socket, "detach-streaming"))["success"]
    reply = await command(
        socket,
        "configure-sdr",
        selectedSDRId="sigmf-playback",
        centerFrequency=100_000_000,
        sampleRate=1_024_000,
    )
    assert reply["success"]
    next_session = reply["data"]["session_id"]
    assert next_session not in ("original", session_id)
    assert background_sessions.resolve("original") == next_session
    assert store.active_sdr_clients[session_id]["sdr_id"] == "radio"
    assert store.active_sdr_clients[next_session]["sdr_id"] == "sigmf-playback"

    await service.session_service.disconnect_session("original")
    assert next_session not in background_sessions.sessions
    assert session_id in background_sessions.sessions
    assert not pipeline["stop_event"].is_set()


@pytest.mark.asyncio
async def test_detach_rejects_disabled_background_and_other_viewers(independent):
    socket, _pipeline, _manager, session_id = independent
    assert not (await command(socket, "detach-streaming"))["success"]
    assert (await command(socket, "set-background", enabled=True))["success"]
    assert (await command(socket, "join-sdr", "viewer"))["success"]
    assert not (await command(socket, "detach-streaming", "viewer"))["success"]
    assert background_sessions.sessions[session_id].controller == "original"


@pytest.mark.asyncio
async def test_failed_detach_restores_controller_subscriptions(independent, monkeypatch):
    socket, pipeline, _manager, session_id = independent
    assert (await command(socket, "set-background", enabled=True))["success"]
    monkeypatch.setattr(socket, "leave_room", AsyncMock(side_effect=RuntimeError("room failure")))

    reply = await command(socket, "detach-streaming")

    assert not reply["success"]
    assert background_sessions.sessions[session_id].controller == "original"
    assert background_sessions.resolve("original") == session_id
    assert socket.entered == [("original", "radio"), ("original", session_id)]
    assert not pipeline["stop_event"].is_set()


@pytest.mark.asyncio
async def test_configured_browser_can_join_as_viewer_using_its_receiving_identity(receiving):
    socket, pipeline, _manager = receiving
    # Keep the existing controller occupied so JOIN must create independent VFOs.
    assert (await command(socket, "set-background", enabled=True))["success"]
    configured = await command(
        socket,
        "configure-sdr",
        "browser",
        selectedSDRId="sigmf-playback",
        centerFrequency=100_000_000,
    )
    session_id = configured["data"]["session_id"]

    joined = await command(socket, "join-sdr", "browser")

    assert joined["success"]
    assert joined["data"]["observation"] is None
    assert joined["data"]["session_id"] == session_id
    assert session_id in pipeline["joiners"]
    assert session_tracker.get_session_sdr(session_id) == "radio"
    assert (await command(socket, "leave-sdr", "browser"))["success"]
    assert pipeline["clients"] == {"original"}
    assert session_id not in background_sessions.sessions


@pytest.mark.asyncio
async def test_default_disconnect_still_stops_the_pipeline(receiving):
    _socket, pipeline, manager = receiving
    await service.session_service.disconnect_session("original")
    assert pipeline["stop_event"].is_set()
    assert not manager.processes
    assert not background_sessions.sessions


@pytest.mark.asyncio
async def test_disconnect_freezes_frequencies_without_stopping_any_consumers(receiving):
    socket, pipeline, manager = receiving
    await detach(socket)

    assert pipeline["clients"] == {"original"}
    assert not pipeline["stop_event"].is_set()
    assert background_sessions.sessions["original"].controller is None
    manager.decoder_manager.stop_decoder.assert_not_called()
    manager.demodulator_manager.stop_demodulator.assert_not_called()
    manager.recorder_manager.stop_recorder.assert_not_called()
    manager.audio_recorder_manager.stop_audio_recorder.assert_not_called()
    state = VFOManager().get_vfo_state("original", 2)
    assert state.center_freq == 145_820_000
    assert state.locked_transmitter_id == "none"
    assert state.doppler_status == "idle"
    assert decoder_parameter_overrides["original_2"]["baudrate"] == 4800
    inspection = await command(socket, "inspect-sdr", "new")
    assert inspection["data"]["conflict"]["other_sessions"][0]["unattended"] is True


@pytest.mark.asyncio
async def test_join_adopts_same_pipeline_and_routes_vfo_close_to_original_session(
    receiving, monkeypatch
):
    socket, pipeline, manager = receiving
    worker = pipeline["process"]
    decoder = pipeline["decoders"]["original"][2]["instance"]
    await detach(socket)
    session_tracker.set_session_metadata(
        "new",
        ip_address="192.0.2.1",
        user_agent="test browser",
        origin="http://localhost",
        referer="http://localhost/waterfall",
        connected_at=123.0,
        username="new owner",
        user_id="user-new",
        role="user",
    )
    reply = await command(socket, "join-sdr", "new")

    observation = reply["data"]["observation"]
    assert observation["session_id"] == "original"
    assert observation["vfos"][2]["center_freq"] == 145_820_000
    assert observation["vfos"][2]["decoder_parameters"]["baudrate"] == 4800
    assert observation["is_recording"] is True
    assert observation["recording_start_time"] == "2026-11-03T10:00:00Z"
    assert observation["audio_recordings"] == [1]
    assert observation["audio_recording_durations"] == {1: 10.0}
    assert observation["decoder_statuses"][0]["decoder_id"] == "decoder-original"
    assert pipeline["process"] is worker
    assert pipeline["decoders"]["original"][2]["instance"] is decoder
    assert pipeline["clients"] == {"original"}
    assert ("new", "original") in socket.entered
    assert ("new", "radio") in socket.entered
    assert background_sessions.resolve("new") == "original"
    assert session_tracker.get_session_metadata("original")["username"] == "new owner"
    assert session_tracker.get_session_metadata("original")["ip"] == "192.0.2.1"
    pipeline["config_queue"].put.assert_not_called()
    manager.decoder_manager.stop_decoder.assert_not_called()

    monkeypatch.setattr(vfohandlers, "handle_vfo_demodulator_state", Mock())
    reply = await vfohandlers.update_vfo_parameters(
        socket, {"vfoNumber": 2, "active": False}, logging.getLogger(__name__), "new"
    )
    assert reply["success"]
    assert not VFOManager().get_vfo_state("original", 2).active
    manager.decoder_manager.stop_decoder.assert_called_with("radio", "original", 2)
    # Closing another VFO also finalizes its audio recorder under the retained ID.
    await vfohandlers.update_vfo_parameters(
        socket, {"vfoNumber": 1, "active": False}, logging.getLogger(__name__), "new"
    )
    manager.audio_recorder_manager.stop_audio_recorder.assert_called_with("radio", "original", 1)


@pytest.mark.asyncio
async def test_simultaneous_joiners_grant_one_controller_and_keep_other_vfos_separate(receiving):
    socket, pipeline, _manager = receiving
    await detach(socket)
    replies = await asyncio.gather(
        command(socket, "join-sdr", "first"), command(socket, "join-sdr", "second")
    )
    assert all(reply["success"] for reply in replies)
    assert sum(reply["data"]["observation"] is not None for reply in replies) == 1
    owner = background_sessions.sessions["original"].controller
    viewer = "second" if owner == "first" else "first"
    viewer_session = background_sessions.resolve(viewer)
    assert pipeline["clients"] == {"original", viewer_session}
    assert pipeline["joiners"] == {viewer_session}
    assert viewer_session != viewer
    assert not (await command(socket, "set-background", viewer, enabled=False))["success"]
    assert not (await command(socket, "claim-sdr", viewer))["success"]
    assert background_sessions.sessions["original"].controller == owner

    await service.session_service.disconnect_session(owner)
    assert background_sessions.sessions["original"].controller is None
    claimed = await command(socket, "claim-sdr", viewer)
    assert claimed["success"]
    assert claimed["data"]["observation"]["session_id"] == "original"
    assert pipeline["clients"] == {"original"}
    assert pipeline["joiners"] == set()


@pytest.mark.asyncio
async def test_original_user_returns_as_viewer_after_another_user_claims(receiving):
    socket, pipeline, _manager = receiving
    await detach(socket)
    await command(socket, "join-sdr", "new")
    returned = await command(socket, "join-sdr", "returning-original-user")
    assert returned["data"]["observation"] is None
    assert pipeline["joiners"] == {returned["data"]["session_id"]}
    assert background_sessions.sessions["original"].controller == "new"


@pytest.mark.asyncio
@pytest.mark.parametrize("stop_mode", ["disconnect", "explicit", "failure", "shutdown"])
async def test_retained_session_cleanup_and_other_participant_lifetime(receiving, stop_mode):
    socket, pipeline, manager = receiving
    await detach(socket)
    if stop_mode != "shutdown":
        await command(socket, "join-sdr", "new")
    if stop_mode in {"disconnect", "explicit"}:
        await command(socket, "join-sdr", "viewer")
        viewer_session = background_sessions.resolve("viewer")
        if stop_mode == "disconnect":
            await command(socket, "set-background", "new", enabled=False)
            await service.session_service.disconnect_session("new")
        else:
            assert (await command(socket, "stop-streaming", "new"))["success"]
        assert pipeline["clients"] == {viewer_session}
        assert not pipeline["stop_event"].is_set()
        await command(socket, "leave-sdr", "viewer")
    elif stop_mode == "failure":
        await manager.stop_sdr_process("radio")
    else:
        # Shutdown uses unconditional cleanup, not socket-disconnect semantics.
        await service.session_service.cleanup_session("original")
    assert pipeline["stop_event"].is_set()
    assert not manager.processes
    assert not background_sessions.sessions
    assert not background_sessions.controllers
    assert not decoder_parameter_overrides
    assert "original" not in store.active_sdr_clients
    assert "original" not in VFOManager().get_all_session_ids()


@pytest.mark.asyncio
async def test_failed_room_attachment_releases_claim_for_next_joiner(receiving, monkeypatch):
    socket, _pipeline, _manager = receiving
    await detach(socket)
    enter_room = socket.enter_room

    async def fail(sid, room):
        if room == "original":
            raise RuntimeError("socket disconnected")
        await enter_room(sid, room)

    monkeypatch.setattr(socket, "enter_room", fail)
    with pytest.raises(RuntimeError, match="socket disconnected"):
        await command(socket, "join-sdr", "first")
    assert background_sessions.sessions["original"].controller is None
    assert "first" not in background_sessions.controllers
    monkeypatch.setattr(socket, "enter_room", enter_room)
    assert (await command(socket, "join-sdr", "second"))["data"]["observation"]


@pytest.mark.asyncio
async def test_background_requires_boolean_and_live_controller(receiving):
    socket, _pipeline, _manager = receiving
    assert not (await command(socket, "set-background", enabled="false"))["success"]
    assert not (await command(socket, "set-background", "stranger", enabled=True))["success"]
    assert not background_sessions.sessions


@pytest.mark.asyncio
async def test_join_retry_is_idempotent_after_a_lost_acknowledgement(receiving):
    socket, pipeline, manager = receiving
    await detach(socket)
    for _ in range(2):
        reply = await command(socket, "join-sdr", "new")
        assert reply["data"]["observation"]["session_id"] == "original"
    assert pipeline["clients"] == {"original"}
    assert pipeline["joiners"] == set()
    manager.decoder_manager.stop_decoder.assert_not_called()


@pytest.mark.asyncio
async def test_cancelled_join_releases_its_controller_reservation(receiving, monkeypatch):
    socket, _pipeline, _manager = receiving
    await detach(socket)
    entered = asyncio.Event()
    enter_room = socket.enter_room

    async def blocked(sid, room):
        if room == "original":
            entered.set()
            await asyncio.Event().wait()
        await enter_room(sid, room)

    monkeypatch.setattr(socket, "enter_room", blocked)
    joining = asyncio.create_task(command(socket, "join-sdr", "new"))
    await asyncio.wait_for(entered.wait(), 1)
    joining.cancel()
    with pytest.raises(asyncio.CancelledError):
        await joining
    assert background_sessions.sessions["original"].controller is None
    assert not background_sessions.controllers


@pytest.mark.asyncio
async def test_tuning_an_adopted_vfo_keeps_effective_decoder_parameters(receiving, monkeypatch):
    socket, _pipeline, manager = receiving
    await detach(socket)
    await command(socket, "join-sdr", "new")
    restart = AsyncMock()
    monkeypatch.setattr(vfohandlers, "handle_vfo_decoder_state", restart)
    result = await vfohandlers.update_vfo_parameters(
        socket,
        {"vfoNumber": 2, "frequency": 145_825_000, "volume": 45},
        logging.getLogger(__name__),
        "new",
    )
    assert result["success"]
    assert VFOManager().get_vfo_state("original", 2).center_freq == 145_825_000
    restart.assert_not_awaited()
    manager.decoder_manager.stop_decoder.assert_not_called()
    # A disconnected old controller cannot continue changing the retained run.
    rejected = await vfohandlers.update_vfo_parameters(
        socket, {"vfoNumber": 2, "active": False}, logging.getLogger(__name__), "original"
    )
    assert not rejected["success"]
    assert VFOManager().get_vfo_state("original", 2).active


@pytest.mark.asyncio
async def test_decoder_events_are_cached_and_published_to_joined_viewers(receiving):
    socket, pipeline, manager = receiving
    await detach(socket)
    status = {
        "type": "decoder-status",
        "session_id": "original",
        "vfo": 2,
        "decoder_type": "fsk",
        "decoder_id": "decoder-original",
        "status": "decoding",
    }
    output = {
        "type": "decoder-output",
        "session_id": "original",
        "vfo": 2,
        "decoder_type": "fsk",
        "output": {"text": "packet"},
    }
    messages = queue.Queue()
    for message in (status, output, {"type": "terminated"}):
        messages.put(message)
    pipeline["data_queue"] = messages
    pipeline["process"].pid = 42
    entry = pipeline["decoders"]["original"][2]
    await asyncio.wait_for(manager.lifecycle_manager._monitor_data_queue("radio", 42), 1)
    assert entry["status"] == status
    assert (("decoder-data", status), {"room": "radio"}) in socket.emitted
    assert (("decoder-data", output), {"room": "radio"}) in socket.emitted


@pytest.mark.asyncio
async def test_continuous_join_is_readonly_and_leaving_preserves_owner(receiving):
    socket, pipeline, manager = receiving
    pipeline["continuous_observation_id"] = "definition"
    owner = "internal:continuous-definition"
    pipeline["clients"] = {owner}
    VFOManager().update_vfo_state(owner, 1, center_freq=145810000, active=True)
    response = await command(socket, "watch-sdr", "viewer", continuousObservationId="definition")
    assert response["success"]
    assert response["data"]["observation"] is None
    assert response["data"]["continuous_observation"]["session_id"] == owner
    assert response["data"]["continuous_observation"]["vfos"][1]["active"]
    assert ("viewer", owner) in socket.entered
    sid = background_sessions.resolve("viewer")
    assert sid in pipeline["joiners"]
    for cmd in (
        "claim-sdr",
        "configure-sdr",
        "start-streaming",
        "start-recording",
        "set-background",
    ):
        denied = await command(socket, cmd, "viewer", forceTakeover=True, enabled=True)
        assert not denied["success"] and "view-only" in denied["error"]
    for handler in (vfohandlers.update_vfo_parameters, vfohandlers.toggle_transcription):
        denied = await handler(
            socket, {"vfoNumber": 1, "active": True}, logging.getLogger(__name__), "viewer"
        )
        assert not denied["success"] and "view-only" in denied["error"]
    assert (await command(socket, "leave-sdr", "viewer"))["success"]
    assert pipeline["clients"] == {owner}
    assert ("viewer", owner) in socket.left
    assert manager.is_sdr_process_running("radio")


@pytest.mark.asyncio
async def test_continuous_join_rejects_replaced_run(receiving):
    socket, pipeline, _ = receiving
    pipeline["continuous_observation_id"] = "other"
    reply = await command(socket, "watch-sdr", "viewer", continuousObservationId="expected")
    assert not reply["success"]
    assert not socket.entered


@pytest.mark.asyncio
async def test_continuous_stop_during_room_attachment_cannot_revive_join(receiving):
    socket, pipeline, manager = receiving
    pipeline["continuous_observation_id"] = "definition"
    owner = "internal:continuous-definition"
    pipeline["clients"] = {owner}
    original = socket.enter_room

    async def stop_during_attachment(sid, room):
        await original(sid, room)
        if room == owner:
            await manager.stop_sdr_process("radio")

    socket.enter_room = stop_during_attachment
    reply = await command(socket, "watch-sdr", "viewer")
    assert not reply["success"]
    assert "stopped during JOIN" in reply["error"]
    assert not background_sessions.sessions
    assert owner not in VFOManager().get_all_session_ids()
