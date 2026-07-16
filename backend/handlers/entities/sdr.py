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
from typing import Any, Dict, List, Optional, Union

import crud
from common.pathguard import resolve_sigmf_meta_path
from common.sdrconfig import SDRConfig
from crud.preferences import fetch_integration_preferences_map
from db import AsyncSessionLocal
from demodulators.amdemodulator import AMDemodulator
from demodulators.fmdemodulator import FMDemodulator
from demodulators.fmstereodemodulator import FMStereoDemodulator
from demodulators.ssbdemodulator import SSBDemodulator
from handlers.entities.filebrowser import emit_file_browser_state
from handlers.entities.transcriptionhelpers import fetch_transmitter_and_satellite
from handlers.routing import get_auth_context
from pipeline.orchestration.processmanager import process_manager
from server.audiorecorder import start_audio_recording, stop_audio_recording
from server.recorder import start_recording, stop_recording
from server.snapshots import save_waterfall_snapshot
from server.startup import audio_queue
from session.service import session_service
from session.tracker import session_tracker
from vfos.state import VFOManager

SDR_IN_USE_CONFLICT_CODE = "sdr_in_use_conflict"


def _coerce_float(value, default, field_name, logger):
    if value is None:
        return default
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in ("", "none"):
            logger.warning(f"{field_name} is unset; using default {default}.")
            return default
        try:
            return float(normalized)
        except ValueError:
            logger.warning(f"{field_name} is invalid ({value}); using default {default}.")
            return default
    logger.warning(f"{field_name} has unsupported type; using default {default}.")
    return default


def _coerce_int(value, default, field_name, logger):
    if value is None:
        return default
    if isinstance(value, bool):
        return default
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in ("", "none"):
            logger.warning(f"{field_name} is unset; using default {default}.")
            return default
        try:
            return int(float(normalized))
        except ValueError:
            logger.warning(f"{field_name} is invalid ({value}); using default {default}.")
            return default
    logger.warning(f"{field_name} has unsupported type; using default {default}.")
    return default


def _coerce_bool(value, default, field_name, logger):
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in ("", "none"):
            logger.warning(f"{field_name} is unset; using default {default}.")
            return default
        if normalized in ("true", "1", "yes", "on"):
            return True
        if normalized in ("false", "0", "no", "off"):
            return False
        logger.warning(f"{field_name} is invalid ({value}); using default {default}.")
        return default
    logger.warning(f"{field_name} has unsupported type; using default {default}.")
    return default


def _sanitize_overlap_percent(value, default, field_name, logger):
    percent = _coerce_int(value, default, field_name, logger)
    allowed = [0, 25, 50, 75]
    if percent not in allowed:
        snapped = min(allowed, key=lambda x: abs(x - percent))
        logger.warning(
            f"{field_name}={percent} is unsupported; using nearest supported value {snapped}."
        )
        percent = snapped
    return percent


def _list_other_sdr_clients(sdr_id: str, client_id: str) -> List[str]:
    """Return all connected client/session ids on the SDR excluding the caller."""
    try:
        process_info = process_manager.processes.get(sdr_id, {})
    except Exception:
        return []
    clients = process_info.get("clients", set()) or set()
    normalized_client_id = str(client_id)
    return sorted(str(sid) for sid in clients if str(sid) != normalized_client_id)


def _is_center_frequency_change(sdr_id: str, requested_center_freq: float) -> bool:
    """
    Compare requested center frequency against the running SDR process config.

    We intentionally compare with the process-level effective config instead of the
    caller's cached session config because the caller can be stale while other
    sessions are actively using and retuning the same SDR.
    """
    try:
        process_info = process_manager.processes.get(sdr_id, {})
    except Exception:
        return False
    if not process_info:
        return False
    running_config = process_info.get("config", {}) or {}
    running_center = running_config.get("center_freq")
    if running_center is None:
        # Unknown running center while process is active; treat as potentially disruptive.
        return True
    try:
        return abs(float(running_center) - float(requested_center_freq)) > 1e-6
    except Exception:
        # Non-numeric running center cannot be compared safely; require confirmation.
        return True


