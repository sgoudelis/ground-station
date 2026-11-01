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

"""Decoder task handler - manages decoder VFO configuration and lifecycle."""

import traceback
from pathlib import Path
from typing import Any, Dict

from sqlalchemy import select

from common.logger import logger
from db import AsyncSessionLocal
from db.models import Satellites, Transmitters
from pipeline.registries.decoderregistry import decoder_registry
from vfos.state import VFOManager

_BACKEND_OVERRIDE_KEYS = {
    "baudrate",
    "deviation",
    "framing",
    "framing_params",
    "differential",
    "af_carrier",
    "sf",
    "bw",
    "cr",
    "sync_word",
    "preamble_len",
    "ldro_mode",
    "implicit_header",
    "payload_length",
    "has_crc",
    "invert_iq",
    "fldro",
    "gnss_sample_rate",
    "gnss_total_channels",
    "gnss_output_rate_ms",
    "gnss_doppler_max",
    "gnss_enable_gps",
    "gnss_enable_galileo",
    "gnss_enable_glonass",
    "gnss_enable_beidou",
    "gnss_enable_qzss",
    "packet_size",
    "sstv_mode",
    "radiosonde_sample_rate",
    "radiosonde_type",
    "radiosonde_save_interval",
}


def map_scheduler_decoder_parameters(decoder_type: str, parameters: Any) -> Dict[str, Any]:
    """Translate persisted scheduler parameter keys into decoder config overrides."""
    if not isinstance(parameters, dict):
        return {}

    decoder_type = str(decoder_type or "").lower()
    frontend_to_backend: Dict[str, str] = {}

    if decoder_type in {"fsk", "gmsk", "gfsk"}:
        frontend_to_backend = {
            f"{decoder_type}_baudrate": "baudrate",
            f"{decoder_type}_framing": "framing",
            f"{decoder_type}_deviation": "deviation",
        }
    elif decoder_type == "bpsk":
        frontend_to_backend = {
            "bpsk_baudrate": "baudrate",
            "bpsk_framing": "framing",
            "bpsk_differential": "differential",
        }
    elif decoder_type == "geoscanimage":
        frontend_to_backend = {
            "geoscanimage_baudrate": "baudrate",
            "geoscanimage_deviation": "deviation",
        }
    elif decoder_type == "aprs":
        frontend_to_backend = {
            "aprs_baudrate": "baudrate",
            "aprs_af_carrier": "af_carrier",
            "aprs_deviation": "deviation",
        }
    elif decoder_type == "lora":
        frontend_to_backend = {
            "lora_sf": "sf",
            "lora_bw": "bw",
            "lora_cr": "cr",
            "lora_sync_word": "sync_word",
            "lora_preamble_len": "preamble_len",
            "lora_ldro_mode": "ldro_mode",
            "lora_implicit_header": "implicit_header",
            "lora_payload_length": "payload_length",
            "lora_has_crc": "has_crc",
            "lora_invert_iq": "invert_iq",
            "lora_fldro": "fldro",
        }
    elif decoder_type == "radiosonde":
        frontend_to_backend = {
            "radiosonde_sample_rate": "radiosonde_sample_rate",
            "radiosonde_type": "radiosonde_type",
            "radiosonde_save_interval": "radiosonde_save_interval",
        }
    elif decoder_type == "sstv":
        frontend_to_backend = {"sstv_mode": "sstv_mode"}

    overrides = {
        backend_key: parameters[frontend_key]
        for frontend_key, backend_key in frontend_to_backend.items()
        if frontend_key in parameters
    }

    # Also accept already-normalized keys for API-created or legacy tasks.
    for key in _BACKEND_OVERRIDE_KEYS:
        if key in parameters and key not in overrides:
            overrides[key] = parameters[key]

    # The scheduler stores GEOSCAN's frame size in a flat UI field, while the
    # decoder configuration service expects framing-specific values to be nested.
    geoscan_frame_size_key = f"{decoder_type}_geoscan_frame_size"
    if (
        parameters.get(f"{decoder_type}_framing") == "geoscan"
        and geoscan_frame_size_key in parameters
    ):
        overrides["framing_params"] = {"frame_size": parameters[geoscan_frame_size_key]}

    if decoder_type == "geoscanimage":
        framing_params = {
            backend_key: parameters[frontend_key]
            for frontend_key, backend_key in {
                "geoscanimage_frame_size": "frame_size",
                "geoscanimage_syncword_threshold": "syncword_threshold",
                "geoscanimage_satellite_id": "satellite_id",
            }.items()
            if frontend_key in parameters
        }
        if framing_params:
            overrides["framing_params"] = framing_params

    return overrides


