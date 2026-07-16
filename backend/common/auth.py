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

"""Authentication and authorization helpers."""

from __future__ import annotations

import asyncio
import hashlib
import logging
import re
import secrets
import time
import uuid
from datetime import datetime, timedelta, timezone
from http.cookies import SimpleCookie
from typing import Any, Dict, Optional

from passlib.context import CryptContext
from sqlalchemy import and_, delete, func, or_, select, text, update
from sqlalchemy.exc import IntegrityError, OperationalError

from db import AsyncSessionLocal
from db.models import AuthSessions, Locations, UserRole, Users

_pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
_username_regex = re.compile(r"^[a-zA-Z0-9._-]{3,64}$")

_session_ttl_default_days = 15
_session_ttl_keep_active_days = 365
_max_failed_logins = 5
_lock_minutes = 10
_setup_cache_ttl_seconds = 3.0
_setup_cache: Dict[str, Any] = {"value": True, "expires_at": 0.0}
_sqlite_lock_retry_delays_seconds = (0.25, 0.5, 1.0, 2.0)
AUTH_SESSION_COOKIE_NAME = "gs_session"
# Socket.IO room used for authenticated-only broadcasts.
AUTHENTICATED_SOCKET_ROOM = "authenticated"
SETUP_MODE_NONE = "none"
SETUP_MODE_FULL = "full_setup"
SETUP_MODE_ADMIN_RECOVERY = "admin_recovery"
logger = logging.getLogger(__name__)

setup_allowed_commands = {
    "get-locations",
    # Setup mode exposes only setup-scoped commands until the first admin exists.
    "setup.restore",
    "setup.finalize",
    "setup.status",
}

# Commands that can significantly alter global system state are admin-only.
admin_only_commands = {
    "update-app-config",
    "update-system-preferences",
    "sync-satellite-data",
    "background-task.start",
    "background-task.stop",
    "service.restart_service",
    "submit-camera",
    "edit-camera",
    "delete-camera",
    "submit-location",
    "edit-location",
    "delete-location",
    "submit-rig",
    "edit-rig",
    "delete-rig",
    "submit-rotator",
    "edit-rotator",
    "delete-rotator",
    "submit-sdr",
    "edit-sdr",
    "delete-sdr",
    "submit-orbital-sources",
    "edit-orbital-source",
    "delete-orbital-sources",
    "submit-tle-sources",
    "edit-tle-source",
    "delete-tle-sources",
    "submit-satellite",
    "edit-satellite",
    "delete-satellite",
    "submit-satellite-group",
    "edit-satellite-group",
    "delete-satellite-group",
    "submit-transmitter",
    "edit-transmitter",
    "delete-transmitter",
}

admin_only_prefixes = (
    "database-backup.",
    "transmitter-import.",
)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _normalize_username(username: str) -> str:
    return str(username or "").strip().lower()


def _normalize_role(role: str | None) -> str:
    value = str(role or "").strip().lower()
    admin_role = str(UserRole.ADMIN.value)
    operator_role = str(UserRole.OPERATOR.value)
    if value == admin_role:
        return admin_role
    if value == operator_role:
        return operator_role
    raise ValueError("Invalid role. Expected 'admin' or 'operator'.")


def _validate_username(username: str) -> str:
    normalized = _normalize_username(username)
    if not _username_regex.match(normalized):
        raise ValueError(
            "Username must be 3-64 chars and use only letters, numbers, '.', '_' or '-'."
        )
    return normalized


def _validate_password(password: str) -> str:
    value = str(password or "")
    if len(value) < 8:
        raise ValueError("Password must be at least 8 characters long.")
    return value


def _serialize_user(user: Users) -> Dict[str, Any]:
    return {
        "id": str(user.id),
        "username": user.username,
        "role": user.role,
        "is_active": bool(user.is_active),
        "last_login_at": user.last_login_at.isoformat() if user.last_login_at else None,
        "created_at": user.created_at.isoformat() if user.created_at else None,
        "updated_at": user.updated_at.isoformat() if user.updated_at else None,
    }


