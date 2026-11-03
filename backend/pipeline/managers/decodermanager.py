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
import multiprocessing
import os
import signal
import threading
import time

import psutil

from common.audio_queue_config import get_audio_queue_config
from pipeline.config.decoderconfigservice import decoder_config_service
from pipeline.registries.decoderregistry import decoder_registry
from pipeline.registries.demodulatorregistry import demodulator_registry


class DecoderManager:
    """
    Manager for decoder consumers (SSTV, AFSK, Morse, etc.)
    Decoders are special as they consume audio from demodulators
    """

    def __init__(self, processes, demodulator_manager):
        """
        Initialize the decoder manager

        Args:
            processes: Reference to the main processes dictionary from ProcessManager
            demodulator_manager: Reference to DemodulatorManager for creating internal demodulators
        """
        self.logger = logging.getLogger("decoder-manager")
        self.processes = processes
        self.demodulator_manager = demodulator_manager
        self.audio_cfg = get_audio_queue_config()
        # Single-flight guard for starts per (SDR, session, VFO)
        self._start_locks = {}
        # Track start-in-progress and last-start timestamps to coalesce near-simultaneous starts
        self._start_in_progress = {}
        self._last_start_ts = {}
        # Fixed debounce window (ms) for coalescing near-simultaneous non-restart starts
        self._debounce_ms = 250

    def _force_kill_process(self, proc: multiprocessing.Process, name: str) -> None:
        """Immediately terminate and SIGKILL a multiprocessing.Process, best-effort join."""
        try:
            pid = getattr(proc, "pid", None)
            descendant_procs = self._collect_process_descendants(pid)
            self._terminate_processes(descendant_procs, name, signal_name="SIGTERM")

            # Best-effort terminate first
            try:
                proc.terminate()
            except Exception:
                pass

            try:
                proc.join(timeout=0.2)
            except Exception:
                pass

            self._kill_survivor_processes(descendant_procs, name)

            # Unconditional SIGKILL to guarantee exit
            if pid and proc.is_alive():
                try:
                    os.kill(pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                except Exception as e:
                    self.logger.warning(f"Failed to SIGKILL {name} (pid={pid}): {e}")

            # Short reap
            try:
                proc.join(timeout=0.2)
            except Exception:
                pass
        except Exception as e:
            self.logger.warning(f"Error while force-killing process {name}: {e}")

    def _collect_process_descendants(self, parent_pid):
        """
        Capture child processes before forcing the parent down.

        This is required for GNSS: if the decoder gets SIGKILL first, its
        `gnss-sdr` child can be reparented and outlive the decoder.
        """
        if not parent_pid:
            return []
        try:
            return psutil.Process(parent_pid).children(recursive=True)
        except (psutil.NoSuchProcess, psutil.ZombieProcess):
            return []
        except Exception as e:
            self.logger.warning(f"Failed to enumerate child processes for pid={parent_pid}: {e}")
            return []

    def _terminate_processes(self, processes, owner_name: str, signal_name: str) -> None:
        for child in processes:
            try:
                if child.is_running():
                    child.terminate()
            except (psutil.NoSuchProcess, psutil.ZombieProcess):
                continue
            except Exception as e:
                self.logger.warning(
                    f"Failed to send {signal_name} to child pid={child.pid} of {owner_name}: {e}"
                )

    def _kill_survivor_processes(self, processes, owner_name: str) -> None:
        if not processes:
            return

        survivors = []
        for child in processes:
            try:
                if child.is_running():
                    survivors.append(child)
            except (psutil.NoSuchProcess, psutil.ZombieProcess):
                continue
            except Exception:
                continue

        for child in survivors:
            try:
                child.kill()
            except (psutil.NoSuchProcess, psutil.ZombieProcess):
                continue
            except Exception as e:
                self.logger.warning(f"Failed to SIGKILL child pid={child.pid} of {owner_name}: {e}")

    def start_decoder(
        self, sdr_id, session_id, decoder_class, data_queue, audio_out_queue=None, **kwargs
    ):
        """
        Start a decoder thread for a specific session.

        Decoders consume audio from a demodulator and produce decoded data
        (e.g., SSTV images, AFSK packets, Morse code).

        This method automatically creates an internal FM demodulator specifically
        for the decoder if one doesn't already exist for this session.

        Args:
            sdr_id: Device identifier
            session_id: Session identifier (client session ID)
            decoder_class: The decoder class to instantiate (e.g., SSTVDecoder, AFSKDecoder)
            data_queue: Queue where decoded data will be placed (same as SDR data_queue)
            audio_out_queue: Optional queue for streaming demodulated audio to UI (for SSTV/Morse audio monitoring)
            **kwargs: Additional arguments to pass to the decoder constructor

        Returns:
            bool: True if started successfully, False otherwise
        """
        if sdr_id not in self.processes:
            self.logger.warning(f"No SDR process found for device {sdr_id}")
            return False

        process_info = self.processes[sdr_id]

        # Extract VFO number and caller tag from kwargs if provided
        vfo_number = kwargs.get("vfo")
        caller = kwargs.pop("caller", "unknown")

        # Check if decoder already exists for this session and VFO
        decoders_dict = process_info.get("decoders", {})
        session_decoders = decoders_dict.get(session_id, {})

        # Single-flight guard per (SDR, session, VFO)
        lock_key = (sdr_id, session_id, vfo_number)
        lock = self._start_locks.get(lock_key)
        if lock is None:
            lock = threading.Lock()
            self._start_locks[lock_key] = lock

        with lock:
            # Debounce/suppress non-restart callers if a start just happened or is in progress
            key = (sdr_id, session_id, vfo_number)
            now_ms = int(time.time() * 1000)
            in_progress = bool(self._start_in_progress.get(key, False))
            last_ts = int(self._last_start_ts.get(key, 0))
            if caller != "restart":
                if in_progress or (now_ms - last_ts) < self._debounce_ms:
                    return True

                # Proceed with start logic
                # Check if this specific VFO has a decoder
                if vfo_number and vfo_number in session_decoders:
                    existing_entry = session_decoders[vfo_number]
                    existing = (
                        existing_entry.get("instance")
                        if isinstance(existing_entry, dict)
                        else existing_entry
                    )
                    existing_type = type(existing).__name__ if existing is not None else None
                    existing_alive = (
                        bool(getattr(existing, "is_alive", lambda: False)()) if existing else False
                    )

                    if existing is not None and existing_alive:
                        if isinstance(existing, decoder_class):
                            # Already running same type
                            if caller != "restart":
                                return True
                            # Restart wants to replace even same type
                            self.logger.warning(
                                f"Force-replacing alive {existing_type} for {session_id} VFO{vfo_number} due to restart (pid={getattr(existing, 'pid', None)})"
                            )
                            self._force_kill_process(existing, existing_type or "Decoder")
                            try:
                                del decoders_dict[session_id][vfo_number]
                                if not decoders_dict[session_id]:
                                    del decoders_dict[session_id]
                            except Exception:
                                pass
                        else:
                            # Different type is alive
                            if caller != "restart":
                                self.logger.warning(
                                    f"Duplicate start prevented for {session_id} VFO{vfo_number}: "
                                    f"existing {existing_type} (pid={getattr(existing, 'pid', None)}) alive; caller={caller}"
                                )
                                return True
                            # Restart path: force-kill existing first
                            self.logger.warning(
                                f"Force-killing existing decoder before restart for {session_id} VFO{vfo_number}: "
                                f"{existing_type} (pid={getattr(existing, 'pid', None)})"
                            )
                            self._force_kill_process(existing, existing_type or "Decoder")
                            try:
                                del decoders_dict[session_id][vfo_number]
                                if not decoders_dict[session_id]:
                                    del decoders_dict[session_id]
                            except Exception:
                                pass
                    else:
                        # Not alive; if stale map entry exists, drop it so we can start fresh
                        if existing is not None and caller == "restart":
                            try:
                                del decoders_dict[session_id][vfo_number]
                                if not decoders_dict[session_id]:
                                    del decoders_dict[session_id]
                            except Exception:
                                pass

            # If we reach here and an existing different-type was present but not alive, we can proceed.

            # Find decoder name by reverse lookup on class
            decoder_name = None
            for name in decoder_registry.list_decoders():
                if decoder_registry.get_decoder_class(name) == decoder_class:
                    decoder_name = name
                    break

            if not decoder_name:
                self.logger.error(f"Unknown decoder class: {decoder_class.__name__}")
                return False

            # Get decoder capabilities from registry
            caps = decoder_registry.get_capabilities(decoder_name)
            if caps is None:
                self.logger.error("Decoder capabilities unavailable: %s", decoder_name)
                return False
            needs_raw_iq = caps.needs_raw_iq
            needs_internal_demod = caps.needs_internal_demod
            required_demodulator = caps.required_demodulator
            demodulator_mode = caps.demodulator_mode
            if needs_internal_demod and not required_demodulator:
                self.logger.error("Decoder %s requires a demodulator type", decoder_name)
                return False

            # Check if there's an active demodulator for this session
            # If not, or if it's not in internal mode, create an internal demodulator specifically for the decoder
            demod_entry = process_info.get("demodulators", {}).get(session_id)
            internal_demod_created = False

            # Check if we need to create/recreate the internal demodulator
            # For raw IQ decoders, we NEVER need a demodulator
            if needs_raw_iq:
                # Raw IQ decoder (like LoRa, GMSK, GFSK, BPSK) - no demodulator needed
                self.logger.info(
                    f"{decoder_class.__name__} receives raw IQ samples directly from SDR"
                )
                # Skip all demodulator creation logic
            elif needs_internal_demod:
                assert required_demodulator is not None
                # Audio decoder - needs an internal demodulator
                need_to_create_demod = False

                if not demod_entry:
                    need_to_create_demod = True
                    self.logger.info(
                        f"No active demodulator found for session {session_id}. "
                        f"Creating internal {required_demodulator.upper()} demodulator for decoder."
                    )
                else:
                    # demod_entry is a nested dict {vfo_number: {instance, subscription_key}}
                    if isinstance(demod_entry, dict) and vfo_number and vfo_number in demod_entry:
                        # Check specific VFO's demodulator
                        vfo_entry = demod_entry[vfo_number]
                        demodulator = vfo_entry.get("instance")
                        if not getattr(demodulator, "internal_mode", False):
                            need_to_create_demod = True
                            self.logger.info(
                                f"Existing demodulator for session {session_id} VFO {vfo_number} is not in internal mode. "
                                f"Stopping it and creating internal {required_demodulator.upper()} demodulator for decoder."
                            )
                            # Stop only the specific VFO's demodulator
                            self.demodulator_manager.stop_demodulator(
                                sdr_id, session_id, vfo_number
                            )
                    elif isinstance(demod_entry, dict) and vfo_number:
                        # This VFO doesn't have a demodulator yet
                        need_to_create_demod = True
                        self.logger.info(
                            f"No demodulator for VFO {vfo_number} in session {session_id}. "
                            f"Creating internal {required_demodulator.upper()} demodulator for decoder."
                        )

                if need_to_create_demod:
                    # Get the demodulator class from registry
                    demod_class = demodulator_registry.get_demodulator_class(required_demodulator)
                    if not demod_class:
                        self.logger.error(f"Unknown demodulator type: {required_demodulator}")
                        return False

                    # Get VFO center frequency from kwargs if provided
                    vfo_center_freq = kwargs.get("vfo_center_freq", None)

                    # Get default bandwidth from registry
                    demod_bandwidth = demodulator_registry.get_default_bandwidth(
                        required_demodulator
                    )

                    self.logger.info(
                        f"Creating internal {required_demodulator.upper()} demodulator "
                        f"{'('+demodulator_mode.upper()+' mode) ' if demodulator_mode else ''}"
                        f"for {decoder_class.__name__}"
                    )

                    # Start internal demodulator with internal_mode enabled
                    # Note: DemodulatorManager (consumerbase.py) automatically creates an AudioBroadcaster
                    # for every demodulator, so we don't need to create one here
                    demod_kwargs = {
                        "sdr_id": sdr_id,
                        "session_id": session_id,
                        "demodulator_class": demod_class,
                        "audio_queue": None,  # Will be set by demodulator manager
                        "vfo_number": vfo_number,  # Pass VFO number for multi-VFO mode
                        "internal_mode": True,  # Enable internal mode to bypass VFO checks
                        "center_freq": vfo_center_freq,  # Pass VFO frequency
                        "bandwidth": demod_bandwidth,
                    }

                    # Add mode parameter if specified (e.g., "cw" for Morse)
                    if demodulator_mode:
                        demod_kwargs["mode"] = demodulator_mode

                    success = self.demodulator_manager.start_demodulator(**demod_kwargs)

                    if not success:
                        self.logger.error(
                            f"Failed to start internal {required_demodulator.upper()} demodulator for session {session_id}"
                        )
                        return False

                    internal_demod_created = True
                    # Refresh demod_entry to get the newly created demodulator with its audio broadcaster
                    demod_entry = process_info.get("demodulators", {})

            # Get the appropriate queue for the decoder
            if needs_raw_iq:
                # Raw IQ decoder - subscribe to IQ broadcaster like IQRecorder does
                iq_broadcaster = process_info.get("iq_broadcaster")
                if not iq_broadcaster:
                    self.logger.error(f"No IQ broadcaster found for device {sdr_id}")
                    return False

                # Create a unique subscription key for this decoder
                subscription_key = f"decoder:{session_id}"
                if vfo_number:
                    subscription_key += f":vfo{vfo_number}"

                # Subscribe to the broadcaster to get a dedicated IQ queue
                # Use multiprocessing queue for process-based decoders (FSK, BPSK, LoRa, etc.)
                # Increased maxsize from 3 to 10 for better burst handling on slower CPUs (RPi5)
                iq_queue = iq_broadcaster.subscribe(
                    subscription_key, maxsize=10, for_process=True, session_id_hint=session_id
                )

                # Resolve decoder configuration using DecoderConfigService
                # This centralizes all parameter resolution logic
                satellite = kwargs.get("satellite", {})
                transmitter = kwargs.get("transmitter", {})
                decoder_param_overrides = kwargs.get("decoder_param_overrides", {})

                decoder_config = decoder_config_service.get_config(
                    decoder_type=decoder_name,
                    satellite=satellite,
                    transmitter=transmitter,
                    overrides=decoder_param_overrides,  # UI parameter overrides
                )

                # Filter out internal parameters before passing to decoder
                decoder_kwargs = {
                    k: v
                    for k, v in kwargs.items()
                    if k
                    not in [
                        "vfo_center_freq",
                        "satellite",
                        "transmitter",
                        "decoder_param_overrides",
                    ]
                }

                # Add resolved config parameters
                decoder_kwargs["config"] = decoder_config

                # Create and start the decoder with the IQ queue
                decoder = decoder_class(iq_queue, data_queue, session_id, **decoder_kwargs)
                decoder.start()

                # No verbose debug logging by default

                # Store the subscription key for cleanup
                subscription_key_to_store = subscription_key
                audio_broadcaster_instance = None  # Raw IQ decoders don't use audio broadcaster
            else:
                # Audio decoder - subscribe to AudioBroadcaster created by demodulator
                if not internal_demod_created:
                    self.logger.error(f"No internal demodulator created for session {session_id}")
                    return False

                # Get the audio broadcaster from the demodulator entry
                # The demodulator manager (consumerbase.py) automatically creates an AudioBroadcaster
                # for every demodulator and stores it in the demodulator entry
                if (
                    vfo_number
                    and session_id in demod_entry
                    and vfo_number in demod_entry[session_id]
                ):
                    audio_broadcaster = demod_entry[session_id][vfo_number].get("audio_broadcaster")
                    if not audio_broadcaster:
                        self.logger.error(
                            f"No audio broadcaster found for demodulator session {session_id} VFO {vfo_number}"
                        )
                        return False
                else:
                    self.logger.error(
                        f"No demodulator entry found for session {session_id} VFO {vfo_number}"
                    )
                    return False

                # Subscribe decoder to audio broadcaster
                # Use multiprocessing queue for process-based decoders (AFSK, etc.)
                decoder_audio_queue = audio_broadcaster.subscribe(
                    f"decoder:{session_id}",
                    maxsize=self.audio_cfg.audio_decoder_queue_size,
                    for_process=True,
                )

                # Resolve decoder configuration using DecoderConfigService
                # This centralizes all parameter resolution logic
                satellite = kwargs.get("satellite", {})
                transmitter = kwargs.get("transmitter", {})
                decoder_param_overrides = kwargs.get("decoder_param_overrides", {})

                decoder_config = decoder_config_service.get_config(
                    decoder_type=decoder_name,
                    satellite=satellite,
                    transmitter=transmitter,
                    overrides=decoder_param_overrides,  # UI parameter overrides
                )

                # Filter out internal parameters before passing to decoder
                decoder_kwargs = {
                    k: v
                    for k, v in kwargs.items()
                    if k
                    not in [
                        "vfo_center_freq",
                        "satellite",
                        "transmitter",
                        "decoder_param_overrides",
                    ]
                }

                # Add resolved config parameters
                decoder_kwargs["config"] = decoder_config

                # Create and start the decoder with the audio queue from broadcaster
                decoder = decoder_class(
                    decoder_audio_queue, data_queue, session_id, **decoder_kwargs
                )
                decoder.start()

                subscription_key_to_store = None
                audio_broadcaster_instance = audio_broadcaster  # Store for cleanup
                ui_subscription_key_to_store = (
                    None  # UI subscription removed (was causing audio echo)
                )

            # Store reference in multi-VFO structure
            if "decoders" not in process_info:
                process_info["decoders"] = {}
            if session_id not in process_info["decoders"]:
                process_info["decoders"][session_id] = {}

            # Normalized decoder entry shape (Phase 3):
            # processes[sdr_id]["decoders"][session_id][vfo_number] = {
            #   "instance", "subscription_key", "class_name", "vfo_number",
            #   optional flags and references used for cleanup.
            # }
            decoder_info = {
                "instance": decoder,
                "decoder_type": decoder_class.__name__,
                "class_name": decoder_class.__name__,
                "internal_demod": internal_demod_created,  # Track if we created the demod
                "vfo_number": vfo_number,  # Store VFO number for multi-VFO cleanup
                "subscription_key": subscription_key_to_store,  # For raw IQ decoders
                "needs_raw_iq": needs_raw_iq,  # Track if this is a raw IQ decoder
                "audio_broadcaster": audio_broadcaster_instance,  # AudioBroadcaster instance for cleanup
                "ui_subscription_key": (
                    ui_subscription_key_to_store if not needs_raw_iq else None
                ),  # UI subscription key for cleanup
                # Scheduled observations supply their own .gsobs/decoded directory.
                # Preserve it so a decoder restart never falls back to data/decoded.
                "output_dir": kwargs.get("output_dir"),
                "config": (
                    decoder_config if needs_raw_iq or not internal_demod_created else decoder_config
                ),  # Store config for comparison
            }

            # Store under VFO number (multi-VFO mode only)
            if vfo_number:
                process_info["decoders"][session_id][vfo_number] = decoder_info
            else:
                self.logger.error(
                    f"vfo_number is required to start decoder {decoder_class.__name__} for session {session_id}"
                )
                return False

            self.logger.info(
                f"Started {decoder_class.__name__} for session {session_id} on device {sdr_id}"
            )
            # Record last start timestamp for debounce
            self._last_start_ts[key] = int(time.time() * 1000)
            return True

    def stop_decoder(self, sdr_id, session_id, vfo_number=None):
        """
        Stop a decoder thread for a specific session and optionally a specific VFO.

        If an internal FM demodulator was created for this decoder,
        it will also be stopped automatically.

        Args:
            sdr_id: Device identifier
            session_id: Session identifier
            vfo_number: VFO number (1-4). If None, stops all decoders for session

        Returns:
            bool: True if stopped successfully, False otherwise
        """
        if sdr_id not in self.processes:
            return False

        process_info = self.processes[sdr_id]
        decoders = process_info.get("decoders", {})

        if session_id not in decoders:
            return False

        session_decoders = decoders[session_id]

        # If vfo_number is specified, stop only that VFO's decoder
        if vfo_number is not None:
            if vfo_number not in session_decoders:
                self.logger.debug(f"No decoder found for session {session_id} VFO {vfo_number}")
                return False

            # Stop specific VFO decoder
            return self._stop_single_decoder(
                sdr_id, session_id, vfo_number, session_decoders[vfo_number], process_info
            )
        else:
            # Stop all VFO decoders for this session
            success = True
            for vfo_num in list(session_decoders.keys()):
                if not self._stop_single_decoder(
                    sdr_id, session_id, vfo_num, session_decoders[vfo_num], process_info
                ):
                    success = False
            return success

    def _stop_single_decoder(self, sdr_id, session_id, vfo_number, decoder_entry, process_info):
        """
        Internal method to stop a single decoder instance.

        Args:
            sdr_id: Device identifier
            session_id: Session identifier
            vfo_number: VFO number
            decoder_entry: The decoder entry dict
            process_info: Process info dict

        Returns:
            bool: True if stopped successfully, False otherwise
        """
        try:
            # Extract decoder info from entry dict
            decoder = decoder_entry["instance"]
            internal_demod = decoder_entry.get("internal_demod", False)
            subscription_key = decoder_entry.get("subscription_key")  # For raw IQ decoders
            needs_raw_iq = decoder_entry.get("needs_raw_iq", False)
            audio_broadcaster = decoder_entry.get("audio_broadcaster")  # AudioBroadcaster instance

            decoder_name = type(decoder).__name__
            decoder.stop()

            # Perform decoder process cleanup asynchronously to avoid blocking the main thread.
            # Decoders run in separate processes and may take 1-2 seconds to shut down cleanly
            # (flushing buffers, stopping GNU Radio flowgraphs, etc.). If we call decoder.join()
            # synchronously here, the main event loop freezes, causing UI lag when users click
            # "Stop Decoder". Instead, we delegate the join/terminate logic to a background thread
            # that waits up to 5 seconds for graceful shutdown, then forcefully terminates if needed.
            # This ensures responsive UI while still ensuring proper process cleanup.
            def _async_decoder_cleanup():
                """Background thread to wait for decoder process termination without blocking main thread."""
                decoder.join(timeout=5.0)
                if decoder.is_alive():
                    self.logger.warning(
                        f"{decoder_name} did not stop gracefully within 5s, terminating forcefully"
                    )
                    self._force_kill_process(decoder, decoder_name)
                    if decoder.is_alive():
                        self.logger.error(f"{decoder_name} could not be terminated")
                else:
                    self.logger.debug(f"{decoder_name} process cleaned up successfully")

            cleanup_thread = threading.Thread(
                target=_async_decoder_cleanup,
                name=f"cleanup-{decoder_name}-{session_id}",
                daemon=True,
            )
            cleanup_thread.start()

            # If this was a raw IQ decoder, unsubscribe from IQ broadcaster
            if needs_raw_iq and subscription_key:
                iq_broadcaster = process_info.get("iq_broadcaster")
                if iq_broadcaster:
                    iq_broadcaster.unsubscribe(subscription_key)

            # If we have an AudioBroadcaster, unsubscribe UI and decoder, then stop it
            if audio_broadcaster:
                # Unsubscribe decoder
                audio_broadcaster.unsubscribe(f"decoder:{session_id}")
                # UI subscription no longer used (removed to prevent audio echo)
                # Stop the broadcaster
                audio_broadcaster.stop()
                vfo_info = f" VFO {vfo_number}" if vfo_number else ""
                self.logger.info(f"Stopped AudioBroadcaster for session {session_id}{vfo_info}")

            # If we created an internal demodulator for this decoder, stop it too
            # But first check if it still exists and is actually in internal mode
            if internal_demod:
                # Check if a demodulator exists for this session/VFO
                demod_entry = process_info.get("demodulators", {}).get(session_id)
                should_stop_demod = False

                if demod_entry:
                    # Check if this is multi-VFO mode
                    if isinstance(demod_entry, dict) and vfo_number and vfo_number in demod_entry:
                        # Check specific VFO's demodulator
                        vfo_demod = demod_entry[vfo_number].get("instance")
                        # Only stop if it's still in internal mode (not replaced by normal demod)
                        should_stop_demod = getattr(vfo_demod, "internal_mode", False)

                if should_stop_demod:
                    # Get demodulator type name from the instance class
                    demod_class_name = type(vfo_demod).__name__
                    demod_type = "UNKNOWN"
                    for demod_name in demodulator_registry.list_demodulators():
                        registered_demod = demodulator_registry.get_demodulator_class(demod_name)
                        if registered_demod and registered_demod.__name__ == demod_class_name:
                            demod_type = demod_name.upper()
                            break

                    self.logger.info(
                        f"Stopping internal {demod_type} demodulator for session {session_id} VFO {vfo_number}"
                    )
                    self.demodulator_manager.stop_demodulator(sdr_id, session_id, vfo_number)
                else:
                    self.logger.debug(
                        f"Internal demodulator for session {session_id} was already replaced, skipping cleanup"
                    )

            # Delete the decoder entry
            decoders = process_info.get("decoders", {})
            if session_id in decoders and vfo_number in decoders[session_id]:
                del decoders[session_id][vfo_number]
                # If no more VFO decoders, clean up session entry
                if not decoders[session_id]:
                    del decoders[session_id]

            vfo_info = f" VFO {vfo_number}" if vfo_number else ""
            iq_info = (
                " (unsubscribed from IQ broadcaster)" if needs_raw_iq and subscription_key else ""
            )
            self.logger.info(f"Stopped {decoder_name} for session {session_id}{vfo_info}{iq_info}")
            return True

        except Exception as e:
            self.logger.error(f"Error stopping decoder: {str(e)}")
            return False

    def get_active_decoder(self, sdr_id, session_id, vfo_number=None):
        """
        Get the active decoder for a session and optionally a specific VFO.

        Args:
            sdr_id: Device identifier
            session_id: Session identifier
            vfo_number: VFO number (1-4). If None, returns first decoder found

        Returns:
            Decoder instance or None if not found
        """
        if sdr_id not in self.processes:
            return None

        process_info = self.processes[sdr_id]
        decoders = process_info.get("decoders", {})
        session_decoders = decoders.get(session_id)

        if session_decoders is None:
            return None

        # If vfo_number is specified, look for that specific VFO's decoder
        if vfo_number is not None:
            if isinstance(session_decoders, dict) and vfo_number in session_decoders:
                vfo_entry = session_decoders[vfo_number]
                if isinstance(vfo_entry, dict):
                    return vfo_entry.get("instance")
                return vfo_entry
            return None

        # No VFO specified: return first VFO decoder found
        if isinstance(session_decoders, dict):
            for vfo_num in sorted(session_decoders.keys()):
                vfo_entry = session_decoders[vfo_num]
                if isinstance(vfo_entry, dict):
                    return vfo_entry.get("instance")
                return vfo_entry
        return None

    def check_and_restart_decoders(self):
        """
        Deprecated: restart handling is centralized in ProcessLifecycleManager.

        As of 2025-12, decoder restarts are orchestrated exclusively by
        ProcessLifecycleManager based on explicit "decoder-restart-request"
        messages from decoder processes. This method now acts as a no-op to
        avoid double restart races.

        Returns:
            int: Always 0 (no restarts performed)
        """
        # Intentionally disabled to avoid duplicate restart handling.
        return 0

    def _restart_decoder(self, sdr_id, session_id, vfo_number, decoder_entry):
        """
        Restart a single decoder by stopping and re-creating it with the same configuration.

        Args:
            sdr_id: Device identifier
            session_id: Session identifier
            vfo_number: VFO number
            decoder_entry: The decoder entry dict containing config

        Returns:
            bool: True if restart successful, False otherwise
        """
        try:
            # Extract configuration from decoder entry
            decoder_config = decoder_entry.get("config")
            if not decoder_config:
                self.logger.error(
                    f"Cannot restart decoder {session_id} VFO{vfo_number}: no config found"
                )
                return False

            # Get decoder class from registry
            decoder_type = decoder_entry.get("decoder_type")
            if not decoder_type:
                self.logger.error(
                    f"Cannot restart decoder {session_id} VFO{vfo_number}: no decoder type found"
                )
                return False

            decoder_class = None
            for name in decoder_registry.list_decoders():
                cls = decoder_registry.get_decoder_class(name)
                if cls is not None and cls.__name__ == decoder_type:
                    decoder_class = cls
                    break

            if not decoder_class:
                self.logger.error(
                    f"Cannot restart decoder {session_id} VFO{vfo_number}: "
                    f"decoder class {decoder_type} not found in registry"
                )
                return False

            # Get data queue
            process_info = self.processes.get(sdr_id)
            if not process_info:
                return False

            data_queue = process_info.get("data_queue")
            if not data_queue:
                self.logger.error(f"No data queue found for SDR {sdr_id}")
                return False

            # Force kill any existing decoder process for this VFO immediately
            try:
                live_entry = (
                    self.processes.get(sdr_id, {})
                    .get("decoders", {})
                    .get(session_id, {})
                    .get(vfo_number)
                )
                if isinstance(live_entry, dict) and "instance" in live_entry:
                    dec_instance = live_entry["instance"]
                    dec_name = type(dec_instance).__name__
                    self.logger.warning(
                        f"Force-killing existing decoder for {session_id} VFO{vfo_number} before restart"
                    )
                    self._force_kill_process(dec_instance, dec_name)

                    # Perform resource cleanup similar to graceful stop to avoid stale subscriptions
                    try:
                        process_info_local = self.processes.get(sdr_id, {})
                        needs_raw_iq = bool(live_entry.get("needs_raw_iq", False))
                        subscription_key = live_entry.get("subscription_key")
                        audio_broadcaster = live_entry.get("audio_broadcaster")
                        internal_demod = bool(live_entry.get("internal_demod", False))

                        if needs_raw_iq and subscription_key:
                            # Unsubscribe from IQ broadcaster to release the old queue
                            iq_broadcaster = process_info_local.get("iq_broadcaster")
                            if iq_broadcaster:
                                try:
                                    iq_broadcaster.unsubscribe(subscription_key)
                                    self.logger.debug(
                                        f"Unsubscribed {subscription_key} from IQBroadcaster during restart cleanup"
                                    )
                                except Exception:
                                    # Best effort; don't block restart
                                    pass
                        else:
                            # Audio path: unsubscribe decoder, then stop broadcaster
                            # (UI subscription no longer used)
                            if audio_broadcaster:
                                try:
                                    audio_broadcaster.unsubscribe(f"decoder:{session_id}")
                                except Exception:
                                    pass
                                try:
                                    audio_broadcaster.stop()
                                except Exception:
                                    pass

                            # Stop internal demodulator if we created one for this decoder
                            if internal_demod:
                                try:
                                    self.demodulator_manager.stop_demodulator(
                                        sdr_id, session_id, vfo_number
                                    )
                                except Exception:
                                    pass

                    except Exception:
                        # Swallow cleanup errors to ensure restart proceeds
                        pass

                    # Remove from maps to avoid stale references (after cleanup)
                    try:
                        del self.processes[sdr_id]["decoders"][session_id][vfo_number]
                        if not self.processes[sdr_id]["decoders"][session_id]:
                            del self.processes[sdr_id]["decoders"][session_id]
                    except Exception:
                        pass
            except Exception as e:
                self.logger.warning(f"Error while attempting to force-kill existing decoder: {e}")

            # Start new decoder with same configuration (with small retry/backoff for transient conditions)
            self.logger.info(f"Starting new decoder {session_id} VFO{vfo_number}...")
            attempts = 3
            backoffs = [0.0, 0.2, 0.5]  # seconds
            for attempt in range(attempts):
                if attempt > 0:
                    self.logger.warning(
                        f"Retrying decoder start {session_id} VFO{vfo_number} (attempt {attempt+1}/{attempts})"
                    )
                ok = self.start_decoder(
                    sdr_id=sdr_id,
                    session_id=session_id,
                    decoder_class=decoder_class,
                    data_queue=data_queue,
                    vfo=vfo_number,
                    config=decoder_config,
                    caller="restart",
                    output_dir=decoder_entry.get("output_dir"),
                    # Preserve other parameters that might have been used
                    satellite=(
                        decoder_config.satellite if hasattr(decoder_config, "satellite") else {}
                    ),
                    transmitter=(
                        decoder_config.transmitter if hasattr(decoder_config, "transmitter") else {}
                    ),
                )
                if ok:
                    return True
                # backoff then retry
                try:
                    time.sleep(backoffs[min(attempt + 1, len(backoffs) - 1)])
                except Exception:
                    pass

            self.logger.error(
                f"Failed to start decoder after retries for {session_id} VFO{vfo_number}"
            )
            return False

        except Exception as e:
            self.logger.error(f"Error restarting decoder {session_id} VFO{vfo_number}: {e}")
            self.logger.exception(e)
            return False
