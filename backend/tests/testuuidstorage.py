"""UUID text storage must survive upgrades without changing device references."""

import json
import uuid
from datetime import datetime, timezone

import pytest
import sqlalchemy as sa
from sqlalchemy.exc import IntegrityError

from alembic import command, op
from alembic.operations import Operations
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory
from db import migrations
from db.models import (
    ApiTokens,
    AuthSessions,
    Cameras,
    CameraType,
    Groups,
    Locations,
    MonitoredSatellites,
    OrbitalSources,
    OrbitalSourceSyncState,
    Preferences,
    Rigs,
    Rotators,
    SatelliteOrbits,
    Satellites,
    ScheduledObservations,
    SDRs,
    TrackingState,
    Users,
)

PARENT_REVISION = "e5f7a9b2c4d6"
UUID_REVISION = "f6a8b1c3d5e7"
# Freeze expectations at this revision, independently of newer ORM tables and columns.
UUID_COLUMNS = {
    "satellite_orbits": ("source_id",),
    "rigs": ("id",),
    "sdrs": ("id",),
    "rotators": ("id",),
    "locations": ("id",),
    "preferences": ("id", "user_id"),
    "orbital_sources": ("id", "group_id"),
    "orbital_source_sync_states": ("source_id",),
    "groups": ("id",),
    "tracking_state": ("id",),
    "cameras": ("id",),
    "monitored_satellites": ("sdr_id", "rotator_id", "rig_id"),
    "scheduled_observations": ("sdr_id", "rotator_id", "rig_id"),
    "users": ("id", "created_by_user_id", "updated_by_user_id"),
    "auth_sessions": ("id", "user_id"),
    "api_tokens": ("id", "user_id"),
}
NUMERIC_ID = uuid.UUID("12345678-1234-4234-8234-123456789012")
LEGACY_ID = uuid.UUID("abcdef00-0000-4000-8000-000000000001")


@pytest.fixture
def legacy_database(monkeypatch, tmp_path):
    path = tmp_path / "legacy-uuids.db"
    monkeypatch.setenv("GS_DB", str(path))
    config = migrations.get_alembic_config()
    command.upgrade(config, PARENT_REVISION)
    engine = sa.create_engine(f"sqlite:///{path}")
    now = datetime.now(timezone.utc)
    # Exercise every migrated table, including cascade and self-referencing FKs.
    rows = [
        (
            Users,
            dict(
                id=LEGACY_ID,
                username="operator",
                username_norm="operator",
                password_hash="test-hash",
                created_by_user_id=LEGACY_ID,
            ),
        ),
        (
            AuthSessions,
            dict(id=LEGACY_ID, user_id=LEGACY_ID, token_hash="session-hash", expires_at=now),
        ),
        (
            ApiTokens,
            dict(id=LEGACY_ID, user_id=LEGACY_ID, name="Test", token_hash="token-hash", scopes=[]),
        ),
        (
            Preferences,
            dict(id=LEGACY_ID, user_id=LEGACY_ID, scope="user", name="theme", value="dark"),
        ),
        (Groups, dict(id=LEGACY_ID, name="Stations", identifier="stations", satellite_ids=[25544])),
        (
            OrbitalSources,
            dict(
                id=LEGACY_ID,
                group_id=LEGACY_ID,
                name="Stations",
                identifier="stations",
                url="https://example.com/stations.csv",
            ),
        ),
        (OrbitalSourceSyncState, dict(source_id=LEGACY_ID)),
        (Satellites, dict(norad_id=25544, name="ISS")),
        (
            SatelliteOrbits,
            dict(satellite_norad_id=25544, source_id=LEGACY_ID, tle1="line 1", tle2="line 2"),
        ),
        (
            Rigs,
            dict(
                id=LEGACY_ID, name="Rig", host="localhost", port=4532, radiotype="hamlib", vfotype=0
            ),
        ),
        (SDRs, dict(id=LEGACY_ID, name="SDR")),
        (
            Rotators,
            dict(
                id=LEGACY_ID,
                name="Rotator",
                host="localhost",
                port=4533,
                minaz=0,
                maxaz=360,
                minel=0,
                maxel=90,
                stop_supported=False,
            ),
        ),
        (Locations, dict(id=LEGACY_ID, name="Station", lat=1.0, lon=2.0, alt=3)),
        (
            Cameras,
            dict(
                id=LEGACY_ID, name="Camera", type=CameraType.MJPEG, url="https://example.com/camera"
            ),
        ),
        (TrackingState, dict(id=LEGACY_ID, name="tracking-state-target-1", value={})),
        (
            MonitoredSatellites,
            dict(
                id="monitor-1",
                norad_id=25544,
                sdr_id=LEGACY_ID,
                rotator_id=LEGACY_ID,
                rig_id=LEGACY_ID,
                satellite_config={},
                hardware_config={},
                generation_config={},
                sessions=[],
            ),
        ),
        (
            ScheduledObservations,
            dict(
                id="observation-1",
                name="Pass",
                norad_id=25544,
                sdr_id=LEGACY_ID,
                rotator_id=LEGACY_ID,
                rig_id=LEGACY_ID,
                monitored_satellite_id="monitor-1",
                event_start=now,
                event_end=now,
                satellite_config={},
                pass_config={},
                hardware_config={},
                sessions=[],
            ),
        ),
    ]
    try:
        with engine.begin() as connection:
            for model, values in rows:
                connection.execute(model.__table__.insert().values(**values))
        yield engine, config
    finally:
        engine.dispose()