def _to_uuid(value: Optional[str]) -> Optional[uuid.UUID]:
    if value is None:
        return None
    return uuid.UUID(str(value))


def hash_password(password: str) -> str:
    return str(_pwd_context.hash(password))


def verify_password(password: str, password_hash: str) -> bool:
    return bool(_pwd_context.verify(password, password_hash))


def extract_socket_token(auth_payload: Any) -> Optional[str]:
    if isinstance(auth_payload, dict):
        token = auth_payload.get("token")
    elif isinstance(auth_payload, str):
        token = auth_payload
    else:
        token = None

    if token is None:
        return None
    value = str(token).strip()
    return value or None


def coerce_keep_session_active(value: Any) -> bool:
    """Normalize login payload values into a strict boolean flag."""
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"1", "true", "yes", "on"}:
            return True
        if normalized in {"0", "false", "no", "off", ""}:
            return False
    return False


def extract_bearer_token(authorization_header: Optional[str]) -> Optional[str]:
    if not authorization_header:
        return None

    parts = authorization_header.strip().split(" ", 1)
    if len(parts) != 2:
        return None

    scheme, token = parts
    if scheme.lower() != "bearer":
        return None

    value = token.strip()
    return value or None


def extract_cookie_token(cookie_value: Any) -> Optional[str]:
    if cookie_value is None:
        return None

    value = str(cookie_value).strip()
    return value or None


def extract_session_cookie_token(cookie_header: Optional[str]) -> Optional[str]:
    """Extract the auth session token from a raw Cookie header."""
    if not cookie_header:
        return None

    jar = SimpleCookie()
    try:
        jar.load(str(cookie_header))
    except Exception:
        return None

    morsel = jar.get(AUTH_SESSION_COOKIE_NAME)
    if morsel is None:
        return None

    return extract_cookie_token(morsel.value)


def is_admin_role(role: Optional[str]) -> bool:
    admin_role = str(UserRole.ADMIN.value)
    return str(role or "").strip().lower() == admin_role


def is_command_allowed_for_role(command: str, role: str) -> bool:
    normalized_command = str(command or "").strip()
    normalized_role = str(role or "").strip().lower()

    if normalized_role == UserRole.ADMIN.value:
        return True

    if normalized_role != UserRole.OPERATOR.value:
        return False

    if normalized_command in admin_only_commands:
        return False

    if any(normalized_command.startswith(prefix) for prefix in admin_only_prefixes):
        return False

    return True


def is_command_allowed_during_setup(command: str) -> bool:
    return str(command or "").strip() in setup_allowed_commands


async def is_setup_required(force_refresh: bool = False) -> bool:
    now_ts = time.monotonic()
    if not force_refresh and now_ts < float(_setup_cache["expires_at"]):
        return bool(_setup_cache["value"])

    async with AsyncSessionLocal() as session:
        count_result = await session.execute(select(func.count()).select_from(Users))
        users_count = int(count_result.scalar_one() or 0)

    setup_required = users_count == 0
    _setup_cache["value"] = setup_required
    _setup_cache["expires_at"] = now_ts + _setup_cache_ttl_seconds
    return setup_required


async def resolve_setup_mode(force_refresh: bool = False) -> str:
    """
    Classify setup UX surface when there are zero users.

    Existing deployments that lost users should not be forced through full first-time setup.
    We currently use persisted location presence as the migration-safe signal.
    """
    setup_required = await is_setup_required(force_refresh=force_refresh)
    if not setup_required:
        return SETUP_MODE_NONE

    try:
        async with AsyncSessionLocal() as session:
            existing_location_id = (
                await session.execute(select(Locations.id).limit(1))
            ).scalar_one_or_none()
            if existing_location_id is not None:
                return SETUP_MODE_ADMIN_RECOVERY
    except Exception:
        # Fall back to the full setup flow whenever detection cannot be evaluated.
        pass

    return SETUP_MODE_FULL


