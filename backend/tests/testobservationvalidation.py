"""Regression tests for pass validation at the scheduler command boundary."""

from unittest.mock import Mock

import pytest

from handlers.entities import scheduler
from observations.validation import validate_observation_pass

pytestmark = pytest.mark.unit


@pytest.mark.parametrize(
    "pass_data",
    [
        None,
        {},
        "not a pass",
        {"event_start": "2026-11-06T12:00:00Z"},
        {"event_end": "2026-11-06T12:10:00Z"},
        {"event_start": "invalid", "event_end": "2026-11-06T12:10:00Z"},
        {"event_start": 123, "event_end": "2026-11-06T12:10:00Z"},
        {"event_start": "2026-11-06T12:00:00Z", "event_end": "2026-11-06T12:00:00Z"},
        {"event_start": "2026-11-06T12:10:00Z", "event_end": "2026-11-06T12:00:00Z"},
        {"event_start": "2026-11-06T12:00:00", "event_end": "2026-11-06T12:10:00Z"},
    ],
)
@pytest.mark.parametrize(
    "handler", [scheduler.create_scheduled_observation, scheduler.update_scheduled_observation]
)
async def test_invalid_pass_is_reported_without_opening_database(monkeypatch, pass_data, handler):
    database = Mock(side_effect=AssertionError("Invalid passes must not reach the database"))
    monkeypatch.setattr(scheduler, "AsyncSessionLocal", database)

    result = await handler(None, {"id": "obs-1", "pass": pass_data}, Mock(), "client")

    assert result["success"] is False
    assert result["error"]
    assert "pass" in result["error"].lower()
    database.assert_not_called()


def test_missing_pass_is_reported():
    assert validate_observation_pass({}) == {
        "success": False,
        "error": "Select a pass before saving the observation.",
    }


@pytest.mark.parametrize("offset", ["Z", "+00:00", "+02:00"])
def test_valid_pass_is_accepted(offset):
    assert validate_observation_pass(
        {
            "pass": {
                "event_start": f"2026-11-06T12:00:00{offset}",
                "event_end": f"2026-11-06T12:10:00{offset}",
            }
        }
    ) == {"success": True, "error": None}
