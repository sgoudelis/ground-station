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

"""VFO (Virtual Frequency Oscillator) handlers."""

import asyncio
from typing import Any, Dict, Optional, Union

from sqlalchemy import select

from crud.preferences import fetch_integration_preferences_map
from db import AsyncSessionLocal
from db.models import Satellites, Transmitters
from handlers.entities.sdr import handle_vfo_demodulator_state
from handlers.entities.transcriptionhelpers import fetch_transmitter_and_satellite
from handlers.routing import get_auth_context
from pipeline.config.decoderconfigservice import decoder_config_service
from pipeline.orchestration.processmanager import process_manager
from pipeline.registries.decoderregistry import decoder_registry
from server.startup import audio_queue
from session.service import get_sdr_session, session_service
from session.tracker import session_tracker
from vfos.state import VFOManager

# Module-level cache for decoder parameter overrides from UI
# Key format: "{session_id}_{vfo_number}"
# Value: Dict of decoder-specific parameters (e.g., {"sf": 7, "bw": 125000, ...})
_decoder_param_overrides_cache: Dict[str, Dict[str, Any]] = {}


async def update_vfo_parameters(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Union[bool, dict, str]]:
    """
    Update VFO parameters and manage demodulator state.

    Args:
        sio: Socket.IO server instance
        data: VFO parameters including vfoNumber, frequency, bandwidth, mode, etc.
        logger: Logger instance
        sid: Socket.IO session ID

    Returns:
        Dictionary with success status
    """
    logger.debug(f"Updating VFO parameters, data: {data}")

    if not data:
        return {"success": False, "error": "No data provided"}

    vfomanager = VFOManager()
    vfo_id = data.get("vfoNumber", 0)

    # Get old VFO state BEFORE update to detect changes
    old_vfo_state = vfomanager.get_vfo_state(sid, vfo_id) if vfo_id > 0 else None
    old_locked_transmitter_id = old_vfo_state.locked_transmitter_id if old_vfo_state else None
    old_parameters_enabled = old_vfo_state.parameters_enabled if old_vfo_state else True
    # Track whether a decoder was already running before this VFO update.
    # If the decoder is started within this same update call, we should not
    # immediately force-restart it just because parametersEnabled transitioned
    # from the default in-memory VFO state.
    sdr_id_for_session = session_tracker.get_session_sdr(sid)
    had_running_decoder_before_update = (
        bool(process_manager.get_active_decoder(sdr_id_for_session, sid, vfo_id))
        if (vfo_id > 0 and sdr_id_for_session)
        else False
    )

    # Extract decoder-specific parameters from incoming data (if present)
    # These are sent from the UI when user changes decoder parameters
    # Format example: { baudrate: 9600, deviation: 5000, framing: "ax25", differential: false }
    decoder_param_overrides = {}
    decoder_param_keys = [
        "baudrate",
        "deviation",
        "framing",
        "framing_params",  # Framing-specific parameters (e.g., GEOSCAN frame_size)
        "differential",  # FSK/BPSK/etc
        "af_carrier",
        "pipeline",
        "target_sample_rate",  # Other decoders
        "gnss_sample_rate",
        "gnss_total_channels",
        "gnss_output_rate_ms",
        "gnss_doppler_max",
        "gnss_enable_gps",
        "gnss_enable_galileo",
        "gnss_enable_glonass",
        "gnss_enable_beidou",
        "gnss_enable_qzss",
    ]

    for key in decoder_param_keys:
        if key in data:
            decoder_param_overrides[key] = data[key]

    # Only update cache if we actually have decoder parameter overrides
    # Otherwise, preserve existing cached overrides (don't overwrite with empty dict)
    if decoder_param_overrides:
        logger.debug(f"Decoder parameter overrides from UI: {decoder_param_overrides}")
        # Store overrides in cache for use by handle_vfo_decoder_state and check_decoder_params_changed
        _decoder_param_overrides_cache[f"{sid}_{vfo_id}"] = decoder_param_overrides

    # Update VFO state
    vfomanager.update_vfo_state(
        session_id=sid,
        vfo_id=vfo_id,
        center_freq=(
            int(data["frequency"])
            if "frequency" in data and data["frequency"] is not None
            else None
        ),
        bandwidth=(
            int(data["bandwidth"])
            if "bandwidth" in data and data["bandwidth"] is not None
            else None
        ),
        modulation=data.get("mode") if "mode" in data else None,
        active=data.get("active"),
        selected=data.get("selected"),
        volume=data.get("volume"),
        squelch=data.get("squelch"),
        squelch_mode=data.get("squelchMode"),
        vad_sensitivity=data.get("vadSensitivity"),
        vad_close_delay_ms=data.get("vadCloseDelayMs"),
        transcription_enabled=data.get("transcriptionEnabled"),
        transcription_provider=data.get("transcriptionProvider"),
        transcription_language=data.get("transcriptionLanguage"),
        transcription_translate_to=data.get("transcriptionTranslateTo"),
        decoder=data.get("decoder"),
        locked_transmitter_id=data.get("locked_transmitter_id"),
        parameters_enabled=data.get("parametersEnabled"),
    )

    # Reflect UI VFO selection into SessionTracker via SessionService
    if "selected" in data:
        try:
            if data.get("selected"):
                # Selecting this VFO
                await session_service.select_vfo(sid, vfo_id if vfo_id > 0 else None)
            else:
                # Deselecting this VFO
                await session_service.select_vfo(sid, None)
        except Exception:
            # Be defensive; continue even if tracker update fails
            logger.debug("SessionService.select_vfo update skipped due to error", exc_info=True)

    # Start/stop demodulator based on VFO state (after update)
    if vfo_id > 0:  # Valid VFO (not deselect-all case)
        vfo_state = vfomanager.get_vfo_state(sid, vfo_id)

        # Handle demodulator state changes ONLY if active state or mode was changed in the update
        # This prevents VFO updates (like selecting a different VFO) from starting/stopping demodulators
        # However, skip demodulator management if the VFO is using a raw IQ decoder (e.g., GMSK)
        # as these decoders handle demodulation internally
        if "active" in data or "mode" in data:
            # Check if decoder needs raw IQ using decoder registry
            # If switching to a raw IQ decoder, stop any existing audio demodulator
            if decoder_registry.is_raw_iq_decoder(vfo_state.decoder):
                # Get SDR ID from SessionTracker
                sdr_id = session_tracker.get_session_sdr(sid)
                if sdr_id:
                    # Check if there's an active demodulator for this VFO
                    # and stop it since raw IQ decoders don't need audio demodulators
                    process_info = process_manager.processes.get(sdr_id)
                    if process_info:
                        demod_entry = process_info.get("demodulators", {}).get(sid, {})
                        if isinstance(demod_entry, dict) and vfo_id in demod_entry:
                            logger.info(
                                f"Stopping audio demodulator for VFO {vfo_id} - switching to raw IQ decoder {vfo_state.decoder}"
                            )
                            process_manager.stop_demodulator(sdr_id, sid, vfo_id)

                logger.debug(
                    f"Skipping demodulator for VFO {vfo_id} - decoder {vfo_state.decoder} works on raw IQ"
                )
            else:
                # Normal audio mode (FM/AM/SSB) or audio-based decoder - manage demodulator state
                handle_vfo_demodulator_state(vfo_state, sid, logger)

        # Handle decoder state changes if decoder field was provided OR if active state changed
        # When VFO becomes inactive, we need to stop the decoder as well
        if "decoder" in data or "active" in data:
            await handle_vfo_decoder_state(vfo_state, sid, logger)

        # Handle locked_transmitter_id changes - restart decoder to pick up new transmitter settings
        # Only restart if the VALUE actually changed (not just present in update)
        transmitter_changed = False
        if "locked_transmitter_id" in data and vfo_state.decoder != "none":
            new_locked_transmitter_id = data.get("locked_transmitter_id")
            if old_locked_transmitter_id != new_locked_transmitter_id:
                transmitter_changed = True
                logger.info(
                    f"Locked transmitter changed for VFO {vfo_id} (from {old_locked_transmitter_id} to {new_locked_transmitter_id}) "
                    f"with active decoder {vfo_state.decoder} - restarting decoder"
                )
                await handle_vfo_decoder_state(vfo_state, sid, logger, force_restart=True)

        # Handle parametersEnabled changes - restart decoder with or without custom parameters
        # When disabled, clear the param overrides cache so decoder uses defaults
        # When enabled, use the cached params (if any)
        parameters_enabled_changed = False
        if "parametersEnabled" in data and vfo_state.decoder != "none" and not transmitter_changed:
            new_parameters_enabled = data.get("parametersEnabled", True)
            if old_parameters_enabled != new_parameters_enabled:
                parameters_enabled_changed = True
                override_key = f"{sid}_{vfo_id}"

                if not new_parameters_enabled:
                    # Parameters disabled - clear cache so decoder uses defaults
                    if override_key in _decoder_param_overrides_cache:
                        if had_running_decoder_before_update:
                            logger.info(
                                f"Custom parameters disabled for VFO {vfo_id} - clearing overrides and restarting decoder with defaults"
                            )
                        else:
                            logger.info(
                                f"Custom parameters disabled for VFO {vfo_id} - clearing overrides and using defaults for initial decoder start"
                            )
                        del _decoder_param_overrides_cache[override_key]
                    else:
                        if had_running_decoder_before_update:
                            logger.info(
                                f"Custom parameters disabled for VFO {vfo_id} - restarting decoder with defaults"
                            )
                        else:
                            logger.info(
                                f"Custom parameters disabled for VFO {vfo_id} - using defaults for initial decoder start"
                            )
                else:
                    # Parameters enabled - use cached overrides (if any)
                    if had_running_decoder_before_update:
                        logger.info(
                            f"Custom parameters enabled for VFO {vfo_id} - restarting decoder with custom values"
                        )
                    else:
                        logger.info(
                            f"Custom parameters enabled for VFO {vfo_id} - using custom values for initial decoder start"
                        )

                if had_running_decoder_before_update:
                    await handle_vfo_decoder_state(vfo_state, sid, logger, force_restart=True)
                else:
                    logger.debug(
                        f"Skipping immediate restart for VFO {vfo_id} after parametersEnabled change "
                        f"(no decoder was running before this update)"
                    )

        # Check if decoder parameters changed (requires restart)
        # This handles cases where modulation parameters change (e.g., FSK baudrate, framing, etc.)
        # without changing the transmitter or decoder type
        # Only check if:
        # - Parameters were included in this update (decoder_param_overrides), OR
        # - Parameters are enabled (vfo_state.parameters_enabled) and we have cached overrides
        # Skip if we already restarted due to transmitter or parameters_enabled changes
        override_key = f"{sid}_{vfo_id}"
        has_param_overrides = decoder_param_overrides or (
            vfo_state.parameters_enabled and override_key in _decoder_param_overrides_cache
        )

        if (
            not transmitter_changed
            and not parameters_enabled_changed
            and vfo_state.decoder != "none"
            and vfo_state.active
            and has_param_overrides
        ):
            params_changed = await check_decoder_params_changed(
                sdr_id=session_tracker.get_session_sdr(sid),
                session_id=sid,
                vfo_state=vfo_state,
                logger=logger,
            )
            if params_changed:
                logger.info(
                    f"Decoder parameters changed for VFO {vfo_id} with decoder {vfo_state.decoder} - restarting decoder"
                )
                await handle_vfo_decoder_state(vfo_state, sid, logger, force_restart=True)

    return {"success": True, "data": {}}


