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


def _log_if_active(level: int, message: str, *args) -> None:
    if _discovery_shutting_down.is_set():
        return
    logger.log(level, message, *args)


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
    global discovered_servers
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


def _normalize_antenna_ports(ports: Any) -> List[str]:
    """Normalize SDR antenna names into a stable list of non-empty unique strings."""
    if ports is None:
        return []

    if isinstance(ports, (str, bytes, bytearray)):
        candidate_ports = [ports]
    else:
        try:
            # Soapy can return custom iterable vector types.
            candidate_ports = list(ports)
        except Exception:
            return []

    normalized: List[str] = []
    for port in candidate_ports:
        name = str(port).strip()
        if name and name not in normalized:
            normalized.append(name)
    return normalized


def _format_device_ports_row(device: Dict[str, Any]) -> str:
    label = str(device.get("label", device.get("driver", "unknown")) or "unknown").strip()
    serial = str(device.get("serial", "") or "").strip()
    serial_short = serial[-6:] if serial else "-"
    raw_antennas = device.get("antennas")
    if isinstance(raw_antennas, dict):
        rx = raw_antennas.get("rx", [])
        tx = raw_antennas.get("tx", [])
    else:
        rx = []
        tx = []
    rx_count = len(rx) if isinstance(rx, list) else 0
    tx_count = len(tx) if isinstance(tx, list) else 0
    return f"{label}[{serial_short}]={rx_count}/{tx_count}"


def _compact_ports_rows(devices: List[Dict[str, Any]], max_items: int = 12) -> str:
    rows = [_format_device_ports_row(device) for device in devices if isinstance(device, dict)]
    if len(rows) > max_items:
        extra = len(rows) - max_items
        rows = rows[:max_items] + [f"...(+{extra})"]
    return ", ".join(rows) if rows else "-"


def _probe_remote_device_antennas_via_remoteprobe(
    ip: str, port: int, device: Dict[str, Any]
) -> Dict[str, List[str]]:
    """
    Probe antennas through the dedicated per-device remote probe path.

    This path mirrors the explicit remote probe used elsewhere in backend flows
    and is more reliable than ad-hoc Device(args) matching for discovery.
    """
    if not HAS_SOAPYSDR:
        return {"rx": [], "tx": []}

    # Lazy import to avoid unnecessary module initialization when remote probing is unused.
    from hardware.soapysdrremoteprobe import probe_remote_soapy_sdr

    remote_driver = str(device.get("remote:driver", "") or "").strip()
    raw_driver = str(device.get("driver", "") or "").strip()
    serial = str(device.get("serial", "") or "").strip()
    mode = str(device.get("mode", "") or "").strip()
    remote_type = str(device.get("remote:type", "") or "").strip()
    label = str(device.get("label", device.get("serial", "unknown")) or "").strip()

    probe_driver = remote_driver or (raw_driver if raw_driver.lower() != "remote" else "")
    probe_details: Dict[str, Any] = {
        "host": str(ip),
        "port": int(port),
        "name": label,
        "driver": probe_driver,
        "serial": serial,
    }
    if mode:
        probe_details["mode"] = mode
    if remote_type:
        probe_details["remote:type"] = remote_type

    try:
        probe_reply = probe_remote_soapy_sdr(probe_details)
    except Exception as exc:
        _log_if_active(
            logging.WARNING,
            "Remote per-device probe crashed for %s:%s device %s: %s",
            ip,
            port,
            label,
            str(exc),
        )
        return {"rx": [], "tx": []}

    if not probe_reply.get("success"):
        _log_if_active(
            logging.WARNING,
            "Remote per-device probe failed for %s:%s device %s | driver=%s serial=%s mode=%s type=%s error=%s",
            ip,
            port,
            label,
            probe_details.get("driver", ""),
            probe_details.get("serial", ""),
            probe_details.get("mode", ""),
            probe_details.get("remote:type", ""),
            probe_reply.get("error", "unknown error"),
        )
        return {"rx": [], "tx": []}

    antennas = (probe_reply.get("data") or {}).get("antennas") or {}
    rx_ports = _normalize_antenna_ports(antennas.get("rx"))
    tx_ports = _normalize_antenna_ports(antennas.get("tx"))

    return {"rx": rx_ports, "tx": tx_ports}


