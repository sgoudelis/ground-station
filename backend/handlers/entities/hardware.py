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
from bisect import bisect_left
from typing import Any, Dict, Optional, Union

import crud
from db import AsyncSessionLocal
from hardware.soapysdrbrowser import discovered_servers
from session.service import active_sdr_clients
from tracker.contracts import InvalidTrackerIdError, require_tracker_id
from tracker.runner import get_all_tracker_managers, get_tracker_manager
from workers.common import window_functions

logger = logging.getLogger("hardware-handler")

# Create a cache dictionary to store SDR parameters by SDR ID
sdr_parameters_cache: Dict[str, Dict] = {}


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


def _nearest_rate(sorted_rates: list[float], target: float) -> float:
    if not sorted_rates:
        return target
    idx = bisect_left(sorted_rates, target)
    if idx <= 0:
        return sorted_rates[0]
    if idx >= len(sorted_rates):
        return sorted_rates[-1]
    before = sorted_rates[idx - 1]
    after = sorted_rates[idx]
    return after if abs(after - target) < abs(target - before) else before


def _select_neat_sample_rates(rates: list[float]) -> list[float]:
    clean_rates = sorted({float(r) for r in rates if r and r > 0})
    if len(clean_rates) <= 50:
        return clean_rates

    min_rate = clean_rates[0]
    max_rate = clean_rates[-1]
    log_min = math.log10(min_rate)
    log_max = math.log10(max_rate)

    selected: set[float] = set()
    targets: list[float] = []
    for exp in range(int(math.floor(log_min)), int(math.ceil(log_max)) + 1):
        for base in (1.0, 2.0, 2.5, 5.0):
            target = base * (10**exp)
            if min_rate <= target <= max_rate:
                targets.append(target)

    for target in targets:
        nearest = _nearest_rate(clean_rates, target)
        tolerance = max(target * 0.01, 1.0)
        if abs(nearest - target) <= tolerance:
            selected.add(nearest)

    selected.add(min_rate)
    selected.add(max_rate)

    if len(selected) < 20:
        for i in range(20):
            target = 10 ** (log_min + (log_max - log_min) * (i / 19))
            selected.add(_nearest_rate(clean_rates, target))

    return sorted(selected)


def _strip_sample_rate_ranges(capabilities: Dict[str, Any]) -> Dict[str, Any]:
    if not isinstance(capabilities, dict):
        return capabilities
    sanitized = dict(capabilities)
    sanitized.pop("sample_rate_ranges", None)
    return sanitized


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
            probe_process.kill()
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


