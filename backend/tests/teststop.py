# Copyright (c) 2026 Efstratios Goudelis
"""Exercise standard Hamlib Stop against a local TCP controller, without hardware."""

import asyncio
import queue
import time
from contextlib import asynccontextmanager, suppress
from types import SimpleNamespace

import pytest

from controllers.rotator import RotatorController, StopRejected, StopUnconfirmed
from tracker import rotatorhandler as handlermodule
from tracker.logic import SatelliteTracker
from tracker.operations import OperationRegistry


@asynccontextmanager
async def controller_peer(
    stop_reply=None, position_reply=b"123.0\n45.0\n", late_reply=False, fragmented=False
):
    commands = []
    clients = set()
    tasks = set()
    connection_count = 0

    async def peer(reader, writer):
        nonlocal connection_count
        connection_count += 1
        connection = connection_count
        task = asyncio.current_task()
        tasks.add(task)
        clients.add(writer)
        try:
            while line := await reader.readline():
                commands.append((connection, line))
                if line == b"q\n":
                    break
                if line == b"p\n":
                    # The first connection is the normal connection's ping.
                    if fragmented and connection != 1:
                        writer.write(b"123.0\n")
                        await writer.drain()
                        await asyncio.sleep(0.001)
                        writer.write(b"45.0\n")
                    else:
                        writer.write(b"123.0\n45.0\n" if connection == 1 else position_reply)
                elif line == b"S\n":
                    if late_reply:
                        await asyncio.sleep(0.1)
                    if stop_reply == b"EOF":
                        break
                    if stop_reply is not None:
                        if fragmented:
                            writer.write(stop_reply[:3])
                            await writer.drain()
                            await asyncio.sleep(0.001)
                            writer.write(stop_reply[3:])
                        else:
                            writer.write(stop_reply)
                await writer.drain()
        except (ConnectionError, asyncio.CancelledError):
            pass
        finally:
            writer.close()
            with suppress(ConnectionError):
                await writer.wait_closed()
            clients.discard(writer)
            tasks.discard(task)

    server = await asyncio.start_server(peer, "127.0.0.1", 0)
    controller = RotatorController(
        host="127.0.0.1", port=server.sockets[0].getsockname()[1], timeout=0.05
    )
    try:
        await controller.connect()
        yield controller, commands
    finally:
        await controller.close()
        server.close()
        await server.wait_closed()
        for writer in list(clients):
            writer.close()
        remaining = list(tasks)
        for task in remaining:
            task.cancel()
        await asyncio.gather(*remaining, return_exceptions=True)


def worker(controller):
    tracker = SatelliteTracker(queue.Queue(), queue.Queue(), tracker_id="target-1")
    tracker.rotator_controller = controller
    tracker.input_tracking_state = {"rotator_id": "mount", "rotator_state": "tracking"}
    tracker.current_rotator_state = "tracking"
    tracker.rotator_data.update(connected=True, tracking=True, slewing=True)
    return tracker


async def stop(tracker):
    operation = OperationRegistry().accept(
        "target-1",
        {"rotator_state": "stopped"},
        tracker.input_tracking_state,
        {"command_id": "stop", "action": "stop"},
    )
    tracker.operations.accept(
        {
            "operation": operation,
            "messages": [
                {
                    "type": "set_tracking_state",
                    "payload": {**tracker.input_tracking_state, "rotator_state": "stopped"},
                }
            ],
        }
    )
    tracker.operations.begin_cycle()
    await tracker.rotator_handler.handle_rotator_state_change("tracking", "stopped")
    tracker.operations.finish_cycle()
    return operation


def result(tracker):
    return [
        message["data"]
        for message in tracker.queue_out._queue_out.queue
        if message.get("event") == "tracker-command-status"
    ][-1]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "reply,error",
    [
        (b"RPRT -4\n", StopRejected),
        (b"RPRT -11\n", StopRejected),
        (b"bad reply\n", StopUnconfirmed),
        (b"RPRT invalid\n", StopUnconfirmed),
        (b"EOF", StopUnconfirmed),
        (None, StopUnconfirmed),
    ],
)
async def test_stop_requires_a_valid_acknowledgement(reply, error):
    async with controller_peer(reply) as (controller, commands):
        with pytest.raises(error):
            await controller.stop()
        assert [line for _, line in commands if line == b"S\n"] == [b"S\n"]


