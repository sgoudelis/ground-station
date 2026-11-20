"""Station-wide selection, shared consent, partial snapshots and legacy migration."""

import json
from datetime import datetime, timezone

import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

from calendars.consent import default_state, invalidate_consent
from calendars.external import ExternalEventsService
from calendars.protocol import EXTERNAL_FEEDS, PublishedEvent
from calendars.schemas import CalendarRange
from db.models import CachedExternalEvents, CalendarServices
from installationid import InstallationIdentity

pytestmark = pytest.mark.unit
NOW = datetime(2026, 11, 20, 12, tzinfo=timezone.utc)
WINDOW = CalendarRange(start="2026-11-20", end="2026-11-21")


@pytest.fixture
def service(tmp_path, db_engine, monkeypatch):
    monkeypatch.setattr("calendars.external.time.time", lambda: NOW.timestamp())
    return ExternalEventsService(
        tmp_path / "events/state.json", async_sessionmaker(db_engine, expire_on_commit=False)
    )


def event(feed, suffix="one", **changes):
    return dict(
        id=feed + ":" + suffix,
        title=feed,
        feed_id=feed,
        kind={"announcements": "sstv", "space_weather": "space_weather", "launches": "launch"}[
            feed
        ],
        start="2026-11-20T12:00:00Z",
        end="2026-11-20T13:00:00Z",
        review_status="approved",
        revision=1,
        **changes,
    )


def client(events, failed=None):
    calls = []

    def respond(request):
        calls.append(request)
        return httpx.Response(
            200,
            json=dict(
                schema_version=1,
                range=dict(request.url.params),
                events=events,
                feeds=[
                    dict(
                        id=feed,
                        complete=feed != failed,
                        stale=feed == failed,
                        error="source_unavailable" if feed == failed else None,
                    )
                    for feed in EXTERNAL_FEEDS
                ],
            ),
        )

    return httpx.AsyncClient(transport=httpx.MockTransport(respond)), calls


async def cached(service):
    async with service.sessions() as session:
        return await service.cached_events(session, WINDOW)


@pytest.mark.parametrize("observations_enabled", [True, False])
async def test_last_external_feed_withdraws_consent_and_requires_fresh_acceptance(
    service, observations_enabled
):
    if not observations_enabled:
        await service.configure({"feed_id": "observations", "enabled": False})
    with pytest.raises(ValueError):
        await service.configure({"feed_id": "space_weather", "enabled": True})
    first = await service.configure(
        {"feed_id": "space_weather", "enabled": True, "terms_version": "events-1"}, "admin"
    )
    receipt = service.consent.state["accepted_at"]
    assert first["consented"]
    assert not next(item["enabled"] for item in first["feeds"] if item["id"] == "announcements")
    await service.configure({"feed_id": "launches", "enabled": True})
    transport, calls = client([event("space_weather"), event("launches"), event("announcements")])
    async with transport:
        await service.tick(transport)
        assert [request.method for request in calls] == ["POST", "PUT", "GET"]
        partial = await service.configure({"feed_id": "space_weather", "enabled": False})
        assert partial["consented"] and partial["enabled"]
        assert service.consent.state["accepted_at"] == receipt
        withdrawn = await service.configure({"feed_id": "launches", "enabled": False})
        assert not withdrawn["consented"] and not withdrawn["enabled"]
        assert (
            next(row["enabled"] for row in withdrawn["feeds"] if row["id"] == "observations")
            == observations_enabled
        )
        assert service.consent.state["deletion_pending"]
        async with service.sessions() as session:
            assert not (await session.execute(select(CachedExternalEvents))).scalars().all()
            stored = await session.get(CalendarServices, "gscontrol")
            assert not stored.enabled and stored.revoked_at is not None
        restarted = ExternalEventsService(service.consent.path, service.sessions)
        assert not (await restarted.status())["consented"]
        assert not await service.tick(transport, force=True)
        # A normal lifecycle tick completes the existing durable withdrawal.
        await service.tick(transport)
        assert calls[-1].method == "DELETE"
        assert not service.consent.state["deletion_pending"]
        with pytest.raises(ValueError):
            await service.configure({"feed_id": "announcements", "enabled": True})
        await service.configure(
            {"feed_id": "announcements", "enabled": True, "terms_version": "events-1"},
            "another-admin",
        )
        await service.tick(transport, force=True)
    assert sum(request.method == "PUT" for request in calls) == 2
    assert service.consent.state["accepted_by"] == "another-admin"
    assert [row["feed_id"] for row in (await cached(service))[0]] == ["announcements"]


async def test_local_feed_needs_no_consent_or_identity_and_is_station_wide(service):
    changed = await service.configure({"feed_id": "observations", "enabled": False})
    assert not changed["consented"]
    assert not service.identity.path.exists()
    second = ExternalEventsService(service.consent.path, service.sessions)
    state = await second.status()
    assert not next(row["enabled"] for row in state["feeds"] if row["id"] == "observations")


async def test_local_observations_do_not_revoke_an_active_external_feed(service):
    await service.configure(
        {"feed_id": "space_weather", "enabled": True, "terms_version": "events-1"}
    )
    receipt = service.consent.state["accepted_at"]
    changed = await service.configure({"feed_id": "observations", "enabled": False})
    assert changed["consented"] and changed["enabled"]
    assert service.consent.state["accepted_at"] == receipt
    assert next(row["enabled"] for row in changed["feeds"] if row["id"] == "space_weather")


