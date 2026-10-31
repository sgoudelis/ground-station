# Copyright (c) 2026 Efstratios Goudelis
import asyncio
import queue
import threading
import time
from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from common.events import EventBroker
from db.models import TrackingState
from tracker import logic
from tracker import manager as managermodule
from tracker import messages as messagemodule
from tracker.execution import WorkerOperations
from tracker.ipc import TRACKER_MSG_SET_SATELLITE_EPHEMERIS, TRACKER_MSG_SET_TRACKING_STATE
from tracker.manager import TrackerManager
from tracker.operations import OperationRegistry, validate_external_request

STATE = {
    "rotator_id": "mount",
    "rotator_state": "connected",
    "rig_id": "radio",
    "rig_state": "disconnected",
}


def request(registry, key="move", tracker="target-1", action="move", changes=None):
    return registry.accept(
        tracker,
        changes or {},
        STATE,
        {
            "command_id": key,
            "action": action,
            "position": {"az": 120, "el": 45},
        },
    )


def test_independent_devices_keep_both_commands_and_reject_shared_device():
    registry = OperationRegistry()
    request(registry)
    request(registry, "rig", action="connect", changes={"rig_state": "connected"})
    assert len(registry.records) == 2
    with pytest.raises(ValueError, match="in progress"):
        request(registry, "another", tracker="target-2")


def test_removed_tracker_telemetry_no_longer_reserves_its_device():
    registry = OperationRegistry()
    registry.observe(
        {
            "tracker_id": "obs-finished-pass",
            "worker_started_at": 1,
            "worker_generation": "finished-worker",
            "sequence": 1,
            "tracking_state": {"rotator_id": "mount"},
            "rotator_data": {"connected": True},
        }
    )

    with pytest.raises(ValueError, match="connected to another tracker"):
        request(registry, "blocked", tracker="obs-next-pass")

    registry.forget_tracker("obs-finished-pass")

    accepted = request(registry, "accepted", tracker="obs-next-pass")
    assert accepted["status"] == "submitted"
    assert "obs-finished-pass" not in registry.observed


@pytest.mark.asyncio
async def test_late_hardware_snapshot_from_removed_tracker_is_dropped(monkeypatch):
    registry = OperationRegistry()
    incoming = queue.Queue()
    incoming.put(
        {
            "event": "tracker-hardware-state",
            "data": {
                "tracker_id": "obs-finished-pass",
                "worker_started_at": 1,
                "worker_generation": "finished-worker",
                "sequence": 1,
                "tracking_state": {"rotator_id": "mount"},
                "rotator_data": {"connected": True},
            },
        }
    )
    monkeypatch.setattr(messagemodule, "operations", registry)
    monkeypatch.setattr(messagemodule, "queue_from_tracker", incoming)
    monkeypatch.setattr(messagemodule, "get_existing_tracker_manager", lambda _id: None)

    async def stop_after_message(_delay):
        raise asyncio.CancelledError

    monkeypatch.setattr(messagemodule.asyncio, "sleep", stop_after_message)
    with pytest.raises(asyncio.CancelledError):
        await messagemodule.handle_tracker_messages(SimpleNamespace(emit=AsyncMock()))

    assert registry.observed == {}


def test_stop_cancels_pending_move_and_fences_a_late_request():
    registry = OperationRegistry()
    request(registry)
    stop = registry.accept(
        "target-1",
        {"rotator_state": "stopped"},
        STATE,
        {"command_id": "stop", "action": "stop", "supersedes": ["late"]},
    )
    assert stop["status"] == "submitted"
    assert registry.records["move"]["status"] == "submitted"
    assert "move" in stop["supersedes"]
    assert request(registry, "late")["status"] == "cancelled"
    registry.update("stop", "failed", "Could not persist Stop")
    assert registry.records["move"]["status"] == "submitted"


def test_rig_stop_does_not_cancel_or_change_rotator_operation():
    registry = OperationRegistry()
    move = request(registry)
    request(registry, "rig", action="connect", changes={"rig_state": "connected"})
    stop = registry.accept("target-1", {"rig_state": "stopped"}, STATE, {"action": "stop"})
    assert stop["scopes"] == ["rig"]
    assert registry.records["move"]["status"] == "submitted"
    assert "rig" in stop["supersedes"]
    tracker = worker()
    tracker.operations.accept({"operation": move})
    tracker.operations.accept(
        {
            "operation": stop,
            "messages": [
                {"type": "set_tracking_state", "payload": {**STATE, "rig_state": "stopped"}}
            ],
        }
    )
    tracker.operations.begin_cycle()
    assert "move" in tracker.operations.pending
    assert tracker.input_tracking_state["rotator_state"] == "connected"


def test_deadline_advances_without_telemetry_and_cannot_be_downgraded():
    registry = OperationRegistry()
    record = request(registry)
    registry.records[record["command_id"]]["deadline"] = time.time() - 1
    assert len(registry.expire()) == 1
    assert registry.records["move"]["status"] == "unknown"
    registry.update("move", "cancelled")
    assert registry.update("move", "succeeded") is None


def test_restart_drops_command_results_and_rejects_old_epoch():
    first = OperationRegistry()
    request(first)
    recovered = OperationRegistry()
    assert recovered.snapshot()["commands"] == []
    with pytest.raises(ValueError, match="Backend restarted"):
        recovered.accept(
            "target-1", {}, STATE, {"command_id": "move", "action": "move", "epoch": first.epoch}
        )
    assert request(recovered, "new-move")["status"] == "submitted"


