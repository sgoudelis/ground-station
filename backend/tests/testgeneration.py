# Copyright (c) 2026 Efstratios Goudelis
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Regression tests for replacing observations during pass regeneration."""

import asyncio
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
import pytest_asyncio
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from sqlalchemy import select, update

from crud import scheduledobservations
from db.models import ObservationStatus, Satellites, ScheduledObservations
from observations import conflicts, generator
from observations import sync as observationsync

pytestmark = pytest.mark.unit

SDR_ID = "9ad7183f-1223-4678-bdec-9292aa35e185"


@pytest_asyncio.fixture
async def generation(db_session, monkeypatch):
    clock = SimpleNamespace(now=datetime(2030, 1, 1, 12, tzinfo=timezone.utc))

    class FrozenDateTime(datetime):
        @classmethod
        def now(cls, tz=None):
            return clock.now

    for module in (generator, conflicts, scheduledobservations):
        monkeypatch.setattr(module, "datetime", FrozenDateTime)

    satellite = {"norad_id": 67287, "name": "LUCA"}
    monitored = {
        "id": "monitored-candidate",
        "satellite": satellite,
        "sessions": [{"sdr": {"id": SDR_ID}, "tasks": []}],
        "min_elevation": 10,
        "task_start_elevation": 0,
    }
    pass_data = {
        "event_start": (clock.now + timedelta(minutes=2)).isoformat(),
        "event_end": (clock.now + timedelta(minutes=12)).isoformat(),
        "peak_altitude": 50,
    }
    db_session.add_all([Satellites(**satellite), Satellites(norad_id=67290, name="SAKHACUBE")])
    await db_session.commit()
    monkeypatch.setattr(generator, "CONFLICT_RESOLUTION_STRATEGY", "priority")
    monkeypatch.setattr(
        generator,
        "fetch_satellites",
        AsyncMock(return_value={"success": True, "data": [satellite]}),
    )
    monkeypatch.setattr(
        generator,
        "get_propagation_input",
        lambda *args, **kwargs: SimpleNamespace(tle1="tle1", tle2="tle2"),
    )
    monkeypatch.setattr(
        generator, "calculate_next_events", lambda **kwargs: {"success": True, "data": [pass_data]}
    )
    return SimpleNamespace(
        session=db_session, clock=clock, monitored=monitored, pass_data=pass_data
    )


async def _blocker(generation, *, status="scheduled", start_offset=1, observation_id="blocker"):
    observation = ScheduledObservations(
        id=observation_id,
        name="SAKHACUBE pass",
        enabled=True,
        status=status,
        norad_id=67290,
        event_start=generation.clock.now + timedelta(minutes=start_offset),
        event_end=generation.clock.now + timedelta(minutes=10),
        satellite_config={"name": "SAKHACUBE"},
        pass_config={"peak_altitude": 20},
        hardware_config={},
        sessions=[{"sdr": {"id": SDR_ID}, "tasks": []}],
        execution_log=[{"event": "Keep this execution history"}],
    )
    generation.session.add(observation)
    await generation.session.commit()
    return observation


async def _generate(generation, *, dry_run=False, override=None):
    pass_id = generator._build_pass_id(
        generation.monitored["id"],
        generation.monitored["satellite"]["norad_id"],
        generation.pass_data,
    )
    return await generator._generate_observations_for_satellite(
        generation.session,
        generation.monitored,
        {"lat": 38, "lon": 23},
        dry_run=dry_run,
        user_conflict_overrides={pass_id: override} if override else None,
    )


async def _observations(generation):
    generation.session.expire_all()
    return (await generation.session.execute(select(ScheduledObservations))).scalars().all()


@pytest.mark.parametrize("dry_run", [False, True])
@pytest.mark.parametrize("override", [None, "replace", "replace_blockers"])
@pytest.mark.parametrize(
    ("status", "start_offset"), [("running", -2), ("running", 1), ("scheduled", -2)]
)
async def test_generation_preserves_active_blockers(
    generation, dry_run, override, status, start_offset
):
    await _blocker(generation, status=status, start_offset=start_offset)

    result = await _generate(generation, dry_run=dry_run, override=override)

    assert result["generated"] == 0
    assert result["skipped"] == 1
    observations = await _observations(generation)
    assert [observation.id for observation in observations] == ["blocker"]
    assert observations[0].status.value == status
    assert observations[0].execution_log == [{"event": "Keep this execution history"}]
    if dry_run:
        preview = result["conflicting_passes"][0]
        assert preview["strategy_action"] == "keep_existing"
        assert preview["effective_action"] == "keep_existing"
        assert preview["replacement_allowed"] is False


async def test_one_running_blocker_preserves_the_whole_conflicting_group(generation):
    await _blocker(generation, status="running", start_offset=-2, observation_id="running")
    await _blocker(generation, observation_id="future")

    result = await _generate(generation, override="replace_blockers")

    assert result["generated"] == 0
    assert {observation.id for observation in await _observations(generation)} == {
        "running",
        "future",
    }


@pytest.mark.parametrize("dry_run", [False, True])
@pytest.mark.parametrize("strategy", ["priority", "skip", "force"])
async def test_generation_skips_candidates_whose_task_start_has_passed(
    generation, monkeypatch, dry_run, strategy
):
    generation.pass_data["event_start"] = (generation.clock.now - timedelta(minutes=2)).isoformat()
    monkeypatch.setattr(generator, "CONFLICT_RESOLUTION_STRATEGY", strategy)

    result = await _generate(generation, dry_run=dry_run)

    assert result["generated"] == 0
    assert result["skipped"] == 1
    assert await _observations(generation) == []
    if dry_run:
        assert result["no_conflict_passes"] == []


@pytest.mark.parametrize("dry_run", [False, True])
@pytest.mark.parametrize("strategy,override", [("priority", None), ("skip", "replace")])
async def test_future_scheduled_blockers_can_still_be_replaced(
    generation, monkeypatch, dry_run, strategy, override
):
    await _blocker(generation)
    monkeypatch.setattr(generator, "CONFLICT_RESOLUTION_STRATEGY", strategy)

    result = await _generate(generation, dry_run=dry_run, override=override)

    assert result["generated"] == 1
    assert result["skipped"] == 0
    observations = await _observations(generation)
    if dry_run:
        assert [observation.id for observation in observations] == ["blocker"]
        assert result["conflicting_passes"][0]["replacement_allowed"] is True
    else:
        assert len(observations) == 1
        assert observations[0].norad_id == 67287
        assert observations[0].status == ObservationStatus.SCHEDULED


@pytest.mark.parametrize("change", ["running", "start_time"])
async def test_replacement_rechecks_lifecycle_before_deleting_any_blocker(
    generation, monkeypatch, change
):
    await _blocker(generation, observation_id="starting")
    await _blocker(generation, start_offset=3, observation_id="future")
    original_delete = scheduledobservations.delete_scheduled_observations

    async def delete_after_start(session, ids, **kwargs):
        # Simulate the scheduler starting a pass after conflict detection. Keep
        # the loaded ORM snapshot stale, just as a separate scheduler session can.
        if change == "running":
            await session.execute(
                update(ScheduledObservations)
                .where(ScheduledObservations.id == "starting")
                .values(status="running")
                .execution_options(synchronize_session=False)
            )
            await session.commit()
        else:
            generation.clock.now += timedelta(minutes=2)
        return await original_delete(session, ids, **kwargs)

    monkeypatch.setattr(generator, "delete_scheduled_observations", delete_after_start)

    result = await _generate(generation)

    assert result["generated"] == 0
    assert result["skipped"] == 1
    observations = {observation.id: observation for observation in await _observations(generation)}
    assert set(observations) == {"starting", "future"}
    assert observations["future"].status == ObservationStatus.SCHEDULED
    assert observations["starting"].status == (
        ObservationStatus.RUNNING if change == "running" else ObservationStatus.SCHEDULED
    )


async def test_failed_blocker_deletion_does_not_create_a_replacement(generation, monkeypatch):
    await _blocker(generation)
    monkeypatch.setattr(
        generator,
        "delete_scheduled_observations",
        AsyncMock(return_value={"success": False, "error": "Database unavailable"}),
    )

    result = await _generate(generation)

    assert result["generated"] == 0
    assert result["skipped"] == 1
    assert [observation.id for observation in await _observations(generation)] == ["blocker"]


async def test_confirmation_rechecks_blockers_that_started_after_preview(generation):
    await _blocker(generation)
    preview = await _generate(generation, dry_run=True)
    assert preview["conflicting_passes"][0]["replacement_allowed"] is True
    await generation.session.execute(
        update(ScheduledObservations)
        .where(ScheduledObservations.id == "blocker")
        .values(status="running")
    )
    await generation.session.commit()

    result = await _generate(generation, override="replace_blockers")

    assert result["generated"] == 0
    assert result["skipped"] == 1
    observations = await _observations(generation)
    assert [observation.id for observation in observations] == ["blocker"]
    assert observations[0].status == ObservationStatus.RUNNING


async def test_current_pass_can_be_created_before_its_elevation_task_start(generation, monkeypatch):
    generation.pass_data["event_start"] = (generation.clock.now - timedelta(minutes=2)).isoformat()
    generation.monitored["task_start_elevation"] = 10
    task_start = generation.clock.now + timedelta(minutes=1)
    task_end = generation.clock.now + timedelta(minutes=10)
    monkeypatch.setattr(
        generator,
        "calculate_elevation_crossing_time",
        lambda **kwargs: (task_start, task_end),
    )
    monkeypatch.setattr(
        generator.crud_locations,
        "fetch_all_locations",
        AsyncMock(return_value={"success": True, "data": [{"lat": 38, "lon": 23}]}),
    )

    result = await _generate(generation)

    assert result["generated"] == 1
    observations = await _observations(generation)
    assert len(observations) == 1
    assert observations[0].task_start == task_start


async def test_regeneration_preserves_the_running_stop_job(generation, monkeypatch):
    blocker = await _blocker(generation, status="running", start_offset=-2)
    stopped = asyncio.Event()

    async def stop(observation_id):
        assert observation_id == "blocker"
        stopped.set()

    @asynccontextmanager
    async def session_context():
        yield generation.session

    monkeypatch.setattr(observationsync, "AsyncSessionLocal", session_context)
    monkeypatch.setattr(observationsync, "log_execution_event", AsyncMock())
    scheduler = AsyncIOScheduler(timezone=timezone.utc)
    scheduler.start(paused=True)
    executor = SimpleNamespace(sio=None, start_observation=AsyncMock(), stop_observation=stop)
    try:
        sync = observationsync.ObservationSchedulerSync(scheduler, executor)
        await sync.sync_observation(blocker.id)
        stop_job = scheduler.get_job("obs_blocker_stop")
        assert stop_job.next_run_time == blocker.event_end

        await _generate(generation, override="replace_blockers")
        result = await sync.sync_all_observations()

        assert result["success"] is True
        assert result["stats"]["scheduled_stop"] == 1
        assert scheduler.get_job("obs_blocker_stop") is stop_job
        assert [job.id for job in scheduler.get_jobs()] == ["obs_blocker_stop"]
        # Bring LOS forward to verify the retained job still executes.
        scheduler.reschedule_job(
            "obs_blocker_stop", trigger="date", run_date=datetime.now(timezone.utc)
        )
        scheduler.resume()
        await asyncio.wait_for(stopped.wait(), timeout=2)
        executor.start_observation.assert_not_awaited()
    finally:
        scheduler.shutdown(wait=False)
        await asyncio.sleep(0)
