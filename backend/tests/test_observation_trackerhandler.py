# Copyright (c) 2026 Efstratios Goudelis

import time
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from hardware.service import HardwareSupervisor
from observations.tasks import trackerhandler as handler_module
from observations.tasks.trackerhandler import TrackerHandler, TrackerHandoffError
from tracker.operations import OperationRegistry


@pytest.fixture(autouse=True)
def isolated_hardware(monkeypatch):
    monkeypatch.setattr(handler_module, "hardware", HardwareSupervisor())
    monkeypatch.setattr(handler_module, "get_all_tracker_managers", lambda: {})
    # A missing handoff check must fail the test without starting real workers.
    monkeypatch.setattr(
        handler_module,
        "create_observation_tracker_slot",
        lambda _id: {"success": False, "error": "unexpected_slot_creation"},
    )


class FakeManager:
    def __init__(self, state=None):
        self.state = dict(state or {})

    async def get_tracking_state(self):
        return dict(self.state)


class SessionContext:
    async def __aenter__(self):
        return object()

    async def __aexit__(self, exc_type, exc, traceback):
        return None


@pytest.mark.asyncio
async def test_observation_tracker_removal_keeps_operations_lock_free(monkeypatch):
    lock_states = []

    def remove(_tracker_id):
        lock_states.append(handler_module.operations.lock.locked())
        return {"success": True}

    async def delete(_session, _state_name):
        return {"success": True, "deleted": True}

    monkeypatch.setattr(handler_module, "remove_tracker_instance", remove)
    monkeypatch.setattr(handler_module, "AsyncSessionLocal", SessionContext)
    monkeypatch.setattr(handler_module.trackingstate_crud, "delete_tracking_state", delete)

    assert await TrackerHandler()._remove_observation_tracker_instance("obs-1")
    assert lock_states == [False]


@pytest.mark.asyncio
async def test_command_wait_requires_confirmed_success(monkeypatch):
    registry = OperationRegistry()
    monkeypatch.setattr(handler_module, "operations", registry)

    async def update(tracker_id, value, requester_sid=None, operation=None):
        assert requester_sid == "observation:one"
        assert operation == {"action": "configure"}
        registry.records["command-1"] = {
            "command_id": "command-1",
            "tracker_id": tracker_id,
            "status": "succeeded" if value["rig_state"] == "disconnected" else "failed",
            "reason": "connection failed",
        }
        return {"success": True, "result": {"command_id": "command-1"}}

    monkeypatch.setattr(handler_module, "update_tracking_state_with_ownership", update)
    handler = TrackerHandler()
    await handler._update_and_confirm("target-1", {"rig_state": "disconnected"}, "one")
    with pytest.raises(TrackerHandoffError, match="connection failed"):
        await handler._update_and_confirm("target-1", {"rig_state": "tracking"}, "one")


@pytest.mark.asyncio
@pytest.mark.parametrize("missing_rotator_assignment", [False, True])
async def test_observation_handoff_preserves_targets_and_cleans_up_hardware(
    monkeypatch, missing_rotator_assignment
):
    managers = {
        "target-1": FakeManager(
            {
                "norad_id": 100,
                "target_name": "Interactive target",
                "rotator_id": "rot-1",
                "rotator_state": "tracking",
                "rig_id": "old-rig",
                "rig_state": "tracking",
            }
        ),
        "target-2": FakeManager(
            {
                "norad_id": 200,
                "target_name": "Other target",
                "rotator_id": "none",
                "rotator_state": "disconnected",
                "rig_id": "new-rig",
                "rig_state": "connected",
            }
        ),
    }
    calls = []
    removed = []

    def manager(tracker_id):
        return managers.setdefault(tracker_id, FakeManager())

    async def confirmed(_self, tracker_id, value, _observation_id):
        calls.append((tracker_id, dict(value)))
        managers[tracker_id].state.update(value)

    async def remove(tracker_id):
        removed.append(tracker_id)
        return True

    async def valid_transmitter(_norad_id, _transmitter_id):
        return True

    monkeypatch.setattr(handler_module, "get_tracker_manager", manager)
    monkeypatch.setattr(handler_module, "get_all_tracker_managers", lambda: managers)
    monkeypatch.setattr(
        handler_module,
        "get_assigned_tracker_for_rotator",
        lambda rotator_id: (
            "target-1"
            if not missing_rotator_assignment
            and rotator_id == "rot-1"
            and managers["target-1"].state.get("rotator_id") == "rot-1"
            else None
        ),
    )
    monkeypatch.setattr(
        handler_module,
        "create_observation_tracker_slot",
        lambda _observation_id: {"success": True, "tracker_id": "obs-one"},
    )
    monkeypatch.setattr(TrackerHandler, "_update_and_confirm", confirmed)
    monkeypatch.setattr(TrackerHandler, "_rig_transmitter_exists", staticmethod(valid_transmitter))
    monkeypatch.setattr(
        TrackerHandler,
        "_remove_observation_tracker_instance",
        lambda self, tracker_id: remove(tracker_id),
    )

    handler = TrackerHandler()
    result = await handler.start_tracker_task(
        "one",
        {"norad_id": 300, "name": "Observation target"},
        {"id": "rot-1", "tracking_enabled": True},
        [],
        {"id": "new-rig", "transmitter_id": "tx-300"},
    )

    assert result["success"] is True
    assert result["tracker_id"] == "obs-one"
    assert [item for item in calls if item[0] == "target-1"] == [
        ("target-1", {"rig_state": "disconnected"}),
        ("target-1", {"rig_id": "none", "rig_vfo": "none"}),
        ("target-1", {"rotator_state": "disconnected"}),
        ("target-1", {"rotator_id": "none"}),
    ]
    assert [item for item in calls if item[0] == "target-2"] == [
        ("target-2", {"rig_state": "disconnected"}),
        ("target-2", {"rig_id": "none", "rig_vfo": "none"}),
    ]
    assert managers["target-1"].state["norad_id"] == 100
    assert managers["target-2"].state["norad_id"] == 200
    assert managers["obs-one"].state["norad_id"] == 300
    assert managers["obs-one"].state["rig_state"] == "tracking"
    assert managers["obs-one"].state["transmitter_id"] == "tx-300"

    assert await handler.stop_tracker_task("one", {}, result)
    assert managers["obs-one"].state["rig_state"] == "disconnected"
    assert managers["obs-one"].state["rig_id"] == "none"
    assert managers["obs-one"].state["rotator_state"] == "disconnected"
    assert managers["obs-one"].state["rotator_id"] == "none"
    assert removed == ["obs-one"]


