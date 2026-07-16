# Copyright (c) 2025 Efstratios Goudelis
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU General Public License for more details.
#
# You should have received a copy of the GNU General Public License
# along with this program. If not, see <https://www.gnu.org/licenses/>.

"""Unit tests for authentication helpers."""

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from common import auth
from db.models import Locations, Preferences, PreferenceScope


@pytest.fixture
def patch_auth_session(db_engine, monkeypatch):
    """Bind auth module DB access to the in-memory test engine."""
    maker = async_sessionmaker(
        db_engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )
    monkeypatch.setattr(auth, "AsyncSessionLocal", maker)
    return maker


@pytest.mark.asyncio
async def test_bootstrap_admin_sets_up_first_user(patch_auth_session):
    auth._set_setup_cache(True)

    before = await auth.is_setup_required(force_refresh=True)
    assert before is True

    result = await auth.bootstrap_admin("admin", "password123")
    assert result["success"] is True
    assert result["user"]["role"] == "admin"
    assert result.get("token")

    after = await auth.is_setup_required(force_refresh=True)
    assert after is False


@pytest.mark.asyncio
async def test_resolve_setup_mode_uses_admin_recovery_when_location_exists(patch_auth_session):
    async with patch_auth_session() as session:
        session.add(
            Locations(
                name="home",
                callsign="SV1ABC",
                lat=37.0,
                lon=23.0,
                alt=120,
            )
        )
        await session.commit()

    setup_mode = await auth.resolve_setup_mode(force_refresh=True)
    assert setup_mode == auth.SETUP_MODE_ADMIN_RECOVERY


@pytest.mark.asyncio
async def test_resolve_setup_mode_uses_full_setup_when_no_location_exists(patch_auth_session):
    setup_mode = await auth.resolve_setup_mode(force_refresh=True)
    assert setup_mode == auth.SETUP_MODE_FULL


@pytest.mark.asyncio
async def test_login_rejects_invalid_password(patch_auth_session):
    await auth.bootstrap_admin("admin", "password123")

    failed = await auth.login("admin", "wrong-password")
    assert failed["success"] is False

    success = await auth.login("admin", "password123")
    assert success["success"] is True
    assert success["user"]["username"] == "admin"


@pytest.mark.asyncio
async def test_last_admin_cannot_be_deactivated(patch_auth_session):
    first_admin = await auth.bootstrap_admin("admin", "password123")
    admin_user_id = first_admin["user"]["id"]

    update_reply = await auth.update_user(admin_user_id, is_active=False)
    assert update_reply["success"] is False
    assert "active admin" in update_reply["error"].lower()


@pytest.mark.asyncio
async def test_bootstrap_admin_claims_bootstrap_preferences(patch_auth_session):
    async with patch_auth_session() as session:
        session.add(
            Preferences(
                name="theme",
                value="light",
                scope=PreferenceScope.BOOTSTRAP.value,
                user_id=None,
            )
        )
        await session.commit()

    bootstrap_reply = await auth.bootstrap_admin("admin", "password123")
    assert bootstrap_reply["success"] is True
    created_user_id = bootstrap_reply["user"]["id"]

    async with patch_auth_session() as session:
        user_rows = (
            (
                await session.execute(
                    select(Preferences).where(Preferences.scope == PreferenceScope.USER.value)
                )
            )
            .scalars()
            .all()
        )
        bootstrap_rows = (
            (
                await session.execute(
                    select(Preferences).where(Preferences.scope == PreferenceScope.BOOTSTRAP.value)
                )
            )
            .scalars()
            .all()
        )

    theme_row = next((row for row in user_rows if row.name == "theme"), None)
    assert theme_row is not None
    assert theme_row.value == "light"
    assert str(theme_row.user_id) == created_user_id
    assert len(bootstrap_rows) == 0


def test_operator_cannot_run_admin_only_commands():
    assert auth.is_command_allowed_for_role("get-locations", "operator") is True
    assert auth.is_command_allowed_for_role("update-preferences", "operator") is True
    assert auth.is_command_allowed_for_role("update-system-preferences", "operator") is False
    assert auth.is_command_allowed_for_role("update-app-config", "operator") is False
    assert auth.is_command_allowed_for_role("database-backup.full_backup", "operator") is False


def test_setup_mode_only_allows_setup_scoped_commands():
    assert auth.is_command_allowed_during_setup("get-locations") is True
    assert auth.is_command_allowed_during_setup("setup.restore") is True
    assert auth.is_command_allowed_during_setup("setup.finalize") is True
    assert auth.is_command_allowed_during_setup("setup.status") is True

    assert auth.is_command_allowed_during_setup("background-task.start") is False
    assert auth.is_command_allowed_during_setup("background-task.list") is False
    assert auth.is_command_allowed_during_setup("sync-satellite-data") is False
    assert auth.is_command_allowed_during_setup("database-backup.full_restore") is False


def test_extract_session_cookie_token_from_cookie_header():
    cookie_header = f"foo=bar; {auth.AUTH_SESSION_COOKIE_NAME}=session-token-123; theme=dark"
    assert auth.extract_session_cookie_token(cookie_header) == "session-token-123"


def test_extract_session_cookie_token_returns_none_when_missing():
    assert auth.extract_session_cookie_token("foo=bar; theme=dark") is None


def test_extract_cookie_token_normalizes_blank_values():
    assert auth.extract_cookie_token("   ") is None
