# Copyright (c) 2026 Efstratios Goudelis
# SPDX-License-Identifier: GPL-3.0-or-later

from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, MagicMock

import pytest

from common import auth
from common.transmittersearch import TransmitterSearchRequest
from crud.transmitters import search_transmitters
from db.models import CelestialTargets, Satellites, Transmitters
from handlers.entities import transmitters as handlers
from handlers.routing.dispatcher import dispatch_request
from handlers.routing.registry import HandlerRegistry

pytestmark = [pytest.mark.unit, pytest.mark.asyncio]


@pytest.fixture
async def catalog(db_session):
    db_session.add_all(
        [
            Satellites(norad_id=25544, name="ISS", alternative_name="Zarya"),
            Satellites(norad_id=99999, name="Percent%_Satellite"),
            CelestialTargets(id="mission:probe", target_type="mission", display_name="Deep Probe"),
            CelestialTargets(id="body:moon", target_type="body", display_name="Moon"),
        ]
    )
    await db_session.flush()

    def transmitter(id, description, low, high=None, **kwargs):
        return Transmitters(
            id=id,
            description=description,
            downlink_low=low,
            downlink_high=high,
            status=kwargs.pop("status", "active"),
            **kwargs,
        )

    db_session.add_all(
        [
            transmitter("aprs", "APRS", 145825000, norad_cat_id=25544, mode="FM", baud=1200),
            transmitter(
                "voice", "Voice", 145800000, norad_cat_id=25544, alive=False, status="inactive"
            ),
            transmitter(
                "band",
                "Linear transponder",
                145700000,
                145900000,
                norad_cat_id=25544,
                mode="FSK",
                baud=1234,
                deviation=563.5,
                framing="geoscan",
            ),
            transmitter("high", "High only", None, 145850000, norad_cat_id=25544),
            transmitter("unknown", "Unknown downlink", None, norad_cat_id=25544),
            transmitter(
                "probe",
                "Telemetry",
                8400000000,
                target_key="mission:probe",
                mode="LoRa",
                lora_config={"sf": 10, "bw": 250000, "sync_word": [18], "has_crc": False},
            ),
            transmitter("moon", "Lunar beacon", 2400000000, target_key="body:moon"),
            transmitter("literal", "Special", 437000000, norad_cat_id=99999),
        ]
    )
    await db_session.flush()
    return db_session


@pytest.mark.parametrize(
    "keyword,expected",
    [
        ("iss aprs", {"aprs"}),
        ("ZARYA", {"aprs", "voice", "band", "high", "unknown"}),
        ("25544", {"aprs", "voice", "band", "high", "unknown"}),
        ("Deep Probe", {"probe"}),
        ("moon", {"moon"}),
        ("Telemetry", {"probe"}),
        ("%_", {"literal"}),
        ("' OR 1=1 --", set()),
        ("absent", set()),
    ],
)
async def test_catalog_scope_and_literal_text(catalog, keyword, expected):
    reply = await search_transmitters(catalog, TransmitterSearchRequest(keyword=keyword))
    assert reply["success"] is True
    assert {row["id"] for row in reply["data"]} == expected
    assert reply["total"] == len(expected)
    assert reply["has_more"] is False
    if keyword == "Deep Probe":
        assert reply["data"][0]["owner_type"] == "mission"
        assert reply["data"][0]["owner_name"] == "Deep Probe"


@pytest.mark.parametrize(
    "keyword,expected",
    [
        ("145.825", {"aprs", "band"}),
        ("145.8 MHz", {"aprs", "voice", "band", "high"}),
        ("145825 kHz", {"aprs", "band"}),
        ("145825000 Hz", {"aprs", "band"}),
        ("145825000", {"aprs", "band"}),
        ("145.824999 MHz", {"band"}),
        ("145.8250005 MHz", {"band"}),
        ("145.8249999 MHz", {"band"}),
        ("145.6", set()),
        ("8.4 GHz", {"probe"}),
        ("99999999999999999999999999999999999999999999999999", set()),
    ],
)
async def test_frequency_prefix_and_passband_overlap(catalog, keyword, expected):
    reply = await search_transmitters(catalog, TransmitterSearchRequest(keyword=keyword))
    assert reply["success"] is True
    assert {row["id"] for row in reply["data"]} == expected