def _snapshot(connection):
    inspector = sa.inspect(connection)

    def constraints(items):
        # Reflected partial-index predicates are fresh SQL expression objects.
        return sorted(json.loads(json.dumps(items, default=str)), key=lambda item: str(item))

    return {
        table: {
            "rows": connection.exec_driver_sql(f'SELECT * FROM "{table}"').all(),
            "indexes": constraints(inspector.get_indexes(table)),
            "unique": constraints(inspector.get_unique_constraints(table)),
            "checks": constraints(inspector.get_check_constraints(table)),
            "foreign_keys": constraints(inspector.get_foreign_keys(table)),
            "primary_key": inspector.get_pk_constraint(table),
        }
        for table in inspector.get_table_names()
    }


def _upgrade(connection, config):
    revision = ScriptDirectory.from_config(config).get_revision(UUID_REVISION)
    context = MigrationContext.configure(connection)
    with Operations.context(context), context.begin_transaction():
        revision.module.upgrade()


@pytest.mark.parametrize("foreign_keys", [False, True])
def test_uuid_migration_preserves_rows_constraints_and_hardware_references(
    legacy_database, foreign_keys
):
    engine, config = legacy_database
    with engine.connect() as connection:
        connection.exec_driver_sql(f"PRAGMA foreign_keys = {int(foreign_keys)}")
        before = _snapshot(connection)
        assert connection.exec_driver_sql("PRAGMA foreign_key_check").all() == []
        connection.commit()

        _upgrade(connection, config)

        assert connection.exec_driver_sql("PRAGMA foreign_keys").scalar_one() == int(foreign_keys)
        assert _snapshot(connection) == before
        assert connection.exec_driver_sql("PRAGMA foreign_key_check").all() == []
        # Cover every UUID PK and FK, even nullable columns without seeded data.
        inspector = sa.inspect(connection)
        for table_name, columns in UUID_COLUMNS.items():
            types = {column["name"]: column["type"] for column in inspector.get_columns(table_name)}
            for column_name in columns:
                assert isinstance(types[column_name], sa.CHAR), f"{table_name}.{column_name}"

        for model in (Rotators, Rigs):
            values = dict(connection.execute(sa.select(model.__table__)).mappings().one())
            values["id"] = NUMERIC_ID
            connection.execute(model.__table__.insert().values(**values))
            assert (
                connection.scalar(sa.select(model.id).where(model.id == NUMERIC_ID)) == NUMERIC_ID
            )
        connection.execute(
            sa.update(ScheduledObservations).values(rotator_id=NUMERIC_ID, rig_id=NUMERIC_ID)
        )
        assert connection.execute(
            sa.select(ScheduledObservations.rotator_id, ScheduledObservations.rig_id)
        ).one() == (NUMERIC_ID, NUMERIC_ID)
        assert connection.exec_driver_sql(
            "SELECT typeof(rotator_id), typeof(rig_id) FROM scheduled_observations"
        ).one() == ("text", "text")

        with pytest.raises(IntegrityError), connection.begin_nested():
            connection.execute(sa.update(Users).values(role="invalid-role"))


def test_uuid_migration_rejects_already_corrupted_ids_before_schema_changes(legacy_database):
    engine, config = legacy_database
    with engine.connect() as connection:
        connection.exec_driver_sql("PRAGMA foreign_keys = ON")
        connection.execute(
            Groups.__table__.insert().values(
                id=NUMERIC_ID, name="Corrupted", identifier="corrupted"
            )
        )
        connection.commit()
        assert (
            connection.exec_driver_sql(
                "SELECT typeof(id) FROM groups WHERE identifier = 'corrupted'"
            ).scalar_one()
            == "real"
        )
        before = _snapshot(connection)
        connection.commit()

        with pytest.raises(
            RuntimeError, match=r"groups\.id: SQLite already stored a UUID as a number"
        ):
            _upgrade(connection, config)

        assert connection.exec_driver_sql("PRAGMA foreign_keys").scalar_one() == 1
        assert _snapshot(connection) == before


def test_uuid_migration_rolls_back_table_rebuilds_on_failure(legacy_database, monkeypatch):
    engine, config = legacy_database
    batch_alter_table = op.batch_alter_table

    def fail_after_first_table(table_name, *args, **kwargs):
        if table_name == "rigs":
            raise RuntimeError("Injected table rebuild failure")
        return batch_alter_table(table_name, *args, **kwargs)

    monkeypatch.setattr(op, "batch_alter_table", fail_after_first_table)
    with engine.connect() as connection:
        connection.exec_driver_sql("PRAGMA foreign_keys = ON")
        before = _snapshot(connection)
        schema = connection.exec_driver_sql(
            "SELECT name, sql FROM sqlite_master ORDER BY name"
        ).all()
        connection.commit()

        with pytest.raises(RuntimeError, match="Injected table rebuild failure"):
            _upgrade(connection, config)

        assert connection.exec_driver_sql("PRAGMA foreign_keys").scalar_one() == 1
        assert _snapshot(connection) == before
        assert (
            connection.exec_driver_sql("SELECT name, sql FROM sqlite_master ORDER BY name").all()
            == schema
        )