def _set_setup_cache(value: bool) -> None:
    _setup_cache["value"] = bool(value)
    _setup_cache["expires_at"] = time.monotonic() + _setup_cache_ttl_seconds


def _is_sqlite_locked_error(exc: OperationalError) -> bool:
    message = str(getattr(exc, "orig", exc) or "").strip().lower()
    return "database is locked" in message or "database table is locked" in message


async def _retry_after_sqlite_lock(
    exc: OperationalError,
    *,
    operation_name: str,
    attempt_index: int,
) -> bool:
    if not _is_sqlite_locked_error(exc):
        return False
    if attempt_index >= len(_sqlite_lock_retry_delays_seconds):
        return False

    delay_seconds = _sqlite_lock_retry_delays_seconds[attempt_index]
    logger.warning(
        "SQLite lock during %s, retrying in %.2fs (attempt %s/%s)",
        operation_name,
        delay_seconds,
        attempt_index + 1,
        len(_sqlite_lock_retry_delays_seconds) + 1,
    )
    await asyncio.sleep(delay_seconds)
    return True


def _resolve_session_ttl_days(keep_session_active: bool) -> int:
    return _session_ttl_keep_active_days if keep_session_active else _session_ttl_default_days


async def _create_session(
    session: Any,
    user_id: uuid.UUID,
    client_ip: Optional[str] = None,
    user_agent: Optional[str] = None,
    session_ttl_days: Optional[int] = None,
) -> tuple[str, AuthSessions]:
    now = _utcnow()
    ttl_days = max(int(session_ttl_days or _session_ttl_default_days), 1)
    raw_token = secrets.token_urlsafe(48)
    session_row = AuthSessions(
        user_id=user_id,
        token_hash=_hash_token(raw_token),
        expires_at=now + timedelta(days=ttl_days),
        last_seen_at=now,
        created_ip=client_ip,
        created_user_agent=user_agent,
        created_at=now,
        updated_at=now,
    )
    session.add(session_row)
    await session.flush()
    return raw_token, session_row


async def bootstrap_admin(
    username: str,
    password: str,
    client_ip: Optional[str] = None,
    user_agent: Optional[str] = None,
) -> Dict[str, Any]:
    normalized_username = _validate_username(username)
    validated_password = _validate_password(password)
    now = _utcnow()
    max_attempts = len(_sqlite_lock_retry_delays_seconds) + 1

    for attempt_index in range(max_attempts):
        async with AsyncSessionLocal() as session:
            try:
                # BEGIN IMMEDIATE serializes bootstrap writes on SQLite so setup can only complete once.
                await session.execute(text("BEGIN IMMEDIATE"))
                count_result = await session.execute(select(func.count()).select_from(Users))
                users_count = int(count_result.scalar_one() or 0)
                if users_count > 0:
                    await session.rollback()
                    _set_setup_cache(False)
                    return {"success": False, "error": "Setup already completed."}

                user_row = Users(
                    username=normalized_username,
                    username_norm=normalized_username,
                    password_hash=hash_password(validated_password),
                    role=UserRole.ADMIN.value,
                    is_active=True,
                    created_at=now,
                    updated_at=now,
                )
                session.add(user_row)
                await session.flush()

                # Claim legacy bootstrap-scoped user preferences for this first admin.
                # This keeps pre-auth preference values after setup without runtime fallbacks.
                from crud import preferences as preferencescrud

                claim_reply = await preferencescrud.claim_bootstrap_preferences(
                    session, user_row.id
                )
                if not claim_reply.get("success"):
                    await session.rollback()
                    return {
                        "success": False,
                        "error": str(
                            claim_reply.get("error") or "Failed to claim bootstrap preferences."
                        ),
                    }

                token, _ = await _create_session(
                    session,
                    user_row.id,
                    client_ip=client_ip,
                    user_agent=user_agent,
                )

                await session.commit()
                _set_setup_cache(False)
                return {"success": True, "token": token, "user": _serialize_user(user_row)}
            except IntegrityError:
                await session.rollback()
                return {"success": False, "error": "Username already exists."}
            except ValueError as exc:
                await session.rollback()
                return {"success": False, "error": str(exc)}
            except OperationalError as exc:
                await session.rollback()
                should_retry = await _retry_after_sqlite_lock(
                    exc,
                    operation_name="bootstrap_admin",
                    attempt_index=attempt_index,
                )
                if should_retry:
                    continue
                raise
            except Exception:
                await session.rollback()
                raise

    raise RuntimeError("bootstrap_admin retry loop exhausted unexpectedly")


