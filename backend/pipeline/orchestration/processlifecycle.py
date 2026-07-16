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
import logging
import multiprocessing
import os
from typing import Dict, Tuple

import numpy as np

from common.constants import DictKeys, QueueMessageTypes, SocketEvents
from common.sdrconfig import SDRConfig
from fft.processor import fft_processor_process
from handlers.entities.filebrowser import emit_file_browser_state
from pipeline.orchestration.gnssfix import derive_gnss_fix_status_from_output, gnss_fix_stream_key
from pipeline.orchestration.gnsssatelliteresolver import GnssSatelliteResolver
from pipeline.streaming.iqbroadcaster import IQBroadcaster
from vfos.state import VFOManager
from workers.airspyhfworker import airspyhf_worker_process
from workers.airspyworker import airspy_worker_process
from workers.rtlsdrworker import rtlsdr_worker_process
from workers.sigmfplaybackworker import sigmf_playback_worker_process
from workers.uhdworker import uhd_worker_process

# Add setproctitle import for process naming
try:
    import setproctitle

    _HAS_SETPROCTITLE = True
except ImportError:
    _HAS_SETPROCTITLE = False


def _load_soapy_worker_process(connection_type):
    """
    Import SoapySDR workers lazily so unit-test collection does not fail when
    optional SoapySDR Python bindings are not installed.
    """
    if connection_type == "soapysdrremote":
        from workers.soapysdrremoteworker import soapysdr_remote_worker_process

        return soapysdr_remote_worker_process
    if connection_type == "soapysdrlocal":
        from workers.soapysdrlocalworker import soapysdr_local_worker_process

        return soapysdr_local_worker_process
    raise ValueError(f"Unsupported SoapySDR connection type: {connection_type}")


def _create_named_worker_process(worker_func, process_name, *args):
    """
    Wrap a worker function to name the process before it runs.
    """

    def named_worker(*args):
        # Set the process title if available
        if _HAS_SETPROCTITLE:
            setproctitle.setproctitle(process_name)

        # Set the multiprocessing process name
        multiprocessing.current_process().name = process_name

        # Call the actual worker function
        worker_func(*args)

    return named_worker


