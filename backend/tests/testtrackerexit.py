"""Exercise Ctrl+C through ASGI shutdown and interpreter exit with tracker backlogs."""

import asyncio
import contextlib
import faulthandler
import multiprocessing
import os
import signal
import subprocess
import sys
import time
from contextlib import asynccontextmanager
from pathlib import Path

import pytest
import uvicorn
from fastapi import FastAPI

from hardware.service import hardware
from server import shutdown
from tracker import messages, runner


@pytest.mark.integration
@pytest.mark.skipif(not hasattr(os, "fork"), reason="POSIX terminal process groups")
@pytest.mark.parametrize("unresponsive", [False, True])
def test_single_ctrl_c_exits_with_four_tracker_output_backlogs(unresponsive):
    process = subprocess.Popen(
        [sys.executable, __file__, str(int(unresponsive))],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        start_new_session=True,
        env={
            **os.environ,
            "ALEMBIC_CONTEXT": "1",
            "PYTHONPATH": os.pathsep.join(
                filter(None, (str(Path(__file__).resolve().parents[1]), os.getenv("PYTHONPATH")))
            ),
        },
    )
    try:
        stdout, stderr = process.communicate(timeout=25)
    except subprocess.TimeoutExpired:
        os.killpg(process.pid, signal.SIGKILL)
        stdout, stderr = process.communicate(timeout=5)
        pytest.fail(f"Backend did not exit after one Ctrl+C:\n{stdout}\n{stderr}")
    finally:
        with contextlib.suppress(ProcessLookupError):
            os.killpg(process.pid, signal.SIGKILL)
    assert process.returncode == 0, stdout + stderr
    assert "ASGI shutdown returned; all tracker processes reaped" in stdout
    if not unresponsive:
        assert "requesting forced stop" not in stdout + stderr


def _tracker_producer(output, ready, stopped, unresponsive):
    signal.signal(signal.SIGINT, signal.SIG_IGN)
    signal.signal(signal.SIGTERM, signal.SIG_DFL)
    # Real tracker context messages can exceed the pipe capacity. Returning
    # from the task still leaves multiprocessing waiting for its feeder thread.
    output.put({"type": "shutdown-probe", "data": {"context": bytes(2 * 1024 * 1024)}})
    ready.set()
    stopped.wait()
    if unresponsive:
        time.sleep(60)


def _run_backend(unresponsive):
    supervisor = runner.TrackerSupervisor()
    runner._tracker_supervisor = supervisor
    messages.queue_from_tracker = supervisor.output_queue
    processes = []

    @asynccontextmanager
    async def lifespan(app):
        for index in range(4):
            tracker_id = f"target-{index + 1}"
            stopped, ready = multiprocessing.Event(), multiprocessing.Event()
            commands = multiprocessing.Queue()
            process = multiprocessing.Process(
                target=_tracker_producer,
                args=(supervisor.output_queue, ready, stopped, unresponsive and index == 0),
            )
            process.start()
            assert ready.wait(3)
            processes.append(process)
            supervisor.runtimes[tracker_id] = runner.TrackerRuntime(
                tracker_id, process, commands, stopped
            )

        start_draining = asyncio.Event()

        async def consume_output():
            # Hold the backlog until shutdown to reproduce the case where the
            # old synchronous joins starved the reader for the entire grace period.
            await start_draining.wait()
            await messages.handle_tracker_messages(None)

        consumer = asyncio.create_task(consume_output())
        command_updates = asyncio.create_task(messages.handle_command_updates(None))
        for process in processes:
            original_terminate = process.terminate

            def terminate_after_readers_stop(original=original_terminate):
                assert consumer.done(), "Forced termination raced the output reader"
                assert command_updates.done(), "Command producer is still running"
                original()

            process.terminate = terminate_after_readers_stop

        hardware.start()
        # A real foreground process-group interrupt reaches Uvicorn and all
        # four workers. No second interrupt or explicit process exit is used.
        asyncio.get_running_loop().call_later(0.1, os.killpg, os.getpgrp(), signal.SIGINT)
        try:
            yield
        finally:
            start_draining.set()
            started = time.monotonic()
            await shutdown.cleanup_trackers((consumer, command_updates))
            shutdown.cleanup_everything()
            await hardware.shutdown()
            assert time.monotonic() - started < 6
            assert not supervisor.runtimes
            assert not multiprocessing.active_children()
            expected_graceful = processes[1:] if unresponsive else processes
            assert all(process.exitcode == 0 for process in expected_graceful)
            if unresponsive:
                assert processes[0].exitcode == -signal.SIGTERM
            print("ASGI shutdown returned; all tracker processes reaped", flush=True)

    app = FastAPI(lifespan=lifespan)
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=0, log_config=None))
    with contextlib.suppress(KeyboardInterrupt):
        server.run()
    assert server.should_exit


if __name__ == "__main__":
    # Capture Python stacks if the lifecycle or an exit-time finalizer hangs.
    faulthandler.dump_traceback_later(15, exit=True)
    _run_backend(bool(int(sys.argv[1])))
