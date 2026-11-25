"""Shutdown cleanup for workers left after client sessions are gone."""

import multiprocessing
import os

import pytest

from server import shutdown
from tracking import passpool


@pytest.mark.integration
def test_fallback_cleanup_reaps_pass_worker():
    passpool.start_worker_pool()
    try:
        pool = passpool.get_worker_pool()
        worker_pid = pool.apply_async(os.getpid).get(timeout=10)
        shutdown.cleanup_everything()
        assert all(child.pid != worker_pid for child in multiprocessing.active_children())
        with pytest.raises(RuntimeError, match="stopping"):
            passpool.get_worker_pool()
    finally:
        passpool.shutdown_worker_pool()
        passpool.start_worker_pool()


@pytest.mark.asyncio
async def test_shutdown_stops_sdr_worker_retained_by_joiner(monkeypatch):
    class ProcessManager:
        def __init__(self):
            self.processes = {"sdr-1": {"clients": {"joiner"}}}
            self.stopped = []

        async def stop_sdr_process(self, sdr_id):
            self.stopped.append(sdr_id)
            self.processes.pop(sdr_id)

    process_manager = ProcessManager()
    monkeypatch.setattr(shutdown.runtimestate, "process_manager", process_manager)
    monkeypatch.setattr(shutdown, "active_sdr_clients", {})

    await shutdown.cleanup_sessions()
    await shutdown.cleanup_sdr_processes()

    assert process_manager.stopped == ["sdr-1"]
    assert process_manager.processes == {}
