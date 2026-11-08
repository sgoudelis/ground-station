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
from typing import Any, Awaitable, Callable, Dict, Optional, Tuple
from uuid import uuid4

import numpy as np

from common.constants import DictKeys, QueueMessageTypes, SocketEvents
from common.events import public_events
from common.sdrconfig import SDRConfig
from db import AsyncSessionLocal
from fft.processor import fft_processor_process
from handlers.entities.filebrowser import emit_file_browser_state, refresh_file_browser_library
from hardware.parameters import probe_sdr_parameters, sdr_hardware_lock, sdr_parameter_lock
from monitoring.timing import TimestampedQueue, get_enabled_event
from pipeline.orchestration.adsb import AdsbPublisher
from pipeline.orchestration.gnssfix import derive_gnss_fix_status_from_output, gnss_fix_stream_key
from pipeline.orchestration.gnsssatelliteresolver import GnssSatelliteResolver
from pipeline.streaming.iqbroadcaster import IQBroadcaster
from server import runtimestate
from session.background import background_sessions
from session.store import active_sdr_clients
from session.tracker import session_tracker
from vfos.parameters import clear_session_parameters
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


class SdrStartConflict(Exception):
    """Another client claimed the SDR while this caller waited to start."""

    def __init__(self, sdr_id: str, other_clients: list[str]):
        self.sdr_id = sdr_id
        self.other_clients = other_clients
        super().__init__(f"SDR {sdr_id} is already in use")


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
        # Observations register a callback here so a worker failure after startup
        # can move the owning observation out of RUNNING immediately.
        self._sdr_failure_handler: Optional[Callable[[str, set[str], str], Awaitable[None]]] = None
        self.sdr_ready_timeout_seconds = 10.0
        # One catalogue refresh worker serves every SDR/VFO. Keep filesystem
        # scans out of the queue readers that also forward live FFT frames.
        self._decoded_library_dirty = False
        self._decoded_library_task: Optional[asyncio.Task] = None
        self.decoded_library_refresh_seconds = 2.0
        self.adsb_publisher = AdsbPublisher(self.sio)

    def _schedule_decoded_library_refresh(self) -> None:
        self._decoded_library_dirty = True
        if self._decoded_library_task is None:
            self._decoded_library_task = asyncio.create_task(self._refresh_decoded_library())

    async def _refresh_decoded_library(self) -> None:
        try:
            while self._decoded_library_dirty:
                # A fixed window coalesces packets without postponing updates
                # indefinitely during continuous reception. Never overlap scans.
                await asyncio.sleep(self.decoded_library_refresh_seconds)
                self._decoded_library_dirty = False
                try:
                    await refresh_file_browser_library(self.sio)
                except Exception:
                    self.logger.exception("Failed to refresh the decoded file library")
                # Packets arriving during a scan request another pass, including
                # the final packet even if its SDR has since stopped.
        finally:
            self._decoded_library_task = None

    def set_sdr_failure_handler(
        self, handler: Optional[Callable[[str, set[str], str], Awaitable[None]]]
    ) -> None:
        """Register the async handler for unexpected failures of active SDR workers."""
        self._sdr_failure_handler = handler

    @staticmethod
    def _sample_count(process_info: Dict[str, Any]) -> int:
        stats = process_info.get("worker_stats") or {}
        try:
            return int(stats.get("samples_read") or 0)
        except (TypeError, ValueError):
            return 0

    def _create_ready_waiter(
        self, process_info: Dict[str, Any], client_id: Optional[str] = None
    ) -> asyncio.Future:
        """Wait for sample activity newer than the state visible to the caller."""
        future = asyncio.get_running_loop().create_future()
        process_info.setdefault("ready_waiters", []).append(
            {
                "future": future,
                "baseline_samples": self._sample_count(process_info),
                "client_id": client_id,
            }
        )
        return future

    def _resolve_ready_waiters(self, sdr_id: str, process_info: Dict[str, Any]) -> None:
        """Resolve startup waiters only after activation and real IQ delivery."""
        if not process_info.get("streaming_started"):
            return

        sample_count = self._sample_count(process_info)
        remaining = []
        for waiter in process_info.get("ready_waiters", []):
            future = waiter["future"]
            if future.done():
                continue
            if sample_count > waiter["baseline_samples"]:
                future.set_result({"success": True})
            else:
                remaining.append(waiter)
        process_info["ready_waiters"] = remaining
        if (
            sample_count > 0
            and not process_info.get("startup_ready")
            and not process_info.get("stopping")
        ):
            process_info["startup_ready"] = True
            # Report the physical stream once, after the worker delivers IQ samples.
            process_info["event_streaming_started"] = True
            public_events.sdr_stream_started(sdr_id)

    def _log_decoder_error_status(self, data: Dict[str, Any]) -> None:
        """Make decoder status failures visible in the backend log."""
        if str(data.get("status") or "").strip().lower() != "error":
            return

        info = data.get("info") or {}
        error = info.get("error") if isinstance(info, dict) else None
        self.logger.error(
            "Decoder %s failed for session %s VFO %s: %s",
            data.get("decoder_type") or "unknown",
            data.get("session_id") or "unknown",
            data.get("vfo") if data.get("vfo") is not None else "unknown",
            error or "decoder reported an error without details",
        )

    def _log_exited_decoder_processes(self, sdr_id: str, process_info: Dict[str, Any]) -> None:
        """Log child decoder crashes that occur before they can send a status message."""
        # Decoder stop/restart work can update these maps from another thread.
        # Snapshot both levels so health logging never disrupts SDR monitoring.
        for session_id, vfo_decoders in list(process_info.get("decoders", {}).items()):
            if not isinstance(vfo_decoders, dict):
                continue
            for vfo_number, decoder_entry in list(vfo_decoders.items()):
                if not isinstance(decoder_entry, dict) or decoder_entry.get("failure_reported"):
                    continue

                decoder = decoder_entry.get("instance")
                if not decoder or not hasattr(decoder, "is_alive") or decoder.is_alive():
                    continue

                exit_code = getattr(decoder, "exitcode", None)
                # A clean exit is expected when a decoder is deliberately stopped.
                if exit_code in (None, 0):
                    continue

                decoder_entry["failure_reported"] = True
                self.logger.error(
                    "Decoder %s failed for session %s VFO %s on SDR %s "
                    "before reporting status (exit code %s)",
                    decoder_entry.get("decoder_type") or type(decoder).__name__,
                    session_id,
                    vfo_number,
                    sdr_id,
                    exit_code,
                )

    @staticmethod
    def _fail_ready_waiters(process_info: Dict[str, Any], message: str) -> None:
        for waiter in process_info.get("ready_waiters", []):
            future = waiter["future"]
            if not future.done():
                future.set_result({"success": False, "error": message})
        process_info["ready_waiters"] = []

    async def _emit_worker_error(
        self,
        sdr_id: str,
        process_info: Dict[str, Any],
        event: str,
        message: str,
        pending_clients: set[str],
    ) -> None:
        """Pending callers get their error in the command reply; notify other viewers."""
        payload = {DictKeys.MESSAGE: f"SDR error: {message}"}
        if not pending_clients:
            await self.sio.emit(event, payload, room=sdr_id)
            return
        for client_id in set(process_info["clients"]) - pending_clients:
            if not VFOManager.is_internal_session(client_id):
                await self.sio.emit(event, payload, room=client_id)

    async def _wait_until_sdr_ready(
        self,
        sdr_id: str,
        process_info: Dict[str, Any],
        future: asyncio.Future,
    ) -> None:
        try:
            result = await asyncio.wait_for(future, timeout=self.sdr_ready_timeout_seconds)
        except asyncio.TimeoutError as exc:
            last_read_error = (process_info.get("worker_stats") or {}).get("last_read_error")
            detail = f"; last receiver error: {last_read_error}" if last_read_error else ""
            raise RuntimeError(
                f"SDR {sdr_id} did not deliver samples within "
                f"{self.sdr_ready_timeout_seconds:g} seconds{detail}"
            ) from exc
        finally:
            process_info["ready_waiters"] = [
                waiter
                for waiter in process_info.get("ready_waiters", [])
                if waiter["future"] is not future
            ]

        if not result.get("success"):
            raise RuntimeError(result.get("error") or f"SDR {sdr_id} failed to start")

    async def _notify_sdr_failure(self, sdr_id: str, client_ids: set[str], message: str) -> None:
        if not self._sdr_failure_handler:
            return
        internal_clients = {
            client_id for client_id in client_ids if VFOManager.is_internal_session(client_id)
        }
        if not internal_clients:
            return
        try:
            await self._sdr_failure_handler(sdr_id, internal_clients, message)
        except Exception as exc:
            self.logger.exception("Failed to propagate SDR %s failure: %s", sdr_id, exc)

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

    async def start_sdr_process(self, sdr_device, sdr_config, client_id, force_takeover=False):
        """Warm capabilities before the first worker opens this SDR."""
        sdr_id = str(sdr_device["id"])
        async with sdr_parameter_lock(sdr_id), sdr_hardware_lock(sdr_device):
            capabilities = None
            process_info = self.processes.get(sdr_id)
            if process_info and process_info.get("stopping"):
                # A new caller must not attach to a worker being torn down.
                while self.processes.get(sdr_id) is process_info:
                    await asyncio.sleep(0.05)
                process_info = self.processes.get(sdr_id)
            if process_info and process_info["process"].is_alive():
                other_clients = sorted(
                    str(sid) for sid in process_info["clients"] if str(sid) != str(client_id)
                )
                if process_info.get("continuous_observation_id") and other_clients:
                    raise SdrStartConflict(sdr_id, other_clients)
                if (
                    (other_clients or client_id in process_info.get("joiners", set()))
                    and not force_takeover
                    and (
                        not VFOManager.is_internal_session(client_id)
                        or sdr_config.get("continuous_observation_id")
                    )
                ):
                    raise SdrStartConflict(sdr_id, other_clients)
            else:
                # Probe failure must not make an automated observation miss its
                # pass. The worker still gets its normal chance to start.
                async with AsyncSessionLocal() as dbsession:
                    parameters = await probe_sdr_parameters(
                        dbsession,
                        sdr_id,
                        recording_path=sdr_config.get("recording_path"),
                    )
                if not parameters.get("success"):
                    self.logger.warning(
                        "Could not cache capabilities for SDR %s before streaming: %s",
                        sdr_id,
                        parameters.get("error"),
                    )
                else:
                    capabilities = parameters.get("data")
            # Hold the gate until the worker has opened the device. A concurrent
            # UI request can only read the cache once the stream is active.
            return await self._start_sdr_process(
                sdr_device, sdr_config, client_id, capabilities=capabilities
            )

    async def _start_sdr_process(self, sdr_device, sdr_config, client_id, capabilities=None):
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
            process_info = self.processes[sdr_id]
            self.logger.info(
                f"SDR process for device {sdr_id} already running, adding client {client_id} to room"
            )

            # Add the client to the existing process
            was_joiner = client_id in process_info.get("joiners", set())
            process_info["clients"].add(client_id)

            self.logger.info(f"Active clients for SDR {sdr_id}: {process_info['clients']}")

            # A running process is not enough: the new configuration must be
            # followed by fresh IQ samples before the caller may start consumers.
            ready_future = self._create_ready_waiter(process_info, client_id)

            # Update the configuration if needed
            config = {"client_id": client_id}

            # Add optional parameters
            for param in [
                "fft_size",
                "fft_window",
                "fft_overlap_percent",
                "fft_overlap_depth",
                "fft_averaging",
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
            starting_revision = process_info.get("config_revision", 0)
            process_info["config_queue"].put(config)

            try:
                await self._wait_until_sdr_ready(sdr_id, process_info, ready_future)
            except Exception:
                # Detach only this caller. Existing clients may continue using a
                # healthy process if the requested reconfiguration was rejected.
                # A joiner retains its original membership after a failed takeover.
                if not was_joiner:
                    await self.stop_sdr_process(sdr_id, client_id)
                raise

            # Promote only after the worker accepts the new configuration.
            process_info.get("joiners", set()).discard(client_id)

            # Publish the accepted worker config to controllers and joiners
            # only after the new samples have proved it is usable.
            # A browser can tune while this startup call awaits fresh IQ. Do
            # not restore its older snapshot over that newer configuration.
            if process_info.get("config_revision", 0) == starting_revision:
                process_info["config"] = {**process_info.get("config", {}), **config}
            await self.sio.emit(
                "sdr-config", {"sdr_id": sdr_id, **process_info["config"]}, room=sdr_id
            )

            # Add this client to the room (skip for internal observation sessions)
            if not VFOManager.is_internal_session(client_id):
                await self.sio.enter_room(background_sessions.socket_for(client_id), sdr_id)
                await self.sio.emit(
                    SocketEvents.SDR_STATUS,
                    {
                        "streaming": True,
                        "sdr_id": sdr_id,
                        "bandwidth_status": process_info.get("bandwidth_status"),
                        "receiver_status": process_info.get("receiver_status"),
                    },
                    room=client_id,
                )

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
            timing_enabled_event = get_enabled_event()
            timed_iq_queue_fft = (
                TimestampedQueue(iq_queue_fft, timing_enabled_event)
                if iq_queue_fft is not None
                else None
            )
            timed_iq_queue_demod = (
                TimestampedQueue(iq_queue_demod, timing_enabled_event)
                if iq_queue_demod is not None
                else None
            )
            process = multiprocessing.Process(
                target=named_worker,
                args=(
                    config_queue,
                    data_queue,
                    stop_event,
                    timed_iq_queue_fft,
                    timed_iq_queue_demod,
                ),
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
                args=(iq_queue_fft, data_queue, stop_event, client_id, get_enabled_event()),
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

            # A new worker starts a fresh revision space for joined browsers.
            config["config_epoch"] = uuid4().hex
            config["config_revision"] = 0

            # Store process information
            self.processes[sdr_id] = {
                "continuous_observation_id": sdr_config.get("continuous_observation_id"),
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
                # Keep the capabilities of this running worker if its saved SDR
                # definition is edited and the shared cache must be invalidated.
                "parameters": capabilities,
                # Keep full applied SDR config for change detection in update_configuration().
                "config": dict(config),
                "worker_config_ack": connection_type in ("soapysdrlocal", "soapysdrremote", "uhd"),
                # Startup succeeds only after STREAMING_START and a worker stats
                # update proving that at least one IQ sample was read.
                "streaming_started": False,
                "startup_ready": False,
                "event_streaming_started": False,
                "ready_waiters": [],
                "worker_stats": {},
                "last_worker_error": None,
                "failure_reported": False,
            }

            process_info = self.processes[sdr_id]
            ready_future = self._create_ready_waiter(process_info, client_id)

            # Send initial configuration
            config_queue.put(config)

            # Add this client to the room (skip for internal observation sessions)
            if not VFOManager.is_internal_session(client_id):
                await self.sio.enter_room(background_sessions.socket_for(client_id), sdr_id)

            # Start async task to monitor the data queue
            asyncio.create_task(self._monitor_data_queue(sdr_id, process.pid))

            try:
                await self._wait_until_sdr_ready(sdr_id, process_info, ready_future)
            except Exception:
                # This is the only client of a newly created process, so detaching
                # it also tears down the worker, FFT process, and broadcaster.
                await self.stop_sdr_process(sdr_id, client_id)
                raise

            return sdr_id

    async def _detach_sdr_client(self, sdr_id, process_info, client_id, sio=None):
        """Remove one participant and its per-session consumers."""
        if client_id not in process_info["clients"]:
            return False

        was_joiner = client_id in process_info.get("joiners", set())
        process_info["clients"].discard(client_id)
        process_info.get("joiners", set()).discard(client_id)

        controller = background_sessions.socket_for(client_id)
        # Release consumers before yielding to room operations. Another last
        # participant may otherwise tear down the worker during this detach.
        self.demodulator_manager.stop_demodulator(sdr_id, client_id)
        self.recorder_manager.stop_recorder(sdr_id, client_id)
        if self.audio_recorder_manager:
            for vfo_number in list(process_info.get("audio_recorders", {}).get(client_id, {})):
                self.audio_recorder_manager.stop_audio_recorder(sdr_id, client_id, vfo_number)
        self.decoder_manager.stop_decoder(sdr_id, client_id)
        if self.transcription_manager:
            self.transcription_manager.stop_transcription(sdr_id, client_id)

        if client_id in background_sessions.sessions:
            if runtimestate.audio_consumer:
                runtimestate.audio_consumer.cleanup_session(client_id)
            if controller != client_id:
                # Detached/adopted logical sessions have no original browser
                # left to clear their configuration after failure or shutdown.
                active_sdr_clients.pop(client_id, None)
                session_tracker.clear_session(client_id)
            background_sessions.remove(client_id)
            session_tracker.unregister_session_streaming(client_id)
            VFOManager().clear_session_vfos(client_id)
            clear_session_parameters(client_id)

        if was_joiner:
            # JOIN has no configuration-store entry, so leaving must clear its
            # tracker and VFO state here rather than through stop_streaming().
            if session_tracker.get_session_sdr(client_id) == sdr_id:
                session_tracker.unregister_session_streaming(client_id)
                session_tracker.set_session_vfo_int(client_id, None)
            VFOManager().clear_session_vfos(client_id)

        if not VFOManager.is_internal_session(client_id) and controller:
            continuous_id = process_info.get("continuous_observation_id")
            if continuous_id:
                await (sio or self.sio).leave_room(
                    controller, f"internal:continuous-{continuous_id}"
                )
            await (sio or self.sio).leave_room(controller, sdr_id)
            if controller != client_id:
                await (sio or self.sio).leave_room(controller, client_id)

        self.logger.info("Removed client %s from SDR process %s", client_id, sdr_id)
        return True

    async def stop_sdr_join(self, sdr_id, client_id, sio=None):
        """Leave a joined SDR; the last participant also stops its worker."""
        process_info = self.processes.get(sdr_id)
        if not process_info or client_id not in process_info.get("joiners", set()):
            return False

        await self._detach_sdr_client(sdr_id, process_info, client_id, sio=sio)
        if not process_info["clients"] and not process_info.get("stopping"):
            await self.stop_sdr_process(sdr_id)
        return True

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
            await self._detach_sdr_client(sdr_id, process_info, client_id)

            # If there are still other clients, don't stop the process
            if process_info["clients"]:
                return

        # The queue monitor and a startup caller can discover termination at the
        # same time. Let the first cleanup own the process and make the other
        # caller wait until the shared entry is gone.
        if process_info.get("stopping"):
            while self.processes.get(sdr_id) is process_info:
                await asyncio.sleep(0.05)
            return
        process_info["stopping"] = True
        restart_task = process_info.pop("config_restart_task", None)
        if restart_task is not None:
            # Do not cancel a thread already restarting hardware consumers.
            # The task checks stopping before starting any further decoder.
            process_info["pending_decoder_restart"] = None

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
        # Worker failure/shutdown must stop retained controllers as well as joiners.
        # Normal departure never reaches here while another client remains.
        if process_info.get("clients"):
            await self.sio.emit("sdr-status", {"streaming": False}, room=sdr_id)
            for joiner_id in list(process_info["clients"]):
                try:
                    await self._detach_sdr_client(sdr_id, process_info, joiner_id)
                except Exception:
                    self.logger.exception(
                        "Failed to detach joiner %s from SDR %s", joiner_id, sdr_id
                    )
        if sdr_id in self.processes:
            del self.processes[sdr_id]

        if process_info.get("event_streaming_started"):
            process_info["event_streaming_started"] = False
            public_events.sdr_stream_stopped(sdr_id)

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
        if process_info.get("stopping"):
            return
        if process_info.get("continuous_observation_id"):
            raise ValueError("Stop the continuous observation before changing receiver settings.")
        request = config.get("config_request")
        if request:
            sequences = process_info.setdefault("config_request_sequences", {})
            if request["sequence"] <= sequences.get(request["origin"], -1):
                return
            sequences[request["origin"]] = request["sequence"]
        revision = process_info.get("config_revision", 0) + 1
        process_info["config_revision"] = revision
        config = {**config, "config_revision": revision}

        # Check if sample rate or center frequency is changing.
        # Compare against the effective full config (old config merged with incoming partial update)
        # so gain-only patches never look like sample-rate/center-frequency changes.
        old_config = process_info.get("config", {})
        effective_config = dict(old_config)
        effective_config.update(config)
        if "config_request" not in config:
            # Internal/scheduler updates must not inherit a browser's identity.
            effective_config.pop("config_request", None)
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
                control_messages = []
                while not data_queue.empty():
                    try:
                        message = data_queue.get_nowait()
                    except Exception:
                        break
                    if message.get("type") == QueueMessageTypes.FFT_DATA:
                        flushed_count += 1
                    else:
                        control_messages.append(message)
                # Hardware acknowledgements and decoder output share this queue;
                # dropping them can strand restarts or lose saved packets.
                for message in control_messages:
                    data_queue.put(message)
                if flushed_count > 0:
                    self.logger.info(f"Flushed {flushed_count} stale FFT messages from data_queue")

        # Send configuration to the process
        process_info["config_queue"].put(config)

        # Store the full effective config for future comparisons.
        process_info["config"] = effective_config
        if (new_sample_rate != old_sample_rate) or (new_center_freq != old_center_freq):
            process_info["pending_decoder_restart"] = revision
            self._schedule_config_decoder_restart(sdr_id, process_info)
        # All controllers and joiners must render the same live scale.
        if self.sio is not None:
            await self.sio.emit("sdr-config", {"sdr_id": sdr_id, **effective_config}, room=sdr_id)

        self.logger.info(f"Sent configuration update to SDR process for device {sdr_id}")

    def _schedule_config_decoder_restart(self, sdr_id, process_info):
        task = process_info.get("config_restart_task")
        if task is None or task.done():
            process_info["config_restart_task"] = asyncio.create_task(
                self._restart_config_decoders(sdr_id, process_info)
            )

    async def _restart_config_decoders(self, sdr_id, process_info):
        """Restart once for the latest settled tune, serially across bursts."""
        try:
            while process_info.get("pending_decoder_restart") is not None:
                revision = process_info["pending_decoder_restart"]
                # Allow a rapid burst to settle without delaying the dial or IQ.
                await asyncio.sleep(0.15)
                if self.processes.get(sdr_id) is not process_info or process_info.get("stopping"):
                    return
                if revision != process_info.get("pending_decoder_restart"):
                    continue
                if (
                    process_info.get("worker_config_ack")
                    and process_info.get("applied_config_revision", 0) < revision
                ):
                    # The queue monitor schedules us again when hardware finishes.
                    return
                process_info["pending_decoder_restart"] = None
                for session_id, vfos in list(process_info.get("decoders", {}).items()):
                    for vfo_number in list(vfos):
                        if (
                            process_info.get("stopping")
                            or process_info.get("pending_decoder_restart") is not None
                        ):
                            break
                        await self._restart_decoder_async(
                            sdr_id, session_id, vfo_number, "sdr_configuration_applied"
                        )
        except Exception:
            self.logger.exception("Failed restarting decoders after configuring SDR %s", sdr_id)
        finally:
            process_info.pop("config_restart_task", None)

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
            # Serialize restarts per (sdr, session, vfo)
            key = (sdr_id, session_id, vfo_number)
            lock = self._restart_locks.get(key)
            if lock is None:
                lock = asyncio.Lock()
                self._restart_locks[key] = lock

            async with lock:
                if self.processes.get(sdr_id) is not process_info or process_info.get("stopping"):
                    return
                decoders = process_info.get("decoders", {})
                decoder_entry = decoders.get(session_id, {}).get(vfo_number)
                if decoder_entry is None:
                    # The user may have stopped this decoder while we waited.
                    return
                decoder_entry["restart_in_progress"] = True
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
        runtime_failure: Optional[tuple[set[str], str]] = None

        try:
            while True:
                current_info = self.processes.get(sdr_id)
                if current_info is None:
                    break

                # A child may crash during initialization before it can enqueue
                # a decoder-status error. Check that path on every monitor pass.
                self._log_exited_decoder_processes(sdr_id, current_info)

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

                        elif data_type == "config-failed":
                            # Obsolete failures cannot roll back a newer tune.
                            if data.get("config_revision") == process_info.get("config_revision"):
                                config = process_info["config"]
                                config.update(data["measured_config"])
                                # Give reconciliation a newer revision so an
                                # acceptance reply still in flight cannot undo it.
                                process_info["config_revision"] += 1
                                config["config_revision"] = process_info["config_revision"]
                                process_info["receiver_status"] = data["receiver_status"]
                                process_info["pending_decoder_restart"] = None
                                await self.sio.emit(
                                    "sdr-config", {"sdr_id": sdr_id, **config}, room=sdr_id
                                )
                                await self.sio.emit(
                                    SocketEvents.SDR_ERROR,
                                    {"message": data["message"]},
                                    room=sdr_id,
                                )
                            else:
                                self.logger.warning(
                                    "Superseded SDR configuration failed: %s", data["message"]
                                )

                        elif data_type == "config-applied":
                            revision = data.get("config_revision", 0)
                            process_info["applied_config_revision"] = max(
                                revision, process_info.get("applied_config_revision", 0)
                            )
                            if process_info.get("pending_decoder_restart") is not None:
                                self._schedule_config_decoder_restart(sdr_id, process_info)

                        elif data_type == "receiver":
                            # Publish measurements independently from the requested
                            # config so mismatches remain visible to all viewers.
                            process_info["receiver_status"] = data["status"]
                            await self.sio.emit(
                                SocketEvents.SDR_STATUS,
                                {"sdr_id": sdr_id, "receiver_status": data["status"]},
                                room=sdr_id,
                            )

                        elif data_type == "bandwidth":
                            # Keep measured filter state separate from requested
                            # config, including for clients joining this worker later.
                            process_info["bandwidth_status"] = data["status"]
                            await self.sio.emit(
                                SocketEvents.SDR_STATUS,
                                {"sdr_id": sdr_id, "bandwidth_status": data["status"]},
                                room=sdr_id,
                            )

                        elif data_type == "stats":
                            # Store stats for performance monitoring
                            # Check if it's FFT stats or worker stats based on presence of sdr_id
                            if "sdr_id" in data:
                                # Worker process stats
                                process_info["worker_stats"] = data.get("stats", {})
                                self._resolve_ready_waiters(sdr_id, process_info)
                            else:
                                # FFT processor stats
                                process_info["fft_stats"] = data.get("stats", {})

                        elif data_type == QueueMessageTypes.STREAMING_START:
                            process_info["streaming_started"] = True
                            self._resolve_ready_waiters(sdr_id, process_info)
                            # Send streaming status to all clients connected to this SDR
                            await self.sio.emit(
                                SocketEvents.SDR_STATUS, {"streaming": True}, room=sdr_id
                            )

                        elif data_type == QueueMessageTypes.CONFIG_ERROR:
                            error_message = str(
                                data.get(DictKeys.MESSAGE) or "SDR configuration failed"
                            )
                            process_info["last_worker_error"] = error_message
                            pending_clients = {
                                waiter["client_id"]
                                for waiter in process_info.get("ready_waiters", [])
                                if waiter.get("client_id")
                            }
                            self._fail_ready_waiters(process_info, error_message)
                            await self._emit_worker_error(
                                sdr_id,
                                process_info,
                                SocketEvents.SDR_CONFIG_ERROR,
                                error_message,
                                pending_clients,
                            )
                            self.logger.error(f"Config error from SDR process: {error_message}")
                            if process_info.get("startup_ready") and not process_info.get(
                                "failure_reported"
                            ):
                                process_info["failure_reported"] = True
                                asyncio.create_task(
                                    self._notify_sdr_failure(
                                        sdr_id, set(process_info["clients"]), error_message
                                    )
                                )

                        elif data_type == QueueMessageTypes.ERROR:
                            error_message = str(data.get(DictKeys.MESSAGE) or "SDR worker failed")
                            process_info["last_worker_error"] = error_message
                            pending_clients = {
                                waiter["client_id"]
                                for waiter in process_info.get("ready_waiters", [])
                                if waiter.get("client_id")
                            }
                            self._fail_ready_waiters(process_info, error_message)
                            await self._emit_worker_error(
                                sdr_id,
                                process_info,
                                SocketEvents.SDR_ERROR,
                                error_message,
                                pending_clients,
                            )
                            self.logger.error(f"Error from SDR process: {error_message}")
                            if process_info.get("startup_ready") and not process_info.get(
                                "failure_reported"
                            ):
                                process_info["failure_reported"] = True
                                asyncio.create_task(
                                    self._notify_sdr_failure(
                                        sdr_id, set(process_info["clients"]), error_message
                                    )
                                )

                        elif data_type == QueueMessageTypes.TERMINATED:
                            error_message = str(
                                data.get(DictKeys.MESSAGE)
                                or process_info.get("last_worker_error")
                                or f"SDR {sdr_id} worker terminated unexpectedly"
                            )
                            self._fail_ready_waiters(process_info, error_message)
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
                            if (
                                process_info.get("startup_ready")
                                and not process_info["stop_event"].is_set()
                                and not process_info.get("failure_reported")
                            ):
                                process_info["failure_reported"] = True
                                runtime_failure = (set(process_info["clients"]), error_message)
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

                        elif data_type == "adsb-update":
                            await self.adsb_publisher.publish(data.get("aircraft", []))

                        elif data_type == "adsb-library":
                            # File IO stays outside this queue reader, which also
                            # forwards the waterfall's FFT frames.
                            self.adsb_publisher.schedule(data.get("folders", []))

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

                                if data_type == "decoder-status":
                                    self._log_decoder_error_status(data)
                                    entry = (
                                        process_info.get("decoders", {})
                                        .get(session_id, {})
                                        .get(data.get("vfo"))
                                    )
                                    if entry is not None:
                                        instance_id = getattr(
                                            entry.get("instance"), "decoder_id", None
                                        )
                                        if not instance_id or data.get("decoder_id") == instance_id:
                                            entry["status"] = dict(data)

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
                                elif (
                                    session_id in background_sessions.sessions
                                    and background_sessions.sessions[session_id].enabled
                                ):
                                    # JOIN viewers see the retained decoder output;
                                    # audio stays in the controller's session room.
                                    await self.sio.emit(
                                        SocketEvents.DECODER_DATA, data, room=sdr_id
                                    )
                                else:
                                    # Send to specific session only (user sessions)
                                    await self.sio.emit(
                                        SocketEvents.DECODER_DATA, data, room=session_id
                                    )

                                # If decoder output was saved, emit file browser state update
                                if data_type == "decoder-output" and "output" in data:
                                    output = data["output"]
                                    if "filepath" in output:
                                        self._schedule_decoded_library_refresh()
                                        await emit_file_browser_state(
                                            self.sio,
                                            {
                                                "action": "decoded-saved",
                                                "decoder_type": data.get("decoder_type"),
                                                "filepath": output["filepath"],
                                                "filename": output.get("filename"),
                                            },
                                            self.logger,
                                            reconcile=False,
                                        )
                            else:
                                self.logger.warning(
                                    f"Decoder message missing session_id: {data_type}"
                                )

                    except Exception as e:
                        self.logger.error(f"Error processing data from SDR process: {str(e)}")
                        self.logger.exception(e)
                else:
                    if not process_info["process"].is_alive():
                        error_message = str(
                            process_info.get("last_worker_error")
                            or f"SDR {sdr_id} worker exited before delivering samples"
                        )
                        self._fail_ready_waiters(process_info, error_message)
                        if (
                            process_info.get("startup_ready")
                            and not process_info["stop_event"].is_set()
                            and not process_info.get("failure_reported")
                        ):
                            process_info["failure_reported"] = True
                            runtime_failure = (set(process_info["clients"]), error_message)
                        break
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

            if runtime_failure:
                client_ids, error_message = runtime_failure
                await self._notify_sdr_failure(sdr_id, client_ids, error_message)
