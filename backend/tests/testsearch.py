from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, Mock

import pytest

from crud import satellites
from db.models import Groups, Satellites, Transmitters
from handlers.entities import satellites as handlers


@pytest.fixture
async def search_catalog(db_session):
    norad_ids = list(range(50000, 50060))
    db_session.add_all(
        Satellites(norad_id=norad_id, name=f"STARLINK-{norad_id}")
        for norad_id in reversed(norad_ids)
    )
    db_session.add(Groups(name="All Active", satellite_ids=norad_ids))
    db_session.add(Transmitters(id="tx-first", norad_cat_id=50000, status="active"))
    await db_session.commit()
    return db_session


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("filters", "expected"),
    [
        (None, 20),
        ({"limit": 3}, 3),
        ({"limit": 500}, 50),
        ({"limit": 0}, 20),
        ({"limit": -1}, 20),
        ({"limit": "invalid"}, 20),
    ],
)
async def test_autocomplete_limits_rows_before_enrichment(
    search_catalog, monkeypatch, filters, expected
):
    orbit_lookup = AsyncMock(wraps=satellites._attach_primary_earth_orbits)
    transmitter_lookup = AsyncMock(wraps=satellites._attach_catalog_transmitters)
    monkeypatch.setattr(satellites, "_attach_primary_earth_orbits", orbit_lookup)
    monkeypatch.setattr(satellites, "_attach_catalog_transmitters", transmitter_lookup)

    reply = await satellites.search_satellites(search_catalog, "starlink", filters=filters)

    assert reply["success"] is True
    assert [row["norad_id"] for row in reply["data"]] == list(range(50000, 50000 + expected))
    assert len(orbit_lookup.await_args.args[1]) == expected
    assert len(transmitter_lookup.await_args.args[1]) == expected
    # Search limits preserve the complete payload used when selecting a target.
    assert reply["data"][0]["groups"][0]["satellite_ids"] == list(range(50000, 50060))
    assert reply["data"][0]["transmitters"][0]["id"] == "tx-first"


@pytest.mark.asyncio
async def test_catalog_pagination_keeps_its_existing_page_size(search_catalog):
    reply = await satellites.search_satellites(
        search_catalog, "starlink", filters={"page": 0, "page_size": 55}
    )
    assert reply["success"] is True
    assert len(reply["data"]) == 55
    assert reply["total"] == 60


@pytest.mark.asyncio
@pytest.mark.parametrize(("limit", "expected"), [(3, 3), (500, 50)])
async def test_shared_target_search_limits_enrichment(search_catalog, monkeypatch, limit, expected):
    @asynccontextmanager
    async def session_context():
        yield search_catalog

    orbit_lookup = AsyncMock(wraps=satellites._attach_primary_earth_orbits)
    monkeypatch.setattr(handlers, "AsyncSessionLocal", session_context)
    monkeypatch.setattr(handlers, "search_spacecraft_index", lambda **kwargs: [])
    monkeypatch.setattr(handlers, "search_celestial_bodies", lambda **kwargs: [])
    monkeypatch.setattr(satellites, "_attach_primary_earth_orbits", orbit_lookup)

    reply = await handlers.search_targets(
        None, {"query": "starlink", "limit": limit}, Mock(), "sid"
    )

    assert reply["success"] is True
    assert len(reply["data"]) == expected
    assert len(orbit_lookup.await_args.args[1]) == expected