async def enrich_remote_sdrs_with_antennas(
    ip: str, port: int, devices: List[Dict[str, Any]], timeout: float = 8.0
) -> List[Dict[str, Any]]:
    """
    Enrich remote discovery results with antenna-port metadata.

    This intentionally uses short per-device timeouts so one slow device does
    not block server discovery.
    """
    if not devices:
        return []

    loop = asyncio.get_event_loop()

    # Keep per-device probes serialized for stability with busy SoapyRemote endpoints.
    semaphore = asyncio.Semaphore(1)

    async def _enrich_device(device: Dict[str, Any]) -> Dict[str, Any]:
        device_dict = dict(device) if isinstance(device, dict) else soapysdr_to_dict(device)
        antennas: Dict[str, List[str]] = {"rx": [], "tx": []}

        if HAS_SOAPYSDR:
            try:
                async with semaphore:
                    antennas = await asyncio.wait_for(
                        loop.run_in_executor(
                            None,
                            _probe_remote_device_antennas_via_remoteprobe,
                            ip,
                            int(port),
                            device_dict,
                        ),
                        timeout=timeout,
                    )
            except asyncio.TimeoutError:
                _log_if_active(
                    logging.WARNING,
                    "Timeout probing antennas for %s:%s device %s",
                    ip,
                    port,
                    device_dict.get("label", device_dict.get("serial", "unknown")),
                )
            except Exception as exc:
                _log_if_active(
                    logging.WARNING,
                    "Unexpected error probing antennas for %s:%s device %s: %s",
                    ip,
                    port,
                    device_dict.get("label", device_dict.get("serial", "unknown")),
                    str(exc),
                )

        device_dict["antennas"] = antennas
        _log_if_active(
            logging.INFO,
            "Remote antenna probe result for %s:%s device %s | rx_ports=%d tx_ports=%d",
            ip,
            port,
            device_dict.get("label", device_dict.get("serial", "unknown")),
            len(antennas.get("rx", [])),
            len(antennas.get("tx", [])),
        )
        return device_dict

    return await asyncio.gather(*[_enrich_device(device) for device in devices])


async def query_sdrs_with_python_module(ip, port, timeout=5):
    """Query for SDRs using Python SoapySDR module with timeout protection."""
    if not HAS_SOAPYSDR:
        logger.warning("SoapySDR Python bindings are not installed; skipping module query")
        return [], "unavailable"

    try:
        # This needs to run in a thread pool to avoid blocking the event loop
        # Wrap with a timeout to prevent hanging on problematic servers
        loop = asyncio.get_event_loop()
        raw_results = await asyncio.wait_for(
            loop.run_in_executor(None, _query_with_soapysdr_module, ip, port), timeout=timeout
        )
        logger.info(
            "Remote enumerate returned %d device(s) for %s:%s before antenna enrichment",
            len(raw_results),
            ip,
            port,
        )

        # Convert the results to serializable dictionaries
        serializable_results = [soapysdr_to_dict(device) for device in raw_results]
        serializable_results = await enrich_remote_sdrs_with_antennas(
            ip, int(port), serializable_results
        )

        rx_ready = 0
        tx_ready = 0
        for device in serializable_results:
            antennas = device.get("antennas") if isinstance(device, dict) else {}
            rx_ports = antennas.get("rx") if isinstance(antennas, dict) else []
            tx_ports = antennas.get("tx") if isinstance(antennas, dict) else []
            if isinstance(rx_ports, list) and rx_ports:
                rx_ready += 1
            if isinstance(tx_ports, list) and tx_ports:
                tx_ready += 1

        logger.info(
            "Remote antenna enrichment complete for %s:%s | devices=%d rx_ready=%d tx_ready=%d rows=%s",
            ip,
            port,
            len(serializable_results),
            rx_ready,
            tx_ready,
            _compact_ports_rows(serializable_results),
        )

        logger.debug(f"Found {len(serializable_results)} devices on server {ip}:{port}")
        return serializable_results, "active"
    except asyncio.TimeoutError:
        logger.error(f"Timeout querying server {ip}:{port}")
        return [], "timeout"
    except Exception as e:
        logger.error(f"Error querying with Python module: {str(e)}")
        return [], f"error: {str(e)}"


def _query_with_soapysdr_module(ip, port):
    """Execute the SoapySDR module query in a separate thread."""
    if not HAS_SOAPYSDR:
        raise RuntimeError("SoapySDR Python bindings are not installed")

    try:
        # Construct remote device arguments
        args = {"driver": "remote", "remote:host": ip, "remote:port": str(port)}

        # Enumerate devices
        results = SoapySDR.Device.enumerate(args)

        return results
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
        if results or status == "active":
            return results, status
    except Exception as e:
        logger.error(f"Failed to query SDRs on {ip}:{port}: {str(e)}")

    # If we reach here, add the server but mark it as having connection issues
    return [], "connection_issues"


async def on_service_state_change(zeroconf, service_type, name, state_change):
    """Callback for service state changes."""
    global discovered_servers
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
                        "Server %s has %d connected SDR devices | rows=%s",
                        name,
                        len(connected_sdrs),
                        _compact_ports_rows(connected_sdrs),
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
        search_duration = 15
        logger.info(f"Searching for {search_duration} seconds...")
        await asyncio.sleep(search_duration)

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


# When you want to run this function:
# asyncio.run(discover_soapy_servers())


# To periodically refresh the SDR list:
async def monitor_soapy_servers(refresh_interval=60):
    """Continuously monitor SoapyRemote servers and their connected SDRs."""
    await discover_soapy_servers()

    while True:
        logger.info(f"Waiting {refresh_interval} seconds before refreshing SDR list...")
        await asyncio.sleep(refresh_interval)
        await refresh_connected_sdrs()
