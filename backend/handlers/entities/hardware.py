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

"""Hardware (rigs, rotators, cameras, SDRs) handlers."""

import asyncio
import json
import logging
import math
import sys
import time
from contextlib import AsyncExitStack
from typing import Any, Dict, Optional, Union

import crud
from common.constants import TrackerCommands
from db import AsyncSessionLocal
from hardware.control import submit_device_command
from hardware.parameters import (
    cache_sdr_parameters,
    communicate_sdr_probe,
    get_cached_sdr_parameters,
    invalidate_sdr_parameters,
    probe_sdr_parameters,
    probe_soapy_parameters,
    sdr_hardware_lock,
    sdr_parameter_lock,
)
from hardware.service import hardware
from hardware.soapysdrbrowser import discovered_servers, query_server_for_sdrs
from server import runtimestate
from session.background import background_sessions
from session.store import active_sdr_clients
from tracker.contracts import InvalidTrackerIdError, get_tracking_state_name, require_tracker_id
from tracker.operations import operations, validate_external_request
from tracker.runner import (
    get_all_tracker_managers,
    get_existing_tracker_manager,
    get_tracker_instances_payload,
    get_tracker_manager,
)

logger = logging.getLogger("hardware-handler")


def _decode_subprocess_output(raw: Optional[bytes]) -> str:
    if not raw:
        return ""
    return raw.decode(errors="replace").strip()


def _truncate_log_payload(value: str, limit: int = 4000) -> str:
    if len(value) <= limit:
        return value
    return f"{value[:limit]}... [truncated {len(value) - limit} chars]"


def _emit_probe_logs(probe_name: str, logs: Any) -> None:
    if not isinstance(logs, list):
        return

    for entry in logs:
        line = str(entry).strip()
        if not line:
            continue

        upper_line = line.upper()
        if upper_line.startswith(("ERROR:", "EXCEPTION:")):
            logger.error("%s | %s", probe_name, line)
        elif upper_line.startswith(("WARNING:", "WARN:")):
            logger.warning("%s | %s", probe_name, line)
        else:
            logger.info("%s | %s", probe_name, line)


def _log_probe_stderr(probe_name: str, stderr_text: str) -> None:
    if not stderr_text:
        return
    for line in stderr_text.splitlines():
        if line.strip():
            logger.warning("%s stderr | %s", probe_name, line)


def _log_probe_antenna_summary(probe_name: str, devices: Any) -> None:
    if not isinstance(devices, list):
        logger.warning("%s returned non-list data payload: %s", probe_name, type(devices))
        return

    logger.info("%s summary | devices=%d", probe_name, len(devices))
    for idx, device in enumerate(devices):
        if not isinstance(device, dict):
            logger.info("%s summary | [%d] non-dict entry: %s", probe_name, idx, type(device))
            continue
        antennas = device.get("antennas") or {}
        rx = antennas.get("rx") if isinstance(antennas, dict) else []
        tx = antennas.get("tx") if isinstance(antennas, dict) else []
        label = device.get("label") or device.get("name") or f"device-{idx}"
        driver = device.get("driver", "")
        serial = device.get("serial", "")
        logger.info(
            "%s summary | [%d] label=%s driver=%s serial=%s rx_ports=%d tx_ports=%d",
            probe_name,
            idx,
            label,
            driver,
            serial,
            len(rx) if isinstance(rx, list) else 0,
            len(tx) if isinstance(tx, list) else 0,
        )


def _compact_soapy_device_rows(sdrs: Any, max_items: int = 12) -> str:
    if not isinstance(sdrs, list):
        return "-"

    rows = []
    for idx, sdr in enumerate(sdrs, start=1):
        if not isinstance(sdr, dict):
            rows.append(f"#{idx}=invalid")
            continue
        raw_antennas = sdr.get("antennas")
        if isinstance(raw_antennas, dict):
            rx_ports = raw_antennas.get("rx", [])
            tx_ports = raw_antennas.get("tx", [])
        else:
            rx_ports = []
            tx_ports = []
        rx_count = len(rx_ports) if isinstance(rx_ports, list) else 0
        tx_count = len(tx_ports) if isinstance(tx_ports, list) else 0
        label = str(sdr.get("label", sdr.get("driver", f"SDR #{idx}")) or f"SDR #{idx}").strip()
        serial = str(sdr.get("serial", "") or "").strip()
        serial_short = serial[-6:] if serial else "-"
        rows.append(f"{label}[{serial_short}]={rx_count}/{tx_count}")

    if len(rows) > max_items:
        extra = len(rows) - max_items
        rows = rows[:max_items] + [f"...(+{extra})"]
    return ", ".join(rows) if rows else "-"


async def get_local_soapy_sdr_devices():
    """Retrieve a list of local SoapySDR devices with frequency range information"""

    reply: Dict[str, Union[bool, dict, list, str, None]] = {
        "success": None,
        "data": None,
        "error": None,
    }

    try:
        logger.info("Probing local SoapySDR devices...")
        probe_name = "local-soapy-probe"
        probe_process = await asyncio.create_subprocess_exec(
            sys.executable,
            "-c",
            "from hardware.soapyenum import probe_available_usb_sdrs;"
            "import json; print(probe_available_usb_sdrs())",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )

        try:
            stdout, stderr = await communicate_sdr_probe(probe_process, timeout=35)
            stdout_text = _decode_subprocess_output(stdout)
            stderr_text = _decode_subprocess_output(stderr)

            if probe_process.returncode not in (0, None):
                logger.error(
                    "%s exited with return code %s",
                    probe_name,
                    probe_process.returncode,
                )
            _log_probe_stderr(probe_name, stderr_text)

            if not stdout_text:
                raise Exception("SoapySDR probe returned empty output")

            try:
                result = json.loads(stdout_text)
            except json.JSONDecodeError as exc:
                logger.error("%s produced invalid JSON: %s", probe_name, str(exc))
                logger.error("%s stdout | %s", probe_name, _truncate_log_payload(stdout_text))
                raise

            _emit_probe_logs(probe_name, result.get("log"))

            if result.get("success"):
                result = result.get("data", [])
            else:
                probe_error = result.get("error") or "Error enumerating local SoapySDR devices"
                raise Exception(probe_error)

            reply["success"] = True
            reply["data"] = result
            logger.info("Detected %d local SoapySDR device(s)", len(result))
            _log_probe_antenna_summary(probe_name, result)

        except asyncio.TimeoutError:
            logger.error("Process timed out while probing USB SDRs")
            reply["success"] = False
            reply["error"] = "Operation timed out after 5 seconds"

    except Exception as e:
        logger.error("Error probing USB SDRs: %s", str(e))
        logger.exception(e)
        reply["success"] = False
        reply["error"] = str(e)

    logger.info("Done probing local SoapySDR devices")
    return reply


