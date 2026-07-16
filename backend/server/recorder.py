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


import base64
import logging
import os
import re
from datetime import datetime
from typing import Optional

from common.filenames import (
    looks_like_path_input,
    resolve_base_path_within_root,
    sanitize_filename_component,
)
from demodulators.iqrecorder import IQRecorder
from pipeline.orchestration.processmanager import process_manager

logger = logging.getLogger("recorder")


def start_recording(
    sdr_id: str,
    client_id: str,
    recording_name: str = "",
    target_satellite_norad_id: str = "",
    target_satellite_name: str = "",
) -> dict:
    """
    Start IQ recording for a given SDR and client.

    Args:
        sdr_id: SDR device identifier
        client_id: Client session identifier
        recording_name: Optional custom recording name (auto-generated if empty)
        target_satellite_norad_id: Optional target satellite NORAD ID to include in metadata
        target_satellite_name: Optional target satellite name to include in metadata

    Returns:
        dict: Result with 'success' (bool), 'data' or 'error' fields

    Raises:
        Exception: If SDR is not streaming or recording fails to start
    """
    # Validate SDR is streaming
    if not process_manager.is_sdr_process_running(sdr_id):
        raise Exception(f"SDR {sdr_id} is not streaming. Start streaming before recording.")

    # Generate timestamp
    now = datetime.now()
    date = now.strftime("%Y%m%d")
    time_str = now.strftime("%H%M%S")
    timestamp = f"{date}_{time_str}"

    # Use default name if not provided
    if not recording_name or not recording_name.strip():
        recording_name = "unknown_recording"
    recording_name = str(recording_name).strip()
    if looks_like_path_input(recording_name):
        logger.warning(
            "Path-like recording name received from client %s: %r",
            client_id,
            recording_name,
        )
    recording_name = sanitize_filename_component(recording_name, default="unknown_recording")

    # Append timestamp to recording name
    recording_name_with_timestamp = f"{recording_name}_{timestamp}"

    # Create recordings directory if it doesn't exist
    # Get the backend directory (parent of server/)
    backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    recordings_dir = os.path.join(backend_dir, "data", "recordings")
    recording_path = str(
        resolve_base_path_within_root(recordings_dir, recording_name_with_timestamp)
    )

    # Start recorder
    result = process_manager.start_recorder(
        sdr_id,
        client_id,
        IQRecorder,
        recording_path=recording_path,
        target_satellite_norad_id=target_satellite_norad_id,
        target_satellite_name=target_satellite_name,
    )

    if result:
        logger.info(f"Started IQ recording for client {client_id}: {recording_path}")
        return {"success": True, "data": {"recording_path": recording_path}}
    else:
        raise Exception("Failed to start IQ recorder")


def stop_recording(
    sdr_id: str,
    client_id: str,
    waterfall_image: Optional[str] = None,
    skip_auto_waterfall: bool = False,
) -> dict:
    """
    Stop IQ recording for a given SDR and client.

    Args:
        sdr_id: SDR device identifier
        client_id: Client session identifier
        waterfall_image: Base64 encoded PNG image of the waterfall (optional)
        skip_auto_waterfall: If True, skip automatic waterfall generation (default: False)

    Returns:
        dict: Result with 'success' (bool), 'data' or 'error' fields

    Raises:
        Exception: If no active recording found or recorder type is invalid
    """
    # Get the active recorder (stored separately from demodulators)
    recorder = process_manager.get_active_recorder(sdr_id, client_id)

    if not recorder:
        raise Exception("No active recording found")

    if not isinstance(recorder, IQRecorder):
        raise Exception("Active recorder is not an IQ recorder")

    # Get the recording path before stopping
    recording_path = recorder.recording_path

    # Stop the recorder (this will finalize the SigMF metadata)
    process_manager.stop_recorder(sdr_id, client_id, skip_auto_waterfall)
    logger.info(f"Stopped IQ recording for client {client_id}")

    # Save the waterfall image if provided
    if waterfall_image:
        try:
            # Extract base64 data from data URL
            # Format: data:image/png;base64,iVBORw0KG...
            match = re.match(r"data:image/(\w+);base64,(.+)", waterfall_image)
            if match:
                image_data = match.group(2)
                image_bytes = base64.b64decode(image_data)

                # Save the image with the same name as the recording
                image_path = f"{recording_path}.png"
                with open(image_path, "wb") as f:
                    f.write(image_bytes)

                logger.info(f"Saved waterfall image: {image_path}")
            else:
                logger.warning("Invalid waterfall image data URL format")
        except Exception as e:
            logger.error(f"Failed to save waterfall image: {str(e)}")
            # Don't raise - recording stop should succeed even if image save fails

    return {"success": True}