async def test_search_returns_stored_decoder_profile_metadata(catalog):
    fsk = await search_transmitters(catalog, TransmitterSearchRequest(keyword="Linear transponder"))
    assert fsk["data"][0]["baud"] == 1234
    assert fsk["data"][0]["deviation"] == 563.5
    assert fsk["data"][0]["framing"] == "geoscan"
    lora = await search_transmitters(catalog, TransmitterSearchRequest(keyword="Deep Probe"))
    assert lora["data"][0]["lora_config"] == {
        "sf": 10,
        "bw": 250000,
        "sync_word": [18],
        "has_crc": False,
    }


async def test_bounded_pages_with_stable_ties_and_relevance(catalog):
    catalog.add_all(
        [
            Transmitters(
                id=f"duplicate-{index:02}",
                norad_cat_id=25544,
                description="APRS duplicate",
                status="active",
            )
            for index in range(52)
        ]
    )
    await catalog.flush()
    pages = [
        await search_transmitters(
            catalog,
            TransmitterSearchRequest(
                keyword="aprs",
                page=page,
                page_size=20,
            ),
        )
        for page in range(4)
    ]
    ids = [row["id"] for page in pages for row in page["data"]]
    assert ids[0] == "aprs"  # Exact descriptions rank ahead of prefixes.
    assert len(ids) == len(set(ids)) == 53
    assert [len(page["data"]) for page in pages] == [20, 20, 13, 0]
    assert [page["has_more"] for page in pages] == [True, True, False, False]
    assert all(page["total"] == 53 for page in pages)
    repeat = await search_transmitters(catalog, TransmitterSearchRequest(keyword="aprs"))
    assert repeat["data"] == pages[0]["data"]


@pytest.mark.parametrize(
    "payload",
    [
        None,
        [],
        "iss",
        {},
        {"keyword": 25544},
        {"keyword": " "},
        {"keyword": "x"},
        {"keyword": "x" * 101},
        {"keyword": "iss", "page": -1},
        {"keyword": "iss", "page": 10001},
        {"keyword": "iss", "page_size": 51},
        {"keyword": "iss", "page_size": 0},
        {"keyword": "iss", "page_size": True},
        {"keyword": "iss", "page": 1.5},
        {"keyword": "iss", "limit": 20},
    ],
)
async def test_invalid_requests_do_not_open_database(monkeypatch, payload):
    session_factory = MagicMock()
    monkeypatch.setattr(handlers, "AsyncSessionLocal", session_factory)
    reply = await handlers.search_transmitters(None, payload, MagicMock(), "sid")
    assert reply["success"] is False
    assert reply["error"] == "Invalid transmitter search request."
    assert reply["validation_errors"]
    session_factory.assert_not_called()


async def test_search_uses_existing_authenticated_dispatch(catalog, monkeypatch):
    @asynccontextmanager
    async def session_factory():
        yield catalog

    monkeypatch.setattr(handlers, "AsyncSessionLocal", session_factory)
    monkeypatch.setattr(auth, "is_setup_required", AsyncMock(return_value=False))
    registry = HandlerRegistry()
    handlers.register_handlers(registry)
    args = (None, "get-transmitter-search", {"keyword": " iss aprs "}, MagicMock(), "sid", registry)
    denied = await dispatch_request(*args)
    assert denied["success"] is False
    allowed = await dispatch_request(*args, auth_context={"role": "operator"})
    assert allowed["success"] is True
    assert allowed["data"][0]["id"] == "aprs"
    assert allowed["data"][0]["downlink_low"] == 145825000


async def test_database_errors_are_logged_without_leaking_details():
    session = MagicMock()
    session.scalar = AsyncMock(side_effect=RuntimeError("private database details"))
    reply = await search_transmitters(session, TransmitterSearchRequest(keyword="iss"))
    assert reply == {"success": False, "data": [], "error": "Unable to search transmitters."}