async def get_local_rtl_sdr_devices():
    """Retrieve a list of local RTL-SDR devices"""

    reply: Dict[str, Union[bool, dict, list, str, None]] = {
        "success": None,
        "data": None,
        "error": None,
    }

    try:
        logger.info("Probing local RTL-SDR devices...")
        probe_name = "local-rtl-probe"
        probe_process = await asyncio.create_subprocess_exec(
            sys.executable,
            "-c",
            "from hardware.rtlsdrenum import probe_available_rtl_sdrs;"
            "import json; print(probe_available_rtl_sdrs())",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )

        try:
            stdout, stderr = await asyncio.wait_for(probe_process.communicate(), timeout=35)
            stdout_text = _decode_subprocess_output(stdout)
            stderr_text = _decode_subprocess_output(stderr)

            if probe_process.returncode not in (0, None):
                logger.error(
                    "%s exited with return code %s",
                    probe_name,
                    probe_process.returncode,
                )
            _log_probe_stderr(probe_name, stderr_text)

            if not stdout_text:
                raise Exception("RTL-SDR probe returned empty output")

            try:
                result = json.loads(stdout_text)
            except json.JSONDecodeError as exc:
                logger.error("%s produced invalid JSON: %s", probe_name, str(exc))
                logger.error("%s stdout | %s", probe_name, _truncate_log_payload(stdout_text))
                raise

            _emit_probe_logs(probe_name, result.get("log"))

            if result.get("success"):
                result = result.get("data", [])
            else:
                probe_error = result.get("error") or "Error enumerating local RTL-SDR devices"
                raise Exception(probe_error)

            reply["success"] = True
            reply["data"] = result
            logger.info("Detected %d RTL-SDR device(s)", len(result))
            _log_probe_antenna_summary(probe_name, result)

        except asyncio.TimeoutError:
            probe_process.kill()
            logger.error("Process timed out while probing RTL-SDR devices")
            reply["success"] = False
            reply["error"] = "Operation timed out after 5 seconds"

    except Exception as e:
        logger.error("Error probing RTL-SDR devices: %s", str(e))
        logger.exception(e)
        reply["success"] = False
        reply["error"] = str(e)

    logger.info("Done probing local RTL-SDR devices")
    return reply


async def get_local_uhd_devices():
    """Retrieve a list of local UHD/USRP devices"""

    reply: Dict[str, Union[bool, dict, list, str, None]] = {
        "success": None,
        "data": None,
        "error": None,
    }

    try:
        logger.info("Probing local UHD/USRP devices...")
        probe_name = "local-uhd-probe"
        probe_process = await asyncio.create_subprocess_exec(
            sys.executable,
            "-c",
            "from hardware.uhdenum import probe_available_uhd_devices;"
            "import json; print(probe_available_uhd_devices())",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )

        try:
            stdout, stderr = await asyncio.wait_for(probe_process.communicate(), timeout=35)
            stdout_text = _decode_subprocess_output(stdout)
            stderr_text = _decode_subprocess_output(stderr)

            if probe_process.returncode not in (0, None):
                logger.error(
                    "%s exited with return code %s",
                    probe_name,
                    probe_process.returncode,
                )
            _log_probe_stderr(probe_name, stderr_text)

            if not stdout_text:
                raise Exception("UHD probe returned empty output")

            try:
                result = json.loads(stdout_text)
            except json.JSONDecodeError as exc:
                logger.error("%s produced invalid JSON: %s", probe_name, str(exc))
                logger.error("%s stdout | %s", probe_name, _truncate_log_payload(stdout_text))
                raise

            _emit_probe_logs(probe_name, result.get("log"))

            if result.get("success"):
                result = result.get("data", [])
            else:
                probe_error = result.get("error") or "Error enumerating local UHD/USRP devices"
                raise Exception(probe_error)

            reply["success"] = True
            reply["data"] = result
            logger.info("Detected %d local UHD/USRP device(s)", len(result))
            _log_probe_antenna_summary(probe_name, result)

        except asyncio.TimeoutError:
            probe_process.kill()
            logger.error("Process timed out while probing local UHD/USRP devices")
            reply["success"] = False
            reply["error"] = "Operation timed out after 5 seconds"

    except Exception as e:
        logger.error("Error probing local UHD/USRP devices: %s", str(e))
        logger.exception(e)
        reply["success"] = False
        reply["error"] = str(e)

    logger.info("Done probing local UHD/USRP devices")
    return reply


async def get_local_airspy_sdr_devices():
    """Retrieve a list of locally connected native Airspy/Airspy HF+ devices."""

    reply: Dict[str, Union[bool, dict, list, str, None]] = {
        "success": None,
        "data": None,
        "error": None,
    }

    try:
        logger.info("Probing local native Airspy devices...")
        probe_name = "local-airspy-probe"
        probe_process = await asyncio.create_subprocess_exec(
            sys.executable,
            "-c",
            "from hardware.airspyenum import probe_available_airspy_devices;"
            "import json; print(probe_available_airspy_devices())",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )

        try:
            stdout, stderr = await asyncio.wait_for(probe_process.communicate(), timeout=35)
            stdout_text = _decode_subprocess_output(stdout)
            stderr_text = _decode_subprocess_output(stderr)

            if probe_process.returncode not in (0, None):
                logger.error(
                    "%s exited with return code %s",
                    probe_name,
                    probe_process.returncode,
                )
            _log_probe_stderr(probe_name, stderr_text)

            if not stdout_text:
                raise Exception("Airspy probe returned empty output")

            try:
                result = json.loads(stdout_text)
            except json.JSONDecodeError as exc:
                logger.error("%s produced invalid JSON: %s", probe_name, str(exc))
                logger.error("%s stdout | %s", probe_name, _truncate_log_payload(stdout_text))
                raise

            _emit_probe_logs(probe_name, result.get("log"))

            if result.get("success"):
                result = result.get("data", [])
            else:
                probe_error = result.get("error") or "Error enumerating local Airspy devices"
                raise Exception(probe_error)

            reply["success"] = True
            reply["data"] = result
            logger.info("Detected %d local Airspy device(s)", len(result))
            _log_probe_antenna_summary(probe_name, result)

        except asyncio.TimeoutError:
            probe_process.kill()
            logger.error("Process timed out while probing local Airspy devices")
            reply["success"] = False
            reply["error"] = "Operation timed out after 5 seconds"

    except Exception as e:
        logger.error("Error probing local Airspy devices: %s", str(e))
        logger.exception(e)
        reply["success"] = False
        reply["error"] = str(e)

    logger.info("Done probing local Airspy devices")
    return reply


