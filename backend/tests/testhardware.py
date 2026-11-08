# Copyright (c) 2026 Efstratios Goudelis
"""Exercise real IPC and TCP against local Hamlib protocol doubles."""

import asyncio
import json
import logging
import queue
import threading
import time
from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock

import numpy as np
import pytest
import pytest_asyncio
import socketio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from controllers.rotator import RotatorController, StopUnconfirmed
from crud import hardware as hardware_crud
from db.models import TrackingState
from hardware import control
from hardware.client import HardwareClient, RigProxy, RotatorProxy
from hardware.errors import ControlReleased
from hardware.runtime import DeviceRuntime
from hardware.service import HardwareSupervisor
from observations.tasks import trackerhandler as observationmodule
from observations.tasks.trackerhandler import TrackerHandler
from tracker import instances
from tracker import manager as managermodule
from tracker.contracts import get_tracking_state_name
from tracker.logic import SatelliteTracker
from tracker.manager import TrackerManager
from tracker.operations import OperationRegistry


@pytest_asyncio.fixture
async def station():
    service = HardwareSupervisor()
    service.start()
    commands, connections = [], []
    position = [20.0, 10.0]
    frequency = [145000000]
    writers = set()

    async def hamlib(reader, writer):
        connections.append(writer.get_extra_info("peername"))
        writers.add(writer)
        try:
            while line := await reader.readline():
                command = line.decode().strip()
                commands.append(command)
                if command == "S" and details.get("_ignore_stop"):
                    continue
                if command in {"p", "f"} and details.get("_drop_reads"):
                    break
                if command == "q":
                    break
                if command == "p":
                    # Keep reporting physical motion even after producer updates
                    # have paused, as a controller without Stop does during a slew.
                    if time.monotonic() < details.get("_moving_until", 0):
                        position[0] += 1
                    response = f"{position[0]}\n{position[1]}\n"
                elif command.startswith("P "):
                    if not details.get("_hold_moves"):
                        position[:] = [float(value) for value in command.split()[1:]]
                    response = "RPRT 0\n"
                elif command in {"S", "K"}:
                    response = "RPRT 0\n"
                elif command == "f":
                    response = f"{frequency[0]}\n"
                elif command.startswith("F "):
                    frequency[0] = int(command.split()[-1])
                    response = "RPRT 0\n"
                elif command.startswith("V "):
                    response = "RPRT 0\n"
                else:
                    response = "RPRT -4\n"
                writer.write(response.encode())
                await writer.drain()
        finally:
            writers.discard(writer)
            writer.close()
            await writer.wait_closed()

    server = await asyncio.start_server(hamlib, "127.0.0.1", 0)
    details = dict(
        host="127.0.0.1",
        port=server.sockets[0].getsockname()[1],
        minaz=0,
        maxaz=450,
        minel=0,
        maxel=90,
        azimuth_mode="0_450",
        retune_interval_ms=1,
        radio_mode="monitor",
        tx_control_mode="vfo_switch",
    )
    try:
        yield service, details, commands, connections
    finally:
        await service.shutdown()
        server.close()
        await server.wait_closed()
        for writer in list(writers):
            writer.close()


@pytest.mark.asyncio
async def test_rotator_connection_survives_transfer_and_fences_old_producer(station):
    service, details, commands, connections = station
    first = RotatorProxy(HardwareClient(service.register_tracker("target-1")), "mount", details)
    second = RotatorProxy(HardwareClient(service.register_tracker("sonde-1")), "mount", details)
    await first.connect()
    await anext(first.set_position(100, 30))
    opened = len(connections)
    await service.release_tracker("target-1")
    await second.connect()
    assert len(connections) == opened
    with pytest.raises(RuntimeError, match="control changed"):
        await anext(first.set_position(200, 40))
    assert "P 200 40" not in commands
    await first.disconnect()
    assert await second.get_position() == (100, 30)
    assert service.snapshots()[0]["owner"]["id"] == "sonde-1"


@pytest.mark.asyncio
@pytest.mark.parametrize("activity", ["idle", "pending", "moving", "unsupported-stop"])
async def test_explicit_tracker_connect_takes_manual_rotator_control(
    station, monkeypatch, db_session, activity
):
    service, details, commands, connections = station
    details["_hold_moves"] = activity in {"moving", "unsupported-stop"}
    details["stop_supported"] = activity != "unsupported-stop"
    registry = OperationRegistry()
    monkeypatch.setattr(control, "hardware", service)
    monkeypatch.setattr(control, "operations", registry)
    monkeypatch.setattr(managermodule, "hardware", service)
    monkeypatch.setattr(managermodule, "operations", registry)

    @asynccontextmanager
    async def session():
        yield db_session

    monkeypatch.setattr(managermodule, "AsyncSessionLocal", session)
    manager = TrackerManager(tracker_id="target-1")
    manager._sync_tracker_context = AsyncMock()
    saved = {"rotator_id": "mount", "rotator_state": "disconnected"}
    db_session.add(TrackingState(name=manager.tracking_state_name, value=saved))
    await db_session.commit()

    async def submit(action, **extra):
        worker = service.devices.get(("rotator", "mount"))
        return await control.submit_device_command(
            "rotator",
            "mount",
            action,
            details,
            {
                "command_id": action,
                "epoch": registry.epoch,
                "accept_before": time.time() + 10,
                "generation": worker.snapshot.get("generation") if worker else None,
                **extra,
            },
        )

    await submit("connect")
    async with asyncio.timeout(5):
        while registry.records["connect"]["status"] != "succeeded":
            await asyncio.sleep(0.01)
    if activity != "idle":
        await submit("move", position={"az": 90, "el": 25})
        async with asyncio.timeout(5):
            while "P 90 25" not in commands:
                await asyncio.sleep(0.01)
        assert registry.records["move"]["status"] == "started"

    previous = service.devices[("rotator", "mount")].snapshot.copy()
    opened = len(connections)
    reply = await manager.update_tracking_state(
        rotator_state="connected",
        operation={"command_id": "tracker-connect", "action": "connect", "epoch": registry.epoch},
    )
    assert reply["success"] is True, reply
    command = reply["command"]
    assert command["manual_handoff"]["generation"] == previous["generation"]
    # Acceptance cannot cancel physical work before its ownership is fenced.
    if activity != "idle":
        assert command["supersedes"] == ["move"]
        assert registry.records["move"]["status"] == "started"

    tracker = SatelliteTracker(
        queue.Queue(),
        queue.Queue(),
        tracker_id="target-1",
        hardware_client=HardwareClient(service.register_tracker("target-1")),
    )
    tracker.current_rotator_id = "mount"
    tracker.rotator_details = details
    tracker.input_tracking_state = {**saved, "rotator_state": "connected"}
    tracker.operations.accept({"operation": command})
    tracker.operations.begin_cycle()
    await tracker.rotator_handler.handle_rotator_state_change("disconnected", "connected")
    tracker.operations.finish_cycle()

    assert tracker.rotator_data["connected"] is True
    assert tracker.rotator_data["tracking"] is False
    assert tracker.rotator_data["error"] is False
    assert service.snapshots()[0]["owner"]["id"] == "target-1"
    assert len(connections) == opened
    assert commands.count("S") == (1 if activity == "moving" else 0)
    results = [
        message["data"]
        for message in tracker.queue_out._queue_out.queue
        if message["event"] == "tracker-command-status"
    ]
    assert results[-1]["status"] == "succeeded"
    assert "tracker-connect" not in tracker.operations.pending
    if activity != "idle":
        async with asyncio.timeout(5):
            while registry.records["move"]["status"] == "started":
                await asyncio.sleep(0.01)
        assert registry.records["move"]["status"] == "cancelled"
    with pytest.raises(ControlReleased):
        await service.call(
            "rotator",
            "mount",
            "position",
            owner=previous["owner"],
            generation=previous["generation"],
            az=200,
            el=40,
        )
    assert "P 200 40" not in commands
    assert await tracker.rotator_controller.get_position()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "changed",
    [
        "ordinary-connect",
        "generation",
        "owner",
        "tracker-owner",
        "requester",
        "expired",
        "reservation",
        "rig",
    ],
)
async def test_manual_handoff_cannot_bypass_other_ownership_guards(station, changed):
    service, details, commands, connections = station
    kind = "rig" if changed == "rig" else "rotator"
    owner = "manual-owner"
    service.owners[owner] = {"type": "manual", "id": owner}
    lease = await service.call(kind, "mount", "acquire", owner=owner, details=details)
    handoff = {
        "device_id": "mount",
        "owner": owner,
        "generation": lease["generation"],
        "deadline": time.time() + 10,
    }
    if changed == "generation":
        handoff["generation"] = "obsolete"
    elif changed == "owner":
        service.owners[owner] = {"type": "observation", "id": "obs-one"}
    elif changed == "tracker-owner":
        service.owners[owner] = {"type": "tracker", "id": "target-2"}
    elif changed == "expired":
        handoff["deadline"] = time.time() - 1
    elif changed == "reservation":
        service.reservations[(kind, "mount")] = {"tracker_id": "obs-one"}
    factory = RigProxy if kind == "rig" else RotatorProxy
    requester = "obs-one" if changed == "requester" else "target-1"
    tracker = factory(HardwareClient(service.register_tracker(requester)), "mount", details)
    with pytest.raises(RuntimeError):
        await tracker.connect(manual_handoff=None if changed == "ordinary-connect" else handoff)
    assert service.devices[(kind, "mount")].snapshot["owner"] == owner
    assert "S" not in commands


