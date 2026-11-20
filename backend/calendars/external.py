# Copyright (c) 2026 Efstratios Goudelis
# SPDX-License-Identifier: GPL-3.0-or-later

"""One consent-gated bundled poller and a shared disposable SQL event cache."""

import asyncio
import logging
import math
import time
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path

import httpx
from sqlalchemy import delete, select

from calendars.consent import EventsConsent, state_path
from calendars.protocol import (
    EVENTS_URL,
    EXTERNAL_FEEDS,
    FUTURE_DAYS,
    PAST_DAYS,
    POLL_SECONDS,
    SOURCE,
    TERMS_VERSION,
    EventSnapshot,
)
from calendars.schemas import CalendarEvent
from db import AsyncSessionLocal
from db.models import CachedExternalEvents
from feedback.payload import reporting_environment
from installationid import REGISTRY_URL, InstallationIdentity, installation_identity

logger = logging.getLogger("calendar.events")
MAX_BYTES = 8 * 1024 * 1024


def rolling_window(now):
    today = datetime.fromtimestamp(now, timezone.utc).date()
    return today - timedelta(days=PAST_DAYS), today + timedelta(days=FUTURE_DAYS)


class ExternalEventsService:
    def __init__(self, path, sessions=AsyncSessionLocal, identity=None):
        self.identity = identity or InstallationIdentity(
            Path(path).parent.parent / "installationid.json"
        )
        self.consent = EventsConsent(path, sessions, self.identity)
        self.sessions = sessions
        self.lock = asyncio.Lock()
        self.poll_lock = asyncio.Lock()
        self.poll_revision = 0
        self.wake = asyncio.Event()
        self.generation = 0
        self.fetch_task: asyncio.Task | None = None
        self.pruned_day = None

    def _status(self, window=None):
        state = self.consent.state
        coverage_start, coverage_end = state["coverage_start"], state["coverage_end"]
        if coverage_start and coverage_end:
            first, last = rolling_window(time.time())
            # Old snapshots cannot claim coverage for dates already pruned
            # from the rolling cache during a provider outage.
            coverage_start = max(coverage_start, str(first))
            coverage_end = min(coverage_end, str(last))
        return {
            "id": SOURCE,
            "enabled": bool(self.consent.active and self.consent.selected),
            "consented": bool(self.consent.active),
            "feeds": [
                {"id": feed, "enabled": enabled} for feed, enabled in self.consent.feeds.items()
            ],
            "feed_status": state["feed_status"],
            "terms_version": TERMS_VERSION,
            "accepted_terms_version": state["accepted_terms_version"],
            "needs_consent_review": bool(state["enabled"] and not self.consent.active),
            "storage_error": self.consent.storage_error,
            "deletion_pending": state["deletion_pending"],
            "service_url": EVENTS_URL,
            "poll_seconds": POLL_SECONDS,
            "last_success_at": state["last_success_at"],
            "next_poll_at": state["next_poll_at"],
            "error": state["error"],
            "stale": bool(
                state["last_success_at"]
                and time.time()
                >= datetime.fromisoformat(state["last_success_at"]).timestamp() + POLL_SECONDS
            ),
            "coverage_start": coverage_start,
            "coverage_end": coverage_end,
            "outside_coverage": bool(
                window
                and coverage_start
                and coverage_end
                and (str(window.start) < coverage_start or str(window.end) > coverage_end)
            ),
        }

    async def status(self):
        async with self.lock:
            try:
                await self.consent.load()
            except OSError:
                pass
            return self._status()

    async def configure(self, choice, actor=None):
        if not isinstance(choice, dict) or set(choice) - {
            "enabled",
            "terms_version",
            "feed_id",
            "revoke",
        }:
            raise ValueError("Invalid calendar feed settings")
        revoke = choice.get("revoke", False)
        feed = choice.get("feed_id", "announcements")
        if type(revoke) is not bool or feed not in ("observations", *EXTERNAL_FEEDS):
            raise ValueError("Unknown calendar feed")
        if not revoke and type(choice.get("enabled")) is not bool:
            raise ValueError("Invalid calendar feed setting")
        async with self.lock:
            await self.consent.load()
            # Decide against the latest station settings, not a browser's
            # possibly stale switches. Local observations never affect consent.
            if (
                not revoke
                and feed in EXTERNAL_FEEDS
                and not choice["enabled"]
                and self.consent.state["enabled"]
                and not any(self.consent.feeds.get(name) for name in EXTERNAL_FEEDS if name != feed)
            ):
                revoke = True
            if (
                not revoke
                and self.consent.feeds.get(feed) == choice["enabled"]
                and (feed == "observations" or self.consent.active)
            ):
                return self._status()
            if choice.get("enabled") and feed in EXTERNAL_FEEDS and not self.consent.active:
                if choice.get("terms_version") != TERMS_VERSION:
                    raise ValueError(
                        "Accept the current external calendar service terms before enabling"
                    )
                identity = self.identity.credentials()
                self.consent.state.update(
                    enabled=True,
                    installation_id=identity["installation_id"],
                    accepted_terms_version=TERMS_VERSION,
                    accepted_at=datetime.now(timezone.utc).isoformat(),
                    accepted_by=actor,
                    revoked_at=None,
                    grant_pending=True,
                    deletion_pending=False,
                )
            if revoke:
                self.consent.state.update(
                    enabled=False,
                    grant_pending=False,
                    revoked_at=datetime.now(timezone.utc).isoformat(),
                    deletion_pending=self.consent.state["remote_possible"],
                )
                for name in EXTERNAL_FEEDS:
                    self.consent.feeds[name] = False
            else:
                self.consent.feeds[feed] = choice["enabled"]
            self.consent.state.update(next_poll_at=0, error=None)
            try:
                # Selection and its shared acceptance are one SQL transaction.
                await self.consent.save()
            except OSError as exc:
                self.consent.storage_error = self.consent.blocked = True
                if self.fetch_task:
                    self.fetch_task.cancel()
                raise ValueError("Could not save calendar feed settings") from exc
            self.generation += 1
            if self.fetch_task:
                self.fetch_task.cancel()
            if revoke:
                async with self.sessions() as session:
                    await session.execute(delete(CachedExternalEvents))
                    await session.commit()
            self.wake.set()
            return self._status()

    async def cached_events(self, session, window):
        async with self.lock:
            try:
                await self.consent.load()
            except OSError:
                return [], self._status(window)
            status = self._status(window)
            if not self.consent.active:
                return [], status
            first, last = rolling_window(time.time())
            try:
                rows = (
                    (
                        await session.execute(
                            select(CachedExternalEvents).where(
                                CachedExternalEvents.feed_id.in_(
                                    [
                                        feed
                                        for feed in EXTERNAL_FEEDS
                                        if self.consent.feeds.get(feed)
                                    ]
                                ),
                                (
                                    (CachedExternalEvents.expires_at.is_(None))
                                    | (
                                        CachedExternalEvents.expires_at
                                        > datetime.fromtimestamp(time.time(), timezone.utc)
                                    )
                                ),
                                CachedExternalEvents.start_date < window.end + timedelta(days=1),
                                CachedExternalEvents.end_date > window.start - timedelta(days=1),
                                CachedExternalEvents.start_date < last,
                                CachedExternalEvents.end_date > first,
                            )
                        )
                    )
                    .scalars()
                    .all()
                )
                start, end = window.utc_bounds()
                events = []
                for row in rows:
                    event = CalendarEvent.model_validate(row.payload)
                    if not event.has_known_date:
                        continue  # Hide estimates already cached before the source fix.
                    # SQL dates over-select precise instants; compare against
                    # the user's actual timezone-aware day boundaries.
                    if event.start_at is not None:
                        # Without an end instant this is a start marker, not a
                        # window lasting until the civil-date coverage end.
                        overlaps = start <= event.start_at < end
                    elif isinstance(event.start, datetime):
                        overlaps = event.start < end and event.end > start
                    else:
                        overlaps = event.start < window.end and event.end > window.start
                    if overlaps:
                        events.append(event.model_dump(mode="json"))
            except Exception:
                # Optional remote data must not prevent local observations
                # from rendering if a cache row or its table is unavailable.
                logger.error("External event cache could not be read")
                return [], {**status, "error": "cache_read_failed"}
            return events, status

    async def _fetch(self, client, first, last):
        identity = self.identity.credentials()
        if self.consent.state["grant_pending"]:
            await self.identity.enroll(client, "events", TERMS_VERSION)
            self.consent.state["grant_pending"] = False
            await self.consent.save()
        # Authentication is installation-wide. Local observations, accounts and
        # station coordinates never enter the event request.
        async with client.stream(
            "GET",
            EVENTS_URL + "/v1/events",
            params={"start": str(first), "end": str(last)},
            headers={
                "X-Installation-ID": identity["installation_id"],
                "Authorization": f"Bearer {identity['credential']}",
                "X-GS-Environment": reporting_environment(),
            },
        ) as response:
            response.raise_for_status()
            if response.status_code != 200:
                raise ValueError("Unexpected snapshot response")
            body = bytearray()
            async for chunk in response.aiter_bytes():
                body.extend(chunk)
                if len(body) > MAX_BYTES:
                    raise ValueError("Event snapshot too large")
            snapshot = EventSnapshot.model_validate_json(body)
            if snapshot.range.start != first or snapshot.range.end != last:
                raise ValueError("Incomplete snapshot coverage")
            return snapshot

    async def _prune(self, now):
        first, last = rolling_window(now)
        async with self.sessions() as session:
            if not self.consent.active:
                await session.execute(delete(CachedExternalEvents))
            else:
                await session.execute(
                    delete(CachedExternalEvents).where(
                        (CachedExternalEvents.end_date <= first)
                        | (CachedExternalEvents.start_date >= last)
                    )
                )
            await session.commit()

    async def refresh(self):
        async with httpx.AsyncClient(timeout=15, follow_redirects=False, trust_env=False) as client:
            try:
                return await self.tick(client, force=True)
            except OSError:
                return False

    async def tick(self, client, now=None, *, force=False):
        # A manual refresh joins an ongoing poll through its SQL commit, so its
        # caller reads the completed snapshot and does not start a second fetch.
        revision = self.poll_revision
        async with self.poll_lock:
            if force and revision != self.poll_revision:
                return False
            changed = await self._tick(client, now, force=force)
            if changed:
                self.poll_revision += 1
            return changed

    async def _tick(self, client, now=None, *, force=False):
        now = time.time() if now is None else now
        first, last = rolling_window(now)
        async with self.lock:
            await self.consent.load()
            # Refreshing the calendar cannot grant consent or trigger requests
            # for a disabled source, including pending consent withdrawals.
            if force and not (self.consent.active and self.consent.selected):
                return False
            # Withdrawal is the sole request permitted after opt-out. Persist
            # its retry state independently of the disabled polling schedule.
            if self.consent.state["deletion_pending"] and not self.consent.storage_error:
                if self.consent.state["installation_id"] != self.consent.identity_id():
                    # A foreign database cannot authorize any network request,
                    # including a withdrawal using this installation's identity.
                    self.consent.state.update(deletion_pending=False, remote_possible=False)
                    await self.consent.save()
                    return False
                if now < self.consent.state["next_poll_at"]:
                    return False
                try:
                    identity = self.identity.credentials()
                    response = await client.delete(
                        REGISTRY_URL
                        + f"/v1/installations/{identity['installation_id']}/consents/events",
                        headers={"Authorization": f"Bearer {identity['credential']}"},
                    )
                    if response.status_code not in (204, 404):
                        response.raise_for_status()
                    self.consent.state.update(deletion_pending=False, remote_possible=False)
                except (httpx.HTTPError, OSError, ValueError):
                    self.consent.state["error"] = "service_unavailable"
                self.consent.state["next_poll_at"] = now + POLL_SECONDS
                await self.consent.save()
                return False
            # Also remove expired rows while offline, without waiting for a
            # successful download. Calendar reads enforce the same rolling bound.
            if self.pruned_day != first:
                await self._prune(now)
                self.pruned_day = first
            if (
                not self.consent.active
                or not self.consent.selected
                or (not force and now < self.consent.state["next_poll_at"])
                or now < self.consent.state["retry_after_at"]
                or self.fetch_task is not None
            ):
                return False
            self.consent.state.update(
                remote_possible=True,
                last_attempt_at=datetime.fromtimestamp(now, timezone.utc).isoformat(),
                next_poll_at=now + POLL_SECONDS,
            )
            try:
                # Reserve the next attempt before networking, so restarts and
                # failures cannot turn the polling schedule into rapid retries.
                await self.consent.save()
            except OSError:
                self.consent.storage_error = True
                return False
            generation = self.generation
            task = asyncio.create_task(self._fetch(client, first, last))
            self.fetch_task = task

        error = None
        snapshot = None
        retry_after = 0.0
        try:
            async with asyncio.timeout(45):
                snapshot = await task
        except asyncio.CancelledError:
            # Disabling cancels only the HTTP task; application shutdown cancels
            # this tick as well and must propagate to the backend lifecycle.
            current = asyncio.current_task()
            if current and current.cancelling():
                raise
            return False
        except httpx.HTTPStatusError as exc:
            error = "service_unavailable"
            if exc.response.status_code == 429:
                value = exc.response.headers.get("Retry-After", "")
                try:
                    seconds = float(value)
                    if math.isfinite(seconds):
                        retry_after = max(0, seconds)
                except ValueError:
                    try:
                        retry_after = max(0, parsedate_to_datetime(value).timestamp() - now)
                    except (ValueError, TypeError, OverflowError):
                        pass
        except (httpx.RequestError, ValueError, TimeoutError, OSError):
            error = "service_unavailable"
        finally:
            # Only the owner may release a request after disable/re-enable.
            if self.fetch_task is task:
                self.fetch_task = None

        async with self.lock:
            receipt_revision = self.consent.revision
            await self.consent.load()
            if (
                generation != self.generation
                or receipt_revision != self.consent.revision
                or not self.consent.active
            ):
                return False
            if snapshot is not None:
                try:
                    async with self.sessions() as session:
                        complete = {feed.id for feed in snapshot.feeds if feed.complete}
                        await session.execute(
                            delete(CachedExternalEvents).where(
                                CachedExternalEvents.feed_id.in_(complete)
                            )
                        )
                        for event in snapshot.events:
                            if event.feed_id not in complete or not event.has_known_date:
                                continue
                            if event.start_at is not None:
                                event_first = event.start_at.astimezone(timezone.utc).date()
                                event_last = event_first + timedelta(days=1)
                            elif isinstance(event.start, datetime) and isinstance(
                                event.end, datetime
                            ):
                                event_first = event.start.astimezone(timezone.utc).date()
                                event_last = event.end.astimezone(timezone.utc).date() + timedelta(
                                    days=1
                                )
                            else:
                                event_first, event_last = event.start, event.end
                            if event_first >= last or event_last <= first:
                                continue
                            session.add(
                                CachedExternalEvents(
                                    id=event.id,
                                    feed_id=event.feed_id,
                                    expires_at=event.expires_at,
                                    start_date=event_first,
                                    end_date=event_last,
                                    payload=event.calendar_payload(),
                                    fetched_at=datetime.fromtimestamp(now, timezone.utc),
                                )
                            )
                        # One complete transaction replaces the full window,
                        # removing withdrawn approvals and absent event IDs.
                        await session.commit()
                    self.consent.state["feed_status"] = {
                        feed.id: feed.model_dump(mode="json") for feed in snapshot.feeds
                    }
                    if any(
                        feed.error or feed.stale or not feed.complete for feed in snapshot.feeds
                    ):
                        error = "upstream_feed_unavailable"
                    self.consent.state["next_poll_at"] = now + snapshot.refresh_after_seconds
                    self.consent.state.update(
                        last_success_at=datetime.fromtimestamp(now, timezone.utc).isoformat(),
                        coverage_start=str(first),
                        coverage_end=str(last),
                    )
                except Exception:
                    error = "cache_write_failed"
                    logger.error("External event cache update failed")
            self.consent.state["error"] = error
            # Explicit refreshes bypass our polling interval, but still honor
            # the provider's Retry-After across refreshes and backend restarts.
            self.consent.state["retry_after_at"] = now + retry_after if retry_after else 0
            self.consent.state["next_poll_at"] = max(
                self.consent.state["next_poll_at"], now + retry_after
            )
            try:
                await self.consent.save()
            except OSError:
                self.consent.storage_error = True
            return True

    async def run(self, notify=None):
        # Creating a client makes no network requests. There are no health
        # probes, registrations, or other requests before explicit consent.
        async with httpx.AsyncClient(timeout=15, follow_redirects=False, trust_env=False) as client:
            while True:
                self.wake.clear()
                try:
                    changed = await self.tick(client)
                    if changed and notify:
                        await notify()
                except Exception:
                    logger.error("External event background update failed")
                try:
                    await asyncio.wait_for(self.wake.wait(), timeout=60)
                except TimeoutError:
                    pass


external_events = ExternalEventsService(state_path(), identity=installation_identity)