# ============================================================================
# RIGS
# ============================================================================


async def get_rigs(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Union[bool, list]]:
    """Get all radio rigs."""
    async with AsyncSessionLocal() as dbsession:
        logger.debug(f"Getting radio rigs, data: {data}")
        rigs = await crud.hardware.fetch_rigs(dbsession)
        return {"success": rigs["success"], "data": rigs.get("data", [])}


async def submit_rig(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Union[bool, list]]:
    """Add a new rig."""
    async with AsyncSessionLocal() as dbsession:
        logger.debug(f"Adding rig, data: {data}")
        add_reply = await crud.hardware.add_rig(dbsession, data or {})

        rigs = await crud.hardware.fetch_rigs(dbsession)
        if add_reply.get("success"):
            for manager in get_all_tracker_managers().values():
                await manager.notify_hardware_changed(rig_id=add_reply.get("data", {}).get("id"))
        return {
            "success": (rigs["success"] & add_reply["success"]),
            "data": rigs.get("data", []),
        }


async def edit_rig(sio: Any, data: Optional[Dict], logger: Any, sid: str) -> Dict[str, Any]:
    """Edit an existing rig."""
    try:
        hardware.validate_edit("rig", (data or {}).get("id"), data or {})
    except ValueError as error:
        return {"success": False, "error": str(error), "data": []}
    async with AsyncSessionLocal() as dbsession:
        logger.debug(f"Editing rig, data: {data}")
        edit_reply = await crud.hardware.edit_rig(dbsession, data or {})

        rigs = await crud.hardware.fetch_rigs(dbsession)
        if edit_reply.get("success") and data:
            details = await crud.hardware.fetch_rigs(dbsession, rig_id=data.get("id"))
            if details.get("data"):
                await hardware.configure("rig", data.get("id"), details["data"])
            for manager in get_all_tracker_managers().values():
                await manager.notify_hardware_changed(rig_id=data.get("id"))
        return {
            "success": (rigs["success"] & edit_reply["success"]),
            "data": rigs.get("data", []),
        }


async def delete_rig(sio: Any, data: Optional[Dict], logger: Any, sid: str) -> Dict[str, Any]:
    """Delete a rig."""
    identifiers = data if isinstance(data, (list, tuple)) else [(data or {}).get("id")]
    try:
        hardware.validate_delete("rig", identifiers)
    except ValueError as error:
        return {"success": False, "error": str(error), "data": []}
    async with AsyncSessionLocal() as dbsession:
        logger.debug(f"Delete rig, data: {data}")
        delete_reply = await crud.hardware.delete_rig(dbsession, data or {})

        rigs = await crud.hardware.fetch_rigs(dbsession)
        if delete_reply.get("success") and data:
            for identifier in identifiers:
                await hardware.configure("rig", identifier, {})
            if isinstance(data, dict):
                for manager in get_all_tracker_managers().values():
                    await manager.notify_hardware_changed(rig_id=data.get("id"))
            elif isinstance(data, (list, tuple)):
                for rig_id in data:
                    for manager in get_all_tracker_managers().values():
                        await manager.notify_hardware_changed(rig_id=rig_id)
        return {
            "success": (rigs["success"] & delete_reply["success"]),
            "data": rigs.get("data", []),
        }


# ============================================================================
# ROTATORS
# ============================================================================


async def get_rotators(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Union[bool, list]]:
    """Get all antenna rotators."""
    async with AsyncSessionLocal() as dbsession:
        logger.debug(f"Getting antenna rotators, data: {data}")
        rotators = await crud.hardware.fetch_rotators(dbsession)
        return {"success": rotators["success"], "data": rotators.get("data", [])}


async def submit_rotator(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Union[bool, list]]:
    """Add a new rotator."""
    async with AsyncSessionLocal() as dbsession:
        logger.debug(f"Adding rotator, data: {data}")
        add_reply = await crud.hardware.add_rotator(dbsession, data or {})

        rotators = await crud.hardware.fetch_rotators(dbsession)
        if add_reply.get("success"):
            for manager in get_all_tracker_managers().values():
                await manager.notify_hardware_changed(
                    rotator_id=add_reply.get("data", {}).get("id")
                )
        return {
            "success": (rotators["success"] & add_reply["success"]),
            "data": rotators.get("data", []),
        }


async def edit_rotator(sio: Any, data: Optional[Dict], logger: Any, sid: str) -> Dict[str, Any]:
    """Edit an existing rotator."""
    try:
        hardware.validate_edit("rotator", (data or {}).get("id"), data or {})
    except ValueError as error:
        return {"success": False, "error": str(error), "data": []}
    async with AsyncSessionLocal() as dbsession:
        logger.debug(f"Editing rotator, data: {data}")
        # CRUD normalizes a mutable payload. Keep the handler copy intact so the
        # active tracker can be notified with the edited rotator ID afterwards.
        edit_reply = await crud.hardware.edit_rotator(dbsession, dict(data or {}))
        logger.debug(f"Edit rotator reply: {edit_reply}")

        rotators = await crud.hardware.fetch_rotators(dbsession)
        logger.debug(f"Rotators: {rotators}")
        if edit_reply.get("success") and data:
            details = await crud.hardware.fetch_rotators(dbsession, rotator_id=data.get("id"))
            if details.get("data"):
                await hardware.configure("rotator", data.get("id"), details["data"])
            for manager in get_all_tracker_managers().values():
                await manager.notify_hardware_changed(rotator_id=data.get("id"))
        return {
            "success": (rotators["success"] & edit_reply["success"]),
            "data": rotators.get("data", []),
        }


