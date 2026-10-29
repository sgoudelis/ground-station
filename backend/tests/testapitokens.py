# Copyright (c) 2026 Efstratios Goudelis
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

"""Personal token management over Socket.IO and scoped public HTTP access."""

import io
import uuid
import zipfile
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import httpx
import pytest
from fastapi import Request
from fastapi.staticfiles import StaticFiles
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from common import apitokens, auth
from common.events import EventBroker, public_events
from crud import monitoredsatellites as monitored_crud
from crud import scheduledobservations as observation_crud
from db.models import (
    AuthSessions,
    MonitoredSatellites,
    ObservationStatus,
    Rigs,
    Rotators,
    Satellites,
    ScheduledObservations,
    SDRs,
    SDRType,
    UserRole,
    Users,
)
from handlers import socket as sockethandlers
from library.inventory import LibraryInventory
from server import startup
from tracker.operations import OperationRegistry


class FakeSio:
    def __init__(self):
        self.handlers = {}
        self.disconnected = []

    def on(self, event):
        def register(handler):
            self.handlers[event] = handler
            return handler

        return register

    async def disconnect(self, sid):
        self.disconnected.append(sid)


@pytest.fixture
def token_store(db_engine, monkeypatch):
    maker = async_sessionmaker(db_engine, class_=AsyncSession, expire_on_commit=False)
    monkeypatch.setattr(auth, "AsyncSessionLocal", maker)
    monkeypatch.setattr(apitokens, "AsyncSessionLocal", maker)
    monkeypatch.setattr(startup, "AsyncSessionLocal", maker)

    async def setup_not_required():
        return False

    monkeypatch.setattr(auth, "is_setup_required", setup_not_required)
    sockethandlers.SOCKET_TOKENS.clear()
    sockethandlers.SOCKET_AUTH.clear()
    yield maker
    sockethandlers.SOCKET_TOKENS.clear()
    sockethandlers.SOCKET_AUTH.clear()


async def _make_user(maker, username: str) -> tuple[str, str]:
    browser_secret = f"browser-{username}"
    async with maker() as session:
        user = Users(
            username=username,
            username_norm=username,
            password_hash=auth.hash_password("password123"),
            role=UserRole.OPERATOR.value,
            is_active=True,
        )
        session.add(user)
        await session.flush()
        session.add(
            AuthSessions(
                user_id=user.id,
                token_hash=auth._hash_token(browser_secret),
                expires_at=datetime.now(timezone.utc) + timedelta(days=1),
            )
        )
        await session.commit()
        return str(user.id), browser_secret


def _socket_call(sio, sid, cmd, data=None):
    return sio.handlers["api.call"](sid, {"cmd": cmd, "data": data})


@pytest.mark.asyncio
async def test_token_is_shown_once_scoped_and_revoked(token_store):
    owner_id, browser_secret = await _make_user(token_store, "owner")
    sio = FakeSio()
    sockethandlers.register_socketio_handlers(sio)
    sockethandlers.SOCKET_TOKENS["owner"] = browser_secret

    scopes = await _socket_call(sio, "owner", "tokens.scopes")
    assert scopes["success"] is True
    assert {"station:read", "sdrs:read", "rotators:read", "rigs:read"} <= {
        scope["id"] for scope in scopes["data"]
    }
    assert (await _socket_call(sio, "owner", "tokens.list"))["data"] == []

    wrong_password = await _socket_call(
        sio,
        "owner",
        "tokens.create",
        {"name": "Bad", "password": "wrong", "scopes": ["station:read"]},
    )
    assert wrong_password["error"] == "Incorrect password."
    created = await _socket_call(
        sio,
        "owner",
        "tokens.create",
        {"name": "Home Assistant", "password": "password123", "scopes": ["station:read"]},
    )
    assert created["success"] is True
    secret = created["data"]["token"]
    token_id = created["data"]["data"]["id"]
    assert secret.startswith(apitokens.TOKEN_PREFIX)
    listed = await _socket_call(sio, "owner", "tokens.list")
    assert listed["data"][0]["id"] == token_id
    assert secret not in str(listed)

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=startup.app), base_url="http://testserver"
    ) as client:
        bearer = {"Authorization": f"Bearer {secret}"}
        me = await client.get("/api/v1/me", headers=bearer)
        assert me.status_code == 200
        assert me.json()["user_id"] == owner_id
        assert me.json()["scopes"] == ["station:read"]
        assert (await client.get("/api/v1/station", headers=bearer)).status_code == 200
        assert (await client.get("/api/v1/observations", headers=bearer)).status_code == 403
        assert (await client.get("/api/v1/artifacts", headers=bearer)).status_code == 403
        assert (
            await client.get("/api/v1/me", headers={"Authorization": f"Bearer {browser_secret}"})
        ).status_code == 401
        assert (await client.get("/api/auth/tokens", headers=bearer)).status_code == 404

    # A PAT cannot be used as a browser session on api.call.
    sockethandlers.SOCKET_TOKENS["pat"] = secret
    denied = await _socket_call(sio, "pat", "tokens.list")
    assert denied["success"] is False
    assert sio.disconnected == ["pat"]

    renamed = await _socket_call(
        sio, "owner", "tokens.rename", {"token_id": token_id, "name": "Renamed"}
    )
    assert renamed["data"]["name"] == "Renamed"
    assert (await _socket_call(sio, "owner", "tokens.revoke", {"token_id": token_id}))[
        "success"
    ] is True
    assert (await _socket_call(sio, "owner", "tokens.list"))["data"][0]["status"] == "revoked"
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=startup.app), base_url="http://testserver"
    ) as client:
        assert (await client.get("/api/v1/me", headers=bearer)).status_code == 401


