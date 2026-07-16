"""Add transmitter target-key ownership for celestial targets.

Revision ID: a3b9c6d1e2f4
Revises: f4a1d9c8b7e6
Create Date: 2026-07-01 13:30:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a3b9c6d1e2f4"
down_revision: Union[str, None] = "f4a1d9c8b7e6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("transmitters", schema=None) as batch_op:
        batch_op.add_column(sa.Column("target_key", sa.String(), nullable=True))
        batch_op.alter_column(
            "norad_cat_id",
            existing_type=sa.Integer(),
            nullable=True,
        )
        batch_op.create_index("ix_transmitters_target_key", ["target_key"], unique=False)
        batch_op.create_check_constraint(
            "ck_transmitters_owner_scope",
            "(norad_cat_id IS NOT NULL AND target_key IS NULL) OR "
            "(norad_cat_id IS NULL AND target_key IS NOT NULL)",
        )


def downgrade() -> None:
    with op.batch_alter_table("transmitters", schema=None) as batch_op:
        batch_op.drop_constraint("ck_transmitters_owner_scope", type_="check")
        batch_op.drop_index("ix_transmitters_target_key")
        batch_op.drop_column("target_key")
        batch_op.alter_column(
            "norad_cat_id",
            existing_type=sa.Integer(),
            nullable=False,
        )
