# Copyright (c) 2026 Efstratios Goudelis

from datetime import datetime, timedelta, timezone

from common.constants import RigStates
from handlers.entities.tracking import (
    _normalize_target_update_payload,
    _normalize_tracker_target_type,
    _pick_active_or_upcoming_pass,
)


def test_mission_target_normalization_preserves_rig_control_fields():
    result = _normalize_target_update_payload(
        {
            "target_type": "mission",
            "command": "Juno",
            "target_name": "Juno",
            "rig_id": "rig-123",
            "rig_state": RigStates.CONNECTED,
            "transmitter_id": "tx-123",
            "rig_vfo": "1",
        }
    )

    assert result["success"] is True
    payload = result["value"]
    assert payload["target_type"] == "mission"
    assert payload["rig_id"] == "rig-123"
    assert payload["rig_state"] == RigStates.CONNECTED
    assert payload["transmitter_id"] == "tx-123"
    assert payload["rig_vfo"] == "1"


def test_body_target_normalization_preserves_rig_control_fields():
    result = _normalize_target_update_payload(
        {
            "target_type": "body",
            "body_id": "JUPITER",
            "target_name": "JUPITER",
            "rig_id": "rig-abc",
            "rig_state": RigStates.TRACKING,
            "transmitter_id": "tx-abc",
            "rig_vfo": "2",
        }
    )

    assert result["success"] is True
    payload = result["value"]
    assert payload["target_type"] == "body"
    assert payload["body_id"] == "jupiter"
    assert payload["rig_id"] == "rig-abc"
    assert payload["rig_state"] == RigStates.TRACKING
    assert payload["transmitter_id"] == "tx-abc"
    assert payload["rig_vfo"] == "2"


def test_tracker_target_type_inference_uses_command_and_body_id():
    assert _normalize_tracker_target_type({"mission_id": "mission:command_id"}) == "mission"
    assert _normalize_tracker_target_type({"command": "Voyager 1"}) == "mission"
    assert _normalize_tracker_target_type({"body_id": "rhea"}) == "body"
    assert _normalize_tracker_target_type({"norad_id": "25544"}) == "satellite"


def test_pick_active_or_upcoming_pass_supports_celestial_peak_elevation_field():
    now = datetime.now(timezone.utc)
    live_pass = {
        "event_start": (now - timedelta(minutes=5)).isoformat(),
        "event_end": (now + timedelta(minutes=5)).isoformat(),
        "peak_elevation_deg": 21.0,
    }
    next_pass = {
        "event_start": (now + timedelta(minutes=20)).isoformat(),
        "event_end": (now + timedelta(minutes=32)).isoformat(),
        "peak_elevation_deg": 43.0,
    }
    active, upcoming = _pick_active_or_upcoming_pass(
        candidate_passes=[live_pass, next_pass],
        now_ms=int(now.timestamp() * 1000),
        min_elevation=10.0,
    )
    assert active == live_pass
    assert upcoming == next_pass
