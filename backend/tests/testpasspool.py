"""Regression coverage for pass-worker sockets, interrupts, and interpreter exit."""

import asyncio
import contextlib
import os
import signal
import socket
import subprocess
import sys
import time
from pathlib import Path

import pytest

from tracking import passpool


@pytest.fixture
def pool_lifecycle():
    passpool.start_worker_pool()
    try:
        yield
    finally:
        passpool.shutdown_worker_pool()
        passpool.start_worker_pool()


@pytest.mark.integration
def test_pass_worker_does_not_inherit_http_connections(pool_lifecycle):
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        listener.listen(1)
        with socket.create_connection(listener.getsockname(), timeout=2) as client:
            connection, _ = listener.accept()
            pool = None
            try:
                # Create the pool while an HTTP-like connection is open, as happens
                # when the UI requests its first pass forecast after a deployment.
                pool = passpool.get_worker_pool()
                worker_pid = pool.apply_async(os.getpid).get(timeout=20)
                assert worker_pid != os.getpid()
                assert passpool.get_worker_pool() is pool

                connection.close()
                # An inherited worker descriptor prevents EOF and leaves nginx
                # reusing a connection that no web-server process can read.
                assert client.recv(1) == b""
                assert pool.apply_async(os.getpid).get(timeout=5) == worker_pid
            finally:
                connection.close()
                passpool.shutdown_worker_pool()


@pytest.mark.integration
@pytest.mark.skipif(not hasattr(signal, "pthread_sigmask"), reason="POSIX terminal signals")
@pytest.mark.parametrize("phase", ["startup", "replacement", "idle", "busy", "cancel"])
def test_ctrl_c_and_cancellation_allow_interpreter_exit(phase, tmp_path):
    marker = tmp_path / "worker-started"
    process = subprocess.Popen(
        [sys.executable, __file__, phase, str(marker)],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        start_new_session=True,
        env={**os.environ, "ALEMBIC_CONTEXT": "1"},
    )
    try:
        stdout, stderr = process.communicate(timeout=20)
    except subprocess.TimeoutExpired:
        os.killpg(process.pid, signal.SIGKILL)
        stdout, stderr = process.communicate(timeout=5)
        pytest.fail(f"Pass worker kept the interpreter alive:\n{stdout}\n{stderr}")
    finally:
        # Also reap any worker left behind if the scenario itself failed.
        with contextlib.suppress(ProcessLookupError):
            os.killpg(process.pid, signal.SIGKILL)
    assert process.returncode == 0, stdout + stderr
    assert "pass worker shutdown complete" in stdout
    assert "KeyboardInterrupt" not in stderr
    assert "Fatal Python error" not in stderr


@pytest.mark.integration
@pytest.mark.asyncio
async def test_lost_worker_result_times_out_and_next_request_recovers(pool_lifecycle):
    pool = passpool.get_worker_pool()
    pool.apply_async(os.getpid).get(timeout=10)
    # Pool replaces a crashed worker but never completes that worker's result.
    lost_result = pool.apply_async(os._exit, (3,))
    with pytest.raises(TimeoutError, match="calculation timed out"):
        await passpool.wait_for_result(pool, lost_result, timeout=0.3)

    replacement_pool = passpool.get_worker_pool()
    assert replacement_pool is not pool
    assert (
        await passpool.wait_for_result(
            replacement_pool, replacement_pool.apply_async(os.getpid), timeout=10
        )
        != os.getpid()
    )


@pytest.mark.unit
def test_shutdown_is_idempotent_and_rejects_late_requests(pool_lifecycle):
    passpool.shutdown_worker_pool()
    passpool.shutdown_worker_pool()
    with pytest.raises(RuntimeError, match="stopping"):
        passpool.get_worker_pool()


def _wait_for_marker(marker):
    deadline = time.monotonic() + 10
    while not marker.exists():
        assert time.monotonic() < deadline, "Worker did not reach expected state"
        time.sleep(0.01)


def _long_calculation(marker):
    Path(marker).touch()
    time.sleep(60)


async def _pending_result_scenario(pool, marker, phase):
    result = pool.apply_async(_long_calculation, (str(marker),))
    waiter = asyncio.create_task(passpool.wait_for_result(pool, result))
    # Poll asynchronously so the result waiter actually starts before shutdown.
    async with asyncio.timeout(10):
        while not marker.exists():
            await asyncio.sleep(0.01)
    worker = pool._pool[0]
    if phase == "cancel":
        waiter.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await waiter
    else:
        os.killpg(os.getpgrp(), signal.SIGINT)
        await asyncio.sleep(0.1)
        assert worker.is_alive()

    passpool.shutdown_worker_pool()
    if phase != "cancel":
        with pytest.raises(RuntimeError, match="stopped"):
            await waiter
    assert not worker.is_alive()


def _interrupt_scenario(phase, marker):
    received = []
    signal.signal(signal.SIGINT, lambda signum, frame: received.append(signum))
    original_mask = signal.pthread_sigmask(signal.SIG_BLOCK, set())
    passpool.start_worker_pool()
    pool = passpool.get_worker_pool()
    try:
        if phase == "replacement":
            # Exercise the pool's maintenance thread, where signal.signal()
            # cannot be used to protect a new interpreter during spawn.
            pool.apply_async(os.getpid).get(timeout=10)
            marker.unlink()
            # Exit while executing a job, after releasing the input queue's
            # read lock. Killing an idle Pool worker can strand that lock.
            pool.apply_async(os._exit, (3,))
        if phase in ("startup", "replacement"):
            _wait_for_marker(marker)
            worker_pid = int(marker.read_text())
            os.killpg(os.getpgrp(), signal.SIGINT)
            os.killpg(os.getpgrp(), signal.SIGINT)
            assert pool.apply_async(os.getpid).get(timeout=10) == worker_pid
        elif phase == "idle":
            worker_pid = pool.apply_async(os.getpid).get(timeout=10)
            os.killpg(os.getpgrp(), signal.SIGINT)
            assert pool.apply_async(os.getpid).get(timeout=10) == worker_pid
        else:
            asyncio.run(_pending_result_scenario(pool, marker, phase))

        assert signal.pthread_sigmask(signal.SIG_BLOCK, set()) == original_mask
        assert received or phase == "cancel"
    finally:
        passpool.shutdown_worker_pool()
    assert not passpool.multiprocessing.active_children()
    print("pass worker shutdown complete", flush=True)


if __name__ == "__mp_main__" and sys.argv[1] in ("startup", "replacement"):
    # The child has started Python but has not reached the pool initializer.
    # Hold it here so the parent's group interrupt hits that exact window.
    assert signal.SIGINT in signal.pthread_sigmask(signal.SIG_BLOCK, set())
    Path(sys.argv[2]).write_text(str(os.getpid()))
    time.sleep(0.5)


if __name__ == "__main__":
    _interrupt_scenario(sys.argv[1], Path(sys.argv[2]))
