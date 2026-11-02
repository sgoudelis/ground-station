# Copyright (c) 2026 Efstratios Goudelis

import asyncio
import multiprocessing
import os
import socket
from contextlib import asynccontextmanager

import pytest
import uvicorn
from websockets.asyncio.client import connect

from server.forkguard import protect_server_sockets

pytestmark = [
    pytest.mark.unit,
    pytest.mark.skipif(not hasattr(os, "fork"), reason="Requires forked workers"),
]


async def _echo_app(scope, receive, send):
    if scope["type"] == "websocket":
        await send({"type": "websocket.accept"})
        while True:
            message = await receive()
            if message["type"] == "websocket.disconnect":
                return
            if message["type"] == "websocket.receive":
                await send({"type": "websocket.send", "text": message["text"]})
    else:
        await send(
            {"type": "http.response.start", "status": 200, "headers": [(b"content-length", b"2")]}
        )
        await send({"type": "http.response.body", "body": b"ok"})


@asynccontextmanager
async def _running_server(app=_echo_app, *, guarded=True):
    server = uvicorn.Server(
        uvicorn.Config(
            app,
            host="127.0.0.1",
            port=0,
            loop="asyncio",
            http="h11",
            ws="websockets",
            lifespan="off",
            log_config=None,
            access_log=False,
            timeout_keep_alive=0.5,
            timeout_graceful_shutdown=1,
        )
    )
    if guarded:
        protect_server_sockets(server)
    task = asyncio.create_task(server.serve())
    try:
        async with asyncio.timeout(3):
            while not server.started:
                if task.done():
                    await task
                    raise AssertionError("Server exited before startup")
                await asyncio.sleep(0.01)
        address = server.servers[0].sockets[0].getsockname()
        yield server, task, address
    finally:
        server.should_exit = True
        await asyncio.wait_for(task, timeout=3)


def _worker(ready, release, unrelated_socket):
    # Neither multiprocessing IPC nor an unrelated socket belongs to Uvicorn.
    unrelated_socket.sendall(b"worker")
    ready.put("ready")
    release.wait(10)


@asynccontextmanager
async def _running_worker(*, in_thread=False):
    context = multiprocessing.get_context("fork")
    ready = context.Queue()
    release = context.Event()
    parent_socket, child_socket = socket.socketpair()
    process = context.Process(target=_worker, args=(ready, release, child_socket))
    try:
        if in_thread:
            await asyncio.to_thread(process.start)
        else:
            process.start()
        assert ready.get(timeout=3) == "ready"
        parent_socket.settimeout(1)
        assert parent_socket.recv(6) == b"worker"
        yield process
    finally:
        release.set()
        if process.pid is not None:
            process.join(timeout=3)
            if process.is_alive():
                process.kill()
                process.join(timeout=3)
            process.close()
        parent_socket.close()
        child_socket.close()
        ready.close()
        ready.join_thread()


async def _request(reader, writer):
    writer.write(b"GET /assets/map.js HTTP/1.1\r\nHost: localhost\r\n\r\n")
    await writer.drain()
    async with asyncio.timeout(3):
        headers = await reader.readuntil(b"\r\n\r\n")
        assert headers.startswith(b"HTTP/1.1 200")
        assert await reader.readexactly(2) == b"ok"


@pytest.mark.asyncio
@pytest.mark.parametrize("guarded", [False, True])
@pytest.mark.parametrize("in_thread", [False, True])
async def test_worker_does_not_hold_expired_http_connection_open(guarded, in_thread):
    async with _running_server(guarded=guarded) as (_, _, address):
        reader, writer = await asyncio.open_connection(*address)
        try:
            await _request(reader, writer)
            async with _running_worker(in_thread=in_thread) as worker:
                # Child cleanup must not shut down the parent's active connection.
                await _request(reader, writer)
                if guarded:
                    assert await asyncio.wait_for(reader.read(1), timeout=2) == b""
                else:
                    # Reproduce the original failure: Uvicorn's idle timeout fires,
                    # but its socket remains open only in the forked worker.
                    with pytest.raises(TimeoutError):
                        await asyncio.wait_for(reader.read(1), timeout=1)
                assert worker.is_alive()
            # Even without the guard, releasing the worker finally delivers EOF.
            assert await asyncio.wait_for(reader.read(1), timeout=1) == b""
        finally:
            writer.close()
            await writer.wait_closed()


@pytest.mark.asyncio
async def test_worker_does_not_keep_server_listener_bound():
    async with _running_server() as (server, task, address):
        async with _running_worker() as worker:
            server.should_exit = True
            await asyncio.wait_for(task, timeout=3)
            # A stopped/restarted backend must be able to bind its port while
            # workers are still alive; the listener's copies must also be closed.
            with socket.socket() as replacement:
                replacement.bind(address)
                replacement.listen()
            assert worker.is_alive()


@pytest.mark.asyncio
async def test_parent_websocket_remains_usable_after_worker_fork():
    async with _running_server() as (_, _, address):
        async with connect(f"ws://{address[0]}:{address[1]}/socket.io/") as websocket:
            await websocket.send("before")
            assert await asyncio.wait_for(websocket.recv(), timeout=1) == "before"
            async with _running_worker():
                await websocket.send("after")
                assert await asyncio.wait_for(websocket.recv(), timeout=1) == "after"


@pytest.mark.asyncio
async def test_parent_event_stream_remains_usable_after_worker_fork():
    release_stream = asyncio.Event()

    async def stream_app(scope, receive, send):
        await send(
            {
                "type": "http.response.start",
                "status": 200,
                "headers": [(b"content-type", b"text/event-stream")],
            }
        )
        await send({"type": "http.response.body", "body": b"data: before\n\n", "more_body": True})
        await release_stream.wait()
        await send({"type": "http.response.body", "body": b"data: after\n\n"})

    async with _running_server(stream_app) as (_, _, address):
        reader, writer = await asyncio.open_connection(*address)
        try:
            writer.write(b"GET /events HTTP/1.1\r\nHost: localhost\r\n\r\n")
            await writer.drain()
            assert b"200" in await asyncio.wait_for(reader.readuntil(b"\r\n\r\n"), 1)
            assert b"before" in await asyncio.wait_for(reader.readuntil(b"\n\n"), 1)
            async with _running_worker():
                release_stream.set()
                assert b"after" in await asyncio.wait_for(reader.readuntil(b"data: after\n\n"), 1)
        finally:
            release_stream.set()
            writer.close()
            await writer.wait_closed()


def test_guard_requires_event_loop_with_owning_python_sockets():
    server = uvicorn.Server(uvicorn.Config(_echo_app, loop="auto"))
    with pytest.raises(ValueError, match="asyncio"):
        protect_server_sockets(server)
