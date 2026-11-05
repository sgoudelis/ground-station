"""Satellite removal must clean up orbits without relying on SQLite cascades."""

import logging
import uuid

import pytest
import pytest_asyncio
from sqlalchemy import select, update
from sqlalchemy.sql.dml import Delete

from crud.satellites import delete_satellite
from crud.tlesources import delete_satellite_tle_sources
from db.models import (
    Groups,
    OrbitalSources,
    OrbitalSourceSyncState,
    SatelliteGroupType,
    SatelliteOrbits,
    Satellites,
    Transmitters,
)
from tlesync.utils import update_satellite_group_with_removal_detection

TARGET_ID = 67290
OTHER_ID = 25544
LOGGER = logging.getLogger(__name__)


@pytest_asyncio.fixture(params=[False, True], ids=["foreign-keys-off", "foreign-keys-on"])
async def satellite_catalog(db_engine, db_session, request):
    # Test the deployed SQLite configuration as well as enforced foreign keys.
    async with db_engine.connect() as connection:
        await connection.exec_driver_sql(f"PRAGMA foreign_keys = {int(request.param)}")
        enabled = await connection.exec_driver_sql("PRAGMA foreign_keys")
        assert enabled.scalar_one() == int(request.param)

    db_session.add_all(
        [
            Satellites(norad_id=TARGET_ID, name="SAKHACUBE-CHOLBON", source="tlesync"),
            Satellites(norad_id=OTHER_ID, name="ISS", source="tlesync"),
        ]
    )
    # Insert parents first so the fixture also works with foreign keys enabled.
    await db_session.flush()
    db_session.add_all(
        [
            SatelliteOrbits(
                satellite_norad_id=TARGET_ID,
                central_body="earth",
                model_kind="tle",
                tle1="1 67290U 25313AU  26273.48817398  .00005070  00000-0  19662-3 0  9995",
                tle2="2 67290  97.3838 347.2777 0008389 354.0988   6.0151 15.26542203 42038",
            ),
            *[
                SatelliteOrbits(
                    satellite_norad_id=TARGET_ID,
                    central_body=body,
                    model_kind="omm",
                    omm_payload={"NORAD_CAT_ID": TARGET_ID},
                )
                for body in ("moon", "mars")
            ],
            SatelliteOrbits(
                satellite_norad_id=OTHER_ID,
                central_body="earth",
                model_kind="omm",
                omm_payload={"NORAD_CAT_ID": OTHER_ID},
            ),
            Transmitters(id="target-transmitter", norad_cat_id=TARGET_ID, status="active"),
            Transmitters(id="other-transmitter", norad_cat_id=OTHER_ID, status="active"),
            Groups(
                name="Amateur",
                identifier="amateur",
                type=SatelliteGroupType.SYSTEM,
                satellite_ids=[TARGET_ID, OTHER_ID],
            ),
        ]
    )
    await db_session.commit()
    db_session.expunge_all()
    return db_session


async def _remove_satellite(session, deletion_path):
    if deletion_path == "manual":
        result = await delete_satellite(session, TARGET_ID)
        assert result["success"] is True
    else:
        result = await update_satellite_group_with_removal_detection(
            session, "amateur", [OTHER_ID], "Amateur", LOGGER
        )
        assert [satellite["norad_id"] for satellite in result["satellites"]] == [TARGET_ID]
        await session.commit()


async def _catalog_snapshot(session):
    """Read persisted rows, including group membership, without the ORM identity cache."""
    return {
        "satellites": list(
            (await session.scalars(select(Satellites.norad_id).order_by(Satellites.norad_id))).all()
        ),
        "orbits": (
            await session.execute(
                select(SatelliteOrbits.satellite_norad_id, SatelliteOrbits.central_body).order_by(
                    SatelliteOrbits.satellite_norad_id, SatelliteOrbits.central_body
                )
            )
        ).all(),
        "transmitters": list(
            (await session.scalars(select(Transmitters.id).order_by(Transmitters.id))).all()
        ),
        "groups": (
            await session.execute(
                select(Groups.identifier, Groups.satellite_ids).order_by(Groups.identifier)
            )
        ).all(),
    }


