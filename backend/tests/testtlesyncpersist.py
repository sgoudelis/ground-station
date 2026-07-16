# Copyright (c) 2025 Efstratios Goudelis
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU General Public License for more details.
#
# You should have received a copy of the GNU General Public License
# along with this program. If not, see <https://www.gnu.org/licenses/>.

import pytest

from tlesync.persist import (
    is_terminal_orbital_sync_state,
    load_orbital_sync_state,
    save_orbital_sync_state,
    should_hydrate_orbital_sync_state,
)


@pytest.mark.asyncio
class TestTleSyncPersist:
    async def test_save_and_load_orbital_sync_state(self, db_session):
        state = {
            "status": "complete",
            "progress": 100,
            "success": True,
            "message": "Sync complete",
            "last_update": "2026-01-01T00:00:00+00:00",
            "active_sources": [],
            "completed_sources": ["Database Update"],
            "errors": [],
            "stats": {
                "satellites_processed": 1,
                "transmitters_processed": 2,
                "groups_processed": 3,
            },
            "newly_added": {"satellites": [], "transmitters": []},
            "removed": {"satellites": [], "transmitters": []},
            "modified": {"satellites": [], "transmitters": []},
        }

        assert await save_orbital_sync_state(db_session, state) is True

        loaded = await load_orbital_sync_state(db_session)
        assert loaded is not None
        assert loaded["status"] == "complete"
        assert loaded["success"] is True
        assert loaded["stats"]["transmitters_processed"] == 2

    async def test_save_overwrites_previous_snapshot(self, db_session):
        first_state = {"status": "complete", "progress": 100, "success": True}
        second_state = {"status": "complete", "progress": 100, "success": False, "errors": ["x"]}

        assert await save_orbital_sync_state(db_session, first_state) is True
        assert await save_orbital_sync_state(db_session, second_state) is True

        loaded = await load_orbital_sync_state(db_session)
        assert loaded is not None
        assert loaded["success"] is False
        assert loaded["errors"] == ["x"]

    async def test_load_returns_none_when_snapshot_missing(self, db_session):
        loaded = await load_orbital_sync_state(db_session)
        assert loaded is None

    async def test_state_helpers(self):
        assert is_terminal_orbital_sync_state({"status": "complete"}) is True
        assert is_terminal_orbital_sync_state({"status": "inprogress"}) is False
        assert should_hydrate_orbital_sync_state(None) is True
        assert should_hydrate_orbital_sync_state(
            {"status": "idle", "message": "", "last_update": None}
        )
        assert (
            should_hydrate_orbital_sync_state(
                {
                    "status": "complete",
                    "message": "done",
                    "last_update": "2026-01-01T00:00:00+00:00",
                }
            )
            is False
        )