async def toggle_transcription(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Union[bool, dict, str]]:
    """
    Toggle transcription for a specific VFO.

    Args:
        sio: Socket.IO server instance
        data: {vfoNumber: int, enabled: bool, model?: str, language?: str}
        logger: Logger instance
        sid: Socket.IO session ID

    Returns:
        Dictionary with success status and updated VFO state
    """
    logger.debug(f"Toggling transcription, data: {data}")

    if not data or "vfoNumber" not in data:
        return {"success": False, "error": "vfoNumber is required"}

    vfo_number = data.get("vfoNumber")
    enabled = data.get("enabled", False)

    logger.info(f"toggle_transcription called: vfo={vfo_number}, enabled={enabled}")

    # Get language, translation, and provider settings
    language = data.get("language", "auto")
    translate_to = data.get("translateTo", "none")
    provider = data.get("provider", "gemini")  # Default to gemini for backward compatibility

    logger.debug(
        f"[VFO {vfo_number}] Transcription settings from frontend: "
        f"provider={provider}, language={language}, translate_to={translate_to}"
    )

    # Get VFO state (may not exist if no SDR is streaming yet)
    vfomanager = VFOManager()
    vfo_state = vfomanager.get_vfo_state(sid, vfo_number)

    # Get SDR ID from session config (not from VFO state which may not have it)
    sdr_session = get_sdr_session(sid)
    sdr_id = sdr_session.get("sdr_id") if sdr_session else None

    # If enabling transcription and SDR is streaming, try to start the worker
    if enabled and sdr_id:
        logger.info(
            f"Starting {provider} transcription for VFO {vfo_number} "
            f"(language={language}, translate_to={translate_to})"
        )

        # Get process manager and transcription manager
        transcription_manager = process_manager.transcription_manager

        if not transcription_manager:
            logger.warning("Transcription manager not initialized, updating VFO state only")
        else:
            # Fetch API key from preferences based on provider
            try:
                async with AsyncSessionLocal() as dbsession:
                    auth_context = get_auth_context() or {}
                    user_id = auth_context.get("user_id")
                    preferences = await fetch_integration_preferences_map(
                        dbsession, user_id=user_id
                    )

                    # Get the appropriate API key based on provider
                    if provider == "gemini":
                        api_key = preferences.get("gemini_api_key", "")
                        if api_key:
                            transcription_manager.set_gemini_api_key(api_key)
                            logger.info("Updated transcription manager with Gemini API key")
                        else:
                            logger.warning("Gemini API key not configured in preferences")
                    elif provider == "deepgram":
                        api_key = preferences.get("deepgram_api_key", "")
                        if api_key:
                            transcription_manager.set_deepgram_api_key(api_key)
                            logger.info("Updated transcription manager with Deepgram API key")

                            # Set Google Translate API key for Deepgram translation
                            google_translate_key = preferences.get("google_translate_api_key", "")
                            transcription_manager.set_google_translate_api_key(google_translate_key)
                            logger.info(
                                "Updated transcription manager with Google Translate API key"
                            )
                        else:
                            logger.warning("Deepgram API key not configured in preferences")
                    else:
                        logger.error(f"Unknown transcription provider: {provider}")
                        api_key = None

                    if api_key:
                        # Fetch transmitter and satellite info
                        satellite_dict = None
                        transmitter_dict = None

                        if (
                            vfo_state
                            and vfo_state.locked_transmitter_id
                            and vfo_state.locked_transmitter_id != "none"
                        ):
                            transmitter_dict, satellite_dict = (
                                await fetch_transmitter_and_satellite(
                                    vfo_state.locked_transmitter_id
                                )
                            )

                        # Start/restart can stop old worker and unsubscribe queues.
                        # Run in a worker thread so Socket.IO event loop stays responsive.
                        success = await asyncio.to_thread(
                            transcription_manager.start_transcription,
                            sdr_id=sdr_id,
                            session_id=sid,
                            vfo_number=vfo_number,
                            language=language,
                            translate_to=translate_to,
                            provider=provider,
                            satellite=satellite_dict,
                            transmitter=transmitter_dict,
                        )

                        if not success:
                            logger.warning(
                                f"Failed to start {provider} transcription worker for VFO {vfo_number}, "
                                f"updating VFO state only"
                            )
            except Exception as e:
                logger.error(
                    f"Error fetching API key for {provider}: {e}, updating VFO state only",
                    exc_info=True,
                )

    elif not enabled and sdr_id:
        # Disabling transcription - stop worker if it exists
        logger.info(f"Stopping transcription for VFO {vfo_number}")

        transcription_manager = process_manager.transcription_manager

        if transcription_manager:
            # Stop can unsubscribe from broadcaster/worker state.
            # Offload to avoid blocking the Socket.IO event loop.
            await asyncio.to_thread(
                transcription_manager.stop_transcription,
                sdr_id=sdr_id,
                session_id=sid,
                vfo_number=vfo_number,
            )

    # Update VFO state
    vfomanager.update_vfo_state(
        session_id=sid,
        vfo_id=vfo_number,
        transcription_enabled=enabled,
        transcription_provider=provider,
        transcription_language=language,
        transcription_translate_to=translate_to,
    )

    # Get updated state
    vfo_state = vfomanager.get_vfo_state(sid, vfo_number)

    logger.info(
        f"Transcription {'enabled' if enabled else 'disabled'} for VFO {vfo_number} (session: {sid})"
    )

    return {
        "success": True,
        "data": {
            "vfoNumber": vfo_number,
            "transcriptionEnabled": vfo_state.transcription_enabled if vfo_state else False,
            "transcriptionLanguage": vfo_state.transcription_language if vfo_state else "auto",
            "transcriptionTranslateTo": (
                vfo_state.transcription_translate_to if vfo_state else "none"
            ),
        },
    }


