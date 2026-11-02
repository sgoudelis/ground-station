"""Manual capability probes must share hardware ownership with viewers and workers."""

import asyncio
import logging
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from handlers.entities import hardware as handlers
from hardware import parameters
from pipeline.orchestration import processlifecycle

pytestmark = pytest.mark.unit
DEVICE = {
    "id": "radio",
    "type": "soapysdrremote",
    "host": "radio.local",
    "port": 55132,
    "driver": "sdrplay",
    "serial": "ABC",
    "name": "My receiver",
}
CAPABILITIES = {
    "sample_rate_values": [2000000],
    "gain_values": [0, 10],
    "antennas": {"rx": ["Antenna A", "Antenna B"], "tx": []},
}


class DbSession:
    async def __aenter__(self):
        return object()

    async def __aexit__(self, *_args):
        return False


@pytest.fixture(autouse=True)
def state(monkeypatch):
    monkeypatch.setattr(parameters, "_sdr_parameter_locks", {})
    monkeypatch.setattr(parameters, "sdr_parameters_cache", {})
    monkeypatch.setattr(handlers.runtimestate, "process_manager", None)
    monkeypatch.setattr(handlers, "AsyncSessionLocal", DbSession)
    monkeypatch.setattr(
        handlers.crud.hardware, "fetch_sdr", AsyncMock(return_value={"data": DEVICE})
    )
    monkeypatch.setattr(handlers, "probe_soapy_parameters", AsyncMock(return_value=CAPABILITIES))


async def probe(values):
    return await handlers.probe_sdr(None, values, logging.getLogger(__name__), "admin")


@pytest.mark.asyncio
async def test_draft_probe_uses_current_form_without_persisting_or_caching():
    draft = {
        **DEVICE,
        "id": None,
        "host": "new.local",
        "antenna_labels": {"rx": {"Antenna A": "Yagi"}},
    }
    response = await probe(draft)
    assert response == {"success": True, "data": CAPABILITIES, "cached": False}
    passed = handlers.probe_soapy_parameters.call_args.args[0]
    assert passed["host"] == "new.local"
    assert passed["serial"] == "ABC"
    assert "antenna_labels" not in passed
    assert draft["name"] == "My receiver"
    assert draft["antenna_labels"]["rx"]["Antenna A"] == "Yagi"
    handlers.crud.hardware.fetch_sdr.assert_not_awaited()
    assert parameters.sdr_parameters_cache == {}


@pytest.mark.asyncio
@pytest.mark.parametrize("changed", [False, True])
async def test_fresh_probe_only_updates_saved_cache_when_connection_matches(changed):
    old = {"gain_values": [1]}
    parameters.cache_sdr_parameters("radio", old)
    response = await probe({**DEVICE, **({"serial": "OTHER"} if changed else {})})
    assert response["success"] is True
    handlers.probe_soapy_parameters.assert_awaited_once()
    assert parameters.get_cached_sdr_parameters("radio") == (old if changed else CAPABILITIES)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "changed,capabilities", [(False, CAPABILITIES), (True, CAPABILITIES), (False, None)]
)
async def test_streaming_device_is_never_reopened(monkeypatch, changed, capabilities):
    monkeypatch.setattr(
        handlers.runtimestate,
        "process_manager",
        SimpleNamespace(
            processes={"radio": {"device": DEVICE, "parameters": capabilities}},
            is_sdr_process_running=lambda _id: True,
        ),
    )
    response = await probe({**DEVICE, "id": None, **({"serial": "OTHER"} if changed else {})})
    if not changed and capabilities is not None:
        assert response == {"success": True, "data": CAPABILITIES, "cached": True}
    else:
        assert response["success"] is False
        assert "Stop" in response["error"]
    handlers.probe_soapy_parameters.assert_not_awaited()


