# Copyright (c) 2026 Efstratios Goudelis
# SPDX-License-Identifier: GPL-3.0-or-later

"""Consent, cache replacement, and polling tests never contact the public service."""

import asyncio
import json
import os
import sqlite3
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, Mock

import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

from alembic import command
from alembic.config import Config
from calendars.consent import EventsConsent
from calendars.external import ExternalEventsService, rolling_window
from calendars.protocol import POLL_SECONDS, TERMS_VERSION
from calendars.schemas import CalendarRange
from common import auth
from db.models import CachedExternalEvents
from handlers.entities import calendar
from handlers.routing.dispatcher import dispatch_request
from handlers.routing.registry import HandlerRegistry

pytestmark = pytest.mark.unit
NOW = datetime(2026, 11, 18, 12, tzinfo=timezone.utc).timestamp()
OPT_IN = {"enabled": True, "terms_version": TERMS_VERSION}
WINDOW = CalendarRange(start="2026-11-18", end="2026-11-19")


@pytest.fixture
def service(tmp_path, db_engine, monkeypatch):
    monkeypatch.setattr("calendars.external.time.time", lambda: NOW)
    return ExternalEventsService(
        tmp_path / "events" / "state.json", async_sessionmaker(db_engine, expire_on_commit=False)
    )


def event(identity="sstv", **changes):
    return {
        "id": identity,
        "title": "ISS SSTV activity",
        "kind": "sstv",
        "start": "2026-11-18T10:00:00Z",
        "end": "2026-11-18T11:00:00Z",
        "review_status": "approved",
        "revision": 1,
        "satellites": [{"name": "ISS", "norad_id": 25544}],
        **changes,
    }


def client_for(events=None, handler=None):
    calls = []

    def handle(request):
        calls.append(request)
        if handler:
            return handler(request)
        return httpx.Response(
            200,
            json={
                "schema_version": 1,
                "range": dict(request.url.params),
                "events": events if events is not None else [event()],
            },
        )

    return httpx.AsyncClient(transport=httpx.MockTransport(handle)), calls


async def read_cache(service, window=WINDOW):
    async with service.sessions() as session:
        return await service.cached_events(session, window)


async def test_default_and_reads_make_no_external_requests(service):
    client, calls = client_for()
    async with client:
        await service.status()
        await read_cache(service)
        await service.tick(client)
        await service.tick(client, force=True)
    assert calls == []
    assert not service.consent.path.exists()


@pytest.mark.parametrize(
    "choice",
    [
        {},
        {"enabled": "true"},
        {"enabled": True},
        {**OPT_IN, "terms_version": "future"},
        {**OPT_IN, "user_id": "other"},
    ],
)
async def test_explicit_versioned_consent_required(service, choice):
    with pytest.raises(ValueError):
        await service.configure(choice)
    assert not service.consent.path.exists()


async def test_consent_is_atomic_private_and_separate_from_database(service):
    status = await service.configure(OPT_IN, actor="admin-id")
    stored = json.loads(service.consent.path.read_text())
    assert stored["enabled"] is True
    assert stored["accepted_by"] == "admin-id"
    assert stored["accepted_terms_version"] == TERMS_VERSION
    assert os.stat(service.consent.path).st_mode & 0o777 == 0o600
    assert "accepted_by" not in status
    assert EventsConsent(service.consent.path).active


async def test_poll_every_six_hours_and_restart_preserves_schedule(service):
    await service.configure(OPT_IN)
    client, calls = client_for()
    async with client:
        assert await service.tick(client, NOW)
        assert not await service.tick(client, NOW + POLL_SECONDS - 1)
        # Repeated enabling is idempotent and cannot bypass the interval.
        await service.configure(OPT_IN)
        restarted = ExternalEventsService(service.consent.path, service.sessions)
        assert not await restarted.tick(client, NOW + 100)
        assert await restarted.tick(client, NOW + POLL_SECONDS)
    assert [request.method for request in calls[:2]] == ["POST", "PUT"]
    calls = [request for request in calls if request.method == "GET"]
    assert len(calls) == 2
    first, last = rolling_window(NOW)
    assert dict(calls[0].url.params) == {"start": str(first), "end": str(last)}
    assert calls[0].url.host == "events.gscontrol.net"
    identity = service.identity.credentials()
    assert calls[0].headers["x-installation-id"] == identity["installation_id"]
    assert calls[0].headers["authorization"] == f"Bearer {identity['credential']}"
    assert calls[0].headers["x-gs-environment"] == "test"
    assert "cookie" not in calls[0].headers
    cached, status = await read_cache(service)
    assert cached[0]["id"] == "gscontrol:sstv"
    assert status["last_success_at"] is not None


