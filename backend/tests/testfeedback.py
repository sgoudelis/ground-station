# Copyright (c) 2026 Efstratios Goudelis
# SPDX-License-Identifier: GPL-3.0-or-later

"""Consent/lifecycle tests never contact the public collector."""

import asyncio
import json
import os
import time
from unittest.mock import AsyncMock

import httpx
import pytest

from common import auth
from feedback import payload
from feedback.service import FeedbackService, validate_choice
from handlers.entities import setup
from handlers.routing.dispatcher import dispatch_request
from handlers.routing.registry import HandlerRegistry

pytestmark = pytest.mark.unit
OPT_IN = {"enabled": True, "consent_notice_version": "census-2", "environment": "test"}


@pytest.fixture
def service(tmp_path):
    return FeedbackService(tmp_path / "feedback" / "state.json")


def collector(handler=None):
    calls = []

    def handle(request):
        calls.append(request)
        if handler:
            custom = handler(request)
            if custom is not None:
                return custom
        if request.method == "DELETE":
            return httpx.Response(204)
        if request.url.path == "/v1/installations":
            return httpx.Response(201)
        if request.url.path == "/v1/census":
            return httpx.Response(202, json={"accepted": True, "next_report_after_seconds": 86400})
        return httpx.Response(200)

    return httpx.AsyncClient(transport=httpx.MockTransport(handle), follow_redirects=False), calls


async def test_default_and_preview_make_no_collector_requests(service):
    client, calls = collector()
    async with client:
        await service.status(preview=True)
        await service.tick(client)
    assert calls == []
    assert not service.path.exists()
    assert service.state["installation_id"] is None


@pytest.mark.parametrize(
    "choice",
    [
        {"enabled": "true"},
        {"enabled": True},
        {**OPT_IN, "consent_notice_version": "future"},
        {**OPT_IN, "environment": "staging"},
        {**OPT_IN, "performance": True},
    ],
)
async def test_invalid_or_unversioned_consent_never_creates_identity(service, choice):
    with pytest.raises(ValueError):
        await service.configure(choice)
    assert not service.path.exists()
    assert service.state["installation_id"] is None


async def test_optin_persists_identity_before_registration_and_reports_daily(service):
    def assert_durable(request):
        stored = json.loads(service.path.read_text())
        assert stored["enabled"] is True
        assert stored["remote_possible"] is True
        if request.url.path == "/v1/installations":
            registration = json.loads(request.content)
            assert stored["credential"] == registration["credential"]
            assert stored["installation_id"] == registration["installation_id"]

    await service.configure(OPT_IN)
    assert os.stat(service.path).st_mode & 0o777 == 0o600
    client, calls = collector(assert_durable)
    async with client:
        await service.tick(client)
        await service.tick(client)
        restarted = FeedbackService(service.path)
        await restarted.tick(client)
    assert [request.method for request in calls] == ["POST", "PUT", "POST"]
    sample = json.loads(calls[-1].content)
    assert sample["deployment"]["environment"] == "test"
    assert sample["installation_id"] == service.state["installation_id"]
    assert calls[-1].headers["Authorization"] == f"Bearer {service.state['credential']}"
    assert service.state["next_attempt_at"] >= time.time() + 86390
    public = json.dumps(await service.status(preview=True))
    assert service.state["credential"] not in public
    assert service.state["credential"] not in json.dumps(sample)


async def test_optout_before_any_request_needs_no_remote_deletion(service):
    await service.configure(OPT_IN)
    await service.configure({"enabled": False})
    client, calls = collector()
    async with client:
        await service.tick(client)
    assert calls == []
    assert not service.state["deletion_pending"]


async def test_offline_withdrawal_survives_restart_and_only_sends_deletion(service):
    await service.configure(OPT_IN)
    client, _ = collector()
    async with client:
        await service.tick(client)
    await service.configure({"enabled": False})
    failing, calls = collector(lambda request: httpx.Response(503))
    async with failing:
        await service.tick(failing)
    assert [request.method for request in calls] == ["DELETE"]
    assert not service.state["enabled"]
    assert service.state["deletion_pending"]
    restarted = FeedbackService(service.path)
    restarted.state["next_attempt_at"] = 0
    healthy, after = collector()
    async with healthy:
        await restarted.tick(healthy)
        await restarted.tick(healthy)
    assert [request.method for request in after] == ["DELETE"]
    assert after[0].url.path.endswith("/consents/census")
    assert not restarted.state["deletion_pending"]
    assert not restarted.state["enabled"]