async def delete_rotator(sio: Any, data: Optional[Dict], logger: Any, sid: str) -> Dict[str, Any]:
    """Delete rotators."""
    identifiers = data if isinstance(data, (list, tuple)) else [(data or {}).get("id")]
    try:
        hardware.validate_delete("rotator", identifiers)
    except ValueError as error:
        return {"success": False, "error": str(error), "data": []}
    async with AsyncSessionLocal() as dbsession:
        logger.debug(f"Delete rotator, data: {data}")
        delete_reply = await crud.hardware.delete_rotators(dbsession, data or {})

        rotators = await crud.hardware.fetch_rotators(dbsession)
        if delete_reply.get("success") and data:
            for identifier in identifiers:
                await hardware.configure("rotator", identifier, {})
            if isinstance(data, dict):
                for manager in get_all_tracker_managers().values():
                    await manager.notify_hardware_changed(rotator_id=data.get("id"))
            elif isinstance(data, (list, tuple)):
                for rotator_id in data:
                    for manager in get_all_tracker_managers().values():
                        await manager.notify_hardware_changed(rotator_id=rotator_id)
        return {
            "success": (rotators["success"] & delete_reply["success"]),
            "data": rotators.get("data", []),
        }


async def nudge_rotator(sio: Any, data: Optional[Dict], logger: Any, sid: str) -> Dict[str, Any]:
    """Nudge rotator position."""
    logger.info(f"Nudging rotator, data: {data}")
    cmd = data.get("cmd", None) if data else None
    if not isinstance(cmd, str) or not cmd:
        return {"success": False, "error": "A rotator command is required", "data": None}
    try:
        tracker_id = require_tracker_id((data or {}).get("tracker_id"))
    except InvalidTrackerIdError:
        return {
            "success": False,
            "error": "tracker_id_required",
            "message": "tracker_id is required",
            "data": None,
        }
    manager = get_tracker_manager(tracker_id)
    manager.send_command(cmd, data=None)
    return {"success": True, "data": None}


async def move_rotator(sio: Any, data: Optional[Dict], logger: Any, sid: str) -> Dict[str, Any]:
    async with operations.lock:
        try:
            existing = operations.existing(
                (data or {}).get("command_id"), (data or {}).get("tracker_id", "")
            )
            if existing:
                return {"success": True, "data": {"command": existing}}
            return await _move_rotator(sio, data, logger, sid)
        except ValueError as exc:
            return {"success": False, "message": str(exc)}


async def _move_rotator(sio: Any, data: Optional[Dict], logger: Any, sid: str) -> Dict[str, Any]:
    """Queue one validated absolute rotator move for a non-tracking mount."""
    del sio, sid
    try:
        tracker_id = require_tracker_id((data or {}).get("tracker_id"))
    except InvalidTrackerIdError:
        return {
            "success": False,
            "error": "tracker_id_required",
            "message": "tracker_id is required",
            "data": None,
        }

    target_az_value = (data or {}).get("az")
    target_el_value = (data or {}).get("el")
    if target_az_value is None or target_el_value is None:
        return {
            "success": False,
            "error": "invalid_rotator_position",
            "message": "az and el must be numeric values",
            "data": None,
        }
    try:
        target_az = float(target_az_value)
        target_el = float(target_el_value)
    except (TypeError, ValueError):
        return {
            "success": False,
            "error": "invalid_rotator_position",
            "message": "az and el must be numeric values",
            "data": None,
        }
    if not math.isfinite(target_az) or not math.isfinite(target_el):
        return {
            "success": False,
            "error": "invalid_rotator_position",
            "message": "az and el must be finite values",
            "data": None,
        }

    manager = get_existing_tracker_manager(tracker_id)
    if manager is None:
        return {
            "success": False,
            "error": "tracker_not_available",
            "message": "The selected tracker is not available",
            "data": None,
        }
    tracker_instances = get_tracker_instances_payload().get("instances", [])
    tracker_instance = next(
        (instance for instance in tracker_instances if instance.get("tracker_id") == tracker_id),
        None,
    )
    if not tracker_instance or not tracker_instance.get("is_alive"):
        return {
            "success": False,
            "error": "tracker_not_available",
            "message": "The selected tracker is not running",
            "data": None,
        }
    tracking_state = await manager.get_tracking_state()
    if not tracking_state:
        return {
            "success": False,
            "error": "tracking_state_not_available",
            "message": "The selected tracker has no tracking state",
            "data": None,
        }
    if tracking_state.get("rotator_state") == "tracking":
        return {
            "success": False,
            "error": "rotator_is_tracking",
            "message": "Stop automatic tracking before manually moving the rotator",
            "data": None,
        }
    if tracking_state.get("rotator_state") == "parked":
        return {
            "success": False,
            "error": "rotator_is_parked",
            "message": "Unpark the rotator before manually moving it",
            "data": None,
        }
    rotator_id = tracking_state.get("rotator_id")
    if not rotator_id or str(rotator_id).strip().lower() == "none":
        return {
            "success": False,
            "error": "rotator_not_selected",
            "message": "Select a rotator before using manual control",
            "data": None,
        }
    if tracking_state.get("rotator_state") == "disconnected":
        return {
            "success": False,
            "error": "rotator_not_connected",
            "message": "Connect the rotator before using manual control",
            "data": None,
        }

    async with AsyncSessionLocal() as dbsession:
        rotator_reply = await crud.hardware.fetch_rotators(dbsession, rotator_id=rotator_id)
    rotator = rotator_reply.get("data") if rotator_reply.get("success") else None
    if not isinstance(rotator, dict):
        return {
            "success": False,
            "error": "rotator_not_found",
            "message": "The selected rotator could not be found",
            "data": None,
        }
    minaz_value, maxaz_value = rotator.get("minaz"), rotator.get("maxaz")
    minel_value, maxel_value = rotator.get("minel"), rotator.get("maxel")
    if not (
        isinstance(minaz_value, (int, float))
        and isinstance(maxaz_value, (int, float))
        and isinstance(minel_value, (int, float))
        and isinstance(maxel_value, (int, float))
    ):
        return {
            "success": False,
            "error": "invalid_rotator_limits",
            "message": "The selected rotator has invalid configured limits",
            "data": None,
        }
    minaz, maxaz = float(minaz_value), float(maxaz_value)
    minel, maxel = float(minel_value), float(maxel_value)
    # The 360–450° overlap lane supports automatic tracking decisions only.
    # Operator-entered positions always use conventional 0–360° azimuth.
    manual_maxaz = min(maxaz, 360) if rotator.get("azimuth_mode") == "0_450" else maxaz
    if not (minaz <= target_az <= manual_maxaz and minel <= target_el <= maxel):
        return {
            "success": False,
            "error": "rotator_position_out_of_bounds",
            "message": "The requested position is outside the configured rotator limits",
            "data": {"minaz": minaz, "maxaz": manual_maxaz, "minel": minel, "maxel": maxel},
        }

    request = {**(data or {}), "action": "move", "position": {"az": target_az, "el": target_el}}
    validate_external_request(request, operations.epoch)
    operation = operations.accept(tracker_id, {}, tracking_state, request)
    manager.send_command(
        TrackerCommands.MOVE_TO_POSITION,
        data={"az": target_az, "el": target_el, "operation": operation},
    )
    return {"success": True, "data": {"command": operation}}


