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

import logging

import pytest

from handlers.entities import orbitalsources
from tlesync.state import sync_state_manager


@pytest.mark.asyncio
async def test_fetch_sync_state_includes_next_scheduled_sync(monkeypatch):
    """API payload should include runtime scheduler metadata for UI display."""
    sync_state_manager.reset()
    sync_state_manager.update(status="idle", progress=0, message="")

    monkeypatch.setattr(orbitalsources, "should_hydrate_orbital_sync_state", lambda _: False)
    monkeypatch.setattr(
        orbitalsources,
        "get_orbital_sync_next_run_time",
        lambda: "2026-06-29T10:00:00+00:00",
    )

    response = await orbitalsources.fetch_sync_state(
        sio=None,
        data=None,
        logger=logging.getLogger(__name__),
        sid="test",
    )

    assert response["success"] is True
    assert response["data"]["next_scheduled_sync_at"] == "2026-06-29T10:00:00+00:00"
    assert response["data"]["status"] == "idle"
    sync_state_manager.reset()


@pytest.mark.asyncio
async def test_fetch_sync_state_keeps_scheduler_metadata_out_of_runtime_state(monkeypatch):
    """
    Scheduler-derived next-run metadata is returned to clients but should remain
    out of persisted/runtime sync_state_manager state.
    """
    sync_state_manager.reset()
    sync_state_manager.update(status="complete", progress=100, success=True)

    monkeypatch.setattr(orbitalsources, "should_hydrate_orbital_sync_state", lambda _: False)
    monkeypatch.setattr(
        orbitalsources,
        "get_orbital_sync_next_run_time",
        lambda: "2026-06-30T10:00:00+00:00",
    )

    response = await orbitalsources.fetch_sync_state(
        sio=None,
        data=None,
        logger=logging.getLogger(__name__),
        sid="test",
    )

    assert response["data"]["next_scheduled_sync_at"] == "2026-06-30T10:00:00+00:00"
    assert "next_scheduled_sync_at" not in sync_state_manager.get_state()
    sync_state_manager.reset()
