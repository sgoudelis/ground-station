"""Activity tests use isolated state and mock HTTPS; no public requests."""

import asyncio
import json
from unittest.mock import AsyncMock

import httpx
import pytest

from common import auth
from common.environment import reporting_environment, usage_environment
from handlers.entities import setup
from handlers.routing.dispatcher import dispatch_request
from handlers.routing.registry import HandlerRegistry
from usage.service import ACTIVITY_URL, INTERVAL, UsageService, validate_choice

pytestmark = pytest.mark.unit


@pytest.fixture
def service(tmp_path, monkeypatch):
    monkeypatch.setenv("GS_ENVIRONMENT", "production")
    return UsageService(tmp_path / "usage" / "state.json")


def collector(handler=None):
    calls = []

    def receive(request):
        calls.append(request)
        return handler(request) if handler else httpx.Response(204)

    return httpx.AsyncClient(transport=httpx.MockTransport(receive)), calls


async def test_default_and_settings_do_not_send_or_create_an_identity(service):
    client, calls = collector()
    async with client:
        assert not (await service.status())["enabled"]
        await service.tick(client)
    assert calls == []
    assert not service.identity.path.exists()


async def test_sends_id_and_environment_every_twelve_hours_and_survives_restart(
    service, monkeypatch
):
    now = [1000]
    monkeypatch.setattr("usage.service.time.time", lambda: now[0])
    identity = service.identity.credentials()
    await service.configure({"enabled": True})
    client, calls = collector()
    async with client:
        await service.tick(client)
        assert len(calls) == 1
        request = calls[0]
        assert str(request.url) == ACTIVITY_URL
        assert request.method == "POST"
        assert json.loads(request.content) == {
            "installation_id": identity["installation_id"],
            "environment": "production",
        }
        assert "authorization" not in request.headers
        assert identity["credential"] not in request.content.decode()
        restarted = UsageService(service.path)
        await restarted.tick(client)
        assert len(calls) == 1
        now[0] += INTERVAL
        await restarted.tick(client)
        assert len(calls) == 2
        assert restarted.state["last_success_at"]


@pytest.mark.parametrize(
    ("runtime", "expected_usage", "expected_events"),
    [
        (None, "development", "development"),
        ("production", "production", "production"),
        ("development", "development", "development"),
        ("unknown", "unknown", "unknown"),
        ("invalid", "unknown", "unknown"),
        ("", "unknown", "unknown"),
        ("test", "unknown", "test"),
    ],
)
def test_services_use_the_application_environment(
    runtime, expected_usage, expected_events, monkeypatch
):
    if runtime is None:
        monkeypatch.delenv("GS_ENVIRONMENT", raising=False)
    else:
        monkeypatch.setenv("GS_ENVIRONMENT", runtime)
    # Release versions do not change the explicitly configured deployment.
    monkeypatch.setenv("BUILD_VERSION", "0.99.0-dev")
    assert usage_environment() == expected_usage
    assert reporting_environment() == expected_events


async def test_environment_changes_do_not_change_identity_consent_or_schedule(service, monkeypatch):
    await service.configure({"enabled": True})
    client, calls = collector()
    async with client:
        await service.tick(client)
        before = json.loads(calls[0].content)
        next_attempt = service.state["next_attempt_at"]
        monkeypatch.setenv("GS_ENVIRONMENT", "development")
        await service.tick(client)
        assert len(calls) == 1
        assert service.state["next_attempt_at"] == next_attempt
        service.state["next_attempt_at"] = 0
        await service.tick(client)
    after = json.loads(calls[1].content)
    assert after == {"installation_id": before["installation_id"], "environment": "development"}
    assert (await service.status())["enabled"]


async def test_optout_and_reenable_do_not_bypass_schedule(service):
    await service.configure({"enabled": True})
    client, calls = collector()
    async with client:
        await service.tick(client)
        await service.configure({"enabled": False})
        await service.tick(client)
        await service.configure({"enabled": True})
        await service.tick(client)
    assert len(calls) == 1