@pytest.mark.unit
@pytest.mark.parametrize("deletion_path", ["manual", "sync"])
async def test_removal_deletes_all_orbits_and_preserves_other_satellites(
    satellite_catalog, deletion_path
):
    session = satellite_catalog

    await _remove_satellite(session, deletion_path)

    assert await _catalog_snapshot(session) == {
        "satellites": [OTHER_ID],
        "orbits": [(OTHER_ID, "earth")],
        "transmitters": ["other-transmitter"],
        "groups": [("amateur", [OTHER_ID])],
    }


@pytest.mark.unit
async def test_sync_preserves_orbits_when_another_source_still_contains_satellite(
    satellite_catalog,
):
    session = satellite_catalog
    session.add(
        Groups(
            name="Active",
            identifier="active",
            type=SatelliteGroupType.SYSTEM,
            satellite_ids=[TARGET_ID],
        )
    )
    await session.commit()
    before = await _catalog_snapshot(session)

    removed = await update_satellite_group_with_removal_detection(
        session, "amateur", [OTHER_ID], "Amateur", LOGGER
    )
    await session.commit()

    assert removed == {"satellites": [], "transmitters": []}
    before["groups"] = [("active", [TARGET_ID]), ("amateur", [OTHER_ID])]
    assert await _catalog_snapshot(session) == before


@pytest_asyncio.fixture
async def source_catalog(satellite_catalog):
    session = satellite_catalog
    group = await session.scalar(select(Groups).where(Groups.identifier == "amateur"))
    group.satellite_ids = [TARGET_ID]
    source_id = uuid.uuid4()
    session.add(
        OrbitalSources(
            id=source_id,
            name="Amateur",
            identifier="amateur",
            url="https://example.com/amateur.csv",
            group_id=group.id,
        )
    )
    await session.flush()
    # A retained satellite can still have orbit data last supplied by this source.
    await session.execute(update(SatelliteOrbits).values(source_id=source_id))
    await session.commit()
    session.expunge_all()
    return session, source_id


@pytest.mark.unit
async def test_source_deletion_removes_member_orbits_and_detaches_retained_orbits(source_catalog):
    session, source_id = source_catalog

    result = await delete_satellite_tle_sources(session, [str(source_id)])

    assert result["success"] is True
    assert result["deletion_summary"][0]["satellites_deleted"] == 1
    assert await _catalog_snapshot(session) == {
        "satellites": [OTHER_ID],
        "orbits": [(OTHER_ID, "earth")],
        "transmitters": ["other-transmitter"],
        "groups": [],
    }
    assert (await session.scalars(select(OrbitalSources.id))).all() == []
    assert (await session.scalars(select(SatelliteOrbits.source_id))).all() == [None]


async def _add_source(session, identifier, satellite_ids, *, enabled=True):
    group = Groups(
        name=identifier,
        identifier=identifier,
        type=SatelliteGroupType.SYSTEM,
        satellite_ids=satellite_ids,
    )
    session.add(group)
    await session.flush()
    source = OrbitalSources(
        name=identifier,
        identifier=identifier,
        url=f"https://example.com/{identifier}.csv",
        group_id=group.id,
        enabled=enabled,
    )
    session.add(source)
    await session.flush()
    return source.id


