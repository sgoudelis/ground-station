# Copyright (c) 2026 Efstratios Goudelis

import asyncio
import logging
import queue

import pytest

from common.events import EventBroker
from pipeline.orchestration import processlifecycle
from pipeline.orchestration.processlifecycle import ProcessLifecycleManager


class _SocketServer:
    def __init__(self):
        self.emitted = []

    async def emit(self, *_args, **_kwargs):
        self.emitted.append((_args, _kwargs))

    async def leave_room(self, *_args, **_kwargs):
        return None


class _Manager:
    def stop_demodulator(self, *_args, **_kwargs):
        return None

    def stop_recorder(self, *_args, **_kwargs):
        return None

    def stop_decoder(self, *_args, **_kwargs):
        return None


class _Broadcaster:
    def stop(self):
        return None

    def join(self, timeout=None):
        return timeout


class _StoppedProcess:
    pid = 42

    def is_alive(self):
        return False


@pytest.mark.asyncio
async def test_decoded_library_refresh_coalesces_bursts_and_keeps_final_packets(monkeypatch):
    manager = _new_manager()
    manager.decoded_library_refresh_seconds = 0
    started, release = asyncio.Event(), asyncio.Event()
    calls = []

    async def refresh(_sio):
        calls.append(len(calls) + 1)
        if len(calls) == 1:
            started.set()
            await release.wait()

    monkeypatch.setattr(processlifecycle, "refresh_file_browser_library", refresh)
    for _ in range(100):
        manager._schedule_decoded_library_refresh()
    task = manager._decoded_library_task
    try:
        await asyncio.wait_for(started.wait(), timeout=1)
        # A packet arriving during a scan must be included in a subsequent scan.
        for _ in range(100):
            manager._schedule_decoded_library_refresh()
        assert manager._decoded_library_task is task
        assert calls == [1]
    finally:
        release.set()
        await asyncio.wait_for(task, timeout=1)
    assert calls == [1, 2]
    assert manager._decoded_library_task is None

    # An idle worker can be restarted for a later decoding session.
    manager._schedule_decoded_library_refresh()
    await asyncio.wait_for(manager._decoded_library_task, timeout=1)
    assert calls == [1, 2, 3]


@pytest.mark.asyncio
async def test_fft_queue_does_not_wait_for_a_decoded_library_scan(monkeypatch):
    started, release = asyncio.Event(), asyncio.Event()

    async def refresh(_sio):
        started.set()
        await release.wait()

    monkeypatch.setattr(processlifecycle, "refresh_file_browser_library", refresh)
    messages = queue.Queue()
    messages.put(
        {
            "type": "decoder-output",
            "decoder_type": "radiosonde",
            "session_id": "viewer",
            "output": {"filepath": "sonde/packet.bin"},
        }
    )
    messages.put({"type": "fft_data", "data": b"fft"})
    messages.put({"type": "terminated"})
    process_info = {
        "process": _StoppedProcess(),
        "fft_process": None,
        "data_queue": messages,
        "stop_event": asyncio.Event(),
        "clients": {"viewer"},
        "iq_broadcaster": _Broadcaster(),
    }
    manager = _new_manager({"sdr-1": process_info})
    manager.decoded_library_refresh_seconds = 0
    emitted = []

    async def emit(event, payload, **_kwargs):
        emitted.append((event, payload))
        if event == "file_browser_state":
            # Let the scan begin and block before the queue reads its FFT frame.
            await asyncio.wait_for(started.wait(), timeout=1)

    manager.sio.emit = emit
    try:
        await asyncio.wait_for(manager._monitor_data_queue("sdr-1", 42), timeout=1)
        assert ("sdr-fft-data", {"data": b"fft"}) in emitted
        assert not release.is_set()
        assert any(event == "decoder-data" for event, _payload in emitted)
    finally:
        # Even a stopped SDR must finish publishing its last saved packet.
        release.set()
        if manager._decoded_library_task is not None:
            await asyncio.wait_for(manager._decoded_library_task, timeout=1)


def _new_manager(processes=None):
    basic_manager = _Manager()
    return ProcessLifecycleManager(
        processes if processes is not None else {},
        _SocketServer(),
        basic_manager,
        basic_manager,
        basic_manager,
    )


