# Copyright (c) 2025 Efstratios Goudelis
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU General Public License for more details.
#
# You should have received a copy of the GNU General Public License
# along with this program. If not, see <https://www.gnu.org/licenses/>.


import asyncio
import json
import logging
import socket
import sys
import threading
import time
from typing import Any, Dict, List, Set, Union

try:
    import SoapySDR

    HAS_SOAPYSDR = True
except ImportError:
    SoapySDR = None
    HAS_SOAPYSDR = False
from zeroconf import ServiceStateChange
from zeroconf.asyncio import AsyncServiceBrowser, AsyncZeroconf

# Configure logger
logger = logging.getLogger("soapysdr-browser")
DISCOVERY_SEARCH_SECONDS = 15

# Store discovered servers here with a dictionary for each server containing all properties
discovered_servers: Dict[str, Dict[str, Union[str, List[Any], int, float]]] = {}

# Thread lock for safe access to discovered_servers from multiple threads/processes
_servers_lock = threading.Lock()
# Track in-flight async service handlers so discovery shutdown can drain cleanly.
_service_event_tasks: Set[asyncio.Task] = set()
# Keep at most one in-flight Added/Updated handler per logical mDNS service.
_service_tasks_by_name: Dict[str, asyncio.Task] = {}
# Suppress late probe logs once discovery shutdown has started.
_discovery_shutting_down = threading.Event()


# Custom JSON encoder to handle SoapySDR types
class SoapySDREncoder(json.JSONEncoder):
    def default(self, obj):
        try:
            # Convert SoapySDRKwargs objects to dictionaries
            if hasattr(obj, "__dict__"):
                return obj.__dict__
            # Handle other special types from SoapySDR
            if hasattr(obj, "items") and callable(obj.items):
                return dict(obj.items())
            # Handle any other iterable types
            if hasattr(obj, "__iter__") and not isinstance(obj, (str, bytes, dict)):
                return list(obj)

        except Exception:
            pass

        # Let the base class handle everything else
        return super().default(obj)


# Thread-safe helper functions for accessing discovered_servers
def update_discovered_servers(servers_data: Dict[str, Dict[str, Any]]) -> None:
    """
    Thread-safe update of discovered_servers from background task data.

    Args:
        servers_data: Dictionary of server data to update
    """
    with _servers_lock:
        discovered_servers.clear()
        discovered_servers.update(servers_data)
        logger.debug(f"Updated discovered_servers with {len(servers_data)} server(s)")


def get_discovered_servers() -> Dict[str, Dict[str, Any]]:
    """
    Thread-safe retrieval of discovered_servers.

    Returns:
        Copy of discovered_servers dictionary
    """
    with _servers_lock:
        return discovered_servers.copy()


# Helper function to convert SoapySDR objects to serializable dictionaries
def soapysdr_to_dict(sdr_obj):
    """Convert SoapySDR objects to serializable dictionaries."""
    if isinstance(sdr_obj, dict):
        return {k: soapysdr_to_dict(v) for k, v in sdr_obj.items()}
    elif hasattr(sdr_obj, "items") and callable(getattr(sdr_obj, "items")):
        return {k: soapysdr_to_dict(v) for k, v in sdr_obj.items()}
    elif hasattr(sdr_obj, "__dict__"):
        return {
            k: soapysdr_to_dict(v) for k, v in sdr_obj.__dict__.items() if not k.startswith("_")
        }
    elif isinstance(sdr_obj, (list, tuple)):
        return [soapysdr_to_dict(x) for x in sdr_obj]
    else:
        # Basic types should be serializable
        return sdr_obj


