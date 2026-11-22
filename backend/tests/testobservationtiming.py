"""Regression tests for task timing when saving single observations."""

from contextlib import asynccontextmanager
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest
import pytest_asyncio

from crud import scheduledobservations
from db.models import Locations, Satellites, ScheduledObservations
from handlers.entities import scheduler
from observations import timing

pytestmark = pytest.mark.unit


@pytest_asyncio.fixture
async def single_observation(db_session, monkeypatch):
    db_session.add_all(
        [
            Satellites(norad_id=35933, name="BEESAT-1"),
            Locations(name="home", lat=38, lon=23, alt=100),
        ]
    )
    await db_session.commit()

    @asynccontextmanager
    async def session_context():
        yield db_session

    monkeypatch.setattr(scheduler, "AsyncSessionLocal", session_context)
    sync = AsyncMock(return_value={"success": True})
    monkeypatch.setattr(
        scheduler.obs_events, "observation_sync", SimpleNamespace(sync_observation=sync)
    )
    monkeypatch.setattr(scheduler, "emit_scheduled_observations_changed", AsyncMock())
    crossing = Mock(
        return_value=(
            datetime.fromisoformat("2026-11-22T22:22:00+00:00"),
            datetime.fromisoformat("2026-11-22T22:32:00+00:00"),
        )
    )
    monkeypatch.setattr(timing, "calculate_elevation_crossing_time", crossing)
    observation = {
        "id": "single-beesat",
        "name": "BEESAT-1 observation",
        "satellite": {"norad_id": 35933, "name": "BEESAT-1"},
        "pass": {
            "event_start": "2026-11-22T22:20:03Z",
            "event_end": "2026-11-22T22:33:50Z",
        },
        "sessions": [{"sdr": {}, "tasks": []}],
    }
    return SimpleNamespace(data=observation, session=db_session, crossing=crossing, sync=sync)


@pytest.mark.parametrize("editing", [False, True])
async def test_single_observation_saves_calculated_task_times(single_observation, editing):
    case = single_observation
    if editing:
        await scheduledobservations.add_scheduled_observation(case.session, case.data)
        # A newly selected pass must replace task times carried over from the old pass.
        case.data.update(
            task_start="2026-11-21T12:00:00Z",
            task_end="2026-11-21T12:10:00Z",
            task_start_elevation=20,
        )
    handler = (
        scheduler.update_scheduled_observation
        if editing
        else scheduler.create_scheduled_observation
    )

    result = await handler(None, case.data, Mock(), "client")

    assert result["success"] is True
    observation = await case.session.get(ScheduledObservations, case.data["id"])
    assert observation.task_start == case.crossing.return_value[0]
    assert observation.task_end == case.crossing.return_value[1]
    assert datetime.fromisoformat(result["data"]["task_start"]) == observation.task_start
    assert datetime.fromisoformat(result["data"]["task_end"]) == observation.task_end
    args = case.crossing.call_args.kwargs
    assert args["satellite_tle"]["norad_id"] == 35933
    assert args["home_location"]["lat"] == 38
    assert args["home_location"]["lon"] == 23
    assert args["target_elevation"] == (20 if editing else 10)
    assert args["aos_time"].isoformat() == "2026-11-22T22:20:03+00:00"
    assert args["los_time"].isoformat() == "2026-11-22T22:33:50+00:00"
    case.sync.assert_awaited_once_with(case.data["id"])


@pytest.mark.parametrize("editing", [False, True])
async def test_zero_elevation_saves_pass_times_without_propagation(single_observation, editing):
    case = single_observation
    if editing:
        await scheduledobservations.add_scheduled_observation(case.session, case.data)
    case.data["task_start_elevation"] = 0
    handler = (
        scheduler.update_scheduled_observation
        if editing
        else scheduler.create_scheduled_observation
    )

    result = await handler(None, case.data, Mock(), "client")

    assert result["success"] is True
    observation = await case.session.get(ScheduledObservations, case.data["id"])
    assert observation.task_start == observation.event_start
    assert observation.task_end == observation.event_end
    case.crossing.assert_not_called()


@pytest.mark.parametrize("missing", ["satellite", "location", "crossings", "start", "end"])
async def test_unavailable_crossings_fall_back_to_pass_times(
    single_observation, monkeypatch, missing
):
    case = single_observation
    if missing == "satellite":
        monkeypatch.setattr(
            timing, "fetch_satellites", AsyncMock(return_value={"success": True, "data": []})
        )
    elif missing == "location":
        monkeypatch.setattr(
            timing, "fetch_all_locations", AsyncMock(return_value={"success": True, "data": []})
        )
    else:
        start, end = case.crossing.return_value
        case.crossing.return_value = (
            None if missing in {"crossings", "start"} else start,
            None if missing in {"crossings", "end"} else end,
        )

    result = await scheduler.create_scheduled_observation(None, case.data, Mock(), "client")

    assert result["success"] is True
    observation = await case.session.get(ScheduledObservations, case.data["id"])
    start, end = case.crossing.return_value
    assert observation.task_start == (
        observation.event_start
        if missing in {"satellite", "location"}
        else start or observation.event_start
    )
    assert observation.task_end == (
        observation.event_end
        if missing in {"satellite", "location"}
        else end or observation.event_end
    )
