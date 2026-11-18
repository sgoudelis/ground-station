"""Cache a rolling window of external calendar announcements.

Revision ID: c9e3a5b7d1f2
Revises: b8d2f4a6c9e1
"""

import sqlalchemy as sa

import alembic.op as op

revision = "c9e3a5b7d1f2"
down_revision = "b8d2f4a6c9e1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "cached_external_events",
        sa.Column("id", sa.String(128), primary_key=True, nullable=False),
        sa.Column("start_date", sa.Date(), nullable=False),
        sa.Column("end_date", sa.Date(), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("fetched_at", sa.DateTime(), nullable=False),
    )
    for column in ("start_date", "end_date"):
        op.create_index(f"ix_cached_external_events_{column}", "cached_external_events", [column])


def downgrade() -> None:
    op.drop_table("cached_external_events")