@pytest.mark.asyncio
async def test_token_ownership_and_invalid_scopes(token_store):
    _, owner_cookie = await _make_user(token_store, "owner")
    _, other_cookie = await _make_user(token_store, "other")
    sio = FakeSio()
    sockethandlers.register_socketio_handlers(sio)
    sockethandlers.SOCKET_TOKENS.update({"owner": owner_cookie, "other": other_cookie})
    created = await _socket_call(
        sio,
        "owner",
        "tokens.create",
        {"name": "Automation", "password": "password123", "scopes": ["station:read"]},
    )
    token_id = created["data"]["data"]["id"]
    assert (await _socket_call(sio, "other", "tokens.list"))["data"] == []
    assert (
        await _socket_call(sio, "other", "tokens.rename", {"token_id": token_id, "name": "Stolen"})
    )["error"] == "API token not found."
    assert (await _socket_call(sio, "other", "tokens.revoke", {"token_id": token_id}))[
        "error"
    ] == "API token not found."
    invalid = await _socket_call(
        sio,
        "owner",
        "tokens.create",
        {"name": "Bad", "password": "password123", "scopes": ["unknown:scope"]},
    )
    assert invalid["error"] == "Unknown API token scope."


@pytest.mark.asyncio
async def test_expiry_and_password_reset_invalidate_tokens(token_store):
    owner_id, _ = await _make_user(token_store, "owner")
    created = await apitokens.create_token(owner_id, "password123", "Automation", ["station:read"])
    secret = created["token"]
    assert await apitokens.authenticate_token(secret)
    async with token_store() as session:
        from db.models import ApiTokens

        row = await session.get(ApiTokens, uuid.UUID(created["data"]["id"]))
        row.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        await session.commit()
    assert await apitokens.authenticate_token(secret) is None

    another = await apitokens.create_token(owner_id, "password123", "Second", ["station:read"])
    assert await apitokens.authenticate_token(another["token"])
    await auth.reset_user_password(owner_id, "replacement123")
    assert await apitokens.authenticate_token(another["token"]) is None


@pytest.mark.asyncio
async def test_public_sdr_and_rotator_metadata_is_scoped_and_sanitized(token_store):
    for path in (
        "/api/v1/sdrs",
        "/api/v1/sdrs/{sdr_id}",
        "/api/v1/rotators",
        "/api/v1/rotators/{rotator_id}",
    ):
        assert startup.app.openapi()["paths"][path]["get"]["security"]

    owner_id, _ = await _make_user(token_store, "hardware-reader")
    sdr_id = uuid.uuid4()
    second_sdr_id = uuid.uuid4()
    rotator_id = uuid.uuid4()
    second_rotator_id = uuid.uuid4()
    async with token_store() as session:
        session.add_all(
            [
                SDRs(
                    id=sdr_id,
                    name="Alpha SDR",
                    type=SDRType.RTLSDRTCPV4,
                    serial="private-serial",
                    host="private-sdr-host",
                    port=1234,
                    driver="private-driver",
                    antenna_labels={"RX": {"A": "VHF"}},
                    frequency_min=24,
                    frequency_max=1800,
                ),
                SDRs(id=second_sdr_id, name="Zulu SDR", type=SDRType.AIRSPY),
                Rotators(
                    id=rotator_id,
                    name="Alpha Rotator",
                    host="private-rotator-host",
                    port=4533,
                    minaz=0,
                    maxaz=450,
                    azimuth_mode="0_450",
                    minel=0,
                    maxel=90,
                    parkaz=180,
                    parkel=0,
                ),
                Rotators(
                    id=second_rotator_id,
                    name="Zulu Rotator",
                    host="other-private-host",
                    port=4534,
                    minaz=0,
                    maxaz=360,
                    minel=0,
                    maxel=90,
                ),
            ]
        )
        await session.commit()

    sdr_token = await apitokens.create_token(owner_id, "password123", "SDR reader", ["sdrs:read"])
    rotator_token = await apitokens.create_token(
        owner_id, "password123", "Rotator reader", ["rotators:read"]
    )
    station_token = await apitokens.create_token(
        owner_id, "password123", "Station reader", ["station:read"]
    )
    sdr_headers = {"Authorization": f"Bearer {sdr_token['token']}"}
    rotator_headers = {"Authorization": f"Bearer {rotator_token['token']}"}
    station_headers = {"Authorization": f"Bearer {station_token['token']}"}

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=startup.app), base_url="http://testserver"
    ) as client:
        assert (await client.get("/api/v1/sdrs")).status_code == 401
        assert (await client.get("/api/v1/rotators")).status_code == 401
        assert (await client.get("/api/v1/sdrs", headers=station_headers)).status_code == 403
        assert (await client.get("/api/v1/rotators", headers=station_headers)).status_code == 403
        assert (await client.get("/api/v1/rotators", headers=sdr_headers)).status_code == 403
        assert (await client.get("/api/v1/sdrs", headers=rotator_headers)).status_code == 403

        playback_page = await client.get("/api/v1/sdrs?limit=1", headers=sdr_headers)
        assert playback_page.status_code == 200
        assert playback_page.json()["pagination"]["total"] == 3
        assert [item["id"] for item in playback_page.json()["data"]] == ["sigmf-playback"]
        first_sdr_page = await client.get("/api/v1/sdrs?limit=1&offset=1", headers=sdr_headers)
        assert [item["id"] for item in first_sdr_page.json()["data"]] == [str(sdr_id)]
        second_sdr_page = await client.get("/api/v1/sdrs?limit=1&offset=2", headers=sdr_headers)
        assert [item["id"] for item in second_sdr_page.json()["data"]] == [str(second_sdr_id)]
        sdr_detail = await client.get(f"/api/v1/sdrs/{sdr_id}", headers=sdr_headers)
        assert sdr_detail.status_code == 200
        assert sdr_detail.json()["data"] == first_sdr_page.json()["data"][0]
        assert sdr_detail.json()["data"]["type"] == "rtlsdrtcpv4"
        assert sdr_detail.json()["data"]["antenna_labels"] == {"RX": {"A": "VHF"}}
        assert all(
            field not in sdr_detail.json()["data"] for field in ("serial", "host", "port", "driver")
        )
        assert (await client.get("/api/v1/sdrs/sigmf-playback", headers=sdr_headers)).json()[
            "data"
        ]["name"] == "SigMF Playback"
        assert (await client.get("/api/v1/sdrs/not-an-id", headers=sdr_headers)).status_code == 404
        assert (
            await client.get(f"/api/v1/sdrs/{uuid.uuid4()}", headers=sdr_headers)
        ).status_code == 404

        rotator_page = await client.get("/api/v1/rotators?limit=1", headers=rotator_headers)
        assert rotator_page.status_code == 200
        assert rotator_page.json()["pagination"]["total"] == 2
        assert [item["id"] for item in rotator_page.json()["data"]] == [str(rotator_id)]
        second_rotator_page = await client.get(
            "/api/v1/rotators?limit=1&offset=1", headers=rotator_headers
        )
        assert [item["id"] for item in second_rotator_page.json()["data"]] == [
            str(second_rotator_id)
        ]
        rotator_detail = await client.get(f"/api/v1/rotators/{rotator_id}", headers=rotator_headers)
        assert rotator_detail.status_code == 200
        assert rotator_detail.json()["data"] == rotator_page.json()["data"][0]
        assert rotator_detail.json()["data"]["azimuth_mode"] == "0_450"
        assert rotator_detail.json()["data"]["parkaz"] == 180
        assert all(field not in rotator_detail.json()["data"] for field in ("host", "port"))
        assert (
            await client.get("/api/v1/rotators/not-an-id", headers=rotator_headers)
        ).status_code == 404
        assert (
            await client.get(f"/api/v1/rotators/{uuid.uuid4()}", headers=rotator_headers)
        ).status_code == 404


