"""Continuous observations own fixed consumers independently of browsers."""

import asyncio
import copy
import logging
from datetime import datetime, timezone
from unittest.mock import AsyncMock, Mock
from uuid import uuid4

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker

from common.continuous import Definition, UpdateDefinition
from crud import continuous
from db.models import SDRs, SDRType
from handlers.entities import continuous as handlers
from server import runtimestate
from server.continuous import PREFIX, ContinuousObservations
from session import service, store, tracker
from session.background import background_sessions
from session.tracker import session_tracker
from vfos.parameters import decoder_parameter_overrides
from vfos.state import VFOManager

pytestmark = [pytest.mark.unit, pytest.mark.asyncio]


def editable(saved):
    return {key: copy.deepcopy(saved[key]) for key in Definition.model_fields}


@pytest.fixture
async def runtime(monkeypatch, db_engine, db_session):
    receiver = SDRs(
        id=uuid4(), name="Receiver", type=SDRType.RTLSDRUSBV3, frequency_min=24, frequency_max=1766
    )
    db_session.add(receiver)
    await db_session.commit()
    payload = {
        "id": str(uuid4()),
        "name": "Continuous VHF",
        "auto_start": True,
        "sdr": {
            "id": str(receiver.id),
            "name": "Receiver",
            "center_frequency": 146000000,
            "sample_rate": 2000000,
            "gain": 0,
            "antenna_port": "RX",
            "sdr_settings": {},
        },
        "vfos": [
            {
                "id": str(uuid4()),
                "frequency": 145800000,
                "bandwidth": 12500,
                "modulation": "fm",
                "decoder": "none",
                "decoder_parameters": {},
            }
        ],
    }
    saved = await continuous.create_definition(db_session, Definition.model_validate(payload))
    manager = Mock(processes={}, transcription_manager=None)
    manager.start_decoder.return_value = True
    manager.start_demodulator.return_value = True
    manager.is_sdr_process_running.side_effect = lambda sid: sid in manager.processes

    async def start(device, config, sid):
        if manager.processes:
            raise RuntimeError("Receiver is busy")
        manager.processes[config["sdr_id"]] = {
            "clients": {sid},
            "continuous_observation_id": config["continuous_observation_id"],
            "config": config,
            "data_queue": object(),
            "bandwidth_status": {},
        }
        return config["sdr_id"]

    async def stop(sdr_id, sid=None):
        info = manager.processes.get(sdr_id, {})
        if sid is None or sid in info.get("clients", set()):
            manager.processes.pop(sdr_id, None)

    manager.start_sdr_process = AsyncMock(side_effect=start)
    manager.stop_sdr_process = AsyncMock(side_effect=stop)
    factory = async_sessionmaker(db_engine, expire_on_commit=False)
    runner = ContinuousObservations(manager, Mock(emit=AsyncMock()), factory)
    configs = {}
    for module in (service, store, tracker):
        monkeypatch.setattr(module, "active_sdr_clients", configs)
    for attribute in (
        "_session_sdr_map",
        "_session_vfo_map",
        "_session_metadata",
        "_session_ip_map",
    ):
        monkeypatch.setattr(session_tracker, attribute, {})
    monkeypatch.setattr(session_tracker, "_internal_sessions", set())
    monkeypatch.setattr(VFOManager(), "_session_vfo_states", {})
    monkeypatch.setattr(background_sessions, "sessions", {})
    monkeypatch.setattr(background_sessions, "controllers", {})
    monkeypatch.setattr(runtimestate, "process_manager", manager)
    monkeypatch.setattr(runtimestate, "continuous_observations", runner)
    monkeypatch.setattr(runtimestate, "audio_consumer", None)
    monkeypatch.setattr(handlers, "AsyncSessionLocal", factory)
    yield runner, manager, saved, db_session
    await runner.shutdown()
    decoder_parameter_overrides.clear()


