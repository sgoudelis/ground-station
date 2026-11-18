"""Exercise interpreter exit with abandoned, pipe-filling stream messages."""

import multiprocessing
import os
import queue
import signal
import subprocess
import sys
import time
from pathlib import Path

import pytest

from audio.audiobroadcaster import AudioBroadcaster
from common.streamqueue import StreamQueue
from pipeline.streaming.iqbroadcaster import IQBroadcaster

pytestmark = pytest.mark.unit


def _consume_one(messages, consumed, release):
    assert messages.get(timeout=5)["data"] == b"first"
    consumed.set()
    assert release.wait(5)


def _wait_until(predicate):
    deadline = time.monotonic() + 5
    while not predicate():
        assert time.monotonic() < deadline, "Stream did not reach expected state"
        time.sleep(0.01)


def _stream_scenario(kind, operation):
    source = queue.Queue()
    broadcaster = (
        IQBroadcaster(source, "shutdown-test") if kind == "iq" else AudioBroadcaster(source)
    )
    messages = broadcaster.subscribe("decoder:test", maxsize=10, for_process=True)
    consumed, release = multiprocessing.Event(), multiprocessing.Event()
    consumer = multiprocessing.Process(target=_consume_one, args=(messages, consumed, release))
    consumer.start()
    broadcaster.start()
    try:
        source.put({"data": b"first"})
        assert consumed.wait(5), "Consumer did not receive the live stream"
        # A megabyte exceeds the pipe capacity. put(block=False) still leaves
        # QueueFeederThread blocked in write() after this consumer exits.
        source.put({"data": bytes(1024 * 1024)})
        _wait_until(lambda: broadcaster.stats["messages_broadcast"] == 2)
        if operation == "unsubscribe":
            broadcaster.unsubscribe("decoder:test")
            broadcaster.unsubscribe("decoder:test")
        elif operation == "replace":
            # Audio subscriptions may be replaced under the same name.
            broadcaster.subscribe("decoder:test", for_process=True)
        elif operation == "error":
            # IQ fanout removes failed subscriptions through a separate path.
            messages.close()
            source.put({"data": b"after-close"})
            _wait_until(lambda: broadcaster.get_subscriber_count() == 0)
        broadcaster.stop()
        broadcaster.stop()
        broadcaster.join(timeout=2)
        assert not broadcaster.is_alive()

        # Consumer cleanup can finish after unsubscribe returns. Closing the
        # parent's endpoints must leave the child's copy valid until it exits.
        release.set()
        consumer.join(timeout=5)
        assert consumer.exitcode == 0

        # Check resource release as well as interpreter exit. Merely cancelling
        # the exit-time join would leave a stuck feeder after every decoder stop.
        messages._thread.join(timeout=2)
        assert not messages._thread.is_alive(), "Abandoned stream feeder is still alive"
        assert messages._reader.closed
        assert messages._writer.closed
        print("stream cleanup returned", flush=True)
    finally:
        release.set()
        if consumer.is_alive():
            consumer.kill()
        consumer.join(timeout=2)
        broadcaster.stop()
        broadcaster.join(timeout=2)


def _signal_scenario():
    original = {sig: signal.getsignal(sig) for sig in (signal.SIGINT, signal.SIGTERM)}
    # Importing the singleton must not take signal ownership from the executable
    # or from an embedding ASGI server.
    from pipeline.orchestration.processmanager import ProcessManager, process_manager

    manager = ProcessManager()
    try:
        assert {sig: signal.getsignal(sig) for sig in original} == original
    finally:
        manager.shutdown()
        process_manager.shutdown()


@pytest.mark.parametrize(
    ("kind", "operation"),
    [
        ("iq", "unsubscribe"),
        ("iq", "stop"),
        ("iq", "error"),
        ("audio", "unsubscribe"),
        ("audio", "stop"),
        ("audio", "replace"),
    ],
)
def test_stopped_stream_releases_feeder_and_interpreter(kind, operation):
    result = _run_scenario(kind, operation)
    assert result.returncode == 0, result.stdout + result.stderr
    assert "stream cleanup returned" in result.stdout


def test_process_manager_preserves_application_signal_handlers():
    result = _run_scenario("signals")
    assert result.returncode == 0, result.stdout + result.stderr


def test_unused_stream_queue_releases_both_endpoints():
    messages = StreamQueue(maxsize=1)
    messages.discard()
    messages.discard()
    assert messages._reader.closed
    assert messages._writer.closed


def test_audio_broadcaster_leaves_caller_owned_queue_usable():
    messages = queue.Queue()
    broadcaster = AudioBroadcaster(queue.Queue())
    broadcaster.subscribe_existing_queue("playback", messages)
    broadcaster.stop()
    messages.put("still usable")
    assert messages.get_nowait() == "still usable"


@pytest.mark.parametrize("kind", ["iq", "audio"])
def test_stopped_broadcaster_rejects_new_process_subscriptions(kind):
    broadcaster = (
        IQBroadcaster(queue.Queue(), "test") if kind == "iq" else AudioBroadcaster(queue.Queue())
    )
    broadcaster.stop()
    with pytest.raises(RuntimeError, match="stopping"):
        broadcaster.subscribe("late-decoder", for_process=True)


def _run_scenario(*args):
    backend = Path(__file__).resolve().parents[1]
    return subprocess.run(
        [sys.executable, str(Path(__file__).resolve()), *args],
        cwd=backend,
        env={**os.environ, "ALEMBIC_CONTEXT": "1", "PYTHONPATH": str(backend)},
        capture_output=True,
        text=True,
        timeout=15,
    )


if __name__ == "__main__":
    if sys.argv[1] == "signals":
        _signal_scenario()
    else:
        _stream_scenario(*sys.argv[1:])