@pytest.mark.asyncio
async def test_restart_rehydrates_saved_tracking_modes(monkeypatch, db_session):
    saved = {**STATE, "rotator_state": "tracking", "rig_state": "tracking"}
    manager = TrackerManager(queue_to_tracker=queue.Queue(), tracker_id="target-1")
    db_session.add(TrackingState(name=manager.tracking_state_name, value=saved))
    await db_session.commit()

    @asynccontextmanager
    async def session():
        yield db_session

    push_context = AsyncMock()
    monkeypatch.setattr(managermodule, "AsyncSessionLocal", session)
    monkeypatch.setattr(manager, "_sync_tracker_context", push_context)

    await manager.sync_tracking_state_from_db()

    assert manager.current_tracking_state == saved
    push_context.assert_awaited_once_with(saved)


def test_completed_results_expire_from_live_registry():
    registry = OperationRegistry()
    request(registry)
    registry.update("move", "succeeded")
    registry.records["move"]["updated_at"] = time.time() - 61
    assert registry.snapshot()["commands"] == []


def test_external_requests_require_epoch_and_short_acceptance_deadline():
    registry = OperationRegistry()
    valid = {"command_id": "move", "epoch": registry.epoch, "accept_before": time.time() + 10}
    validate_external_request(valid, registry.epoch)
    with pytest.raises(ValueError, match="epoch"):
        validate_external_request({**valid, "epoch": "old"}, registry.epoch)
    with pytest.raises(ValueError, match="deadline"):
        validate_external_request({**valid, "accept_before": time.time() + 60}, registry.epoch)
    with pytest.raises(ValueError, match="required"):
        validate_external_request({**valid, "accept_before": None}, registry.epoch)


def test_expired_or_reassigned_request_is_rejected():
    registry = OperationRegistry()
    with pytest.raises(ValueError, match="expired"):
        registry.accept("target-1", {}, STATE, {"action": "move", "accept_before": time.time() - 1})
    with pytest.raises(ValueError, match="assignment"):
        registry.accept(
            "target-1", {}, STATE, {"action": "move", "device_ids": {"rotator": "other"}}
        )


@pytest.mark.asyncio
async def test_partial_telemetry_cannot_complete_any_command(monkeypatch):
    registry = OperationRegistry()
    request(registry)
    incoming = queue.Queue()
    incoming.put(
        {
            "event": "satellite-tracking",
            "data": {
                "tracker_id": "target-1",
                "rig_data": {"connected": True},
                "observer_bodies": [{}],
            },
        }
    )
    monkeypatch.setattr(messagemodule, "operations", registry)
    monkeypatch.setattr(messagemodule, "queue_from_tracker", incoming)
    update_vfos = AsyncMock()
    sockio = SimpleNamespace(emit=AsyncMock())
    monkeypatch.setattr(messagemodule, "handle_vfo_updates_for_tracking", update_vfos)
    monkeypatch.setattr(messagemodule, "get_live_observer_bodies", AsyncMock(return_value=[]))

    async def stop_after_message(_delay):
        raise asyncio.CancelledError

    monkeypatch.setattr(messagemodule.asyncio, "sleep", stop_after_message)
    with pytest.raises(asyncio.CancelledError):
        await messagemodule.handle_tracker_messages(sockio)
    assert registry.records["move"]["status"] == "submitted"
    update_vfos.assert_awaited_once()
    assert [call.args[0] for call in sockio.emit.await_args_list] == [
        "satellite-tracking",
    ]


def worker():
    tracker = logic.SatelliteTracker(queue.Queue(), queue.Queue(), tracker_id="target-1")
    tracker.input_tracking_state = dict(STATE)
    tracker.rotator_data.update(connected=True, stopped=True)
    tracker.rotator_handler._target_within_tolerance = (
        lambda az, el, target_az, target_el: abs(az - target_az) < 1 and abs(el - target_el) < 1
    )
    return tracker


def test_worker_clears_ephemeris_when_celestial_target_changes():
    tracker = worker()
    tracker.input_target_ephemeris = {
        "target_type": "mission",
        "target_key": "mission:curiosity",
        "position_xyz_au": [1.0, 2.0, 3.0],
    }
    tracker.input_satellite = dict(tracker.input_target_ephemeris)

    tracker.apply_input_message(
        {
            "type": TRACKER_MSG_SET_TRACKING_STATE,
            "payload": {
                "target_type": "mission",
                "target_key": "mission:perseverance",
                "command": "-168",
            },
        }
    )

    assert tracker.input_target_ephemeris is None
    assert tracker.input_satellite is None


def test_worker_keeps_ephemeris_for_same_celestial_target_state_update():
    tracker = worker()
    ephemeris = {
        "target_type": "mission",
        "target_key": "mission:curiosity",
        "position_xyz_au": [1.0, 2.0, 3.0],
    }
    tracker.input_target_ephemeris = dict(ephemeris)

    tracker.apply_input_message(
        {
            "type": TRACKER_MSG_SET_TRACKING_STATE,
            "payload": {
                "target_type": "mission",
                "target_key": "mission:curiosity",
                "command": "-76",
                "rig_state": "tracking",
            },
        }
    )

    assert tracker.input_target_ephemeris == ephemeris


def test_worker_rejects_non_satellite_ephemeris_from_another_target():
    tracker = worker()
    tracker.input_target_ephemeris = {
        "target_type": "mission",
        "target_key": "mission:curiosity",
        "earth_position_xyz_au": [1.0, 0.0, 0.0],
        "position_xyz_au": [1.5, 0.0, 0.0],
    }

    result = tracker._resolve_target_context(
        {
            "target_type": "mission",
            "target_key": "mission:perseverance",
            "command": "-168",
        },
        {"lat": 37.98, "lon": 23.72, "alt": 100},
    )

    assert result is None