async def login(
    username: str,
    password: str,
    client_ip: Optional[str] = None,
    user_agent: Optional[str] = None,
    keep_session_active: bool = False,
) -> Dict[str, Any]:
    if await is_setup_required():
        return {"success": False, "error": "Setup is required before login."}

    normalized_username = _normalize_username(username)
    if not normalized_username or not password:
        return {"success": False, "error": "Invalid username or password."}
    max_attempts = len(_sqlite_lock_retry_delays_seconds) + 1

    for attempt_index in range(max_attempts):
        async with AsyncSessionLocal() as session:
            try:
                stmt = select(Users).where(Users.username_norm == normalized_username).limit(1)
                user_row = (await session.execute(stmt)).scalar_one_or_none()
                now = _utcnow()

                if user_row is None:
                    return {"success": False, "error": "Invalid username or password."}

                if not user_row.is_active:
                    return {"success": False, "error": "User is disabled."}

                if user_row.locked_until and user_row.locked_until > now:
                    return {"success": False, "error": "User account is temporarily locked."}

                if not verify_password(password, user_row.password_hash):
                    user_row.failed_login_count = int(user_row.failed_login_count or 0) + 1
                    if user_row.failed_login_count >= _max_failed_logins:
                        user_row.failed_login_count = 0
                        user_row.locked_until = now + timedelta(minutes=_lock_minutes)
                    user_row.updated_at = now
                    await session.commit()
                    return {"success": False, "error": "Invalid username or password."}

                user_row.failed_login_count = 0
                user_row.locked_until = None
                user_row.last_login_at = now
                user_row.updated_at = now

                token, _ = await _create_session(
                    session,
                    user_row.id,
                    client_ip=client_ip,
                    user_agent=user_agent,
                    # Keep-auth checkbox extends token TTL to one year; otherwise 15 days.
                    session_ttl_days=_resolve_session_ttl_days(keep_session_active),
                )
                await session.commit()
                return {"success": True, "token": token, "user": _serialize_user(user_row)}
            except OperationalError as exc:
                await session.rollback()
                should_retry = await _retry_after_sqlite_lock(
                    exc,
                    operation_name="login",
                    attempt_index=attempt_index,
                )
                if should_retry:
                    continue
                raise

    raise RuntimeError("login retry loop exhausted unexpectedly")


async def authenticate_token(
    token: Optional[str], touch_last_seen: bool = True
) -> Optional[Dict[str, Any]]:
    if not token:
        return None

    token_hash = _hash_token(token)
    now = _utcnow()

    async with AsyncSessionLocal() as session:
        stmt = (
            select(AuthSessions, Users)
            .join(Users, Users.id == AuthSessions.user_id)
            .where(
                and_(
                    AuthSessions.token_hash == token_hash,
                    AuthSessions.revoked_at.is_(None),
                    AuthSessions.expires_at > now,
                    Users.is_active.is_(True),
                )
            )
            .limit(1)
        )
        row = (await session.execute(stmt)).first()
        if row is None:
            return None

        auth_session: AuthSessions = row[0]
        user_row: Users = row[1]

        if touch_last_seen:
            auth_session.last_seen_at = now
            auth_session.updated_at = now
            try:
                await session.commit()
            except OperationalError as exc:
                await session.rollback()
                if not _is_sqlite_locked_error(exc):
                    raise
                # Last-seen updates are best-effort and should not break valid auth checks.

        return {
            "session_id": str(auth_session.id),
            "user_id": str(user_row.id),
            "username": user_row.username,
            "role": user_row.role,
            "is_active": bool(user_row.is_active),
        }