async def test_fixed_internal_vfos_and_idempotent_start_stop(runtime):
    runner, manager, saved, _ = runtime
    run = await runner.start(saved["id"], saved["updated_at"])
    sid = PREFIX + saved["id"]
    assert run["status"] == "running"
    assert datetime.fromisoformat(run["attempted_at"]) <= datetime.fromisoformat(run["started_at"])
    assert run["session_id"] == sid
    assert session_tracker.is_internal_session(sid)
    assert not background_sessions.sessions
    vfo = VFOManager().get_vfo_state(sid, 1)
    assert (vfo.center_freq, vfo.active, vfo.modulation) == (145800000, True, "fm")
    assert await runner.start(saved["id"]) == run
    manager.start_sdr_process.assert_awaited_once()
    manager.processes[saved["sdr"]["id"]]["clients"].add("viewer")
    assert (await runner.stop(saved["id"]))["status"] == "stopped"
    manager.stop_sdr_process.assert_any_await(saved["sdr"]["id"])
    assert not manager.processes
    assert not session_tracker.get_all_internal_sessions()
    assert sid not in store.active_sdr_clients
    assert sid not in VFOManager().get_all_session_ids()


async def test_ten_slots_and_decoder_parameter_mapping(runtime):
    runner, manager, saved, session = runtime
    definition = editable(saved)
    definition["vfos"] = [
        {**definition["vfos"][0], "id": str(uuid4()), "modulation": "usb"} for _ in range(9)
    ]
    definition["vfos"].append(
        {
            "id": str(uuid4()),
            "frequency": 146100000,
            "bandwidth": 12500,
            "modulation": "none",
            "decoder": "aprs",
            "decoder_parameters": {"aprs_baudrate": 1200},
        }
    )
    await continuous.update_definition(
        session,
        UpdateDefinition.model_validate(
            {
                **definition,
                "expected_updated_at": saved["updated_at"],
            }
        ),
    )
    await runner.start(saved["id"])
    assert VFOManager().get_vfo_state(PREFIX + saved["id"], 10).active
    assert manager.start_demodulator.call_count == 9
    assert manager.start_demodulator.call_args.kwargs["mode"] == "usb"
    assert manager.start_decoder.call_args.kwargs["decoder_param_overrides"] == {"baudrate": 1200}
    assert manager.start_decoder.call_args.kwargs["vfo"] == 10


async def test_stale_start_cannot_allocate_receiver(runtime):
    runner, manager, saved, _ = runtime
    with pytest.raises(continuous.DefinitionError, match="changed"):
        await runner.start(saved["id"], "2000-01-01T00:00:00Z")
    manager.start_sdr_process.assert_not_awaited()


@pytest.mark.parametrize("failure", ["worker", "consumer", "bandwidth"])
async def test_startup_failure_rolls_back_internal_state(runtime, failure):
    runner, manager, saved, _ = runtime
    if failure == "worker":
        manager.start_sdr_process.side_effect = RuntimeError("No samples")
    elif failure == "consumer":
        manager.start_demodulator.return_value = False
    else:
        original = manager.start_sdr_process.side_effect

        async def narrow(*args):
            result = await original(*args)
            manager.processes[result]["bandwidth_status"] = {"actual_hz": 100000}
            return result

        manager.start_sdr_process.side_effect = narrow
    with pytest.raises(Exception):
        await runner.start(saved["id"])
    assert runner.snapshot(saved["id"])["status"] == "failed"
    assert runner.snapshot(saved["id"])["error"]
    assert not manager.processes
    assert not session_tracker.get_all_internal_sessions()
    assert not store.active_sdr_clients