@pytest.mark.asyncio
async def test_bandwidth_readback_is_cached_and_broadcast_to_sdr_room():
    status = {"mode": "auto", "sample_rate": 4e6, "actual_hz": 5e6}
    messages = queue.Queue()
    messages.put({"type": "bandwidth", "sdr_id": "radio", "status": status})
    messages.put({"type": "terminated"})
    process_info = {
        "process": _StoppedProcess(),
        "fft_process": None,
        "data_queue": messages,
        "stop_event": asyncio.Event(),
        "clients": {"viewer"},
        "iq_broadcaster": _Broadcaster(),
    }
    manager = _new_manager({"radio": process_info})

    await asyncio.wait_for(manager._monitor_data_queue("radio", 42), timeout=1)

    assert process_info["bandwidth_status"] == status
    assert (
        ("sdr-status", {"sdr_id": "radio", "bandwidth_status": status}),
        {"room": "radio"},
    ) in manager.sio.emitted


@pytest.mark.asyncio
async def test_sdr_readiness_requires_stream_activation_and_samples(monkeypatch):
    broker = EventBroker()
    subscription = broker.subscribe("station-token", ["station:read"])
    monkeypatch.setattr(processlifecycle, "public_events", broker)
    manager = _new_manager()
    process_info = {
        "streaming_started": False,
        "worker_stats": {"samples_read": 0},
        "ready_waiters": [],
    }

    ready = manager._create_ready_waiter(process_info)
    process_info["streaming_started"] = True
    manager._resolve_ready_waiters("sdr-1", process_info)
    assert ready.done() is False
    assert subscription.queue.empty()

    process_info["worker_stats"] = {"samples_read": 1024}
    manager._resolve_ready_waiters("sdr-1", process_info)

    assert await ready == {"success": True}
    assert process_info["startup_ready"] is True
    assert subscription.queue.get_nowait() == ("sdr.streaming.started", {"sdr_id": "sdr-1"})
    manager._resolve_ready_waiters("sdr-1", process_info)
    assert subscription.queue.empty()


@pytest.mark.asyncio
async def test_sdr_stop_event_waits_for_last_client(monkeypatch):
    broker = EventBroker()
    subscription = broker.subscribe("station-token", ["station:read"])
    monkeypatch.setattr(processlifecycle, "public_events", broker)
    process_info = {
        "clients": {"first", "second"},
        "process": _StoppedProcess(),
        "stop_event": asyncio.Event(),
        "iq_broadcaster": _Broadcaster(),
        "event_streaming_started": True,
    }
    manager = _new_manager({"sdr-1": process_info})

    await manager.stop_sdr_process("sdr-1", "first")
    assert subscription.queue.empty()
    assert "sdr-1" in manager.processes

    await manager.stop_sdr_process("sdr-1", "second")
    assert subscription.queue.get_nowait() == ("sdr.streaming.stopped", {"sdr_id": "sdr-1"})
    assert "sdr-1" not in manager.processes


@pytest.mark.asyncio
async def test_sdr_readiness_propagates_worker_error():
    manager = _new_manager()
    process_info = {
        "streaming_started": True,
        "worker_stats": {"samples_read": 0},
        "ready_waiters": [],
    }
    ready = manager._create_ready_waiter(process_info)

    manager._fail_ready_waiters(process_info, "device open failed")

    with pytest.raises(RuntimeError, match="device open failed"):
        await manager._wait_until_sdr_ready("sdr-1", process_info, ready)


@pytest.mark.asyncio
async def test_sdr_readiness_timeout_reports_last_native_receiver_error():
    manager = _new_manager()
    manager.sdr_ready_timeout_seconds = 0.001
    process_info = {
        "worker_stats": {
            "samples_read": 0,
            "last_read_error": "SoapySDR readStream: STREAM_ERROR (code -2)",
        },
        "ready_waiters": [],
    }
    ready = manager._create_ready_waiter(process_info)

    with pytest.raises(
        RuntimeError, match=r"last receiver error: SoapySDR readStream: STREAM_ERROR \(code -2\)"
    ):
        await manager._wait_until_sdr_ready("sdr-1", process_info, ready)