async def test_lost_registration_reply_still_requires_remote_withdrawal(service):
    await service.configure(OPT_IN)

    def lost_reply(request):
        raise httpx.ReadTimeout("no reply", request=request)

    client, _ = collector(lost_reply)
    async with client:
        await service.tick(client)
    await service.configure({"enabled": False})
    assert service.state["deletion_pending"]


async def test_unconfirmed_withdrawal_stays_visible_without_deleting_other_purposes(service):
    await service.configure(OPT_IN)
    client, _ = collector()
    async with client:
        await service.tick(client)
    await service.configure({"enabled": False})
    rejected, calls = collector(lambda request: httpx.Response(401))
    async with rejected:
        await service.tick(rejected)
        service.state["next_attempt_at"] = 0
        await service.tick(rejected)
    assert len(calls) == 1
    assert calls[0].url.path.endswith("/consents/census")
    status = await service.status()
    assert not status["enabled"]
    assert status["deletion_pending"]
    assert status["blocked"]
    assert "401" in status["error"]


async def test_failed_hardware_preview_does_not_hide_consent_controls(service, monkeypatch):
    def broken_probe(*args):
        raise RuntimeError("unsupported platform")

    monkeypatch.setattr("feedback.service.build_sample", broken_probe)
    status = await service.status(preview=True)
    assert "preview_error" in status
    assert not status["enabled"]
    await service.configure({"enabled": False})


@pytest.mark.parametrize(
    "corruption",
    [
        {"installation_id": 123},
        {"error": ["bad metadata"]},
        {"next_attempt_at": float("nan")},
    ],
)
async def test_corrupt_state_cannot_crash_station_startup_or_resume_reporting(service, corruption):
    await service.configure(OPT_IN)
    stored = json.loads(service.path.read_text())
    service.path.write_text(json.dumps({**stored, **corruption}))
    restarted = FeedbackService(service.path)
    assert restarted.storage_error
    assert not restarted.state["enabled"]


@pytest.mark.parametrize("code", [401, 403, 409, 422, 307])
async def test_auth_consent_and_redirect_errors_stop_retries_until_explicit_consent(service, code):
    await service.configure(OPT_IN)

    def rejected(request):
        if request.url.path == "/v1/census":
            return httpx.Response(code, headers={"Location": "https://example.invalid/elsewhere"})

    client, calls = collector(rejected)
    async with client:
        await service.tick(client)
        before = len(calls)
        service.state["next_attempt_at"] = 0
        await service.tick(client)
    assert service.state["blocked"]
    assert len(calls) == before
    assert all(request.url.host == "reports.gscontrol.net" for request in calls)
    await service.configure(OPT_IN)
    assert not service.state["blocked"]
    assert service.state["grant_pending"]
    assert not service.state["registered"]


@pytest.mark.parametrize("retry_after", ["7200", "Wed, 01 Jan 2031 00:00:00 GMT"])
async def test_rate_limit_respects_retry_after(service, retry_after):
    await service.configure(OPT_IN)
    client, calls = collector(
        lambda request: httpx.Response(429, headers={"Retry-After": retry_after})
    )
    async with client:
        await service.tick(client)
        await service.tick(client)
    assert len(calls) == 1
    assert service.state["next_attempt_at"] >= time.time() + 7190
    assert not service.state["blocked"]


async def test_withdrawal_serializes_with_an_inflight_report(service):
    await service.configure(OPT_IN)
    entered, release = asyncio.Event(), asyncio.Event()
    calls = []

    async def transport(request):
        calls.append(request)
        if request.url.path == "/v1/census":
            entered.set()
            await release.wait()
            return httpx.Response(202)
        return httpx.Response(204 if request.method == "DELETE" else 201)

    async with httpx.AsyncClient(transport=httpx.MockTransport(transport)) as client:
        sending = asyncio.create_task(service.tick(client))
        await asyncio.wait_for(entered.wait(), 5)
        stopping = asyncio.create_task(service.configure({"enabled": False}))
        release.set()
        await sending
        await stopping
        await service.tick(client)
        await service.tick(client)
    assert calls[-1].method == "DELETE"
    assert len([request for request in calls if request.url.path == "/v1/census"]) == 1
    assert not service.state["enabled"]


async def test_unreadable_state_stops_reporting_and_does_not_replace_credentials(service):
    service.path.parent.mkdir()
    service.path.write_text('{"enabled": true, "credential": "broken"}')
    broken = FeedbackService(service.path)
    assert broken.storage_error
    client, calls = collector()
    async with client:
        await broken.tick(client)
    with pytest.raises(ValueError):
        await broken.configure(OPT_IN)
    assert calls == []
    assert json.loads(service.path.read_text())["credential"] == "broken"