def test_satellite_rotator_command_uses_persisted_future_lead(monkeypatch):
    tracker = worker()
    tracker.input_target_ephemeris = {"norad_id": 25544, "name": "ISS"}
    tracker.input_location = {"lat": 37.98, "lon": 23.72, "alt": 100}
    tracker.rotator_details = {"tracking_lead_seconds": 3.5}
    epochs = {}

    def compile_data(*_args, observation_time=None, **_kwargs):
        epochs["current"] = observation_time
        return {
            "position": {"az": 120.0, "el": 35.0},
            "details": {},
            "paths": {},
            "coverage": [],
            "transmitters": [],
            "error": False,
        }

    propagation_input = SimpleNamespace(tle1="line 1", tle2="line 2")

    def future_point(_lat, _lon, actual_propagation_input, observation_time):
        assert actual_propagation_input is propagation_input
        epochs["command"] = observation_time
        return 124.0, 37.0

    monkeypatch.setattr(logic, "compiled_satellite_data_from_inputs", compile_data)
    monkeypatch.setattr(logic, "get_propagation_input", lambda *_args, **_kwargs: propagation_input)
    monkeypatch.setattr(logic, "get_satellite_az_el_from_propagation", future_point)

    result = tracker._resolve_target_context(
        {"target_type": "satellite", "norad_id": 25544},
        tracker.input_location,
    )

    assert result["skypoint"] == (120.0, 35.0)
    assert result["command_skypoint"] == (124.0, 37.0)
    assert result["tracking_lead_seconds"] == 3.5
    assert (epochs["command"] - epochs["current"]).total_seconds() == 3.5


def test_worker_accepts_explicit_empty_ephemeris_clear():
    tracker = worker()
    tracker.input_target_ephemeris = {"target_key": "mission:curiosity"}
    tracker.input_satellite = dict(tracker.input_target_ephemeris)

    tracker.apply_input_message({"type": TRACKER_MSG_SET_SATELLITE_EPHEMERIS, "payload": {}})

    assert tracker.input_target_ephemeris is None
    assert tracker.input_satellite is None


@pytest.mark.asyncio
async def test_manager_sends_ephemeris_clear_when_mission_snapshot_is_missing(monkeypatch):
    @asynccontextmanager
    async def session():
        yield object()

    monkeypatch.setattr(managermodule, "AsyncSessionLocal", session)
    monkeypatch.setattr(
        managermodule.crud.locations,
        "fetch_all_locations",
        AsyncMock(return_value={"success": True, "data": []}),
    )
    monkeypatch.setattr(
        managermodule.crud.preferences,
        "get_map_settings",
        AsyncMock(return_value={"success": True, "data": {"value": {}}}),
    )

    queue_to_tracker = queue.Queue()
    manager = TrackerManager(queue_to_tracker=queue_to_tracker, tracker_id="target-1")
    manager._build_mission_ephemeris_payload = AsyncMock(return_value=None)
    manager._fetch_non_satellite_transmitters = AsyncMock(
        return_value={"success": True, "data": [], "error": None}
    )

    await manager._sync_tracker_context(
        {
            "target_type": "mission",
            "target_key": "mission:perseverance",
            "command": "-168",
        }
    )

    envelope = queue_to_tracker.get_nowait()
    clear_messages = [
        message
        for message in envelope["payload"]["messages"]
        if message["type"] == TRACKER_MSG_SET_SATELLITE_EPHEMERIS
    ]
    assert clear_messages == [{"type": TRACKER_MSG_SET_SATELLITE_EPHEMERIS, "payload": {}}]


@pytest.mark.asyncio
async def test_worker_unconfirmed_stop_result_reaches_the_command_journal(monkeypatch):
    registry = OperationRegistry()
    operation = registry.accept(
        "target-1", {"rotator_state": "stopped"}, STATE, {"command_id": "stop", "action": "stop"}
    )
    incoming = queue.Queue()
    incoming.put(
        {
            "event": "tracker-command-status",
            "data": {
                "tracker_id": "target-1",
                "command_id": "stop",
                "epoch": operation["epoch"],
                "status": "unknown",
                "reconciled": True,
                "reason": "Stop unconfirmed",
                "snapshot": {
                    "tracker_id": "target-1",
                    "sequence": 1,
                    "rotator_data": {"connected": True, "motion_unconfirmed": True},
                },
            },
        }
    )
    monkeypatch.setattr(messagemodule, "operations", registry)
    monkeypatch.setattr(messagemodule, "queue_from_tracker", incoming)
    monkeypatch.setattr(messagemodule, "get_existing_tracker_manager", lambda _id: None)

    async def stop_after_message(_delay):
        raise asyncio.CancelledError

    monkeypatch.setattr(messagemodule.asyncio, "sleep", stop_after_message)
    with pytest.raises(asyncio.CancelledError):
        await messagemodule.handle_tracker_messages(SimpleNamespace(emit=AsyncMock()))
    assert registry.records["stop"]["reconciled"] is True
    assert registry.outbox[-1]["status"] == "unknown"
    assert registry.outbox[-1]["snapshot"]["rotator_data"]["motion_unconfirmed"] is True


def test_worker_only_completes_move_from_fresh_arrival_readings():
    tracker = worker()
    operation = request(OperationRegistry())
    tracker.operations.accept({"operation": operation})
    tracker.operations.begin_cycle()
    tracker.rotator_data.update(az=120, el=45)
    tracker.operations.finish_cycle()
    assert "move" in tracker.operations.pending
    tracker.rotator_position_fresh = True
    tracker.operations.finish_cycle()
    assert "move" in tracker.operations.pending
    tracker.operations.finish_cycle()
    assert "move" not in tracker.operations.pending