@pytest.mark.asyncio
async def test_public_rig_metadata_is_scoped_paginated_and_sanitized(token_store):
    spec = startup.app.openapi()["paths"]
    assert spec["/api/v1/rigs"]["get"]["security"]
    assert spec["/api/v1/rigs/{rig_id}"]["get"]["security"]
    owner_id, _ = await _make_user(token_store, "rig-reader")
    first_id, second_id = uuid.uuid4(), uuid.uuid4()
    async with token_store() as session:
        session.add_all(
            [
                Rigs(
                    id=first_id,
                    name="Alpha rig",
                    host="private-host",
                    port=4532,
                    radiotype="hamlib",
                    radio_mode="duplex",
                    vfotype=2,
                    tx_control_mode="auto",
                    retune_interval_ms=1500,
                    follow_downlink_tuning=True,
                ),
                Rigs(
                    id=second_id,
                    name="Zulu rig",
                    host="other-host",
                    port=4533,
                    radiotype="hamlib",
                    radio_mode="simplex",
                    vfotype=1,
                ),
            ]
        )
        await session.commit()
    rig_token = await apitokens.create_token(owner_id, "password123", "Rig reader", ["rigs:read"])
    station_token = await apitokens.create_token(
        owner_id, "password123", "Station reader", ["station:read"]
    )
    rig_headers = {"Authorization": f"Bearer {rig_token['token']}"}
    station_headers = {"Authorization": f"Bearer {station_token['token']}"}
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=startup.app), base_url="http://testserver"
    ) as client:
        assert (await client.get("/api/v1/rigs")).status_code == 401
        assert (await client.get("/api/v1/rigs", headers=station_headers)).status_code == 403
        first = await client.get("/api/v1/rigs?limit=1", headers=rig_headers)
        assert first.status_code == 200
        assert first.json()["pagination"] == {"limit": 1, "offset": 0, "total": 2}
        assert [item["id"] for item in first.json()["data"]] == [str(first_id)]
        second = await client.get("/api/v1/rigs?limit=1&offset=1", headers=rig_headers)
        assert [item["id"] for item in second.json()["data"]] == [str(second_id)]
        detail = await client.get(f"/api/v1/rigs/{first_id}", headers=rig_headers)
        assert detail.json()["data"] == first.json()["data"][0]
        assert detail.json()["data"]["follow_downlink_tuning"] is True
        assert detail.json()["data"]["retune_interval_ms"] == 1500
        assert all(field not in detail.json()["data"] for field in ("host", "port"))
        assert (await client.get("/api/v1/rigs/not-an-id", headers=rig_headers)).status_code == 404
        assert (
            await client.get(f"/api/v1/rigs/{uuid.uuid4()}", headers=rig_headers)
        ).status_code == 404


