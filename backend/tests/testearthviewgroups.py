"""Earth view shortcut preferences persist across edits and orbital synchronization."""

import logging
import sqlite3
import uuid
from contextlib import asynccontextmanager

import pytest
from sqlalchemy import select

from alembic import command
from crud.orbitalsources import add_orbital_source, edit_orbital_source, fetch_orbital_source
from db import migrations
from db.models import Groups, SatelliteGroupType
from handlers.entities import groups
from tlesync.utils import update_satellite_group_with_removal_detection

LOGGER = logging.getLogger(__name__)


def test_visibility_migration_preserves_existing_groups_and_sources(monkeypatch, tmp_path):
    db_path = tmp_path / "earthview.db"
    monkeypatch.setenv("GS_DB", str(db_path))
    config = migrations.get_alembic_config()
    command.upgrade(config, "a7c9e1b3d5f8")
    with sqlite3.connect(db_path) as connection:
        connection.execute(
            """INSERT INTO groups (id, name, type, added, updated)
               VALUES (?, 'Existing group', 'USER', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)""",
            (uuid.uuid4().hex,),
        )
        connection.execute(
            """INSERT INTO orbital_sources (id, name, identifier, url, format, added, updated)
               VALUES (?, 'Existing source', 'existing', 'https://example.test/orbits.txt',
                       '3le', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)""",
            (uuid.uuid4().hex,),
        )

    command.upgrade(config, "head")
    with sqlite3.connect(db_path) as connection:
        for table in ("groups", "orbital_sources"):
            assert connection.execute(f"SELECT show_on_earth_view FROM {table}").fetchall() == [
                (1,)
            ]

    command.downgrade(config, "a7c9e1b3d5f8")
    with sqlite3.connect(db_path) as connection:
        for table in ("groups", "orbital_sources"):
            assert "show_on_earth_view" not in {
                row[1] for row in connection.execute(f"PRAGMA table_info({table})")
            }
            assert connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone() == (1,)


@pytest.mark.asyncio
async def test_user_group_visibility_can_be_saved_without_changing_members(db_session, monkeypatch):
    @asynccontextmanager
    async def session_context():
        yield db_session

    monkeypatch.setattr(groups, "AsyncSessionLocal", session_context)
    result = await groups.submit_satellite_group(
        None,
        {"name": "My satellites", "satellite_ids": [25544], "show_on_earth_view": False},
        LOGGER,
        "test",
    )
    assert result["success"] is True
    group = result["data"][0]
    assert group["show_on_earth_view"] is False

    result = await groups.edit_satellite_group(
        None, {"id": group["id"], "show_on_earth_view": True}, LOGGER, "test"
    )
    assert result["success"] is True
    assert result["data"][0]["show_on_earth_view"] is True
    assert result["data"][0]["satellite_ids"] == [25544]

    result = await groups.edit_satellite_group(
        None, {"id": group["id"], "show_on_earth_view": False}, LOGGER, "test"
    )
    assert result["success"] is True
    result = await groups.edit_satellite_group(
        None, {"id": group["id"], "name": "Renamed"}, LOGGER, "test"
    )
    assert result["success"] is True
    assert result["data"][0]["show_on_earth_view"] is False


@pytest.mark.asyncio
async def test_source_visibility_applies_before_and_after_group_sync(db_session):
    result = await add_orbital_source(
        db_session,
        {"name": "Source", "url": "https://example.test/orbits.txt", "show_on_earth_view": False},
    )
    assert result["success"] is True
    source = result["data"]
    assert source["show_on_earth_view"] is False

    async def sync_group():
        current = (await fetch_orbital_source(db_session, source["id"]))["data"]
        await update_satellite_group_with_removal_detection(
            db_session,
            current["identifier"],
            [],
            current["name"],
            LOGGER,
            show_on_earth_view=current["show_on_earth_view"],
        )
        await db_session.commit()
        return await db_session.scalar(
            select(Groups).where(
                Groups.identifier == source["identifier"], Groups.type == SatelliteGroupType.SYSTEM
            )
        )

    group = await sync_group()
    assert group.show_on_earth_view is False
    group_id = group.id

    for visible in (True, False):
        result = await edit_orbital_source(
            db_session, source["id"], {"show_on_earth_view": visible}
        )
        assert result["success"] is True
        await db_session.refresh(group)
        # Source edits affect an existing group before another sync runs.
        assert group.show_on_earth_view is visible
        group = await sync_group()
        assert group.id == group_id
        assert group.show_on_earth_view is visible

    result = await edit_orbital_source(db_session, source["id"], {"name": "Renamed source"})
    assert result["success"] is True
    assert result["data"]["show_on_earth_view"] is False


@pytest.mark.asyncio
async def test_new_groups_and_sources_default_to_visible(db_session):
    result = await add_orbital_source(
        db_session, {"name": "Default source", "url": "https://example.test/orbits.txt"}
    )
    assert result["success"] is True
    assert result["data"]["show_on_earth_view"] is True

    group = Groups(name="Default group")
    db_session.add(group)
    await db_session.commit()
    assert group.show_on_earth_view is True