def test_worker_reports_changed_assignment_and_expired_commands():
    tracker = worker()
    operation = request(OperationRegistry())
    tracker.operations.accept({"operation": operation})
    tracker.input_tracking_state["rotator_id"] = "other"
    tracker.operations.begin_cycle()
    assert not tracker.operations.pending
    event = tracker.queue_out._queue_out.get_nowait()
    assert event["data"]["status"] == "cancelled"
    operation["deadline"] = time.time() - 1
    tracker.operations.accept(
        {"operation": operation, "messages": [{"type": "set_tracking_state", "payload": STATE}]}
    )
    assert tracker.input_tracking_state["rotator_id"] == "other"
    assert tracker.queue_out._queue_out.get_nowait()["data"]["status"] == "failed"


def test_expiry_after_dequeue_cannot_apply_the_expired_state():
    tracker = worker()
    operation = request(
        OperationRegistry(), "track", action="track", changes={"rotator_state": "tracking"}
    )
    tracker.operations.accept(
        {
            "operation": operation,
            "messages": [
                {"type": "set_tracking_state", "payload": {**STATE, "rotator_state": "tracking"}}
            ],
        }
    )
    tracker.operations.pending["track"]["deadline"] = time.time() - 1
    tracker.operations.begin_cycle()
    assert tracker.input_tracking_state["rotator_state"] == "connected"
    assert not tracker.operations.pending


def test_independent_rig_batch_does_not_restore_failed_rotator_state():
    tracker = worker()
    tracker.input_tracking_state["rotator_state"] = "disconnected"
    operation = request(
        OperationRegistry(), "rig", action="connect", changes={"rig_state": "connected"}
    )
    tracker.operations.accept(
        {
            "operation": operation,
            "messages": [
                {"type": "set_tracking_state", "payload": {**STATE, "rig_state": "connected"}}
            ],
        }
    )
    assert tracker.input_tracking_state["rig_state"] == "connected"
    assert tracker.input_tracking_state["rotator_state"] == "disconnected"


def test_worker_error_precedes_success_flags():
    tracker = worker()
    operation = request(
        OperationRegistry(), "connect", action="connect", changes={"rotator_state": "connected"}
    )
    tracker.operations.accept({"operation": operation})
    tracker.operations.begin_cycle()
    tracker.rotator_data.update(error=True, connected=True)
    tracker.operations.finish_cycle()
    events = list(tracker.queue_out._queue_out.queue)
    assert events[-1]["data"]["status"] == "failed"


@pytest.mark.asyncio
async def test_manual_move_and_stop_execute_without_location_or_target(monkeypatch):
    monkeypatch.setattr(logic, "args", SimpleNamespace(track_interval_ms=1))
    tracker = worker()
    stopped = threading.Event()
    tracker.stop_event = stopped
    controller = SimpleNamespace(
        stop=AsyncMock(return_value=True), get_position=AsyncMock(return_value=(120, 45))
    )
    tracker.rotator_controller = controller
    tracker.prev_rotator_state = "connected"
    tracker.rotator_details = {"azimuth_mode": "0_360"}
    sent = []

    async def issue(az, el):
        sent.append((az, el))

    tracker.rotator_handler._issue_rotator_command = issue
    registry = OperationRegistry()
    tracker.operations.accept({"operation": request(registry)})
    original_publish = tracker.operations.publish
    ticks = 0

    def publish():
        nonlocal ticks
        ticks += 1
        original_publish()
        if ticks == 1:
            operation = registry.accept(
                "target-1", {"rotator_state": "stopped"}, STATE, {"action": "stop"}
            )
            tracker.operations.accept(
                {
                    "operation": operation,
                    "messages": [
                        {
                            "type": "set_tracking_state",
                            "payload": {**STATE, "rotator_state": "stopped"},
                        }
                    ],
                }
            )
        elif ticks == 2:
            stopped.set()

    tracker.operations.publish = publish
    await asyncio.wait_for(tracker.run(), timeout=2)
    assert sent == [(120, 45)]
    controller.stop.assert_awaited_once()


@pytest.mark.asyncio
async def test_park_waits_for_arrival_and_stop_calls_controller():
    tracker = worker()
    tracker.current_rotator_state = "parked"
    tracker.rotator_details = {"parkaz": 120, "parkel": 45, "azimuth_mode": "0_360"}
    tracker.rotator_controller = SimpleNamespace(
        park=AsyncMock(return_value=True),
        stop=AsyncMock(return_value=True),
        get_position=AsyncMock(return_value=(20, 10)),
    )
    await tracker.rotator_handler.park_rotator()
    assert tracker.rotator_data["parked"] is False
    await tracker.rotator_handler.update_hardware_position()
    assert tracker.rotator_data["parked"] is False
    tracker.rotator_controller.get_position.return_value = (120, 45)
    await tracker.rotator_handler.update_hardware_position()
    await tracker.rotator_handler.update_hardware_position()
    assert tracker.rotator_data["parked"] is True
    await tracker.rotator_handler.handle_rotator_state_change("parked", "stopped")
    tracker.rotator_controller.stop.assert_awaited_once()


