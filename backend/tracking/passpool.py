"""Own the satellite-pass worker and its shutdown independently of the web app."""

import asyncio
import logging
import multiprocessing
import signal
from multiprocessing.context import SpawnContext, SpawnProcess
from multiprocessing.pool import AsyncResult, Pool
from typing import Any

import setproctitle

logger = logging.getLogger("passes-worker")
RESULT_TIMEOUT_SECONDS = 300
_worker_pool: Pool | None = None
_stopping = False


class _PassWorkerProcess(SpawnProcess):
    @staticmethod
    def _Popen(process_obj):
        if not hasattr(signal, "pthread_sigmask"):
            return SpawnProcess._Popen(process_obj)

        # A spawn initializer runs AFTER interpreter startup and app imports.
        # Block SIGINT across exec so Ctrl+C cannot kill the child in that gap.
        # This also runs in the pool's replacement thread, without changing the
        # parent's process-wide signal handlers.
        previous_mask = signal.pthread_sigmask(signal.SIG_BLOCK, {signal.SIGINT})
        try:
            return SpawnProcess._Popen(process_obj)
        finally:
            signal.pthread_sigmask(signal.SIG_SETMASK, previous_mask)


class _PassWorkerContext(SpawnContext):
    Process = _PassWorkerProcess


def _named_worker_init():
    """Give pass workers a descriptive name in Python and system monitors."""
    setproctitle.setproctitle("Ground Station - SatellitePassWorker")
    multiprocessing.current_process().name = "Ground Station - SatellitePassWorker"


def _initialize_worker():
    # The parent owns terminal interrupts and explicitly terminates the pool.
    # Set ignore BEFORE unblocking any interrupt received during startup.
    signal.signal(signal.SIGINT, signal.SIG_IGN)
    signal.signal(signal.SIGTERM, signal.SIG_DFL)
    if hasattr(signal, "pthread_sigmask"):
        signal.pthread_sigmask(signal.SIG_UNBLOCK, {signal.SIGINT})
    _named_worker_init()


def start_worker_pool() -> None:
    """Allow work for a new application lifespan; create the worker on demand."""
    global _stopping
    _stopping = False


def get_worker_pool() -> Pool:
    """Reuse a single worker without inheriting the web server's sockets."""
    global _worker_pool
    if _stopping:
        raise RuntimeError("Satellite pass worker pool is stopping")
    if _worker_pool is None:
        logger.info("Creating persistent worker pool for satellite pass calculations")
        # Keep spawn: fork would retain HTTP connections accepted before the
        # first forecast, preventing clients from seeing the server close them.
        _worker_pool = Pool(
            processes=1, initializer=_initialize_worker, context=_PassWorkerContext()
        )
    return _worker_pool


def _terminate_worker_pool() -> None:
    global _worker_pool
    pool, _worker_pool = _worker_pool, None
    if pool is not None:
        # terminate() stops the replacement thread before killing workers. Do
        # not close()/join(): a long calculation need not finish during exit.
        pool.terminate()
        pool.join()
        logger.info("Satellite pass worker pool stopped")


def shutdown_worker_pool() -> None:
    """Stop pending calculations and prevent late requests from recreating workers."""
    global _stopping
    _stopping = True
    _terminate_worker_pool()


async def wait_for_result(
    pool: Pool, result: AsyncResult, timeout: float = RESULT_TIMEOUT_SECONDS
) -> Any:
    """Await a result without leaving an uninterruptible executor thread behind."""
    try:
        async with asyncio.timeout(timeout):
            while True:
                if _stopping or _worker_pool is not pool:
                    raise RuntimeError("Satellite pass worker pool stopped")
                if result.ready():
                    break
                # AsyncResult.get() in run_in_executor survives task cancellation
                # and can keep asyncio.run() waiting forever after worker death.
                await asyncio.sleep(0.05)
    except TimeoutError as error:
        # A dead worker can lose its in-flight result even after Pool replaces
        # it. Retire that pool so later requests get a fresh calculation worker.
        if _worker_pool is pool:
            _terminate_worker_pool()
        raise TimeoutError(
            f"Satellite pass calculation timed out after {timeout:g} seconds"
        ) from error
    # Keep worker exceptions outside the deadline handler: a task raising its
    # own TimeoutError does not mean the pool has stalled.
    return result.get()
