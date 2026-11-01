"""Background worker results must not outlive ownership of their processes."""

import asyncio
import multiprocessing
import os
import signal
import subprocess
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from types import SimpleNamespace

import pytest

from tasks import manager as taskmodule
from tasks.manager import BackgroundTaskManager, TaskInfo, TaskMessage, TaskStatus

pytestmark = pytest.mark.unit


class Socket:
    def __init__(self):
        self.events = []

    async def emit(self, event, data):
        self.events.append((event, data))


def _worker_with_blocked_thread(fail=False, _progress_queue=None):
    del _progress_queue
    signal.signal(signal.SIGTERM, signal.SIG_IGN)
    # Match discovery: returning from the function leaves Python joining an
    # executor thread, and SIGTERM cannot release the blocked native operation.
    executor = ThreadPoolExecutor(max_workers=1)
    started = threading.Event()

    def blocked_probe():
        started.set()
        threading.Event().wait(60)

    executor.submit(blocked_probe)
    assert started.wait(2)
    if fail:
        raise RuntimeError("probe failed")
    return {"discovered": True}


def _successful_worker(_progress_queue=None):
    del _progress_queue
    return {"discovered": True}


async def _run_scenario(scenario):
    taskmodule.WORKER_EXIT_TIMEOUT_SECONDS = (
        0.2 if scenario.startswith("watchdog") or scenario == "overlap" else 10
    )
    taskmodule.WORKER_TERMINATE_TIMEOUT_SECONDS = 0.1
    taskmodule.WORKER_KILL_TIMEOUT_SECONDS = 0.5
    started = asyncio.Event()
    release = asyncio.Event()

    class BlockingSocket(Socket):
        async def emit(self, event, data):
            await super().emit(event, data)
            if event == "background_task:started":
                started.set()
                await release.wait()

    socket = BlockingSocket() if scenario == "start-shutdown" else Socket()
    manager = BackgroundTaskManager(socket)
    process = None
    try:
        if scenario == "start-shutdown":
            starting = asyncio.create_task(manager.start_task(_successful_worker))
            try:
                await asyncio.wait_for(started.wait(), timeout=3)
                process = next(iter(manager.tasks.values())).process
                await asyncio.wait_for(manager.shutdown(), timeout=3)
                release.set()
                await asyncio.wait_for(starting, timeout=3)
                assert not process.is_alive()
                assert not manager._monitor_tasks
            finally:
                release.set()
                if not starting.done():
                    starting.cancel()
                await asyncio.gather(starting, return_exceptions=True)
            return

        task_id = await manager.start_task(
            _successful_worker if scenario == "success" else _worker_with_blocked_thread,
            kwargs={"fail": True} if scenario == "watchdog-failure" else {},
            name="SoapySDR Discovery (test)",
        )
        info = manager.tasks[task_id]
        process = info.process
        monitor = manager._monitor_tasks[task_id]

        if scenario.startswith("watchdog") or scenario == "success":
            await asyncio.wait_for(asyncio.shield(monitor), timeout=4)
            assert not process.is_alive()
            expected = TaskStatus.COMPLETED if scenario == "success" else TaskStatus.FAILED
            assert info.status == expected
            completed = [
                data for event, data in socket.events if event == "background_task:completed"
            ]
            assert len(completed) == 1
            assert completed[0]["status"] == expected.value
            if scenario.startswith("watchdog"):
                assert process.exitcode == -signal.SIGKILL
                assert any("worker failed to exit" in line for line in info.error_lines)
                assert any(event == "soapysdr:discovery_error" for event, _ in socket.events)
        else:

            async def wait_for_result():
                while info.result_received_at is None:
                    await asyncio.sleep(0.01)

            await asyncio.wait_for(wait_for_result(), timeout=3)
            assert info.status == TaskStatus.RUNNING
            assert process.is_alive()

            if scenario == "stop":
                assert await asyncio.wait_for(manager.stop_task(task_id, timeout=0.1), timeout=3)
            else:
                if scenario == "overlap":

                    async def wait_for_watchdog():
                        while not info.termination_lock.locked():
                            await asyncio.sleep(0.01)

                    await asyncio.wait_for(wait_for_watchdog(), timeout=3)
                else:
                    # Also cover terminal metadata left by an earlier error path.
                    info.status = TaskStatus(scenario.removeprefix("shutdown-"))
                await asyncio.wait_for(manager.shutdown(), timeout=3)
                with pytest.raises(RuntimeError, match="shutting down"):
                    await manager.start_task(_successful_worker)

            assert info.status == TaskStatus.STOPPED
            assert not process.is_alive()
            assert process.exitcode == -signal.SIGKILL
            assert monitor.done()
            assert not manager._monitor_tasks
            assert not any(event == "background_task:completed" for event, _ in socket.events)
    finally:
        # Keep regressions from hanging pytest in multiprocessing's exit hook.
        if process is not None:
            if process.is_alive():
                process.kill()
            process.join(timeout=1)
        monitors = list(manager._monitor_tasks.values())
        for monitor in monitors:
            monitor.cancel()
        await asyncio.gather(*monitors, return_exceptions=True)


