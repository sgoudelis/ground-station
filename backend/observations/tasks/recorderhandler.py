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

"""Recorder task handler - manages IQ and audio recording lifecycle."""

import os
import traceback
from datetime import datetime
from typing import Any, Dict, Optional

from sqlalchemy import select

from common.filenames import (
    looks_like_path_input,
    resolve_base_path_within_root,
    sanitize_filename_component,
)
from common.logger import logger
from db import AsyncSessionLocal
from db.models import Transmitters
from demodulators.amdemodulator import AMDemodulator
from demodulators.audiorecorder import AudioRecorder
from demodulators.fmdemodulator import FMDemodulator
from demodulators.iqrecorder import IQRecorder
from demodulators.ssbdemodulator import SSBDemodulator
from vfos.state import VFOManager


class RecorderHandler:
    """Handles IQ and audio recording task lifecycle for observations."""

    def __init__(self, process_manager: Any):
        """
        Initialize the recorder handler.

        Args:
            process_manager: ProcessManager instance for recorder lifecycle
        """
        self.process_manager = process_manager

    async def start_iq_recording_task(
        self,
        observation_id: str,
        session_id: str,
        sdr_id: str,
        satellite: Dict[str, Any],
        task_config: Optional[Dict[str, Any]] = None,
        recorder_id: Optional[str] = None,
    ) -> Optional[str]:
        """
        Start an IQ recording task.

        Args:
            observation_id: The observation ID
            session_id: The session ID
            sdr_id: The SDR ID
            satellite: Satellite information dict

        Returns:
            True if IQ recorder started successfully
        """
        try:
            # Generate timestamp for recording filename
            now = datetime.now()
            date = now.strftime("%Y%m%d")
            time_str = now.strftime("%H%M%S")
            timestamp = f"{date}_{time_str}"

            # Build recording name: satellite_name_timestamp
            raw_satellite_name = str(satellite.get("name", "unknown")).strip() or "unknown"
            if looks_like_path_input(raw_satellite_name):
                logger.warning(
                    "Path-like satellite name detected while building IQ recording filename: %r",
                    raw_satellite_name,
                )
            satellite_name = sanitize_filename_component(raw_satellite_name, default="unknown")
            recording_name = f"{satellite_name}_{timestamp}"

            if recorder_id:
                safe_recorder_id = sanitize_filename_component(
                    recorder_id,
                    default="recorder",
                )
                recording_name = f"{recording_name}_{safe_recorder_id}"

            # Build recording path and enforce that it stays under recordings root.
            backend_dir = os.path.dirname(
                os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
            )
            recordings_dir = os.path.join(backend_dir, "data", "recordings")
            recording_path = str(resolve_base_path_within_root(recordings_dir, recording_name))

            # Extract frequency shift parameters from task config
            task_config = task_config or {}
            enable_frequency_shift = task_config.get("enable_frequency_shift", False)
            target_center_freq = task_config.get("target_center_freq")
            decimation_factor = task_config.get("decimation_factor", 1)

            # Build recorder kwargs
            recorder_kwargs = {
                "recording_path": recording_path,
                "target_satellite_norad_id": str(satellite.get("norad_id", "")),
                "target_satellite_name": satellite.get("name", ""),
                "decimation_factor": decimation_factor,
            }

            # Add frequency shift parameters if enabled
            if enable_frequency_shift and target_center_freq:
                recorder_kwargs["enable_frequency_shift"] = True
                recorder_kwargs["target_center_freq"] = float(target_center_freq)
                logger.info(
                    f"IQ recording will use frequency shift: target={target_center_freq/1e6:.3f} MHz"
                )
            if decimation_factor and int(decimation_factor) > 1:
                logger.info(f"IQ recording will use decimation: {decimation_factor}x")

            # Start IQ recorder
            success = self.process_manager.start_recorder(
                sdr_id,
                session_id,
                IQRecorder,
                recorder_id=recorder_id,
                **recorder_kwargs,
            )

            if success:
                logger.info(
                    f"Started IQ recording for observation {observation_id}: {recording_path}"
                )
                return recording_path

            logger.error(f"Failed to start IQ recording for observation {observation_id}")
            return None

        except Exception as e:
            logger.error(f"Error starting IQ recorder: {e}")
            logger.error(traceback.format_exc())
            return None

    async def start_audio_recording_task(
        self,
        observation_id: str,
        session_id: str,
        sdr_id: str,
        sdr_config: Dict[str, Any],
        satellite: Dict[str, Any],
        task_config: Dict[str, Any],
    ) -> bool:
        """
        Start an audio recording task.

        This requires starting both a demodulator and audio recorder.

        Args:
            observation_id: The observation ID
            session_id: The session ID
            sdr_id: The SDR ID
            sdr_config: SDR configuration dict
            satellite: Satellite information dict
            task_config: Task configuration dict

        Returns:
            True if audio recorder started successfully
        """
        try:
            # Get VFO configuration
            audio_vfo_number = task_config.get("vfo_number", 1)
            vfo_frequency = task_config.get("frequency", sdr_config["center_freq"])
            # Map frontend 'demodulator' field to backend 'demodulator_type'
            demodulator_type = task_config.get(
                "demodulator", task_config.get("demodulator_type", "FM")
            )
            bandwidth = task_config.get("bandwidth", 40000)
            # Get transmitter ID for doppler correction (if available)
            audio_transmitter_id = task_config.get("transmitter_id", "none")

            # Fetch transmitter frequency if transmitter is specified
            if audio_transmitter_id and audio_transmitter_id != "none":
                vfo_frequency = await self._fetch_transmitter_frequency(
                    audio_transmitter_id, vfo_frequency, task_config
                )

            # 1. Configure VFO for audio recording
            vfo_manager = VFOManager()
            vfo_manager.configure_internal_vfo(
                observation_id=observation_id,
                vfo_number=audio_vfo_number,
                center_freq=vfo_frequency,
                bandwidth=bandwidth,
                modulation=demodulator_type,
                decoder="none",  # No decoder, just demodulator
                locked_transmitter_id=audio_transmitter_id,
                session_id=session_id,
            )

            logger.info(
                f"Configured VFO {audio_vfo_number} for audio recording at {vfo_frequency/1e6:.3f} MHz"
            )

            # 2. Start demodulator for this VFO
            demod_started = self._start_demodulator(
                sdr_id, session_id, demodulator_type, audio_vfo_number
            )

            if not demod_started:
                logger.error(
                    f"Failed to start demodulator for audio recording VFO {audio_vfo_number}"
                )
                return False

            logger.info(
                f"Started {demodulator_type} demodulator for audio recording VFO {audio_vfo_number}"
            )

            # 3. Generate recording path
            now = datetime.now()
            timestamp = now.strftime("%Y%m%d_%H%M%S")

            raw_satellite_name = str(satellite.get("name", "unknown_satellite")).strip()
            if looks_like_path_input(raw_satellite_name):
                logger.warning(
                    "Path-like satellite name detected while building audio recording filename: %r",
                    raw_satellite_name,
                )
            recording_name = sanitize_filename_component(raw_satellite_name, default="unknown")
            recording_name_full = f"{recording_name}_vfo{audio_vfo_number}_{timestamp}"

            # Create audio recordings directory
            backend_dir = os.path.dirname(
                os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
            )
            audio_dir = os.path.join(backend_dir, "data", "audio")
            recording_path = str(resolve_base_path_within_root(audio_dir, recording_name_full))

            # 4. Start audio recorder
            success = self.process_manager.audio_recorder_manager.start_audio_recorder(
                sdr_id,
                session_id,
                audio_vfo_number,
                AudioRecorder,
                recording_path=recording_path,
                sample_rate=44100,  # Match demodulator output rate
                target_satellite_norad_id=str(satellite.get("norad_id", "")),
                target_satellite_name=satellite.get("name", ""),
                center_frequency=sdr_config["center_freq"],
                vfo_frequency=vfo_frequency,
                demodulator_type=demodulator_type,
            )

            if success:
                logger.info(
                    f"Started audio recording for observation {observation_id} VFO {audio_vfo_number}: {recording_path}"
                )
                return True
            else:
                logger.error(f"Failed to start audio recording for observation {observation_id}")
                return False

        except Exception as e:
            logger.error(f"Error starting audio recorder: {e}")
            logger.error(traceback.format_exc())
            return False

    def stop_iq_recording_task(
        self, sdr_id: str, session_id: str, skip_auto_waterfall: bool = False
    ) -> bool:
        """
        Stop an IQ recording task.

        Args:
            sdr_id: The SDR ID
            session_id: The session ID

        Returns:
            True if IQ recorder stopped successfully
        """
        try:
            self.process_manager.stop_recorder(
                sdr_id, session_id, skip_auto_waterfall=skip_auto_waterfall
            )
            logger.info(f"Stopped IQ recorder for session {session_id}")
            return True
        except Exception as e:
            logger.warning(f"Error stopping IQ recorder: {e}")
            return False

    def stop_audio_recording_task(self, sdr_id: str, session_id: str, vfo_number: int) -> bool:
        """
        Stop an audio recording task.

        Args:
            sdr_id: The SDR ID
            session_id: The session ID
            vfo_number: VFO number

        Returns:
            True if audio recorder stopped successfully
        """
        try:
            # Stop audio recorder first
            self.process_manager.audio_recorder_manager.stop_audio_recorder(
                sdr_id, session_id, vfo_number
            )
            logger.info(f"Stopped audio recorder for session {session_id} VFO {vfo_number}")

            # Stop demodulator for this VFO
            self.process_manager.stop_demodulator(sdr_id, session_id, vfo_number)
            logger.info(f"Stopped demodulator for audio recording VFO {vfo_number}")
            return True
        except Exception as e:
            logger.warning(f"Error stopping audio recorder/demodulator: {e}")
            return False

    def _start_demodulator(
        self, sdr_id: str, session_id: str, demodulator_type: str, vfo_number: int
    ) -> bool:
        """
        Start a demodulator for audio recording or transcription.

        Args:
            sdr_id: The SDR ID
            session_id: The session ID
            demodulator_type: Demodulator type (FM, USB, LSB, CW, AM)
            vfo_number: VFO number

        Returns:
            True if demodulator started successfully
        """
        demod_type_lower = demodulator_type.lower()

        if demod_type_lower == "fm":
            result: bool = self.process_manager.start_demodulator(
                sdr_id, session_id, FMDemodulator, None, vfo_number=vfo_number
            )
            return result
        elif demod_type_lower in ["usb", "lsb", "cw"]:
            result = self.process_manager.start_demodulator(
                sdr_id,
                session_id,
                SSBDemodulator,
                None,
                vfo_number=vfo_number,
                mode=demod_type_lower,
            )
            return result
        elif demod_type_lower == "am":
            result = self.process_manager.start_demodulator(
                sdr_id, session_id, AMDemodulator, None, vfo_number=vfo_number
            )
            return result
        else:
            logger.error(f"Unsupported demodulator type: {demodulator_type}")
            return False

    async def _fetch_transmitter_frequency(
        self, transmitter_id: str, default_frequency: float, task_config: Dict[str, Any]
    ) -> float:
        """
        Fetch transmitter frequency from database.

        Args:
            transmitter_id: Transmitter ID
            default_frequency: Default frequency
            task_config: Task configuration dict

        Returns:
            Transmitter frequency or default
        """
        try:
            async with AsyncSessionLocal() as db_session:
                result = await db_session.execute(
                    select(Transmitters).where(Transmitters.id == transmitter_id)
                )
                transmitter_record = result.scalar_one_or_none()
                if transmitter_record:
                    frequency: float = float(
                        task_config.get("frequency", transmitter_record.downlink_low)
                    )
                    logger.info(
                        f"Loaded transmitter {transmitter_record.description} at {frequency/1e6:.3f} MHz"
                    )
                    return frequency
        except Exception as e:
            logger.warning(f"Failed to fetch transmitter {transmitter_id}: {e}")

        return default_frequency
