"""Regression coverage for HTTP connections held open by the pass worker."""

import os
import socket

import pytest

from tracking import events


@pytest.mark.integration
def test_pass_worker_does_not_inherit_http_connections(monkeypatch):
    monkeypatch.setattr(events, "_worker_pool", None)

    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        listener.listen(1)
        with socket.create_connection(listener.getsockname(), timeout=2) as client:
            connection, _ = listener.accept()
            pool = None
            try:
                # Create the pool while an HTTP-like connection is open, as happens
                # when the UI requests its first pass forecast after a deployment.
                pool = events._get_worker_pool()
                worker_pid = pool.apply_async(os.getpid).get(timeout=20)
                assert worker_pid != os.getpid()
                assert events._get_worker_pool() is pool

                connection.close()
                # An inherited worker descriptor prevents EOF and leaves nginx
                # reusing a connection that no web-server process can read.
                assert client.recv(1) == b""
                assert pool.apply_async(os.getpid).get(timeout=5) == worker_pid
            finally:
                connection.close()
                if pool is not None:
                    pool.terminate()
                    pool.join()