async def test_failed_consent_write_stops_sender(service, monkeypatch):
    def disk_full():
        raise OSError("disk full")

    monkeypatch.setattr(service, "_save", disk_full)
    with pytest.raises(ValueError):
        await service.configure(OPT_IN)
    assert service.storage_error
    assert not service.state["enabled"]


async def test_notice_upgrade_never_silently_renews_consent(service):
    await service.configure(OPT_IN)
    client, _ = collector()
    async with client:
        await service.tick(client)
    stored = json.loads(service.path.read_text())
    stored["consent_notice_version"] = "census-older"
    service.path.write_text(json.dumps(stored))
    restarted = FeedbackService(service.path)
    assert not restarted.state["enabled"]
    assert not restarted.state["grant_pending"]
    assert restarted.state["deletion_pending"]


@pytest.mark.parametrize("registered", [True, False])
async def test_supported_legacy_consent_continues_without_country_until_explicit_renewal(
    service, registered
):
    await service.configure(OPT_IN)
    service.state.update(consent_notice_version="census-1", registered=registered)
    service._save()
    restarted = FeedbackService(service.path)
    status = await restarted.status(preview=True)
    assert status["enabled"]
    assert status["needs_consent_review"]
    assert status["accepted_notice_version"] == "census-1"
    assert status["sample"]["consent_notice_version"] == "census-1"
    client, calls = collector()
    async with client:
        await restarted.tick(client)
    payloads = [json.loads(request.content) for request in calls if request.content]
    assert payloads
    assert all(data["consent_notice_version"] == "census-1" for data in payloads)
    assert not restarted.state["blocked"]

    # Saving the new disclosure is the only transition to country inference.
    await restarted.configure(OPT_IN)
    renewed, after = collector()
    async with renewed:
        await restarted.tick(renewed)
    assert [request.method for request in after] == ["POST", "PUT", "POST"]
    assert all(
        json.loads(request.content)["consent_notice_version"] == "census-2" for request in after
    )
    status = await restarted.status(preview=True)
    assert not status["needs_consent_review"]
    assert status["accepted_notice_version"] == "census-2"
    assert status["sample"]["consent_notice_version"] == "census-2"


@pytest.mark.parametrize("command", ["feedback.get", "feedback.update"])
async def test_feedback_rpc_is_admin_only_and_unavailable_during_setup(monkeypatch, command):
    handler = AsyncMock(return_value={"success": True, "data": {}})
    registry = HandlerRegistry()
    registry.register(command, handler, "api_call")
    logger = AsyncMock()
    monkeypatch.setattr(auth, "is_setup_required", AsyncMock(return_value=False))
    denied = await dispatch_request(
        None, command, None, logger, "sid", registry, {"role": "operator"}
    )
    assert not denied["success"]
    handler.assert_not_awaited()
    allowed = await dispatch_request(
        None, command, None, logger, "sid", registry, {"role": "admin"}
    )
    assert allowed["success"]
    monkeypatch.setattr(auth, "is_setup_required", AsyncMock(return_value=True))
    denied = await dispatch_request(None, command, None, logger, "sid", registry)
    assert not denied["success"]


def test_setup_requires_current_notice_for_explicit_optin():
    data = {
        "admin": {"username": "admin", "password": "password123"},
        "location": {"lat": 1, "lon": 2},
    }
    assert setup._normalize_finalize_payload(data)["feedback"] is None
    assert setup._normalize_finalize_payload({**data, "feedback": OPT_IN})["feedback"] == OPT_IN
    with pytest.raises(ValueError):
        setup._normalize_finalize_payload({**data, "feedback": {"enabled": True}})


def test_payload_uses_allowlist_not_system_information_dump(monkeypatch):
    monkeypatch.setenv("GS_ENVIRONMENT", "development")
    monkeypatch.setenv("BUILD_VERSION", "0.8.23-development-20261111-secret-commit")
    sample = payload.build_sample("00000000-0000-4000-8000-000000000001", "production")
    assert sample["application"] == {"version": "0.8.23", "channel": "development"}
    assert sample["deployment"]["environment"] == "production"
    assert set(sample) == {
        "schema_version",
        "consent_notice_version",
        "installation_id",
        "application",
        "deployment",
        "os",
        "hardware",
    }
    assert set(sample["hardware"]) == {"architecture", "cpu", "gpu", "memory_gib_bucket"}
    assert set(sample["os"]) == {"family", "distribution", "version"}
    assert len(json.dumps(sample).encode()) <= 4096
    assert "secret-commit" not in json.dumps(sample)
