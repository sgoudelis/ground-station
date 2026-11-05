"""Allow rotators with firmware that cannot execute Hamlib Stop.

Revision ID: e5f7a9b2c4d6
Revises: d4e6f8a1b3c5
"""

import sqlalchemy as sa

import alembic.op as op

revision = "e5f7a9b2c4d6"
down_revision = "d4e6f8a1b3c5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "rotators", sa.Column("stop_supported", sa.Boolean(), nullable=False, server_default="1")
    )


def downgrade() -> None:
    with op.batch_alter_table("rotators") as batch_op:
        batch_op.drop_column("stop_supported")