async def test_failed_feed_retains_cache_while_complete_empty_feed_clears(service):
    for feed in EXTERNAL_FEEDS:
        await service.configure({"feed_id": feed, "enabled": True, "terms_version": "events-1"})
    transport, _ = client([event(feed) for feed in EXTERNAL_FEEDS])
    async with transport:
        await service.tick(transport)
    transport, _ = client([event("announcements", "updated")], failed="space_weather")
    async with transport:
        await service.tick(transport, force=True)
    rows, status = await cached(service)
    assert {row["source_id"] for row in rows} == {"space_weather:one", "announcements:updated"}
    assert status["error"] == "upstream_feed_unavailable"
    await service.configure({"revoke": True})
    assert not (await cached(service))[0]
    assert not (await service.status())["consented"]


async def test_expired_data_is_hidden_even_when_source_is_down(service, monkeypatch):
    await service.configure(
        {"feed_id": "space_weather", "enabled": True, "terms_version": "events-1"}
    )
    transport, _ = client([event("space_weather", expires_at="2026-11-20T12:30:00Z")])
    async with transport:
        await service.tick(transport)
    assert len((await cached(service))[0]) == 1
    monkeypatch.setattr("calendars.external.time.time", lambda: NOW.timestamp() + 3600)
    assert not (await cached(service))[0]


async def test_uncertain_launches_are_not_cached_or_shown_from_legacy_offline_cache(service):
    await service.configure({"feed_id": "launches", "enabled": True, "terms_version": "events-1"})
    daily = dict(
        event("launches", "dated"), start="2026-11-20", end="2026-11-21", time_precision="date"
    )
    uncertain = dict(
        event("launches", "uncertain"), start="2026-01-01", end="2027-01-01", time_precision="date"
    )
    transport, _ = client([daily, uncertain])
    async with transport:
        await service.tick(transport)
    assert [item["source_id"] for item in (await cached(service))[0]] == [daily["id"]]
    async with service.sessions() as session:
        assert await session.get(CachedExternalEvents, uncertain["id"]) is None
        # Simulate the same estimate saved by the previous version, then read
        # while offline: it must disappear without needing another download.
        session.add(
            CachedExternalEvents(
                id=uncertain["id"],
                feed_id="launches",
                start_date=NOW.date().replace(month=1, day=1),
                end_date=NOW.date().replace(year=2027, month=1, day=1),
                payload=PublishedEvent.model_validate(uncertain).calendar_payload(),
                fetched_at=NOW,
            )
        )
        await session.commit()
    assert [item["source_id"] for item in (await cached(service))[0]] == [daily["id"]]


async def test_legacy_receipt_migrates_once_without_enabling_new_feeds(service):
    identity = service.identity.credentials()
    service.consent.path.parent.mkdir(parents=True)
    original = dict(
        default_state(),
        enabled=True,
        accepted_terms_version="events-1",
        accepted_at="2026-11-18T12:00:00+00:00",
        accepted_by="original-admin",
    )
    service.consent.path.write_text(json.dumps(original))
    status = await service.status()
    assert status["consented"] and not service.consent.path.exists()
    assert {row["id"] for row in status["feeds"] if row["enabled"]} == {
        "observations",
        "announcements",
    }
    async with service.sessions() as session:
        record = await session.get(CalendarServices, "gscontrol")
        assert record.installation_id == identity["installation_id"]
        assert record.accepted_at == original["accepted_at"]
        assert record.accepted_by == "original-admin"
        await invalidate_consent(session)
        await session.commit()
    # Even a leftover file cannot override restored/revoked database state.
    service.consent.path.write_text(json.dumps(original))
    assert not (await service.status())["consented"]


async def test_database_receipt_does_not_authorize_another_installation(service, tmp_path):
    await service.configure({"enabled": True, "terms_version": "events-1"})
    other = InstallationIdentity(tmp_path / "other/installationid.json")
    other.credentials()
    clone = ExternalEventsService(
        tmp_path / "other/events/state.json", service.sessions, identity=other
    )
    assert not (await clone.status())["consented"]


def test_database_migration_adds_feed_tables_without_changing_cached_events(tmp_path, monkeypatch):
    import sqlite3

    from alembic import command
    from alembic.config import Config

    database = tmp_path / "feeds.db"
    monkeypatch.setenv("GS_DB", str(database))
    config = Config("alembic.ini")
    command.stamp(config, "b8d2f4a6c9e1")
    command.upgrade(config, "c9e3a5b7d1f2")
    command.upgrade(config, "head")
    with sqlite3.connect(database) as db:
        assert {row[1] for row in db.execute("PRAGMA table_info(calendar_services)")} >= {
            "enabled",
            "accepted_at",
            "installation_id",
        }
        assert {row[1] for row in db.execute("PRAGMA table_info(cached_external_events)")} >= {
            "feed_id",
            "expires_at",
        }
    command.downgrade(config, "c9e3a5b7d1f2")
    with sqlite3.connect(database) as db:
        assert not db.execute("PRAGMA table_info(calendar_services)").fetchall()
        assert db.execute("PRAGMA table_info(cached_external_events)").fetchall()
