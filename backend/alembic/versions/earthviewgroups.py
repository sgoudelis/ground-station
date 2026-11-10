"""Add Earth view recent-group visibility settings.

Revision ID: b8d2f4a6c9e1
Revises: a7c9e1b3d5f8
"""

import sqlalchemy as sa

import alembic.op as op

revision = "b8d2f4a6c9e1"
down_revision = "a7c9e1b3d5f8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Existing groups keep their current eligibility for recent shortcuts.
    for table in ("orbital_sources", "groups"):
        op.add_column(
            table,
            sa.Column("show_on_earth_view", sa.Boolean(), nullable=False, server_default="1"),
        )


def downgrade() -> None:
    for table in ("groups", "orbital_sources"):
        op.drop_column(table, "show_on_earth_view")
