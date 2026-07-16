"""add source_transmitter_id to transmitters

Revision ID: e6c1b4d2a9f3
Revises: d2f8c6a4b1e3
Create Date: 2026-07-02 18:20:00.000000

"""

import re
import uuid
from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e6c1b4d2a9f3"
down_revision: Union[str, None] = "d2f8c6a4b1e3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TRANSMITTER_ID_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
TRANSMITTER_ID_INDEX = {char: index for index, char in enumerate(TRANSMITTER_ID_ALPHABET)}
TRANSMITTER_ID_BASE = len(TRANSMITTER_ID_ALPHABET)
TRANSMITTER_ID_LENGTH = 22
UUID_PATTERN = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)


def _short_transmitter_id_to_uuid(id_value: str) -> str:
    number = 0
    for char in id_value:
        number = (number * TRANSMITTER_ID_BASE) + TRANSMITTER_ID_INDEX[char]
    if number >= (1 << 128):
        raise ValueError("short transmitter id cannot be decoded to UUID")
    return str(uuid.UUID(int=number))


def upgrade() -> None:
    with op.batch_alter_table("transmitters", schema=None) as batch_op:
        batch_op.add_column(sa.Column("source_transmitter_id", sa.String(), nullable=True))
        batch_op.create_index(
            "ix_transmitters_source_transmitter_id",
            ["source_transmitter_id"],
            unique=False,
        )
        batch_op.create_unique_constraint(
            "uq_transmitters_source_ext_id",
            ["source", "source_transmitter_id"],
        )

    bind = op.get_bind()
    rows = bind.execute(
        sa.text(
            "SELECT id, source FROM transmitters WHERE source_transmitter_id IS NULL OR source_transmitter_id = ''"
        )
    ).fetchall()
    if not rows:
        return

    updates = []
    for row in rows:
        current_id = str(row[0])
        source = (row[1] or "").strip().lower()

        if source == "satnogs":
            source_transmitter_id = current_id
        elif UUID_PATTERN.fullmatch(current_id):
            source_transmitter_id = current_id
        elif len(current_id) == TRANSMITTER_ID_LENGTH and set(current_id).issubset(
            TRANSMITTER_ID_INDEX.keys()
        ):
            try:
                source_transmitter_id = _short_transmitter_id_to_uuid(current_id)
            except ValueError:
                source_transmitter_id = current_id
        else:
            source_transmitter_id = current_id

        updates.append(
            {
                "id": current_id,
                "source_transmitter_id": source_transmitter_id,
            }
        )

    if updates:
        bind.execute(
            sa.text(
                "UPDATE transmitters SET source_transmitter_id = :source_transmitter_id WHERE id = :id"
            ),
            updates,
        )


def downgrade() -> None:
    with op.batch_alter_table("transmitters", schema=None) as batch_op:
        batch_op.drop_constraint("uq_transmitters_source_ext_id", type_="unique")
        batch_op.drop_index("ix_transmitters_source_transmitter_id")
        batch_op.drop_column("source_transmitter_id")