@pytest.mark.asyncio
async def test_observation_reservation_during_manual_handoff_blocks_tracker(station, monkeypatch):
    service, details, commands, connections = station
    service.owners["manual-owner"] = {"type": "manual", "id": "manual-owner"}
    lease = await service.call("rotator", "mount", "acquire", owner="manual-owner", details=details)
    released, resume = asyncio.Event(), asyncio.Event()
    release = service.release

    async def pause_release(*args, **kwargs):
        await release(*args, **kwargs)
        released.set()
        await resume.wait()

    monkeypatch.setattr(service, "release", pause_release)
    tracker = RotatorProxy(HardwareClient(service.register_tracker("target-1")), "mount", details)
    task = asyncio.create_task(
        tracker.connect(
            manual_handoff={
                "device_id": "mount",
                "owner": "manual-owner",
                "generation": lease["generation"],
                "deadline": time.time() + 10,
            }
        )
    )
    await asyncio.wait_for(released.wait(), timeout=5)
    async with service.reserve([("rotator", "mount")], "one"):
        resume.set()
        with pytest.raises(RuntimeError, match="reserved"):
            await asyncio.wait_for(task, timeout=5)
        assert service.snapshots()[0]["owner"] is None
        assert service.snapshots()[0]["data"]["connected"] is True


@pytest.mark.asyncio
async def test_queued_manual_acquire_cannot_restart_motion_after_release(station, monkeypatch):
    service, details, commands, connections = station
    registry = OperationRegistry()
    monkeypatch.setattr(control, "hardware", service)
    monkeypatch.setattr(control, "operations", registry)
    owner = "manual:rotator:mount"
    lease = await service.call("rotator", "mount", "acquire", owner=owner, details=details)
    command = registry.accept(
        owner,
        {"rotator_id": "mount"},
        {"rotator_id": "mount"},
        {"action": "move", "position": {"az": 90, "el": 25}},
    )
    queued, resume = asyncio.Event(), asyncio.Event()
    call = service.call

    async def delayed_acquire(kind, device_id, method, **kwargs):
        if method == "acquire":
            queued.set()
            await resume.wait()
        return await call(kind, device_id, method, **kwargs)

    monkeypatch.setattr(service, "call", delayed_acquire)
    task = asyncio.create_task(
        control.execute_device_command(
            "rotator",
            "mount",
            "move",
            details,
            owner,
            command,
            lease["generation"],
        )
    )
    await asyncio.wait_for(queued.wait(), timeout=5)
    await service.release("rotator", "mount")
    resume.set()
    await asyncio.wait_for(task, timeout=5)
    assert registry.records[command["command_id"]]["status"] == "cancelled"
    assert service.snapshots()[0]["owner"] is None
    assert "P 90 25" not in commands


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", ["rotator", "rig"])
@pytest.mark.parametrize("handoff", [True, False])
async def test_tracker_handoff_is_silent_but_communication_failure_emits_error(
    station, monkeypatch, caplog, kind, handoff
):
    service, details, commands, connections = station
    monkeypatch.setattr(logging.getLogger("tracker-worker"), "propagate", True)
    output = queue.Queue()
    stopped = asyncio.Event()
    stopped.set()  # Finish after one real tracker loop iteration.
    tracker = SatelliteTracker(
        output,
        queue.Queue(),
        stop_event=stopped,
        tracker_id="target-1",
        hardware_client=HardwareClient(service.register_tracker("target-1")),
    )
    tracker.input_tracking_state = {
        "rotator_id": "device" if kind == "rotator" else "none",
        "rotator_state": "connected" if kind == "rotator" else "disconnected",
        "rig_id": "device" if kind == "rig" else "none",
        "rig_state": "connected" if kind == "rig" else "disconnected",
    }
    setattr(tracker, f"current_{kind}_id", "device")
    setattr(tracker, f"{kind}_details", details)
    handler = tracker.rotator_handler if kind == "rotator" else tracker.rig_handler
    await getattr(handler, f"connect_to_{kind}")()
    opened = len(connections)
    # Keep the existing connection so the loop exercises a late producer read.
    monkeypatch.setattr(tracker.state_manager, "process_state_changes", AsyncMock())
    if handoff:
        await service.release(kind, "device")
        factory = RotatorProxy if kind == "rotator" else RigProxy
        observer = factory(HardwareClient(service.register_tracker("obs-one")), "device", details)
        await observer.connect()
    else:
        details["_drop_reads"] = True

    await asyncio.wait_for(tracker.run(), timeout=5)

    messages = list(output.queue)
    error_events = [
        event
        for message in messages
        for event in message.get("data", {}).get("events", [])
        if event["name"] in {"rotator_error", "rig_error"}
    ]
    assert bool(error_events) is not handoff
    assert ("communication failed" in caplog.text) is not handoff
    assert tracker.input_tracking_state[f"{kind}_state"] == "disconnected"
    assert getattr(tracker, f"{kind}_controller") is None
    if handoff:
        snapshot = service.snapshots()[0]
        assert snapshot["owner"]["id"] == "obs-one"
        assert snapshot["data"]["connected"] is True
        assert len(connections) == opened
        assert "S" not in commands
        assert tracker.stats["errors"] == 0
        assert any(
            message.get("data", {}).get(f"{kind}_data", {}).get("error") is False
            and message.get("data", {}).get("tracking_state", {}).get(f"{kind}_state")
            == "disconnected"
            for message in messages
        )
        if kind == "rotator":
            assert await observer.get_position() == (20, 10)
        else:
            assert await observer.get_frequency() == 145000000


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", ["rotator", "rig"])
async def test_late_tracking_write_after_handoff_detaches_without_error(station, kind):
    service, details, _, _ = station
    output = queue.Queue()
    tracker = SatelliteTracker(
        output,
        queue.Queue(),
        tracker_id="target-1",
        hardware_client=HardwareClient(service.register_tracker("target-1")),
    )
    tracker.input_tracking_state = {f"{kind}_id": "device", f"{kind}_state": "tracking"}
    setattr(tracker, f"current_{kind}_id", "device")
    setattr(tracker, f"current_{kind}_state", "tracking")
    setattr(tracker, f"{kind}_details", details)
    handler = tracker.rotator_handler if kind == "rotator" else tracker.rig_handler
    await getattr(handler, f"connect_to_{kind}")()
    await service.release(kind, "device")

    # Extended azimuth commands have a separate failure path; they must not
    # misreport an expected handoff as an unsupported controller position.
    with pytest.raises(ControlReleased) as caught:
        if kind == "rotator":
            await handler._issue_rotator_command(370, 30)
        else:
            await handler.control_rig_frequency()
    assert caught.value.kind == kind
    await getattr(handler, f"handle_{kind}_error")(caught.value)
    assert getattr(tracker, f"{kind}_controller") is None
    assert getattr(tracker, f"{kind}_data")["error"] is False
    assert not any(
        event["name"] in {"rotator_error", "rig_error"}
        for message in output.queue
        for event in message.get("data", {}).get("events", [])
    )