async def stop_rotator(sio: Any, data: Optional[Dict], logger: Any, sid: str) -> Dict[str, Any]:
    async with operations.lock:
        try:
            existing = operations.existing(
                (data or {}).get("command_id"), (data or {}).get("tracker_id", "")
            )
            if existing:
                return {"success": True, "data": {"command": existing}}
            return await _stop_rotator(sio, data, logger, sid)
        except ValueError as exc:
            return {"success": False, "message": str(exc)}


async def _stop_rotator(sio: Any, data: Optional[Dict], logger: Any, sid: str) -> Dict[str, Any]:
    """Request a physical stop for a manually controlled rotator."""
    del sio, logger, sid
    try:
        tracker_id = require_tracker_id((data or {}).get("tracker_id"))
    except InvalidTrackerIdError:
        return {
            "success": False,
            "error": "tracker_id_required",
            "message": "tracker_id is required",
            "data": None,
        }

    manager = get_existing_tracker_manager(tracker_id)
    if manager is None:
        return {
            "success": False,
            "error": "tracker_not_available",
            "message": "The selected tracker is not available",
            "data": None,
        }
    tracker_instances = get_tracker_instances_payload().get("instances", [])
    tracker_instance = next(
        (instance for instance in tracker_instances if instance.get("tracker_id") == tracker_id),
        None,
    )
    if not tracker_instance or not tracker_instance.get("is_alive"):
        return {
            "success": False,
            "error": "tracker_not_available",
            "message": "The selected tracker is not running",
            "data": None,
        }
    tracking_state = await manager.get_tracking_state()
    if not tracking_state:
        return {
            "success": False,
            "error": "tracking_state_not_available",
            "message": "The selected tracker has no tracking state",
            "data": None,
        }
    rotator_id = tracking_state.get("rotator_id")
    if not rotator_id or str(rotator_id).strip().lower() == "none":
        return {
            "success": False,
            "error": "rotator_not_selected",
            "message": "Select a rotator before using manual control",
            "data": None,
        }
    if tracking_state.get("rotator_state") == "disconnected":
        return {
            "success": False,
            "error": "rotator_not_connected",
            "message": "Connect the rotator before using manual control",
            "data": None,
        }

    updated = {**tracking_state, "rotator_state": "stopped"}
    validate_external_request(data, operations.epoch)
    operation = operations.accept(
        tracker_id, {"rotator_state": "stopped"}, updated, {**(data or {}), "action": "stop"}
    )
    async with AsyncSessionLocal() as dbsession:
        reply = await crud.trackingstate.set_tracking_state(
            dbsession,
            {"name": get_tracking_state_name(tracker_id), "value": updated},
        )
    if not reply.get("success"):
        operations.update(operation["command_id"], "failed", "Could not persist Stop")
        return {"success": False, "message": "Could not persist Stop"}
    manager.current_tracking_state = updated
    manager.send_command(TrackerCommands.STOP_ROTATOR, data={"operation": operation})
    return {"success": True, "data": {"command": operation}}


# ============================================================================
# CAMERAS
# ============================================================================


async def get_cameras(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Union[bool, list]]:
    """Get all cameras."""
    async with AsyncSessionLocal() as dbsession:
        logger.debug(f"Getting cameras, data: {data}")
        cameras = await crud.hardware.fetch_cameras(dbsession)
        return {"success": cameras["success"], "data": cameras.get("data", [])}


async def submit_camera(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Union[bool, list]]:
    """Add a new camera."""
    async with AsyncSessionLocal() as dbsession:
        logger.debug(f"Adding camera, data: {data}")
        add_reply = await crud.hardware.add_camera(dbsession, data or {})

        cameras = await crud.hardware.fetch_cameras(dbsession)
        return {
            "success": (cameras["success"] & add_reply["success"]),
            "data": cameras.get("data", []),
        }


async def edit_camera(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Union[bool, list]]:
    """Edit an existing camera."""
    async with AsyncSessionLocal() as dbsession:
        logger.debug(f"Editing camera, data: {data}")
        edit_reply = await crud.hardware.edit_camera(dbsession, data or {})
        logger.debug(f"Edit camera reply: {edit_reply}")

        cameras = await crud.hardware.fetch_cameras(dbsession)
        logger.debug(f"Cameras: {cameras}")
        return {
            "success": (cameras["success"] & edit_reply["success"]),
            "data": cameras.get("data", []),
        }


async def delete_camera(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Union[bool, list]]:
    """Delete cameras."""
    async with AsyncSessionLocal() as dbsession:
        logger.debug(f"Delete camera, data: {data}")
        delete_reply = await crud.hardware.delete_cameras(dbsession, data or {})

        cameras = await crud.hardware.fetch_cameras(dbsession)
        return {
            "success": (cameras["success"] & delete_reply["success"]),
            "data": cameras.get("data", []),
        }