@pytest.mark.asyncio
async def test_expiring_running_move_waits_for_physical_stop():
    tracker = worker()
    tracker.rotator_controller = SimpleNamespace(stop=AsyncMock(return_value=True))
    tracker.operations.accept({"operation": request(OperationRegistry())})
    tracker.operations.begin_cycle()
    tracker.rotator_data.update(stopped=False, slewing=True)
    tracker.operations.cancel("move")
    tracker.operations.finish_cycle()
    assert "move" in tracker.operations.pending
    await tracker.rotator_handler.handle_rotator_state_change("connected", "stopped")
    tracker.operations.finish_cycle()
    tracker.rotator_controller.stop.assert_awaited_once()
    assert "move" in tracker.operations.pending
    # Completion requires the subsequent motion observation, not just the ACK.
    tracker.rotator_data.update(stopped=True, motion_unconfirmed=False)
    tracker.operations.finish_cycle()
    assert "move" not in tracker.operations.pending
    assert list(tracker.queue_out._queue_out.queue)[-1]["data"]["status"] == "cancelled"


@pytest.mark.asyncio
async def test_failed_connect_reconciles_saved_state_and_allows_reassignment(
    monkeypatch, db_session
):
    registry = OperationRegistry()
    monkeypatch.setattr(managermodule, "operations", registry)

    @asynccontextmanager
    async def session():
        yield db_session

    monkeypatch.setattr(managermodule, "AsyncSessionLocal", session)
    manager = TrackerManager(tracker_id="target-1")
    manager._sync_tracker_context = AsyncMock()
    db_session.add(TrackingState(name=manager.tracking_state_name, value=dict(STATE)))
    await db_session.commit()
    command = request(registry, "connect", action="connect", changes={"rotator_state": "connected"})
    snapshot = {"tracking_state": {**STATE, "rotator_state": "disconnected"}}
    await manager.reconcile_operation(command, snapshot)
    assert (await manager.get_tracking_state())["rotator_state"] == "disconnected"
    assert snapshot["desired_state"]["rotator_state"] == "disconnected"
    registry.update("connect", "failed", "Connection refused")
    reply = await manager.update_tracking_state(
        rotator_id="replacement", operation={"command_id": "replace"}
    )
    assert reply["success"] is True


@pytest.mark.asyncio
async def test_target_change_event_follows_persisted_identity_change(monkeypatch, db_session):
    registry = OperationRegistry()
    broker = EventBroker()
    subscription = broker.subscribe("station-token", ["station:read"])
    monkeypatch.setattr(managermodule, "operations", registry)
    monkeypatch.setattr(managermodule, "public_events", broker)

    @asynccontextmanager
    async def session():
        yield db_session

    monkeypatch.setattr(managermodule, "AsyncSessionLocal", session)
    manager = TrackerManager(tracker_id="target-1")
    manager._sync_tracker_context = AsyncMock()
    db_session.add(
        TrackingState(
            name=manager.tracking_state_name,
            value={**STATE, "norad_id": 20580, "target_name": "NOAA 15"},
        )
    )
    await db_session.commit()

    changed = await manager.update_tracking_state(norad_id=25544, target_name="ISS")
    assert changed["success"] is True
    assert subscription.queue.get_nowait() == (
        "target.changed",
        {
            "tracker_id": "target-1",
            "previous": {"type": "satellite", "id": "20580", "name": "NOAA 15"},
            "current": {"type": "satellite", "id": "25544", "name": "ISS"},
        },
    )

    registry.update(changed["command_id"], "succeeded")
    changed_to_body = await manager.update_tracking_state(
        target_type="body",
        target_key="body:mars",
        body_id="mars",
        norad_id=None,
        target_name="Mars",
    )
    assert changed_to_body["success"] is True
    assert subscription.queue.get_nowait() == (
        "target.changed",
        {
            "tracker_id": "target-1",
            "previous": {"type": "satellite", "id": "25544", "name": "ISS"},
            "current": {"type": "body", "id": "body:mars", "name": "Mars"},
        },
    )

    registry.update(changed_to_body["command_id"], "succeeded")
    renamed = await manager.update_tracking_state(target_name="Red Planet")
    assert renamed["success"] is True
    assert subscription.queue.empty()


@pytest.mark.asyncio
async def test_new_target_slot_emits_creation_before_initial_target(monkeypatch, db_session):
    registry = OperationRegistry()
    broker = EventBroker()
    subscription = broker.subscribe("station-token", ["station:read"])
    monkeypatch.setattr(managermodule, "operations", registry)
    monkeypatch.setattr(managermodule, "public_events", broker)

    @asynccontextmanager
    async def session():
        yield db_session

    monkeypatch.setattr(managermodule, "AsyncSessionLocal", session)
    manager = TrackerManager(tracker_id="target-2")
    manager._sync_tracker_context = AsyncMock()

    created = await manager.update_tracking_state(
        norad_id=25544,
        target_name="ISS",
        rotator_state="disconnected",
        rig_state="disconnected",
        rotator_id="none",
        rig_id="none",
    )
    assert created["success"] is True
    assert subscription.queue.get_nowait() == (
        "target.slot.created",
        {"tracker_id": "target-2"},
    )
    assert subscription.queue.get_nowait() == (
        "target.changed",
        {
            "tracker_id": "target-2",
            "previous": None,
            "current": {"type": "satellite", "id": "25544", "name": "ISS"},
        },
    )
    registry.update(created["command_id"], "succeeded")
    updated = await manager.update_tracking_state(target_name="Space Station")
    assert updated["success"] is True
    assert subscription.queue.empty()