@pytest.mark.asyncio
async def test_public_status_upcoming_observations_and_satellites(token_store):
    public_spec = startup.app.openapi()
    for path in (
        "/api/v1/me",
        "/api/v1/status",
        "/api/v1/observations/upcoming",
        "/api/v1/satellites",
        "/api/v1/satellites/monitored",
    ):
        assert public_spec["paths"][path]["get"]["security"]

    owner_id, _ = await _make_user(token_store, "integrator")
    now = datetime.now(timezone.utc)
    async with token_store() as session:
        session.add_all(
            [
                Satellites(norad_id=25544, name="ISS", source="manual", status="active"),
                Satellites(norad_id=33591, name="NOAA 19", source="manual"),
                MonitoredSatellites(
                    id="iss-monitor",
                    norad_id=25544,
                    enabled=True,
                    satellite_config={"name": "ISS"},
                    hardware_config={},
                    generation_config={"min_elevation": 15},
                    sessions=[],
                ),
                MonitoredSatellites(
                    id="noaa-monitor",
                    norad_id=33591,
                    enabled=False,
                    satellite_config={"name": "NOAA 19"},
                    hardware_config={},
                    generation_config={},
                    sessions=[],
                ),
            ]
        )
        session.add_all(
            [
                ScheduledObservations(
                    id="running",
                    name="ISS now",
                    norad_id=25544,
                    enabled=True,
                    status=ObservationStatus.RUNNING,
                    event_start=now - timedelta(minutes=2),
                    event_end=now + timedelta(minutes=8),
                    satellite_config={"name": "ISS"},
                    pass_config={"peak_altitude": 70},
                    hardware_config={"rig": {"private": "configuration"}},
                    sessions=[],
                ),
                ScheduledObservations(
                    id="next-iss",
                    name="ISS next",
                    norad_id=25544,
                    enabled=True,
                    status=ObservationStatus.SCHEDULED,
                    event_start=now + timedelta(hours=2),
                    event_end=now + timedelta(hours=2, minutes=10),
                    satellite_config={"name": "ISS"},
                    pass_config={"peak_altitude": 45},
                    hardware_config={"rig": {"private": "configuration"}},
                    sessions=[],
                ),
                ScheduledObservations(
                    id="disabled",
                    name="NOAA disabled",
                    norad_id=33591,
                    enabled=False,
                    status=ObservationStatus.SCHEDULED,
                    event_start=now + timedelta(hours=1),
                    event_end=now + timedelta(hours=1, minutes=10),
                    satellite_config={"name": "NOAA 19"},
                    pass_config={},
                    hardware_config={},
                    sessions=[],
                ),
            ]
        )
        await session.commit()

    full = await apitokens.create_token(
        owner_id,
        "password123",
        "Home Assistant",
        ["station:read", "satellites:read", "observations:read"],
    )
    headers = {"Authorization": f"Bearer {full['token']}"}
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=startup.app), base_url="http://testserver"
    ) as client:
        status = await client.get("/api/v1/status", headers=headers)
        assert status.status_code == 200
        assert status.json()["observation_state"] == "observing"
        assert status.json()["active_observation_count"] == 1
        assert status.json()["monitored_satellite_count"] == 1
        assert status.json()["next_observation_at"] == (now + timedelta(hours=2)).isoformat()

        upcoming = await client.get("/api/v1/observations/upcoming", headers=headers)
        assert upcoming.status_code == 200
        assert [item["id"] for item in upcoming.json()["data"]] == ["next-iss"]
        assert upcoming.json()["data"][0]["peak_altitude"] == 45
        assert "hardware_config" not in str(upcoming.json())
        assert "private" not in str(upcoming.json())
        assert (await client.get("/api/v1/observations/upcoming?hours=1", headers=headers)).json()[
            "data"
        ] == []
        assert (
            await client.get("/api/v1/observations/upcoming?norad_id=33591", headers=headers)
        ).json()["data"] == []
        assert (
            await client.get("/api/v1/observations/upcoming?hours=169", headers=headers)
        ).status_code == 422
        assert (
            await client.get("/api/v1/observations/upcoming?limit=101", headers=headers)
        ).status_code == 422
        detail = await client.get("/api/v1/observations/next-iss", headers=headers)
        assert detail.status_code == 200
        assert detail.json()["data"]["id"] == "next-iss"
        assert (
            await client.get("/api/v1/observations/missing", headers=headers)
        ).status_code == 404
        assert (
            await client.get("/api/v1/observations/upcoming?norad_id=25544", headers=headers)
        ).json()["data"][0]["id"] == "next-iss"

        monitored = await client.get("/api/v1/satellites/monitored", headers=headers)
        assert monitored.status_code == 200
        assert [item["norad_id"] for item in monitored.json()["data"]] == [25544]
        assert monitored.json()["pagination"]["total"] == 1
        catalog = await client.get("/api/v1/satellites?query=ISS", headers=headers)
        assert [item["norad_id"] for item in catalog.json()["data"]] == [25544]
        assert catalog.json()["pagination"]["total"] == 1
        wildcard = await client.get("/api/v1/satellites?query=%25", headers=headers)
        assert wildcard.json()["data"] == []
        paged = await client.get("/api/v1/satellites?limit=1&offset=1", headers=headers)
        assert len(paged.json()["data"]) == 1
        assert paged.json()["pagination"]["total"] == 2
        assert (
            await client.get("/api/v1/satellites?limit=101", headers=headers)
        ).status_code == 422
        both = await client.get(
            "/api/v1/satellites/monitored?enabled_only=false&limit=1&offset=1", headers=headers
        )
        assert [item["norad_id"] for item in both.json()["data"]] == [33591]
        assert both.json()["pagination"]["total"] == 2
        satellite = await client.get("/api/v1/satellites/25544", headers=headers)
        assert satellite.json()["data"]["name"] == "ISS"
        assert (await client.get("/api/v1/satellites/99999", headers=headers)).status_code == 404

    station_only = await apitokens.create_token(
        owner_id, "password123", "station only", ["station:read"]
    )
    limited_headers = {"Authorization": f"Bearer {station_only['token']}"}
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=startup.app), base_url="http://testserver"
    ) as client:
        assert (await client.get("/api/v1/status", headers=limited_headers)).status_code == 200
        assert (
            await client.get("/api/v1/observations/upcoming", headers=limited_headers)
        ).status_code == 403
        assert (
            await client.get("/api/v1/satellites/monitored", headers=limited_headers)
        ).status_code == 403
        assert (await client.get("/api/v1/satellites", headers=limited_headers)).status_code == 403
        assert (await client.get("/api/v1/status")).status_code == 401


