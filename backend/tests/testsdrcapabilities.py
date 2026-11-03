import asyncio
import logging
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from handlers.entities import hardware as hardwarehandlers
from hardware import parameters
from pipeline.orchestration import processlifecycle
from session.background import background_sessions


class _DbSession:
    async def __aenter__(self):
        return object()

    async def __aexit__(self, *_args):
        return False


class _RunningProcess:
    def is_alive(self):
        return True


@pytest.mark.asyncio
async def test_playback_capabilities_use_receiving_session_configuration(monkeypatch):
    recording_path = "/recordings/example.sigmf-meta"
    capabilities = {"sample_rate_values": [2_048_000]}
    monkeypatch.setattr(background_sessions, "controllers", {"browser": "receiving:playback"})
    monkeypatch.setattr(
        hardwarehandlers,
        "active_sdr_clients",
        {"receiving:playback": {"recording_path": recording_path}},
    )
    monkeypatch.setitem(
        parameters.sdr_parameters_cache, ("sigmf-playback", recording_path), capabilities
    )

    response = await hardwarehandlers.get_sdr_parameters(
        None, "sigmf-playback", logging.getLogger(__name__), "browser"
    )

    assert response["success"]
    assert response["data"] == capabilities


@pytest.mark.asyncio
@pytest.mark.parametrize("first_request", ["stream", "ui"])
async def test_first_stream_and_ui_probe_share_one_gate(monkeypatch, first_request):
    monkeypatch.setattr(parameters, "sdr_parameters_cache", {})
    monkeypatch.setattr(parameters, "_sdr_parameter_locks", {})
    monkeypatch.setattr(hardwarehandlers, "AsyncSessionLocal", _DbSession)
    monkeypatch.setattr(
        hardwarehandlers.crud.hardware,
        "fetch_sdr",
        AsyncMock(return_value={"data": {"id": "sdr-a"}}),
    )
    monkeypatch.setattr(processlifecycle, "AsyncSessionLocal", _DbSession)

    manager = processlifecycle.ProcessLifecycleManager({}, None, None, None, None)
    monkeypatch.setattr(
        hardwarehandlers.runtimestate,
        "process_manager",
        SimpleNamespace(is_sdr_process_running=lambda sdr_id: sdr_id in manager.processes),
    )
    entered = asyncio.Event()
    release = asyncio.Event()
    probes = []
    events = []
    capabilities = {"gain_values": [0, 10, 20], "antennas": {"rx": ["RX"], "tx": []}}

    async def probe(_dbsession, sdr_id, **_kwargs):
        cached = parameters.get_cached_sdr_parameters(sdr_id)
        if cached:
            return {"success": True, "data": cached}
        probes.append(sdr_id)
        events.append("probe started")
        entered.set()
        await release.wait()
        parameters.sdr_parameters_cache[(sdr_id, "")] = capabilities
        events.append("probe finished")
        return {"success": True, "data": capabilities}

    async def start(_device, _config, client_id, capabilities=None):
        assert parameters.get_cached_sdr_parameters("sdr-a") == capabilities
        events.append("worker started")
        manager.processes["sdr-a"] = {
            "process": _RunningProcess(),
            "clients": {client_id},
        }
        return "sdr-a"

    monkeypatch.setattr(hardwarehandlers, "probe_sdr_parameters", probe)
    monkeypatch.setattr(processlifecycle, "probe_sdr_parameters", probe)
    monkeypatch.setattr(manager, "_start_sdr_process", start)

    async def ui_request():
        return await hardwarehandlers.get_sdr_parameters(
            None, "sdr-a", logging.getLogger(__name__), "viewer"
        )

    async def stream_request():
        return await manager.start_sdr_process({"id": "sdr-a"}, {}, "observation")

    first = asyncio.create_task(stream_request() if first_request == "stream" else ui_request())
    await asyncio.wait_for(entered.wait(), timeout=2)
    second = asyncio.create_task(ui_request() if first_request == "stream" else stream_request())
    await asyncio.sleep(0)
    assert not second.done()
    release.set()

    first_result, second_result = await asyncio.wait_for(asyncio.gather(first, second), timeout=2)
    ui_result = second_result if first_request == "stream" else first_result
    assert ui_result["success"] is True
    assert ui_result["data"] == capabilities
    assert probes == ["sdr-a"]
    assert events == ["probe started", "probe finished", "worker started"]


@pytest.mark.asyncio
async def test_late_worker_claim_requires_takeover_after_waiting_for_probe_gate(monkeypatch):
    monkeypatch.setattr(parameters, "_sdr_parameter_locks", {})
    manager = processlifecycle.ProcessLifecycleManager({}, None, None, None, None)

    async def unexpected_start(*_args):
        pytest.fail("Unapproved caller joined the active worker")

    monkeypatch.setattr(manager, "_start_sdr_process", unexpected_start)
    async with parameters.sdr_parameter_lock("sdr-b"):
        waiting = asyncio.create_task(manager.start_sdr_process({"id": "sdr-b"}, {}, "viewer"))
        await asyncio.sleep(0)
        manager.processes["sdr-b"] = {
            "process": _RunningProcess(),
            "clients": {"internal:observation"},
        }

    with pytest.raises(processlifecycle.SdrStartConflict):
        await waiting