@pytest.mark.asyncio
async def test_worker_error_uses_pending_start_reply_and_notifies_other_viewers():
    messages = queue.Queue()
    messages.put({"type": "error", "message": "AIRSPY_ERROR_NOT_FOUND (code -5)"})
    messages.put({"type": "terminated"})
    process_info = {
        "process": _StoppedProcess(),
        "fft_process": None,
        "data_queue": messages,
        "stop_event": asyncio.Event(),
        "clients": {"starter", "viewer"},
        "iq_broadcaster": _Broadcaster(),
        "streaming_started": False,
        "startup_ready": False,
        "ready_waiters": [],
        "worker_stats": {"samples_read": 0},
        "failure_reported": False,
    }
    socket = _SocketServer()
    manager = _new_manager({"sdr-1": process_info})
    manager.sio = socket
    ready = manager._create_ready_waiter(process_info, "starter")

    await manager._monitor_data_queue("sdr-1", expected_process_pid=42)

    with pytest.raises(RuntimeError, match="AIRSPY_ERROR_NOT_FOUND"):
        await manager._wait_until_sdr_ready("sdr-1", process_info, ready)
    errors = [(args, kwargs) for args, kwargs in socket.emitted if args[0] == "sdr-error"]
    assert errors == [
        (
            ("sdr-error", {"message": "SDR error: AIRSPY_ERROR_NOT_FOUND (code -5)"}),
            {"room": "viewer"},
        )
    ]


def test_decoder_error_status_is_logged(caplog):
    manager = _new_manager()

    with caplog.at_level(logging.ERROR, logger="process-lifecycle"):
        manager._log_decoder_error_status(
            {
                "status": "error",
                "decoder_type": "aprs",
                "session_id": "session-1",
                "vfo": 2,
                "info": {"error": "GNU Radio filter binding failed"},
            }
        )

    assert "Decoder aprs failed for session session-1 VFO 2" in caplog.text
    assert "GNU Radio filter binding failed" in caplog.text


def test_exited_decoder_process_is_logged_once(caplog):
    class _FailedDecoder:
        exitcode = 1

        @staticmethod
        def is_alive():
            return False

    process_info = {
        "decoders": {
            "session-1": {
                2: {
                    "instance": _FailedDecoder(),
                    "decoder_type": "APRSDecoder",
                }
            }
        }
    }
    manager = _new_manager()

    with caplog.at_level(logging.ERROR, logger="process-lifecycle"):
        manager._log_exited_decoder_processes("sdr-1", process_info)
        manager._log_exited_decoder_processes("sdr-1", process_info)

    assert caplog.text.count("Decoder APRSDecoder failed") == 1
    assert "exit code 1" in caplog.text


@pytest.mark.asyncio
async def test_active_internal_session_receives_worker_failure(monkeypatch):
    broker = EventBroker()
    subscription = broker.subscribe("station-token", ["station:read"])
    monkeypatch.setattr(processlifecycle, "public_events", broker)
    messages = queue.Queue()
    messages.put({"type": "error", "message": "USB transfer failed"})
    messages.put({"type": "terminated"})
    stop_event = asyncio.Event()
    process_info = {
        "process": _StoppedProcess(),
        "fft_process": None,
        "data_queue": messages,
        "stop_event": stop_event,
        "clients": {"internal:obs-1:sdr-1"},
        "iq_broadcaster": _Broadcaster(),
        "streaming_started": True,
        "startup_ready": True,
        "event_streaming_started": True,
        "ready_waiters": [],
        "worker_stats": {"samples_read": 1024},
        "failure_reported": False,
    }
    processes = {"sdr-1": process_info}
    manager = _new_manager(processes)
    failures = []

    async def _record_failure(sdr_id, clients, message):
        failures.append((sdr_id, clients, message))

    manager.set_sdr_failure_handler(_record_failure)
    await manager._monitor_data_queue("sdr-1", expected_process_pid=42)
    await asyncio.sleep(0)

    assert failures == [("sdr-1", {"internal:obs-1:sdr-1"}, "USB transfer failed")]
    assert "sdr-1" not in processes
    assert subscription.queue.get_nowait() == ("sdr.streaming.stopped", {"sdr_id": "sdr-1"})
