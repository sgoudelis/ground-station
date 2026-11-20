# Copyright (c) 2026 Efstratios Goudelis
# SPDX-License-Identifier: GPL-3.0-or-later

"""Transactional station settings and shared consent; JSON is read only for migration."""

import json
import math
import os
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import delete, inspect, select, update

from calendars.protocol import EXTERNAL_FEEDS, TERMS_VERSION
from common.arguments import arguments
from db.models import CachedExternalEvents, CalendarFeeds, CalendarServices


def state_path():
    if os.environ.get("GS_EVENTS_STATE"):
        return Path(os.environ["GS_EVENTS_STATE"])
    if getattr(arguments, "temp_db", False):
        return Path(arguments.db).with_suffix(".events") / "state.json"
    return Path(__file__).parents[1] / "data" / "events" / "state.json"


def default_state():
    return dict(
        enabled=False,
        installation_id=None,
        accepted_terms_version=None,
        accepted_at=None,
        accepted_by=None,
        revoked_at=None,
        grant_pending=False,
        deletion_pending=False,
        remote_possible=False,
        last_attempt_at=None,
        last_success_at=None,
        next_poll_at=0,
        retry_after_at=0,
        coverage_start=None,
        coverage_end=None,
        error=None,
        feed_status={},
    )


def legacy_state(path):
    """An invalid legacy receipt must never become permission to use the network."""
    try:
        stored = json.loads(Path(path).read_text())
    except FileNotFoundError:
        return default_state()
    if not isinstance(stored, dict) or type(stored.get("enabled")) is not bool:
        raise ValueError("Invalid legacy consent")
    state = default_state()
    for key in state:
        if key in stored:
            state[key] = stored[key]
    for key in ("enabled", "grant_pending", "deletion_pending", "remote_possible"):
        if type(state[key]) is not bool:
            raise ValueError("Invalid legacy consent")
    for key in ("next_poll_at", "retry_after_at"):
        if type(state[key]) not in (int, float) or not math.isfinite(state[key]) or state[key] < 0:
            raise ValueError("Invalid legacy polling time")
    for key in ("accepted_at", "last_attempt_at", "last_success_at"):
        if state[key] is not None and datetime.fromisoformat(state[key]).tzinfo is None:
            raise ValueError("Invalid legacy timestamp")
    if state["enabled"] and not state["accepted_at"]:
        raise ValueError("Missing legacy acceptance")
    return state


class EventsConsent:
    def __init__(self, path, sessions, identity):
        self.path, self.sessions, self.identity = Path(path), sessions, identity
        self.state, self.feeds, self.revision = default_state(), {}, 0
        self.storage_error = False
        self.blocked = False

    def identity_id(self):
        # Reading settings never creates a new installation identity.
        try:
            return json.loads(self.identity.path.read_text())["installation_id"]
        except (OSError, ValueError, KeyError, TypeError):
            return None

    @property
    def active(self):
        return bool(
            self.state["enabled"]
            and not self.state["revoked_at"]
            and self.state["accepted_terms_version"] == TERMS_VERSION
            and self.state["accepted_at"]
            and self.state["installation_id"]
            and self.state["installation_id"] == self.identity_id()
            and not self.storage_error
        )

    @property
    def selected(self):
        return any(self.feeds.get(feed, False) for feed in EXTERNAL_FEEDS)

    async def load(self):
        try:
            async with self.sessions() as session:
                row = await session.get(CalendarServices, "gscontrol")
                migrated = row is None
                if row is None:
                    try:
                        state = legacy_state(self.path)
                    except (OSError, ValueError, TypeError):
                        state = default_state()
                        state["error"] = "legacy_consent_invalid"
                    state["installation_id"] = self.identity_id()
                    # A receipt without its original identity cannot authorize a clone.
                    if not state["installation_id"]:
                        state["enabled"] = False
                    row = CalendarServices(id="gscontrol", revision=0, **state)
                    session.add(row)
                    for feed in ("observations", *EXTERNAL_FEEDS):
                        session.add(
                            CalendarFeeds(
                                id=feed,
                                service_id=None if feed == "observations" else "gscontrol",
                                enabled=feed == "observations"
                                or (feed == "announcements" and state["enabled"]),
                            )
                        )
                    await session.commit()
                    await session.refresh(row)
                self.state = {key: getattr(row, key) for key in default_state()}
                self.revision = row.revision
                self.feeds = {
                    feed.id: feed.enabled
                    for feed in (await session.execute(select(CalendarFeeds))).scalars()
                }
                self.storage_error = self.blocked
            if migrated:
                # The durable database receipt is now authoritative. Removing the
                # obsolete input also prevents a later old-backup restore reimport.
                try:
                    self.path.unlink(missing_ok=True)
                except OSError:
                    pass
        except Exception as exc:
            self.storage_error = True
            raise OSError("Calendar settings database is unavailable") from exc

    async def save(self):
        try:
            async with self.sessions() as session:
                result = await session.execute(
                    update(CalendarServices)
                    .where(
                        CalendarServices.id == "gscontrol",
                        CalendarServices.revision == self.revision,
                    )
                    .values(
                        **self.state,
                        revision=self.revision + 1,
                        updated_at=datetime.now(timezone.utc),
                    )
                )
                if result.rowcount != 1:
                    raise OSError("Calendar settings changed concurrently")
                for feed, enabled in self.feeds.items():
                    await session.execute(
                        update(CalendarFeeds)
                        .where(CalendarFeeds.id == feed)
                        .values(enabled=enabled, updated_at=datetime.now(timezone.utc))
                    )
                await session.commit()
                self.revision += 1
                self.storage_error = False
                self.blocked = False
        except Exception as exc:
            self.storage_error = True
            self.blocked = True
            raise OSError("Could not save calendar settings") from exc


async def invalidate_consent(session):
    """A database import must not resurrect a previously withdrawn network grant."""
    # Old backups may predate these tables. Recreate them without importing JSON.
    connection = await session.connection()
    await connection.run_sync(lambda sync: CalendarServices.__table__.create(sync, checkfirst=True))
    await connection.run_sync(lambda sync: CalendarFeeds.__table__.create(sync, checkfirst=True))
    row = await session.get(CalendarServices, "gscontrol")
    if row is None:
        row = CalendarServices(id="gscontrol", **default_state())
        session.add(row)
    row.enabled, row.grant_pending = False, False
    row.revoked_at = datetime.now(timezone.utc).isoformat()
    row.revision = (row.revision or 0) + 1
    row.next_poll_at = 0
    row.deletion_pending = bool(row.remote_possible)
    for feed in EXTERNAL_FEEDS:
        existing = await session.get(CalendarFeeds, feed)
        if existing:
            existing.enabled = False
        else:
            session.add(CalendarFeeds(id=feed, service_id="gscontrol", enabled=False))
    if await session.get(CalendarFeeds, "observations") is None:
        session.add(CalendarFeeds(id="observations", enabled=True))
    # A full restore can contain an older version of the cache schema.
    if await connection.run_sync(lambda sync: inspect(sync).has_table("cached_external_events")):
        await session.execute(delete(CachedExternalEvents))