def _build_sdr_in_use_conflict(
    sdr_id: str,
    other_clients: List[str],
    operation: str,
    message: Optional[str] = None,
) -> Dict[str, Union[str, int, bool, list]]:
    """Create a structured conflict payload for frontend takeover confirmation."""
    other_sessions: List[Dict[str, Union[str, bool, None]]] = []
    includes_internal_observation = False

    for session_id in other_clients:
        is_internal = VFOManager.is_internal_session(session_id)
        includes_internal_observation = includes_internal_observation or is_internal
        metadata = session_tracker.get_session_metadata(session_id) or {}
        other_sessions.append(
            {
                "session_id": session_id,
                "is_internal": is_internal,
                "username": metadata.get("username"),
            }
        )

    default_message = (
        f"SDR '{sdr_id}' is currently in use by {len(other_clients)} other session(s). "
        f"Confirm takeover to continue."
    )
    return {
        "error_code": SDR_IN_USE_CONFLICT_CODE,
        "operation": operation,
        "sdr_id": sdr_id,
        "other_session_count": len(other_clients),
        "other_sessions": other_sessions,
        "includes_internal_observation": includes_internal_observation,
        "requires_force_takeover": True,
        "message": message or default_message,
    }


async def sdr_command_routing(
    sio: Any, cmd: str, data: Dict[str, Any], logger: Any, client_id: str
) -> Dict[str, Union[bool, None, dict, list, str]]:

    async with AsyncSessionLocal() as dbsession:
        reply: Dict[str, Union[bool, None, dict, list, str]] = {"success": False, "data": None}

        logger.info(f"SDR command received: {cmd}")

        if cmd == "configure-sdr":
            try:
                # SDR device id
                sdr_id = data.get("selectedSDRId", None)
                force_takeover = _coerce_bool(
                    data.get("forceTakeover", False), False, "forceTakeover", logger
                )

                logger.info(f"Configuring SDR {sdr_id} for client {client_id}")

                # Handle hardcoded sigmfplayback SDR
                if sdr_id == "sigmf-playback":
                    sdr_device = {
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
                else:
                    # Fetch SDR device details from database
                    sdr_device_reply = await crud.hardware.fetch_sdr(dbsession, sdr_id)
                    if not sdr_device_reply["success"] or not sdr_device_reply["data"]:
                        raise Exception(f"SDR device with id {sdr_id} not found in database")

                    sdr_device = sdr_device_reply["data"]
                sdr_serial = sdr_device.get("serial", 0)
                sdr_host = sdr_device.get("host", None)
                sdr_port = sdr_device.get("port", None)
                sdr_type_raw = sdr_device.get("type")
                sdr_type = sdr_type_raw.lower() if isinstance(sdr_type_raw, str) else ""
                default_fft_overlap_percent = (
                    50
                    if sdr_type
                    in [
                        "rtlsdrtcpv3",
                        "rtlsdrusbv3",
                        "rtlsdrtcpv4",
                        "rtlsdrusbv4",
                        "sigmfplayback",
                    ]
                    else 0
                )

                # Default to 100 MHz
                center_freq = _coerce_float(
                    data.get("centerFrequency", 100e6), 100e6, "centerFrequency", logger
                )

                # Validate center frequency against device limits
                freq_min = sdr_device.get("frequency_min", None)
                freq_max = sdr_device.get("frequency_max", None)

                # Only validate if both limits are defined and numeric; otherwise warn and skip validation.
                if freq_min is None or freq_max is None:
                    logger.warning(
                        "SDR frequency limits missing; skipping center frequency validation."
                    )
                elif not isinstance(freq_min, (int, float)) or not isinstance(
                    freq_max, (int, float)
                ):
                    logger.warning(
                        "SDR frequency limits invalid; skipping center frequency validation."
                    )
                else:
                    if not (freq_min * 1e6 <= center_freq <= freq_max * 1e6):
                        raise Exception(
                            f"Center frequency {center_freq / 1e6:.2f} MHz is outside device limits "
                            f"({freq_min:.2f} MHz - {freq_max:.2f} MHz)"
                        )

                # Default to 2.048 MSPS
                sample_rate = _coerce_float(
                    data.get("sampleRate", 2.048e6), 2.048e6, "sampleRate", logger
                )

                # Default to 20 dB gain
                gain = _coerce_float(data.get("gain", 20), 20, "gain", logger)

                # Default FFT size
                fft_size = _coerce_int(data.get("fftSize", 1024), 1024, "fftSize", logger)

                logger.info(f"SDR configure payload: {data}")

                # Enable/disable Bias-T
                bias_t = data.get("biasT", False)

                # Read tuner AGC setting
                tuner_agc = data.get("tunerAgc", False)

                # Read AGC mode
                rtl_agc = data.get("rtlAgc", False)

                # Read the FFT window
                fft_window = data.get("fftWindow", "hanning")

                # FFT Averaging
                fft_averaging = _coerce_int(data.get("fftAveraging", 1), 1, "fftAveraging", logger)
                fft_overlap_percent = _sanitize_overlap_percent(
                    data.get("fftOverlapPercent", default_fft_overlap_percent),
                    default_fft_overlap_percent,
                    "fftOverlapPercent",
                    logger,
                )
                fft_overlap_depth = _coerce_int(
                    data.get("fftOverlapDepth", 16), 16, "fftOverlapDepth", logger
                )
                fft_overlap_depth = max(1, min(64, fft_overlap_depth))

                # Antenna port
                antenna = data.get("antenna", None)
                if isinstance(antenna, str) and antenna.strip().lower() in ("", "none"):
                    logger.warning("Antenna is unset; using device default.")
                    antenna = None

                # Soapy AGC
                soapy_agc = data.get("soapyAgc", False)

                # Offset frequency for downconverters and upconverters
                offset_freq = _coerce_float(
                    data.get("offsetFrequency", 0), 0, "offsetFrequency", logger
                )

                # Recording path for sigmfplayback
                recording_path = data.get("recordingPath", "")
                if sdr_id == "sigmf-playback" and recording_path:
                    # SigMF playback supports user-selected recordings, but the
                    # selected file must stay inside trusted recording roots.
                    recording_path = str(resolve_sigmf_meta_path(recording_path))

                # Optional SDR settings (SoapySDR-specific capabilities)
                sdr_settings = data.get("sdrSettings", {})
                if sdr_settings is not None and not isinstance(sdr_settings, dict):
                    logger.warning("Invalid sdrSettings payload; expected dict.")
                    sdr_settings = {}

                # SDR configuration dictionary
                sdr_config = SDRConfig(
                    center_freq=center_freq,
                    sample_rate=sample_rate,
                    gain=gain,
                    fft_size=fft_size,
                    bias_t=bias_t,
                    tuner_agc=tuner_agc,
                    rtl_agc=rtl_agc,
                    fft_window=fft_window,
                    fft_averaging=fft_averaging,
                    fft_overlap_percent=fft_overlap_percent,
                    fft_overlap_depth=fft_overlap_depth,
                    sdr_id=sdr_id,
                    recording_path=recording_path,
                    serial_number=sdr_serial,
                    host=sdr_host,
                    port=sdr_port,
                    client_id=client_id,
                    soapy_agc=soapy_agc,
                    offset_freq=offset_freq,
                    antenna=antenna,
                    sdr_settings=sdr_settings,
                ).to_dict()

                # Takeover guard:
                # If this SDR is actively used by other sessions and the requested center
                # frequency would retune the running process, require explicit override.
                other_clients = _list_other_sdr_clients(str(sdr_id), client_id)
                if (
                    other_clients
                    and not force_takeover
                    and _is_center_frequency_change(str(sdr_id), center_freq)
                ):
                    conflict = _build_sdr_in_use_conflict(
                        str(sdr_id),
                        other_clients,
                        operation="configure-sdr:center-frequency",
                    )
                    logger.warning(
                        "Blocked SDR configure center-frequency update for session %s on SDR %s "
                        "because %d other session(s) are active; force takeover required.",
                        client_id,
                        sdr_id,
                        len(other_clients),
                    )
                    reply["success"] = False
                    reply["error"] = str(conflict.get("message") or "SDR in-use conflict")
                    reply["error_code"] = SDR_IN_USE_CONFLICT_CODE
                    reply["data"] = conflict
                    return reply

                # Create or update SDR session via SessionService (also updates tracker)
                logger.info(f"Creating an SDR session for client {client_id}")
                await session_service.configure_sdr(client_id, sdr_device, sdr_config)

                # Check if other clients are already connected in the same room (SDR),
                # if so then send them an update
                if process_manager.processes.get(sdr_id, None) is not None:
                    other_clients = [
                        client
                        for client in process_manager.processes[sdr_id]["clients"]
                        if client != client_id
                    ]

                    # For every other client id, send an update
                    for other_client in other_clients:
                        await sio.emit("sdr-config", sdr_config, room=other_client)

                is_running = process_manager.is_sdr_process_running(sdr_id)
                if is_running:
                    logger.info(
                        f"Updating SDR configuration for client {client_id} with SDR id: {sdr_id}"
                    )
                    await process_manager.update_configuration(sdr_id, sdr_config)

                reply["success"] = True

            except Exception as e:
                logger.error(f"Error configuring SDR: {str(e)}")
                logger.exception(e)
                await sio.emit(
                    "sdr-config-error",
                    {"message": f"Failed to configure SDR: {str(e)}"},
                    room=client_id,
                )
                reply["success"] = False

        elif cmd == "start-streaming":

            try:
                # SDR device id
                sdr_id = data.get("selectedSDRId", None)
                force_takeover = _coerce_bool(
                    data.get("forceTakeover", False), False, "forceTakeover", logger
                )

                # Handle hardcoded sigmfplayback SDR
                if sdr_id == "sigmf-playback":
                    sdr_device = {
                        "id": "sigmf-playback",
                        "name": "SigMF Playback",
                        "type": "sigmfplayback",
                        "driver": "sigmfplayback",
                        "serial": None,
                        "host": None,
                        "port": None,
                    }
                else:
                    # Fetch SDR device details from database
                    sdr_device_reply = await crud.hardware.fetch_sdr(dbsession, sdr_id)
                    if not sdr_device_reply["success"] or not sdr_device_reply["data"]:
                        raise Exception(f"SDR device with id {sdr_id} not found in database")

                    sdr_device = sdr_device_reply["data"]

                if not session_service.session_exists(client_id):
                    raise Exception(f"Client with id: {client_id} not registered")

                sdr_config = session_service.get_session_config(client_id)
                logger.info(f"Starting streaming SDR data for client {client_id}")

                # Takeover guard:
                # Starting a stream on an already active SDR can impact existing sessions.
                # Require explicit force flag when other sessions are already attached.
                other_clients = _list_other_sdr_clients(str(sdr_id), client_id)
                if other_clients and not force_takeover:
                    conflict = _build_sdr_in_use_conflict(
                        str(sdr_id),
                        other_clients,
                        operation="start-streaming",
                    )
                    logger.warning(
                        "Blocked SDR start-streaming for session %s on SDR %s because %d "
                        "other session(s) are active; force takeover required.",
                        client_id,
                        sdr_id,
                        len(other_clients),
                    )
                    reply["success"] = False
                    reply["error"] = str(conflict.get("message") or "SDR in-use conflict")
                    reply["error_code"] = SDR_IN_USE_CONFLICT_CODE
                    reply["data"] = conflict
                    return reply

                # Start or join the SDR process
                process_sdr_id = await session_service.start_streaming(client_id, sdr_device)
                logger.info(
                    f"SDR process started for client {client_id} with process id: {process_sdr_id}"
                )
                reply["success"] = True
                reply["data"] = {"sdr_id": process_sdr_id}

            except Exception as e:
                logger.error(f"Error starting SDR stream: {str(e)}")
                logger.exception(e)
                await sio.emit(
                    "sdr-error",
                    {"message": f"Failed to start SDR stream: {str(e)}"},
                    room=client_id,
                )
                reply["success"] = False

        elif cmd == "stop-streaming":

            try:
                # SDR device id
                sdr_id = data.get("selectedSDRId", None)

                # Handle hardcoded sigmfplayback SDR
                if sdr_id == "sigmf-playback":
                    sdr_device = {
                        "id": "sigmf-playback",
                        "name": "SigMF Playback",
                        "type": "sigmfplayback",
                    }
                else:
                    # Fetch SDR device details from database
                    sdr_device_reply = await crud.hardware.fetch_sdr(dbsession, sdr_id)
                    if not sdr_device_reply["success"] or not sdr_device_reply["data"]:
                        raise Exception(f"SDR device with id {sdr_id} not found in database")

                    sdr_device = sdr_device_reply["data"]

                _ = session_service.get_session_config(client_id)

                if sdr_id:
                    # Stop or leave the SDR process (via service)
                    await session_service.stop_streaming(client_id, sdr_id)

                if not session_service.session_exists(client_id):
                    logger.error(f"Client {client_id} not registered while stopping SDR stream")
                    reply["success"] = False

                # Note: We do NOT cleanup the session here - the session should persist
                # until the socket disconnects. Only stop streaming updates the state.

                await sio.emit("sdr-status", {"streaming": False}, room=client_id)
                logger.info(f"Stopped streaming SDR data for client {client_id}")
                reply["success"] = True
                reply["data"] = {"sdr_id": sdr_id}

            except Exception as e:
                logger.error(f"Error stopping SDR stream: {str(e)}")
                logger.exception(e)
                await sio.emit(
                    "sdr-error", {"message": f"Failed to stop SDR stream: {str(e)}"}, room=client_id
                )
                reply["success"] = False

        elif cmd == "seek-playback":

            try:
                sdr_id = data.get("selectedSDRId", None)
                if sdr_id != "sigmf-playback":
                    raise Exception("Playback seeking is only supported for SigMF Playback SDR")

                if not session_service.session_exists(client_id):
                    raise Exception(f"Client with id: {client_id} not registered")

                if not process_manager.is_sdr_process_running(sdr_id):
                    raise Exception("SigMF playback is not currently streaming")

                position_seconds = _coerce_float(
                    data.get("positionSeconds", 0), 0, "positionSeconds", logger
                )
                if position_seconds < 0:
                    logger.warning("positionSeconds < 0 requested; clamping to 0")
                    position_seconds = 0.0

                # Forward seek request as a runtime config update.
                await process_manager.update_configuration(
                    sdr_id,
                    {"client_id": client_id, "seek_seconds": position_seconds},
                )

                reply["success"] = True
                reply["data"] = {"position_seconds": position_seconds}

            except Exception as e:
                logger.error(f"Error seeking SigMF playback: {str(e)}")
                logger.exception(e)
                await sio.emit(
                    "sdr-error",
                    {"message": f"Failed to seek SigMF playback: {str(e)}"},
                    room=client_id,
                )
                reply["success"] = False
                reply["error"] = str(e)

        elif cmd == "start-recording":
            try:
                sdr_id = data.get("selectedSDRId", None)
                recording_name = data.get("recordingName", "")
                target_satellite_norad_id = data.get("targetSatelliteNoradId", "")
                target_satellite_name = data.get("targetSatelliteName", "")

                result = start_recording(
                    sdr_id,
                    client_id,
                    recording_name,
                    target_satellite_norad_id,
                    target_satellite_name,
                )
                reply.update(result)

                # Emit file browser state update so all clients see the new recording
                if result.get("success"):
                    await emit_file_browser_state(
                        sio,
                        {
                            "action": "recording-started",
                            "recording_name": recording_name,
                        },
                        logger,
                    )

            except Exception as e:
                logger.error(f"Error starting recording: {str(e)}")
                logger.exception(e)
                await sio.emit(
                    "file_browser_error",
                    {"error": f"Failed to start recording: {str(e)}", "action": "start-recording"},
                )
                reply["success"] = False
                reply["error"] = str(e)

        elif cmd == "stop-recording":
            try:
                sdr_id = data.get("selectedSDRId", None)
                waterfall_image = data.get("waterfallImage", None)
                skip_auto_waterfall = data.get("skipAutoWaterfall", False)

                if waterfall_image:
                    logger.info(
                        f"stop-recording command received with waterfall image, length: {len(waterfall_image)} characters"
                    )
                else:
                    logger.info("stop-recording command received without waterfall image")

                result = stop_recording(sdr_id, client_id, waterfall_image, skip_auto_waterfall)
                reply.update(result)

                # Emit file browser state update so all clients see the completed recording
                if result.get("success"):
                    await emit_file_browser_state(
                        sio,
                        {
                            "action": "recording-stopped",
                            "recording_path": result.get("data", {}).get("recording_path"),
                        },
                        logger,
                    )

            except Exception as e:
                logger.error(f"Error stopping recording: {str(e)}")
                logger.exception(e)
                await sio.emit(
                    "file_browser_error",
                    {"error": f"Failed to stop recording: {str(e)}", "action": "stop-recording"},
                )
                reply["success"] = False
                reply["error"] = str(e)

        elif cmd == "start-audio-recording":
            try:
                sdr_id = data.get("selectedSDRId")
                vfo_number = data.get("vfoNumber")
                recording_name = data.get("recordingName", "")
                center_frequency = data.get("centerFrequency", 0)
                vfo_frequency = data.get("vfoFrequency", 0)
                demodulator_type = data.get("demodulatorType", "")
                target_satellite_norad_id = data.get("targetSatelliteNoradId", "")
                target_satellite_name = data.get("targetSatelliteName", "")

                result = start_audio_recording(
                    sdr_id,
                    client_id,
                    vfo_number,
                    recording_name,
                    target_satellite_norad_id,
                    target_satellite_name,
                    center_frequency,
                    vfo_frequency,
                    demodulator_type,
                )
                reply.update(result)

                logger.info(f"Started audio recording for VFO {vfo_number}, session {client_id}")

                # Emit file browser state update so all clients see the new audio recording
                await emit_file_browser_state(
                    sio,
                    {
                        "action": "audio-recording-started",
                        "vfo_number": vfo_number,
                        "recording_path": result.get("data", {}).get("recording_path", ""),
                    },
                    logger,
                )

            except Exception as e:
                logger.error(f"Error starting audio recording: {str(e)}")
                logger.exception(e)
                await sio.emit(
                    "file_browser_error",
                    {
                        "error": f"Failed to start audio recording: {str(e)}",
                        "action": "start-audio-recording",
                    },
                )
                reply["success"] = False
                reply["error"] = str(e)

        elif cmd == "stop-audio-recording":
            try:
                sdr_id = data.get("selectedSDRId")
                vfo_number = data.get("vfoNumber")

                result = stop_audio_recording(sdr_id, client_id, vfo_number)
                reply.update(result)

                logger.info(f"Stopped audio recording for VFO {vfo_number}, session {client_id}")

                # Emit file browser state update so all clients see the finalized audio recording
                await emit_file_browser_state(
                    sio,
                    {
                        "action": "audio-recording-stopped",
                        "vfo_number": vfo_number,
                        "recording_path": result.get("data", {}).get("recording_path", ""),
                    },
                    logger,
                )

            except Exception as e:
                logger.error(f"Error stopping audio recording: {str(e)}")
                logger.exception(e)
                await sio.emit(
                    "file_browser_error",
                    {
                        "error": f"Failed to stop audio recording: {str(e)}",
                        "action": "stop-audio-recording",
                    },
                )
                reply["success"] = False
                reply["error"] = str(e)

        elif cmd == "save-waterfall-snapshot":
            try:
                waterfall_image = data.get("waterfallImage", None)
                snapshot_name = data.get("snapshotName", "")

                result = save_waterfall_snapshot(waterfall_image, snapshot_name)

                if result["success"]:
                    reply["success"] = True
                    reply["data"] = {"snapshot_path": result["snapshot_path"]}

                    # Emit file browser state update so all clients see the new snapshot
                    await emit_file_browser_state(
                        sio,
                        {
                            "action": "snapshot-saved",
                            "snapshot_path": result["snapshot_path"],
                        },
                        logger,
                    )
                else:
                    raise Exception(result.get("error", "Unknown error"))

            except Exception as e:
                logger.error(f"Error saving waterfall snapshot: {str(e)}")
                await sio.emit(
                    "file_browser_error",
                    {
                        "error": f"Failed to save waterfall snapshot: {str(e)}",
                        "action": "save-snapshot",
                    },
                )
                reply["success"] = False
                reply["error"] = str(e)

        else:
            logger.error(f"Unknown SDR command: {cmd}")

    return reply


def start_demodulator_for_mode(mode, sdr_id, session_id, logger, vfo_number=None):
    """
    Start the appropriate demodulator based on modulation mode.

    Args:
        mode: Modulation mode (fm, am, usb, lsb)
        sdr_id: SDR device identifier
        session_id: Session identifier
        logger: Logger instance
        vfo_number: VFO number (1-4) for multi-VFO mode

    Returns:
        bool: True if demodulator was started, False otherwise
    """
    mode = mode.lower()

    log_suffix = f" VFO {vfo_number}" if vfo_number else ""

    if mode == "fm":
        result = process_manager.start_demodulator(
            sdr_id, session_id, FMDemodulator, audio_queue, vfo_number=vfo_number
        )
        if result:
            logger.debug(
                f"FM demodulator ensured for session {session_id}{log_suffix} on SDR {sdr_id}"
            )
        return result

    elif mode == "fm_stereo":
        result = process_manager.start_demodulator(
            sdr_id, session_id, FMStereoDemodulator, audio_queue, vfo_number=vfo_number
        )
        if result:
            logger.debug(
                f"FM Stereo demodulator ensured for session {session_id}{log_suffix} on SDR {sdr_id}"
            )
        return result

    elif mode in ["usb", "lsb", "cw"]:
        result = process_manager.start_demodulator(
            sdr_id, session_id, SSBDemodulator, audio_queue, vfo_number=vfo_number, mode=mode
        )
        if result:
            logger.debug(
                f"SSB demodulator ({mode.upper()}) ensured for session {session_id}{log_suffix} on SDR {sdr_id}"
            )
        return result

    elif mode == "am":
        result = process_manager.start_demodulator(
            sdr_id, session_id, AMDemodulator, audio_queue, vfo_number=vfo_number
        )
        if result:
            logger.debug(
                f"AM demodulator ensured for session {session_id}{log_suffix} on SDR {sdr_id}"
            )
        return result

    elif mode == "none":
        # "none" is valid - used when a decoder handles demodulation internally
        logger.debug(f"No demodulator needed for session {session_id}{log_suffix} (mode: none)")
        return True

    else:
        logger.warning(f"Unknown modulation mode: {mode}")
        return False


def _auto_start_transcription(sdr_id, session_id, vfo_number, vfo_state, logger):
    """
    Auto-start transcription for a VFO when its demodulator is started.

    Args:
        sdr_id: SDR device identifier
        session_id: Session identifier
        vfo_number: VFO number (1-4)
        vfo_state: VFO state object containing transcription settings
        logger: Logger instance
    """
    try:
        # Get transcription manager
        transcription_manager = process_manager.transcription_manager
        if not transcription_manager:
            logger.debug("Transcription manager not initialized, skipping auto-start")
            return

        # Avoid repeatedly re-running auto-start flow only when worker is already alive
        # AND settings are unchanged. If settings changed (language/provider/translation),
        # allow start_transcription() to perform the restart.
        desired_provider = getattr(vfo_state, "transcription_provider", "gemini") or "gemini"
        desired_language = vfo_state.transcription_language or "auto"
        desired_translate_to = vfo_state.transcription_translate_to or "none"

        existing_worker = transcription_manager.get_active_transcription_consumer(
            sdr_id, session_id, vfo_number
        )
        if (
            existing_worker
            and existing_worker.is_alive()
            and getattr(existing_worker, "provider_name", None) == desired_provider
            and getattr(existing_worker, "language", None) == desired_language
            and getattr(existing_worker, "translate_to", None) == desired_translate_to
        ):
            logger.debug(
                f"Transcription already active for session {session_id} VFO {vfo_number} "
                f"with matching settings, skipping auto-start"
            )
            return

        # Fetch API keys from preferences
        async def fetch_and_start():
            async with AsyncSessionLocal() as dbsession:
                auth_context = get_auth_context() or {}
                user_id = auth_context.get("user_id")
                preferences = await fetch_integration_preferences_map(dbsession, user_id=user_id)

                # Get provider from VFO state (default to gemini for backward compatibility)
                provider = getattr(vfo_state, "transcription_provider", "gemini") or "gemini"

                # Get the appropriate API key based on provider
                if provider == "gemini":
                    api_key = preferences.get("gemini_api_key", "")
                    if not api_key:
                        logger.debug(
                            "Gemini API key not configured, skipping auto-start transcription"
                        )
                        return
                    transcription_manager.set_gemini_api_key(api_key)
                elif provider == "deepgram":
                    api_key = preferences.get("deepgram_api_key", "")
                    if not api_key:
                        logger.debug(
                            "Deepgram API key not configured, skipping auto-start transcription"
                        )
                        return
                    transcription_manager.set_deepgram_api_key(api_key)

                    # Set Google Translate API key for Deepgram translation
                    google_translate_key = preferences.get("google_translate_api_key", "")
                    transcription_manager.set_google_translate_api_key(google_translate_key)
                else:
                    logger.warning(
                        f"Unknown transcription provider: {provider}, skipping auto-start"
                    )
                    return

                # Get language settings from VFO state
                language = desired_language
                translate_to = desired_translate_to

                # Fetch transmitter and satellite info
                satellite_dict = None
                transmitter_dict = None

                if vfo_state.locked_transmitter_id and vfo_state.locked_transmitter_id != "none":
                    transmitter_dict, satellite_dict = await fetch_transmitter_and_satellite(
                        vfo_state.locked_transmitter_id
                    )

                # Start transcription worker off the Socket.IO event loop.
                success = await asyncio.to_thread(
                    transcription_manager.start_transcription,
                    sdr_id=sdr_id,
                    session_id=session_id,
                    vfo_number=vfo_number,
                    language=language,
                    translate_to=translate_to,
                    provider=provider,
                    satellite=satellite_dict,
                    transmitter=transmitter_dict,
                )

                if success:
                    logger.info(
                        f"Auto-started transcription for VFO {vfo_number} "
                        f"(language={language}, translate_to={translate_to})"
                    )
                else:
                    logger.warning(f"Failed to auto-start transcription for VFO {vfo_number}")

        # Run the async function
        loop = asyncio.get_event_loop()
        if loop.is_running():
            asyncio.ensure_future(fetch_and_start())
        else:
            loop.run_until_complete(fetch_and_start())

    except Exception as e:
        logger.error(f"Error in auto-start transcription: {e}", exc_info=True)


def handle_vfo_demodulator_state(vfo_state, session_id, logger):
    """
    Start or stop demodulator for a specific VFO based on its active state.
    In multi-VFO mode, each active VFO gets its own demodulator.

    Args:
        vfo_state: VFO state object
        session_id: Session identifier
        logger: Logger instance
    """
    if not vfo_state:
        return

    # Get SDR ID from SessionTracker
    sdr_id = session_tracker.get_session_sdr(session_id)
    if not sdr_id:
        return

    vfo_number = vfo_state.vfo_number

    # Start demodulator if VFO is active, stop if not active
    if vfo_state.active:
        # Start appropriate demodulator for this VFO
        demod_started = start_demodulator_for_mode(
            vfo_state.modulation, sdr_id, session_id, logger, vfo_number=vfo_number
        )

        # If demodulator started and transcription is enabled, auto-start transcription
        if demod_started and vfo_state.transcription_enabled:
            transcription_manager = process_manager.transcription_manager
            existing_worker = None
            desired_provider = getattr(vfo_state, "transcription_provider", "gemini") or "gemini"
            desired_language = vfo_state.transcription_language or "auto"
            desired_translate_to = vfo_state.transcription_translate_to or "none"
            if transcription_manager:
                existing_worker = transcription_manager.get_active_transcription_consumer(
                    sdr_id, session_id, vfo_number
                )

            if (
                existing_worker
                and existing_worker.is_alive()
                and getattr(existing_worker, "provider_name", None) == desired_provider
                and getattr(existing_worker, "language", None) == desired_language
                and getattr(existing_worker, "translate_to", None) == desired_translate_to
            ):
                logger.debug(
                    f"Transcription worker already active for VFO {vfo_number} with matching settings, "
                    f"skipping auto-start trigger"
                )
            else:
                logger.info(
                    f"Auto-starting transcription for VFO {vfo_number} (transcription_enabled=True)"
                )
                _auto_start_transcription(sdr_id, session_id, vfo_number, vfo_state, logger)
    else:
        # Stop demodulator for this specific VFO
        process_manager.stop_demodulator(sdr_id, session_id, vfo_number)
        logger.info(f"Stopped demodulator for session {session_id} VFO {vfo_number}")

        # Stop transcription consumer if it's running
        if vfo_state.transcription_enabled:
            transcription_manager = process_manager.transcription_manager
            if transcription_manager:
                logger.info(f"Stopping transcription for deactivated VFO {vfo_number}")
                transcription_manager.stop_transcription(sdr_id, session_id, vfo_number)


def _build_sdr_command_handler(command: str):
    """Create a registry-compatible handler that forwards to the SDR command router."""

    async def _handler(
        sio: Any, data: Optional[Dict], logger: Any, sid: str
    ) -> Dict[str, Union[bool, None, dict, list, str]]:
        return await sdr_command_routing(sio, command, data or {}, logger, sid)

    return _handler


def register_handlers(registry):
    """Register SDR command handlers with the unified command registry."""
    commands = (
        "configure-sdr",
        "start-streaming",
        "stop-streaming",
        "seek-playback",
        "start-recording",
        "stop-recording",
        "start-audio-recording",
        "stop-audio-recording",
        "save-waterfall-snapshot",
    )
    registry.register_batch(
        {
            f"sdr.{command}": (_build_sdr_command_handler(command), "api_call")
            for command in commands
        }
    )
