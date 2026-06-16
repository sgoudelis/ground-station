"""scope preferences by user and system

Revision ID: a6b4c2d1e8f9
Revises: f9a1c2d3e4b5
Create Date: 2026-06-13 18:10:00.000000
"""

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision = "a6b4c2d1e8f9"
down_revision = "f9a1c2d3e4b5"
branch_labels = None
depends_on = None


SYSTEM_PREFERENCE_KEYS = (
    "stadia_maps_api_key",
    "gemini_api_key",
    "deepgram_api_key",
    "google_translate_api_key",
)


def _column_names(bind) -> set[str]:
    inspector = sa.inspect(bind)
    return {column["name"] for column in inspector.get_columns("preferences")}


def _index_names(bind) -> set[str]:
    inspector = sa.inspect(bind)
    return {index.get("name") for index in inspector.get_indexes("preferences")}


def _check_constraint_names(bind) -> set[str]:
    inspector = sa.inspect(bind)
    return {constraint.get("name") for constraint in inspector.get_check_constraints("preferences")}


def _has_user_foreign_key(bind) -> bool:
    inspector = sa.inspect(bind)
    for foreign_key in inspector.get_foreign_keys("preferences"):
        columns = foreign_key.get("constrained_columns") or []
        referred_table = foreign_key.get("referred_table")
        if columns == ["user_id"] and referred_table == "users":
            return True
    return False


def _delete_duplicate_user_rows() -> None:
    # Keep the most recently updated row for each (user_id, name) pair.
    op.execute(
        """
        DELETE FROM preferences
        WHERE id IN (
            SELECT id
            FROM (
                SELECT
                    id,
                    ROW_NUMBER() OVER (
                        PARTITION BY user_id, name
                        ORDER BY COALESCE(updated, added) DESC, id DESC
                    ) AS row_num
                FROM preferences
                WHERE scope = 'user'
            ) ranked
            WHERE ranked.row_num > 1
        )
        """
    )


def _delete_duplicate_global_rows() -> None:
    # Keep one row per key for system/bootstrap scopes.
    op.execute(
        """
        DELETE FROM preferences
        WHERE id IN (
            SELECT id
            FROM (
                SELECT
                    id,
                    ROW_NUMBER() OVER (
                        PARTITION BY scope, name
                        ORDER BY COALESCE(updated, added) DESC, id DESC
                    ) AS row_num
                FROM preferences
                WHERE scope IN ('system', 'bootstrap')
            ) ranked
            WHERE ranked.row_num > 1
        )
        """
    )


def upgrade() -> None:
    bind = op.get_bind()
    columns = _column_names(bind)
    has_user_id = "user_id" in columns
    has_scope = "scope" in columns

    # Make migration re-runnable on installations where a previous attempt
    # partially applied DDL before failing.
    if not has_user_id or not has_scope:
        with op.batch_alter_table("preferences", schema=None) as batch_op:
            if not has_user_id:
                batch_op.add_column(sa.Column("user_id", sa.UUID(), nullable=True))
            if not has_scope:
                batch_op.add_column(
                    sa.Column("scope", sa.String(), nullable=True, server_default="bootstrap")
                )

    system_keys_sql = ", ".join(f"'{key}'" for key in SYSTEM_PREFERENCE_KEYS)

    # System-level keys are always global and never tied to a user row.
    op.execute(
        sa.text(
            f"""
            UPDATE preferences
            SET scope = 'system', user_id = NULL
            WHERE name IN ({system_keys_sql})
            """
        )
    )

    canonical_user_id = bind.execute(
        sa.text("SELECT id FROM users ORDER BY created_at ASC LIMIT 1")
    ).scalar()

    if canonical_user_id:
        # Existing installs that already have users migrate legacy user prefs
        # to the earliest existing account.
        bind.execute(
            sa.text(
                f"""
                UPDATE preferences
                SET scope = 'user', user_id = :user_id
                WHERE name NOT IN ({system_keys_sql})
                """
            ),
            {"user_id": canonical_user_id},
        )
    else:
        # Existing installs without users keep user-ish prefs in bootstrap scope
        # until the first admin account is created via setup flow.
        op.execute(
            sa.text(
                f"""
                UPDATE preferences
                SET scope = 'bootstrap', user_id = NULL
                WHERE name NOT IN ({system_keys_sql})
                """
            )
        )

    _delete_duplicate_user_rows()
    _delete_duplicate_global_rows()

    check_constraints = _check_constraint_names(bind)
    has_scope_check = "ck_preferences_scope" in check_constraints
    has_scope_user_check = "ck_preferences_scope_user_id" in check_constraints
    has_user_fk = _has_user_foreign_key(bind)

    with op.batch_alter_table("preferences", schema=None) as batch_op:
        batch_op.alter_column(
            "scope",
            existing_type=sa.String(),
            nullable=False,
            existing_server_default="bootstrap",
        )
        if not has_user_fk:
            batch_op.create_foreign_key(
                "fk_preferences_user_id_users",
                "users",
                ["user_id"],
                ["id"],
                ondelete="CASCADE",
            )
        if not has_scope_check:
            batch_op.create_check_constraint(
                "ck_preferences_scope",
                "scope IN ('user', 'system', 'bootstrap')",
            )
        if not has_scope_user_check:
            batch_op.create_check_constraint(
                "ck_preferences_scope_user_id",
                "(scope = 'user' AND user_id IS NOT NULL) OR "
                "(scope IN ('system', 'bootstrap') AND user_id IS NULL)",
            )

    indexes = _index_names(bind)
    if "uq_preferences_user_name" not in indexes:
        op.create_index(
            "uq_preferences_user_name",
            "preferences",
            ["user_id", "name"],
            unique=True,
            sqlite_where=sa.text("scope = 'user'"),
            postgresql_where=sa.text("scope = 'user'"),
        )
    if "uq_preferences_system_name" not in indexes:
        op.create_index(
            "uq_preferences_system_name",
            "preferences",
            ["name"],
            unique=True,
            sqlite_where=sa.text("scope = 'system'"),
            postgresql_where=sa.text("scope = 'system'"),
        )
    if "uq_preferences_bootstrap_name" not in indexes:
        op.create_index(
            "uq_preferences_bootstrap_name",
            "preferences",
            ["name"],
            unique=True,
            sqlite_where=sa.text("scope = 'bootstrap'"),
            postgresql_where=sa.text("scope = 'bootstrap'"),
        )


def downgrade() -> None:
    op.drop_index("uq_preferences_bootstrap_name", table_name="preferences")
    op.drop_index("uq_preferences_system_name", table_name="preferences")
    op.drop_index("uq_preferences_user_name", table_name="preferences")

    with op.batch_alter_table("preferences", schema=None) as batch_op:
        batch_op.drop_constraint("ck_preferences_scope_user_id", type_="check")
        batch_op.drop_constraint("ck_preferences_scope", type_="check")
        batch_op.drop_constraint("fk_preferences_user_id_users", type_="foreignkey")
        batch_op.drop_column("scope")
        batch_op.drop_column("user_id")