@pytest.mark.asyncio
async def test_every_public_route_requires_a_pat_and_its_scope(token_store, monkeypatch):
    owner_id, browser_secret = await _make_user(token_store, "scope-matrix")
    full = await apitokens.create_token(
        owner_id,
        "password123",
        "All read scopes",
        ["station:read", "satellites:read", "observations:read", "artifacts:read"],
    )
    station_only = await apitokens.create_token(
        owner_id, "password123", "Station only", ["station:read"]
    )
    satellites_only = await apitokens.create_token(
        owner_id, "password123", "Satellites only", ["satellites:read"]
    )

    class InventoryStub:
        def query(self, *, page, page_size):
            return {
                "items": [{"id": "artifact-1", "name": "Recording"}],
                "total": 1,
                "page": page,
                "page_size": page_size,
                "revision": 1,
                "has_more": False,
                "diskUsage": 0,
            }

        def detail(self, item_id):
            return {"id": "artifact-1", "name": "Recording"} if item_id == "artifact-1" else None

    monkeypatch.setattr(startup, "get_inventory", lambda: InventoryStub())
    full_headers = {"Authorization": f"Bearer {full['token']}"}
    station_headers = {"Authorization": f"Bearer {station_only['token']}"}
    satellites_headers = {"Authorization": f"Bearer {satellites_only['token']}"}
    routes = (
        ("/api/v1/station", "station:read", 200),
        ("/api/v1/status", "station:read", 200),
        ("/api/v1/trackers/rotators", "station:read", 200),
        ("/api/v1/trackers/rigs", "station:read", 200),
        ("/api/v1/observations", "observations:read", 200),
        ("/api/v1/observations/upcoming", "observations:read", 200),
        ("/api/v1/observations/missing", "observations:read", 404),
        ("/api/v1/satellites", "satellites:read", 200),
        ("/api/v1/satellites/monitored", "satellites:read", 200),
        ("/api/v1/satellites/99999", "satellites:read", 404),
        ("/api/v1/artifacts?page=2&page_size=1", "artifacts:read", 200),
        ("/api/v1/artifacts/artifact-1", "artifacts:read", 200),
        ("/api/v1/artifacts/missing", "artifacts:read", 404),
    )
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=startup.app), base_url="http://testserver"
    ) as client:
        assert (await client.get("/api/v1/me")).status_code == 401
        assert (
            await client.get("/api/v1/me", cookies={auth.AUTH_SESSION_COOKIE_NAME: browser_secret})
        ).status_code == 401
        assert (await client.get("/api/v1/me", headers=full_headers)).json()["user_id"] == owner_id

        for path, required_scope, expected_status in routes:
            assert (await client.get(path)).status_code == 401, path
            wrong_headers = (
                satellites_headers if required_scope == "station:read" else station_headers
            )
            assert (await client.get(path, headers=wrong_headers)).status_code == 403, path
            response = await client.get(path, headers=full_headers)
            assert response.status_code == expected_status, path
            if path.startswith("/api/v1/artifacts") and expected_status == 200:
                assert "artifact-1" in response.text

        artifact_page = await client.get(
            "/api/v1/artifacts?page=2&page_size=1", headers=full_headers
        )
        assert artifact_page.json()["page"] == 2
        assert artifact_page.json()["page_size"] == 1


@pytest.mark.asyncio
async def test_tracker_rotator_snapshot_uses_current_live_worker(token_store, monkeypatch):
    owner_id, _ = await _make_user(token_store, "rotator-snapshot")
    station = await apitokens.create_token(
        owner_id, "password123", "Station reader", ["station:read"]
    )
    other = await apitokens.create_token(
        owner_id, "password123", "Catalog reader", ["satellites:read"]
    )
    registry = OperationRegistry()
    registry.observe(
        {
            "tracker_id": "target-1",
            "worker_started_at": 1,
            "worker_generation": "worker-1",
            "worker_pid": 42,
            "sequence": 1,
            "observed_at": 1792068000.0,
            "tracking_state": {"rotator_id": "mount"},
            "rotator_data": {
                "connected": True,
                "tracking": True,
                "slewing": True,
                "host": "secret",
            },
        }
    )
    process = SimpleNamespace(pid=42, is_alive=lambda: True)
    instances = [
        {"tracker_id": "target-1", "rotator_id": "mount", "tracking_state": {}},
        {"tracker_id": "target-2", "rotator_id": None, "tracking_state": {}},
    ]
    supervisor = SimpleNamespace(
        get_instances_payload=lambda: {"instances": instances},
        get_runtime=lambda _tracker_id: SimpleNamespace(process=process),
    )
    monkeypatch.setattr(startup, "operations", registry)
    monkeypatch.setattr(startup, "get_tracker_supervisor", lambda: supervisor)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=startup.app), base_url="http://testserver"
    ) as client:
        path = "/api/v1/trackers/rotators"
        assert (await client.get(path)).status_code == 401
        assert (
            await client.get(path, headers={"Authorization": f"Bearer {other['token']}"})
        ).status_code == 403
        headers = {"Authorization": f"Bearer {station['token']}"}
        response = await client.get(path, headers=headers)
        assert response.status_code == 200
        assert response.json() == {
            "data": [
                {
                    "tracker_id": "target-1",
                    "device_id": "mount",
                    "state": "slewing",
                    "tracking_enabled": True,
                    "observed_at": 1792068000.0,
                }
            ]
        }
        assert "secret" not in response.text

        process.pid = 43
        assert (await client.get(path, headers=headers)).json()["data"][0] == {
            "tracker_id": "target-1",
            "device_id": "mount",
            "state": "unavailable",
            "tracking_enabled": False,
            "observed_at": None,
        }
        process.pid = 42
        instances[0]["rotator_id"] = "other-mount"
        assert (await client.get(path, headers=headers)).json()["data"][0]["state"] == (
            "unavailable"
        )
        instances[0]["rotator_id"] = "mount"
        process.is_alive = lambda: False
        assert (await client.get(path, headers=headers)).json()["data"][0]["state"] == (
            "unavailable"
        )


