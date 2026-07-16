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


import logging
import os
from datetime import datetime

from common.filenames import (
    looks_like_path_input,
    resolve_base_path_within_root,
    sanitize_filename_component,
)
from demodulators.audiorecorder import AudioRecorder
from pipeline.orchestration.processmanager import process_manager

logger = logging.getLogger("audio-recorder-api")


def start_audio_recording(
    sdr_id: str,
    client_id: str,
    vfo_number: int,
    recording_name: str = "",
    target_satellite_norad_id: str = "",
    target_satellite_name: str = "",
    center_frequency: float = 0,
    vfo_frequency: float = 0,
    demodulator_type: str = "",
) -> dict:
    """
    Start audio recording for a VFO.

    Args:
        sdr_id: SDR device identifier
        client_id: Client session identifier
        vfo_number: VFO number (1-4)
        recording_name: Optional custom recording name
        target_satellite_norad_id: Optional satellite NORAD ID
        target_satellite_name: Optional satellite name
        center_frequency: SDR center frequency
        vfo_frequency: VFO frequency
        demodulator_type: Demodulator type (FM, AM, SSB, etc.)

    Returns:
        dict: Result with 'success' (bool), 'data' or 'error' fields

    Raises:
        Exception: If SDR is not streaming or VFO is not active
    """
    # Validate SDR is streaming
    if not process_manager.is_sdr_process_running(sdr_id):
        raise Exception(f"SDR {sdr_id} is not streaming. Start streaming before recording.")

    # Validate VFO is active with a demodulator
    if not process_manager.demodulator_manager.get_active_demodulator(
        sdr_id, client_id, vfo_number
    ):
        raise Exception(
            f"VFO {vfo_number} is not active with a demodulator. Activate VFO before recording."
        )

    # Check if already recording
    if process_manager.audio_recorder_manager.is_vfo_recording(sdr_id, client_id, vfo_number):
        raise Exception(f"VFO {vfo_number} is already recording audio")

    # Generate timestamp
    now = datetime.now()
    timestamp = now.strftime("%Y%m%d_%H%M%S")

    # Use default name if not provided
    if not recording_name or not recording_name.strip():
        recording_name = "audio_recording"
    recording_name = str(recording_name).strip()
    if looks_like_path_input(recording_name):
        logger.warning(
            "Path-like audio recording name received from client %s: %r",
            client_id,
            recording_name,
        )

    # Sanitize filename before appending task metadata.
    recording_name = sanitize_filename_component(recording_name, default="audio_recording")

    # Append VFO number and timestamp
    recording_name_full = f"{recording_name}_vfo{vfo_number}_{timestamp}"

    # Create audio recordings directory
    backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    audio_dir = os.path.join(backend_dir, "data", "audio")
    recording_path = str(resolve_base_path_within_root(audio_dir, recording_name_full))

    # Start recorder
    # Note: Demodulators output audio at 44.1kHz (see FMDemodulator.audio_sample_rate)
    result = process_manager.audio_recorder_manager.start_audio_recorder(
        sdr_id,
        client_id,
        vfo_number,
        AudioRecorder,
        recording_path=recording_path,
        sample_rate=44100,  # Match demodulator output rate
        target_satellite_norad_id=target_satellite_norad_id,
        target_satellite_name=target_satellite_name,
        center_frequency=center_frequency,
        vfo_frequency=vfo_frequency,
        demodulator_type=demodulator_type,
    )

    if result:
        logger.info(f"Started audio recording for VFO {vfo_number}: {recording_path}")
        return {"success": True, "data": {"recording_path": recording_path}}
    else:
        raise Exception("Failed to start audio recorder")


def stop_audio_recording(sdr_id: str, client_id: str, vfo_number: int) -> dict:
    """
    Stop audio recording for a VFO.

    Args:
        sdr_id: SDR device identifier
        client_id: Client session identifier
        vfo_number: VFO number

    Returns:
        dict: Result with 'success' (bool), 'data' or 'error' fields

    Raises:
        Exception: If no active recording found
    """
    # Get the active recorder
    recorder = process_manager.audio_recorder_manager.get_active_recorder(
        sdr_id, client_id, vfo_number
    )

    if not recorder:
        raise Exception(f"No active audio recording for VFO {vfo_number}")

    if not isinstance(recorder, AudioRecorder):
        raise Exception("Invalid recorder type")

    # Get the recording path before stopping
    recording_path = recorder.recording_path

    # Stop the recorder
    process_manager.audio_recorder_manager.stop_audio_recorder(sdr_id, client_id, vfo_number)
    logger.info(f"Stopped audio recording for VFO {vfo_number}")

    return {"success": True, "data": {"recording_path": str(recording_path)}}
