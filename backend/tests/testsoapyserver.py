"""Direct server queries bypass mDNS and never persist draft hardware."""

import asyncio
import logging
from unittest.mock import AsyncMock

import pytest

from handlers.entities import hardware as handlers
from hardware import parameters, soapysdrbrowser

pytestmark = pytest.mark.unit
RADIOS = [{"driver": "remote", "remote:driver": "rtlsdr", "serial": "ABC"}]


@pytest.fixture(autouse=True)
def query(monkeypatch):
    monkeypatch.setattr(parameters, "_sdr_parameter_locks", {})
    native_query = AsyncMock(return_value=(RADIOS, "active"))
    monkeypatch.setattr(handlers, "query_server_for_sdrs", native_query)
    return native_query


async def request(data):
    return await handlers.query_soapy_server(None, data, logging.getLogger(__name__), "admin")


@pytest.mark.asyncio
@pytest.mark.parametrize("radios", [RADIOS, []])
async def test_queries_draft_endpoint_without_changing_discovery(query, monkeypatch, radios):
    discovered = {"mdns": {"ip": "other.local", "port": 55132}}
    monkeypatch.setattr(handlers, "discovered_servers", discovered)
    query.return_value = (radios, "active")
    reply = await request({"host": " radio.example.org ", "port": "55133"})
    assert reply == {
        "success": True,
        "data": {
            "ip": "radio.example.org",
            "port": 55133,
            "name": "radio.example.org",
            "status": "active",
            "sdrs": radios,
        },
    }
    query.assert_awaited_once_with("radio.example.org", 55133)
    assert discovered == {"mdns": {"ip": "other.local", "port": 55132}}


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "data",
    [
        None,
        {},
        {"host": ""},
        {"host": 123},
        {"host": "http://radio.local"},
        {"host": "radio local"},
        *[{"host": "radio.local", "port": port} for port in [0, 65536, "bad", 1.5, True]],
    ],
)
async def test_invalid_endpoint_does_not_start_native_query(query, data):
    reply = await request(data)
    assert reply["success"] is False
    assert reply["error"]
    query.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "status,detail",
    [
        ("unreachable", "connect"),
        ("timeout", "timed out"),
        ("unavailable", "bindings"),
        ("error: driver failure", "list"),
    ],
)
async def test_query_failures_are_distinct_from_empty_device_lists(query, status, detail):
    query.return_value = ([], status)
    reply = await request({"host": "radio.local"})
    assert reply["success"] is False
    assert detail in reply["error"]
    query.assert_awaited_once_with("radio.local", 55132)


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", [asyncio.TimeoutError(), RuntimeError("native failure")])
async def test_failed_query_releases_endpoint_for_retry(query, failure):
    query.side_effect = failure
    assert (await request({"host": "radio.local"}))["success"] is False
    query.side_effect = None
    assert (await request({"host": "radio.local"}))["success"] is True


@pytest.mark.asyncio
async def test_query_respects_endpoint_ownership(query):
    gate = parameters.sdr_hardware_lock(
        {"type": "soapysdrremote", "host": "radio.local", "port": 55132}
    )
    async with gate:
        reply = await request({"host": "radio.local", "port": 55132})
        assert reply["success"] is False
        assert "busy" in reply["error"]
        query.assert_not_awaited()
        assert (await request({"host": "radio.local", "port": 55133}))["success"] is True


@pytest.mark.asyncio
@pytest.mark.parametrize("status", ["active", "timeout", "unavailable", "error: native failure"])
async def test_server_query_preserves_native_result_status(monkeypatch, status):
    monkeypatch.setattr(
        soapysdrbrowser, "try_simple_socket_connection", AsyncMock(return_value=True)
    )
    monkeypatch.setattr(
        soapysdrbrowser, "query_sdrs_with_python_module", AsyncMock(return_value=([], status))
    )
    assert await soapysdrbrowser.query_server_for_sdrs("radio.local", 55132) == ([], status)
