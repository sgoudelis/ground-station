# Copyright (c) 2026 Efstratios Goudelis
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Regression tests for observation job reconciliation during regeneration."""

import asyncio
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest
import pytest_asyncio
from apscheduler.schedulers.asyncio import AsyncIOScheduler

import observations.sync as sync_module

pytestmark = pytest.mark.unit


class _SessionContext:
    async def __aenter__(self):
        return object()

    async def __aexit__(self, *args):
        return False


def _observation(status="running", enabled=True):
    now = datetime.now(timezone.utc)
    return {
        "id": "obs-1",
        "name": "Test observation",
        "status": status,
        "enabled": enabled,
        "pass": {
            "event_start": (now + timedelta(minutes=-1 if status == "running" else 1)).isoformat(),
            "event_end": (now + timedelta(minutes=5)).isoformat(),
        },
        "task_start": (now + timedelta(minutes=2)).isoformat(),
        "task_end": (now + timedelta(minutes=4)).isoformat(),
        "execution_log": [{"event": "All tasks started successfully"}],
    }


@pytest_asyncio.fixture
async def state(monkeypatch):
    observations = {}
    stopped = asyncio.Event()

    async def stop(_observation_id):
        stopped.set()

    executor = SimpleNamespace(
        sio=None,
        start_observation=AsyncMock(),
        stop_observation=AsyncMock(side_effect=stop),
    )
    scheduler = AsyncIOScheduler(timezone=timezone.utc)
    scheduler.start(paused=True)
    sync = sync_module.ObservationSchedulerSync(scheduler, executor)

    async def fetch(_session, observation_id=None):
        return {
            "success": True,
            "data": (
                observations.get(observation_id)
                if observation_id is not None
                else list(observations.values())
            ),
        }

    async def update_status(_sio, observation_id, status):
        observations[observation_id]["status"] = status

    clear_log = AsyncMock()
    monkeypatch.setattr(sync_module, "AsyncSessionLocal", _SessionContext)
    monkeypatch.setattr(sync_module, "fetch_scheduled_observations", fetch)
    monkeypatch.setattr(sync_module, "log_execution_event", AsyncMock())
    monkeypatch.setattr(sync_module, "update_observation_status", update_status)
    monkeypatch.setattr(sync, "_clear_execution_log", clear_log)

    yield SimpleNamespace(
        sync=sync,
        scheduler=scheduler,
        executor=executor,
        observations=observations,
        clear_log=clear_log,
        stopped=stopped,
    )

    scheduler.shutdown(wait=False)
    await asyncio.sleep(0)


def _add_job(state, event_type, observation_id="obs-1"):
    return state.scheduler.add_job(
        getattr(state.executor, f"{event_type}_observation"),
        "date",
        run_date=datetime.now(timezone.utc) + timedelta(minutes=5),
        args=[observation_id],
        id=f"obs_{observation_id}_{event_type}",
    )


@pytest.mark.parametrize("full_sync", [False, True])
@pytest.mark.parametrize("enabled", [False, True])
@pytest.mark.parametrize("existing_stop", [False, True])
async def test_running_observation_retains_or_recovers_stop_job(
    state, monkeypatch, full_sync, enabled, existing_stop
):
    observation = _observation(enabled=enabled)
    state.observations["obs-1"] = observation
    _add_job(state, "start")
    if existing_stop:
        _add_job(state, "stop")
    removed = Mock(wraps=state.scheduler.remove_job)
    monkeypatch.setattr(state.scheduler, "remove_job", removed)

    result = await (
        state.sync.sync_all_observations() if full_sync else state.sync.sync_observation("obs-1")
    )

    assert result["success"] is True
    if full_sync:
        assert result["stats"]["scheduled_stop"] == 1
        assert result["stats"]["errors"] == 0
    assert [job.id for job in state.scheduler.get_jobs()] == ["obs_obs-1_stop"]
    stop_job = state.scheduler.get_job("obs_obs-1_stop")
    assert stop_job.next_run_time == datetime.fromisoformat(observation["task_end"])
    assert stop_job.func is state.executor.stop_observation
    assert stop_job.args == ("obs-1",)
    assert all(call.args[0] != "obs_obs-1_stop" for call in removed.call_args_list)
    state.clear_log.assert_not_awaited()
    assert observation["execution_log"] == [{"event": "All tasks started successfully"}]
    state.executor.start_observation.assert_not_awaited()
    state.executor.stop_observation.assert_not_awaited()


@pytest.mark.parametrize("full_sync", [False, True])
@pytest.mark.parametrize("overdue", [False, True])
@pytest.mark.parametrize("stop_source", ["task_end", "event_end"])
async def test_running_observation_stop_job_actually_executes(
    state, full_sync, overdue, stop_source
):
    observation = _observation()
    stop_time = (
        datetime.now(timezone.utc) + timedelta(seconds=-60 if overdue else 0.1)
    ).isoformat()
    if stop_source == "task_end":
        observation["task_end"] = stop_time
    else:
        observation["pass"]["event_end"] = stop_time
    state.observations["obs-1"] = observation

    result = await (
        state.sync.sync_all_observations() if full_sync else state.sync.sync_observation("obs-1")
    )
    assert result["success"] is True
    # Resume the real scheduler to verify the callback, including overdue recovery.
    state.scheduler.resume()
    await asyncio.wait_for(state.stopped.wait(), timeout=2)

    state.executor.stop_observation.assert_awaited_once_with("obs-1")
    state.executor.start_observation.assert_not_awaited()
    assert state.scheduler.get_job("obs_obs-1_stop") is None


async def test_repeated_regeneration_preserves_correct_running_stop_job(state):
    state.observations["obs-1"] = _observation()
    await state.sync.sync_all_observations()
    stop_job = state.scheduler.get_job("obs_obs-1_stop")
    sync_module.log_execution_event.reset_mock()

    result = await state.sync.sync_all_observations()

    assert result["success"] is True
    assert state.scheduler.get_job("obs_obs-1_stop") is stop_job
    sync_module.log_execution_event.assert_not_awaited()


@pytest.mark.parametrize("status", ["running", "scheduled"])
@pytest.mark.parametrize("task_end_offset", [None, -30, 30])
async def test_stop_time_uses_earlier_task_end_or_los(state, status, task_end_offset):
    observation = _observation(status=status)
    los = datetime.fromisoformat(observation["pass"]["event_end"])
    task_end = los + timedelta(seconds=task_end_offset) if task_end_offset is not None else None
    observation["task_end"] = task_end.isoformat() if task_end else None
    state.observations["obs-1"] = observation

    result = await state.sync.sync_observation("obs-1")

    assert result["success"] is True
    assert state.scheduler.get_job("obs_obs-1_stop").next_run_time == (
        min(task_end, los) if task_end else los
    )
    start_job = state.scheduler.get_job("obs_obs-1_start")
    if status == "scheduled":
        assert start_job.next_run_time == datetime.fromisoformat(observation["task_start"])
    else:
        assert start_job is None


@pytest.mark.parametrize("status", ["completed", "failed", "cancelled", "missed", "scheduled"])
async def test_terminal_or_disabled_observations_lose_remaining_jobs(state, status):
    state.observations["obs-1"] = _observation(status=status, enabled=status != "scheduled")
    _add_job(state, "start")
    _add_job(state, "stop")

    result = await state.sync.sync_all_observations()

    assert result["success"] is True
    assert state.scheduler.get_jobs() == []
    state.executor.start_observation.assert_not_awaited()
    state.executor.stop_observation.assert_not_awaited()


async def test_full_sync_reconciles_mixed_observations_and_prunes_deleted_jobs(state):
    state.observations["obs-1"] = _observation()
    future = _observation(status="scheduled")
    future["id"] = "future"
    state.observations["future"] = future
    for observation_id in ("obs-1", "future", "deleted"):
        _add_job(state, "start", observation_id)
        _add_job(state, "stop", observation_id)
    unrelated = state.scheduler.add_job(
        state.executor.start_observation, "interval", hours=1, id="sync_satellite_data"
    )

    result = await state.sync.sync_all_observations()

    assert result["success"] is True
    assert result["stats"]["scheduled"] == 1
    assert result["stats"]["scheduled_stop"] == 1
    assert {job.id for job in state.scheduler.get_jobs()} == {
        "obs_obs-1_stop",
        "obs_future_start",
        "obs_future_stop",
        "sync_satellite_data",
    }
    assert state.scheduler.get_job("sync_satellite_data") is unrelated


async def test_full_sync_keeps_jobs_added_during_database_read(state, monkeypatch):
    async def fetch(_session, observation_id=None):
        _add_job(state, "stop", "new")
        return {"success": True, "data": []}

    monkeypatch.setattr(sync_module, "fetch_scheduled_observations", fetch)

    result = await state.sync.sync_all_observations()

    assert result["success"] is True
    assert state.scheduler.get_job("obs_new_stop") is not None


@pytest.mark.parametrize("full_sync", [False, True])
@pytest.mark.parametrize("raises", [False, True])
async def test_failed_database_read_keeps_existing_stop_job(state, monkeypatch, full_sync, raises):
    stop_job = _add_job(state, "stop")

    async def fetch(*args):
        if raises:
            raise RuntimeError("Database unavailable")
        return {"success": False, "error": "Database unavailable"}

    monkeypatch.setattr(sync_module, "fetch_scheduled_observations", fetch)

    result = await (
        state.sync.sync_all_observations() if full_sync else state.sync.sync_observation("obs-1")
    )

    assert result["success"] is False
    assert "Database unavailable" in result["error"]
    assert state.scheduler.get_job("obs_obs-1_stop") is stop_job


@pytest.mark.parametrize("failure", ["invalid_time", "add_job"])
async def test_running_sync_failure_keeps_existing_stop_job(state, monkeypatch, failure):
    observation = _observation()
    state.observations["obs-1"] = observation
    stop_job = _add_job(state, "stop")
    if failure == "invalid_time":
        observation["pass"]["event_end"] = None
    else:
        monkeypatch.setattr(state.scheduler, "add_job", Mock(side_effect=RuntimeError("Failed")))

    result = await state.sync.sync_observation("obs-1")

    assert result["success"] is False
    assert state.scheduler.get_job("obs_obs-1_stop") is stop_job
    state.clear_log.assert_not_awaited()


async def test_individual_sync_removes_jobs_for_deleted_observation(state):
    _add_job(state, "start")
    _add_job(state, "stop")

    result = await state.sync.sync_observation("obs-1")

    assert result == {"success": True, "action": "removed"}
    assert state.scheduler.get_jobs() == []


async def test_full_sync_marks_expired_scheduled_observation_missed(state):
    observation = _observation(status="scheduled")
    observation["task_end"] = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()
    state.observations["obs-1"] = observation
    _add_job(state, "start")
    _add_job(state, "stop")

    result = await state.sync.sync_all_observations()

    assert result["stats"]["missed"] == 1
    assert observation["status"] == "missed"
    assert state.scheduler.get_jobs() == []
