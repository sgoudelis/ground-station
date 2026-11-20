"""Persist station calendar feeds and shared external-service consent.

Revision ID: d4a8f2c6e0b1
Revises: c9e3a5b7d1f2
"""

import sqlalchemy as sa

import alembic.op as op

revision = "d4a8f2c6e0b1"
down_revision = "c9e3a5b7d1f2"
branch_labels = None
depends_on = None


def create_table(name, *columns):
    # Full restores invalidate consent before an older backup is upgraded.
    if not sa.inspect(op.get_bind()).has_table(name):
        op.create_table(name, *columns)


def upgrade():
    create_table(
        "calendar_services",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("installation_id", sa.String(36)),
        sa.Column("accepted_terms_version", sa.String(64)),
        *[
            sa.Column(name, sa.String())
            for name in (
                "accepted_at",
                "accepted_by",
                "revoked_at",
                "last_attempt_at",
                "last_success_at",
                "coverage_start",
                "coverage_end",
                "error",
            )
        ],
        *[
            sa.Column(name, sa.Boolean(), nullable=False)
            for name in (
                "grant_pending",
                "deletion_pending",
                "remote_possible",
            )
        ],
        sa.Column("next_poll_at", sa.Float(), nullable=False),
        sa.Column("retry_after_at", sa.Float(), nullable=False),
        sa.Column("feed_status", sa.JSON(), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    create_table(
        "calendar_feeds",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("service_id", sa.String(32), sa.ForeignKey("calendar_services.id")),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.add_column(
        "cached_external_events",
        sa.Column("feed_id", sa.String(32), nullable=False, server_default="announcements"),
    )
    op.add_column("cached_external_events", sa.Column("expires_at", sa.DateTime(timezone=True)))
    for column in ("feed_id", "expires_at"):
        op.create_index(f"ix_cached_external_events_{column}", "cached_external_events", [column])


def downgrade():
    for column in ("expires_at", "feed_id"):
        op.drop_index(f"ix_cached_external_events_{column}", table_name="cached_external_events")
        op.drop_column("cached_external_events", column)
    op.drop_table("calendar_feeds")
    op.drop_table("calendar_services")
