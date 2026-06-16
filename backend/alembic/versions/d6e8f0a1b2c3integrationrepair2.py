"""finalize integration key materialization for existing users

Revision ID: d6e8f0a1b2c3
Revises: c5d7e9f1a2b3
Create Date: 2026-06-13 21:00:00.000000
"""

import uuid
from datetime import datetime, timezone

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision = "d6e8f0a1b2c3"
down_revision = "c5d7e9f1a2b3"
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
    keys_sql, key_params = _key_placeholders()
    now = datetime.now(timezone.utc)

    # Latest global/bootstrap value per key remains the migration source of truth.
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

    if not user_ids:
        # Setup not completed yet: keep one canonical bootstrap row per key so
        # setup-admin can claim it via claim_bootstrap_preferences().
        bind.execute(
            sa.text(
                f"""
                DELETE FROM preferences
                WHERE id IN (
                    SELECT id
                    FROM (
                        SELECT
                            id,
                            ROW_NUMBER() OVER (
                                PARTITION BY name
                                ORDER BY COALESCE(updated, added) DESC, id DESC
                            ) AS row_num
                        FROM preferences
                        WHERE scope IN ('system', 'bootstrap')
                          AND user_id IS NULL
                          AND name IN ({keys_sql})
                    ) ranked
                    WHERE ranked.row_num > 1
                )
                """
            ),
            key_params,
        )
        bind.execute(
            sa.text(
                f"""
                UPDATE preferences
                SET scope = 'bootstrap', user_id = NULL, updated = :updated
                WHERE scope IN ('system', 'bootstrap')
                  AND user_id IS NULL
                  AND name IN ({keys_sql})
                """
            ),
            {**key_params, "updated": now},
        )
        return

    existing_user_rows = (
        bind.execute(
            sa.text(
                f"""
            SELECT id, user_id, name, value
            FROM preferences
            WHERE scope = 'user'
              AND name IN ({keys_sql})
            """
            ),
            key_params,
        )
        .mappings()
        .all()
    )
    existing_by_pair = {(str(row["user_id"]), str(row["name"])): row for row in existing_user_rows}

    for user_id in user_ids:
        user_id_str = str(user_id)
        for key, source_row in source_by_name.items():
            pair = (user_id_str, key)
            source_value = str(source_row["value"] or "")
            existing_row = existing_by_pair.get(pair)

            if existing_row is None:
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
                        "value": source_value,
                        "added": source_row["added"] or now,
                        "updated": source_row["updated"] or now,
                    },
                )
                continue

            # Fill only unset user rows; keep explicit user-entered values.
            current_value = str(existing_row["value"] or "")
            if current_value:
                continue
            bind.execute(
                sa.text(
                    """
                    UPDATE preferences
                    SET value = :value, updated = :updated
                    WHERE id = :id
                    """
                ),
                {
                    "value": source_value,
                    "updated": now,
                    "id": existing_row["id"],
                },
            )

    # Remove legacy global/bootstrap copies once user-scoped rows are in place.
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

    # Restore pre-upgrade behavior by removing user-scoped integration rows.
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

    # Canonicalize remaining global rows back to a single system-scoped row/key.
    bind.execute(
        sa.text(
            f"""
            DELETE FROM preferences
            WHERE id IN (
                SELECT id
                FROM (
                    SELECT
                        id,
                        ROW_NUMBER() OVER (
                            PARTITION BY name
                            ORDER BY COALESCE(updated, added) DESC, id DESC
                        ) AS row_num
                    FROM preferences
                    WHERE scope IN ('system', 'bootstrap')
                      AND user_id IS NULL
                      AND name IN ({keys_sql})
                ) ranked
                WHERE ranked.row_num > 1
            )
            """
        ),
        key_params,
    )
    bind.execute(
        sa.text(
            f"""
            UPDATE preferences
            SET scope = 'system', user_id = NULL
            WHERE scope IN ('system', 'bootstrap')
              AND user_id IS NULL
              AND name IN ({keys_sql})
            """
        ),
        key_params,
    )
