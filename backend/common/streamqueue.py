"""Disposable multiprocessing queues for live samples."""

import multiprocessing
import sys
from multiprocessing.queues import Queue
from threading import Thread
from typing import Any


class StreamQueue(Queue):
    """A live stream must not flush to a stopped consumer during Python exit."""

    # typeshed omits Queue's private attributes; pipe types vary by platform.
    _reader: Any
    _writer: Any
    _thread: Thread | None

    def __init__(self, maxsize: int = 0):
        super().__init__(maxsize=maxsize, ctx=multiprocessing.get_context())
        # Pending samples have no value after the consumer stops. Register this
        # policy before the first put() creates an exit-time feeder join.
        self.cancel_join_thread()

    @staticmethod
    def _on_queue_feeder_error(error, item):
        # Discard deliberately breaks the pipe. Let Queue consume its remaining
        # buffer and sentinel so it also closes the writer, without tracebacks
        # for samples that no longer have a recipient.
        if not isinstance(error, BrokenPipeError):
            Queue._on_queue_feeder_error(error, item)  # type: ignore[attr-defined]

    def discard(self) -> None:
        """Release this process's queue without waiting for buffered delivery."""
        self.cancel_join_thread()
        self.close()
        # Queue.close() only appends a sentinel behind pending data. A feeder
        # already blocked in write() cannot reach it while our own read end is
        # open. Release that end so it gets EPIPE once child readers exit.
        # Python 3.12's Queue._terminate_broken() uses the same endpoint cleanup.
        self._reader.close()
        if self._thread is None or sys.platform == "win32":
            # Without a feeder there is no thread to close the writer. Windows
            # also needs the writer closed to interrupt a pending pipe write.
            self._writer.close()