@pytest.mark.asyncio
async def test_tracker_rig_snapshot_uses_current_live_worker(token_store, monkeypatch):
    owner_id, _ = await _make_user(token_store, "rig-snapshot-reader")
    station = await apitokens.create_token(
        owner_id, "password123", "Station reader", ["station:read"]
    )
    other = await apitokens.create_token(owner_id, "password123", "Rig reader", ["rigs:read"])
    registry = OperationRegistry()
    registry.observe(
        {
            "tracker_id": "target-1",
            "worker_started_at": 1,
            "worker_generation": "worker-1",
            "worker_pid": 42,
            "sequence": 1,
            "observed_at": 1792068000.0,
            "tracking_state": {"rig_id": "radio"},
            "rig_data": {
                "connected": True,
                "tracking": True,
                "host": "secret",
                "frequency": 145800000,
            },
        }
    )
    process = SimpleNamespace(pid=42, is_alive=lambda: True)
    instances = [
        {"tracker_id": "target-1", "rig_id": "radio", "tracking_state": {}},
        {"tracker_id": "target-2", "rig_id": None, "tracking_state": {}},
    ]
    supervisor = SimpleNamespace(
        get_instances_payload=lambda: {"instances": instances},
        get_runtime=lambda _tracker_id: SimpleNamespace(process=process),
    )
    monkeypatch.setattr(startup, "operations", registry)
    monkeypatch.setattr(startup, "get_tracker_supervisor", lambda: supervisor)
    headers = {"Authorization": f"Bearer {station['token']}"}
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=startup.app), base_url="http://testserver"
    ) as client:
        path = "/api/v1/trackers/rigs"
        assert (await client.get(path)).status_code == 401
        assert (
            await client.get(path, headers={"Authorization": f"Bearer {other['token']}"})
        ).status_code == 403
        response = await client.get(path, headers=headers)
        assert response.json() == {
            "data": [
                {
                    "tracker_id": "target-1",
                    "device_id": "radio",
                    "state": "tracking",
                    "tracking_enabled": True,
                    "observed_at": 1792068000.0,
                }
            ]
        }
        assert "secret" not in response.text
        assert "145800000" not in response.text
        process.pid = 43
        assert (await client.get(path, headers=headers)).json()["data"][0]["state"] == "unavailable"
        process.pid = 42
        instances[0]["rig_id"] = "other-radio"
        assert (await client.get(path, headers=headers)).json()["data"][0]["state"] == "unavailable"
        instances[0]["rig_id"] = "radio"
        process.is_alive = lambda: False
        assert (await client.get(path, headers=headers)).json()["data"][0]["state"] == "unavailable"


@pytest.mark.asyncio
async def test_artifact_downloads_are_scoped_and_support_ranges(token_store, monkeypatch, tmp_path):
    download_spec = startup.app.openapi()["paths"]["/api/v1/artifacts/{artifact_id}/download"][
        "get"
    ]
    assert "application/octet-stream" in download_spec["responses"]["200"]["content"]
    assert "application/zip" in download_spec["responses"]["200"]["content"]
    owner_id, browser_secret = await _make_user(token_store, "artifact-consumer")
    read_token = await apitokens.create_token(
        owner_id, "password123", "Metadata", ["artifacts:read"]
    )
    download_token = await apitokens.create_token(
        owner_id, "password123", "Downloads", ["artifacts:download"]
    )
    read_headers = {"Authorization": f"Bearer {read_token['token']}"}
    download_headers = {"Authorization": f"Bearer {download_token['token']}"}

    backend = tmp_path / "backend"
    data = backend / "data"
    for name in ("recordings", "snapshots", "decoded", "audio", "transcriptions", "observations"):
        (data / name).mkdir(parents=True)
    (data / "recordings" / "capture.sigmf-data").write_bytes(b"abcdefgh")
    (data / "recordings" / "capture.sigmf-meta").write_text('{"global":{}}')
    (data / "recordings" / "capture.png").write_bytes(b"waterfall")
    (data / "recordings" / "capture_waterfall_thumb.png").write_bytes(b"preview")
    (data / "snapshots" / "waterfall.png").write_bytes(b"snapshot")
    (data / "decoded" / "packet.bin").write_bytes(b"packet")
    (data / "decoded" / "packet.json").write_text("{}")
    (data / "audio" / "voice.wav").write_bytes(b"voice")
    (data / "audio" / "voice.json").write_text("{}")
    (data / "transcriptions" / "voice.txt").write_text("transcript")
    bundle = data / "observations" / "NOAA.gsobs"
    (bundle / "decoded").mkdir(parents=True)
    (bundle / "manifest.json").write_text("{}")
    (bundle / "decoded" / "image.png").write_bytes(b"image")
    outside = tmp_path / "outside.txt"
    outside.write_text("private")
    (bundle / "outside.txt").symlink_to(outside)
    inventory = LibraryInventory(backend)
    inventory.rebuild()
    monkeypatch.setattr(startup, "get_inventory", lambda: inventory)

    # Exercise the actual snapshot mount with fixture files, preserving its
    # browser-session contract after switching it to authenticated static files.
    snapshot_mount = next(route for route in startup.app.routes if route.path == "/snapshots")
    assert isinstance(snapshot_mount.app, startup.AuthenticatedStaticFiles)
    monkeypatch.setattr(
        snapshot_mount.app,
        "_static_files",
        StaticFiles(directory=str(data / "snapshots"), html=True),
    )

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=startup.app), base_url="http://testserver"
    ) as client:
        metadata = await client.get("/api/v1/artifacts", headers=read_headers)
        assert metadata.status_code == 200
        recording = next(
            item for item in metadata.json()["items"] if item["id"] == "recording:capture"
        )
        assert recording["api_download_urls"]["meta"].endswith("?part=meta")
        assert (await client.get(recording["api_download_url"])).status_code == 401
        assert (
            await client.get(recording["api_download_url"], headers=read_headers)
        ).status_code == 403
        assert (await client.get("/api/v1/artifacts", headers=download_headers)).status_code == 403

        downloaded = await client.get(recording["api_download_url"], headers=download_headers)
        assert downloaded.status_code == 200
        assert downloaded.content == b"abcdefgh"
        assert downloaded.headers["accept-ranges"] == "bytes"
        partial = await client.get(
            recording["api_download_url"],
            headers={**download_headers, "Range": "bytes=2-4"},
        )
        assert partial.status_code == 206
        assert partial.content == b"cde"
        assert partial.headers["content-range"] == "bytes 2-4/8"
        assert (
            await client.get(recording["api_download_urls"]["meta"], headers=download_headers)
        ).json() == {"global": {}}
        assert (
            await client.get(recording["api_download_urls"]["thumbnail"], headers=download_headers)
        ).content == b"preview"

        for item_id, expected in (
            ("snapshot:waterfall.png", b"snapshot"),
            ("decoded:packet.bin", b"packet"),
            ("audio:voice.wav", b"voice"),
            ("transcription:voice.txt", b"transcript"),
        ):
            detail = await client.get(f"/api/v1/artifacts/{item_id}", headers=read_headers)
            assert detail.status_code == 200
            response = await client.get(
                detail.json()["data"]["api_download_url"], headers=download_headers
            )
            assert response.content == expected
            if item_id in {"decoded:packet.bin", "audio:voice.wav"}:
                metadata_url = detail.json()["data"]["api_download_urls"]["metadata"]
                assert metadata_url.endswith("?part=metadata")
                assert (await client.get(metadata_url, headers=download_headers)).json() == {}

        detail = await client.get("/api/v1/artifacts/observation:NOAA.gsobs", headers=read_headers)
        assert detail.status_code == 200
        item = detail.json()["data"]
        member_url = next(
            entry["api_download_url"]
            for entry in item["artifacts"]
            if entry["path"] == "decoded/image.png"
        )
        assert (await client.get(member_url, headers=download_headers)).content == b"image"
        assert all(entry["path"] != "outside.txt" for entry in item["artifacts"])
        zipped = await client.get(item["api_download_url"], headers=download_headers)
        assert zipped.status_code == 200
        with zipfile.ZipFile(io.BytesIO(zipped.content)) as archive:
            assert archive.read("decoded/image.png") == b"image"
            assert "outside.txt" not in archive.namelist()
        assert (
            await client.get(
                "/api/v1/artifacts/observation:NOAA.gsobs/files/outside.txt",
                headers=download_headers,
            )
        ).status_code == 404
        assert inventory.resolve_download("observation:NOAA.gsobs", member="../outside.txt") is None
        assert (
            await client.get(
                "/api/v1/artifacts/recording:capture/download?part=unknown",
                headers=download_headers,
            )
        ).status_code == 404

        assert (await client.get("/snapshots/waterfall.png")).status_code == 401
        assert (
            await client.get("/snapshots/waterfall.png", headers=download_headers)
        ).status_code == 401
        browser = await client.get(
            "/snapshots/waterfall.png", cookies={auth.AUTH_SESSION_COOKIE_NAME: browser_secret}
        )
        assert browser.status_code == 200
        assert browser.content == b"snapshot"

        assert await apitokens.revoke_token(owner_id, download_token["data"]["id"])
        assert (
            await client.get(recording["api_download_url"], headers=download_headers)
        ).status_code == 401


