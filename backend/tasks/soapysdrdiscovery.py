"""
SoapySDR Server Discovery background task.

This task discovers SoapyRemote servers using mDNS (Zeroconf) and queries them
for connected SDR devices. It's designed to run as a background task with progress reporting.
"""

import asyncio
import logging
import multiprocessing
import signal
from multiprocessing import Queue
from typing import Optional

try:
    import setproctitle

    HAS_SETPROCTITLE = True
except ImportError:
    HAS_SETPROCTITLE = False

from hardware.soapysdrbrowser import (
    discover_soapy_servers,
    discovered_servers,
    get_active_servers_with_sdrs,
    refresh_connected_sdrs,
)

logger = logging.getLogger("soapysdr-discovery-task")


def _serialize_timestamp(value: object) -> float:
    if not isinstance(value, (str, int, float)):
        raise ValueError("Invalid discovery timestamp")
    return float(value)


class GracefulKiller:
    """Handle SIGTERM gracefully within the process."""

    def __init__(self):
        self.kill_now = False
        self.active_task: Optional[asyncio.Task] = None
        signal.signal(signal.SIGTERM, self.exit_gracefully)
        signal.signal(signal.SIGINT, self.exit_gracefully)

    def exit_gracefully(self, *args):
        if self.kill_now:
            return  # Let the first cancellation finish reaping native probes.
        self.kill_now = True
        if self.active_task is not None:
            self.active_task.get_loop().call_soon_threadsafe(self.active_task.cancel)

    def run(self, loop, coroutine):
        """Keep the active operation cancellable while the worker owns its probes."""
        # Keep a non-optional reference while the signal handler uses the shared slot.
        task: asyncio.Task = loop.create_task(coroutine)
        self.active_task = task
        if self.kill_now:
            task.cancel()
        try:
            return loop.run_until_complete(task)
        finally:
            self.active_task = None


def soapysdr_discovery_task(_progress_queue: Optional[Queue] = None):
    """
    Run one discovery pass requested from the SDR hardware page.

    Args:
        _progress_queue: Queue for sending progress updates (injected by manager)

    Returns:
        Dict with discovery results
    """
    # Set process name
    if HAS_SETPROCTITLE:
        setproctitle.setproctitle("Ground Station - SoapySDR-Discovery")
    multiprocessing.current_process().name = "Ground Station - SoapySDR-Discovery"

    killer = GracefulKiller()

    try:
        if _progress_queue:
            _progress_queue.put(
                {
                    "type": "output",
                    "output": "Starting SoapySDR server discovery...",
                    "stream": "stdout",
                    "progress": 0,
                }
            )

        # Run the async discovery in a new event loop (since we're in a separate process)
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)

        try:
            # Initial discovery
            if _progress_queue:
                _progress_queue.put(
                    {
                        "type": "output",
                        "output": "Performing initial mDNS discovery...",
                        "stream": "stdout",
                        "progress": 10,
                    }
                )

            killer.run(loop, discover_soapy_servers())

            if killer.kill_now:
                if _progress_queue:
                    _progress_queue.put(
                        {
                            "type": "output",
                            "output": "Discovery interrupted by user",
                            "stream": "stdout",
                        }
                    )
                return {"status": "interrupted", "servers": {}}

            # Report initial discovery results
            server_count = len(discovered_servers)
            active_servers = get_active_servers_with_sdrs()
            active_count = len(active_servers)
            active_sdr_count = sum(
                len(server_info.get("sdrs", []))
                for server_info in active_servers.values()
                if isinstance(server_info.get("sdrs", []), list)
            )

            # Serialize discovered servers for transmission to main process
            serialized_servers = {}
            for name, server_info in discovered_servers.items():
                serialized_servers[name] = {
                    "ip": server_info.get("ip"),
                    "port": server_info.get("port"),
                    "name": server_info.get("name"),
                    "mDNS_name": server_info.get("mDNS_name"),
                    "status": server_info.get("status"),
                    "sdrs": server_info.get("sdrs", []),
                    "addresses": server_info.get("addresses", []),
                    "last_updated": _serialize_timestamp(server_info.get("last_updated", 0)),
                }

            if _progress_queue:
                _progress_queue.put(
                    {
                        "type": "output",
                        "output": (
                            "Initial discovery complete: "
                            f"Found {server_count} server(s), {active_sdr_count} SDR(s) active"
                        ),
                        "stream": "stdout",
                        "progress": 50,
                    }
                )

                # Send discovery data to main process
                _progress_queue.put(
                    {
                        "type": "discovery_update",
                        "servers": serialized_servers,
                        "server_count": server_count,
                        "active_count": active_count,
                        "sdr_count": active_sdr_count,
                    }
                )

                # Report details for each server
                for name, server_info in discovered_servers.items():
                    ip = server_info.get("ip")
                    port = server_info.get("port")
                    status = server_info.get("status")
                    sdrs = server_info.get("sdrs", [])
                    sdr_count = len(sdrs) if isinstance(sdrs, list) else 0

                    status_line = f"  • {name} ({ip}:{port}) - Status: {status}"
                    if status == "active" and sdr_count > 0:
                        status_line += f" - {sdr_count} SDR(s) connected"

                    _progress_queue.put(
                        {"type": "output", "output": status_line, "stream": "stdout"}
                    )

                    # Report individual SDRs
                    if status == "active" and isinstance(sdrs, list):
                        for i, sdr in enumerate(sdrs):
                            driver = sdr.get("driver", "Unknown")
                            label = sdr.get("label", sdr.get("device", f"SDR #{i+1}"))
                            serial = sdr.get("serial", "N/A")
                            _progress_queue.put(
                                {
                                    "type": "output",
                                    "output": f"    - {label} ({driver}) [Serial: {serial}]",
                                    "stream": "stdout",
                                }
                            )

            if _progress_queue:
                _progress_queue.put(
                    {
                        "type": "output",
                        "output": "Single discovery completed",
                        "stream": "stdout",
                        "progress": 100,
                    }
                )

            # Serialize discovered servers for return
            serialized_servers = {}
            for name, server_info in discovered_servers.items():
                serialized_servers[name] = {
                    "ip": server_info.get("ip"),
                    "port": server_info.get("port"),
                    "name": server_info.get("name"),
                    "status": server_info.get("status"),
                    "sdrs": server_info.get("sdrs", []),
                }

            return {
                "status": "completed",
                "server_count": server_count,
                "active_count": active_count,
                "servers": serialized_servers,
            }

        finally:
            loop.close()

    except asyncio.CancelledError:
        return {"status": "interrupted", "servers": {}}
    except Exception as e:
        error_msg = f"Error during SoapySDR discovery: {str(e)}"
        logger.error(error_msg)
        if _progress_queue:
            _progress_queue.put({"type": "error", "error": error_msg, "stream": "stderr"})
        raise


