"""add users and auth sessions tables

Revision ID: f9a1c2d3e4b5
Revises: b9d2e4f6a1c3
Create Date: 2026-06-13 14:20:00.000000
"""

import sqlalchemy as sa

from alembic import op
from db.models import AwareDateTime

# revision identifiers, used by Alembic.
revision = "f9a1c2d3e4b5"
down_revision = "b9d2e4f6a1c3"
branch_labels = None
depends_on = None


def _get_table_names(bind) -> set[str]:
    return set(sa.inspect(bind).get_table_names())


def _get_column_names(bind, table_name: str) -> set[str]:
    return {column["name"] for column in sa.inspect(bind).get_columns(table_name)}


def _get_index_names(bind, table_name: str) -> set[str]:
    return {
        index["name"] for index in sa.inspect(bind).get_indexes(table_name) if index.get("name")
    }


def upgrade() -> None:
    bind = op.get_bind()
    table_names = _get_table_names(bind)

    modern_users_columns = {
        "id",
        "username",
        "username_norm",
        "password_hash",
        "role",
        "is_active",
        "last_login_at",
        "failed_login_count",
        "locked_until",
        "created_by_user_id",
        "updated_by_user_id",
        "created_at",
        "updated_at",
    }
    legacy_users_columns = {"id", "email", "status", "password", "fullname", "added", "updated"}

    users_already_modern = False
    if "users" in table_names:
        existing_users_columns = _get_column_names(bind, "users")
        if modern_users_columns.issubset(existing_users_columns):
            users_already_modern = True
        elif legacy_users_columns.issubset(existing_users_columns):
            # Older snapshots can contain a legacy users table while stamped before auth migrations.
            # Drop the legacy table so this migration can create the canonical auth schema.
            op.drop_table("users")
        else:
            raise RuntimeError(
                f"Existing users table has unexpected schema columns: {sorted(existing_users_columns)}"
            )

    if not users_already_modern:
        op.create_table(
            "users",
            sa.Column("id", sa.UUID(), nullable=False),
            sa.Column("username", sa.String(), nullable=False),
            sa.Column("username_norm", sa.String(), nullable=False),
            sa.Column("password_hash", sa.String(), nullable=False),
            sa.Column("role", sa.String(), nullable=False, server_default="operator"),
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default="1"),
            sa.Column("last_login_at", AwareDateTime(), nullable=True),
            sa.Column("failed_login_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("locked_until", AwareDateTime(), nullable=True),
            sa.Column("created_by_user_id", sa.UUID(), nullable=True),
            sa.Column("updated_by_user_id", sa.UUID(), nullable=True),
            sa.Column("created_at", AwareDateTime(), nullable=False),
            sa.Column("updated_at", AwareDateTime(), nullable=False),
            sa.CheckConstraint("role IN ('admin', 'operator')", name="ck_users_role"),
            sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["updated_by_user_id"], ["users.id"], ondelete="SET NULL"),
            sa.PrimaryKeyConstraint("id"),
        )

    if "ix_users_username_norm" not in _get_index_names(bind, "users"):
        op.create_index("ix_users_username_norm", "users", ["username_norm"], unique=True)

    if "auth_sessions" not in _get_table_names(bind):
        op.create_table(
            "auth_sessions",
            sa.Column("id", sa.UUID(), nullable=False),
            sa.Column("user_id", sa.UUID(), nullable=False),
            sa.Column("token_hash", sa.String(), nullable=False),
            sa.Column("expires_at", AwareDateTime(), nullable=False),
            sa.Column("revoked_at", AwareDateTime(), nullable=True),
            sa.Column("revoke_reason", sa.String(), nullable=True),
            sa.Column("last_seen_at", AwareDateTime(), nullable=True),
            sa.Column("created_ip", sa.String(), nullable=True),
            sa.Column("created_user_agent", sa.String(), nullable=True),
            sa.Column("created_at", AwareDateTime(), nullable=False),
            sa.Column("updated_at", AwareDateTime(), nullable=False),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )

    auth_session_indexes = _get_index_names(bind, "auth_sessions")
    if "ix_auth_sessions_user_id" not in auth_session_indexes:
        op.create_index("ix_auth_sessions_user_id", "auth_sessions", ["user_id"], unique=False)
    if "ix_auth_sessions_token_hash" not in auth_session_indexes:
        op.create_index("ix_auth_sessions_token_hash", "auth_sessions", ["token_hash"], unique=True)
    if "ix_auth_sessions_expires_at" not in auth_session_indexes:
        op.create_index(
            "ix_auth_sessions_expires_at", "auth_sessions", ["expires_at"], unique=False
        )
    if "ix_auth_sessions_revoked_at" not in auth_session_indexes:
        op.create_index(
            "ix_auth_sessions_revoked_at", "auth_sessions", ["revoked_at"], unique=False
        )


def downgrade() -> None:
    bind = op.get_bind()
    table_names = _get_table_names(bind)

    if "auth_sessions" in table_names:
        auth_session_indexes = _get_index_names(bind, "auth_sessions")
        if "ix_auth_sessions_revoked_at" in auth_session_indexes:
            op.drop_index("ix_auth_sessions_revoked_at", table_name="auth_sessions")
        if "ix_auth_sessions_expires_at" in auth_session_indexes:
            op.drop_index("ix_auth_sessions_expires_at", table_name="auth_sessions")
        if "ix_auth_sessions_token_hash" in auth_session_indexes:
            op.drop_index("ix_auth_sessions_token_hash", table_name="auth_sessions")
        if "ix_auth_sessions_user_id" in auth_session_indexes:
            op.drop_index("ix_auth_sessions_user_id", table_name="auth_sessions")
        op.drop_table("auth_sessions")

    if "users" in _get_table_names(bind):
        user_indexes = _get_index_names(bind, "users")
        if "ix_users_username_norm" in user_indexes:
            op.drop_index("ix_users_username_norm", table_name="users")
        op.drop_table("users")