async def _fetch_sdr_parameters(dbsession, sdr_id, timeout=30.0):
    """Retrieve SDR parameters from the SDR process manager with caching"""

    reply: Dict[str, Union[bool, None, dict, list, str]] = {
        "success": None,
        "data": None,
        "error": None,
    }
    sdr = {}
    sdr_params = {}

    # Check if parameters for this SDR are already cached
    # For sigmfplayback, don't use cache since recording_path may have changed
    if sdr_id in sdr_parameters_cache and sdr_id != "sigmf-playback":
        logger.info("Using cached parameters for SDR with id %s", sdr_id)
        return {"success": True, "data": sdr_parameters_cache[sdr_id]}
    elif sdr_id == "sigmf-playback" and sdr_id in sdr_parameters_cache:
        logger.info("Skipping cache for sigmfplayback SDR, will re-probe")

    try:
        # Handle hardcoded SigMF playback SDR
        if sdr_id == "sigmf-playback":
            sdr = {
                "id": "sigmf-playback",
                "name": "SigMF Playback",
                "type": "sigmfplayback",
                "driver": "sigmfplayback",
                "recording_path": "",  # Will be set when recording is selected
            }
        else:
            # Fetch SDR device details from database
            sdr_device_reply = await crud.hardware.fetch_sdr(dbsession, sdr_id)

            if not sdr_device_reply["data"]:
                raise Exception(f"SDR device with id {sdr_id} not found in database")

            sdr = sdr_device_reply["data"]

        if sdr.get("type") in ["rtlsdrtcpv3", "rtlsdrusbv3", "rtlsdrtcpv4", "rtlsdrusbv4"]:

            # Common RTL-SDR gain values in dB
            gain_values = [
                0.0,
                0.9,
                1.4,
                2.7,
                3.7,
                7.7,
                8.7,
                12.5,
                14.4,
                15.7,
                16.6,
                19.7,
                20.7,
                22.9,
                25.4,
                28.0,
                29.7,
                32.8,
                33.8,
                36.4,
                37.2,
                38.6,
                40.2,
                42.1,
                43.4,
                43.9,
                44.5,
                48.0,
            ]

            # Common RTL-SDR sample rates in Hz
            sample_rate_values = [
                240000,
                300000,
                960000,
                1024000,
                1536000,
                1792000,
                1920000,
                2048000,
                2304000,
                2400000,
                2560000,
                2880000,
                3200000,
            ]

            # Common window functions
            window_function_names = list(window_functions.keys())

            # Common FFT sizes
            fft_size_values = [256, 512, 1024, 2048, 4096, 8192, 16384, 32768, 65536]

            params = {
                "gain_values": gain_values,
                "sample_rate_values": sample_rate_values,
                "fft_size_values": fft_size_values,
                "fft_window_values": window_function_names,
                "has_bias_t": True,
                "has_tuner_agc": True,
                "has_rtl_agc": True,
                "antennas": {"tx": [], "rx": ["RX"]},
            }

            sdr_parameters_cache[sdr_id] = params
            reply = {"success": True, "data": params}

        elif sdr.get("type") in ["airspy", "airspyhf"]:
            logger.info("Getting SDR parameters from native Airspy backend for SDR: %s", sdr)
            probe_process = await asyncio.create_subprocess_exec(
                sys.executable,
                "-c",
                "from hardware.airspyprobe import probe_native_airspy; "
                "import json; "
                f"print(json.dumps(probe_native_airspy({sdr})))",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )

            try:
                stdout, stderr = await asyncio.wait_for(
                    probe_process.communicate(), timeout=timeout
                )
                if probe_process.returncode != 0:
                    error_output = _decode_subprocess_output(stderr)
                    raise Exception(f"Native Airspy probe process failed: {error_output}")
            except asyncio.TimeoutError:
                probe_process.kill()
                raise TimeoutError("Timed out while getting SDR parameters from native Airspy")

            sdr_params_reply = json.loads(_decode_subprocess_output(stdout))
            if sdr_params_reply.get("success") is False:
                logger.error(sdr_params_reply)
                raise Exception(sdr_params_reply.get("error") or "Native Airspy probe failed")

            sdr_params = sdr_params_reply.get("data", {})
            for log_line in sdr_params_reply.get("log", []):
                logger.debug(log_line)

            window_function_names = list(window_functions.keys())
            fft_size_values = [256, 512, 1024, 2048, 4096, 8192, 16384, 32768, 65536]

            params = {
                "gain_values": sdr_params.get("gains", []),
                "sample_rate_values": _select_neat_sample_rates(sdr_params.get("rates", [])),
                "sample_rate_values_full": sdr_params.get("rates", []),
                "fft_size_values": fft_size_values,
                "fft_window_values": window_function_names,
                "has_bias_t": sdr_params.get("has_bias_t", False),
                "has_tuner_agc": sdr_params.get("has_tuner_agc", False),
                "has_rtl_agc": False,
                "has_soapy_agc": False,
                "antennas": sdr_params.get("antennas", {"tx": [], "rx": ["RX"]}),
                "frequency_ranges": sdr_params.get("frequency_ranges", {}),
                "clock_info": sdr_params.get("clock_info", {}),
                "temperature": sdr_params.get("temperature", {}),
                "capabilities": sdr_params.get("capabilities", {}),
            }

            sdr_parameters_cache[sdr_id] = params
            reply = {"success": True, "data": params}

        elif sdr.get("type") in ["soapysdrremote", "soapysdrlocal"]:
            if sdr.get("type") == "soapysdrremote":
                logger.info("Getting SDR parameters from SoapySDR server for SDR: %s", sdr)
                probe_process = await asyncio.create_subprocess_exec(
                    "python3",
                    "-c",
                    "from hardware.soapysdrremoteprobe import probe_remote_soapy_sdr; "
                    f"print(probe_remote_soapy_sdr({sdr}))",
                    stdout=asyncio.subprocess.PIPE,
                )

                try:
                    stdout, _ = await asyncio.wait_for(probe_process.communicate(), timeout=timeout)

                except asyncio.TimeoutError:
                    probe_process.kill()
                    raise TimeoutError(
                        "Timed out while getting SDR parameters from SoapySDR server"
                    )
            else:
                logger.info("Getting SDR parameters from local SoapySDR for SDR: %s", sdr)
                probe_process = await asyncio.create_subprocess_exec(
                    "python3",
                    "-c",
                    "from hardware.soapysdrlocalprobe import probe_local_soapy_sdr; "
                    f"print(probe_local_soapy_sdr({sdr}))",
                    stdout=asyncio.subprocess.PIPE,
                )

                try:
                    stdout, _ = await asyncio.wait_for(probe_process.communicate(), timeout=timeout)

                except asyncio.TimeoutError:
                    probe_process.kill()
                    raise TimeoutError(
                        "Timed out while getting SDR parameters from SoapySDR server"
                    )

            sdr_params_reply = eval(stdout.decode().strip())

            if sdr_params_reply["success"] is False:
                logger.error(sdr_params_reply)
                raise Exception(sdr_params_reply["error"])

            sdr_params = sdr_params_reply["data"]

            logger.debug("Got SDR parameters from SoapySDR server: %s", sdr_params)
            for log_line in sdr_params_reply["log"]:
                logger.debug(log_line)

            window_function_names = list(window_functions.keys())
            fft_size_values = [256, 512, 1024, 2048, 4096, 8192, 16384, 32768, 65536]

            params = {
                "gain_values": sdr_params["gains"],
                "sample_rate_values": _select_neat_sample_rates(sdr_params["rates"]),
                "sample_rate_values_full": sdr_params["rates"],
                "fft_size_values": fft_size_values,
                "fft_window_values": window_function_names,
                "has_soapy_agc": sdr_params["has_soapy_agc"],
                "antennas": sdr_params["antennas"],
                "frequency_ranges": sdr_params.get("frequency_ranges", {}),
                "clock_info": sdr_params.get("clock_info", {}),
                "temperature": sdr_params.get("temperature", {}),
                "capabilities": _strip_sample_rate_ranges(sdr_params.get("capabilities", {})),
            }

            # try:
            #     pretty_params = json.dumps(params, indent=2, sort_keys=True)
            #     print(
            #         f"[DEBUG] SoapySDR parameters for {sdr.get('name', sdr_id)}:\\n{pretty_params}"
            #     )
            # except Exception as e:
            #     print(
            #         f"[DEBUG] SoapySDR parameters (non-JSON) for {sdr.get('name', sdr_id)}: {params}"
            #     )
            #     print(f"[DEBUG] Pretty print failed: {e}")

            sdr_parameters_cache[sdr_id] = params
            reply = {"success": True, "data": params}

        elif sdr.get("type") in ["uhd"]:
            logger.info("Getting SDR parameters from UHD/USRP for SDR: %s", sdr)

            probe_process = await asyncio.create_subprocess_exec(
                "python3",
                "-c",
                "from hardware.uhdprobe import probe_uhd_usrp; " f"print(probe_uhd_usrp({sdr}))",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )

            try:
                stdout, stderr = await asyncio.wait_for(
                    probe_process.communicate(), timeout=timeout
                )

                if probe_process.returncode != 0:
                    error_output = stderr.decode().strip()
                    raise Exception(f"UHD probe process failed: {error_output}")

            except asyncio.TimeoutError:
                probe_process.kill()
                raise TimeoutError("Timed out while getting SDR parameters from UHD/USRP")

            sdr_params_reply = eval(stdout.decode().strip())

            if sdr_params_reply["success"] is False:
                logger.error(sdr_params_reply)
                raise Exception(sdr_params_reply["error"])

            sdr_params = sdr_params_reply["data"]

            logger.debug("Got SDR parameters from UHD/USRP: %s", sdr_params)

            window_function_names = list(window_functions.keys())
            fft_size_values = [256, 512, 1024, 2048, 4096, 8192, 16384, 32768, 65536]

            params = {
                "gain_values": sdr_params["gains"],
                "sample_rate_values": [rate for rate in sdr_params["rates"] if rate >= 100000],
                "fft_size_values": fft_size_values,
                "fft_window_values": window_function_names,
                "has_uhd_agc": sdr_params.get("has_uhd_agc", False),
                "antennas": sdr_params["antennas"],
                "frequency_ranges": sdr_params.get("frequency_ranges", {}),
                "clock_info": sdr_params.get("clock_info", {}),
                "temperature": sdr_params.get("temperature", {}),
                "capabilities": _strip_sample_rate_ranges(sdr_params.get("capabilities", {})),
            }

            sdr_parameters_cache[sdr_id] = params
            reply = {"success": True, "data": params}

        elif sdr.get("type") in ["sigmfplayback"]:
            logger.info("Getting parameters from SigMF recording for SDR: %s", sdr)

            recording_path = sdr.get("recording_path", "")

            if not recording_path:
                for client_id, session in active_sdr_clients.items():
                    if session.get("sdr_id") == sdr_id:
                        recording_path = session.get("recording_path", "")
                        break

            if not recording_path:
                logger.warning("No recording_path available yet for sigmfplayback SDR")
                window_function_names = list(window_functions.keys())
                fft_size_values = [256, 512, 1024, 2048, 4096, 8192, 16384, 32768, 65536]

                params = {
                    "gain_values": [0.0],
                    "sample_rate_values": [2048000],  # Default
                    "fft_size_values": fft_size_values,
                    "fft_window_values": window_function_names,
                    "has_agc": False,
                    "has_bias_t": False,
                    "has_tuner_agc": False,
                    "has_rtl_agc": False,
                    "has_soapy_agc": False,
                    "antennas": {"tx": [], "rx": ["RX"]},
                    "frequency_ranges": {"rx": {"min": 0, "max": 6000, "step": 0.1}},
                }

                reply = {"success": True, "data": params}
                return reply

            sdr["recording_path"] = recording_path

            probe_process = await asyncio.create_subprocess_exec(
                "python3",
                "-c",
                "from hardware.sigmfprobe import probe_sigmf_recording; "
                f"print(probe_sigmf_recording({sdr}))",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )

            try:
                stdout, stderr = await asyncio.wait_for(
                    probe_process.communicate(), timeout=timeout
                )

                if probe_process.returncode != 0:
                    error_output = stderr.decode().strip()
                    raise Exception(f"SigMF probe process failed: {error_output}")

            except asyncio.TimeoutError:
                probe_process.kill()
                raise TimeoutError("Timed out while getting parameters from SigMF recording")

            sdr_params_reply = eval(stdout.decode().strip())

            if sdr_params_reply["success"] is False:
                logger.error(sdr_params_reply)
                raise Exception(sdr_params_reply["error"])

            sdr_params = sdr_params_reply["data"]

            logger.debug("Got parameters from SigMF recording: %s", sdr_params)

            window_function_names = list(window_functions.keys())
            fft_size_values = [256, 512, 1024, 2048, 4096, 8192, 16384, 32768, 65536]

            params = {
                "gain_values": sdr_params["gains"],
                "sample_rate_values": sdr_params["rates"],
                "fft_size_values": fft_size_values,
                "fft_window_values": window_function_names,
                "has_agc": sdr_params.get("has_agc", False),
                "has_bias_t": False,
                "has_tuner_agc": False,
                "has_rtl_agc": False,
                "has_soapy_agc": False,
                "antennas": {"tx": [], "rx": ["RX"]},
                "frequency_ranges": sdr_params.get("frequency_ranges", {}),
                "metadata": sdr_params.get("metadata", {}),
                "total_samples": sdr_params.get("total_samples", 0),
                "duration": sdr_params.get("duration", 0),
            }

            sdr_parameters_cache[sdr_id] = params
            reply = {"success": True, "data": params}

    except TimeoutError:
        error_msg = (
            f"Timeout occurred while getting parameters from SDR with id {sdr_id} "
            f"within {timeout} seconds timeout"
        )
        logger.error(error_msg)
        if sdr_id in sdr_parameters_cache and sdr_id != "sigmf-playback":
            logger.warning(
                "Returning cached SDR parameters for %s after timeout: %s", sdr_id, error_msg
            )
            reply["success"] = True
            reply["data"] = sdr_parameters_cache[sdr_id]
            reply["error"] = error_msg
            return reply
        reply["success"] = False
        reply["error"] = error_msg

    except Exception as e:
        error_msg = str(e)
        logger.error("Error occurred while getting parameters from SDR with id %s", sdr_id)
        logger.error(error_msg)
        if sdr_id in sdr_parameters_cache and sdr_id != "sigmf-playback":
            logger.warning(
                "Returning cached SDR parameters for %s after error: %s", sdr_id, error_msg
            )
            reply["success"] = True
            reply["data"] = sdr_parameters_cache[sdr_id]
            reply["error"] = error_msg
            return reply
        reply["success"] = False
        reply["error"] = error_msg

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
        add_reply = await crud.hardware.add_rig(dbsession, data)

        rigs = await crud.hardware.fetch_rigs(dbsession)
        if add_reply.get("success"):
            for manager in get_all_tracker_managers().values():
                await manager.notify_hardware_changed(rig_id=add_reply.get("data", {}).get("id"))
        return {
            "success": (rigs["success"] & add_reply["success"]),
            "data": rigs.get("data", []),
        }