@pytest.mark.parametrize("code", [301, 401, 403, 429, 500])
async def test_failed_requests_wait_twelve_hours_without_registration_or_redirects(service, code):
    await service.configure({"enabled": True})
    client, calls = collector(
        lambda request: httpx.Response(code, headers={"Location": "https://example.com"})
    )
    async with client:
        await service.tick(client)
        await service.tick(client)
    assert len(calls) == 1
    assert service.state["last_success_at"] is None
    assert service.state["next_attempt_at"] > 0


async def test_timeout_keeps_the_schedule_and_allows_optout(service):
    await service.configure({"enabled": True})
    client = AsyncMock()
    client.post.side_effect = TimeoutError
    await service.tick(client)
    await service.tick(client)
    client.post.assert_awaited_once()
    assert not (await service.configure({"enabled": False}))["enabled"]


async def test_withdrawal_waits_for_inflight_request_and_stops_future_requests(service):
    started, release = asyncio.Event(), asyncio.Event()

    async def receive(request):
        started.set()
        await release.wait()
        return httpx.Response(204)

    await service.configure({"enabled": True})
    async with httpx.AsyncClient(transport=httpx.MockTransport(receive)) as client:
        task = asyncio.create_task(service.tick(client))
        await started.wait()
        withdrawal = asyncio.create_task(service.configure({"enabled": False}))
        await asyncio.sleep(0)
        assert not withdrawal.done()
        release.set()
        await task
        await withdrawal
        service.state["next_attempt_at"] = 0
        client.post = AsyncMock()
        await service.tick(client)
        client.post.assert_not_awaited()


async def test_failed_persistence_never_enables_or_sends(service, monkeypatch):
    monkeypatch.setattr(service, "_save", lambda: (_ for _ in ()).throw(OSError()))
    with pytest.raises(ValueError):
        await service.configure({"enabled": True})
    assert (await service.status())["storage_error"]
    client, calls = collector()
    async with client:
        await service.tick(client)
    assert not calls


@pytest.mark.parametrize(
    "choice", [{}, {"enabled": 1}, {"enabled": "true"}, {"enabled": True, "hardware": {}}]
)
def test_choice_is_strict(choice):
    with pytest.raises(ValueError):
        validate_choice(choice)


async def test_corrupt_storage_stops_reporting(service):
    service.path.parent.mkdir(parents=True)
    service.path.write_text('{"enabled": true, "next_attempt_at": "broken"}')
    restarted = UsageService(service.path)
    assert restarted.storage_error
    client, calls = collector()
    async with client:
        await restarted.tick(client)
    assert not calls


@pytest.mark.parametrize("command", ["usage.get", "usage.update"])
async def test_rpc_requires_admin_and_is_unavailable_during_setup(monkeypatch, command):
    handler = AsyncMock(return_value={"success": True, "data": {}})
    registry = HandlerRegistry()
    registry.register(command, handler, "api_call")
    monkeypatch.setattr(auth, "is_setup_required", AsyncMock(return_value=False))
    assert not (
        await dispatch_request(
            None, command, None, AsyncMock(), "sid", registry, {"role": "operator"}
        )
    )["success"]
    assert (
        await dispatch_request(None, command, None, AsyncMock(), "sid", registry, {"role": "admin"})
    )["success"]
    monkeypatch.setattr(auth, "is_setup_required", AsyncMock(return_value=True))
    assert not (await dispatch_request(None, command, None, AsyncMock(), "sid", registry))[
        "success"
    ]


def test_old_setup_census_choice_does_not_enable_activity():
    payload = {
        "admin": {"username": "admin", "password": "password123"},
        "location": {"lat": 1, "lon": 2},
        "feedback": {"enabled": True, "consent_notice_version": "census-2"},
    }
    assert setup._normalize_finalize_payload(payload)["usage"] is None
    assert setup._normalize_finalize_payload({**payload, "usage": {"enabled": True}})["usage"] == {
        "enabled": True
    }
