# Copyright (c) 2026 Efstratios Goudelis
# SPDX-License-Identifier: GPL-3.0-or-later

"""One consent-gated, six-hour poller and a shared disposable SQL event cache."""

import asyncio
import copy
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
        self.consent = EventsConsent(path)
        self.identity = identity or InstallationIdentity(
            Path(path).parent.parent / "installationid.json"
        )
        self.sessions = sessions
        self.lock = asyncio.Lock()
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
            "enabled": bool(self.consent.active),
            "terms_version": TERMS_VERSION,
            "accepted_terms_version": state["accepted_terms_version"],
            "needs_consent_review": bool(
                state["enabled"] and state["accepted_terms_version"] != TERMS_VERSION
            ),
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
            return self._status()

    async def configure(self, choice, actor=None):
        if (
            not isinstance(choice, dict)
            or set(choice) - {"enabled", "terms_version"}
            or type(choice.get("enabled")) is not bool
        ):
            raise ValueError("Invalid external event settings")
        if choice["enabled"] and choice.get("terms_version") != TERMS_VERSION:
            raise ValueError("Accept the current event service terms before enabling")
        async with self.lock:
            previous = copy.deepcopy(self.consent.state)
            if choice["enabled"] and self.consent.active:
                return self._status()
            if choice["enabled"]:
                self.identity.credentials()
            self.consent.state.update(enabled=choice["enabled"], next_poll_at=0, error=None)
            if choice["enabled"]:
                self.consent.state.update(grant_pending=True, deletion_pending=False)
                self.consent.state.update(
                    accepted_terms_version=TERMS_VERSION,
                    accepted_at=datetime.now(timezone.utc).isoformat(),
                    accepted_by=actor,
                )
            if not choice["enabled"]:
                self.consent.state["deletion_pending"] = self.consent.state["remote_possible"]
                self.consent.state["grant_pending"] = False
            try:
                self.consent.save()
            except OSError as exc:
                self.consent.state = previous
                self.consent.storage_error = True
                # Fail closed even if permission could not be saved or revoked.
                if self.fetch_task:
                    self.fetch_task.cancel()
                raise ValueError("Could not safely save external event consent") from exc
            self.consent.storage_error = False
            self.generation += 1
            if self.fetch_task:
                self.fetch_task.cancel()
            if not choice["enabled"]:
                # Persist disabled before SQL cleanup. A cleanup error cannot
                # resurrect network permission or expose cached announcements.
                self.consent.state.update(
                    coverage_start=None, coverage_end=None, last_success_at=None
                )
                try:
                    async with self.sessions() as session:
                        await session.execute(delete(CachedExternalEvents))
                        await session.commit()
                    self.consent.save()
                except Exception:
                    self.consent.state["error"] = "cache_clear_failed"
                    self.pruned_day = None
                    logger.error("External event cache cleanup failed; service remains disabled")
            self.wake.set()
            return self._status()

    async def cached_events(self, session, window):
        async with self.lock:
            status = self._status(window)
            if not self.consent.active:
                return [], status
            first, last = rolling_window(time.time())
            try:
                rows = (
                    (
                        await session.execute(
                            select(CachedExternalEvents).where(
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
                    # SQL dates over-select precise instants; compare against
                    # the user's actual timezone-aware day boundaries.
                    if isinstance(event.start, datetime):
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
            self.consent.save()
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

    async def tick(self, client, now=None):
        now = time.time() if now is None else now
        first, last = rolling_window(now)
        async with self.lock:
            # Withdrawal is the sole request permitted after opt-out. Persist
            # its retry state independently of the disabled polling schedule.
            if self.consent.state["deletion_pending"] and not self.consent.storage_error:
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
                self.consent.save()
                return False
            # Also remove expired rows while offline, without waiting for a
            # successful download. Calendar reads enforce the same rolling bound.
            if self.pruned_day != first:
                await self._prune(now)
                self.pruned_day = first
            if (
                not self.consent.active
                or now < self.consent.state["next_poll_at"]
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
                # failures cannot turn the six-hour schedule into rapid retries.
                self.consent.save()
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
        except (httpx.RequestError, ValueError, TimeoutError):
            error = "service_unavailable"
        finally:
            # Only the owner may release a request after disable/re-enable.
            if self.fetch_task is task:
                self.fetch_task = None

        async with self.lock:
            if generation != self.generation or not self.consent.active:
                return False
            if snapshot is not None:
                try:
                    async with self.sessions() as session:
                        await session.execute(delete(CachedExternalEvents))
                        for event in snapshot.events:
                            if isinstance(event.start, datetime) and isinstance(
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
                                    start_date=event_first,
                                    end_date=event_last,
                                    payload=event.calendar_payload(),
                                    fetched_at=datetime.fromtimestamp(now, timezone.utc),
                                )
                            )
                        # One complete transaction replaces the full window,
                        # removing withdrawn approvals and absent event IDs.
                        await session.commit()
                    self.consent.state.update(
                        last_success_at=datetime.fromtimestamp(now, timezone.utc).isoformat(),
                        coverage_start=str(first),
                        coverage_end=str(last),
                    )
                except Exception:
                    error = "cache_write_failed"
                    logger.error("External event cache update failed")
            self.consent.state["error"] = error
            self.consent.state["next_poll_at"] = max(
                self.consent.state["next_poll_at"], now + retry_after
            )
            try:
                self.consent.save()
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
