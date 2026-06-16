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

import uuid

import pytest

from common import auth
from crud import preferences as preferences_crud
from db.models import Preferences, PreferenceScope, UserRole, Users


@pytest.mark.asyncio
async def test_set_user_preferences_is_idempotent_for_unchanged_values(db_session):
    user = Users(
        id=uuid.uuid4(),
        username="operator",
        username_norm="operator",
        password_hash=auth.hash_password("password123"),
        role=UserRole.OPERATOR.value,
        is_active=True,
    )
    db_session.add(user)
    await db_session.commit()

    initial = await preferences_crud.set_user_preferences(
        db_session,
        user.id,
        [{"name": "theme", "value": "auto"}],
    )
    assert initial["success"] is True

    # Re-saving unchanged value should not fail with rowcount/stale update issues.
    second = await preferences_crud.set_user_preferences(
        db_session,
        user.id,
        [{"name": "theme", "value": "auto"}],
    )
    assert second["success"] is True


@pytest.mark.asyncio
async def test_fetch_integration_preferences_prefers_user_scoped_values(db_session):
    user = Users(
        id=uuid.uuid4(),
        username="admin",
        username_norm="admin",
        password_hash=auth.hash_password("password123"),
        role=UserRole.ADMIN.value,
        is_active=True,
    )
    db_session.add(user)
    await db_session.commit()

    # Legacy global fallback row.
    db_session.add(
        Preferences(
            id=uuid.uuid4(),
            scope=PreferenceScope.SYSTEM.value,
            user_id=None,
            name="gemini_api_key",
            value="legacy-system-key",
        )
    )
    await db_session.commit()

    fallback = await preferences_crud.fetch_integration_preferences_map(db_session, user_id=user.id)
    assert fallback["gemini_api_key"] == "legacy-system-key"

    await preferences_crud.set_user_preferences(
        db_session,
        user.id,
        [{"name": "gemini_api_key", "value": "user-key"}],
    )

    preferred = await preferences_crud.fetch_integration_preferences_map(
        db_session, user_id=user.id
    )
    assert preferred["gemini_api_key"] == "user-key"