async def edit_rig(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Union[bool, list]]:
    """Edit an existing rig."""
    async with AsyncSessionLocal() as dbsession:
        logger.debug(f"Editing rig, data: {data}")
        edit_reply = await crud.hardware.edit_rig(dbsession, data)

        rigs = await crud.hardware.fetch_rigs(dbsession)
        if edit_reply.get("success") and data:
            for manager in get_all_tracker_managers().values():
                await manager.notify_hardware_changed(rig_id=data.get("id"))
        return {
            "success": (rigs["success"] & edit_reply["success"]),
            "data": rigs.get("data", []),
        }


async def delete_rig(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Union[bool, list]]:
    """Delete a rig."""
    async with AsyncSessionLocal() as dbsession:
        logger.debug(f"Delete rig, data: {data}")
        delete_reply = await crud.hardware.delete_rig(dbsession, data)

        rigs = await crud.hardware.fetch_rigs(dbsession)
        if delete_reply.get("success") and data:
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
        add_reply = await crud.hardware.add_rotator(dbsession, data)

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


async def edit_rotator(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Union[bool, list]]:
    """Edit an existing rotator."""
    async with AsyncSessionLocal() as dbsession:
        logger.debug(f"Editing rotator, data: {data}")
        edit_reply = await crud.hardware.edit_rotator(dbsession, data)
        logger.debug(f"Edit rotator reply: {edit_reply}")

        rotators = await crud.hardware.fetch_rotators(dbsession)
        logger.debug(f"Rotators: {rotators}")
        if edit_reply.get("success") and data:
            for manager in get_all_tracker_managers().values():
                await manager.notify_hardware_changed(rotator_id=data.get("id"))
        return {
            "success": (rotators["success"] & edit_reply["success"]),
            "data": rotators.get("data", []),
        }