@pytest.mark.asyncio
async def test_ui_cache_miss_does_not_probe_a_streaming_device(monkeypatch):
    monkeypatch.setattr(parameters, "sdr_parameters_cache", {})
    monkeypatch.setattr(parameters, "_sdr_parameter_locks", {})
    monkeypatch.setattr(
        hardwarehandlers.runtimestate,
        "process_manager",
        SimpleNamespace(is_sdr_process_running=lambda _sdr_id: True),
    )

    async def unexpected_probe(*_args, **_kwargs):
        pytest.fail("A second device handle was opened while streaming")

    monkeypatch.setattr(hardwarehandlers, "probe_sdr_parameters", unexpected_probe)
    response = await hardwarehandlers.get_sdr_parameters(
        None, "sdr-a", logging.getLogger(__name__), "viewer"
    )

    assert response["success"] is False
    assert "streaming" in response["error"]


@pytest.mark.asyncio
async def test_ui_uses_running_worker_snapshot_after_sdr_edit(monkeypatch):
    monkeypatch.setattr(parameters, "sdr_parameters_cache", {})
    monkeypatch.setattr(parameters, "_sdr_parameter_locks", {})
    capabilities = {"gain_values": [0, 10, 20]}
    monkeypatch.setattr(
        hardwarehandlers.runtimestate,
        "process_manager",
        SimpleNamespace(
            is_sdr_process_running=lambda _sdr_id: True,
            processes={"sdr-a": {"parameters": capabilities}},
        ),
    )

    response = await hardwarehandlers.get_sdr_parameters(
        None, "sdr-a", logging.getLogger(__name__), "viewer"
    )

    assert response["success"] is True
    assert response["data"] == capabilities


@pytest.mark.asyncio
@pytest.mark.parametrize("operation", ["edit", "delete"])
async def test_sdr_change_waits_for_probe_then_invalidates_its_result(monkeypatch, operation):
    monkeypatch.setattr(parameters, "sdr_parameters_cache", {})
    monkeypatch.setattr(parameters, "_sdr_parameter_locks", {})
    monkeypatch.setattr(hardwarehandlers, "AsyncSessionLocal", _DbSession)
    monkeypatch.setattr(
        hardwarehandlers.crud.hardware,
        "fetch_sdr",
        AsyncMock(return_value={"data": {"id": "sdr-a"}}),
    )
    monkeypatch.setattr(hardwarehandlers, "get_all_tracker_managers", lambda: {})
    monkeypatch.setattr(
        hardwarehandlers.runtimestate,
        "process_manager",
        SimpleNamespace(is_sdr_process_running=lambda _sdr_id: False),
    )

    entered = asyncio.Event()
    release = asyncio.Event()
    changed = []
    capabilities = {"gain_values": [0, 10, 20]}

    async def probe(_dbsession, sdr_id, **_kwargs):
        entered.set()
        await release.wait()
        parameters.sdr_parameters_cache[(sdr_id, "")] = capabilities
        return {"success": True, "data": capabilities}

    async def change(_dbsession, _data):
        changed.append(operation)
        return {"success": True}

    async def fetch_sdrs(_dbsession):
        return {"success": True, "data": []}

    monkeypatch.setattr(hardwarehandlers, "probe_sdr_parameters", probe)
    monkeypatch.setattr(hardwarehandlers.crud.hardware, "fetch_sdrs", fetch_sdrs)
    monkeypatch.setattr(
        hardwarehandlers.crud.hardware,
        "edit_sdr" if operation == "edit" else "delete_sdrs",
        change,
    )

    ui_request = asyncio.create_task(
        hardwarehandlers.get_sdr_parameters(None, "sdr-a", logging.getLogger(__name__), "viewer")
    )
    await asyncio.wait_for(entered.wait(), timeout=2)
    change_request = asyncio.create_task(
        hardwarehandlers.edit_sdr(None, {"id": "sdr-a"}, logging.getLogger(__name__), "viewer")
        if operation == "edit"
        else hardwarehandlers.delete_sdr(None, ["sdr-a"], logging.getLogger(__name__), "viewer")
    )
    await asyncio.sleep(0)
    assert not change_request.done()
    assert changed == []

    release.set()
    ui_result, change_result = await asyncio.wait_for(
        asyncio.gather(ui_request, change_request), timeout=2
    )
    assert ui_result["data"] == capabilities
    assert change_result["success"] is True
    assert changed == [operation]
    assert parameters.get_cached_sdr_parameters("sdr-a") is None
