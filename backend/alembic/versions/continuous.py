"""Persist continuous observation definitions without runtime state.

Revision ID: a7c9e1b3d5f8
Revises: f6a8b1c3d5e7
"""

import sqlalchemy as sa

import alembic.op as op

revision = "a7c9e1b3d5f8"
down_revision = "f6a8b1c3d5e7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "continuous_observations",
        sa.Column("id", sa.String(), primary_key=True, nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("auto_start", sa.Boolean(), nullable=False, server_default="1"),
        sa.Column("sdr_id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("sdr_config", sa.JSON(), nullable=False),
        sa.Column("vfos", sa.JSON(), nullable=False),
        sa.Column("config_version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["sdr_id"], ["sdrs.id"], ondelete="RESTRICT"),
    )
    op.create_index("ix_continuous_observations_sdr_id", "continuous_observations", ["sdr_id"])
    op.create_index(
        "ix_continuous_observations_auto_start", "continuous_observations", ["auto_start"]
    )


def downgrade() -> None:
    op.drop_table("continuous_observations")