# ============================================================================
# SDRs
# ============================================================================


async def get_sdrs(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Union[bool, list]]:
    """Get all SDRs."""
    async with AsyncSessionLocal() as dbsession:
        logger.debug(f"Getting SDRs, data: {data}")
        sdrs = await crud.hardware.fetch_sdrs(dbsession)

        # Add hardcoded SigMF Playback SDR for recording playback
        sdrs_list = sdrs.get("data", [])
        sigmf_playback_sdr = {
            "id": "sigmf-playback",
            "name": "SigMF Playback",
            "type": "sigmfplayback",
            "driver": "sigmfplayback",
            "serial": None,
            "host": None,
            "port": None,
            "frequency_min": 0,
            "frequency_max": 6000000000,
        }
        sdrs_list.append(sigmf_playback_sdr)

        return {"success": sdrs["success"], "data": sdrs_list}


async def submit_sdr(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Union[bool, list]]:
    """Add a new SDR."""
    async with AsyncSessionLocal() as dbsession:
        logger.debug(f"Adding SDR, data: {data}")
        add_reply = await crud.hardware.add_sdr(dbsession, data or {})
        logger.info(add_reply)

        sdrs = await crud.hardware.fetch_sdrs(dbsession)
        if add_reply.get("success"):
            for manager in get_all_tracker_managers().values():
                await manager.notify_hardware_changed(rig_id=add_reply.get("data", {}).get("id"))

        return {
            "success": (sdrs["success"] & add_reply["success"]),
            "data": sdrs.get("data", []),
        }


async def edit_sdr(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Union[bool, list]]:
    """Edit an existing SDR."""
    async with AsyncSessionLocal() as dbsession:
        logger.debug(f"Editing SDR, data: {data}")
        # Serialize the database change and invalidation with a pending probe.
        # Otherwise that probe could repopulate capabilities for the old device.
        async with sdr_parameter_lock(str((data or {}).get("id"))):
            edit_reply = await crud.hardware.edit_sdr(dbsession, data or {})
            if edit_reply.get("success") and data:
                invalidate_sdr_parameters(str(data.get("id")))
        logger.debug(f"Edit SDR reply: {edit_reply}")

        sdrs = await crud.hardware.fetch_sdrs(dbsession)
        logger.debug(f"SDRs: {sdrs}")
        if edit_reply.get("success") and data:
            for manager in get_all_tracker_managers().values():
                await manager.notify_hardware_changed(rig_id=data.get("id"))
        return {
            "success": (sdrs["success"] & edit_reply["success"]),
            "data": sdrs.get("data", []),
        }


async def delete_sdr(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Union[bool, list, str]]:
    """Delete SDRs."""
    async with AsyncSessionLocal() as dbsession:
        logger.debug(f"Delete SDR, data: {data}")
        if not data:
            return {"success": False, "data": [], "error": "No data provided"}

        sdr_ids = list(data)
        # Acquire multiple gates in a stable order so a concurrent delete cannot
        # deadlock or leave a completed probe's stale result in the cache.
        async with AsyncExitStack() as locks:
            for sdr_id in sorted({str(sdr_id) for sdr_id in sdr_ids}):
                await locks.enter_async_context(sdr_parameter_lock(sdr_id))
            delete_reply = await crud.hardware.delete_sdrs(dbsession, sdr_ids)
            if delete_reply.get("success"):
                for sdr_id in sdr_ids:
                    invalidate_sdr_parameters(str(sdr_id))

        sdrs = await crud.hardware.fetch_sdrs(dbsession)
        if delete_reply.get("success"):
            for sdr_id in sdr_ids:
                for manager in get_all_tracker_managers().values():
                    await manager.notify_hardware_changed(rig_id=sdr_id)
        return {
            "success": (sdrs["success"] & delete_reply["success"]),
            "data": sdrs.get("data", []),
        }


async def query_soapy_server(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Any]:
    """Enumerate one user-specified endpoint without requiring an mDNS advertisement."""
    if not isinstance(data, dict) or not isinstance(data.get("host"), str):
        return {"success": False, "error": "A server hostname or IP address is required"}
    host = data["host"].strip()
    if not host or "://" in host or any(character.isspace() for character in host):
        return {"success": False, "error": "Enter a server hostname or IP address without a URL"}
    try:
        port = int(str(data.get("port", 55132)))
    except (TypeError, ValueError):
        return {"success": False, "error": "A valid remote port (1–65535) is required"}
    if not 1 <= port <= 65535:
        return {"success": False, "error": "A valid remote port (1–65535) is required"}

    gate = sdr_hardware_lock({"type": "soapysdrremote", "host": host, "port": port})
    if gate.locked():
        return {"success": False, "error": "Server is busy. Wait and try again."}
    # Share the endpoint gate with probes and receiver startup. Enumeration does
    # not open a device, so an established stream can continue running.
    async with gate:
        try:
            devices, status = await asyncio.wait_for(query_server_for_sdrs(host, port), timeout=10)
        except asyncio.TimeoutError:
            return {
                "success": False,
                "error": "Server query timed out. Check the connection and retry.",
            }
        except Exception as exc:
            logger.warning("Manual SoapySDR server query failed: %s", exc)
            return {"success": False, "error": "Could not query the SoapySDR server. Try again."}

    if status != "active":
        errors = {
            "unreachable": "Could not connect to the server. Check its hostname and port, then retry.",
            "timeout": "Server query timed out. Check the connection and retry.",
            "unavailable": "SoapySDR Python bindings are not installed on the backend.",
        }
        return {
            "success": False,
            "error": errors.get(status, "Could not list the server's SDR devices. Try again."),
        }
    # Return draft results to the requesting client; discovery owns its own cache.
    return {
        "success": True,
        "data": {"ip": host, "port": port, "name": host, "status": status, "sdrs": devices},
    }