class DecoderHandler:
    """Handles decoder task configuration and lifecycle for observations."""

    def __init__(self, process_manager: Any):
        """
        Initialize the decoder handler.

        Args:
            process_manager: ProcessManager instance for decoder lifecycle
        """
        self.process_manager = process_manager

    async def start_decoder_task(
        self,
        observation_id: str,
        session_id: str,
        sdr_id: str,
        sdr_config: Dict[str, Any],
        task_config: Dict[str, Any],
        vfo_number: int,
        bundle_dir: Path | None = None,
    ) -> bool:
        """
        Start a decoder task.

        Args:
            observation_id: The observation ID
            session_id: The session ID
            sdr_id: The SDR ID
            sdr_config: SDR configuration dict
            task_config: Task configuration dict
            vfo_number: VFO number to assign (1-10)

        Returns:
            True if decoder started successfully
        """
        try:
            # Get decoder configuration
            transmitter_id = task_config.get("transmitter_id", "none")
            decoder_type = task_config.get("decoder_type", "none")
            if decoder_type == "adsb":
                raise ValueError("ADS-B is available only through a manual VFO")
            decoder_param_overrides = map_scheduler_decoder_parameters(
                decoder_type, task_config.get("parameters")
            )
            center_freq = task_config.get("frequency", sdr_config["center_freq"])
            modulation = task_config.get("modulation", "none")
            # The legacy 40-kHz fallback exceeds the radiosonde worker's 48-kS/s
            # channel limit. API-created sonde tasks need its receiver default.
            default_bandwidth = 20000 if decoder_type == "radiosonde" else 40000
            bandwidth = task_config.get("bandwidth") or default_bandwidth

            # Fetch transmitter and satellite info from database
            transmitter_info = None
            satellite_info = None

            if transmitter_id and transmitter_id != "none":
                transmitter_info, satellite_info = await self._fetch_transmitter_info(
                    transmitter_id, center_freq, bandwidth, task_config
                )
                if transmitter_info:
                    center_freq = transmitter_info["center_frequency"]
                    modulation = transmitter_info.get("mode", modulation)

            # Fallback if no transmitter info available
            if not transmitter_info:
                transmitter_info = {
                    "description": f"Observation {observation_id} Signal",
                    "mode": decoder_type.upper(),
                    "center_frequency": center_freq,
                    "bandwidth": bandwidth,
                }
                logger.warning(
                    f"No transmitter info for observation {observation_id} - using defaults"
                )

            # Configure VFO
            vfo_manager = VFOManager()
            vfo_manager.configure_internal_vfo(
                observation_id=observation_id,
                vfo_number=vfo_number,
                center_freq=center_freq,
                bandwidth=bandwidth,
                modulation=modulation,
                decoder=decoder_type,
                locked_transmitter_id=transmitter_id,
                session_id=session_id,
            )

            logger.info(
                f"Configured VFO {vfo_number} for {decoder_type} decoder on {transmitter_id}"
            )

            # Start decoder process
            decoder_class = decoder_registry.get_decoder_class(decoder_type)
            if not decoder_class:
                logger.warning(f"Decoder class not found for type: {decoder_type}")
                return False

            process_info = self.process_manager.processes.get(sdr_id)
            if not process_info:
                logger.error(f"No SDR process found for {sdr_id}")
                return False

            data_queue = process_info["data_queue"]

            decoder_kwargs = {
                "sdr_id": sdr_id,
                "session_id": session_id,
                "decoder_class": decoder_class,
                "data_queue": data_queue,
                "audio_out_queue": None,  # No audio streaming for observations
                # Automated observations own their decoder artifacts; manual decoder output
                # continues to use the shared decoded directory.
                "output_dir": str(bundle_dir / "decoded") if bundle_dir else "data/decoded",
                "vfo_center_freq": center_freq,
                "vfo": vfo_number,
                "decoder_param_overrides": decoder_param_overrides,
                "caller": "decoderhandler.py:start_decoder_task",
            }

            # Add transmitter config if decoder supports it
            if decoder_registry.supports_transmitter_config(decoder_type):
                decoder_kwargs["satellite"] = satellite_info
                decoder_kwargs["transmitter"] = transmitter_info

            success = self.process_manager.start_decoder(**decoder_kwargs)
            if success:
                logger.info(f"Started {decoder_type} decoder for observation {observation_id}")
                return True
            else:
                logger.error(
                    f"Failed to start {decoder_type} decoder for observation {observation_id}"
                )
                return False

        except Exception as e:
            logger.error(f"Error starting decoder: {e}")
            logger.error(traceback.format_exc())
            return False

    def stop_decoder_task(self, sdr_id: str, session_id: str, vfo_number: int) -> bool:
        """
        Stop a decoder task.

        Args:
            sdr_id: The SDR ID
            session_id: The session ID
            vfo_number: VFO number

        Returns:
            True if decoder stopped successfully
        """
        try:
            self.process_manager.stop_decoder(sdr_id, session_id, vfo_number)
            logger.info(f"Stopped decoder for session {session_id} VFO {vfo_number}")
            return True
        except Exception as e:
            logger.warning(f"Error stopping decoder: {e}")
            return False

    async def _fetch_transmitter_info(
        self, transmitter_id: str, center_freq: float, bandwidth: float, task_config: Dict[str, Any]
    ) -> tuple:
        """
        Fetch transmitter and satellite information from database.

        Args:
            transmitter_id: Transmitter ID
            center_freq: Default center frequency
            bandwidth: Default bandwidth
            task_config: Task configuration dict

        Returns:
            Tuple of (transmitter_info, satellite_info)
        """
        try:
            async with AsyncSessionLocal() as db_session:
                # Fetch transmitter
                result = await db_session.execute(
                    select(Transmitters).where(Transmitters.id == transmitter_id)
                )
                transmitter_record = result.scalar_one_or_none()

                if not transmitter_record:
                    return None, None

                center_freq = task_config.get("frequency", transmitter_record.downlink_low)

                transmitter_info = {
                    "id": transmitter_record.id,
                    "description": transmitter_record.description,
                    "mode": transmitter_record.mode,
                    "baud": transmitter_record.baud,
                    "downlink_low": transmitter_record.downlink_low,
                    "downlink_high": transmitter_record.downlink_high,
                    "center_frequency": center_freq,
                    "bandwidth": bandwidth,
                    "norad_cat_id": transmitter_record.norad_cat_id,
                }

                # Fetch satellite info
                sat_result = await db_session.execute(
                    select(Satellites).where(Satellites.norad_id == transmitter_record.norad_cat_id)
                )
                satellite_record = sat_result.scalar_one_or_none()
                satellite_info = None
                if satellite_record:
                    satellite_info = {
                        "norad_id": satellite_record.norad_id,
                        "name": satellite_record.name,
                        "alternative_name": satellite_record.alternative_name,
                        "status": satellite_record.status,
                        "image": satellite_record.image,
                    }

                logger.info(f"Loaded transmitter {transmitter_record.description} for decoder task")
                return transmitter_info, satellite_info

        except Exception as e:
            logger.warning(f"Failed to fetch transmitter {transmitter_id}: {e}")
            logger.warning(traceback.format_exc())
            return None, None