@pytest.mark.unit
@pytest.mark.parametrize("remaining_enabled", [False, True])
async def test_source_deletion_preserves_shared_satellites_and_user_groups(
    source_catalog, remaining_enabled
):
    session, source_id = source_catalog
    other_source_id = await _add_source(
        session, "active", f'["{TARGET_ID}", {OTHER_ID}]', enabled=remaining_enabled
    )
    # A user group with the same identifier must not be mistaken for the source's group.
    session.add(
        Groups(
            name="Favorites",
            identifier="amateur",
            type=SatelliteGroupType.USER,
            satellite_ids=[TARGET_ID],
        )
    )
    session.add(OrbitalSourceSyncState(source_id=source_id))
    await session.commit()
    before = await _catalog_snapshot(session)
    orbit_data = (
        await session.execute(
            select(
                SatelliteOrbits.tle1, SatelliteOrbits.tle2, SatelliteOrbits.omm_payload
            ).order_by(SatelliteOrbits.satellite_norad_id, SatelliteOrbits.central_body)
        )
    ).all()

    result = await delete_satellite_tle_sources(session, [str(source_id)])

    assert result["success"] is True
    assert result["deletion_summary"][0]["satellites_deleted"] == 0
    assert result["deletion_summary"][0]["transmitters_deleted"] == 0
    after = await _catalog_snapshot(session)
    assert {key: value for key, value in after.items() if key != "groups"} == {
        key: value for key, value in before.items() if key != "groups"
    }
    assert after["groups"] == [("active", [str(TARGET_ID), OTHER_ID]), ("amateur", [TARGET_ID])]
    assert (await session.scalars(select(OrbitalSources.id))).all() == [other_source_id]
    assert (await session.scalars(select(OrbitalSourceSyncState.source_id))).all() == []
    assert (await session.scalars(select(SatelliteOrbits.source_id))).all() == [None] * 4
    assert (
        await session.execute(
            select(
                SatelliteOrbits.tle1, SatelliteOrbits.tle2, SatelliteOrbits.omm_payload
            ).order_by(SatelliteOrbits.satellite_norad_id, SatelliteOrbits.central_body)
        )
    ).all() == orbit_data


@pytest.mark.unit
@pytest.mark.parametrize("keep_third_source", [False, True])
@pytest.mark.parametrize("reverse_selection", [False, True])
async def test_batch_source_deletion_only_protects_members_of_sources_that_remain(
    source_catalog, keep_third_source, reverse_selection
):
    session, first_source_id = source_catalog
    group = await session.scalar(select(Groups).where(Groups.identifier == "amateur"))
    group.satellite_ids = f'["{TARGET_ID}", "{OTHER_ID}"]'
    second_source_id = await _add_source(session, "active", [TARGET_ID, OTHER_ID])
    if keep_third_source:
        await _add_source(session, "stations", [OTHER_ID])
    # A stale system group without a source cannot keep satellites alive.
    session.add(
        Groups(
            name="Removed source",
            identifier="removed-source",
            type=SatelliteGroupType.SYSTEM,
            satellite_ids=[TARGET_ID],
        )
    )
    await session.commit()
    selected_ids = [str(first_source_id), str(second_source_id)]

    result = await delete_satellite_tle_sources(
        session, selected_ids[::-1] if reverse_selection else selected_ids
    )

    assert result["success"] is True
    deleted_count = 1 if keep_third_source else 2
    assert sum(item["satellites_deleted"] for item in result["deletion_summary"]) == deleted_count
    assert sum(item["transmitters_deleted"] for item in result["deletion_summary"]) == deleted_count
    assert all(item["group_deleted"] for item in result["deletion_summary"])
    expected_groups = [("removed-source", [TARGET_ID])]
    if keep_third_source:
        expected_groups.append(("stations", [OTHER_ID]))
    assert await _catalog_snapshot(session) == {
        "satellites": [OTHER_ID] if keep_third_source else [],
        "orbits": [(OTHER_ID, "earth")] if keep_third_source else [],
        "transmitters": ["other-transmitter"] if keep_third_source else [],
        "groups": expected_groups,
    }


@pytest.mark.unit
@pytest.mark.parametrize(
    "retained_id",
    [
        uuid.UUID("12345678-1234-4234-8234-123456789012"),
        uuid.UUID("12345678-1234-4234-8234-123456789e12"),
        uuid.UUID("00000000-0000-4000-8000-000000000001"),
    ],
)
async def test_source_deletion_preserves_groups_with_numeric_looking_uuids(
    source_catalog, retained_id
):
    session, source_id = source_catalog
    group = Groups(
        id=retained_id,
        name="Stations",
        identifier="stations",
        type=SatelliteGroupType.SYSTEM,
        satellite_ids=[TARGET_ID, OTHER_ID],
    )
    session.add(group)
    await session.flush()
    session.add(
        OrbitalSources(
            id=retained_id,
            name="Stations",
            identifier="stations",
            url="https://example.com/stations.csv",
            group_id=retained_id,
        )
    )
    await session.commit()
    # Force UUID decoding from SQLite instead of using cached Python objects.
    session.expunge_all()

    result = await delete_satellite_tle_sources(session, [str(source_id)])

    assert result["success"] is True
    assert result["deletion_summary"][0]["satellites_deleted"] == 0
    assert await _catalog_snapshot(session) == {
        "satellites": [OTHER_ID, TARGET_ID],
        "orbits": [
            (OTHER_ID, "earth"),
            (TARGET_ID, "earth"),
            (TARGET_ID, "mars"),
            (TARGET_ID, "moon"),
        ],
        "transmitters": ["other-transmitter", "target-transmitter"],
        "groups": [("stations", [TARGET_ID, OTHER_ID])],
    }
    assert await session.scalar(select(Groups.id)) == retained_id
    source = await session.scalar(select(OrbitalSources))
    assert source.id == source.group_id == retained_id