def test_target_visibility_only_emits_running_slot_horizon_transitions(monkeypatch):
    broker = EventBroker()
    subscription = broker.subscribe("station-token", ["station:read"])
    monkeypatch.setattr(messagemodule, "public_events", broker)
    monkeypatch.setattr(messagemodule, "_target_visibility", {})
    process = SimpleNamespace(pid=12345, is_alive=lambda: True)
    runtime = SimpleNamespace(process=process)
    monkeypatch.setattr(
        messagemodule,
        "get_tracker_supervisor",
        lambda: SimpleNamespace(get_runtime=lambda _id: runtime),
    )

    def telemetry(elevation, norad_id=25544):
        return {
            "tracking_state": {"target_type": "satellite", "norad_id": norad_id},
            "satellite_data": {"position": {"el": elevation}, "details": {"name": "ISS"}},
        }

    messagemodule._publish_target_visibility("obs-pass", telemetry(10))
    messagemodule._publish_target_visibility("target-1", telemetry(-3))
    assert subscription.queue.empty()
    messagemodule._publish_target_visibility("target-1", telemetry(0.1))
    assert subscription.queue.get_nowait() == (
        "target.visible",
        {"tracker_id": "target-1", "norad_id": "25544", "name": "ISS", "elevation_deg": 0.1},
    )
    messagemodule._publish_target_visibility("target-1", telemetry(5))
    assert subscription.queue.empty()
    messagemodule._publish_target_visibility("target-1", telemetry(0))
    assert subscription.queue.get_nowait()[0] == "target.below_horizon"
    messagemodule._publish_target_visibility("target-1", telemetry(4, 20580))
    assert subscription.queue.get_nowait()[0] == "target.visible"
    runtime.process = SimpleNamespace(pid=12346, is_alive=lambda: False)
    messagemodule._publish_target_visibility("target-1", telemetry(-4))
    assert subscription.queue.empty()


def test_tracker_hardware_events_report_only_connection_changes(monkeypatch):
    broker = EventBroker()
    subscription = broker.subscribe("station-token", ["station:read"])
    monkeypatch.setattr(messagemodule, "public_events", broker)
    disconnected = {
        "tracking_state": {"rotator_id": "mount", "rig_id": "radio"},
        "rotator_data": {"connected": False},
        "rig_data": {"connected": False},
    }
    connected = {
        **disconnected,
        "rotator_data": {"connected": True},
        "rig_data": {"connected": True},
    }
    messagemodule._publish_hardware_changes("target-1", {}, disconnected)
    assert subscription.queue.empty()
    messagemodule._publish_hardware_changes("target-1", disconnected, connected)
    assert subscription.queue.get_nowait() == (
        "tracker.hardware.changed",
        {
            "tracker_id": "target-1",
            "device": "rotator",
            "device_id": "mount",
            "connected": True,
            "previous_connected": False,
        },
    )
    assert subscription.queue.get_nowait()[1]["device"] == "rig"
    messagemodule._publish_hardware_changes("target-1", connected, connected)
    assert subscription.queue.empty()
    messagemodule._publish_hardware_changes("target-1", connected, disconnected)
    assert [subscription.queue.get_nowait()[1]["connected"] for _ in range(2)] == [False, False]


def test_rotator_events_follow_observed_motion_and_worker_loss():
    broker = EventBroker()
    subscription = broker.subscribe("station-token", ["station:read"])

    def observe(sequence, data, generation="worker-1", requested_state="connected"):
        broker.observe_rotator(
            "target-1",
            {
                "worker_generation": generation,
                "observed_at": float(sequence),
                "tracking_state": {"rotator_id": "mount", "rotator_state": requested_state},
                "rotator_data": data,
            },
        )

    observe(1, {"connected": False})
    first = subscription.queue.get_nowait()
    assert first[0] == "tracker.rotator.state.changed"
    assert first[1]["previous"] is None
    assert first[1]["current"] == "disconnected"
    observe(2, {"connected": True})
    assert subscription.queue.get_nowait()[1]["current"] == "connected"
    observe(2.5, {"connected": True, "stopped": True})
    assert subscription.queue.empty()
    observe(3, {"connected": True, "tracking": True, "slewing": True})
    slew = subscription.queue.get_nowait()[1]
    assert (slew["previous"], slew["current"], slew["tracking_enabled"]) == (
        "connected",
        "slewing",
        True,
    )
    observe(4, {"connected": True, "tracking": True, "slewing": True})
    assert subscription.queue.empty()
    observe(5, {"connected": True, "tracking": True})
    assert subscription.queue.get_nowait()[1]["current"] == "tracking"
    observe(6, {"connected": False})
    assert subscription.queue.get_nowait()[1]["current"] == "disconnected"
    observe(7, {"connected": True, "tracking": True, "slewing": True})
    assert subscription.queue.get_nowait()[1]["current"] == "slewing"
    observe(8, {"connected": True, "slewing": True})
    mode_change = subscription.queue.get_nowait()[1]
    assert (mode_change["previous"], mode_change["current"]) == ("slewing", "slewing")
    assert (mode_change["previous_tracking_enabled"], mode_change["tracking_enabled"]) == (
        True,
        False,
    )

    broker.reconcile_rotator_workers(lambda _tracker_id: False)
    lost = subscription.queue.get_nowait()[1]
    assert (lost["previous"], lost["current"]) == ("slewing", "unavailable")
    broker.reconcile_rotator_workers(lambda _tracker_id: False)
    assert subscription.queue.empty()
    observe(9, {"connected": True, "tracking": True}, generation="worker-2")
    recovered = subscription.queue.get_nowait()[1]
    assert (recovered["previous"], recovered["current"]) == ("unavailable", "tracking")
    observe(
        10, {"connected": True, "stopped": True}, generation="worker-2", requested_state="stopped"
    )
    assert subscription.queue.get_nowait()[1]["current"] == "stopped"
    observe(11, {"connected": True, "outofbounds": True}, generation="worker-2")
    assert subscription.queue.get_nowait()[1]["current"] == "out_of_bounds"
    observe(12, {"connected": True, "error": True}, generation="worker-2")
    assert subscription.queue.get_nowait()[1]["current"] == "error"
    broker.observe_rotator(
        "target-1",
        {
            "worker_generation": "worker-2",
            "tracking_state": {"rotator_id": "other-mount"},
            "rotator_data": {"connected": False},
        },
    )
    reassigned = subscription.queue.get_nowait()[1]
    assert (reassigned["previous_device_id"], reassigned["device_id"]) == (
        "mount",
        "other-mount",
    )


