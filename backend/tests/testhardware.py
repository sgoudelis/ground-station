# Copyright (c) 2026 Efstratios Goudelis
"""Exercise real IPC and TCP against local Hamlib protocol doubles."""

import asyncio
import json
import queue
import time
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
from hardware.runtime import DeviceRuntime
from hardware.service import HardwareSupervisor
from observations.tasks import trackerhandler as observationmodule
from observations.tasks.trackerhandler import TrackerHandler
from tracker import instances
from tracker.contracts import get_tracking_state_name
from tracker.logic import SatelliteTracker
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
                    response = f"{position[0]}\n{position[1]}\n"
                elif command.startswith("P "):
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
    with pytest.raises(RuntimeError, match="control changed"):
        await runtime.execute(followup)
    controller.stop.assert_not_awaited()


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
@pytest.mark.parametrize("action", ["stop", "disconnect"])
async def test_operator_stop_or_disconnect_cancels_pending_move(station, monkeypatch, action):
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
    assert service.snapshots()[0]["data"]["connected"] is (action == "stop")
    assert len(connections) == opened


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", ["rotator", "rig"])
@pytest.mark.parametrize("tracker_id", ["target-1", "obs-one"])
async def test_operator_disconnect_closes_producer_connection_during_reservation(
    station, monkeypatch, kind, tracker_id
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
    worker = service.devices[(kind, "device")]
    original_owner = worker.snapshot["owner"]
    opened = len(connections)
    async with service.reserve([(kind, "device")], "one"):
        request = {
            "command_id": "operator-disconnect",
            "epoch": registry.epoch,
            "accept_before": time.time() + 10,
            "generation": worker.snapshot["generation"],
        }
        # Manual takeover remains barred; Disconnect is the explicit override.
        with pytest.raises(ValueError, match="scheduled observation"):
            await control.submit_device_command(kind, "device", "take-control", details, request)
        command = await control.submit_device_command(
            kind, "device", "disconnect", details, request
        )
        async with asyncio.timeout(5):
            while registry.records[command["command_id"]]["status"] in {"submitted", "started"}:
                await asyncio.sleep(0.01)
        assert registry.records[command["command_id"]]["status"] == "succeeded"
        assert worker.snapshot["data"]["connected"] is False
        assert worker.snapshot["owner"] is None
        service.on_release.assert_any_await(original_owner, kind, "device")
        service.on_intent.assert_awaited_with(kind, "device", False)
        with pytest.raises(RuntimeError, match="control changed"):
            await client.call("heartbeat")
        assert "S" not in commands
        assert len(connections) == opened
