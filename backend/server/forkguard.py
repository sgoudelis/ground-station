# Copyright (c) 2026 Efstratios Goudelis

"""Keep forked background workers from retaining Uvicorn's network sockets."""

import os
import socket
from weakref import WeakSet

from uvicorn import Server

_servers: WeakSet[Server] = WeakSet()
_registered = False


def _close_server_sockets() -> None:
    # Inspect the child's inherited state at the instant of the fork. Taking a
    # snapshot beforehand can miss connections accepted by another thread.
    sockets: set[socket.socket] = set()
    for server in tuple(_servers):
        # Include the listener as well as HTTP, streaming, and upgraded WebSocket
        # connections. Workers must not keep the server's port or clients alive.
        candidates = [
            sock for listener in getattr(server, "servers", ()) for sock in (listener.sockets or ())
        ]
        for connection in tuple(server.server_state.connections):
            transport = getattr(connection, "transport", None)
            if transport is not None:
                candidates.append(transport.get_extra_info("socket"))

        for candidate in candidates:
            # asyncio exposes TransportSocket wrappers. Close the owning Python
            # socket so its fd becomes -1; a later destructor must not close a
            # descriptor that the child has since reused for a queue or device.
            owner = getattr(candidate, "_sock", candidate)
            if isinstance(owner, socket.socket) and owner.fileno() >= 0:
                sockets.add(owner)

    for sock in sockets:
        # close() releases only this child's copy. shutdown() would also break
        # the parent's live connection; transport.close() touches its event loop.
        sock.close()
    # Descendant forks must not inspect the parent's inherited event-loop state.
    _servers.clear()


def protect_server_sockets(server: Server) -> None:
    """Arrange child-only cleanup before starting a single-process Uvicorn server."""
    global _registered

    if not hasattr(os, "register_at_fork"):
        return
    # Other event loops may expose fd-only wrappers instead of owning Python
    # sockets. Use asyncio explicitly rather than silently leaving copies open.
    if server.config.loop != "asyncio":
        raise ValueError("Server socket fork cleanup requires Uvicorn's asyncio loop")
    if not _registered:
        os.register_at_fork(after_in_child=_close_server_sockets)
        _registered = True
    _servers.add(server)