async def _run_soapy_probe(function_name: str, *args: Any, timeout: float) -> Any:
    """Run native Soapy calls in a process that can be reaped on timeout or cancellation."""
    # Drivers can print during initialization or interpreter shutdown. Reserve a
    # duplicate of stdout for the JSON result and route driver output to stderr.
    process = await asyncio.create_subprocess_exec(
        sys.executable,
        "-c",
        "import json, os, sys\n"
        "with os.fdopen(os.dup(sys.stdout.fileno()), 'w') as output:\n"
        "    os.dup2(sys.stderr.fileno(), sys.stdout.fileno())\n"
        "    from hardware import soapysdrbrowser as browser\n"
        "    result = getattr(browser, sys.argv[1])(*json.loads(sys.argv[2]))\n"
        "    json.dump(result, output, cls=browser.SoapySDREncoder)\n",
        function_name,
        json.dumps(args),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    communication = asyncio.create_task(process.communicate())
    try:
        # A thread timeout leaves native calls running and can prevent the whole
        # discovery worker from exiting. Keep communication alive during cleanup
        # so killing a blocked probe also drains its pipes and reaps the child.
        stdout, stderr = await asyncio.wait_for(asyncio.shield(communication), timeout)
    finally:
        if process.returncode is None:
            try:
                process.kill()
            except ProcessLookupError:
                pass  # The probe exited between the return-code check and kill.
        await communication

    if process.returncode != 0:
        detail = stderr.decode(errors="replace").strip()
        raise RuntimeError(f"SoapySDR probe exited with code {process.returncode}: {detail}")
    return json.loads(stdout)


async def query_sdrs_with_python_module(ip, port, timeout=5):
    """Query for SDRs using Python SoapySDR module with timeout protection."""
    if not HAS_SOAPYSDR:
        logger.warning("SoapySDR Python bindings are not installed; skipping module query")
        return [], "unavailable"

    try:
        raw_results = await _run_soapy_probe(
            "_query_with_soapysdr_module", ip, port, timeout=timeout
        )
        # Discovery lists devices without opening them. Capability/antenna reads
        # belong to an explicit selected-device probe in the server process.
        serializable_results = [soapysdr_to_dict(device) for device in raw_results]

        logger.debug(f"Found {len(serializable_results)} devices on server {ip}:{port}")
        return serializable_results, "active"
    except asyncio.TimeoutError:
        logger.error(f"Timeout querying server {ip}:{port}")
        return [], "timeout"
    except Exception as e:
        logger.error(f"Error querying with Python module: {str(e)}")
        return [], f"error: {str(e)}"


def _query_with_soapysdr_module(ip, port):
    """Enumerate devices and detach their data from native objects in the probe process."""
    if not HAS_SOAPYSDR:
        raise RuntimeError("SoapySDR Python bindings are not installed")

    try:
        # Construct remote device arguments
        args = {"driver": "remote", "remote:host": ip, "remote:port": str(port)}

        # Enumerate devices
        results = SoapySDR.Device.enumerate(args)

        return [soapysdr_to_dict(device) for device in results]
    except Exception as e:
        logger.error(f"SoapySDR module error: {str(e)}")
        # Re-raise to be handled by the caller
        raise


async def try_simple_socket_connection(ip, port, timeout=2):
    """Try a simple socket connection to check if server is reachable."""
    try:
        # Simply try to establish a TCP connection to the server
        future = asyncio.open_connection(ip, port)
        reader, writer = await asyncio.wait_for(future, timeout=timeout)

        # If we get here, connection was successful
        writer.close()
        await writer.wait_closed()
        return True
    except Exception as e:
        logger.debug(f"Socket connection test to {ip}:{port} failed: {str(e)}")
        return False


async def query_server_for_sdrs(ip, port):
    """Query a SoapySDR server for connected devices with fallbacks."""
    # First check if server is reachable
    server_reachable = await try_simple_socket_connection(ip, port)
    if not server_reachable:
        logger.warning(f"Server {ip}:{port} is not reachable")
        return [], "unreachable"

    # Server is reachable, try the SoapySDR Python module
    try:
        results, status = await query_sdrs_with_python_module(ip, port)
        # Preserve timeout and missing-binding states for direct server queries.
        return results, status
    except Exception as e:
        logger.error(f"Failed to query SDRs on {ip}:{port}: {str(e)}")

    # If we reach here, add the server but mark it as having connection issues
    return [], "connection_issues"


async def on_service_state_change(zeroconf, service_type, name, state_change):
    """Callback for service state changes."""
    started_at = time.perf_counter()
    logger.info(f"Service {name} of type {service_type} state changed: {state_change}")

    if state_change is ServiceStateChange.Added or state_change is ServiceStateChange.Updated:
        info = await zeroconf.async_get_service_info(service_type, name)
        if info:
            addresses = [socket.inet_ntoa(addr) for addr in info.addresses]
            port = info.port
            server_name = info.server.replace(".local.", "")  # Clean up server name
            logger.info(
                f"Found SoapyRemote Server: {name} | Server: {server_name} | Addresses: {addresses} | Port: {port}"
            )

            # Find a suitable IP address
            server_ip = None
            for addr in addresses:
                # Basic check for common private IPv4 ranges
                if addr.startswith(("192.168.", "10.", "172.")):
                    server_ip = addr
                    break

            if not server_ip and addresses:
                server_ip = addresses[0]

            if server_ip:
                # Query for connected SDRs
                connected_sdrs, status = await query_server_for_sdrs(server_ip, port)

                # Store server info in a dictionary
                server_info = {
                    "ip": server_ip,
                    "port": port,
                    "name": server_name,
                    "mDNS_name": name,
                    "status": status,
                    "sdrs": connected_sdrs,
                    "addresses": addresses,
                    "last_updated": asyncio.get_event_loop().time(),
                }

                # Store in our global dictionary
                discovered_servers[name] = server_info

                if status == "active":
                    logger.info(
                        "Server %s has %d connected SDR devices",
                        name,
                        len(connected_sdrs),
                    )
                else:
                    logger.warning(f"Server {name} is available but has status: {status}")

            logger.debug(
                "Service handler completed | name=%s state=%s elapsed=%.2fs",
                name,
                state_change,
                time.perf_counter() - started_at,
            )

    elif state_change is ServiceStateChange.Removed:
        logger.info(f"Service {name} removed")
        if name in discovered_servers:
            del discovered_servers[name]


# This is a wrapper that will handle the async callback properly
def _service_state_change_done(service_name: str, task: asyncio.Task) -> None:
    _service_event_tasks.discard(task)
    current_task = _service_tasks_by_name.get(service_name)
    if current_task is task:
        _service_tasks_by_name.pop(service_name, None)
    if task.cancelled():
        return
    exc = task.exception()
    if exc is not None and not _discovery_shutting_down.is_set():
        logger.warning("Service state handler failed: %s", str(exc))


def service_state_change_handler(zeroconf, service_type, name, state_change):
    """Handle the service state change by scheduling the async callback."""
    if _discovery_shutting_down.is_set():
        return
    if state_change is ServiceStateChange.Added or state_change is ServiceStateChange.Updated:
        running_task = _service_tasks_by_name.get(name)
        if running_task is not None and not running_task.done():
            logger.debug(
                "Coalescing Soapy service event | name=%s state=%s pending_handlers=%d",
                name,
                state_change,
                len(_service_event_tasks),
            )
            return
    task = asyncio.create_task(on_service_state_change(zeroconf, service_type, name, state_change))
    _service_event_tasks.add(task)
    if state_change is ServiceStateChange.Added or state_change is ServiceStateChange.Updated:
        _service_tasks_by_name[name] = task
    task.add_done_callback(lambda done_task: _service_state_change_done(name, done_task))


async def refresh_connected_sdrs():
    """Refresh the list of SDRs connected to each known server."""
    for name, server_info in list(discovered_servers.items()):
        ip = server_info["ip"]
        port = server_info["port"]
        prev_status = server_info["status"]

        connected_sdrs, status = await query_server_for_sdrs(ip, port)

        # Update server info
        server_info["sdrs"] = connected_sdrs
        server_info["status"] = status
        server_info["last_updated"] = float(asyncio.get_event_loop().time())

        if status == "active":
            if prev_status != "active":
                logger.info(f"Server {name} is now active (was {prev_status})")
            sdrs = server_info.get("sdrs", [])
            sdr_count = len(sdrs) if isinstance(sdrs, list) else 0
            logger.info(f"Refreshed SDRs for {name}: found {sdr_count} devices")
        else:
            if prev_status == "active":
                logger.warning(f"Server {name} changed status from active to {status}")
            else:
                logger.debug(f"Server {name} still has status: {status}")


async def discover_soapy_servers():
    """Discover SoapyRemote servers using AsyncZeroconf."""
    _discovery_shutting_down.clear()
    _service_event_tasks.clear()
    _service_tasks_by_name.clear()
    logger.info("Starting mDNS discovery for SoapyRemote servers...")

    # Create AsyncZeroconf instance
    azc = AsyncZeroconf()

    # Define service type
    service_type = "_soapy._tcp.local."  # Fixed the service type here

    # Create service browser with callback wrapper
    browser = AsyncServiceBrowser(
        azc.zeroconf,
        [service_type],
        handlers=[service_state_change_handler],  # Use the wrapper instead
    )

    try:
        logger.info(f"Searching for {DISCOVERY_SEARCH_SECONDS} seconds...")
        await asyncio.sleep(DISCOVERY_SEARCH_SECONDS)

        if discovered_servers:
            logger.debug("Found the following potential SoapyRemote servers:")
            for name, server_info in discovered_servers.items():
                sdrs = server_info.get("sdrs", [])
                sdr_count = len(sdrs) if isinstance(sdrs, list) else 0
                logger.debug(
                    f"  Name: {name}, IP: {server_info['ip']}, Port: {server_info['port']}, "
                    f"Status: {server_info['status']}, Connected SDRs: {sdr_count}"
                )

                if server_info["status"] == "active" and isinstance(sdrs, list) and sdrs:
                    # Format SDR information for nice display
                    for i, sdr in enumerate(sdrs):
                        try:
                            # Pretty format with indentation
                            sdr_info = json.dumps(sdr, cls=SoapySDREncoder, indent=2)
                            logger.debug(f"    SDR #{i+1}:\n{sdr_info}")
                        except Exception as e:
                            logger.error(f"Error formatting SDR info: {str(e)}")
        else:
            logger.debug("No SoapyRemote servers advertising via mDNS found.")

    except asyncio.CancelledError:
        logger.info("Discovery cancelled...")
        # Cancel handlers before draining them so SIGTERM can reap a blocked
        # probe before the task manager has to kill the discovery worker.
        for task in list(_service_event_tasks):
            task.cancel()
    finally:
        _discovery_shutting_down.set()
        logger.info("Closing Zeroconf browser...")
        await browser.async_cancel()
        await azc.async_close()
        if _service_event_tasks:
            pending_tasks = list(_service_event_tasks)
            logger.info(
                "Waiting for %d pending Soapy service handler task(s) to settle...",
                len(pending_tasks),
            )
            done, pending = await asyncio.wait(pending_tasks)
            logger.info(
                "Soapy service handler drain complete: done=%d pending_cancelled=%d",
                len(done),
                len(pending),
            )
            _service_event_tasks.clear()
            _service_tasks_by_name.clear()
        logger.info("Discovery completed.")


# Helper function to get a human-readable representation of discovered servers
def get_server_summary():
    """Return a human-readable summary of discovered servers and their SDRs."""
    if not discovered_servers:
        return "No SoapyRemote servers discovered."

    summary = []
    summary.append(f"Discovered {len(discovered_servers)} SoapyRemote servers:")

    for name, server_info in discovered_servers.items():
        summary.append(f"  Server: {name}")
        summary.append(
            f"    IP: {server_info['ip']}, Port: {server_info['port']}, Status: {server_info['status']}"
        )

        if server_info["status"] == "active":
            sdrs = server_info.get("sdrs", [])
            if isinstance(sdrs, list):
                summary.append(f"    Connected SDRs: {len(sdrs)}")

                for i, sdr in enumerate(sdrs):
                    # Extract key info like driver, label if available
                    driver = sdr.get("driver", "Unknown")
                    label = sdr.get("label", sdr.get("device", f"SDR #{i+1}"))
                    summary.append(f"      SDR #{i+1}: {label} ({driver})")
        else:
            summary.append(f"    No SDR information available: {server_info['status']}")

    return "\n".join(summary)


# Get only active servers with connected SDRs
def get_active_servers_with_sdrs():
    """Return only active servers that have connected SDRs."""
    active_servers = {}

    for name, server_info in discovered_servers.items():
        if server_info["status"] == "active" and server_info["sdrs"]:
            active_servers[name] = server_info

    return active_servers
