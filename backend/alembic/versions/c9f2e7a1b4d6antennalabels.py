"""add antenna label persistence to SDR records

Revision ID: c9f2e7a1b4d6
Revises: d6e8f0a1b2c3
Create Date: 2026-06-20 12:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c9f2e7a1b4d6"
down_revision: Union[str, None] = "d6e8f0a1b2c3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("sdrs", sa.Column("antenna_labels", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("sdrs", "antenna_labels")
