"""Store UUIDs with text affinity on SQLite.

Revision ID: f6a8b1c3d5e7
Revises: e5f7a9b2c4d6
"""

import sqlalchemy as sa

import alembic.op as op

revision = "f6a8b1c3d5e7"
down_revision = "e5f7a9b2c4d6"
branch_labels = None
depends_on = None

# Keep this historical schema independent of future model changes. References
# must use the same text affinity as their primary keys, including hardware IDs.
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


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "sqlite":
        return

    # SQLite cannot change foreign_keys inside a transaction. Disable it before
    # rebuilding parents so DROP TABLE cannot cascade into children or self-FKs.
    with op.get_context().autocommit_block():
        foreign_keys = bind.exec_driver_sql("PRAGMA foreign_keys").scalar_one()
        bind.exec_driver_sql("PRAGMA foreign_keys = OFF")
        bind.exec_driver_sql("BEGIN IMMEDIATE")
        try:
            # Validate every table before changing any schema. A numeric UUID
            # may already have lost precision; casting it to text cannot repair it.
            for table_name, columns in UUID_COLUMNS.items():
                for column_name in columns:
                    invalid = bind.exec_driver_sql(
                        f'SELECT 1 FROM "{table_name}" '
                        f'WHERE "{column_name}" IS NOT NULL '
                        f"AND typeof(\"{column_name}\") != 'text' LIMIT 1"
                    ).first()
                    if invalid:
                        raise RuntimeError(
                            f"Cannot migrate {table_name}.{column_name}: SQLite already "
                            "stored a UUID as a number. Restore the affected ID and its "
                            "references from a backup before retrying."
                        )

            for table_name, columns in UUID_COLUMNS.items():
                # Reflect the deployed schema, preserving its constraints and
                # indexes rather than replacing it with today's model definition.
                table = sa.Table(table_name, sa.MetaData(), autoload_with=bind)
                with op.batch_alter_table(table_name, copy_from=table, recreate="always") as batch:
                    for column_name in columns:
                        batch.alter_column(
                            column_name,
                            existing_type=table.c[column_name].type,
                            type_=sa.Uuid(as_uuid=True),
                        )
            bind.exec_driver_sql("COMMIT")
        except Exception:
            # Explicit BEGIN also makes SQLite's table rebuilds atomic.
            bind.exec_driver_sql("ROLLBACK")
            raise
        finally:
            bind.exec_driver_sql(f"PRAGMA foreign_keys = {int(foreign_keys)}")


def downgrade() -> None:
    # Older models read the same hexadecimal strings from CHAR(32). Retain text
    # affinity: restoring numeric affinity could destroy otherwise valid IDs.
    pass