async def delete_rotator(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Union[bool, list]]:
    """Delete rotators."""
    async with AsyncSessionLocal() as dbsession:
        logger.debug(f"Delete rotator, data: {data}")
        delete_reply = await crud.hardware.delete_rotators(dbsession, data)

        rotators = await crud.hardware.fetch_rotators(dbsession)
        if delete_reply.get("success") and data:
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
        add_reply = await crud.hardware.add_camera(dbsession, data)

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
        edit_reply = await crud.hardware.edit_camera(dbsession, data)
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
        delete_reply = await crud.hardware.delete_cameras(dbsession, data)

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
        add_reply = await crud.hardware.add_sdr(dbsession, data)
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
        edit_reply = await crud.hardware.edit_sdr(dbsession, data)
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

        delete_reply = await crud.hardware.delete_sdrs(dbsession, list(data))

        sdrs = await crud.hardware.fetch_sdrs(dbsession)
        if delete_reply.get("success") and data:
            for sdr_id in list(data):
                for manager in get_all_tracker_managers().values():
                    await manager.notify_hardware_changed(rig_id=sdr_id)
        return {
            "success": (sdrs["success"] & delete_reply["success"]),
            "data": sdrs.get("data", []),
        }


async def get_soapy_servers(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Union[bool, list]]:
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
) -> Dict[str, Union[bool, list, str]]:
    """Get SDR parameters."""
    async with AsyncSessionLocal() as dbsession:
        logger.debug("Getting SDR parameters")
        parameters = await _fetch_sdr_parameters(dbsession, data)
        return {
            "success": parameters["success"],
            "data": parameters.get("data", []),
            "error": parameters.get("error", None),
        }


async def get_local_soapy_sdr_devices_handler(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Union[bool, list, str]]:
    """Get local SoapySDR devices."""
    logger.debug("Getting local SoapySDR devices")
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


def register_handlers(registry):
    """Register hardware handlers with the command registry."""
    registry.register_batch(
        {
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
            "get-sdr-parameters": (get_sdr_parameters, "api_call"),
            "get-local-soapy-sdr-devices": (get_local_soapy_sdr_devices_handler, "api_call"),
            "get-local-rtl-sdr-devices": (get_local_rtl_sdr_devices_handler, "api_call"),
            "get-local-uhd-devices": (get_local_uhd_devices_handler, "api_call"),
            "get-local-airspy-devices": (get_local_airspy_devices_handler, "api_call"),
        }
    )