async def check_decoder_params_changed(sdr_id, session_id, vfo_state, logger):
    """
    Check if decoder parameters have changed compared to the currently running decoder.

    Compares the new configuration (generated from current VFO state) with the
    stored configuration in the running decoder to detect parameter changes that
    require a decoder restart.

    Args:
        sdr_id: SDR device identifier
        session_id: Session identifier
        vfo_state: Current VFO state
        logger: Logger instance

    Returns:
        bool: True if parameters changed and restart is needed, False otherwise
    """
    if not sdr_id:
        return False

    vfo_number = vfo_state.vfo_number
    decoder_name = vfo_state.decoder

    # Get current decoder instance and stored config
    current_decoder = process_manager.get_active_decoder(sdr_id, session_id, vfo_number)
    if not current_decoder:
        # No decoder running, no need to restart
        return False

    # Get the stored decoder entry which contains the config
    process_info = process_manager.processes.get(sdr_id)
    if not process_info:
        return False

    decoders_dict = process_info.get("decoders", {})
    session_decoders = decoders_dict.get(session_id, {})
    decoder_entry = session_decoders.get(vfo_number)

    if not decoder_entry or not isinstance(decoder_entry, dict):
        return False

    old_config = decoder_entry.get("config")
    if not old_config:
        # No stored config, can't compare
        return False

    # Get list of parameters that trigger restart for this decoder type
    restart_params = decoder_registry.get_restart_params(decoder_name)
    if not restart_params:
        # No restart parameters defined for this decoder
        return False

    # Generate new config from current VFO state
    # We need satellite and transmitter info to regenerate config
    transmitter_info = None
    satellite_info = None

    if vfo_state.locked_transmitter_id:
        async with AsyncSessionLocal() as db_session:
            result = await db_session.execute(
                select(Transmitters).where(Transmitters.id == vfo_state.locked_transmitter_id)
            )
            transmitter_record = result.scalar_one_or_none()

            if transmitter_record:
                transmitter_info = {
                    "id": transmitter_record.id,
                    "description": transmitter_record.description,
                    "mode": transmitter_record.mode,
                    "baud": transmitter_record.baud,
                    "downlink_low": transmitter_record.downlink_low,
                    "downlink_high": transmitter_record.downlink_high,
                    "center_frequency": vfo_state.center_freq,
                    "bandwidth": vfo_state.bandwidth,
                    "norad_cat_id": transmitter_record.norad_cat_id,
                }

                # Fetch satellite info
                sat_result = await db_session.execute(
                    select(Satellites).where(Satellites.norad_id == transmitter_record.norad_cat_id)
                )
                satellite_record = sat_result.scalar_one_or_none()

                if satellite_record:
                    satellite_info = {
                        "norad_id": satellite_record.norad_id,
                        "name": satellite_record.name,
                        "alternative_name": satellite_record.alternative_name,
                        "status": satellite_record.status,
                        "image": satellite_record.image,
                    }

    # If no transmitter found, use placeholders (same as in handle_vfo_decoder_state)
    if not transmitter_info:
        transmitter_info = {
            "description": f"VFO {vfo_number} Signal",
            "mode": decoder_name.upper(),
            "center_frequency": vfo_state.center_freq,
            "bandwidth": vfo_state.bandwidth,
        }

    # Generate new config using DecoderConfigService
    # Get decoder parameter overrides from cache (if any)
    override_key = f"{session_id}_{vfo_state.vfo_number}"
    decoder_param_overrides = _decoder_param_overrides_cache.get(override_key, {})

    new_config = decoder_config_service.get_config(
        decoder_type=decoder_name,
        satellite=satellite_info,
        transmitter=transmitter_info,
        overrides=decoder_param_overrides,  # UI parameter overrides
    )

    # Compare only the parameters that trigger restart
    for param in restart_params:
        old_value = getattr(old_config, param, None)
        new_value = getattr(new_config, param, None)

        # Handle list comparisons (e.g., sync_word)
        if isinstance(old_value, list) and isinstance(new_value, list):
            if old_value != new_value:
                logger.info(f"Decoder parameter '{param}' changed: {old_value} -> {new_value}")
                return True
        elif old_value != new_value:
            logger.info(f"Decoder parameter '{param}' changed: {old_value} -> {new_value}")
            return True

    return False


