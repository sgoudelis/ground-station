"""remove deprecated celestial preference key

Revision ID: e4c9d1b2a7f3
Revises: c9f2e7a1b4d6
Create Date: 2026-06-20 16:45:00.000000
"""

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision = "e4c9d1b2a7f3"
down_revision = "c9f2e7a1b4d6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        sa.text(
            """
            DELETE FROM preferences
            WHERE name = 'celestial_enabled'
            """
        )
    )


def downgrade() -> None:
    # Irreversible data cleanup. Deprecated key remains removed on downgrade.
    pass