async def test_busy_receiver_is_never_closed_on_failed_acquisition(runtime):
    runner, manager, saved, _ = runtime
    info = {"clients": {"unrelated"}}
    manager.processes[saved["sdr"]["id"]] = info
    before_attempt = datetime.now(timezone.utc)
    with pytest.raises(RuntimeError, match="busy"):
        await runner.start(saved["id"])
    failed_run = runner.snapshot(saved["id"])
    assert (
        before_attempt
        <= datetime.fromisoformat(failed_run["attempted_at"])
        <= datetime.now(timezone.utc)
    )
    assert failed_run["started_at"] is None
    assert manager.processes[saved["sdr"]["id"]] is info
    assert not session_tracker.get_all_internal_sessions()


async def test_disabled_startup_is_rechecked_and_manual_start_still_works(runtime):
    runner, manager, saved, session = runtime
    await continuous.update_definition(
        session,
        UpdateDefinition.model_validate(
            {
                **editable(saved),
                "auto_start": False,
                "expected_updated_at": saved["updated_at"],
            }
        ),
    )
    await runner.start_enabled()
    await runner.start(saved["id"], automatic=True)
    manager.start_sdr_process.assert_not_awaited()
    assert (await runner.start(saved["id"]))["status"] == "running"


async def test_failure_notification_releases_worker_without_callback_deadlock(runtime):
    runner, manager, saved, _ = runtime
    await runner.start(saved["id"])
    await runner.handle_failure(saved["sdr"]["id"], {PREFIX + saved["id"]}, "lost samples")
    await asyncio.gather(*runner.background)
    run = runner.snapshot(saved["id"])
    assert run["status"] == "failed"
    assert "lost samples" in run["error"]
    assert not manager.processes


async def test_shutdown_cancels_pending_start_and_releases_internal_state(runtime):
    runner, manager, saved, _ = runtime
    entered = asyncio.Event()

    async def blocked(*_args):
        entered.set()
        await asyncio.Event().wait()

    manager.start_sdr_process.side_effect = blocked
    start = asyncio.create_task(runner.start(saved["id"]))
    await entered.wait()
    await asyncio.wait_for(runner.shutdown(), 2)
    assert isinstance(
        (await asyncio.gather(start, return_exceptions=True))[0], asyncio.CancelledError
    )
    assert not session_tracker.get_all_internal_sessions()
    assert not store.active_sdr_clients


async def test_running_configuration_locked_but_startup_preference_editable(runtime):
    runner, _, saved, _ = runtime
    await runner.start(saved["id"])
    data = {**editable(saved), "expected_updated_at": saved["updated_at"]}
    data["vfos"][0]["frequency"] += 1000
    log = logging.getLogger(__name__)
    reply = await handlers.update_definition(runner.sio, data, log, "browser")
    assert not reply["success"] and reply["code"] == "conflict"
    reply = await handlers.delete_definition(
        runner.sio,
        {
            "id": saved["id"],
            "expected_updated_at": saved["updated_at"],
        },
        log,
        "browser",
    )
    assert not reply["success"] and reply["code"] == "conflict"
    data["vfos"] = saved["vfos"]
    data["auto_start"] = False
    reply = await handlers.update_definition(runner.sio, data, log, "browser")
    assert reply["success"] and not reply["data"]["auto_start"]
    assert reply["data"]["runtime"]["status"] == "running"


async def test_auto_start_failure_does_not_prevent_later_enabled_definition(runtime):
    runner, manager, saved, session = runtime
    second = editable(saved)
    second.update(id=str(uuid4()), name="Second definition")
    second = await continuous.create_definition(session, Definition.model_validate(second))
    third = {**editable(saved), "id": str(uuid4()), "auto_start": False}
    third = await continuous.create_definition(session, Definition.model_validate(third))
    original = manager.start_sdr_process.side_effect
    attempts = 0

    async def fail_first(*args):
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            raise RuntimeError("Offline receiver")
        return await original(*args)

    manager.start_sdr_process.side_effect = fail_first
    runner.start_automatic()
    await asyncio.gather(*runner.background)
    assert runner.snapshot(saved["id"])["status"] == "failed"
    assert runner.snapshot(second["id"])["status"] == "running"
    assert runner.snapshot(third["id"])["status"] == "not_started"