async def get_soapy_servers(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Union[bool, dict]]:
    """Get discovered SoapySDR servers."""
    logger.info("Getting discovered SoapySDR servers | servers=%d", len(discovered_servers))
    for server_name, server_info in discovered_servers.items():
        sdrs = server_info.get("sdrs", []) if isinstance(server_info, dict) else []
        sdr_count = len(sdrs) if isinstance(sdrs, list) else 0
        rx_ready = 0
        tx_ready = 0
        if isinstance(sdrs, list):
            for sdr in sdrs:
                if not isinstance(sdr, dict):
                    continue
                raw_antennas = sdr.get("antennas")
                if isinstance(raw_antennas, dict):
                    rx_ports = raw_antennas.get("rx", [])
                    tx_ports = raw_antennas.get("tx", [])
                else:
                    rx_ports = []
                    tx_ports = []
                if isinstance(rx_ports, list) and rx_ports:
                    rx_ready += 1
                if isinstance(tx_ports, list) and tx_ports:
                    tx_ready += 1

        logger.info(
            "Soapy server payload summary | name=%s ip=%s port=%s status=%s sdrs=%d rx_ready=%d tx_ready=%d rows=%s",
            server_name,
            server_info.get("ip") if isinstance(server_info, dict) else "",
            server_info.get("port") if isinstance(server_info, dict) else "",
            server_info.get("status") if isinstance(server_info, dict) else "",
            sdr_count,
            rx_ready,
            tx_ready,
            _compact_soapy_device_rows(sdrs),
        )
    return {"success": True, "data": discovered_servers}


async def get_sdr_parameters(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Union[bool, None, dict, list, str]]:
    """Get SDR parameters."""
    sdr_id = str(data or "")
    recording_path = (
        (active_sdr_clients.get(background_sessions.resolve(sid)) or {}).get("recording_path")
        if sdr_id == "sigmf-playback"
        else None
    )
    # The same lock covers the first worker start. A browser probe waits for a
    # pending startup probe and cannot open a second device after streaming starts.
    async with sdr_parameter_lock(sdr_id):
        cached = get_cached_sdr_parameters(sdr_id, recording_path)
        if cached is not None:
            return {"success": True, "data": cached, "error": None}
        manager = runtimestate.process_manager
        if sdr_id != "sigmf-playback" and manager and manager.is_sdr_process_running(sdr_id):
            # The saved SDR may have changed while its old worker remains active.
            # Its capability snapshot still describes what viewers are watching.
            active_parameters = (
                (getattr(manager, "processes", {}) or {}).get(sdr_id, {}).get("parameters")
            )
            if active_parameters is not None:
                return {"success": True, "data": active_parameters, "error": None}
            return {
                "success": False,
                "data": None,
                "error": "SDR is streaming and no cached capabilities are available",
            }
        async with AsyncSessionLocal() as dbsession:
            logger.debug("Getting SDR parameters")
            # Resolve the endpoint while holding the definition lock. Unsaved
            # manual probes share this gate even when they have no SDR ID.
            if sdr_id == "sigmf-playback":
                device: Dict[str, Any] = {"id": sdr_id}
            else:
                saved = await crud.hardware.fetch_sdr(dbsession, sdr_id)
                saved_device = saved.get("data")
                if not saved_device:
                    return {"success": False, "data": None, "error": "SDR device not found"}
                device = saved_device
            async with sdr_hardware_lock(device):
                parameters = await probe_sdr_parameters(
                    dbsession, sdr_id, recording_path=recording_path
                )
            return {
                "success": parameters["success"],
                "data": parameters.get("data", []),
                "error": parameters.get("error", None),
            }


async def probe_sdr(sio: Any, data: Optional[Dict], logger: Any, sid: str) -> Dict[str, Any]:
    """Explicitly probe a saved or draft Soapy SDR without changing its definition."""
    if not isinstance(data, dict) or data.get("type") not in {"soapysdrremote", "soapysdrlocal"}:
        return {"success": False, "error": "Select a SoapySDR device to probe"}
    # Only connection fields belong in a hardware probe. In particular, do not
    # replace a saved definition with an unsaved name or custom antenna labels.
    device: Dict[str, Any] = {
        key: str(data.get(key) or "").strip() for key in ("type", "host", "driver", "serial")
    }
    if not device["driver"]:
        return {"success": False, "error": "A driver is required to probe the selected SDR"}
    if device["type"] == "soapysdrremote":
        try:
            device["port"] = int(data.get("port") or 0)
        except (TypeError, ValueError):
            return {"success": False, "error": "A valid remote port is required"}
        if not device["host"] or not 1 <= device["port"] <= 65535:
            return {"success": False, "error": "A host and port (1–65535) are required"}
    device["name"] = str(data.get("name") or "SoapySDR")
    sdr_id = str(data.get("id") or "")
    gate = sdr_hardware_lock(device)
    # Use the same ID-then-endpoint lock order as waterfall reads and startup.
    # Reject duplicate clicks before waiting rather than opening a second handle.
    async with AsyncExitStack() as locks:
        if sdr_id:
            definition_lock = sdr_parameter_lock(sdr_id)
            if definition_lock.locked():
                return {
                    "success": False,
                    "error": "SDR hardware is busy. Wait for the current operation to finish.",
                }
            await locks.enter_async_context(definition_lock)
        if gate.locked():
            return {
                "success": False,
                "error": "SDR hardware is busy. Wait for the current operation to finish.",
            }
        await locks.enter_async_context(gate)
        manager = runtimestate.process_manager
        for running_id, info in (getattr(manager, "processes", {}) or {}).items():
            if not manager.is_sdr_process_running(running_id):
                continue
            running_device = info.get("device") or {}
            if str(running_id) == sdr_id or _same_soapy_endpoint(device, running_device):
                if _same_soapy_device(device, running_device):
                    parameters = info.get("parameters") or get_cached_sdr_parameters(running_id)
                    if parameters is not None:
                        return {"success": True, "data": parameters, "cached": True}
                return {
                    "success": False,
                    "error": "Stop the active SDR stream before probing this hardware.",
                }
        try:
            parameters = await probe_soapy_parameters(device)
            # Only warm the saved cache when the probed connection still matches
            # the database. Draft edits must never poison a running user's cache.
            if sdr_id:
                async with AsyncSessionLocal() as dbsession:
                    saved = await crud.hardware.fetch_sdr(dbsession, sdr_id)
                if saved.get("data") and _same_soapy_device(device, saved["data"]):
                    cache_sdr_parameters(sdr_id, parameters)
            return {"success": True, "data": parameters, "cached": False}
        except asyncio.TimeoutError:
            return {
                "success": False,
                "error": "Timed out while probing the SDR. Check its connection and try again.",
            }
        except Exception as exc:
            logger.warning("Explicit SoapySDR probe failed: %s", exc)
            return {"success": False, "error": str(exc)}

    # AsyncExitStack may suppress an exception, so keep the response explicit.
    return {"success": False, "error": "SDR probe ended without a result"}