@pytest.mark.asyncio
async def test_manual_probe_serializes_waterfall_and_first_worker_start(monkeypatch):
    monkeypatch.setattr(processlifecycle, "AsyncSessionLocal", DbSession)
    manager = processlifecycle.ProcessLifecycleManager({}, None, None, None, None)
    monkeypatch.setattr(
        handlers.runtimestate,
        "process_manager",
        SimpleNamespace(
            processes=manager.processes,
            is_sdr_process_running=lambda _id: False,
        ),
    )
    entered, release = asyncio.Event(), asyncio.Event()
    events = []

    async def read_device(_device):
        events.append("probe started")
        entered.set()
        await release.wait()
        events.append("probe finished")
        return CAPABILITIES

    async def start(_device, _config, _client, capabilities):
        assert capabilities == CAPABILITIES
        events.append("worker started")
        return "radio"

    monkeypatch.setattr(handlers, "probe_soapy_parameters", AsyncMock(side_effect=read_device))
    monkeypatch.setattr(manager, "_start_sdr_process", start)
    manual = asyncio.create_task(probe(DEVICE))
    await asyncio.wait_for(entered.wait(), timeout=2)
    duplicate = await probe(DEVICE)
    assert duplicate["success"] is False
    assert "busy" in duplicate["error"]
    waterfall = asyncio.create_task(
        handlers.get_sdr_parameters(None, "radio", logging.getLogger(__name__), "viewer")
    )
    worker = asyncio.create_task(manager.start_sdr_process(DEVICE, {}, "viewer"))
    await asyncio.sleep(0)
    assert not waterfall.done()
    assert not worker.done()
    release.set()
    manual_result, waterfall_result, worker_result = await asyncio.wait_for(
        asyncio.gather(manual, waterfall, worker), timeout=2
    )
    assert manual_result["success"] and waterfall_result["success"]
    assert worker_result == "radio"
    handlers.probe_soapy_parameters.assert_awaited_once()
    assert events == ["probe started", "probe finished", "worker started"]


@pytest.mark.asyncio
async def test_probe_failure_preserves_last_good_cache_and_releases_gate():
    parameters.cache_sdr_parameters("radio", CAPABILITIES)
    handlers.probe_soapy_parameters.side_effect = RuntimeError("Device disconnected")
    response = await probe(DEVICE)
    assert response["success"] is False
    assert response["error"] == "Device disconnected"
    assert parameters.get_cached_sdr_parameters("radio") == CAPABILITIES
    assert not parameters.sdr_hardware_lock(DEVICE).locked()


@pytest.mark.asyncio
async def test_unsaved_probe_blocks_its_server_but_allows_unrelated_receivers(monkeypatch):
    monkeypatch.setattr(processlifecycle, "AsyncSessionLocal", DbSession)
    monkeypatch.setattr(
        processlifecycle,
        "probe_sdr_parameters",
        AsyncMock(return_value={"success": True, "data": CAPABILITIES}),
    )
    manager = processlifecycle.ProcessLifecycleManager({}, None, None, None, None)
    entered, release = asyncio.Event(), asyncio.Event()

    async def read_device(_device):
        entered.set()
        await release.wait()
        return CAPABILITIES

    async def start(device, _config, _client, capabilities):
        return device["id"]

    monkeypatch.setattr(handlers, "probe_soapy_parameters", AsyncMock(side_effect=read_device))
    monkeypatch.setattr(manager, "_start_sdr_process", start)
    manual = asyncio.create_task(probe({**DEVICE, "id": None}))
    await asyncio.wait_for(entered.wait(), timeout=2)
    same_server = asyncio.create_task(manager.start_sdr_process(DEVICE, {}, "observer"))
    other_server = asyncio.create_task(
        manager.start_sdr_process({**DEVICE, "id": "other", "host": "other.local"}, {}, "observer")
    )
    assert await asyncio.wait_for(other_server, timeout=2) == "other"
    assert not same_server.done()
    release.set()
    assert (await asyncio.wait_for(manual, timeout=2))["success"] is True
    assert await asyncio.wait_for(same_server, timeout=2) == "radio"
