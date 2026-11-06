# Copyright (c) 2026 Efstratios Goudelis
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Unit tests for monitored celestial and satellite CRUD helpers."""

import uuid
from unittest.mock import AsyncMock

import pytest

from crud.monitoredcelestial import (
    add_monitored_celestial,
    delete_monitored_celestial,
    edit_monitored_celestial,
    fetch_monitored_celestial,
    toggle_monitored_celestial_enabled,
    update_monitored_celestial_refresh_state,
)
from crud.monitoredsatellites import (
    add_monitored_satellite,
    delete_generated_observations_for_satellite,
    delete_monitored_satellites,
    edit_monitored_satellite,
    fetch_enabled_monitored_satellites,
    fetch_generated_observations_for_satellite,
    fetch_monitored_satellite_by_norad,
    fetch_monitored_satellites,
    mark_observation_as_generated,
    toggle_monitored_satellite_enabled,
)
from crud.scheduledobservations import add_scheduled_observation
from db.models import Satellites
from observations import generator


async def _add_satellite(db_session, norad_id):
    """Create the foreign-key target required by monitored configurations."""
    db_session.add(Satellites(norad_id=norad_id, name=f"Satellite {norad_id}"))
    await db_session.commit()


def _monitored_satellite_data(norad_id, *, satellite_id=None, enabled=True):
    return {
        "id": satellite_id or str(uuid.uuid4()),
        "enabled": enabled,
        "satellite": {"norad_id": norad_id, "name": f"Satellite {norad_id}", "group_id": "group-a"},
        "rotator": {"id": None, "tracker_id": "runtime-only", "name": "Rotator"},
        "rig": {"id": None, "name": "Rig"},
        "min_elevation": 25,
        "task_start_elevation": 12,
        "lookahead_hours": 48,
        "sessions": [],
    }


def _observation_data(norad_id, *, observation_id=None):
    return {
        "id": observation_id or str(uuid.uuid4()),
        "name": "Generated pass",
        "satellite": {"norad_id": norad_id, "name": f"Satellite {norad_id}"},
        "pass": {
            "event_start": "2026-01-01T12:00:00Z",
            "event_end": "2026-01-01T12:10:00Z",
            "peak_altitude": 55.5,
        },
        "task_start": "2026-01-01T12:02:00Z",
        "task_end": "2026-01-01T12:09:00Z",
        "sessions": [],
    }


@pytest.mark.asyncio
class TestMonitoredCelestialCrud:
    async def test_add_fetch_and_toggle_target(self, db_session):
        added = await add_monitored_celestial(
            db_session,
            {"command": " Voyager 1 ", "displayName": " Voyager ", "enabled": True},
        )

        assert added["success"] is True
        assert added["data"]["target_type"] == "mission"
        assert added["data"]["target_key"] == "mission:voyager_1"
        assert added["data"]["color"] == "#FF6B6B"
        assert added["data"]["projection_past_hours"] == 1
        assert added["data"]["projection_future_hours"] == 24
        assert added["data"]["projection_step_minutes"] == 60

        target_id = added["data"]["id"]
        toggled = await toggle_monitored_celestial_enabled(db_session, target_id, False)
        assert toggled == {
            "success": True,
            "data": {"id": target_id, "enabled": False},
            "error": None,
        }

        enabled = await fetch_monitored_celestial(db_session, enabled_only=True)
        fetched = await fetch_monitored_celestial(db_session, target_id)
        assert enabled["data"] == []
        assert fetched["data"]["enabled"] is False

    @pytest.mark.parametrize(
        ("payload", "error"),
        [
            ({"target_type": "mission"}, "Command is required"),
            ({"target_type": "body"}, "body_id is required"),
            ({"target_type": "unknown", "command": "1"}, "target_type must be either"),
            ({"command": "1", "color": "blue"}, "Color must be a valid hex"),
        ],
    )
    async def test_add_rejects_invalid_target_data(self, db_session, payload, error):
        result = await add_monitored_celestial(db_session, payload)

        assert result["success"] is False
        assert error in result["error"]

    async def test_edit_preserves_identity_and_persists_refresh_state(self, db_session):
        added = await add_monitored_celestial(
            db_session,
            {"command": "Pioneer 10", "display_name": "Pioneer", "color": "#123abc"},
        )
        target_id = added["data"]["id"]

        edited = await edit_monitored_celestial(
            db_session,
            {
                "id": target_id,
                "target_type": "mission",
                "command": "Pioneer 10 Extended",
                "displayName": "Pioneer Extended",
                "color": "#abcdef",
                "projectionPastHours": 12,
                "projectionFutureHours": 72,
                "projectionStepMinutes": 15,
            },
        )
        refreshed = await update_monitored_celestial_refresh_state(
            db_session,
            [
                {
                    "id": target_id,
                    "last_refresh_at": "2026-01-01T12:00:00Z",
                    "last_error": "timeout",
                },
                {},
            ],
        )
        fetched = await fetch_monitored_celestial(db_session, target_id)

        assert edited["success"] is True
        assert edited["data"]["command"] == "Pioneer 10 Extended"
        assert edited["data"]["body_id"] == ""
        assert edited["data"]["target_key"] == "mission:pioneer_10"
        assert edited["data"]["color"] == "#ABCDEF"
        assert edited["data"]["projection_past_hours"] == 12
        assert edited["data"]["projection_future_hours"] == 72
        assert edited["data"]["projection_step_minutes"] == 15
        assert refreshed == {"success": True, "error": None}
        assert fetched["data"]["last_error"] == "timeout"

    async def test_edit_rejects_target_type_changes(self, db_session):
        added = await add_monitored_celestial(db_session, {"command": "Pioneer 10"})

        edited = await edit_monitored_celestial(
            db_session,
            {"id": added["data"]["id"], "target_type": "body", "bodyId": "mars"},
        )

        assert edited["success"] is False
        assert "target_type is immutable" in edited["error"]

    async def test_edit_rejects_invalid_projection_settings(self, db_session):
        added = await add_monitored_celestial(db_session, {"command": "Pioneer 10"})

        edited = await edit_monitored_celestial(
            db_session,
            {
                "id": added["data"]["id"],
                "target_type": "mission",
                "command": "Pioneer 10",
                "projectionStepMinutes": 2,
            },
        )

        assert edited["success"] is False
        assert "projection_step_minutes must be between 5 and 1440" in edited["error"]

    async def test_delete_requires_ids_and_reports_deleted_rows(self, db_session):
        added = await add_monitored_celestial(db_session, {"command": "Voyager 2"})

        missing_ids = await delete_monitored_celestial(db_session, [])
        deleted = await delete_monitored_celestial(db_session, [added["data"]["id"]])

        assert missing_ids["success"] is False
        assert missing_ids["error"] == "IDs are required"
        assert deleted["data"]["deleted"] == 1


@pytest.mark.asyncio
class TestMonitoredSatellitesCrud:
    @pytest.mark.parametrize("dry_run", [False, True])
    @pytest.mark.parametrize("editing", [False, True])
    async def test_disabled_definition_saves_without_generating_observations(
        self, db_session, monkeypatch, dry_run, editing
    ):
        await _add_satellite(db_session, 42004)
        data = _monitored_satellite_data(42004, enabled=editing)
        added = await add_monitored_satellite(db_session, data)
        if editing:
            data["enabled"] = False
            data["lookahead_hours"] = 72
            saved = await edit_monitored_satellite(db_session, data)
        else:
            saved = added
        cleanup = AsyncMock(return_value=0)
        generate = AsyncMock()
        locations = AsyncMock()
        monkeypatch.setattr(generator, "cleanup_old_observations", cleanup)
        monkeypatch.setattr(generator, "_generate_observations_for_satellite", generate)
        monkeypatch.setattr(generator.crud_locations, "fetch_all_locations", locations)

        result = await generator.generate_observations_for_monitored_satellites(
            db_session, saved["data"]["id"], dry_run=dry_run
        )

        assert saved["success"] is True
        assert saved["data"]["enabled"] is False
        assert result["success"] is True
        assert result["data"] == {
            "generated": 0,
            "updated": 0,
            "skipped": 0,
            "satellites_processed": 0,
        }
        generate.assert_not_awaited()
        locations.assert_not_awaited()
        assert (await fetch_generated_observations_for_satellite(db_session, data["id"]))[
            "data"
        ] == []
        fetched = await fetch_monitored_satellites(db_session, data["id"])
        assert fetched["data"]["enabled"] is False
        if editing:
            assert fetched["data"]["lookahead_hours"] == 72

    @pytest.mark.parametrize("targeted", [False, True])
    async def test_enabled_definitions_still_generate(self, db_session, monkeypatch, targeted):
        await _add_satellite(db_session, 42005)
        await _add_satellite(db_session, 42006)
        added = await add_monitored_satellite(db_session, _monitored_satellite_data(42005))
        await add_monitored_satellite(db_session, _monitored_satellite_data(42006, enabled=False))
        generate = AsyncMock(return_value={"generated": 2, "updated": 1, "skipped": 0})
        monkeypatch.setattr(generator, "cleanup_old_observations", AsyncMock(return_value=0))
        monkeypatch.setattr(generator, "_generate_observations_for_satellite", generate)
        monkeypatch.setattr(
            generator.crud_locations,
            "fetch_all_locations",
            AsyncMock(return_value={"success": True, "data": [{"lat": 38, "lon": 23}]}),
        )

        result = await generator.generate_observations_for_monitored_satellites(
            db_session, added["data"]["id"] if targeted else None
        )

        assert result["success"] is True
        assert result["data"] == {
            "generated": 2,
            "updated": 1,
            "skipped": 0,
            "satellites_processed": 1,
        }
        generate.assert_awaited_once()
        assert generate.await_args.args[1]["id"] == added["data"]["id"]

    async def test_add_fetch_toggle_and_edit_configuration(self, db_session):
        await _add_satellite(db_session, 42001)
        data = _monitored_satellite_data(42001)

        added = await add_monitored_satellite(db_session, data)
        assert added["success"] is True
        assert added["data"]["min_elevation"] == 25
        assert "tracker_id" not in added["data"]["rotator"]

        satellite_id = added["data"]["id"]
        toggled = await toggle_monitored_satellite_enabled(db_session, satellite_id, False)
        assert toggled["success"] is True
        assert (await fetch_enabled_monitored_satellites(db_session))["data"] == []

        data.update({"id": satellite_id, "enabled": True, "min_elevation": 35})
        edited = await edit_monitored_satellite(db_session, data)
        fetched = await fetch_monitored_satellite_by_norad(db_session, 42001)
        assert edited["success"] is True
        assert edited["data"]["min_elevation"] == 35
        assert fetched["data"]["id"] == satellite_id

    async def test_generated_observation_helpers_and_cascading_delete(self, db_session):
        await _add_satellite(db_session, 42002)
        monitored = await add_monitored_satellite(db_session, _monitored_satellite_data(42002))
        observation = await add_scheduled_observation(db_session, _observation_data(42002))
        monitored_id = monitored["data"]["id"]
        observation_id = observation["data"]["id"]

        marked = await mark_observation_as_generated(db_session, observation_id, monitored_id)
        generated = await fetch_generated_observations_for_satellite(db_session, monitored_id)
        removed = await delete_generated_observations_for_satellite(db_session, monitored_id)
        deleted = await delete_monitored_satellites(
            db_session, [monitored_id], delete_observations=True
        )

        assert marked["success"] is True
        assert generated["data"] == [observation_id]
        assert removed["data"]["deleted"] == 1
        assert deleted["data"] == {"deleted": 1, "deleted_observations": 0}

    async def test_delete_with_observations_removes_generated_rows(self, db_session):
        await _add_satellite(db_session, 42003)
        monitored = await add_monitored_satellite(db_session, _monitored_satellite_data(42003))
        observation = await add_scheduled_observation(db_session, _observation_data(42003))
        monitored_id = monitored["data"]["id"]
        await mark_observation_as_generated(db_session, observation["data"]["id"], monitored_id)

        deleted = await delete_monitored_satellites(
            db_session, [monitored_id], delete_observations=True
        )
        remaining = await fetch_monitored_satellites(db_session)

        assert deleted["data"] == {"deleted": 1, "deleted_observations": 1}
        assert remaining["data"] == []
