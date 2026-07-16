"""Add native Airspy SDR types.

Revision ID: f4a1d9c8b7e6
Revises: e4c9d1b2a7f3
Create Date: 2026-06-21 16:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f4a1d9c8b7e6"
down_revision: Union[str, None] = "e4c9d1b2a7f3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


OLD_ENUM = sa.Enum(
    "RTLSDRUSBV3",
    "RTLSDRTCPV3",
    "RTLSDRUSBV4",
    "RTLSDRTCPV4",
    "SOAPYSDRLOCAL",
    "SOAPYSDRREMOTE",
    "UHD",
    "SIGMFPLAYBACK",
    name="sdrtype",
)

NEW_ENUM = sa.Enum(
    "RTLSDRUSBV3",
    "RTLSDRTCPV3",
    "RTLSDRUSBV4",
    "RTLSDRTCPV4",
    "AIRSPY",
    "AIRSPYHF",
    "SOAPYSDRLOCAL",
    "SOAPYSDRREMOTE",
    "UHD",
    "SIGMFPLAYBACK",
    name="sdrtype",
)


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute("ALTER TYPE sdrtype ADD VALUE IF NOT EXISTS 'AIRSPY'")
        op.execute("ALTER TYPE sdrtype ADD VALUE IF NOT EXISTS 'AIRSPYHF'")
        return

    with op.batch_alter_table("sdrs", schema=None) as batch_op:
        batch_op.alter_column(
            "type",
            existing_type=OLD_ENUM,
            type_=NEW_ENUM,
            existing_nullable=True,
        )


def downgrade() -> None:
    bind = op.get_bind()
    # PostgreSQL enum values cannot be removed in-place.
    if bind.dialect.name == "postgresql":
        op.execute("UPDATE sdrs SET type = 'SOAPYSDRLOCAL' WHERE type IN ('AIRSPY', 'AIRSPYHF')")
        return

    # Map unsupported values before shrinking SQLite enum constraints.
    op.execute("UPDATE sdrs SET type = 'SOAPYSDRLOCAL' WHERE type = 'AIRSPY'")
    op.execute("UPDATE sdrs SET type = 'SOAPYSDRLOCAL' WHERE type = 'AIRSPYHF'")
    with op.batch_alter_table("sdrs", schema=None) as batch_op:
        batch_op.alter_column(
            "type",
            existing_type=NEW_ENUM,
            type_=OLD_ENUM,
            existing_nullable=True,
        )