@pytest.mark.asyncio
async def test_handoff_during_heartbeat_does_not_count_as_tracker_failure(monkeypatch, caplog):
    output = queue.Queue()
    stopped = asyncio.Event()
    stopped.set()
    tracker = SatelliteTracker(
        output, queue.Queue(), stop_event=stopped, tracker_id="target-1", hardware_client=object()
    )
    tracker.input_tracking_state = {"rotator_id": "mount", "rotator_state": "tracking"}
    tracker.input_location = {"latitude": 0, "longitude": 0}
    tracker.rotator_controller = AsyncMock()
    tracker.rotator_controller.call.side_effect = ControlReleased("Released", kind="rotator")
    monkeypatch.setattr(logging.getLogger("tracker-worker"), "propagate", True)
    monkeypatch.setattr(tracker.state_manager, "process_state_changes", AsyncMock())
    monkeypatch.setattr(tracker.rotator_handler, "update_hardware_position", AsyncMock())
    monkeypatch.setattr(
        tracker,
        "_resolve_target_context",
        lambda *_: {
            "target_type": "satellite",
            "target_name": "Test",
            "satellite_data": {"details": {"name": "Test"}},
            "skypoint": (20, 10),
        },
    )

    await asyncio.wait_for(tracker.run(), timeout=5)

    assert tracker.rotator_controller is None
    assert tracker.input_tracking_state["rotator_state"] == "disconnected"
    assert tracker.stats["errors"] == 0
    assert "Error in satellite tracking task" not in caplog.text
    assert not any(
        event["name"] == "rotator_error"
        for message in output.queue
        for event in message.get("data", {}).get("events", [])
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("manual", [False, True])
async def test_observation_handoff_without_assignment_map_keeps_connection(
    station, monkeypatch, manual
):
    service, details, commands, connections = station
    first = RotatorProxy(HardwareClient(service.register_tracker("target-1")), "mount", details)
    observer = RotatorProxy(HardwareClient(service.register_tracker("obs-one")), "mount", details)
    if manual:
        service.owners["manual-owner"] = {"type": "manual", "id": "manual-owner"}
        lease = await service.call(
            "rotator", "mount", "acquire", owner="manual-owner", details=details
        )
        await service.call(
            "rotator",
            "mount",
            "position",
            owner="manual-owner",
            generation=lease["generation"],
            az=100,
            el=30,
        )
    else:
        await first.connect()
        await anext(first.set_position(100, 30))
        await first.call("mode", mode="tracking")
    opened = len(connections)
    monkeypatch.setattr(observationmodule, "hardware", service)
    monkeypatch.setattr(observationmodule, "get_assigned_tracker_for_rotator", lambda _id: None)
    monkeypatch.setattr(observationmodule, "get_all_tracker_managers", lambda: {})

    async with service.reserve([("rotator", "mount")], "one") as reservation:
        await TrackerHandler()._release_existing_hardware("one", "mount", None)
        assert service.snapshots()[0]["owner"] is None
        assert service.snapshots()[0]["data"]["connected"]
        reservation["tracker_id"] = "obs-one"
        await observer.connect()

    assert len(connections) == opened
    # The fake server completes a manual move immediately; active satellite
    # tracking still requires Stop before ownership can transfer.
    assert commands.count("S") == (0 if manual else 1)
    assert service.snapshots()[0]["owner"]["id"] == "obs-one"
    if not manual:
        with pytest.raises(RuntimeError, match="control changed"):
            await anext(first.set_position(200, 40))
        await first.disconnect()
    assert await observer.get_position() == (100, 30)


@pytest.mark.asyncio
@pytest.mark.parametrize("park", [False, True])
async def test_observation_cleanup_disconnects_without_stop(station, monkeypatch, park):
    service, details, commands, connections = station
    # Match controllers that leave S unanswered: cleanup must not wait for its timeout.
    details["_ignore_stop"] = True
    client = RotatorProxy(HardwareClient(service.register_tracker("obs-one")), "mount", details)
    service.on_intent = AsyncMock()
    await client.connect()
    await anext(client.set_position(100, 30))
    await client.call("mode", mode="tracking")
    opened = len(connections)
    old_generation = client.generation
    state = {"rotator_id": "mount", "rotator_state": "tracking", "rig_id": "none"}
    manager = AsyncMock()
    manager.get_tracking_state.return_value = state
    removed = []

    async def confirmed(_self, _tracker_id, value, _observation_id):
        # Stand in for the tracker consuming state updates; all hardware calls
        # still travel through real IPC to the TCP controller.
        if value.get("rotator_state") == "parked":
            await client.park()
        elif value.get("rotator_state") == "disconnected":
            await client.disconnect()
        if value.get("rotator_id") == "none":
            assert service.snapshots()[0]["data"]["connected"] is False
        state.update(value)

    async def remove(_self, tracker_id):
        removed.append(tracker_id)
        return True

    monkeypatch.setattr(observationmodule, "hardware", service)
    monkeypatch.setattr(observationmodule, "get_tracker_manager", lambda _id: manager)
    monkeypatch.setattr(TrackerHandler, "_update_and_confirm", confirmed)
    monkeypatch.setattr(TrackerHandler, "_remove_observation_tracker_instance", remove)

    assert await asyncio.wait_for(
        TrackerHandler().stop_tracker_task(
            "one", {"park_after_observation": park}, {"tracker_id": "obs-one"}
        ),
        timeout=2,
    )

    snapshot = service.snapshots()[0]
    assert snapshot["data"]["connected"] is False
    assert snapshot["data"]["motion_unconfirmed"] is True
    assert snapshot["owner"] is None
    assert snapshot["generation"] != old_generation
    assert state["rotator_state"] == "disconnected"
    assert state["rotator_id"] == "none"
    assert removed == ["obs-one"]
    assert "S" not in commands
    assert commands.count("K") == int(park)
    assert len(connections) == opened
    service.on_intent.assert_awaited_with("rotator", "mount", False)
    # Disconnect invalidates queued commands from the old observation producer.
    with pytest.raises(RuntimeError, match="control changed"):
        await client.call("heartbeat")


@pytest.mark.asyncio
async def test_numpy_tracking_coordinates_produce_json_safe_hardware_telemetry(station):
    service, details, _, _ = station
    client = RotatorProxy(HardwareClient(service.register_tracker("target-1")), "mount", details)
    await client.connect()
    # Orbit calculations supply NumPy coordinates through the tracker pipe.
    # Comparing them with hardware readings also produces NumPy boolean flags.
    await anext(client.set_position(np.float64(100), np.float64(30)))
    await client.get_position()
    snapshot = service.snapshots()[0]
    sio = socketio.AsyncServer(async_mode="asgi")
    # Encode the actual event packet even though this test has no browser clients.
    sio.packet_class(packet_type=socketio.packet.EVENT, data=["hardware-state", snapshot]).encode()
    restored = json.loads(json.dumps({"data": [snapshot]}, allow_nan=False))
    data = restored["data"][0]["data"]
    assert data["stopped"] is True
    assert data["slewing"] is False
    assert data["az"] == 100
    assert data["el"] == 30


@pytest.mark.asyncio
async def test_crashed_worker_can_be_reconnected_without_inheriting_control(station):
    service, details, _, _ = station
    client = RotatorProxy(HardwareClient(service.register_tracker("target-1")), "mount", details)
    await client.connect()
    await anext(client.set_position(100, 30))
    await client.call("mode", mode="tracking")
    worker = service.devices[("rotator", "mount")]
    previous_generation = worker.snapshot["worker_generation"]
    # Simulate abrupt death even when app imports installed a SIGTERM handler.
    worker.process.kill()
    await asyncio.to_thread(worker.process.join, 2)
    assert not worker.process.is_alive()
    await service.release("rotator", "mount")
    assert worker.snapshot["owner"] is None
    assert worker.snapshot["data"]["tracking"]
    lease = await service.call("rotator", "mount", "acquire", owner="manual", details=details)
    replacement = service.devices[("rotator", "mount")]
    assert replacement.snapshot["worker_generation"] != previous_generation
    assert replacement.snapshot["owner"] == "manual"
    assert lease["data"]["motion_unconfirmed"] is True
    with pytest.raises(StopUnconfirmed, match="stationary"):
        await service.call(
            "rotator",
            "mount",
            "position",
            owner="manual",
            generation=lease["generation"],
            az=90,
            el=25,
        )
    async with asyncio.timeout(6):
        while replacement.snapshot["data"]["motion_unconfirmed"]:
            await asyncio.sleep(0.1)
    await service.call("rotator", "mount", "acquire", owner="manual", details=details)
    with pytest.raises(RuntimeError, match="control changed"):
        await anext(client.set_position(200, 40))


@pytest.mark.asyncio
@pytest.mark.parametrize("action", ["connect", "take-control"])
async def test_manual_connect_recovers_a_crashed_worker(station, monkeypatch, action):
    service, details, commands, connections = station
    registry = OperationRegistry()
    monkeypatch.setattr(control, "hardware", service)
    monkeypatch.setattr(control, "operations", registry)
    owner = "manual:rotator:mount"
    service.owners[owner] = {"type": "manual", "id": owner}
    await service.call("rotator", "mount", "acquire", owner=owner, details=details)
    worker = service.devices[("rotator", "mount")]
    worker.process.kill()
    await asyncio.to_thread(worker.process.join, 2)
    command = await control.submit_device_command(
        "rotator",
        "mount",
        action,
        details,
        {
            "command_id": action,
            "epoch": registry.epoch,
            "accept_before": time.time() + 10,
            "generation": worker.snapshot["generation"],
        },
    )
    async with asyncio.timeout(5):
        while registry.records[command["command_id"]]["status"] in {"submitted", "started"}:
            await asyncio.sleep(0.01)
    assert registry.records[command["command_id"]]["status"] == "succeeded"
    assert service.devices[("rotator", "mount")] is not worker
    assert service.snapshots()[0]["data"]["connected"] is True


@pytest.mark.asyncio
async def test_rig_retune_and_handoff_use_the_same_connection(station):
    service, details, commands, connections = station
    details = {**details, "retune_interval_ms": 60000}
    first = RigProxy(HardwareClient(service.register_tracker("target-1")), "radio", details)
    second = RigProxy(HardwareClient(service.register_tracker("target-2")), "radio", details)
    await first.connect()
    await first.tune(
        {"transmitter_id": "tx", "vfo1": "none", "vfo2": "downlink"},
        {
            "transmitters": [{"id": "tx", "downlink_observed_freq": 145800000, "mode": "FM"}],
        },
    )
    assert "F 145800000" in commands
    opened = len(connections)
    await service.release_tracker("target-1")
    await second.connect()
    assert await second.get_frequency() == 145800000
    await second.tune(
        {"transmitter_id": "new-tx", "vfo1": "none", "vfo2": "downlink"},
        {"transmitters": [{"id": "new-tx", "downlink_observed_freq": 144800000, "mode": "FM"}]},
    )
    assert "F 144800000" in commands
    assert await second.get_frequency() == 144800000
    assert len(connections) == opened


@pytest.mark.asyncio
async def test_duplicate_endpoint_cannot_create_a_second_controller(station):
    service, details, _, _ = station
    first = RotatorProxy(HardwareClient(service.register_tracker("target-1")), "mount", details)
    await first.connect()
    with pytest.raises(ValueError, match="already has a device runtime"):
        service._worker("rotator", "duplicate", details)


class FakeController:
    def __init__(self):
        self.commands = []

    async def close(self):
        self.commands.append("close")

    async def get_position(self):
        return (10, 20)

    async def stop(self):
        self.commands.append("S")
        return True

    async def recover_position(self):
        return (10, 20)


def request(runtime, method, **payload):
    return dict(
        epoch=runtime.epoch,
        deadline=time.time() + 10,
        owner=runtime.owner,
        generation=runtime.generation,
        method=method,
        payload=payload,
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", ["rotator", "rig"])
async def test_acquire_renews_tracker_liveness_until_requests_stop(kind):
    controller = AsyncMock()
    controller.get_position.return_value = (10, 20)
    controller.get_frequency.return_value = 145800000
    runtime = DeviceRuntime(kind, "device", {}, "epoch", controller)
    # An idle device retains the old producer's timestamp across reconnects.
    runtime.last_seen -= runtime.UPDATE_TIMEOUT + 1
    owner = "tracker:target-1:incarnation"
    lease = await runtime.execute({**request(runtime, "acquire"), "owner": owner})
    followup = request(runtime, "position" if kind == "rotator" else "frequency")

    # Polling can run before the tracker sends its first request after Connect.
    await runtime.tick()
    assert runtime.owner == owner
    assert runtime.generation == lease["generation"]
    expected = (10, 20) if kind == "rotator" else 145800000
    assert await runtime.execute(followup) == expected

    # Acquisition renews the lease without disabling lost-producer detection.
    runtime.last_seen -= runtime.UPDATE_TIMEOUT + 1
    await runtime.tick()
    assert runtime.owner is None
    assert runtime.data["connected"] is True
    with pytest.raises(RuntimeError, match="control changed") as caught:
        await runtime.execute(followup)
    assert not isinstance(caught.value, ControlReleased)
    controller.stop.assert_not_awaited()


@pytest.mark.asyncio
async def test_failed_handoff_does_not_silence_later_requests():
    controller = AsyncMock()
    controller.get_position.side_effect = ConnectionError("Controller connection failed")
    runtime = DeviceRuntime("rotator", "mount", {}, "epoch", controller)
    runtime.owner = "tracker:target-1:incarnation"
    runtime.data.update(connected=True, tracking=True)
    late_request = request(runtime, "position")
    with pytest.raises(ConnectionError, match="connection failed"):
        await runtime.execute(request(runtime, "release"))
    with pytest.raises(RuntimeError, match="control changed") as caught:
        await runtime.execute(late_request)
    assert not isinstance(caught.value, ControlReleased)
    assert runtime.data["error"] is True


@pytest.mark.asyncio
async def test_expired_motion_is_rejected_before_hardware_io():
    controller = FakeController()
    runtime = DeviceRuntime("rotator", "mount", {}, "epoch", controller)
    runtime.owner = "tracker:one:incarnation"
    runtime.data["connected"] = True
    expired = {**request(runtime, "position", az=100, el=20), "deadline": time.time() - 1}
    with pytest.raises(RuntimeError, match="expired"):
        await runtime.execute(expired)
    assert controller.commands == []


@pytest.mark.asyncio
async def test_lost_target_stops_motion_without_closing_connection():
    controller = FakeController()
    runtime = DeviceRuntime("rotator", "mount", {}, "epoch", controller)
    runtime.owner = "tracker:one:incarnation"
    runtime.data.update(connected=True, tracking=True)
    previous_generation = runtime.generation
    runtime.last_update -= 30
    await runtime.tick()
    assert controller.commands == ["S"]
    assert runtime.owner is None
    assert runtime.data["connected"]
    assert runtime.generation != previous_generation


@pytest.mark.asyncio
async def test_unanswered_stop_preserves_motion_guard_across_owner_loss():
    class Unanswered(FakeController):
        async def stop(self):
            self.commands.append("S")
            raise TimeoutError("No reply")

    controller = Unanswered()
    runtime = DeviceRuntime("rotator", "mount", {}, "epoch", controller)
    runtime.owner = "tracker:one:incarnation"
    runtime.data.update(connected=True, tracking=True)
    with pytest.raises(StopUnconfirmed):
        await runtime.execute(request(runtime, "emergency_stop"))
    assert runtime.owner is None
    assert runtime.data["motion_unconfirmed"]
    lease = await runtime.execute({**request(runtime, "acquire"), "owner": "manual:new"})
    assert lease["data"]["motion_unconfirmed"] is True
    assert runtime.owner == "manual:new"
    with pytest.raises(StopUnconfirmed):
        await runtime.execute(request(runtime, "position", az=90, el=25))
    assert controller.commands == ["S"]


@pytest.mark.asyncio
async def test_tracker_reconnect_succeeds_while_motion_is_unconfirmed(station):
    service, details, commands, connections = station
    tracker = SatelliteTracker(
        queue.Queue(),
        queue.Queue(),
        tracker_id="target-1",
        hardware_client=HardwareClient(service.register_tracker("target-1")),
    )
    tracker.current_rotator_id = "mount"
    tracker.rotator_details = details
    tracker.input_tracking_state = {"rotator_id": "mount", "rotator_state": "connected"}
    tracker.current_rotator_state = "connected"
    handler = tracker.rotator_handler
    await handler.handle_rotator_state_change(None, "connected")
    await tracker.rotator_controller.call("mode", mode="tracking")
    tracker.input_tracking_state["rotator_state"] = "disconnected"
    tracker.current_rotator_state = "disconnected"
    await handler.handle_rotator_state_change("connected", "disconnected")
    assert tracker.rotator_data["motion_unconfirmed"] is True
    opened = len(connections)

    # Reconnect immediately, before any stationary samples can arrive.
    tracker.input_tracking_state["rotator_state"] = "connected"
    tracker.current_rotator_state = "connected"
    await handler.handle_rotator_state_change("disconnected", "connected")
    assert tracker.input_tracking_state["rotator_state"] == "connected"
    assert tracker.rotator_data["connected"] is True
    assert tracker.rotator_data["error"] is False
    assert tracker.rotator_data["motion_unconfirmed"] is True
    assert tracker.rotator_data["stopped"] is False
    assert len(connections) == opened + 2  # Ping and persistent connection.
    with pytest.raises(StopUnconfirmed, match="stationary"):
        await anext(tracker.rotator_controller.set_position(90, 25))
    with pytest.raises(StopUnconfirmed, match="stationary"):
        await tracker.rotator_controller.park()
    assert not any(command.startswith("P ") or command == "K" for command in commands)

    # Fresh samples clear the guard without another Connect request.
    for _ in range(3):
        await handler.update_hardware_position()
        await asyncio.sleep(1.05)
    assert tracker.rotator_data["motion_unconfirmed"] is False
    assert tracker.rotator_data["connected"] is True
    assert tracker.rotator_data["stopped"] is True
    await anext(tracker.rotator_controller.set_position(90, 25))
    assert "P 90 25" in commands
    assert "S" not in commands


@pytest.mark.asyncio
async def test_disconnect_closes_tcp_without_sending_stop_or_reopening(station):
    _, details, commands, connections = station
    details["_ignore_stop"] = True
    controller = RotatorController(host=details["host"], port=details["port"], timeout=5)
    runtime = DeviceRuntime("rotator", "mount", details, "epoch", controller)
    await runtime.execute({**request(runtime, "acquire"), "owner": "tracker:one:incarnation"})
    runtime.data["tracking"] = True
    opened = len(connections)
    old_generation = runtime.generation
    # A controller that ignores S must not delay an explicit disconnect.
    result = await asyncio.wait_for(runtime.execute(request(runtime, "disconnect")), timeout=0.5)
    assert result["connected"] is False
    assert result["motion_unconfirmed"] is True
    assert result["stopped"] is False
    assert "unconfirmed" in result["stop_warning"]
    assert runtime.owner is None
    assert runtime.generation != old_generation
    assert controller.writer is None
    assert "S" not in commands
    assert len(connections) == opened
    reads = commands.count("p")
    await runtime.tick()
    assert commands.count("p") == reads


@pytest.mark.asyncio
@pytest.mark.parametrize("stop_supported", [True, False])
@pytest.mark.parametrize(
    "activity", [None, "tracking", "slewing", "park_requested", "motion_unconfirmed"]
)
async def test_pause_fences_updates_without_stopping_or_closing(stop_supported, activity):
    controller = FakeController()
    runtime = DeviceRuntime(
        "rotator", "mount", {"stop_supported": stop_supported}, "epoch", controller
    )
    runtime.owner = "tracker:one:incarnation"
    runtime.data.update(connected=True, stopped=activity is None)
    if activity:
        runtime.data[activity] = True
    queued = request(runtime, "position", az=100, el=20)
    generation = runtime.generation

    await runtime.execute(request(runtime, "pause"))

    assert runtime.owner is None
    assert runtime.generation != generation
    assert runtime.data["connected"] is True
    assert runtime.data["tracking"] is False
    assert runtime.data["park_requested"] is False
    assert runtime.data["motion_unconfirmed"] is (activity is not None)
    assert runtime.data["stopped"] is (activity is None)
    assert controller.commands == []
    with pytest.raises(ControlReleased):
        await runtime.execute(queued)
    if activity:
        await runtime.execute({**request(runtime, "acquire"), "owner": "manual:rotator:mount"})
        with pytest.raises(StopUnconfirmed, match="stationary"):
            await runtime.execute(request(runtime, "position", az=100, el=20))
        await runtime.poll()
        runtime._stationary_since -= 2
        await runtime.poll()
        await runtime.poll()
        assert runtime.data["motion_unconfirmed"] is False
        assert runtime.data["stopped"] is True
        assert controller.commands == []


@pytest.mark.asyncio
@pytest.mark.parametrize("method,payload", [("mode", {"mode": "tracking"}), ("heartbeat", {})])
async def test_resuming_tracking_clears_stop_warning_without_clearing_motion_guard(method, payload):
    controller = FakeController()
    runtime = DeviceRuntime("rotator", "mount", {"stop_supported": False}, "epoch", controller)
    runtime.owner = "tracker:one:incarnation"
    runtime.data.update(connected=True, tracking=True)
    with pytest.raises(StopUnconfirmed, match="tracking updates paused"):
        await runtime.execute(request(runtime, "stop"))
    warning = runtime.data["stop_warning"]

    # A non-tracking mode must retain the warning about paused updates.
    await runtime.execute(request(runtime, "mode", mode="stopped"))
    assert runtime.data["tracking"] is False
    assert runtime.data["stop_warning"] == warning

    await runtime.execute(request(runtime, method, **payload))

    assert runtime.data["tracking"] is True
    assert runtime.snapshot()["data"]["stop_warning"] is None
    assert runtime.data["stop_supported"] is False
    assert runtime.data["motion_unconfirmed"] is True
    with pytest.raises(StopUnconfirmed, match="stationary"):
        await runtime.execute(request(runtime, "position", az=100, el=20))
    assert controller.commands == []


@pytest.mark.asyncio
async def test_delayed_pause_cannot_revoke_a_new_owner():
    controller = FakeController()
    runtime = DeviceRuntime("rotator", "mount", {}, "epoch", controller)
    runtime.owner = "tracker:old:incarnation"
    runtime.data.update(connected=True, tracking=True)
    stale = request(runtime, "pause")
    runtime._fence()
    runtime.owner = "tracker:new:incarnation"
    runtime.data["tracking"] = True
    with pytest.raises(RuntimeError, match="control changed"):
        await runtime.execute(stale)
    assert runtime.owner == "tracker:new:incarnation"
    assert runtime.data["tracking"] is True
    assert runtime.data["connected"] is True
    assert controller.commands == []


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "activity", ["tracking", "slewing", "park_requested", "motion_unconfirmed"]
)
async def test_disconnect_never_calls_controller_stop(activity):
    class NoStop(FakeController):
        async def stop(self):
            raise AssertionError("Disconnect must not issue Stop")

    controller = NoStop()
    runtime = DeviceRuntime("rotator", "mount", {}, "epoch", controller)
    runtime.owner = "tracker:one:incarnation"
    runtime.data.update(connected=True, **{activity: True})
    result = await runtime.execute(request(runtime, "disconnect"))
    assert result["connected"] is False
    assert result["motion_unconfirmed"] is True
    assert controller.commands == ["close"]


@pytest.mark.asyncio
async def test_idle_disconnect_preserves_confirmed_stationary_state():
    controller = FakeController()
    runtime = DeviceRuntime("rotator", "mount", {}, "epoch", controller)
    runtime.owner = "manual:rotator:mount"
    runtime.data.update(connected=True, stopped=True)
    result = await runtime.execute(request(runtime, "disconnect"))
    assert result == {
        "connected": False,
        "motion_unconfirmed": False,
        "stopped": True,
        "stop_warning": None,
    }
    assert runtime.owner is None
    assert controller.commands == ["close"]


@pytest.mark.asyncio
async def test_delayed_operator_disconnect_reports_changed_control_without_closing():
    controller = FakeController()
    runtime = DeviceRuntime("rotator", "mount", {}, "epoch", controller)
    runtime.owner = "tracker:old:incarnation"
    runtime.data["connected"] = True
    stale = request(runtime, "disconnect", operator=True)
    runtime._fence()
    runtime.owner = "tracker:new:incarnation"
    with pytest.raises(RuntimeError, match="control changed before disconnect"):
        await runtime.execute(stale)
    assert runtime.data["connected"] is True
    assert runtime.owner == "tracker:new:incarnation"
    assert controller.commands == []


@pytest.mark.asyncio
async def test_failed_position_read_closes_socket_and_stops_repeated_polling(station):
    _, details, commands, _ = station
    controller = RotatorController(host=details["host"], port=details["port"], timeout=0.05)
    runtime = DeviceRuntime("rotator", "mount", details, "epoch", controller)
    await runtime.execute({**request(runtime, "acquire"), "owner": "tracker:one:incarnation"})
    runtime.data["tracking"] = True
    previous_generation = runtime.generation
    details["_drop_reads"] = True
    with pytest.raises(RuntimeError):
        await runtime.tick()
    assert runtime.data["connected"] is False
    assert runtime.data["error"] is True
    assert runtime.data["motion_unconfirmed"] is True
    assert runtime.owner is None
    assert runtime.generation != previous_generation
    assert controller.writer is None
    reads = len(commands)
    await runtime.tick()
    await runtime.tick()
    assert len(commands) == reads


@pytest.mark.asyncio
async def test_handoff_with_unsupported_stop_waits_for_stationarity_and_keeps_tcp(station):
    service, details, commands, connections = station
    details["stop_supported"] = False
    first = RotatorProxy(HardwareClient(service.register_tracker("target-1")), "mount", details)
    second = RotatorProxy(HardwareClient(service.register_tracker("target-2")), "mount", details)
    await first.connect()
    await first.call("mode", mode="tracking")
    opened = len(connections)
    await service.release_tracker("target-1")
    await second.connect()
    assert "S" not in commands
    assert len(connections) == opened
    assert service.snapshots()[0]["data"]["motion_unconfirmed"] is False


@pytest.mark.asyncio
async def test_observation_waits_for_slew_longer_than_ten_seconds(station, monkeypatch):
    service, details, commands, connections = station
    details["stop_supported"] = False
    first = RotatorProxy(HardwareClient(service.register_tracker("target-1")), "mount", details)
    observer = RotatorProxy(HardwareClient(service.register_tracker("obs-one")), "mount", details)
    await first.connect()
    await first.call("mode", mode="tracking")
    opened = len(connections)
    details["_moving_until"] = time.monotonic() + 11
    monkeypatch.setattr(observationmodule, "hardware", service)
    monkeypatch.setattr(observationmodule, "get_assigned_tracker_for_rotator", lambda _id: None)
    monkeypatch.setattr(observationmodule, "get_all_tracker_managers", lambda: {})

    async with service.reserve([("rotator", "mount")], "one") as reservation:
        handoff = asyncio.create_task(
            TrackerHandler()._release_existing_hardware("one", "mount", None)
        )
        async with asyncio.timeout(3):
            while not service.snapshots()[0]["data"]["motion_unconfirmed"]:
                await asyncio.sleep(0.01)
        # Old requests detach promptly while the mount keeps moving; the device
        # worker must not spend the entire slew holding its IPC execution lock.
        with pytest.raises(ControlReleased):
            await asyncio.wait_for(anext(first.set_position(200, 40)), timeout=1)
        assert not handoff.done()
        assert service.snapshots()[0]["owner"] is None
        assert ("rotator", "mount") in service.reservations
        await asyncio.wait_for(handoff, timeout=18)
        assert service.snapshots()[0]["data"]["motion_unconfirmed"] is False
        reservation["tracker_id"] = "obs-one"
        await observer.connect()
        await anext(observer.set_position(100, 30))

    assert "S" not in commands
    assert "P 200 40" not in commands
    assert "P 100 30" in commands
    assert len(connections) == opened
    assert service.snapshots()[0]["owner"]["id"] == "obs-one"


@pytest.mark.asyncio
@pytest.mark.parametrize("stop_supported", [True, False])
async def test_consecutive_observations_reconnect_and_confirm_stationarity(
    station, monkeypatch, stop_supported
):
    service, details, commands, connections = station
    details["stop_supported"] = stop_supported
    first = RotatorProxy(HardwareClient(service.register_tracker("obs-one")), "mount", details)
    second = RotatorProxy(HardwareClient(service.register_tracker("obs-two")), "mount", details)
    await first.connect()
    await first.call("mode", mode="tracking")
    # Normal observation cleanup closes the transport without sending Stop.
    await first.disconnect()
    opened = len(connections)
    assert service.snapshots()[0]["data"]["connected"] is False
    assert service.snapshots()[0]["data"]["motion_unconfirmed"] is True
    monkeypatch.setattr(observationmodule, "hardware", service)
    monkeypatch.setattr(observationmodule, "get_assigned_tracker_for_rotator", lambda _id: None)
    monkeypatch.setattr(observationmodule, "get_all_tracker_managers", lambda: {})

    async with service.reserve([("rotator", "mount")], "two") as reservation:
        handoff = asyncio.create_task(
            TrackerHandler()._release_existing_hardware("two", "mount", None)
        )
        try:
            async with asyncio.timeout(3):
                while not service.snapshots()[0]["data"]["connected"]:
                    # Propagate startup errors instead of hiding them in a timeout.
                    if handoff.done():
                        await handoff
                    await asyncio.sleep(0.01)
            snapshot = service.snapshots()[0]
            assert snapshot["owner"] is None
            assert snapshot["data"]["motion_unconfirmed"] is True
            assert not handoff.done()
            with pytest.raises(StopUnconfirmed, match="stationary"):
                await service.call(
                    "rotator",
                    "mount",
                    "position",
                    generation=snapshot["generation"],
                    az=100,
                    el=30,
                )
            assert "P 100 30" not in commands
            await asyncio.wait_for(handoff, timeout=6)
            assert service.snapshots()[0]["data"]["motion_unconfirmed"] is False
            reservation["tracker_id"] = "obs-two"
            await second.connect()
            await anext(second.set_position(100, 30))
        finally:
            handoff.cancel()
            await asyncio.gather(handoff, return_exceptions=True)

    assert len(connections) == opened + 2  # Ping and persistent connection.
    assert "S" not in commands
    assert "P 100 30" in commands
    assert service.snapshots()[0]["owner"]["id"] == "obs-two"
    # Late cleanup from the first observation cannot close the second's socket.
    await first.disconnect()
    assert await second.get_position() == (100, 30)


@pytest.mark.asyncio
async def test_observation_reconnect_failure_preserves_motion_guard_and_allows_retry(
    station, monkeypatch
):
    service, details, commands, _ = station
    details["stop_supported"] = False
    first = RotatorProxy(HardwareClient(service.register_tracker("obs-one")), "mount", details)
    await first.connect()
    await first.call("mode", mode="tracking")
    await first.disconnect()
    monkeypatch.setattr(observationmodule, "hardware", service)
    monkeypatch.setattr(observationmodule, "get_assigned_tracker_for_rotator", lambda _id: None)
    monkeypatch.setattr(observationmodule, "get_all_tracker_managers", lambda: {})
    details["_drop_reads"] = True

    with pytest.raises(RuntimeError):
        await TrackerHandler()._release_existing_hardware("two", "mount", None)
    snapshot = service.snapshots()[0]
    assert snapshot["owner"] is None
    assert snapshot["data"]["connected"] is False
    assert snapshot["data"]["motion_unconfirmed"] is True
    assert not any(command.startswith("P ") or command == "S" for command in commands)

    details["_drop_reads"] = False
    await asyncio.wait_for(
        TrackerHandler()._release_existing_hardware("three", "mount", None), timeout=6
    )
    assert service.snapshots()[0]["data"]["connected"] is True
    assert service.snapshots()[0]["data"]["motion_unconfirmed"] is False


@pytest.mark.asyncio
@pytest.mark.parametrize("disconnected", [False, True])
@pytest.mark.parametrize("operator_action", ["pause", "disconnect"])
async def test_waiting_handoff_remains_interruptible(station, operator_action, disconnected):
    service, details, commands, _ = station
    details["stop_supported"] = False
    first = RotatorProxy(HardwareClient(service.register_tracker("target-1")), "mount", details)
    await first.connect()
    await first.call("mode", mode="tracking")
    if disconnected:
        await first.disconnect()
    details["_moving_until"] = time.monotonic() + 30
    handoff = asyncio.create_task(service.release("rotator", "mount", stationary_timeout=30))
    try:
        async with asyncio.timeout(3):
            while not (
                service.snapshots()[0]["data"]["connected"]
                and service.snapshots()[0]["data"]["motion_unconfirmed"]
            ):
                if handoff.done():
                    await handoff
                await asyncio.sleep(0.01)
        worker = service.devices[("rotator", "mount")]
        await asyncio.wait_for(
            service.call(
                "rotator",
                "mount",
                operator_action,
                owner=None,
                generation=worker.snapshot["generation"],
                operator=True,
            ),
            timeout=1,
        )
        with pytest.raises(RuntimeError, match="control changed"):
            await asyncio.wait_for(handoff, timeout=1)
        assert service.snapshots()[0]["owner"] is None
        assert "S" not in commands
    finally:
        handoff.cancel()
        await asyncio.gather(handoff, return_exceptions=True)
        details["_moving_until"] = 0


@pytest.mark.asyncio
@pytest.mark.parametrize("request_deadline", [False, True])
async def test_slew_handoff_timeout_preserves_motion_guard(station, request_deadline):
    service, details, commands, _ = station
    details["stop_supported"] = False
    first = RotatorProxy(HardwareClient(service.register_tracker("target-1")), "mount", details)
    await first.connect()
    await first.call("mode", mode="tracking")
    details["_moving_until"] = time.monotonic() + 30
    with pytest.raises(StopUnconfirmed, match="still moving or unsettled"):
        await asyncio.wait_for(
            service.release(
                "rotator",
                "mount",
                stationary_timeout=30 if request_deadline else 0.2,
                deadline=time.time() + 0.5 if request_deadline else None,
            ),
            timeout=2,
        )
    worker = service.devices[("rotator", "mount")]
    assert worker.snapshot["owner"] is None
    assert worker.snapshot["data"]["motion_unconfirmed"] is True
    lease = await service.call("rotator", "mount", "acquire", owner="observer", details=details)
    with pytest.raises(StopUnconfirmed, match="stationary"):
        await service.call(
            "rotator",
            "mount",
            "position",
            owner="observer",
            generation=lease["generation"],
            az=100,
            el=30,
        )
    assert "S" not in commands
    assert "P 100 30" not in commands
    details["_moving_until"] = 0


@pytest.mark.asyncio
@pytest.mark.parametrize("disconnected", [False, True])
async def test_observation_waits_for_unowned_rotator(station, monkeypatch, disconnected):
    service, details, _, _ = station
    details["stop_supported"] = False
    first = RotatorProxy(HardwareClient(service.register_tracker("target-1")), "mount", details)
    await first.connect()
    await first.call("mode", mode="tracking")
    if disconnected:
        await first.disconnect()
    else:
        await first.call("pause")
    assert service.snapshots()[0]["owner"] is None
    details["_moving_until"] = time.monotonic() + 30
    monkeypatch.setattr(observationmodule, "hardware", service)
    monkeypatch.setattr(observationmodule, "get_assigned_tracker_for_rotator", lambda _id: None)
    monkeypatch.setattr(observationmodule, "get_all_tracker_managers", lambda: {})
    monkeypatch.setattr(observationmodule, "ROTATOR_SETTLE_TIMEOUT_SECONDS", 0.2)

    with pytest.raises(StopUnconfirmed, match="still moving or unsettled"):
        await TrackerHandler()._release_existing_hardware("one", "mount", None)
    assert service.snapshots()[0]["data"]["motion_unconfirmed"] is True
    details["_moving_until"] = 0


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", ["worker-exit", "position-read"])
async def test_waiting_handoff_fails_when_hardware_is_lost(station, failure):
    service, details, _, _ = station
    details["stop_supported"] = False
    first = RotatorProxy(HardwareClient(service.register_tracker("target-1")), "mount", details)
    await first.connect()
    await first.call("mode", mode="tracking")
    details["_moving_until"] = time.monotonic() + 30
    handoff = asyncio.create_task(service.release("rotator", "mount", stationary_timeout=30))
    try:
        async with asyncio.timeout(3):
            while not service.snapshots()[0]["data"]["motion_unconfirmed"]:
                await asyncio.sleep(0.01)
        if failure == "worker-exit":
            worker = service.devices[("rotator", "mount")]
            worker.process.kill()
            await asyncio.to_thread(worker.process.join, 1)
        else:
            details["_drop_reads"] = True
        with pytest.raises(RuntimeError):
            await asyncio.wait_for(handoff, timeout=3)
    finally:
        handoff.cancel()
        await asyncio.gather(handoff, return_exceptions=True)
        details["_moving_until"] = 0


@pytest.mark.asyncio
@pytest.mark.parametrize("stop_supported", [True, False])
async def test_tracker_disconnect_reports_uncertainty_and_clears_connection_intent(
    station, stop_supported
):
    service, details, commands, connections = station
    details["stop_supported"] = stop_supported
    service.on_intent = AsyncMock()
    client = RotatorProxy(HardwareClient(service.register_tracker("target-1")), "mount", details)
    await client.connect()
    await client.call("mode", mode="tracking")
    opened = len(connections)
    assert await client.disconnect()
    assert client.disconnect_state["motion_unconfirmed"] is True
    assert client.disconnect_state["stopped"] is False
    assert "without issuing Stop" in client.disconnect_state["stop_warning"]
    assert service.snapshots()[0]["owner"] is None
    assert service.snapshots()[0]["data"]["connected"] is False
    service.on_intent.assert_awaited_with("rotator", "mount", False)
    assert "S" not in commands
    assert len(connections) == opened


@pytest.mark.asyncio
async def test_manual_disconnect_and_config_edit_preserve_motion_guard(station, monkeypatch):
    service, details, commands, connections = station
    details["stop_supported"] = False
    service.on_intent = AsyncMock()
    registry = OperationRegistry()
    monkeypatch.setattr(control, "hardware", service)
    monkeypatch.setattr(control, "operations", registry)
    await service.call("rotator", "mount", "acquire", owner="manual:rotator:mount", details=details)
    with pytest.raises(StopUnconfirmed):
        await service.call("rotator", "mount", "emergency_stop")
    worker = service.devices[("rotator", "mount")]
    opened = len(connections)
    accepted = await control.submit_device_command(
        "rotator",
        "mount",
        "disconnect",
        details,
        {
            "command_id": "disconnect-uncertain",
            "epoch": registry.epoch,
            "accept_before": time.time() + 10,
            "generation": worker.snapshot["generation"],
        },
    )
    async with asyncio.timeout(3):
        while registry.records[accepted["command_id"]]["status"] in {"submitted", "started"}:
            await asyncio.sleep(0.01)
    assert registry.records[accepted["command_id"]]["status"] == "succeeded"
    assert worker.snapshot["data"]["connected"] is False
    assert worker.snapshot["data"]["motion_unconfirmed"] is True
    service.on_intent.assert_awaited_with("rotator", "mount", False)
    await service.configure("rotator", "mount", {**details, "name": "Edited while disconnected"})
    assert service.devices[("rotator", "mount")] is worker
    assert worker.snapshot["data"]["motion_unconfirmed"] is True
    assert "S" not in commands
    assert len(connections) == opened


@pytest.mark.asyncio
async def test_stop_capability_is_persisted_and_validated(db_session):
    details = dict(
        name="S.A.T.", host="localhost", port=4533, minaz=0, maxaz=360, minel=0, maxel=90
    )
    created = await hardware_crud.add_rotator(db_session, details)
    assert created["success"]
    assert created["data"]["stop_supported"] is True
    device_id = created["data"]["id"]
    changed = await hardware_crud.edit_rotator(
        db_session, {"id": device_id, "stop_supported": False}
    )
    assert changed["success"]
    fetched = await hardware_crud.fetch_rotators(db_session, rotator_id=device_id)
    assert fetched["data"]["stop_supported"] is False
    invalid = await hardware_crud.edit_rotator(
        db_session, {"id": device_id, "stop_supported": "false"}
    )
    assert invalid["success"] is False


@pytest.mark.asyncio
async def test_manual_control_needs_no_tracker_and_keeps_connection_on_release(
    station, monkeypatch
):
    service, details, _, connections = station
    registry = OperationRegistry()
    monkeypatch.setattr(control, "hardware", service)
    monkeypatch.setattr(control, "operations", registry)
    service.on_intent = AsyncMock()

    async def command(action, **extra):
        snapshot = service.devices.get(("rotator", "mount"))
        request = dict(
            command_id=f"manual-{action}",
            epoch=registry.epoch,
            accept_before=time.time() + 10,
            generation=snapshot.snapshot.get("generation") if snapshot else None,
            **extra,
        )
        accepted = await control.submit_device_command("rotator", "mount", action, details, request)
        async with asyncio.timeout(10):
            while registry.records[accepted["command_id"]]["status"] in {"submitted", "started"}:
                await asyncio.sleep(0.05)
        result = registry.records[accepted["command_id"]]
        assert result["status"] == "succeeded", result
        return request

    connect_request = await command("connect")
    opened = len(connections)
    retried = await control.submit_device_command(
        "rotator", "mount", "connect", details, connect_request
    )
    assert retried["status"] == "succeeded"
    await command("move", position={"az": 90, "el": 25})
    await command("release")
    snapshot = service.snapshots()[0]
    assert snapshot["owner"] is None
    assert snapshot["data"]["connected"]
    assert len(connections) == opened
    assert service.clients == {}
    await command("disconnect")
    assert len(connections) == opened
    assert service.snapshots()[0]["data"]["connected"] is False
    service.on_intent.assert_awaited_with("rotator", "mount", False)


@pytest.mark.asyncio
async def test_device_connection_intent_is_persisted_without_a_target(monkeypatch, db_session):
    from contextlib import asynccontextmanager

    from sqlalchemy import select

    from db.models import TrackingState
    from hardware import lifecycle

    @asynccontextmanager
    async def session():
        yield db_session

    monkeypatch.setattr(lifecycle, "AsyncSessionLocal", session)
    await lifecycle.persist_connection("rotator", "mount", True)
    row = await db_session.scalar(
        select(TrackingState).where(TrackingState.name == "hardware:rotator:mount")
    )
    assert row.value == {"connected": True}
    await lifecycle.persist_connection("rotator", "mount", False)
    assert row.value == {"connected": False}


@pytest.mark.asyncio
async def test_conflicting_saved_devices_are_cleared_before_any_tracker_starts(
    db_engine, monkeypatch
):
    sessions = async_sessionmaker(db_engine, class_=AsyncSession, expire_on_commit=False)
    async with sessions() as session:
        session.add_all(
            TrackingState(
                name=get_tracking_state_name(tracker_id),
                value={
                    "norad_id": 25544,
                    "rotator_id": "shared-mount",
                    "rotator_state": "tracking",
                    "rig_id": "shared-radio",
                    "rig_state": "tracking",
                },
            )
            for tracker_id in ("target-1", "target-2")
        )
        await session.commit()

    class Manager:
        async def sync_tracking_state_from_db(self):
            async with sessions() as session:
                rows = (await session.scalars(select(TrackingState))).all()
                assert len(rows) == 2
                for row in rows:
                    for kind in ("rotator", "rig"):
                        assert row.value[f"{kind}_id"] == "none"
                        assert row.value[f"{kind}_state"] == "disconnected"

    assignments = []
    monkeypatch.setattr(instances, "AsyncSessionLocal", sessions)
    monkeypatch.setattr(instances, "get_tracker_manager", lambda _: Manager())
    monkeypatch.setattr(
        instances, "assign_rotator_to_tracker", lambda *args: assignments.append(args)
    )
    restored = await instances.restore_tracker_instances_from_db()
    assert set(restored) == {"target-1", "target-2"}
    assert set(assignments) == {("target-1", "none"), ("target-2", "none")}


def test_tracker_pipe_registration_is_removed_when_a_producer_stops():
    service = HardwareSupervisor()
    endpoint = service.register_tracker("target-1")
    owner = next(iter(service.clients))
    parent = service.clients[owner]
    service.unregister_tracker("target-1")
    assert endpoint.closed
    assert parent.closed
    assert not service.clients
    assert not service.client_ends


@pytest.mark.asyncio
async def test_threaded_obs_removal_and_eof_monitor_close_tracker_pipe_once(monkeypatch):
    service = HardwareSupervisor()
    service.register_tracker("obs-one")
    parent = next(iter(service.clients.values()))
    close_started = threading.Event()
    finish_close = threading.Event()
    original_close = parent.close
    close_calls = []

    def delayed_close():
        close_calls.append(True)
        if len(close_calls) > 1:
            raise OSError(9, "Bad file descriptor")
        close_started.set()
        # Model Connection.close releasing the GIL before clearing its handle.
        if not finish_close.wait(3):
            raise TimeoutError("Threaded close was not released")
        original_close()

    monkeypatch.setattr(parent, "close", delayed_close)
    removal = asyncio.create_task(asyncio.to_thread(service.unregister_tracker, "obs-one"))
    try:
        assert await asyncio.to_thread(close_started.wait, 2)
        # Closing the child above made EOF readable. Let supervision encounter it
        # while tracker removal is still closing the same parent endpoint.
        service.start()
        await asyncio.sleep(0.05)
        finish_close.set()
        await removal
        assert close_calls == [True]
        assert not service.task.done()
        assert not service.clients
        assert not service.client_ends
    finally:
        finish_close.set()
        await asyncio.gather(removal, return_exceptions=True)
        await service.shutdown()


@pytest.mark.asyncio
@pytest.mark.parametrize("stop_supported", [True, False])
@pytest.mark.parametrize("park_after", [True, False])
async def test_observation_cleanup_disconnects_without_stop(
    station, monkeypatch, stop_supported, park_after
):
    service, details, commands, connections = station
    details.update(stop_supported=stop_supported, _ignore_stop=True)
    registry = OperationRegistry()
    tracker = SatelliteTracker(
        queue.Queue(),
        queue.Queue(),
        tracker_id="obs-one",
        hardware_client=HardwareClient(service.register_tracker("obs-one")),
    )
    tracker.rotator_details = details
    tracker.current_rotator_id = "mount"
    tracker.input_tracking_state = {"rotator_id": "mount", "rotator_state": "tracking"}
    await tracker.rotator_handler.handle_rotator_state_change("disconnected", "tracking")
    opened = len(connections)

    async def state():
        return dict(tracker.input_tracking_state)

    async def update(tracker_id, value, requester_sid=None, operation=None):
        # Exercise the normal command confirmation with an in-process tracker;
        # its proxy still uses the real station IPC worker and TCP controller.
        command = registry.accept(
            tracker_id, value, {**tracker.input_tracking_state, **value}, operation
        )
        previous = tracker.input_tracking_state["rotator_state"]
        tracker.operations.accept(
            {
                "operation": command,
                "messages": [{"type": "set_tracking_state", "payload": {**await state(), **value}}],
            }
        )
        tracker.operations.begin_cycle()
        if "rotator_state" in value:
            tracker.current_rotator_state = value["rotator_state"]
            await tracker.rotator_handler.handle_rotator_state_change(
                previous, value["rotator_state"]
            )
        tracker.operations.finish_cycle()
        while not tracker.queue_out._queue_out.empty():
            message = tracker.queue_out._queue_out.get_nowait()
            if message.get("event") == "tracker-command-status":
                data = message["data"]
                registry.update(data["command_id"], data["status"], data.get("reason"))
        return {"success": True, "result": {"command_id": command["command_id"]}}

    handler = TrackerHandler()
    remove = AsyncMock(return_value=True)
    monkeypatch.setattr(observationmodule, "hardware", service)
    monkeypatch.setattr(observationmodule, "operations", registry)
    monkeypatch.setattr(
        observationmodule,
        "get_tracker_manager",
        lambda _: SimpleNamespace(get_tracking_state=state),
    )
    monkeypatch.setattr(observationmodule, "update_tracking_state_with_ownership", update)
    monkeypatch.setattr(handler, "_remove_observation_tracker_instance", remove)

    assert await asyncio.wait_for(
        handler.stop_tracker_task(
            "one", {"park_after_observation": park_after}, {"tracker_id": "obs-one"}
        ),
        timeout=2,
    )
    remove.assert_awaited_once_with("obs-one")
    assert tracker.input_tracking_state["rotator_id"] == "none"
    assert service.snapshots()[0]["data"]["connected"] is False
    assert ("K" in commands) is park_after
    assert "S" not in commands
    assert len(connections) == opened


@pytest.mark.asyncio
async def test_observation_reserves_entire_bundle_and_rejects_other_producers(station):
    service, details, _, _ = station
    client = RotatorProxy(HardwareClient(service.register_tracker("target-1")), "mount", details)
    async with service.reserve([("rotator", "mount"), ("rig", "radio")], "one"):
        assert set(service.reservations) == {("rotator", "mount"), ("rig", "radio")}
        with pytest.raises(RuntimeError, match="reserved"):
            await client.connect()
        with pytest.raises(RuntimeError, match="already reserved"):
            async with service.reserve([("rig", "radio")], "two"):
                pass
        assert service.devices == {}
    assert service.reservations == {}
    await client.connect()


@pytest.mark.asyncio
@pytest.mark.parametrize("action", ["pause", "stop", "disconnect"])
async def test_operator_interrupt_cancels_pending_move(station, monkeypatch, action):
    service, details, commands, connections = station
    registry = OperationRegistry()
    monkeypatch.setattr(control, "hardware", service)
    monkeypatch.setattr(control, "operations", registry)

    async def submit(action, **extra):
        worker = service.devices.get(("rotator", "mount"))
        return await control.submit_device_command(
            "rotator",
            "mount",
            action,
            details,
            {
                "command_id": action,
                "epoch": registry.epoch,
                "accept_before": time.time() + 10,
                "generation": worker.snapshot.get("generation") if worker else None,
                **extra,
            },
        )

    async def wait_status(command_id, terminal):
        async with asyncio.timeout(10):
            while registry.records[command_id]["status"] not in terminal:
                await asyncio.sleep(0.02)

    await submit("connect")
    await wait_status("connect", {"succeeded"})
    opened = len(connections)
    await submit("move", position={"az": 90, "el": 25})
    async with asyncio.timeout(5):
        while "P 90 25" not in commands:
            await asyncio.sleep(0.01)
    await submit(action)
    await wait_status(action, {"succeeded", "failed", "unknown"})
    assert registry.records[action]["status"] == "succeeded", registry.records[action]
    assert registry.records["move"]["status"] == "cancelled"
    assert commands.count("S") == (1 if action == "stop" else 0)
    assert service.snapshots()[0]["data"]["connected"] is (action != "disconnect")
    assert len(connections) == opened


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", ["rotator", "rig"])
@pytest.mark.parametrize("tracker_id", ["target-1", "obs-one"])
@pytest.mark.parametrize("action", ["pause", "disconnect"])
async def test_operator_interrupt_detaches_producer_during_reservation(
    station, monkeypatch, kind, tracker_id, action
):
    service, details, commands, connections = station
    registry = OperationRegistry()
    monkeypatch.setattr(control, "hardware", service)
    monkeypatch.setattr(control, "operations", registry)
    service.on_release = AsyncMock()
    service.on_intent = AsyncMock()
    factory = RotatorProxy if kind == "rotator" else RigProxy
    client = factory(HardwareClient(service.register_tracker(tracker_id)), "device", details)
    await client.connect()
    await client.call("heartbeat")
    service.on_intent.reset_mock()
    worker = service.devices[(kind, "device")]
    original_owner = worker.snapshot["owner"]
    opened = len(connections)
    async with service.reserve([(kind, "device")], "one"):
        request = {
            "command_id": f"operator-{action}",
            "epoch": registry.epoch,
            "accept_before": time.time() + 10,
            "generation": worker.snapshot["generation"],
        }
        # Manual takeover remains barred; Pause/Disconnect explicitly override it.
        with pytest.raises(ValueError, match="scheduled observation"):
            await control.submit_device_command(kind, "device", "take-control", details, request)
        command = await control.submit_device_command(kind, "device", action, details, request)
        async with asyncio.timeout(5):
            while registry.records[command["command_id"]]["status"] in {"submitted", "started"}:
                await asyncio.sleep(0.01)
        assert registry.records[command["command_id"]]["status"] == "succeeded"
        assert worker.snapshot["data"]["connected"] is (action == "pause")
        assert worker.snapshot["data"]["tracking"] is False
        assert worker.snapshot["owner"] is None
        service.on_release.assert_any_await(original_owner, kind, "device")
        if action == "disconnect":
            service.on_intent.assert_awaited_with(kind, "device", False)
        else:
            service.on_intent.assert_not_awaited()
        with pytest.raises(RuntimeError, match="control changed"):
            await client.call("heartbeat")
        assert "S" not in commands
        assert len(connections) == opened