@pytest.mark.asyncio
async def test_failed_disconnect_does_not_create_obs_slot(monkeypatch):
    owner = FakeManager(
        {
            "rotator_id": "rot-1",
            "rotator_state": "tracking",
            "rig_id": "rig-1",
            "rig_state": "tracking",
        }
    )
    created = []

    async def fail_disconnect(*_args):
        raise TrackerHandoffError("hardware_command_failed", "rig did not disconnect")

    monkeypatch.setattr(handler_module, "get_assigned_tracker_for_rotator", lambda _id: "target-1")
    monkeypatch.setattr(handler_module, "get_tracker_manager", lambda _id: owner)
    monkeypatch.setattr(
        handler_module, "create_observation_tracker_slot", lambda _id: created.append(True)
    )
    monkeypatch.setattr(TrackerHandler, "_update_and_confirm", fail_disconnect)

    result = await TrackerHandler().start_tracker_task(
        "one",
        {"norad_id": 300},
        {"id": "rot-1", "tracking_enabled": True},
        [],
    )
    assert result["success"] is False
    assert result["error"] == "hardware_command_failed"
    assert created == []
    assert owner.state["rotator_id"] == "rot-1"


@pytest.mark.asyncio
@pytest.mark.parametrize("missing_rotator_assignment", [False, True])
async def test_other_observation_hardware_is_not_taken(monkeypatch, missing_rotator_assignment):
    monkeypatch.setattr(
        handler_module,
        "get_assigned_tracker_for_rotator",
        lambda _id: None if missing_rotator_assignment else "obs-other",
    )
    monkeypatch.setattr(
        handler_module,
        "get_all_tracker_managers",
        lambda: {"obs-other": FakeManager({"rotator_id": "rot-1"})},
    )
    result = await TrackerHandler().start_tracker_task(
        "one",
        {"norad_id": 300},
        {"id": "rot-1", "tracking_enabled": True},
        [],
    )
    assert result["success"] is False
    assert result["error"] == "rotator_in_use"


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", ["rotator", "rig"])
async def test_hardware_observation_owner_blocks_handoff_without_slot_assignment(monkeypatch, kind):
    service = handler_module.hardware
    service.owners["obs-owner"] = {"type": "observation", "id": "obs-other"}
    service.devices[(kind, "device")] = SimpleNamespace(snapshot={"owner": "obs-owner"})
    service.release = AsyncMock()
    monkeypatch.setattr(handler_module, "get_assigned_tracker_for_rotator", lambda _id: None)

    with pytest.raises(TrackerHandoffError) as error:
        await TrackerHandler()._release_existing_hardware(
            "one", "device" if kind == "rotator" else None, "device" if kind == "rig" else None
        )
    assert error.value.code == f"{kind}_in_use"
    service.release.assert_not_awaited()


