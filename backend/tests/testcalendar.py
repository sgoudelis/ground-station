"""Calendar query boundaries, observation projection, routing, and authorization."""

from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from unittest.mock import Mock

import pytest
from pydantic import ValidationError

from calendars.schemas import CalendarRange
from calendars.service import calendar_events
from common import auth
from db.models import MonitoredSatellites, ObservationStatus, Satellites, ScheduledObservations
from handlers.entities import calendar
from handlers.routing.dispatcher import dispatch_request
from handlers.routing.registry import HandlerRegistry

pytestmark = pytest.mark.unit


def instant(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


async def insert_observations(session):
    session.add(Satellites(norad_id=25544, name="ISS"))
    await session.flush()
    session.add(
        MonitoredSatellites(
            id="monitor-iss",
            norad_id=25544,
            satellite_config={"name": "ISS"},
            hardware_config={},
            generation_config={},
            sessions=[],
        )
    )
    await session.flush()

    def row(identifier, start, end, **kwargs):
        return ScheduledObservations(
            id=identifier,
            name=f"ISS {identifier}",
            norad_id=25544,
            event_start=instant(start),
            event_end=instant(end),
            satellite_config={"name": "ISS"},
            pass_config={"peak_altitude": 72.5},
            hardware_config={},
            sessions=kwargs.pop("sessions", []),
            **kwargs,
        )

    session.add_all(
        [
            row("cross-start", "2026-11-17T23:59:00Z", "2026-11-18T00:05:00Z"),
            row("ends-at-start", "2026-11-17T23:50:00Z", "2026-11-18T00:00:00Z"),
            row("starts-at-end", "2026-11-19T00:00:00Z", "2026-11-19T00:10:00Z"),
            row(
                "outside-tasks",
                "2026-11-17T23:50:00Z",
                "2026-11-18T00:20:00Z",
                task_start=instant("2026-11-17T23:52:00Z"),
                task_end=instant("2026-11-17T23:59:00Z"),
            ),
            row(
                "generated",
                "2026-11-18T10:00:00Z",
                "2026-11-18T10:15:00Z",
                task_start=instant("2026-11-18T10:02:00Z"),
                task_end=instant("2026-11-18T10:12:00Z"),
                monitored_satellite_id="monitor-iss",
                sessions=[
                    {
                        "sdr": {"center_frequency": 146500000},
                        "tasks": [
                            {
                                "type": "decoder",
                                "config": {"frequency": 145800000, "decoder_type": "sstv"},
                            },
                            {
                                "type": "audio_recording",
                                "config": {"frequency": 145800000, "demodulator": "fm"},
                            },
                            {"type": "iq_recording", "config": {}},
                        ],
                    }
                ],
            ),
            row("disabled", "2026-11-18T11:00:00Z", "2026-11-18T11:10:00Z", enabled=False),
            row(
                "completed",
                "2026-11-18T12:00:00Z",
                "2026-11-18T12:10:00Z",
                status=ObservationStatus.COMPLETED,
            ),
        ]
    )
    await session.commit()


async def test_range_queries_overlap_using_task_times_and_preserve_provenance(db_session):
    await insert_observations(db_session)
    result = await calendar_events(db_session, CalendarRange(start="2026-11-18", end="2026-11-19"))
    assert [item["source_id"] for item in result["events"]] == [
        "cross-start",
        "generated",
        "disabled",
        "completed",
    ]
    generated = result["events"][1]
    assert generated["id"] == "observations:generated"
    assert generated["source"] == "observations"
    assert generated["kind"] == "observation"
    assert generated["satellites"] == [{"name": "ISS", "norad_id": 25544}]
    assert instant(generated["start"]) == instant("2026-11-18T10:02:00Z")
    assert instant(generated["end"]) == instant("2026-11-18T10:12:00Z")
    assert generated["observation"]["monitored_satellite_id"] == "monitor-iss"
    assert generated["observation"]["peak_altitude"] == 72.5
    assert instant(generated["observation"]["pass_start"]) == instant("2026-11-18T10:00:00Z")
    assert generated["frequencies"] == [
        {"hz": 145800000, "mode": "FM"},
        {"hz": 146500000, "mode": None},
    ]
    assert result["events"][2]["enabled"] is False
    assert result["events"][3]["status"] == "completed"
    assert result["events"][0]["frequencies"] == []


async def test_timezone_query_includes_previous_utc_date_and_has_no_synthetic_events(db_session):
    await insert_observations(db_session)
    result = await calendar_events(
        db_session,
        CalendarRange(
            start="2026-11-18",
            end="2026-11-19",
            timezone="Asia/Tokyo",
        ),
    )
    assert "ends-at-start" in [item["source_id"] for item in result["events"]]
    assert "starts-at-end" not in [item["source_id"] for item in result["events"]]
    empty = await calendar_events(db_session, CalendarRange(start="2027-01-01", end="2027-02-01"))
    assert empty["events"] == []
    assert empty["sources"] == [{"id": "observations"}]


@pytest.mark.parametrize("day,hours", [("2026-03-29", 23), ("2026-10-25", 25)])
def test_calendar_days_respect_dst(day, hours):
    start = datetime.fromisoformat(day)
    end = (start + timedelta(days=1)).date().isoformat()
    bounds = CalendarRange(start=day, end=end, timezone="Europe/Athens").utc_bounds()
    assert bounds[1] - bounds[0] == timedelta(hours=hours)
    assert bounds[0].tzinfo == timezone.utc


@pytest.mark.parametrize(
    "payload",
    [
        None,
        [],
        {},
        {"start": "2026-11-18", "end": "2026-11-18"},
        {"start": "2026-11-19", "end": "2026-11-18"},
        {"start": "2026-01-01", "end": "2027-01-01"},
        {"start": "2026-11-18", "end": "2026-11-19", "timezone": "Invalid/Zone"},
        {"start": "2026-11-18", "end": "2026-11-19", "surprise": True},
    ],
)
async def test_invalid_queries_are_rejected_before_database_access(monkeypatch, payload):
    factory = Mock(side_effect=AssertionError("Database should not be opened"))
    monkeypatch.setattr(calendar, "AsyncSessionLocal", factory)
    with pytest.raises(ValidationError):
        CalendarRange.model_validate(payload)
    response = await calendar.get_calendar_events(None, payload, Mock(), "sid")
    assert response["success"] is False
    assert response["error"]
    factory.assert_not_called()


async def test_registered_query_uses_shared_authorization_and_is_read_only(db_session, monkeypatch):
    await insert_observations(db_session)

    @asynccontextmanager
    async def session_factory():
        yield db_session

    async def setup_required():
        return False

    monkeypatch.setattr(calendar, "AsyncSessionLocal", session_factory)
    monkeypatch.setattr(auth, "is_setup_required", setup_required)
    registry = HandlerRegistry()
    calendar.register_handlers(registry)
    route = registry.get_handler("get-calendar-events")
    assert route.action == "read"
    assert route.resource == "calendar"
    payload = {"start": "2026-11-18", "end": "2026-11-19", "timezone": "UTC"}
    denied = await dispatch_request(None, "get-calendar-events", payload, Mock(), "sid", registry)
    assert denied["success"] is False
    assert denied["error"] == "Authentication required."
    for role in ["operator", "admin"]:
        response = await dispatch_request(
            None,
            "get-calendar-events",
            payload,
            Mock(),
            "sid",
            registry,
            auth_context={"role": role},
        )
        assert response["success"] is True
        assert response["data"]["events"][1]["source_id"] == "generated"
    assert not db_session.new and not db_session.dirty and not db_session.deleted