async def handle_vfo_decoder_state(vfo_state, session_id, logger, force_restart=False):
    """
    Start or stop decoder for a specific VFO based on its decoder setting.

    Note: Currently only ONE decoder can run per session. If a VFO has a decoder,
    it takes over the session's decoder slot.

    Args:
        vfo_state: VFO state object
        session_id: Session identifier
        logger: Logger instance
        force_restart: If True, restart decoder even if same type is already running
                      (used when transmitter configuration changes)
    """
    if not vfo_state:
        return

    # Get SDR ID from SessionTracker
    sdr_id = session_tracker.get_session_sdr(session_id)
    if not sdr_id:
        logger.warning(f"No SDR found for session {session_id}")
        return

    vfo_number = vfo_state.vfo_number
    requested_decoder = vfo_state.decoder

    # Use decoder registry to get decoder class
    decoder_class = decoder_registry.get_decoder_class(requested_decoder)

    # Get current decoder state for this specific VFO
    current_decoder = process_manager.get_active_decoder(sdr_id, session_id, vfo_number)

    # Check if VFO is active
    if not vfo_state.active:
        # VFO is not active - stop this VFO's decoder if it exists
        if current_decoder:
            process_manager.stop_decoder(sdr_id, session_id, vfo_number)
            logger.info(f"Stopped decoder for session {session_id} VFO {vfo_number} (VFO inactive)")
        return

    # If decoder is "none" or not registered, stop this VFO's decoder if it exists
    if requested_decoder == "none" or not decoder_class:
        if current_decoder:
            process_manager.stop_decoder(sdr_id, session_id, vfo_number)
            logger.info(f"Stopped decoder for session {session_id} VFO {vfo_number}")
        return

    # This VFO wants a decoder (decoder_class is already set from registry)

    # Check if the same decoder is already running for this VFO
    # Use type() for exact match, not isinstance() which returns True for subclasses
    # This ensures switching between FSKDecoder, GFSKDecoder, etc. triggers a restart
    if current_decoder and type(current_decoder) is decoder_class:
        if not force_restart:
            # Same decoder already running for this VFO, do nothing
            logger.debug(
                f"Decoder {requested_decoder} already running for session {session_id} VFO {vfo_number}"
            )
            return
        else:
            # Force restart requested (e.g., transmitter changed)
            logger.info(
                f"Force restarting {requested_decoder} decoder for session {session_id} VFO {vfo_number} "
                f"(transmitter configuration changed)"
            )
            process_manager.stop_decoder(sdr_id, session_id, vfo_number)
            # Fall through to start new decoder with updated config

    # Stop this VFO's current decoder if it's a different type
    if current_decoder:
        logger.info(
            f"Switching decoder for VFO {vfo_number} from {type(current_decoder).__name__} to {decoder_class.__name__}"
        )
        process_manager.stop_decoder(sdr_id, session_id, vfo_number)

    # Start new decoder for this VFO
    try:
        process_info = process_manager.processes.get(sdr_id)
        if not process_info:
            logger.error(f"No SDR process found for {sdr_id}")
            return

        data_queue = process_info["data_queue"]

        # Get decoder parameter overrides from cache (if any)
        override_key = f"{session_id}_{vfo_number}"
        decoder_param_overrides = _decoder_param_overrides_cache.get(override_key, {})

        # Prepare decoder kwargs
        decoder_kwargs = {
            "sdr_id": sdr_id,
            "session_id": session_id,
            "decoder_class": decoder_class,
            "data_queue": data_queue,
            "audio_out_queue": audio_queue,  # Pass audio queue for UI streaming of demodulated audio
            "output_dir": "data/decoded",
            "vfo_center_freq": vfo_state.center_freq,  # Pass VFO frequency for internal FM demod
            "vfo": vfo_state.vfo_number,  # Pass VFO number for status updates
            "decoder_param_overrides": decoder_param_overrides,  # UI parameter overrides
        }

        # For decoders that support transmitter configuration, pass transmitter dict if available
        if decoder_registry.supports_transmitter_config(requested_decoder):
            transmitter_info = None
            satellite_info = None

            # If VFO is locked to a transmitter, query it from the database
            if vfo_state.locked_transmitter_id:
                async with AsyncSessionLocal() as db_session:
                    result = await db_session.execute(
                        select(Transmitters).where(
                            Transmitters.id == vfo_state.locked_transmitter_id
                        )
                    )
                    transmitter_record = result.scalar_one_or_none()

                    if transmitter_record:
                        # Convert transmitter record to dict
                        transmitter_info = {
                            "id": transmitter_record.id,
                            "description": transmitter_record.description,
                            "mode": transmitter_record.mode,
                            "baud": transmitter_record.baud,
                            "downlink_low": transmitter_record.downlink_low,
                            "downlink_high": transmitter_record.downlink_high,
                            "center_frequency": vfo_state.center_freq,
                            "bandwidth": vfo_state.bandwidth,
                            "norad_cat_id": transmitter_record.norad_cat_id,
                        }
                        logger.info(
                            f"{requested_decoder.upper()} decoder using locked transmitter: {transmitter_record.description} "
                            f"(baud: {transmitter_record.baud}, NORAD: {transmitter_record.norad_cat_id})"
                        )

                        # Fetch satellite info for this transmitter
                        sat_result = await db_session.execute(
                            select(Satellites).where(
                                Satellites.norad_id == transmitter_record.norad_cat_id
                            )
                        )
                        satellite_record = sat_result.scalar_one_or_none()

                        if satellite_record:
                            satellite_info = {
                                "norad_id": satellite_record.norad_id,
                                "name": satellite_record.name,
                                "alternative_name": satellite_record.alternative_name,
                                "status": satellite_record.status,
                                "image": satellite_record.image,
                            }
                            logger.info(
                                f"Loaded satellite info: {satellite_record.name} (NORAD {satellite_record.norad_id})"
                            )
                    else:
                        logger.warning(
                            f"Locked transmitter ID {vfo_state.locked_transmitter_id} not found in database"
                        )

            # If no transmitter locked or not found, create a default placeholder
            if not transmitter_info:
                transmitter_info = {
                    "description": f"VFO {vfo_number} Signal",
                    "mode": requested_decoder.upper(),
                    "center_frequency": vfo_state.center_freq,
                    "bandwidth": vfo_state.bandwidth,
                }
                logger.warning(
                    f"No locked transmitter for {requested_decoder.upper()} decoder on VFO {vfo_number} - using default settings. "
                    f"Lock a transmitter to use its baud rate."
                )

            decoder_kwargs["satellite"] = satellite_info
            decoder_kwargs["transmitter"] = transmitter_info

        # Tag caller for tracing/idempotency in DecoderManager (single-flight guard)
        # Note: ProcessManager.start_decoder forwards **kwargs to DecoderManager.start_decoder
        # so we include a 'caller' hint.
        decoder_kwargs["caller"] = "vfo.py:update_vfo_parameters"
        success = process_manager.start_decoder(**decoder_kwargs)

        if success:
            logger.info(
                f"Started {requested_decoder} decoder for session {session_id} VFO {vfo_number}"
            )
        else:
            logger.error(
                f"Failed to start {requested_decoder} decoder for session {session_id} VFO {vfo_number}"
            )

    except Exception as e:
        logger.error(f"Error starting decoder: {e}")
        logger.exception(e)


def register_handlers(registry):
    """Register VFO handlers with the command registry."""
    registry.register_batch(
        {
            "update-vfo-parameters": (update_vfo_parameters, "api_call"),
            "toggle-transcription": (toggle_transcription, "api_call"),
        }
    )