@pytest.mark.unit
async def test_batch_source_deletion_rolls_back_all_selected_sources_on_failure(
    source_catalog, monkeypatch
):
    session, first_source_id = source_catalog
    second_source_id = await _add_source(session, "active", [TARGET_ID, OTHER_ID])
    session.add_all(
        [
            OrbitalSourceSyncState(source_id=first_source_id),
            OrbitalSourceSyncState(source_id=second_source_id),
        ]
    )
    await session.commit()
    before = await _catalog_snapshot(session)
    delete = session.delete
    deleted_sources = 0

    async def fail_second_source(instance):
        nonlocal deleted_sources
        if isinstance(instance, OrbitalSources):
            deleted_sources += 1
            if deleted_sources == 2:
                raise RuntimeError("Second source deletion failed")
        await delete(instance)

    monkeypatch.setattr(session, "delete", fail_second_source)

    result = await delete_satellite_tle_sources(
        session, [str(first_source_id), str(second_source_id)]
    )

    assert result["success"] is False
    assert result["error"] == "Second source deletion failed"
    assert await _catalog_snapshot(session) == before
    assert set((await session.scalars(select(OrbitalSources.id))).all()) == {
        first_source_id,
        second_source_id,
    }
    assert set((await session.scalars(select(OrbitalSourceSyncState.source_id))).all()) == {
        first_source_id,
        second_source_id,
    }


@pytest.mark.unit
async def test_source_deletion_rolls_back_orbit_cleanup_if_commit_fails(
    source_catalog, monkeypatch
):
    session, source_id = source_catalog
    before = await _catalog_snapshot(session)

    async def fail_commit():
        raise RuntimeError("Source deletion failed")

    monkeypatch.setattr(session, "commit", fail_commit)

    result = await delete_satellite_tle_sources(session, [str(source_id)])

    assert result["success"] is False
    assert result["error"] == "Source deletion failed"
    assert await _catalog_snapshot(session) == before
    assert (await session.scalars(select(OrbitalSources.id))).all() == [source_id]
    assert (await session.scalars(select(SatelliteOrbits.source_id))).all() == [source_id] * 4


@pytest.mark.unit
@pytest.mark.parametrize("deletion_path", ["manual", "sync"])
async def test_removal_rolls_back_orbit_cleanup_if_satellite_deletion_fails(
    satellite_catalog, deletion_path, monkeypatch
):
    session = satellite_catalog
    before = await _catalog_snapshot(session)
    execute = session.execute

    async def fail_satellite_deletion(statement, *args, **kwargs):
        if isinstance(statement, Delete) and statement.table.name == "satellites":
            raise RuntimeError("Satellite deletion failed")
        return await execute(statement, *args, **kwargs)

    monkeypatch.setattr(session, "execute", fail_satellite_deletion)

    if deletion_path == "manual":
        result = await delete_satellite(session, TARGET_ID)
        assert result["success"] is False
        assert result["error"] == "Satellite deletion failed"
    else:
        with pytest.raises(RuntimeError, match="Satellite deletion failed"):
            await update_satellite_group_with_removal_detection(
                session, "amateur", [OTHER_ID], "Amateur", LOGGER
            )
        # Sync owns its transaction and rolls it back when removal fails.
        await session.rollback()

    assert await _catalog_snapshot(session) == before
