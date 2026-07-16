"""normalize transmitter ids to satnogs style

Revision ID: d2f8c6a4b1e3
Revises: a3b9c6d1e2f4
Create Date: 2026-07-02 17:00:00.000000

"""

import re
import uuid
from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d2f8c6a4b1e3"
down_revision: Union[str, None] = "a3b9c6d1e2f4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TRANSMITTER_ID_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
TRANSMITTER_ID_BASE = len(TRANSMITTER_ID_ALPHABET)
TRANSMITTER_ID_LENGTH = 22
UUID_PATTERN = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)


def _uuid_to_short_transmitter_id(uuid_text: str) -> str:
    uid = uuid.UUID(uuid_text)
    number = uid.int
    encoded = []

    while number:
        number, remainder = divmod(number, TRANSMITTER_ID_BASE)
        encoded.append(TRANSMITTER_ID_ALPHABET[remainder])

    if not encoded:
        encoded.append(TRANSMITTER_ID_ALPHABET[0])

    return "".join(reversed(encoded)).rjust(
        TRANSMITTER_ID_LENGTH,
        TRANSMITTER_ID_ALPHABET[0],
    )


def upgrade() -> None:
    bind = op.get_bind()
    rows = bind.execute(sa.text("SELECT id FROM transmitters")).fetchall()
    if not rows:
        return

    updates = []
    seen_ids = set()

    for row in rows:
        current_id = str(row[0])
        candidate_id = current_id

        if UUID_PATTERN.fullmatch(current_id):
            candidate_id = _uuid_to_short_transmitter_id(current_id)
            updates.append({"old_id": current_id, "new_id": candidate_id})

        if candidate_id in seen_ids:
            raise RuntimeError(
                f"Cannot normalize transmitter ids: collision detected for id '{candidate_id}'"
            )
        seen_ids.add(candidate_id)

    if updates:
        bind.execute(
            sa.text("UPDATE transmitters SET id = :new_id WHERE id = :old_id"),
            updates,
        )


def downgrade() -> None:
    # Data migration is intentionally irreversible.
    pass