async def test_runtime_api_returns_structured_status_and_idempotent_stop(runtime):
    runner, _, saved, _ = runtime
    log = logging.getLogger(__name__)
    request = {"id": saved["id"], "expected_updated_at": saved["updated_at"]}
    reply = await handlers.start_observation(runner.sio, request, log, "browser")
    assert reply["success"] and reply["data"]["runtime"]["status"] == "running"
    reply = await handlers.list_definitions(runner.sio, {}, log, "browser")
    assert reply["data"][0]["runtime"]["status"] == "running"
    for _ in range(2):
        reply = await handlers.stop_observation(runner.sio, {"id": saved["id"]}, log, "browser")
        assert reply["success"] and reply["data"]["runtime"]["status"] == "stopped"
    runner.closing = True
    reply = await handlers.start_observation(runner.sio, request, log, "browser")
    assert not reply["success"] and reply["code"] == "unavailable"


async def test_shutdown_drains_failure_cleanup_instead_of_cancelling_teardown(runtime):
    runner, manager, saved, _ = runtime
    await runner.start(saved["id"])
    entered, release = asyncio.Event(), asyncio.Event()
    original = manager.stop_sdr_process.side_effect

    async def slow_stop(*args):
        entered.set()
        await release.wait()
        return await original(*args)

    manager.stop_sdr_process.side_effect = slow_stop
    await runner.handle_failure(saved["sdr"]["id"], {PREFIX + saved["id"]}, "lost samples")
    await entered.wait()
    closing = asyncio.create_task(runner.shutdown())
    await asyncio.sleep(0)
    assert not closing.done()
    release.set()
    await asyncio.wait_for(closing, 2)
    assert not manager.processes
    assert not session_tracker.get_all_internal_sessions()


async def test_cancelling_request_during_rollback_still_finishes_teardown(runtime):
    runner, manager, saved, _ = runtime
    entered, release = asyncio.Event(), asyncio.Event()
    original = manager.stop_sdr_process.side_effect

    async def slow_stop(*args):
        entered.set()
        await release.wait()
        return await original(*args)

    manager.stop_sdr_process.side_effect = slow_stop
    manager.start_demodulator.return_value = False
    starting = asyncio.create_task(runner.start(saved["id"]))
    await entered.wait()
    starting.cancel()
    release.set()
    await asyncio.gather(starting, return_exceptions=True)
    assert not manager.processes
    assert not session_tracker.get_all_internal_sessions()


async def test_delayed_failure_cleanup_cannot_stop_a_replacement_run(runtime):
    runner, manager, saved, _ = runtime
    old = await runner.start(saved["id"])
    old_record = runner.runs[saved["id"]]
    await runner.stop(saved["id"])
    new = await runner.start(saved["id"])
    assert new["started_at"] != old["started_at"]
    assert datetime.fromisoformat(new["attempted_at"]) > datetime.fromisoformat(old["attempted_at"])
    await runner._finish_failure(saved["id"], old_record)
    assert runner.snapshot(saved["id"])["status"] == "running"
    assert manager.processes


async def test_failed_cleanup_keeps_stop_available_until_resources_are_released(runtime):
    runner, manager, saved, _ = runtime
    await runner.start(saved["id"])
    original = manager.stop_sdr_process.side_effect
    manager.stop_sdr_process.side_effect = RuntimeError("Temporary cleanup failure")
    with pytest.raises(RuntimeError, match="cleanup failure"):
        await runner.stop(saved["id"])
    assert runner.snapshot(saved["id"])["status"] == "failed"
    assert runner.snapshot(saved["id"])["active"]
    with pytest.raises(continuous.DefinitionError, match="Stop the failed"):
        await runner.start(saved["id"])
    manager.stop_sdr_process.side_effect = original
    assert not (await runner.stop(saved["id"]))["active"]