def soapysdr_quick_refresh_task(_progress_queue: Optional[Queue] = None):
    """
    Quick refresh of already-discovered SoapySDR servers.

    This only re-queries known servers for their connected SDRs without doing
    a full mDNS discovery. Useful for checking if devices were plugged/unplugged.

    Args:
        _progress_queue: Queue for sending progress updates (injected by manager)

    Returns:
        Dict with refresh results
    """
    # Set process name
    if HAS_SETPROCTITLE:
        setproctitle.setproctitle("Ground Station - SoapySDR-Refresh")
    multiprocessing.current_process().name = "Ground Station - SoapySDR-Refresh"

    killer = GracefulKiller()

    try:
        if _progress_queue:
            _progress_queue.put(
                {
                    "type": "output",
                    "output": "Refreshing connected SDRs on known servers...",
                    "stream": "stdout",
                    "progress": 0,
                }
            )

        if not discovered_servers:
            if _progress_queue:
                _progress_queue.put(
                    {
                        "type": "output",
                        "output": "No servers known yet. Run full discovery first.",
                        "stream": "stdout",
                        "progress": 100,
                    }
                )
            return {"status": "completed", "message": "No servers to refresh"}

        # Run the async refresh
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)

        try:
            killer.run(loop, refresh_connected_sdrs())

            active_servers = get_active_servers_with_sdrs()
            active_count = len(active_servers)

            # Serialize discovered servers for transmission to main process
            serialized_servers = {}
            for name, server_info in discovered_servers.items():
                serialized_servers[name] = {
                    "ip": server_info.get("ip"),
                    "port": server_info.get("port"),
                    "name": server_info.get("name"),
                    "mDNS_name": server_info.get("mDNS_name"),
                    "status": server_info.get("status"),
                    "sdrs": server_info.get("sdrs", []),
                    "addresses": server_info.get("addresses", []),
                    "last_updated": _serialize_timestamp(server_info.get("last_updated", 0)),
                }

            if _progress_queue:
                _progress_queue.put(
                    {
                        "type": "output",
                        "output": f"Refresh complete: {active_count} active server(s) with SDRs",
                        "stream": "stdout",
                        "progress": 100,
                    }
                )

                # Send discovery data to main process
                _progress_queue.put(
                    {
                        "type": "discovery_update",
                        "servers": serialized_servers,
                        "server_count": len(discovered_servers),
                        "active_count": active_count,
                    }
                )

            return {
                "status": "completed",
                "server_count": len(discovered_servers),
                "active_count": active_count,
            }
        finally:
            loop.close()

    except asyncio.CancelledError:
        return {"status": "interrupted", "servers": {}}
    except Exception as e:
        error_msg = f"Error during SDR refresh: {str(e)}"
        logger.error(error_msg)
        if _progress_queue:
            _progress_queue.put({"type": "error", "error": error_msg, "stream": "stderr"})
        raise