@pytest.mark.asyncio
async def test_fragmented_replies_cannot_leak_into_the_next_command():
    async with controller_peer(b"RPRT 0\n", fragmented=True) as (controller, _commands):
        assert await controller.stop() is True
        assert await controller.get_position() == (123, 45)
        assert await controller.stop() is True


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "reply,late", [(None, False), (b"bad reply\n", False), (b"RPRT 0\n", True)]
)
async def test_unconfirmed_stop_recovers_on_a_new_stream_without_replaying_motion(reply, late):
    async with controller_peer(reply, late_reply=late) as (controller, commands):
        tracker = worker(controller)
        await stop(tracker)
        assert result(tracker)["status"] == "unknown"
        assert result(tracker)["reconciled"] is True
        assert tracker.rotator_controller is controller
        assert tracker.rotator_data["connected"] is True
        assert tracker.rotator_data["motion_unconfirmed"] is True
        assert tracker.rotator_data["stopped"] is False
        assert tracker.input_tracking_state["rotator_state"] == "stopped"
        assert not tracker.operations.pending
        assert await controller.get_position() == (123, 45)
        stop_connection = next(connection for connection, line in commands if line == b"S\n")
        assert commands[-1][0] != stop_connection
        assert sum(line == b"S\n" for _, line in commands) == 1
        assert all(not line.startswith(b"P ") for _, line in commands)


@pytest.mark.asyncio
async def test_unsupported_direct_stop_pauses_and_disconnects_without_s_or_recovery():
    async with controller_peer() as (controller, commands):
        tracker = worker(controller)
        tracker.rotator_details = {"stop_supported": False}
        tracker.manual_rotator_target = {"az": 200, "el": 50}
        tracker.nudge_offset = {"az": 2, "el": 0}
        await controller.get_position()
        connection_count = len({connection for connection, _line in commands})

        await stop(tracker)

        assert result(tracker)["status"] == "unknown"
        assert "unsupported" in result(tracker)["reason"]
        assert tracker.manual_rotator_target is None
        assert tracker.nudge_offset == {"az": 0, "el": 0}
        assert tracker.rotator_data["tracking"] is False
        assert tracker.rotator_data["motion_unconfirmed"] is True
        assert tracker.rotator_data["stopped"] is False
        assert tracker.rotator_data["error"] is False
        assert not tracker.operations.pending
        assert await controller.get_position() == (123, 45)
        assert len({connection for connection, _line in commands}) == connection_count

        await tracker.rotator_handler.handle_rotator_state_change("stopped", "disconnected")
        assert tracker.rotator_controller is None
        assert tracker.rotator_data["connected"] is False
        assert not any(line == b"S\n" for _connection, line in commands)


@pytest.mark.asyncio
async def test_rejected_stop_keeps_connection_and_can_be_retried():
    async with controller_peer(b"RPRT -4\n") as (controller, commands):
        tracker = worker(controller)
        await stop(tracker)
        assert result(tracker)["status"] == "failed"
        assert "RPRT -4" in result(tracker)["reason"]
        assert tracker.rotator_data["connected"] is True
        assert tracker.rotator_data["motion_unconfirmed"] is True
        assert await controller.get_position() == (123, 45)
        assert commands[-1][0] == next(
            connection for connection, line in commands if line == b"S\n"
        )
        await tracker.rotator_handler.handle_rotator_state_change("stopped", "connected")
        assert tracker.rotator_data["motion_unconfirmed"] is True
        assert tracker.rotator_data["stopped"] is False
        await stop(tracker)
        assert sum(line == b"S\n" for _, line in commands) == 2


@pytest.mark.asyncio
@pytest.mark.parametrize("position_reply", [b"RPRT 0\n", b"nan\n45\n", b"", b"nonsense\n"])
async def test_failed_recovery_disconnects_but_does_not_claim_stopped(position_reply):
    async with controller_peer(position_reply=position_reply) as (controller, _commands):
        tracker = worker(controller)
        await stop(tracker)
        assert result(tracker)["status"] == "unknown"
        assert result(tracker)["reconciled"] is True
        assert "recovery failed" in result(tracker)["reason"]
        assert tracker.rotator_controller is None
        assert controller.writer is None
        assert tracker.input_tracking_state["rotator_state"] == "disconnected"
        assert tracker.rotator_data["stopped"] is False
        assert tracker.rotator_data["motion_unconfirmed"] is True


@pytest.mark.asyncio
@pytest.mark.parametrize("reply", [b"RPRT 0\n", b"RPRT -4\n", None])
async def test_only_fresh_stationary_positions_release_the_motion_lock(monkeypatch, reply):
    clock = [0.0]
    monkeypatch.setattr(
        handlermodule, "time", SimpleNamespace(time=time.time, monotonic=lambda: clock[0])
    )
    async with controller_peer(reply) as (controller, _commands):
        tracker = worker(controller)
        await stop(tracker)
        # An empty queue, nudges, and stale incoming targets cannot clear the lock.
        tracker.manual_rotator_target = {"az": 200, "el": 50}
        tracker.nudge_offset = {"az": 2, "el": 0}
        await tracker.rotator_handler.control_rotator_position((200, 50))
        assert tracker.manual_rotator_target is None
        assert tracker.rotator_data["stopped"] is False
        for second in (0, 1):
            clock[0] = second
            await tracker.rotator_handler.update_hardware_position()
            assert tracker.rotator_data["motion_unconfirmed"] is True
        clock[0] = 2
        await tracker.rotator_handler.update_hardware_position()
        tracker.operations.finish_cycle()
        assert tracker.rotator_data["motion_unconfirmed"] is False
        assert tracker.rotator_data["stopped"] is True
        assert (
            result(tracker)["status"]
            == {b"RPRT 0\n": "succeeded", b"RPRT -4\n": "failed", None: "unknown"}[reply]
        )
        assert tracker.input_tracking_state["rotator_state"] == "stopped"