async def test_snapshot_replaces_withdrawn_approval_and_never_touches_observations(service):
    await service.configure(OPT_IN)
    client, _ = client_for([event("first"), event("second")])
    async with client:
        await service.tick(client, NOW)
    client, _ = client_for([event("second", revision=2, title="Corrected activity")])
    async with client:
        await service.tick(client, NOW + POLL_SECONDS)
    cached, _ = await read_cache(service)
    assert [row["id"] for row in cached] == ["gscontrol:second"]
    assert cached[0]["title"] == "Corrected activity"


async def test_manual_refresh_replaces_snapshot_before_next_scheduled_poll(service):
    await service.configure(OPT_IN)
    client, _ = client_for([event("withdrawn")])
    async with client:
        await service.tick(client, NOW)
    client, calls = client_for([event("new", title="Latest announcement")])
    async with client:
        assert not await service.tick(client, NOW + 60)
        assert await service.tick(client, NOW + 60, force=True)
    cached, status = await read_cache(service)
    assert [row["id"] for row in cached] == ["gscontrol:new"]
    assert cached[0]["title"] == "Latest announcement"
    assert len(calls) == 1 and calls[0].method == "GET"
    assert status["next_poll_at"] == NOW + 60 + POLL_SECONDS


async def test_calendar_refresh_downloads_from_service_instead_of_only_reading_cache(
    service, monkeypatch
):
    await service.configure(OPT_IN)
    client, _ = client_for([event("old")])
    async with client:
        await service.tick(client, NOW)
    client, calls = client_for([event("latest")])
    factory = Mock(return_value=client)
    monkeypatch.setattr("calendars.external.httpx.AsyncClient", factory)
    monkeypatch.setattr(calendar, "external_events", service)
    monkeypatch.setattr(calendar, "AsyncSessionLocal", service.sessions)
    sio = Mock(emit=AsyncMock())
    response = await calendar.refresh_calendar_events(
        sio, WINDOW.model_dump(mode="json"), Mock(), "sid"
    )
    assert response["success"]
    assert [row["id"] for row in response["data"]["events"]] == ["gscontrol:latest"]
    assert len(calls) == 1 and calls[0].url.host == "events.gscontrol.net"
    factory.assert_called_once_with(timeout=15, follow_redirects=False, trust_env=False)
    sio.emit.assert_awaited_once_with(
        "external-events-changed", {}, room=auth.AUTHENTICATED_SOCKET_ROOM
    )


async def test_failed_manual_refresh_retains_cached_announcements(service):
    await service.configure(OPT_IN)
    client, _ = client_for()
    async with client:
        await service.tick(client, NOW)
    client, calls = client_for(handler=lambda _: httpx.Response(503))
    async with client:
        assert await service.tick(client, NOW + 60, force=True)
    cached, status = await read_cache(service)
    assert len(calls) == 1
    assert cached[0]["id"] == "gscontrol:sstv"
    assert status["error"] == "service_unavailable"


