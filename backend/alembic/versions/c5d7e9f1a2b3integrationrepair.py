"""materialize integration keys for existing users

Revision ID: c5d7e9f1a2b3
Revises: b1d2c3e4f5a6
Create Date: 2026-06-13 20:45:00.000000
"""

import uuid

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision = "c5d7e9f1a2b3"
down_revision = "b1d2c3e4f5a6"
branch_labels = None
depends_on = None


INTEGRATION_PREFERENCE_KEYS = (
    "stadia_maps_api_key",
    "gemini_api_key",
    "deepgram_api_key",
    "google_translate_api_key",
)


def _table_names(bind) -> set[str]:
    inspector = sa.inspect(bind)
    return set(inspector.get_table_names())


def _key_placeholders(prefix: str = "k") -> tuple[str, dict]:
    placeholders = []
    params = {}
    for index, key in enumerate(INTEGRATION_PREFERENCE_KEYS):
        param_name = f"{prefix}{index}"
        placeholders.append(f":{param_name}")
        params[param_name] = key
    return ", ".join(placeholders), params


def upgrade() -> None:
    bind = op.get_bind()
    tables = _table_names(bind)
    if "preferences" not in tables or "users" not in tables:
        return

    user_ids = [
        row[0]
        for row in bind.execute(
            sa.text("SELECT id FROM users ORDER BY created_at ASC, id ASC")
        ).fetchall()
    ]
    if not user_ids:
        # If there are still no users, defer materialization to a later app version/migration run.
        return

    keys_sql, key_params = _key_placeholders()

    # Use the latest global/bootstrap value per integration key as the source of truth.
    legacy_rows = (
        bind.execute(
            sa.text(
                f"""
            SELECT name, value, added, updated
            FROM preferences
            WHERE scope IN ('system', 'bootstrap')
              AND user_id IS NULL
              AND name IN ({keys_sql})
            ORDER BY COALESCE(updated, added) DESC, id DESC
            """
            ),
            key_params,
        )
        .mappings()
        .all()
    )

    source_by_name = {}
    for row in legacy_rows:
        name = str(row["name"])
        if name not in source_by_name:
            source_by_name[name] = row

    if not source_by_name:
        return

    existing_user_rows = bind.execute(
        sa.text(
            f"""
            SELECT user_id, name
            FROM preferences
            WHERE scope = 'user'
              AND name IN ({keys_sql})
            """
        ),
        key_params,
    ).fetchall()
    existing_pairs = {(str(row[0]), str(row[1])) for row in existing_user_rows}

    for user_id in user_ids:
        user_id_str = str(user_id)
        for key, row in source_by_name.items():
            pair = (user_id_str, key)
            if pair in existing_pairs:
                continue
            bind.execute(
                sa.text(
                    """
                    INSERT INTO preferences (id, user_id, scope, name, value, added, updated)
                    VALUES (:id, :user_id, 'user', :name, :value, :added, :updated)
                    """
                ),
                {
                    "id": uuid.uuid4().hex,
                    "user_id": user_id,
                    "name": key,
                    "value": row["value"] or "",
                    "added": row["added"],
                    "updated": row["updated"],
                },
            )
            existing_pairs.add(pair)

    # Remove old global copies once user-scoped rows are materialized.
    bind.execute(
        sa.text(
            f"""
            DELETE FROM preferences
            WHERE scope IN ('system', 'bootstrap')
              AND user_id IS NULL
              AND name IN ({keys_sql})
            """
        ),
        key_params,
    )


def downgrade() -> None:
    bind = op.get_bind()
    tables = _table_names(bind)
    if "preferences" not in tables:
        return

    keys_sql, key_params = _key_placeholders()

    # Restore one latest user-scoped value per key as a system-scoped row.
    user_rows = (
        bind.execute(
            sa.text(
                f"""
            SELECT name, value, added, updated
            FROM preferences
            WHERE scope = 'user'
              AND name IN ({keys_sql})
            ORDER BY COALESCE(updated, added) DESC, id DESC
            """
            ),
            key_params,
        )
        .mappings()
        .all()
    )
    source_by_name = {}
    for row in user_rows:
        name = str(row["name"])
        if name not in source_by_name:
            source_by_name[name] = row

    existing_system_rows = bind.execute(
        sa.text(
            f"""
            SELECT name
            FROM preferences
            WHERE scope = 'system'
              AND user_id IS NULL
              AND name IN ({keys_sql})
            """
        ),
        key_params,
    ).fetchall()
    existing_system_names = {str(row[0]) for row in existing_system_rows}

    for key, row in source_by_name.items():
        if key in existing_system_names:
            continue
        bind.execute(
            sa.text(
                """
                INSERT INTO preferences (id, user_id, scope, name, value, added, updated)
                VALUES (:id, NULL, 'system', :name, :value, :added, :updated)
                """
            ),
            {
                "id": uuid.uuid4().hex,
                "name": key,
                "value": row["value"] or "",
                "added": row["added"],
                "updated": row["updated"],
            },
        )

    # Remove user-scoped integration rows to restore pre-upgrade behavior.
    bind.execute(
        sa.text(
            f"""
            DELETE FROM preferences
            WHERE scope = 'user'
              AND name IN ({keys_sql})
            """
        ),
        key_params,
    )