@pytest.mark.asyncio
async def test_slow_drift_and_deadlines_cannot_create_stop_success(monkeypatch):
    clock = [0.0]
    monkeypatch.setattr(
        handlermodule, "time", SimpleNamespace(time=time.time, monotonic=lambda: clock[0])
    )
    async with controller_peer(b"RPRT 0\n") as (controller, commands):
        tracker = worker(controller)
        await stop(tracker)
        for second in range(5):
            clock[0] = second
            tracker.rotator_handler._observe_stopped_motion(123 + second * 0.04, 45)
        assert tracker.rotator_data["motion_unconfirmed"] is True
        tracker.operations.cancel("stop")
        assert result(tracker)["status"] == "unknown"
        assert result(tracker)["reconciled"] is True
        assert not tracker.operations.pending
        assert sum(line == b"S\n" for _, line in commands) == 1


@pytest.mark.parametrize(
    "action,changes",
    [("move", {}), ("track", {"rotator_state": "tracking"}), ("park", {"rotator_state": "parked"})],
)
def test_supervisor_and_worker_reject_movement_while_motion_is_unconfirmed(action, changes):
    tracker = worker(None)
    tracker.input_tracking_state["rotator_state"] = "stopped"
    registry = OperationRegistry()
    operation = registry.accept(
        "target-1", changes, tracker.input_tracking_state, {"action": action}
    )
    tracker.rotator_data["motion_unconfirmed"] = True
    tracker.operations.accept(
        {
            "operation": operation,
            "messages": [
                {
                    "type": "set_tracking_state",
                    "payload": {**tracker.input_tracking_state, **changes},
                }
            ],
        }
    )
    assert result(tracker)["status"] == "failed"
    assert tracker.input_tracking_state["rotator_state"] == "stopped"
    registry.observe(tracker.operations.snapshot())
    with pytest.raises(ValueError, match="motion is unconfirmed"):
        registry.accept("target-1", changes, tracker.input_tracking_state, {"action": action})


def test_reconciled_unknown_result_allows_stop_retry():
    registry = OperationRegistry()
    state = {"rotator_id": "mount", "rotator_state": "stopped"}
    operation = registry.accept("target-1", {"rotator_state": "stopped"}, state, {"action": "stop"})
    registry.update(operation["command_id"], "unknown", "Stop unconfirmed", reconciled=True)
    assert registry.snapshot()["commands"][0]["reconciled"] is True
    assert (
        registry.accept("target-1", {"rotator_state": "stopped"}, state, {"action": "stop"})[
            "status"
        ]
        == "submitted"
    )


def test_cancellation_observation_has_a_deadline():
    tracker = worker(None)
    registry = OperationRegistry()
    tracker.input_tracking_state["rotator_state"] = "connected"
    operation = registry.accept(
        "target-1",
        {},
        tracker.input_tracking_state,
        {"command_id": "move", "action": "move", "position": {"az": 200, "el": 60}},
    )
    tracker.operations.accept({"operation": operation})
    tracker.operations.begin_cycle()
    tracker.rotator_handler.stop_result = ("failed", "An older Stop was rejected")
    tracker.operations.cancel("move")
    tracker.operations.finish_cycle()
    assert "move" in tracker.operations.pending
    tracker.rotator_data["motion_unconfirmed"] = True
    tracker.operations.pending["move"]["stop_deadline"] = time.time() - 1
    tracker.operations.begin_cycle()
    assert not tracker.operations.pending
    assert result(tracker)["status"] == "unknown"
    assert result(tracker)["reconciled"] is True
    assert tracker.input_tracking_state["rotator_state"] == "stopped"


@pytest.mark.asyncio
async def test_position_loss_after_acknowledgement_leaves_stop_unconfirmed():
    async with controller_peer(b"RPRT 0\n") as (controller, _commands):
        tracker = worker(controller)
        await stop(tracker)
        await tracker.rotator_handler.handle_rotator_error(ConnectionError("Position read failed"))
        tracker.operations.finish_cycle()
        assert result(tracker)["status"] == "unknown"
        assert result(tracker)["reconciled"] is True
        assert tracker.rotator_data["motion_unconfirmed"] is True