class ProcessLifecycleManager:
    """
    Manager for SDR process lifecycle (start, stop, configure, monitor)
    """

    def __init__(
        self,
        processes,
        sio,
        demodulator_manager,
        recorder_manager,
        decoder_manager,
        audio_recorder_manager=None,
        transcription_manager=None,
    ):
        """
        Initialize the process lifecycle manager

        Args:
            processes: Reference to the main processes dictionary
            sio: Socket.IO server instance
            demodulator_manager: DemodulatorManager instance
            recorder_manager: RecorderManager instance
            decoder_manager: DecoderManager instance
            audio_recorder_manager: AudioRecorderManager instance (optional)
            transcription_manager: TranscriptionManager instance (optional)
        """
        self.logger = logging.getLogger("process-lifecycle")
        self.processes = processes
        self.sio = sio
        self.demodulator_manager = demodulator_manager
        self.recorder_manager = recorder_manager
        self.decoder_manager = decoder_manager
        self.audio_recorder_manager = audio_recorder_manager
        self.transcription_manager = transcription_manager
        # Optional trace logging toggle
        try:
            self._trace = str(os.environ.get("GS_DECODER_TRACE", "")).lower() in (
                "1",
                "true",
                "yes",
            )
        except Exception:
            self._trace = False
        # Per-(SDR, session, VFO) restart serialization locks
        self._restart_locks = {}
        # Track last known fix state per GNSS stream so backend can mark fix acquire/loss transitions.
        self._gnss_fix_status_by_stream: Dict[Tuple[str, str], str] = {}
        self.gnsssatelliteresolver = GnssSatelliteResolver(logger=self.logger)

    async def _enrich_gnss_output(self, data):
        """
        Attach backend-resolved GNSS metadata to decoder output messages.

        This runs on the server-side queue fanout path so frontend consumers do not
        need per-message DB queries or duplicate fix transition logic.
        """
        if data.get("decoder_type") != "gnss":
            return

        output = data.get("output")
        if not isinstance(output, dict):
            return

        # Backend-authoritative fix status/transition marker used by the frontend lifecycle reducer.
        fix_status = derive_gnss_fix_status_from_output(output)
        if fix_status:
            output["gnss_fix_status"] = fix_status
            stream_key = gnss_fix_stream_key(data)
            previous_status = self._gnss_fix_status_by_stream.get(stream_key)
            status_changed = previous_status != fix_status
            output["gnss_fix_status_changed"] = status_changed
            if status_changed:
                output["gnss_fix_transition"] = "acquired" if fix_status == "FIX" else "lost"
            else:
                output.pop("gnss_fix_transition", None)
            self._gnss_fix_status_by_stream[stream_key] = fix_status

        try:
            match = await self.gnsssatelliteresolver.resolve_from_output(output)
        except Exception as exc:
            self.logger.debug(f"GNSS NORAD enrichment failed: {exc}")
            return

        if match:
            output["satellite_norad_id"] = match["norad_id"]
            output["satellite_name"] = match["name"]

    async def get_center_frequency(self, sdr_id):
        """
        Get the current center frequency of an SDR worker process

        Args:
            sdr_id: Device identifier

        Returns:
            float: Current center frequency in Hz, or None if process not found/running
        """
        if sdr_id not in self.processes or not self.processes[sdr_id]["process"].is_alive():
            self.logger.warning(f"No running SDR process found for device {sdr_id}")
            return None

        process_info = self.processes[sdr_id]

        # Create a temporary queue for receiving the response
        response_queue: multiprocessing.Queue = multiprocessing.Queue()

        # Send a request to the worker process to get the center frequency
        request = {
            DictKeys.TYPE: QueueMessageTypes.GET_CENTER_FREQ,
            "response_queue": response_queue,
        }

        process_info["config_queue"].put(request)

        # Wait for the response with a timeout
        try:
            # Poll the queue for a response with a timeout
            for _ in range(50):  # Wait up to 5 seconds
                if not response_queue.empty():
                    response = response_queue.get()
                    if "center_freq" in response:
                        return response["center_freq"]
                    else:
                        self.logger.error(
                            f"Invalid response format from SDR process for device {sdr_id}"
                        )
                        return None
                await asyncio.sleep(0.1)

            self.logger.warning(
                f"Timeout waiting for center frequency from SDR process for device {sdr_id}"
            )
            return None
        except Exception as e:
            self.logger.error(
                f"Error getting center frequency from SDR process for device {sdr_id}: {str(e)}"
            )
            return None

    async def start_sdr_process(self, sdr_device, sdr_config, client_id):
        """
        Start an SDR worker process

        Args:
            sdr_device: Dictionary with device connection parameters
            sdr_config: Dictionary with configuration parameters
            client_id: Client identifier

        Returns:
            The device ID for the started process
        """

        assert self.sio is not None, (
            "Socket.IO server instance not set when setting up SDR process manager."
            " Please call set_sio() first."
        )
        assert sdr_device["type"] in [
            "rtlsdrusbv3",
            "rtlsdrtcpv3",
            "rtlsdrusbv4",
            "rtlsdrtcpv4",
            "airspy",
            "airspyhf",
            "soapysdrremote",
            "soapysdrlocal",
            "uhd",
            "sigmfplayback",
        ]
        assert sdr_device["id"]

        sdr_id = sdr_device["id"]
        connection_type = None
        hostname = None
        port = None
        driver = None
        worker_process = None
        process_name = None

        if sdr_device["type"] == "rtlsdrusbv3":
            connection_type = "usb"
            driver = None
            worker_process = rtlsdr_worker_process
            process_name = f"Ground Station - RTL-SDR-USB-v3-{sdr_id}"

        elif sdr_device["type"] == "rtlsdrtcpv3":
            hostname = sdr_device["host"]
            port = sdr_device["port"]
            connection_type = "tcp"
            driver = None
            worker_process = rtlsdr_worker_process
            process_name = f"Ground Station - RTL-SDR-TCP-v3-{sdr_id}"

        elif sdr_device["type"] == "rtlsdrusbv4":
            connection_type = "usb"
            driver = None
            worker_process = rtlsdr_worker_process
            process_name = f"Ground Station - RTL-SDR-USB-v4-{sdr_id}"

        elif sdr_device["type"] == "rtlsdrtcpv4":
            hostname = sdr_device["host"]
            port = sdr_device["port"]
            connection_type = "tcp"
            driver = None
            worker_process = rtlsdr_worker_process
            process_name = f"Ground Station - RTL-SDR-TCP-v4-{sdr_id}"

        elif sdr_device["type"] == "airspy":
            connection_type = "airspy"
            driver = "airspy"
            worker_process = airspy_worker_process
            process_name = f"Ground Station - Airspy-Worker-{sdr_id}"

        elif sdr_device["type"] == "airspyhf":
            connection_type = "airspyhf"
            driver = "airspyhf"
            worker_process = airspyhf_worker_process
            process_name = f"Ground Station - AirspyHF-Worker-{sdr_id}"

        elif sdr_device["type"] == "soapysdrremote":
            hostname = sdr_device["host"]
            port = sdr_device["port"]
            connection_type = "soapysdrremote"
            driver = sdr_device["driver"]
            worker_process = _load_soapy_worker_process(connection_type)
            process_name = f"Ground Station - SoapySDR-Remote-{sdr_id}"

        elif sdr_device["type"] == "soapysdrlocal":
            connection_type = "soapysdrlocal"
            driver = sdr_device["driver"]
            worker_process = _load_soapy_worker_process(connection_type)
            process_name = f"Ground Station - SoapySDR-Local-{sdr_id}"

        elif sdr_device["type"] == "uhd":
            connection_type = "uhd"
            driver = "uhd"
            worker_process = uhd_worker_process
            process_name = f"Ground Station - UHD-Worker-{sdr_id}"

        elif sdr_device["type"] == "sigmfplayback":
            connection_type = "sigmfplayback"
            driver = "sigmfplayback"
            worker_process = sigmf_playback_worker_process
            process_name = f"Ground Station - SigMF-Playback-{sdr_id}"

        # Check if a process for this device already exists
        if sdr_id in self.processes and self.processes[sdr_id]["process"].is_alive():
            self.logger.info(
                f"SDR process for device {sdr_id} already running, adding client {client_id} to room"
            )

            # Add the client to the existing process
            self.processes[sdr_id]["clients"].add(client_id)

            self.logger.info(
                f"Active clients for SDR {sdr_id}: {self.processes[sdr_id]['clients']}"
            )

            # Update the configuration if needed
            config = {"client_id": client_id}

            # Add optional parameters
            for param in [
                "fft_size",
                "fft_window",
                "fft_overlap_percent",
                "fft_overlap_depth",
                "sample_rate",
                "center_freq",
                "gain",
                "bias_t",
                "tuner_agc",
                "rtl_agc",
                "soapy_agc",
                "antenna",
                "offset_freq",
                "ppm_error",
                "recording_path",
                "loop_playback",
                "seek_seconds",
                "sdr_settings",
            ]:
                if param in sdr_config:
                    config[param] = sdr_config[param]

            # Send configuration to the process
            self.processes[sdr_id]["config_queue"].put(config)

            # Notify all other clients about the configuration change
            other_clients = [c for c in self.processes[sdr_id]["clients"] if c != client_id]
            if other_clients:
                # Build the full config dict to send to clients
                notification_config = {
                    "center_freq": config.get("center_freq", sdr_config.get("center_freq")),
                    "sample_rate": config.get("sample_rate", sdr_config.get("sample_rate")),
                    "gain": config.get("gain", sdr_config.get("gain")),
                    "fft_size": config.get("fft_size", sdr_config.get("fft_size")),
                    "fft_window": config.get("fft_window", sdr_config.get("fft_window")),
                    "fft_overlap_percent": config.get(
                        "fft_overlap_percent", sdr_config.get("fft_overlap_percent", 0)
                    ),
                    "fft_overlap_depth": config.get(
                        "fft_overlap_depth", sdr_config.get("fft_overlap_depth", 16)
                    ),
                    "bias_t": config.get("bias_t", sdr_config.get("bias_t", False)),
                    "tuner_agc": config.get("tuner_agc", sdr_config.get("tuner_agc", False)),
                    "rtl_agc": config.get("rtl_agc", sdr_config.get("rtl_agc", False)),
                    "fft_averaging": sdr_config.get("fft_averaging", 1),
                }
                for other_client in other_clients:
                    await self.sio.emit("sdr-config", notification_config, room=other_client)
                self.logger.info(
                    f"Notified {len(other_clients)} client(s) about SDR config change for {sdr_id}"
                )

            # Add this client to the room (skip for internal observation sessions)
            if not VFOManager.is_internal_session(client_id):
                await self.sio.enter_room(client_id, sdr_id)
                # Send a message to the UI of the specific client that streaming started
                await self.sio.emit(SocketEvents.SDR_STATUS, {"streaming": True}, room=client_id)

            return sdr_id

        else:
            # New process, create communication queues and events
            config_queue: multiprocessing.Queue = multiprocessing.Queue()
            data_queue: multiprocessing.Queue = multiprocessing.Queue()

            # Separate IQ queues for FFT and demodulation to avoid contention
            # FFT can drop frames (visual only), but demod needs moderate buffering
            # Target: ~250ms of buffering (good balance between gaps and retune lag)
            # At 15-40ms per buffer, 10 slots = 150-400ms buffering
            iq_queue_fft: multiprocessing.Queue = multiprocessing.Queue(maxsize=3)
            iq_queue_demod: multiprocessing.Queue = multiprocessing.Queue(maxsize=3)

            # Stop event for the process
            stop_event = multiprocessing.Event()

            # Prepare initial configuration
            config = SDRConfig(
                fft_overlap_percent=sdr_config.get("fft_overlap_percent", 0),
                fft_overlap_depth=sdr_config.get("fft_overlap_depth", 16),
                sdr_id=sdr_id,
                center_freq=sdr_config.get("center_freq", 100e6),
                sample_rate=sdr_config.get("sample_rate", 2.048e6),
                gain=sdr_config.get("gain", "auto"),
                fft_size=sdr_config.get("fft_size"),
                bias_t=sdr_config.get("bias_t", 0),
                tuner_agc=sdr_config.get("tuner_agc", False),
                rtl_agc=sdr_config.get("rtl_agc", False),
                fft_window=sdr_config.get("fft_window"),
                fft_averaging=sdr_config.get("fft_averaging"),
                recording_path=sdr_config.get("recording_path", ""),
                serial_number=sdr_config.get("serial_number", 0),
                host=hostname,
                port=port,
                client_id=client_id,
                connection_type=connection_type,
                driver=driver,
                soapy_agc=sdr_config.get("soapy_agc", False),
                offset_freq=int(sdr_config.get("offset_freq", 0)),
                antenna=sdr_config.get("antenna", "RX"),
                ppm_error=sdr_config.get("ppm_error"),
                loop_playback=sdr_config.get("loop_playback", True),
                sdr_settings=sdr_config.get("sdr_settings") or {},
            ).to_dict()

            if not worker_process:
                raise Exception(f"Worker process {worker_process} for SDR id: {sdr_id} not found")

            # Create a named worker function
            named_worker = _create_named_worker_process(worker_process, process_name)

            # Create and start the process with a descriptive name
            # Pass both IQ queues so SDR can broadcast to both consumers
            process = multiprocessing.Process(
                target=named_worker,
                args=(config_queue, data_queue, stop_event, iq_queue_fft, iq_queue_demod),
                name=process_name,
                daemon=True,
            )
            process.start()

            self.logger.info(
                f"Started SDR process '{process_name}' for device {sdr_id} (PID: {process.pid})"
            )

            # Create and start FFT processor process
            fft_process_name = f"Ground Station - FFT-Processor-{sdr_id}"
            fft_named_worker = _create_named_worker_process(fft_processor_process, fft_process_name)
            fft_process = multiprocessing.Process(
                target=fft_named_worker,
                args=(iq_queue_fft, data_queue, stop_event, client_id),
                name=fft_process_name,
                daemon=True,
            )
            fft_process.start()

            self.logger.info(
                f"Started FFT processor '{fft_process_name}' for device {sdr_id} (PID: {fft_process.pid})"
            )

            # Create and start IQ broadcaster for demodulators
            # The broadcaster reads from iq_queue_demod and distributes to multiple demodulators
            iq_broadcaster = IQBroadcaster(iq_queue_demod, sdr_id)
            iq_broadcaster.start()

            self.logger.info(f"Started IQ broadcaster for device {sdr_id}")

            # Store process information
            self.processes[sdr_id] = {
                "process": process,
                "fft_process": fft_process,
                "config_queue": config_queue,
                "data_queue": data_queue,
                "iq_queue_fft": iq_queue_fft,
                "iq_queue_demod": iq_queue_demod,  # Separate queue for demodulation
                "iq_broadcaster": iq_broadcaster,  # Broadcaster for multiple demodulators
                "stop_event": stop_event,
                "clients": {client_id},
                "demodulators": {},  # Will store demodulator threads per session
                "recorders": {},  # Will store recorder threads per session (separate from demodulators)
                "decoders": {},  # Will store decoder threads per session (SSTV, AFSK, Morse, etc.)
                "fft_stats": {},  # Latest stats from FFT processor
                "device": sdr_device,  # Store device info for runtime snapshots
                # Keep full applied SDR config for change detection in update_configuration().
                "config": dict(config),
            }

            # Send initial configuration
            config_queue.put(config)

            # Add this client to the room (skip for internal observation sessions)
            if not VFOManager.is_internal_session(client_id):
                await self.sio.enter_room(client_id, sdr_id)

            # Start async task to monitor the data queue
            asyncio.create_task(self._monitor_data_queue(sdr_id, process.pid))

            return sdr_id

    async def stop_sdr_process(self, sdr_id, client_id=None):
        """
        Stop an SDR worker process

        Args:
            sdr_id: Device identifier
            client_id: Client identifier (optional)
        """
        if sdr_id not in self.processes:
            self.logger.warning(f"No SDR process found for device {sdr_id}")
            return

        process_info = self.processes[sdr_id]

        # If client_id is provided, only remove that client
        if client_id:
            if client_id in process_info["clients"]:
                # Remove client from Socket.IO room
                process_info["clients"].remove(client_id)

                # Make a client leave a specific room (skip for internal observation sessions)
                if not VFOManager.is_internal_session(client_id):
                    await self.sio.leave_room(client_id, sdr_id)

                # Stop any active demodulator for this client
                self.demodulator_manager.stop_demodulator(sdr_id, client_id)

                # Stop any active recorder for this client
                self.recorder_manager.stop_recorder(sdr_id, client_id)

                # Stop any active audio recorders for this client
                if self.audio_recorder_manager:
                    # Stop all VFO audio recorders for this session
                    audio_recorders = process_info.get("audio_recorders", {}).get(client_id, {})
                    for vfo_number in list(audio_recorders.keys()):
                        self.logger.info(
                            f"Stopping audio recorder for VFO {vfo_number}, session {client_id}"
                        )
                        self.audio_recorder_manager.stop_audio_recorder(
                            sdr_id, client_id, vfo_number
                        )

                # Stop any active decoder for this client
                self.decoder_manager.stop_decoder(sdr_id, client_id)

                # Stop any active transcription consumers for this client
                if self.transcription_manager:
                    self.transcription_manager.stop_transcription(sdr_id, client_id)

                self.logger.info(f"Removed client {client_id} from SDR process {sdr_id}")

            # If there are still other clients, don't stop the process
            if process_info["clients"]:
                return

        # Stop the broadcaster first
        if "iq_broadcaster" in process_info:
            broadcaster = process_info["iq_broadcaster"]
            broadcaster.stop()
            broadcaster.join(timeout=2.0)
            self.logger.info(f"Stopped IQ broadcaster for device {sdr_id}")

        # Set stop event to signal both SDR worker and FFT processor to stop
        self.logger.info(f"Stopping SDR process and FFT processor for device {sdr_id}")
        process_info["stop_event"].set()

        # Stop the FFT processor
        if (
            "fft_process" in process_info
            and process_info["fft_process"] is not None
            and process_info["fft_process"].is_alive()
        ):
            self.logger.info(f"Stopping FFT processor for device {sdr_id}")

            # Wait briefly for the FFT process to terminate gracefully
            for _ in range(20):  # Wait up to 2 seconds
                if not process_info["fft_process"].is_alive():
                    break
                await asyncio.sleep(0.1)

            # Force terminate if still running
            if process_info["fft_process"].is_alive():
                self.logger.warning(f"Forcing termination of FFT processor for device {sdr_id}")
                process_info["fft_process"].terminate()

            # Wait briefly for termination
            for _ in range(10):  # Wait up to 1 second
                if not process_info["fft_process"].is_alive():
                    break
                await asyncio.sleep(0.1)

            # If still alive, send SIGKILL
            if process_info["fft_process"].is_alive():
                self.logger.warning(
                    f"FFT processor {sdr_id} still alive after terminate, sending SIGKILL"
                )
                process_info["fft_process"].kill()

            self.logger.info(f"FFT processor for device {sdr_id} stopped")

        # Stop the SDR worker process
        if process_info["process"].is_alive():
            self.logger.info(f"Stopping SDR worker process for device {sdr_id}")

            # Wait briefly for the process to terminate
            for _ in range(50):  # Wait up to 5 seconds
                if not process_info["process"].is_alive():
                    break
                await asyncio.sleep(0.1)

            # Force terminate if still running
            if process_info["process"].is_alive():
                self.logger.warning(f"Forcing termination of SDR worker for device {sdr_id}")
                process_info["process"].terminate()

            # Wait briefly for termination
            for _ in range(10):  # Wait up to 1 second
                if not process_info["process"].is_alive():
                    break
                await asyncio.sleep(0.1)

            # If still alive, send SIGKILL
            if process_info["process"].is_alive():
                self.logger.warning(
                    f"SDR worker {sdr_id} still alive after terminate, sending SIGKILL"
                )
                process_info["process"].kill()

            self.logger.info(f"SDR worker for device {sdr_id} stopped")

        # Stop all transcription consumers for this SDR
        if self.transcription_manager:
            transcription_consumers = process_info.get("transcription_consumers", {})
            for session_id in list(transcription_consumers.keys()):
                self.logger.info(f"Stopping all transcription consumers for session {session_id}")
                self.transcription_manager.stop_transcription(sdr_id, session_id)

        # Clean up
        if sdr_id in self.processes:
            del self.processes[sdr_id]

        self.logger.info(f"SDR process for device {sdr_id} stopped")

    async def update_configuration(self, sdr_id, config):
        """
        Update the configuration of an SDR worker process

        Args:
            sdr_id: Device identifier
            config: Dictionary with configuration parameters
        """
        if sdr_id not in self.processes:
            self.logger.warning(f"No SDR process found for SDR device {sdr_id}")
            return

        process_info = self.processes[sdr_id]

        # Check if sample rate or center frequency is changing.
        # Compare against the effective full config (old config merged with incoming partial update)
        # so gain-only patches never look like sample-rate/center-frequency changes.
        old_config = process_info.get("config", {})
        effective_config = dict(old_config)
        effective_config.update(config)
        old_sample_rate = old_config.get("sample_rate")
        new_sample_rate = effective_config.get("sample_rate")
        old_center_freq = old_config.get("center_freq")
        new_center_freq = effective_config.get("center_freq")
        seek_requested = "seek_seconds" in config and config.get("seek_seconds") is not None

        # If sample rate OR center frequency changed, flush all queues
        # Note: Treat None -> value (or value -> None) as a change as well so that
        # the very first change after process start is detected.
        if (
            (new_sample_rate != old_sample_rate)
            or (new_center_freq != old_center_freq)
            or seek_requested
        ):
            # Log appropriate message based on what changed
            if new_sample_rate != old_sample_rate:
                if old_sample_rate is not None and new_sample_rate is not None:
                    self.logger.info(
                        f"Sample rate changing from {old_sample_rate/1e6:.2f} MHz to {new_sample_rate/1e6:.2f} MHz, "
                        f"flushing all queues"
                    )
                else:
                    self.logger.info(
                        f"Sample rate changing from {old_sample_rate} to {new_sample_rate}, flushing all queues"
                    )
            if new_center_freq != old_center_freq:
                if old_center_freq is not None and new_center_freq is not None:
                    self.logger.info(
                        f"Center frequency changing from {old_center_freq/1e6:.3f} MHz to {new_center_freq/1e6:.3f} MHz, "
                        f"flushing all queues"
                    )
                else:
                    self.logger.info(
                        f"Center frequency changing from {old_center_freq} to {new_center_freq}, flushing all queues"
                    )
            if seek_requested:
                self.logger.info(
                    f"Playback seek requested for SDR {sdr_id}: {config.get('seek_seconds')}s, flushing all queues"
                )
            # Flush demodulator queues
            self.demodulator_manager.flush_all_demodulator_queues(sdr_id)

            # Flush FFT input queue (from SDR worker to FFT processor)
            iq_queue_fft = process_info.get("iq_queue_fft")
            if iq_queue_fft:
                flushed_count = 0
                while not iq_queue_fft.empty():
                    try:
                        iq_queue_fft.get_nowait()
                        flushed_count += 1
                    except Exception:
                        break
                if flushed_count > 0:
                    self.logger.info(f"Flushed {flushed_count} items from FFT input queue")

                # Send reset command to FFT processor to clear its internal averager
                try:
                    iq_queue_fft.put_nowait(
                        {
                            "samples": np.array([], dtype=np.complex64),
                            "center_freq": 0,
                            "sample_rate": new_sample_rate,
                            "timestamp": 0,
                            "config": {"reset_averager": True},
                        }
                    )
                    self.logger.info("Sent reset command to FFT processor")
                except Exception:
                    pass

            # Flush data_queue (FFT output to UI) - CRITICAL for fast UI sync!
            # At high sample rates (4-8 MHz), this queue accumulates hundreds of stale FFT messages
            data_queue = process_info.get("data_queue")
            if data_queue:
                flushed_count = 0
                while not data_queue.empty():
                    try:
                        data_queue.get_nowait()
                        flushed_count += 1
                    except Exception:
                        break
                if flushed_count > 0:
                    self.logger.info(f"Flushed {flushed_count} stale FFT messages from data_queue")

        # Send configuration to the process
        process_info["config_queue"].put(config)

        # Store the full effective config for future comparisons.
        process_info["config"] = effective_config

        self.logger.info(f"Sent configuration update to SDR process for device {sdr_id}")

        # If sample rate or center frequency changed, restart all decoders for this SDR
        # so that they reinitialize DSP state (filters/decimation) with the new parameters.
        if (new_sample_rate != old_sample_rate) or (new_center_freq != old_center_freq):
            try:
                decoders = process_info.get("decoders", {})
                if not decoders:
                    return

                # Build a human-readable reason describing what changed
                if (new_sample_rate != old_sample_rate) and (new_center_freq != old_center_freq):
                    reason = (
                        f"sdr_rate_and_center_changed: rate {old_sample_rate} -> {new_sample_rate}, "
                        f"center {old_center_freq} -> {new_center_freq}"
                    )
                elif new_sample_rate != old_sample_rate:
                    reason = f"sdr_sample_rate_changed: {old_sample_rate} -> {new_sample_rate}"
                else:
                    reason = f"sdr_center_changed: {old_center_freq} -> {new_center_freq}"

                # Snapshot the decoders we plan to restart to avoid races while iterating
                restart_list = []
                for session_id, vfo_map in decoders.items():
                    for vfo_number, decoder_entry in list(vfo_map.items()):
                        restart_list.append((session_id, vfo_number, decoder_entry))

                # Stagger restarts slightly to reduce contention and race surface
                for idx, (session_id, vfo_number, decoder_entry) in enumerate(restart_list):
                    try:
                        self.logger.info(
                            f"Restarting decoder due to SDR config change: {session_id} VFO{vfo_number} | {reason}"
                        )
                        # Use async helper to avoid blocking the event loop; add tiny stagger
                        asyncio.create_task(
                            self._restart_decoder_async(
                                sdr_id,
                                session_id,
                                vfo_number,
                                reason,
                                decoder_entry,
                                delay_ms=50 * idx,
                            )
                        )
                    except Exception as e:
                        self.logger.error(
                            f"Error scheduling decoder restarts for session {session_id} on SDR {sdr_id}: {e}"
                        )
            except Exception as e:
                self.logger.error(
                    f"Failed to enumerate decoders for restart on SDR {sdr_id} after config change: {e}"
                )

    async def _restart_decoder_async(
        self, sdr_id, session_id, vfo_number, reason, decoder_entry=None, delay_ms=0
    ):
        """
        Asynchronously restart a decoder that requested restart.

        Args:
            sdr_id: Device identifier
            session_id: Session identifier
            vfo_number: VFO number
            reason: Reason for restart
        """
        try:
            self.logger.info(
                f"Handling decoder restart request for {session_id} VFO{vfo_number}: {reason}"
            )
            # Debug tracing removed for production cleanliness

            # Optional small delay to let SDR reconfigure/settle and to stagger concurrent restarts
            if delay_ms and delay_ms > 0:
                await asyncio.sleep(delay_ms / 1000.0)

            # Get decoder entry to preserve configuration
            if sdr_id not in self.processes:
                self.logger.error(f"Cannot restart decoder: SDR {sdr_id} not found")
                return

            process_info = self.processes[sdr_id]
            decoders = process_info.get("decoders", {})

            # If decoder_entry not provided (e.g., restart request coming from queue), try to fetch it.
            if decoder_entry is None:
                decoder_entry = decoders.get(session_id, {}).get(vfo_number)
                if decoder_entry is None:
                    self.logger.warning(
                        f"Decoder entry not found in live map for {session_id} VFO{vfo_number}; aborting restart"
                    )
                    return
            # Removed verbose pre-kill snapshot debug logging

            # Mark restart in progress to prevent duplicate restarts
            try:
                if session_id in decoders and vfo_number in decoders.get(session_id, {}):
                    decoders[session_id][vfo_number]["restart_in_progress"] = True
            except Exception:
                pass

            # Serialize restarts per (sdr, session, vfo)
            key = (sdr_id, session_id, vfo_number)
            lock = self._restart_locks.get(key)
            if lock is None:
                lock = asyncio.Lock()
                self._restart_locks[key] = lock

            async with lock:
                # Use DecoderManager's restart method in a thread pool
                loop = asyncio.get_event_loop()
                success = await loop.run_in_executor(
                    None,
                    self.decoder_manager._restart_decoder,
                    sdr_id,
                    session_id,
                    vfo_number,
                    decoder_entry,
                )

                if success:
                    self.logger.info(f"Successfully restarted decoder {session_id} VFO{vfo_number}")
                else:
                    self.logger.error(f"Failed to restart decoder {session_id} VFO{vfo_number}")

                # Removed verbose post-start snapshot debug logging

            # Clear restart-in-progress flag
            try:
                if session_id in decoders and vfo_number in decoders.get(session_id, {}):
                    decoders[session_id][vfo_number].pop("restart_in_progress", None)
            except Exception:
                pass

        except Exception as e:
            self.logger.error(f"Error restarting decoder {session_id} VFO{vfo_number}: {e}")
            self.logger.exception(e)

    async def _monitor_data_queue(self, sdr_id, expected_process_pid=None):
        """
        Monitor the data queue for a specific device

        Args:
            sdr_id: Device identifier
            expected_process_pid: PID of the worker process this monitor owns.
        """
        if sdr_id not in self.processes:
            return

        process_info = self.processes[sdr_id]
        if expected_process_pid is None:
            expected_process_pid = process_info["process"].pid
        data_queue = process_info["data_queue"]

        self.logger.info(
            f"Started monitoring data queue for device {sdr_id} (pid={expected_process_pid})"
        )

        try:
            while True:
                current_info = self.processes.get(sdr_id)
                if current_info is None:
                    break

                current_pid = current_info["process"].pid
                # Guard against stale monitor tasks: only the monitor attached to
                # the current process instance is allowed to keep running/cleanup.
                if current_pid != expected_process_pid:
                    self.logger.info(
                        "Stopping stale monitor for device %s (expected pid=%s, current pid=%s)",
                        sdr_id,
                        expected_process_pid,
                        current_pid,
                    )
                    return

                process_info = current_info
                if not process_info["process"].is_alive():
                    break

                # Check if data is available
                if not data_queue.empty():
                    try:
                        # Get data from the queue
                        data = data_queue.get()

                        # Process data based on type
                        data_type = data.get(DictKeys.TYPE)
                        client_id = data.get(DictKeys.CLIENT_ID)

                        if data_type == QueueMessageTypes.FFT_DATA:
                            # Send FFT data to all clients connected to this SDR
                            # Include playback timing info if present (for playback mode)
                            fft_payload = {
                                "data": data[DictKeys.DATA],
                            }
                            if "recording_datetime" in data:
                                fft_payload["recording_datetime"] = data["recording_datetime"]
                            if "playback_elapsed_seconds" in data:
                                fft_payload["playback_elapsed_seconds"] = data[
                                    "playback_elapsed_seconds"
                                ]
                            if "playback_remaining_seconds" in data:
                                fft_payload["playback_remaining_seconds"] = data[
                                    "playback_remaining_seconds"
                                ]
                            if "playback_total_seconds" in data:
                                fft_payload["playback_total_seconds"] = data[
                                    "playback_total_seconds"
                                ]

                            await self.sio.emit(SocketEvents.SDR_FFT_DATA, fft_payload, room=sdr_id)

                        elif data_type == "stats":
                            # Store stats for performance monitoring
                            # Check if it's FFT stats or worker stats based on presence of sdr_id
                            if "sdr_id" in data:
                                # Worker process stats
                                process_info["worker_stats"] = data.get("stats", {})
                            else:
                                # FFT processor stats
                                process_info["fft_stats"] = data.get("stats", {})

                        elif data_type == QueueMessageTypes.STREAMING_START:
                            # Send streaming status to all clients connected to this SDR
                            await self.sio.emit(
                                SocketEvents.SDR_STATUS, {"streaming": True}, room=sdr_id
                            )

                        elif data_type == QueueMessageTypes.CONFIG_ERROR:
                            # Send config error to all clients connected to this SDR
                            await self.sio.emit(
                                SocketEvents.SDR_CONFIG_ERROR,
                                {DictKeys.MESSAGE: f"SDR error: {data[DictKeys.MESSAGE]}"},
                                room=sdr_id,
                            )
                            self.logger.error(
                                f"Config error from SDR process: {data[DictKeys.MESSAGE]}"
                            )

                        elif data_type == QueueMessageTypes.ERROR:
                            # Send error to all clients connected to this SDR
                            await self.sio.emit(
                                SocketEvents.SDR_ERROR,
                                {DictKeys.MESSAGE: f"SDR error: {data[DictKeys.MESSAGE]}"},
                                room=sdr_id,
                            )
                            self.logger.error(f"Error from SDR process: {data[DictKeys.MESSAGE]}")

                        elif data_type == QueueMessageTypes.TERMINATED:
                            # Process has terminated
                            self.logger.info(f"SDR process for device {sdr_id} has terminated")

                            # Notify all clients
                            for client_id in process_info["clients"]:
                                await self.sio.emit(
                                    SocketEvents.SDR_STATUS, {"streaming": False}, room=sdr_id
                                )

                            # Don't delete process info here - let the finally block handle cleanup
                            # This ensures stop_sdr_process() can still kill the process if needed
                            # Process info will be deleted in stop_sdr_process() after proper cleanup

                            # Exit the loop
                            break

                        elif data_type == "decoder-restart-request":
                            # Decoder has requested restart (e.g., SHM threshold exceeded)
                            session_id = data.get("session_id")
                            vfo_number = data.get("vfo")
                            reason = data.get("reason", "unknown")
                            shm_count = data.get("shm_count", "unknown")

                            if session_id and vfo_number is not None:
                                self.logger.warning(
                                    f"Decoder {session_id} VFO{vfo_number} requests restart: {reason} "
                                    f"(SHM segments: {shm_count})"
                                )

                                # Mark restart-in-progress to avoid duplicate restart triggers
                                try:
                                    decoders = process_info.get("decoders", {})
                                    if (
                                        session_id in decoders
                                        and vfo_number in decoders[session_id]
                                    ):
                                        decoders[session_id][vfo_number][
                                            "restart_in_progress"
                                        ] = True
                                except Exception:
                                    pass

                                # Restart the decoder asynchronously without blocking the queue monitor
                                asyncio.create_task(
                                    self._restart_decoder_async(
                                        sdr_id, session_id, vfo_number, reason
                                    )
                                )
                            else:
                                self.logger.error(
                                    f"Decoder restart request missing session_id or vfo: {data}"
                                )

                        elif data_type in [
                            "decoder-status",
                            "decoder-progress",
                            "decoder-output",
                            "decoder-stats",
                        ]:
                            # Decoder messages (SSTV, AFSK, Morse, GMSK, etc.)
                            session_id = data.get("session_id")
                            if session_id:
                                # Store performance stats for PerformanceMonitor (decoder-stats only)
                                if data_type == "decoder-stats" and "perf_stats" in data:
                                    vfo = data.get("vfo")
                                    if vfo is not None:
                                        # Store stats in process_info for PerformanceMonitor to access
                                        if "decoders" in process_info:
                                            if session_id in process_info["decoders"]:
                                                if vfo in process_info["decoders"][session_id]:
                                                    entry = process_info["decoders"][session_id][
                                                        vfo
                                                    ]
                                                    # Revert to unconditional store of perf_stats (remove newer-only guard and warnings)
                                                    entry["stats"] = data["perf_stats"]
                                                    # Ensure no leftover timestamp field is kept/used
                                                    if "stats_timestamp" in entry:
                                                        del entry["stats_timestamp"]
                                    # Don't emit decoder-stats to UI - only used internally by PerformanceMonitor
                                    # UI receives aggregated performance data via 'performance-metrics' events
                                    continue

                                # Check if this is an internal session (automated observation)
                                is_internal = VFOManager.is_internal_session(session_id)

                                # Reset backend transition memory when a GNSS decoder reports terminal/non-tracking states.
                                if (
                                    data_type == "decoder-status"
                                    and data.get("decoder_type") == "gnss"
                                ):
                                    status = str(data.get("status") or "").strip().lower()
                                    if status in {"idle", "error", "closed"}:
                                        self._gnss_fix_status_by_stream.pop(
                                            gnss_fix_stream_key(data), None
                                        )

                                if data_type == "decoder-output":
                                    await self._enrich_gnss_output(data)

                                if is_internal:
                                    # Broadcast internal session decoder events to all clients
                                    await self.sio.emit(SocketEvents.DECODER_DATA, data)
                                else:
                                    # Send to specific session only (user sessions)
                                    await self.sio.emit(
                                        SocketEvents.DECODER_DATA, data, room=session_id
                                    )

                                # If decoder output was saved, emit file browser state update
                                if data_type == "decoder-output" and "output" in data:
                                    output = data["output"]
                                    if "filepath" in output:
                                        await emit_file_browser_state(
                                            self.sio,
                                            {
                                                "action": "decoded-saved",
                                                "decoder_type": data.get("decoder_type"),
                                                "filepath": output["filepath"],
                                                "filename": output.get("filename"),
                                            },
                                            self.logger,
                                        )
                            else:
                                self.logger.warning(
                                    f"Decoder message missing session_id: {data_type}"
                                )

                    except Exception as e:
                        self.logger.error(f"Error processing data from SDR process: {str(e)}")
                        self.logger.exception(e)
                else:
                    # Short sleep to avoid CPU hogging
                    await asyncio.sleep(0.05)

        except Exception as e:
            self.logger.error(f"Error monitoring data queue for device {sdr_id}: {str(e)}")

        finally:
            self.logger.info(
                f"Stopped monitoring data queue for device {sdr_id} (pid={expected_process_pid})"
            )

            # Make sure the process is cleaned up only by the monitor that owns it.
            current_info = self.processes.get(sdr_id)
            if current_info and current_info["process"].pid == expected_process_pid:
                await self.stop_sdr_process(sdr_id)
            elif current_info is not None:
                self.logger.info(
                    "Skipping cleanup from stale monitor for device %s (expected pid=%s, current pid=%s)",
                    sdr_id,
                    expected_process_pid,
                    current_info["process"].pid,
                )