def test_rotator_worker_replacement_reports_unavailable_before_new_status():
    broker = EventBroker()
    subscription = broker.subscribe("station-token", ["station:read"])
    base = {
        "tracking_state": {"rotator_id": "mount"},
        "rotator_data": {"connected": True, "tracking": True},
    }
    broker.observe_rotator("target-1", {**base, "worker_generation": "old"})
    assert subscription.queue.get_nowait()[1]["current"] == "tracking"
    broker.observe_rotator("target-1", {**base, "worker_generation": "new"})
    assert [subscription.queue.get_nowait()[1]["current"] for _ in range(2)] == [
        "unavailable",
        "tracking",
    ]


def test_rig_events_follow_observed_modes_and_worker_loss():
    broker = EventBroker()
    subscription = broker.subscribe("station-token", ["station:read"])

    def observe(sequence, data, generation="worker-1", rig_id="radio", requested_state="connected"):
        broker.observe_rig(
            "target-1",
            {
                "worker_generation": generation,
                "observed_at": float(sequence),
                "tracking_state": {"rig_id": rig_id, "rig_state": requested_state},
                "rig_data": data,
            },
        )

    observe(1, {"connected": False})
    first = subscription.queue.get_nowait()
    assert first[0] == "tracker.rig.state.changed"
    assert (first[1]["previous"], first[1]["current"]) == (None, "disconnected")
    observe(2, {"connected": True})
    assert subscription.queue.get_nowait()[1]["current"] == "connected"
    observe(3, {"connected": True, "tracking": True, "frequency": 145800000})
    assert subscription.queue.get_nowait()[1]["current"] == "tracking"
    observe(4, {"connected": True, "tracking": True, "frequency": 145800010})
    assert subscription.queue.empty()
    observe(5, {"connected": True, "tracking": True, "tuning": True})
    tuning = subscription.queue.get_nowait()[1]
    assert (tuning["current"], tuning["tracking_enabled"]) == ("tuning", True)
    observe(6, {"connected": True, "tracking": True})
    assert subscription.queue.get_nowait()[1]["current"] == "tracking"
    observe(7, {"connected": True, "stopped": True}, requested_state="stopped")
    assert subscription.queue.get_nowait()[1]["current"] == "stopped"
    observe(8, {"connected": False, "error": True})
    assert subscription.queue.get_nowait()[1]["current"] == "error"
    observe(9, {"connected": False})
    assert subscription.queue.get_nowait()[1]["current"] == "disconnected"
    broker.reconcile_rig_workers(lambda _tracker_id: False)
    assert subscription.queue.get_nowait()[1]["current"] == "unavailable"
    broker.reconcile_rig_workers(lambda _tracker_id: False)
    assert subscription.queue.empty()
    observe(10, {"connected": True}, generation="worker-2")
    assert subscription.queue.get_nowait()[1]["current"] == "connected"
    observe(11, {"connected": True}, generation="worker-3")
    assert [subscription.queue.get_nowait()[1]["current"] for _ in range(2)] == [
        "unavailable",
        "connected",
    ]
    observe(12, {"connected": False}, generation="worker-3", rig_id="other-radio")
    changed = subscription.queue.get_nowait()[1]
    assert (changed["previous_device_id"], changed["device_id"]) == ("radio", "other-radio")


@pytest.mark.asyncio
async def test_hardware_state_events_use_ordered_current_worker_snapshots(monkeypatch):
    registry = OperationRegistry()
    incoming = queue.Queue()
    for sequence, state, rig_state, pid in (
        (1, {"connected": True, "tracking": True, "slewing": True}, {"connected": True}, 42),
        (2, {"connected": True, "tracking": True}, {"connected": True, "tracking": True}, 42),
        (3, {"connected": False}, {"connected": False}, 41),
    ):
        incoming.put(
            {
                "event": "tracker-hardware-state",
                "data": {
                    "tracker_id": "target-1",
                    "worker_started_at": 1,
                    "worker_generation": "worker-1",
                    "worker_pid": pid,
                    "sequence": sequence,
                    "observed_at": float(sequence),
                    "tracking_state": {"rotator_id": "mount", "rig_id": "radio"},
                    "rotator_data": state,
                    "rig_data": rig_state,
                },
            }
        )
    process = SimpleNamespace(pid=42, is_alive=lambda: True)
    supervisor = SimpleNamespace(get_runtime=lambda _id: SimpleNamespace(process=process))
    broker = EventBroker()
    subscription = broker.subscribe("station-token", ["station:read"])
    monkeypatch.setattr(messagemodule, "operations", registry)
    monkeypatch.setattr(messagemodule, "queue_from_tracker", incoming)
    monkeypatch.setattr(
        messagemodule,
        "get_existing_tracker_manager",
        lambda _id: SimpleNamespace(current_tracking_state={}),
    )
    monkeypatch.setattr(messagemodule, "get_tracker_supervisor", lambda: supervisor)
    monkeypatch.setattr(messagemodule, "public_events", broker)

    calls = 0

    async def stop_after_messages(_delay):
        nonlocal calls
        calls += 1
        if calls == 3:
            raise asyncio.CancelledError

    monkeypatch.setattr(messagemodule.asyncio, "sleep", stop_after_messages)
    with pytest.raises(asyncio.CancelledError):
        await messagemodule.handle_tracker_messages(AsyncMock())

    events = [subscription.queue.get_nowait() for _ in range(6)]
    assert [name for name, _ in events] == [
        "tracker.hardware.changed",
        "tracker.hardware.changed",
        "tracker.rotator.state.changed",
        "tracker.rig.state.changed",
        "tracker.rotator.state.changed",
        "tracker.rig.state.changed",
    ]
    assert [events[2][1]["current"], events[4][1]["current"]] == ["slewing", "tracking"]
    assert [events[3][1]["current"], events[5][1]["current"]] == ["connected", "tracking"]
    assert subscription.queue.empty()
    assert registry.observed["target-1"]["sequence"] == 2