def _event_request(secret: str) -> Request:
    return Request(
        {
            "type": "http",
            "method": "GET",
            "path": "/api/v1/events",
            "headers": [(b"authorization", f"Bearer {secret}".encode())],
        }
    )


@pytest.mark.asyncio
async def test_public_event_stream_scopes_changes_and_revocation(token_store, monkeypatch):
    spec = startup.app.openapi()["paths"]["/api/v1/events"]["get"]
    assert spec["security"]
    assert "text/event-stream" in spec["responses"]["200"]["content"]
    assert "tracker.rotator.state.changed" in {
        event["event"] for event in spec["responses"]["200"]["x-sse-events"]
    }
    assert "tracker.rig.state.changed" in {
        event["event"] for event in spec["responses"]["200"]["x-sse-events"]
    }

    owner_id, browser_secret = await _make_user(token_store, "events-owner")
    full = await apitokens.create_token(
        owner_id,
        "password123",
        "Event consumer",
        ["station:read", "observations:read", "artifacts:read"],
    )
    unrelated = await apitokens.create_token(
        owner_id, "password123", "Satellite catalog only", ["satellites:read"]
    )
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=startup.app), base_url="http://testserver"
    ) as client:
        assert (await client.get("/api/v1/events")).status_code == 401
        assert (
            await client.get(
                "/api/v1/events", cookies={auth.AUTH_SESSION_COOKIE_NAME: browser_secret}
            )
        ).status_code == 401
        assert (
            await client.get(
                "/api/v1/events", headers={"Authorization": f"Bearer {unrelated['token']}"}
            )
        ).status_code == 403

    now = datetime.now(timezone.utc)
    async with token_store() as session:
        session.add(Satellites(norad_id=25544, name="ISS", source="manual"))
        session.add(
            MonitoredSatellites(
                id="sse-monitor",
                norad_id=25544,
                enabled=False,
                satellite_config={"name": "ISS"},
                hardware_config={},
                generation_config={},
                sessions=[],
            )
        )
        session.add(
            ScheduledObservations(
                id="sse-test",
                name="ISS pass",
                norad_id=25544,
                enabled=True,
                status=ObservationStatus.SCHEDULED,
                event_start=now + timedelta(hours=1),
                event_end=now + timedelta(hours=1, minutes=10),
                satellite_config={"name": "ISS"},
                pass_config={},
                hardware_config={},
                sessions=[],
            )
        )
        await session.commit()

    response = await startup.api_events(_event_request(full["token"]))
    assert response.media_type == "text/event-stream"
    assert response.headers["x-accel-buffering"] == "no"
    chunks = response.body_iterator
    try:
        assert await anext(chunks) == "retry: 3000\n\n"
        assert 'event: connected\ndata: {"replay":false}' in await anext(chunks)
        assert '"observation_state":"idle"' in await anext(chunks)

        public_events.target_changed(
            "target-1",
            {"type": "satellite", "id": "25544", "name": "ISS"},
            {"type": "body", "id": "body:mars", "name": "Mars"},
        )
        assert await anext(chunks) == (
            'event: target.changed\ndata: {"tracker_id":"target-1",'
            '"previous":{"type":"satellite","id":"25544","name":"ISS"},'
            '"current":{"type":"body","id":"body:mars","name":"Mars"}}\n\n'
        )
        public_events.sdr_stream_started("sdr-1")
        public_events.sdr_stream_stopped("sdr-1")
        assert await anext(chunks) == ('event: sdr.streaming.started\ndata: {"sdr_id":"sdr-1"}\n\n')
        assert await anext(chunks) == ('event: sdr.streaming.stopped\ndata: {"sdr_id":"sdr-1"}\n\n')
        public_events.target_slot_created("target-2")
        public_events.target_visibility_changed("target-2", "25544", "ISS", 0.5, True)
        public_events.target_visibility_changed("target-2", "25544", "ISS", 0.0, False)
        public_events.tracker_hardware_changed("target-2", "rig", "radio", True, False)
        public_events.observe_rotator(
            "target-2",
            {
                "worker_generation": "worker-1",
                "observed_at": 1792068000.0,
                "tracking_state": {"rotator_id": "mount"},
                "rotator_data": {"connected": True, "tracking": True, "slewing": True},
            },
        )
        public_events.observe_rig(
            "target-2",
            {
                "worker_generation": "worker-1",
                "observed_at": 1792068000.0,
                "tracking_state": {"rig_id": "radio"},
                "rig_data": {"connected": True, "tracking": True, "frequency": 145800000},
            },
        )
        public_events.target_slot_deleted("target-2")
        public_events.artifact_ready("snapshot:new.png", "snapshot", "new.png")
        assert [(await anext(chunks)).split("\n", 1)[0] for _ in range(8)] == [
            "event: target.slot.created",
            "event: target.visible",
            "event: target.below_horizon",
            "event: tracker.hardware.changed",
            "event: tracker.rotator.state.changed",
            "event: tracker.rig.state.changed",
            "event: target.slot.deleted",
            "event: artifact.ready",
        ]

        async with token_store() as session:
            result = await observation_crud.update_scheduled_observation_status(
                session, "sse-test", "running"
            )
        assert result["success"] is True
        assert 'event: observations.changed\ndata: {"id":"sse-test","status":"running"}' in (
            await anext(chunks)
        )
        assert '"observation_state":"observing"' in await anext(chunks)

        async with token_store() as session:
            result = await monitored_crud.toggle_monitored_satellite_enabled(
                session, "sse-monitor", True
            )
        assert result["success"] is True
        assert '"monitored_satellite_count":1' in await anext(chunks)

        assert await apitokens.revoke_token(owner_id, full["data"]["id"])
        monkeypatch.setattr(startup, "EVENT_STREAM_CHECK_INTERVAL_SECONDS", 0)
        with pytest.raises(StopAsyncIteration):
            await anext(chunks)
    finally:
        await chunks.aclose()