async def logout(token: Optional[str], reason: str = "logout") -> None:
    if not token:
        return

    token_hash = _hash_token(token)
    now = _utcnow()
    max_attempts = len(_sqlite_lock_retry_delays_seconds) + 1

    for attempt_index in range(max_attempts):
        async with AsyncSessionLocal() as session:
            try:
                await session.execute(
                    update(AuthSessions)
                    .where(
                        and_(
                            AuthSessions.token_hash == token_hash, AuthSessions.revoked_at.is_(None)
                        )
                    )
                    .values(
                        revoked_at=now,
                        revoke_reason=reason,
                        updated_at=now,
                    )
                )
                await session.commit()
                return
            except OperationalError as exc:
                await session.rollback()
                should_retry = await _retry_after_sqlite_lock(
                    exc,
                    operation_name="logout",
                    attempt_index=attempt_index,
                )
                if should_retry:
                    continue
                raise

    raise RuntimeError("logout retry loop exhausted unexpectedly")


async def trim_inactive_auth_sessions(keep_last: int = 300) -> Dict[str, Any]:
    """
    Keep a bounded history of inactive auth sessions.

    Inactive sessions are revoked or expired rows. Active sessions are never deleted.
    """
    keep_count = max(int(keep_last), 0)
    now = _utcnow()

    async with AsyncSessionLocal() as session:
        # Select stale/inactive sessions ordered newest -> oldest, then keep only the newest N.
        # Anything after that offset is safe to delete without impacting active logins.
        stale_ids_stmt = (
            select(AuthSessions.id)
            .where(or_(AuthSessions.revoked_at.isnot(None), AuthSessions.expires_at <= now))
            .order_by(AuthSessions.updated_at.desc(), AuthSessions.created_at.desc())
            .offset(keep_count)
        )
        stale_ids = list((await session.execute(stale_ids_stmt)).scalars().all())
        if not stale_ids:
            return {"success": True, "deleted": 0, "kept": keep_count}

        await session.execute(delete(AuthSessions).where(AuthSessions.id.in_(stale_ids)))
        await session.commit()
        return {"success": True, "deleted": len(stale_ids), "kept": keep_count}


async def list_users() -> Dict[str, Any]:
    async with AsyncSessionLocal() as session:
        rows = (
            (await session.execute(select(Users).order_by(Users.created_at.asc()))).scalars().all()
        )
        return {"success": True, "data": [_serialize_user(row) for row in rows]}


async def create_user(
    username: str,
    password: str,
    role: str,
    actor_user_id: Optional[str] = None,
) -> Dict[str, Any]:
    normalized_username = _validate_username(username)
    validated_password = _validate_password(password)
    normalized_role = _normalize_role(role)
    now = _utcnow()
    actor_id = _to_uuid(actor_user_id) if actor_user_id else None

    async with AsyncSessionLocal() as session:
        try:
            existing = (
                await session.execute(
                    select(Users).where(Users.username_norm == normalized_username).limit(1)
                )
            ).scalar_one_or_none()
            if existing:
                return {"success": False, "error": "Username already exists."}

            user_row = Users(
                username=normalized_username,
                username_norm=normalized_username,
                password_hash=hash_password(validated_password),
                role=normalized_role,
                is_active=True,
                created_by_user_id=actor_id,
                updated_by_user_id=actor_id,
                created_at=now,
                updated_at=now,
            )
            session.add(user_row)
            await session.commit()
            await session.refresh(user_row)
            return {"success": True, "data": _serialize_user(user_row)}
        except IntegrityError:
            await session.rollback()
            return {"success": False, "error": "Username already exists."}