@pytest.mark.asyncio
async def test_command_snapshot_hardware_change_precedes_regular_snapshot(monkeypatch):
    registry = OperationRegistry()
    command = registry.accept("target-1", {"rig_state": "connected"}, STATE)
    snapshot = {
        "tracker_id": "target-1",
        "worker_started_at": 1,
        "worker_generation": "worker-1",
        "sequence": 1,
        "tracking_state": {"rig_id": "radio"},
        "rig_data": {"connected": True},
    }
    incoming = queue.Queue()
    incoming.put(
        {
            "event": "tracker-command-status",
            "data": {
                "tracker_id": "target-1",
                "command_id": command["command_id"],
                "epoch": registry.epoch,
                "status": "succeeded",
                "snapshot": snapshot,
            },
        }
    )
    incoming.put({"event": "tracker-hardware-state", "data": {**snapshot, "sequence": 2}})
    broker = EventBroker()
    subscription = broker.subscribe("station-token", ["station:read"])
    manager = SimpleNamespace(current_tracking_state={}, reconcile_operation=AsyncMock())
    monkeypatch.setattr(messagemodule, "operations", registry)
    monkeypatch.setattr(messagemodule, "queue_from_tracker", incoming)
    monkeypatch.setattr(messagemodule, "get_existing_tracker_manager", lambda _id: manager)
    monkeypatch.setattr(messagemodule, "public_events", broker)

    calls = 0

    async def stop_after_messages(_delay):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise asyncio.CancelledError

    monkeypatch.setattr(messagemodule.asyncio, "sleep", stop_after_messages)
    with pytest.raises(asyncio.CancelledError):
        await messagemodule.handle_tracker_messages(AsyncMock())

    assert subscription.queue.get_nowait() == (
        "tracker.hardware.changed",
        {
            "tracker_id": "target-1",
            "device": "rig",
            "device_id": "radio",
            "connected": True,
            "previous_connected": None,
        },
    )
    rig_event = subscription.queue.get_nowait()
    assert rig_event[0] == "tracker.rig.state.changed"
    assert (rig_event[1]["previous"], rig_event[1]["current"]) == (None, "connected")
    assert subscription.queue.empty()


@pytest.mark.asyncio
async def test_late_worker_result_cannot_overwrite_newer_desired_state(monkeypatch, db_session):
    registry = OperationRegistry()
    monkeypatch.setattr(managermodule, "operations", registry)

    @asynccontextmanager
    async def session():
        yield db_session

    monkeypatch.setattr(managermodule, "AsyncSessionLocal", session)
    manager = TrackerManager(tracker_id="target-1")
    desired = {**STATE, "rotator_state": "stopped"}
    db_session.add(TrackingState(name=manager.tracking_state_name, value=desired))
    await db_session.commit()
    command = request(registry)
    registry.accept("target-1", {"rotator_state": "stopped"}, desired, {"action": "stop"})
    snapshot = {"tracking_state": {**STATE, "rotator_state": "disconnected"}}
    await manager.reconcile_operation(command, snapshot)
    assert (await manager.get_tracking_state())["rotator_state"] == "stopped"
    assert snapshot["desired_state"]["rotator_state"] == "stopped"


def _fake_worker_tracker():
    outbox = []
    return (
        SimpleNamespace(
            tracker_id="target-1",
            input_tracking_state={"rotator_state": "stopped"},
            rotator_data={"az": 10.0, "el": 5.0, "connected": True},
            rig_data={"frequency": 145800000, "connected": True},
            queue_out=SimpleNamespace(put=outbox.append),
        ),
        outbox,
    )


def test_publish_skips_unchanged_snapshots_until_heartbeat(monkeypatch):
    tracker, outbox = _fake_worker_tracker()
    operations = WorkerOperations(tracker)
    clock = [1000.0]
    monkeypatch.setattr("tracker.execution.time.time", lambda: clock[0])

    operations.publish()
    operations.publish()
    assert len(outbox) == 1, "identical hardware state must not be re-published every tick"

    # A real change goes out immediately and bumps the sequence.
    tracker.rotator_data["az"] = 11.0
    operations.publish()
    assert len(outbox) == 2
    assert outbox[-1]["data"]["sequence"] == 2
    assert outbox[-1]["data"]["rotator_data"]["az"] == 11.0

    # Unchanged state is still repeated as a heartbeat so the UI never marks it stale.
    clock[0] += WorkerOperations.HEARTBEAT_SECONDS
    operations.publish()
    assert len(outbox) == 3

    # Mutating the live dict after publishing must still register as a change
    # (the comparison baseline is a copy, not a reference).
    tracker.rig_data["frequency"] = 145801000
    operations.publish()
    assert len(outbox) == 4