@pytest.mark.asyncio
async def test_actual_owner_is_released_before_detaching_stale_slot_references(monkeypatch):
    service = handler_module.hardware
    service.owners["tracker-owner"] = {"type": "tracker", "id": "target-2"}
    service.devices[("rotator", "rot-1")] = SimpleNamespace(snapshot={"owner": "tracker-owner"})
    managers = {
        "target-1": FakeManager({"rotator_id": "rot-1", "rotator_state": "disconnected"}),
        "target-2": FakeManager({"rotator_id": "rot-1", "rotator_state": "tracking"}),
    }
    calls = []

    async def release(kind, identifier, *, deadline=None, stationary_timeout=None):
        assert stationary_timeout == handler_module.ROTATOR_SETTLE_TIMEOUT_SECONDS
        calls.append((kind, identifier))

    # Keep release order separate from the list of detached references.
    detached = AsyncMock()

    async def confirm_detach(_self, tracker_id, observation_id, **flags):
        assert calls == [("rotator", "rot-1")]
        await detached(tracker_id, observation_id, **flags)

    monkeypatch.setattr(service, "release", release)
    monkeypatch.setattr(handler_module, "get_assigned_tracker_for_rotator", lambda _id: None)
    monkeypatch.setattr(handler_module, "get_all_tracker_managers", lambda: managers)
    monkeypatch.setattr(TrackerHandler, "_disconnect_slot_hardware", confirm_detach)

    await TrackerHandler()._release_existing_hardware("one", "rot-1", None)
    assert [call.args[0] for call in detached.await_args_list] == ["target-1", "target-2"]
    assert detached.await_args_list[0].kwargs == {"rotator": True, "rig": False}
    assert detached.await_args_list[1].kwargs == {"rotator": True, "rig": True}


@pytest.mark.asyncio
async def test_observation_does_not_create_slot_after_handoff_deadline():
    result = await TrackerHandler().start_tracker_task(
        "one", {"norad_id": 300}, {}, [], handoff_deadline=time.time() - 1
    )
    assert result["success"] is False
    assert result["error"] == "hardware_handoff_timeout"


@pytest.mark.asyncio
async def test_selected_rig_requires_tracking_transmitter():
    result = await TrackerHandler().start_tracker_task(
        "one",
        {"norad_id": 300},
        {},
        [{"type": "decoder", "config": {"transmitter_id": "decoder-tx"}}],
        {"id": "rig-1"},
    )
    assert result["success"] is False
    assert result["error"] == "missing_rig_transmitter"


@pytest.mark.asyncio
async def test_cleanup_keeps_obs_slot_when_disconnect_is_unconfirmed(monkeypatch):
    manager = FakeManager(
        {
            "rotator_id": "rot-1",
            "rotator_state": "tracking",
            "rig_id": "none",
            "rig_state": "disconnected",
        }
    )
    removed = []

    async def fail_disconnect(_self, _tracker_id, _value, _observation_id):
        raise TrackerHandoffError("hardware_command_failed", "rotator did not disconnect")

    async def remove(_self, tracker_id):
        removed.append(tracker_id)
        return True

    monkeypatch.setattr(handler_module, "get_tracker_manager", lambda _id: manager)
    monkeypatch.setattr(TrackerHandler, "_update_and_confirm", fail_disconnect)
    monkeypatch.setattr(TrackerHandler, "_remove_observation_tracker_instance", remove)

    ok = await TrackerHandler().stop_tracker_task(
        "one", {}, {"tracker_id": "obs-one", "ephemeral": True}
    )
    assert ok is False
    assert removed == []


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", ["park-command", "park-motion"])
async def test_failed_parking_falls_back_to_confirmed_stop(monkeypatch, failure):
    manager = FakeManager({"rotator_id": "rot-1", "rotator_state": "tracking"})
    handler = TrackerHandler()
    calls = []

    async def confirm(_tracker_id, value, _observation_id, **_options):
        calls.append(value)
        if value.get("rotator_state") == "parked" and failure == "park-command":
            raise TrackerHandoffError("park_rejected", "Controller rejected park")
        manager.state.update(value)

    async def stationary(_tracker_id, _rotator_id):
        if manager.state["rotator_state"] == "parked":
            raise TrackerHandoffError("rotator_settle_timeout", "Park never settled")
        calls.append("stationary")

    remove = AsyncMock(return_value=True)
    monkeypatch.setattr(handler_module, "get_tracker_manager", lambda _id: manager)
    monkeypatch.setattr(handler, "_update_and_confirm", confirm)
    monkeypatch.setattr(handler, "_wait_rotator_stationary", stationary)
    monkeypatch.setattr(handler, "_remove_observation_tracker_instance", remove)

    assert await handler.stop_tracker_task(
        "one", {"park_after_observation": True}, {"tracker_id": "obs-one"}
    )
    assert calls == [
        {"rotator_state": "parked"},
        {"rotator_state": "stopped"},
        "stationary",
        {"rotator_state": "disconnected"},
        {"rotator_id": "none"},
    ]
    remove.assert_awaited_once_with("obs-one")