@pytest.mark.parametrize(
    "scenario",
    [
        "success",
        "watchdog-success",
        "watchdog-failure",
        "stop",
        "shutdown-completed",
        "shutdown-failed",
        "overlap",
        "start-shutdown",
    ],
)
def test_worker_lifecycle_exits_without_live_children(scenario):
    # An outer interpreter also verifies normal Python exit, which is where
    # production hung after Uvicorn had already finished its shutdown.
    backend = Path(__file__).resolve().parents[1]
    result = subprocess.run(
        [sys.executable, str(Path(__file__).resolve()), scenario],
        cwd=backend,
        env={**os.environ, "ALEMBIC_CONTEXT": "1", "PYTHONPATH": str(backend)},
        capture_output=True,
        text=True,
        timeout=15,
    )
    assert result.returncode == 0, result.stdout + result.stderr


@pytest.mark.asyncio
@pytest.mark.parametrize("message_type", [TaskMessage.COMPLETE, TaskMessage.FAILED])
async def test_result_does_not_mark_a_live_worker_finished(message_type):
    manager = BackgroundTaskManager(Socket())
    info = TaskInfo("task", "test", "test", (), {}, TaskStatus.RUNNING)
    manager.tasks[info.task_id] = info

    await manager._handle_message(info.task_id, {"type": message_type, "error": "failed"})

    assert info.status == TaskStatus.RUNNING
    assert info.result_received_at is not None
    assert info.reported_status == (
        TaskStatus.COMPLETED if message_type == TaskMessage.COMPLETE else TaskStatus.FAILED
    )


def test_finished_task_cleanup_retains_a_live_worker():
    manager = BackgroundTaskManager(Socket())
    info = TaskInfo(
        "task",
        "test",
        "test",
        (),
        {},
        TaskStatus.FAILED,
        process=SimpleNamespace(is_alive=lambda: True),
        end_time=time.time() - 100,
    )
    manager.tasks[info.task_id] = info

    manager.cleanup_finished_tasks(max_age_seconds=1)

    assert manager.tasks[info.task_id] is info


@pytest.mark.asyncio
@pytest.mark.parametrize("operation", ["stop", "shutdown"])
async def test_termination_failure_does_not_report_success(monkeypatch, operation):
    class UnkillableProcess:
        pid = 123

        def is_alive(self):
            return True

        def terminate(self):
            pass

        def kill(self):
            pass

        def join(self, **_kwargs):
            raise AssertionError("A live worker must not be joined")

    monkeypatch.setattr(taskmodule, "WORKER_TERMINATE_TIMEOUT_SECONDS", 0.01)
    monkeypatch.setattr(taskmodule, "WORKER_KILL_TIMEOUT_SECONDS", 0.01)
    socket = Socket()
    manager = BackgroundTaskManager(socket)
    info = TaskInfo("task", "test", "test", (), {}, TaskStatus.RUNNING, process=UnkillableProcess())
    manager.tasks[info.task_id] = info

    if operation == "stop":
        assert await manager.stop_task(info.task_id, timeout=0.01) is False
    else:
        with pytest.raises(RuntimeError, match="did not exit during shutdown"):
            await manager.shutdown()

    assert info.status == TaskStatus.RUNNING
    assert info.end_time is None
    assert info.return_code is None
    assert not socket.events


if __name__ == "__main__":
    asyncio.run(_run_scenario(sys.argv[1]))
    assert not multiprocessing.active_children()
