"""Regression tests for pass validation at the scheduler command boundary."""

from unittest.mock import Mock

import pytest

from handlers.entities import scheduler
from observations.validation import validate_observation_pass, validate_transmitter_frequencies

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


@pytest.mark.parametrize("task_type", ["decoder", "audio_recording", "transcription"])
@pytest.mark.parametrize("native", [False, True])
@pytest.mark.parametrize(
    ("bandwidth", "accepted"),
    [(200000, False), (1536000, True), ("auto", True), ("driver", True), (None, True)],
)
def test_task_frequency_respects_manual_if_filter(task_type, native, bandwidth, accepted):
    # Native UHD's explicit controls take precedence over ignored legacy fields.
    settings = (
        {"bandwidth": 200000, "uhd": {"bandwidth": bandwidth}}
        if native
        else {"bandwidth": bandwidth}
    )
    result = validate_transmitter_frequencies(
        {
            "sessions": [
                {
                    "sdr": {
                        "center_frequency": 145000000,
                        "sample_rate": 2048000,
                        "sdr_settings": settings,
                    },
                    "tasks": [{"type": task_type, "config": {"frequency": 145600000}}],
                }
            ]
        }
    )
    assert result["success"] is accepted


@pytest.mark.parametrize("bandwidth", [0, -1, float("nan"), float("inf")])
def test_invalid_manual_if_filter_is_rejected(bandwidth):
    result = validate_transmitter_frequencies(
        {
            "sessions": [
                {
                    "sdr": {
                        "center_frequency": 145000000,
                        "sample_rate": 2048000,
                        "sdr_settings": {"bandwidth": bandwidth},
                    },
                    "tasks": [],
                }
            ]
        }
    )
    assert result["success"] is False
