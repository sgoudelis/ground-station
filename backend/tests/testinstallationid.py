"""Shared identity is durable, local-only, and independent of both opt-ins."""

import json
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker

from calendars.external import ExternalEventsService
from feedback.service import FeedbackService
from installationid import InstallationIdentity

pytestmark = pytest.mark.unit


def test_concurrent_identity_creation_has_one_durable_result(tmp_path):
    path = tmp_path / "installationid.json"
    with ThreadPoolExecutor(max_workers=8) as pool:
        identities = list(pool.map(lambda _: InstallationIdentity(path).credentials(), range(16)))
    assert all(identity == identities[0] for identity in identities)
    assert json.loads(path.read_text()) == identities[0]
    assert path.stat().st_mode & 0o777 == 0o600


def test_corrupt_identity_is_preserved_for_repair(tmp_path):
    path = tmp_path / "installationid.json"
    path.write_text('{"installation_id": "broken"}')
    with pytest.raises(ValueError):
        InstallationIdentity(path).credentials()
    assert path.read_text() == '{"installation_id": "broken"}'


async def test_census_and_events_share_identity_with_independent_optins(tmp_path, db_engine):
    census = FeedbackService(tmp_path / "feedback/state.json")
    events = ExternalEventsService(tmp_path / "events/state.json", async_sessionmaker(db_engine))
    assert not (await census.status())["enabled"]
    assert not (await events.status())["enabled"]
    await events.configure({"enabled": True, "terms_version": "events-1"})
    assert not (await census.status())["enabled"]
    await census.configure({"enabled": True, "consent_notice_version": "census-2"})
    assert census.identity.credentials() == events.identity.credentials()
    await census.configure({"enabled": False})
    assert (await events.status())["enabled"]
    assert census.identity.path.exists()


async def test_existing_census_consent_survives_without_identity_migration(tmp_path):
    census = FeedbackService(tmp_path / "feedback/state.json")
    await census.configure({"enabled": True, "consent_notice_version": "census-2"})
    old = json.loads(census.path.read_text())
    old.update(installation_id=str(uuid4()), credential="a" * 43, registered=True)
    census.path.write_text(json.dumps(old))
    census.identity.path.unlink()
    before = census.path.read_bytes()
    restarted = FeedbackService(census.path)
    assert not census.identity.path.exists()
    await restarted.status()
    assert restarted.state["enabled"] and not restarted.state["registered"]
    assert restarted.state["installation_id"] != old["installation_id"]
    assert restarted.state["credential"] != old["credential"]
    assert census.path.read_bytes() == before


async def test_identity_metadata_cannot_override_feature_consent(tmp_path):
    census = FeedbackService(tmp_path / "feedback/state.json")
    await census.configure({"enabled": True, "consent_notice_version": "census-2"})
    identity = json.loads(census.identity.path.read_text())
    identity.update(enabled=False, deletion_pending=True, grant_pending=False)
    census.identity.path.write_text(json.dumps(identity))

    status = await census.status()
    assert status["enabled"]
    assert not status["deletion_pending"]
    assert census.state["grant_pending"]