async def test_manual_refresh_waits_for_inflight_poll_to_commit(service):
    await service.configure(OPT_IN)
    requested, finish = asyncio.Event(), asyncio.Event()
    calls = []

    async def handler(request):
        calls.append(request)
        if request.method == "GET":
            requested.set()
            await finish.wait()
        return httpx.Response(
            200,
            json={"schema_version": 1, "range": dict(request.url.params), "events": [event()]},
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        polling = asyncio.create_task(service.tick(client, NOW))
        await requested.wait()
        refreshing = asyncio.create_task(service.tick(client, NOW + 60, force=True))
        await asyncio.sleep(0)
        assert not refreshing.done()
        finish.set()
        await asyncio.gather(polling, refreshing)
    assert len([request for request in calls if request.method == "GET"]) == 1
    assert (await read_cache(service))[0][0]["id"] == "gscontrol:sstv"


async def test_manual_refresh_still_fetches_when_overlapping_poll_only_prunes(service, monkeypatch):
    await service.configure(OPT_IN)
    service.consent.state["next_poll_at"] = NOW + POLL_SECONDS
    pruning, finish = asyncio.Event(), asyncio.Event()
    original_prune = service._prune

    async def prune(now):
        pruning.set()
        await finish.wait()
        await original_prune(now)

    monkeypatch.setattr(service, "_prune", prune)
    client, calls = client_for()
    async with client:
        polling = asyncio.create_task(service.tick(client, NOW))
        await pruning.wait()
        refreshing = asyncio.create_task(service.tick(client, NOW, force=True))
        await asyncio.sleep(0)
        finish.set()
        assert await polling is False
        assert await refreshing is True
    assert len([request for request in calls if request.method == "GET"]) == 1


@pytest.mark.parametrize("retry_after", ["120", "43200"])
async def test_manual_refresh_respects_provider_retry_after_across_restart(service, retry_after):
    await service.configure(OPT_IN)
    client, _ = client_for()
    async with client:
        await service.tick(client, NOW)
    client, calls = client_for(
        handler=lambda _: httpx.Response(429, headers={"Retry-After": retry_after})
    )
    async with client:
        await service.tick(client, NOW + 60, force=True)
        restarted = ExternalEventsService(service.consent.path, service.sessions)
        assert not await restarted.tick(client, NOW + 61, force=True)
        assert len(calls) == 1
        assert await restarted.tick(client, NOW + 60 + int(retry_after), force=True)
        assert len(calls) == 2


@pytest.mark.parametrize(
    "bad",
    [
        event(review_status="pending"),
        event(review_status="rejected"),
        event(superseded=True),
        event(duplicate_of="another"),
        event(canonical_id="another"),
        event(end="2026-11-18T09:00:00Z"),
        event(start="2026-11-18T10:00:00"),
        event(time_precision="date"),
    ],
)
async def test_invalid_or_unapproved_snapshot_retains_previous_cache(service, bad):
    await service.configure(OPT_IN)
    client, _ = client_for()
    async with client:
        await service.tick(client, NOW)
    client, _ = client_for([bad])
    async with client:
        await service.tick(client, NOW + POLL_SECONDS)
    cached, status = await read_cache(service)
    assert cached[0]["id"] == "gscontrol:sstv"
    assert status["error"] == "service_unavailable"


async def test_failed_or_redirected_requests_wait_six_hours(service):
    await service.configure(OPT_IN)
    client, calls = client_for(
        handler=lambda _: httpx.Response(302, headers={"Location": "https://example.com"})
    )
    async with client:
        await service.tick(client, NOW)
        await service.tick(client, NOW + 3600)
    assert len(calls) == 1
    assert (await service.status())["error"] == "service_unavailable"
    restarted = ExternalEventsService(service.consent.path, service.sessions)
    assert restarted.consent.state["next_poll_at"] == NOW + POLL_SECONDS


@pytest.mark.parametrize("retry_after", ["43200", "Thu, 19 Nov 2026 00:00:00 GMT"])
async def test_longer_retry_after_delays_the_next_attempt(service, retry_after):
    await service.configure(OPT_IN)
    client, calls = client_for(
        handler=lambda _: httpx.Response(429, headers={"Retry-After": retry_after})
    )
    async with client:
        await service.tick(client, NOW)
        await service.tick(client, NOW + POLL_SECONDS)
    assert len(calls) == 1
    assert (await service.status())["next_poll_at"] == NOW + 43200


async def test_incomplete_snapshot_does_not_replace_cache(service):
    await service.configure(OPT_IN)
    client, _ = client_for()
    async with client:
        await service.tick(client, NOW)
    first, last = rolling_window(NOW)
    client, _ = client_for(
        handler=lambda _: httpx.Response(
            200,
            json={
                "schema_version": 1,
                "range": {"start": str(first), "end": str(last - timedelta(days=1))},
                "events": [],
            },
        )
    )
    async with client:
        await service.tick(client, NOW + POLL_SECONDS)
    assert len((await read_cache(service))[0]) == 1
    assert (await service.status())["error"] == "service_unavailable"


async def test_corrupt_cache_does_not_break_local_calendar(service, monkeypatch):
    await service.configure(OPT_IN)
    async with service.sessions() as session:
        session.add(
            CachedExternalEvents(
                id="corrupt",
                start_date=WINDOW.start,
                end_date=WINDOW.end,
                payload={"invalid": True},
                fetched_at=datetime.now(timezone.utc),
            )
        )
        await session.commit()
    monkeypatch.setattr(calendar, "external_events", service)
    monkeypatch.setattr(calendar, "AsyncSessionLocal", service.sessions)
    reply = await calendar.get_calendar_events(None, WINDOW.model_dump(mode="json"), Mock(), "sid")
    assert reply["success"]
    assert reply["data"]["sources"][-1]["error"] == "cache_read_failed"


def test_cache_migration_round_trip_keeps_existing_tables(tmp_path, monkeypatch):
    database = tmp_path / "migration.db"
    monkeypatch.setenv("GS_DB", str(database))
    config = Config("alembic.ini")
    with sqlite3.connect(database) as connection:
        connection.execute("CREATE TABLE retained (value TEXT)")
        connection.execute("INSERT INTO retained VALUES ('kept')")
    command.stamp(config, "b8d2f4a6c9e1")
    command.upgrade(config, "c9e3a5b7d1f2")
    with sqlite3.connect(database) as connection:
        columns = {
            row[1] for row in connection.execute("PRAGMA table_info(cached_external_events)")
        }
        assert columns == {"id", "start_date", "end_date", "payload", "fetched_at"}
        assert connection.execute("SELECT value FROM retained").fetchone()[0] == "kept"
    command.downgrade(config, "b8d2f4a6c9e1")
    with sqlite3.connect(database) as connection:
        assert not connection.execute("PRAGMA table_info(cached_external_events)").fetchall()
        assert connection.execute("SELECT value FROM retained").fetchone()[0] == "kept"


async def test_date_only_and_unknown_timezone_keep_precision(service):
    await service.configure(OPT_IN)
    client, _ = client_for(
        [
            event("dated", start="2026-11-18", end="2026-11-19", time_precision="date"),
            event(
                "uncertain",
                start="2026-11-18",
                end="2026-11-19",
                time_precision="unspecified",
                timing_note="10:00, timezone not stated",
            ),
            event("cancelled", change="cancellation"),
        ]
    )
    async with client:
        await service.tick(client, NOW)
    cached, _ = await read_cache(
        service, CalendarRange(start="2026-11-18", end="2026-11-19", timezone="America/Los_Angeles")
    )
    assert {row["source_id"] for row in cached} == {"dated", "uncertain", "cancelled"}
    dated = next(row for row in cached if row["source_id"] == "dated")
    assert dated["start"] == "2026-11-18" and dated["time_precision"] == "date"
    assert next(row for row in cached if row["source_id"] == "cancelled")["status"] == "cancelled"


async def test_cache_queries_respect_timezone_boundaries(service):
    await service.configure(OPT_IN)
    client, _ = client_for([event(start="2026-11-17T18:00:00Z", end="2026-11-17T19:00:00Z")])
    async with client:
        await service.tick(client, NOW)
    assert not (await read_cache(service))[0]
    tokyo = CalendarRange(start="2026-11-18", end="2026-11-19", timezone="Asia/Tokyo")
    assert len((await read_cache(service, tokyo))[0]) == 1


async def test_disable_clears_cache_and_persists_across_restart(service):
    await service.configure(OPT_IN)
    client, calls = client_for()
    async with client:
        await service.tick(client, NOW)
        assert (await read_cache(service))[0]
        assert not (await service.configure({"enabled": False}))["enabled"]
        assert not (await read_cache(service))[0]
        assert not await service.tick(client, NOW + 60, force=True)
        restarted = ExternalEventsService(service.consent.path, service.sessions)
        await restarted.tick(client, NOW + POLL_SECONDS)
    assert [request.method for request in calls] == ["POST", "PUT", "GET", "DELETE"]
    assert calls[-1].url.path.endswith("/consents/events")
    assert not restarted.consent.state["deletion_pending"]
    async with service.sessions() as session:
        assert not (await session.execute(select(CachedExternalEvents))).scalars().all()


async def test_disable_cancels_inflight_and_ignores_a_late_response(service):
    requested = asyncio.Event()
    finish = asyncio.Event()

    async def handler(request):
        requested.set()
        try:
            await finish.wait()
        except asyncio.CancelledError:
            # A transport can finish despite cancellation. The generation guard
            # must independently prevent a late response from restoring data.
            pass
        return httpx.Response(
            200, json={"schema_version": 1, "range": dict(request.url.params), "events": [event()]}
        )

    await service.configure(OPT_IN)
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        polling = asyncio.create_task(service.tick(client, NOW))
        await requested.wait()
        await service.configure({"enabled": False})
        finish.set()
        await polling
    assert (await read_cache(service))[0] == []


async def test_missing_corrupt_or_outdated_consent_never_uses_cache(service):
    await service.configure(OPT_IN)
    client, _ = client_for()
    async with client:
        await service.tick(client, NOW)
    state = json.loads(service.consent.path.read_text())
    state["accepted_terms_version"] = "old-terms"
    service.consent.path.write_text(json.dumps(state))
    outdated = ExternalEventsService(service.consent.path, service.sessions)
    assert not (await read_cache(outdated))[0]
    assert (await outdated.status())["needs_consent_review"]
    service.consent.path.write_text("invalid json")
    corrupt = ExternalEventsService(service.consent.path, service.sessions)
    assert corrupt.consent.storage_error and not corrupt.consent.active
    service.consent.path.unlink()
    restored_db = ExternalEventsService(service.consent.path, service.sessions)
    assert not (await read_cache(restored_db))[0]


async def test_expired_rows_are_pruned_even_when_download_fails(service):
    await service.configure(OPT_IN)
    client, _ = client_for()
    async with client:
        await service.tick(client, NOW)
    client, _ = client_for(handler=lambda _: httpx.Response(503))
    async with client:
        await service.tick(client, NOW + 31 * 86400)
    async with service.sessions() as session:
        assert not (await session.execute(select(CachedExternalEvents))).scalars().all()


async def test_consent_save_failure_stops_networking(service, monkeypatch):
    await service.configure(OPT_IN)
    monkeypatch.setattr(service.consent, "save", Mock(side_effect=OSError("disk full")))
    with pytest.raises(ValueError):
        await service.configure({"enabled": False})
    client, calls = client_for()
    async with client:
        await service.tick(client, NOW)
        await service.tick(client, NOW, force=True)
    assert not calls and not (await service.status())["enabled"]


async def test_calendar_is_shared_and_operator_cannot_change_consent(
    service, db_session, monkeypatch
):
    monkeypatch.setattr(calendar, "external_events", service)
    monkeypatch.setattr(calendar, "AsyncSessionLocal", service.sessions)
    monkeypatch.setattr(auth, "is_setup_required", AsyncMock(return_value=False))
    registry = HandlerRegistry()
    calendar.register_handlers(registry)
    denied = await dispatch_request(
        None,
        "calendar.external.update",
        OPT_IN,
        Mock(),
        "sid",
        registry,
        auth_context={"role": "operator"},
    )
    assert not denied["success"] and not service.consent.path.exists()
    sio = Mock(emit=AsyncMock())
    enabled = await dispatch_request(
        sio,
        "calendar.external.update",
        OPT_IN,
        Mock(),
        "sid",
        registry,
        auth_context={"role": "admin", "user_id": "admin-id"},
    )
    assert enabled["success"]
    client, _ = client_for()
    async with client:
        await service.tick(client, NOW)
    for role in ("operator", "admin"):
        reply = await dispatch_request(
            sio,
            "get-calendar-events",
            WINDOW.model_dump(mode="json"),
            Mock(),
            "sid",
            registry,
            auth_context={"role": role},
        )
        assert reply["success"] and reply["data"]["events"][0]["source"] == "gscontrol"
    assert sio.emit.call_args.kwargs["room"] == auth.AUTHENTICATED_SOCKET_ROOM
