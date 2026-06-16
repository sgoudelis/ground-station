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

"""Transcription task handler - manages transcription worker lifecycle."""

import traceback
from typing import Any, Dict, Optional

from sqlalchemy import select

from common.logger import logger
from crud.preferences import fetch_integration_preferences_map
from db import AsyncSessionLocal
from db.models import Transmitters
from demodulators.amdemodulator import AMDemodulator
from demodulators.fmdemodulator import FMDemodulator
from demodulators.ssbdemodulator import SSBDemodulator
from vfos.state import VFOManager


class TranscriptionHandler:
    """Handles transcription task lifecycle for observations."""

    def __init__(self, process_manager: Any):
        """
        Initialize the transcription handler.

        Args:
            process_manager: ProcessManager instance for transcription lifecycle
        """
        self.process_manager = process_manager

    async def start_transcription_task(
        self,
        observation_id: str,
        session_id: str,
        sdr_id: str,
        sdr_config: Dict[str, Any],
        satellite: Dict[str, Any],
        task_config: Dict[str, Any],
    ) -> bool:
        """
        Start a transcription task.

        This requires starting both a demodulator and transcription worker.

        Args:
            observation_id: The observation ID
            session_id: The session ID
            sdr_id: The SDR ID
            sdr_config: SDR configuration dict
            satellite: Satellite information dict
            task_config: Task configuration dict

        Returns:
            True if transcription started successfully
        """
        try:
            # Get VFO configuration
            transcription_vfo_number = task_config.get("vfo_number", 1)
            vfo_frequency = task_config.get("frequency", sdr_config["center_freq"])
            # Map frontend 'modulation' field to backend 'demodulator_type'
            demodulator_type = task_config.get(
                "modulation", task_config.get("demodulator_type", "FM")
            )
            bandwidth = task_config.get("bandwidth", 40000)
            provider = task_config.get("provider", "gemini")
            language = task_config.get("language", "auto")
            translate_to = task_config.get("translate_to", "none")
            transcription_transmitter_id = task_config.get("transmitter_id", "none")

            # Fetch transmitter info to get frequency if transmitter is specified
            transmitter_dict = None
            if transcription_transmitter_id and transcription_transmitter_id != "none":
                vfo_frequency = await self._fetch_transmitter_frequency(
                    transcription_transmitter_id, vfo_frequency, task_config
                )
                # Also fetch transmitter dict for metadata
                transmitter_dict = await self._fetch_transmitter_dict(transcription_transmitter_id)

            # 1. Configure VFO for transcription
            vfo_manager = VFOManager()
            vfo_manager.configure_internal_vfo(
                observation_id=observation_id,
                vfo_number=transcription_vfo_number,
                center_freq=vfo_frequency,
                bandwidth=bandwidth,
                modulation=demodulator_type,
                decoder="none",  # No decoder, just demodulator
                locked_transmitter_id=transcription_transmitter_id,
                session_id=session_id,
            )

            logger.info(
                f"Configured VFO {transcription_vfo_number} for transcription at {vfo_frequency/1e6:.3f} MHz"
            )

            # 2. Start demodulator for this VFO
            demod_started = self._start_demodulator(
                sdr_id, session_id, demodulator_type, transcription_vfo_number
            )

            if not demod_started:
                logger.error(
                    f"Failed to start demodulator for transcription VFO {transcription_vfo_number}"
                )
                return False

            logger.info(
                f"Started {demodulator_type} demodulator for transcription VFO {transcription_vfo_number}"
            )

            # 3. Get transcription manager and fetch API keys
            transcription_manager = self.process_manager.transcription_manager
            if not transcription_manager:
                logger.error("Transcription manager not initialized")
                return False

            # Fetch API keys from preferences
            async with AsyncSessionLocal() as dbsession:
                # Scheduled/internal observations may not carry an authenticated socket context.
                # Allow task payload to provide explicit owner user_id when available.
                owner_user_id = str(task_config.get("user_id") or "").strip() or None
                preferences = await fetch_integration_preferences_map(
                    dbsession, user_id=owner_user_id
                )

                # Set appropriate API key based on provider
                if provider == "gemini":
                    api_key = preferences.get("gemini_api_key", "")
                    if not api_key:
                        logger.error("Gemini API key not configured")
                        return False
                    self.process_manager.transcription_manager.set_gemini_api_key(api_key)
                elif provider == "deepgram":
                    api_key = preferences.get("deepgram_api_key", "")
                    if not api_key:
                        logger.error("Deepgram API key not configured")
                        return False
                    transcription_manager.set_deepgram_api_key(api_key)

                    # Set Google Translate API key for Deepgram translation
                    google_translate_key = preferences.get("google_translate_api_key", "")
                    transcription_manager.set_google_translate_api_key(google_translate_key)
                else:
                    logger.error(f"Unknown transcription provider: {provider}")
                    return False

                # 4. Start transcription worker
                success = transcription_manager.start_transcription(
                    sdr_id=sdr_id,
                    session_id=session_id,
                    vfo_number=transcription_vfo_number,
                    language=language,
                    translate_to=translate_to,
                    provider=provider,
                    satellite=satellite,
                    transmitter=transmitter_dict,
                )

                if success:
                    logger.info(
                        f"Started transcription for observation {observation_id} VFO {transcription_vfo_number} "
                        f"(provider={provider}, language={language}, translate_to={translate_to})"
                    )
                    return True
                else:
                    logger.error(f"Failed to start transcription for observation {observation_id}")
                    return False

        except Exception as e:
            logger.error(f"Error starting transcription: {e}")
            logger.error(traceback.format_exc())
            return False

    def stop_transcription_task(self, sdr_id: str, session_id: str, vfo_number: int) -> bool:
        """
        Stop a transcription task.

        Args:
            sdr_id: The SDR ID
            session_id: The session ID
            vfo_number: VFO number

        Returns:
            True if transcription stopped successfully
        """
        try:
            # Stop transcription worker first
            transcription_manager = self.process_manager.transcription_manager
            if transcription_manager:
                transcription_manager.stop_transcription(sdr_id, session_id, vfo_number)
                logger.info(f"Stopped transcription for session {session_id} VFO {vfo_number}")

            # Stop demodulator for this VFO
            self.process_manager.stop_demodulator(sdr_id, session_id, vfo_number)
            logger.info(f"Stopped demodulator for transcription VFO {vfo_number}")
            return True
        except Exception as e:
            logger.warning(f"Error stopping transcription/demodulator: {e}")
            return False

    def _start_demodulator(
        self, sdr_id: str, session_id: str, demodulator_type: str, vfo_number: int
    ) -> bool:
        """
        Start a demodulator for transcription.

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
            logger.error(f"Unsupported demodulator type for transcription: {demodulator_type}")
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
                        f"Loaded transmitter {transmitter_record.description} at {frequency/1e6:.3f} MHz for transcription"
                    )
                    return frequency
        except Exception as e:
            logger.warning(f"Failed to fetch transmitter {transmitter_id}: {e}")

        return default_frequency

    async def _fetch_transmitter_dict(self, transmitter_id: str) -> Optional[Dict[str, Any]]:
        """
        Fetch transmitter dict from database.

        Args:
            transmitter_id: Transmitter ID

        Returns:
            Transmitter information dict or None if not found
        """
        try:
            async with AsyncSessionLocal() as db_session:
                result = await db_session.execute(
                    select(Transmitters).where(Transmitters.id == transmitter_id)
                )
                transmitter_record = result.scalar_one_or_none()
                if not transmitter_record:
                    return None

                return {
                    "id": transmitter_record.id,
                    "description": transmitter_record.description,
                    "mode": transmitter_record.mode,
                    "baud": transmitter_record.baud,
                    "downlink_low": transmitter_record.downlink_low,
                    "downlink_high": transmitter_record.downlink_high,
                    "norad_cat_id": transmitter_record.norad_cat_id,
                }
        except Exception as e:
            logger.error(f"Failed to fetch transmitter: {e}")
            return None