async def update_user(
    user_id: str,
    role: Optional[str] = None,
    is_active: Optional[bool] = None,
    actor_user_id: Optional[str] = None,
) -> Dict[str, Any]:
    target_id = _to_uuid(user_id)
    actor_id = _to_uuid(actor_user_id) if actor_user_id else None
    now = _utcnow()

    async with AsyncSessionLocal() as session:
        user_row = (
            await session.execute(select(Users).where(Users.id == target_id).limit(1))
        ).scalar_one_or_none()
        if user_row is None:
            return {"success": False, "error": "User not found."}

        next_role = user_row.role if role is None else _normalize_role(role)
        next_active = bool(user_row.is_active if is_active is None else is_active)

        # Keep at least one active admin at all times.
        is_target_active_admin = user_row.role == UserRole.ADMIN.value and bool(user_row.is_active)
        is_demoting_or_deactivating_admin = is_target_active_admin and (
            next_role != UserRole.ADMIN.value or not next_active
        )
        if is_demoting_or_deactivating_admin:
            admin_count = (
                await session.execute(
                    select(func.count())
                    .select_from(Users)
                    .where(
                        and_(
                            Users.role == UserRole.ADMIN.value,
                            Users.is_active.is_(True),
                            Users.id != user_row.id,
                        )
                    )
                )
            ).scalar_one()
            if int(admin_count or 0) == 0:
                return {"success": False, "error": "At least one active admin is required."}

        user_row.role = next_role
        user_row.is_active = next_active
        user_row.updated_by_user_id = actor_id
        user_row.updated_at = now
        await session.commit()
        await session.refresh(user_row)
        return {"success": True, "data": _serialize_user(user_row)}


async def reset_user_password(
    user_id: str,
    new_password: str,
    actor_user_id: Optional[str] = None,
) -> Dict[str, Any]:
    target_id = _to_uuid(user_id)
    validated_password = _validate_password(new_password)
    actor_id = _to_uuid(actor_user_id) if actor_user_id else None
    now = _utcnow()

    async with AsyncSessionLocal() as session:
        user_row = (
            await session.execute(select(Users).where(Users.id == target_id).limit(1))
        ).scalar_one_or_none()
        if user_row is None:
            return {"success": False, "error": "User not found."}

        user_row.password_hash = hash_password(validated_password)
        user_row.failed_login_count = 0
        user_row.locked_until = None
        user_row.updated_by_user_id = actor_id
        user_row.updated_at = now

        await session.execute(
            update(AuthSessions)
            .where(and_(AuthSessions.user_id == user_row.id, AuthSessions.revoked_at.is_(None)))
            .values(
                revoked_at=now,
                revoke_reason="password_reset",
                updated_at=now,
            )
        )
        await session.commit()
        await session.refresh(user_row)
        return {"success": True, "data": _serialize_user(user_row)}


async def delete_user(
    user_id: str,
    actor_user_id: Optional[str] = None,
) -> Dict[str, Any]:
    target_id = _to_uuid(user_id)
    actor_id = _to_uuid(actor_user_id) if actor_user_id else None

    if actor_id and target_id == actor_id:
        return {"success": False, "error": "You cannot delete your own account."}

    async with AsyncSessionLocal() as session:
        user_row = (
            await session.execute(select(Users).where(Users.id == target_id).limit(1))
        ).scalar_one_or_none()
        if user_row is None:
            return {"success": False, "error": "User not found."}

        if user_row.role == UserRole.ADMIN.value and bool(user_row.is_active):
            admin_count = (
                await session.execute(
                    select(func.count())
                    .select_from(Users)
                    .where(
                        and_(
                            Users.role == UserRole.ADMIN.value,
                            Users.is_active.is_(True),
                            Users.id != user_row.id,
                        )
                    )
                )
            ).scalar_one()
            if int(admin_count or 0) == 0:
                return {"success": False, "error": "At least one active admin is required."}

        await session.execute(delete(Users).where(Users.id == user_row.id))
        await session.commit()
        return {"success": True, "data": {"id": str(user_row.id), "username": user_row.username}}