@pytest.mark.asyncio
async def test_artifact_only_event_stream_receives_ready_events(token_store):
    owner_id, _ = await _make_user(token_store, "artifact-events")
    token = await apitokens.create_token(
        owner_id, "password123", "Artifact listener", ["artifacts:read"]
    )
    response = await startup.api_events(_event_request(token["token"]))
    chunks = response.body_iterator
    try:
        assert await anext(chunks) == "retry: 3000\n\n"
        assert "event: connected" in await anext(chunks)
        subscription = next(
            subscriber
            for subscriber in public_events._subscribers
            if subscriber.token_id == token["data"]["id"]
        )
        public_events.target_slot_created("target-1")
        public_events.observe_rotator(
            "target-1",
            {
                "worker_generation": "worker-1",
                "tracking_state": {"rotator_id": "mount"},
                "rotator_data": {"connected": True},
            },
        )
        public_events.observations_changed()
        assert subscription.queue.empty()
        public_events.artifact_ready("snapshot:new.png", "snapshot", "new.png")
        assert await anext(chunks) == (
            'event: artifact.ready\ndata: {"id":"snapshot:new.png",'
            '"type":"snapshot","name":"new.png"}\n\n'
        )
    finally:
        await chunks.aclose()


@pytest.mark.asyncio
async def test_observation_only_stream_and_bounded_subscribers(token_store):
    owner_id, _ = await _make_user(token_store, "observation-events")
    token = await apitokens.create_token(
        owner_id, "password123", "Observation listener", ["observations:read"]
    )
    response = await startup.api_events(_event_request(token["token"]))
    chunks = response.body_iterator
    try:
        assert await anext(chunks) == "retry: 3000\n\n"
        assert "event: connected" in await anext(chunks)
        subscription = next(
            subscriber
            for subscriber in public_events._subscribers
            if subscriber.token_id == token["data"]["id"]
        )
        public_events.status_changed()
        assert subscription.queue.empty()
        public_events.target_changed("target-1", None, {"type": "satellite", "id": "25544"})
        public_events.sdr_stream_started("sdr-1")
        public_events.sdr_stream_stopped("sdr-1")
        assert subscription.queue.empty()
        public_events.observations_changed()
        assert await anext(chunks) == "event: observations.changed\ndata: {}\n\n"
        assert subscription.queue.empty()
    finally:
        await chunks.aclose()

    broker = EventBroker()
    subscribers = [broker.subscribe("same-token", ["station:read"]) for _ in range(5)]
    with pytest.raises(ValueError, match="Too many open"):
        broker.subscribe("same-token", ["station:read"])
    broker.unsubscribe(subscribers[-1])
    replacement = broker.subscribe("same-token", ["station:read"])
    for _ in range(33):
        broker.status_changed()
    assert subscribers[0].queue.get_nowait() is None
    broker.unsubscribe(replacement)
