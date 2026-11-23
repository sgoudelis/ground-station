"""Shared identity is durable, local-only, and independent of both opt-ins."""

import json
from concurrent.futures import ThreadPoolExecutor

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker

from calendars.external import ExternalEventsService
from installationid import InstallationIdentity
from usage.service import UsageService

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


async def test_activity_and_events_share_identity_with_independent_choices(tmp_path, db_engine):
    usage = UsageService(tmp_path / "usage/state.json")
    events = ExternalEventsService(tmp_path / "events/state.json", async_sessionmaker(db_engine))
    assert not (await usage.status())["enabled"]
    await events.configure({"enabled": True, "terms_version": "events-1"})
    assert not (await usage.status())["enabled"]
    await usage.configure({"enabled": True})
    assert usage.identity.credentials() == events.identity.credentials()
    await usage.configure({"enabled": False})
    assert (await events.status())["enabled"]
    assert usage.identity.path.exists()


def test_identity_metadata_cannot_override_activity_choice(tmp_path):
    usage = UsageService(tmp_path / "usage/state.json")
    identity = usage.identity.credentials()
    usage.identity.path.write_text(json.dumps({**identity, "enabled": True}))
    assert usage.identity.credentials() == identity
    assert not usage.state["enabled"]