def _same_soapy_endpoint(first: Dict, second: Dict) -> bool:
    if first.get("type") != second.get("type"):
        return False
    if first.get("type") == "soapysdrlocal":
        return True
    # Be conservative with servers whose drivers serialize access across radios.
    return str(first.get("host") or "").strip().lower() == str(
        second.get("host") or ""
    ).strip().lower() and str(first.get("port") or 55132) == str(second.get("port") or 55132)


def _same_soapy_device(first: Dict, second: Dict) -> bool:
    return _same_soapy_endpoint(first, second) and all(
        str(first.get(key) or "").strip() == str(second.get(key) or "").strip()
        for key in ("driver", "serial")
    )


async def get_local_soapy_sdr_devices_handler(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Union[bool, list, str]]:
    """Get local SoapySDR devices."""
    logger.debug("Getting local SoapySDR devices")
    async with sdr_hardware_lock({"type": "soapysdrlocal"}):
        manager = runtimestate.process_manager
        for sdr_id, info in (getattr(manager, "processes", {}) or {}).items():
            if (info.get("device") or {}).get(
                "type"
            ) == "soapysdrlocal" and manager.is_sdr_process_running(sdr_id):
                return {
                    "success": False,
                    "data": [],
                    "error": "Stop local SoapySDR streams before discovering local devices.",
                }
        devices = await get_local_soapy_sdr_devices()
    return {
        "success": devices["success"],
        "data": devices["data"],
        "error": devices["error"],
    }


async def get_local_rtl_sdr_devices_handler(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Union[bool, list, str]]:
    """Get local RTL-SDR devices."""
    logger.debug("Getting local RTL-SDR devices")
    devices = await get_local_rtl_sdr_devices()
    return {
        "success": devices["success"],
        "data": devices["data"],
        "error": devices["error"],
    }


async def get_local_uhd_devices_handler(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Union[bool, list, str]]:
    """Get local UHD/USRP devices."""
    logger.debug("Getting local UHD/USRP devices")
    devices = await get_local_uhd_devices()
    return {
        "success": devices["success"],
        "data": devices["data"],
        "error": devices["error"],
    }


async def get_local_airspy_devices_handler(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Union[bool, list, str]]:
    """Get local native Airspy devices."""
    logger.debug("Getting local native Airspy devices")
    devices = await get_local_airspy_sdr_devices()
    return {
        "success": devices["success"],
        "data": devices["data"],
        "error": devices["error"],
    }


async def get_hardware_state(sio, data, logger, sid):
    return {
        "success": True,
        "data": {
            "epoch": operations.epoch,
            "server_time": time.time(),
            "devices": hardware.snapshots(),
            "commands": [
                row
                for row in operations.snapshot()["commands"]
                if row["tracker_id"].startswith("manual:")
            ],
        },
    }


async def control_hardware(sio, data, logger, sid):
    payload = data or {}
    kind, device_id = payload.get("kind"), str(payload.get("device_id") or "")
    if kind not in {"rotator", "rig"} or not device_id:
        return {"success": False, "error": "A device kind and ID are required"}
    try:
        async with AsyncSessionLocal() as session:
            fetch = crud.hardware.fetch_rotators if kind == "rotator" else crud.hardware.fetch_rigs
            reply = await fetch(session, **{f"{kind}_id": device_id})
        if not reply.get("success") or not reply.get("data"):
            return {"success": False, "error": "Device configuration was not found"}
        command = await submit_device_command(
            kind, device_id, payload.get("action"), reply["data"], payload
        )
        return {"success": True, "data": {"command": command}}
    except (ValueError, RuntimeError) as error:
        return {"success": False, "error": str(error)}


def register_handlers(registry):
    """Register hardware handlers with the command registry."""
    registry.register_batch(
        {
            "get-hardware-state": (get_hardware_state, "api_call"),
            "control-hardware": (control_hardware, "api_call"),
            # Rigs
            "get-rigs": (get_rigs, "api_call"),
            "submit-rig": (submit_rig, "api_call"),
            "edit-rig": (edit_rig, "api_call"),
            "delete-rig": (delete_rig, "api_call"),
            # Rotators
            "get-rotators": (get_rotators, "api_call"),
            "submit-rotator": (submit_rotator, "api_call"),
            "edit-rotator": (edit_rotator, "api_call"),
            "delete-rotator": (delete_rotator, "api_call"),
            "nudge-rotator": (nudge_rotator, "api_call"),
            "move-rotator": (move_rotator, "api_call"),
            "stop-rotator": (stop_rotator, "api_call"),
            # Cameras
            "get-cameras": (get_cameras, "api_call"),
            "submit-camera": (submit_camera, "api_call"),
            "edit-camera": (edit_camera, "api_call"),
            "delete-camera": (delete_camera, "api_call"),
            # SDRs
            "get-sdrs": (get_sdrs, "api_call"),
            "submit-sdr": (submit_sdr, "api_call"),
            "edit-sdr": (edit_sdr, "api_call"),
            "delete-sdr": (delete_sdr, "api_call"),
            "get-soapy-servers": (get_soapy_servers, "api_call"),
            "query-soapy-server": (query_soapy_server, "api_call"),
            "get-sdr-parameters": (get_sdr_parameters, "api_call"),
            "probe-sdr": (probe_sdr, "api_call"),
            "get-local-soapy-sdr-devices": (get_local_soapy_sdr_devices_handler, "api_call"),
            "get-local-rtl-sdr-devices": (get_local_rtl_sdr_devices_handler, "api_call"),
            "get-local-uhd-devices": (get_local_uhd_devices_handler, "api_call"),
            "get-local-airspy-devices": (get_local_airspy_devices_handler, "api_call"),
        }
    )
