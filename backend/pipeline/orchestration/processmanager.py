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
import signal
from typing import Any, Dict, List, Optional

from common.constants import SocketEvents
from monitoring.performancemonitor import PerformanceMonitor
from pipeline.managers.audiorecordermanager import AudioRecorderManager
from pipeline.managers.decodermanager import DecoderManager
from pipeline.managers.demodulatormanager import DemodulatorManager
from pipeline.managers.recordermanager import RecorderManager
from pipeline.managers.transcriptionmanager import TranscriptionManager
from pipeline.orchestration.processlifecycle import ProcessLifecycleManager
from server import shutdown


class ProcessManager:
    """
    Manager for the SDR worker processes

    This is the main orchestrator that delegates to specialized manager classes:
    - ProcessLifecycleManager: handles process start/stop/configure/monitor
    - DemodulatorManager: manages demodulator consumers
    - RecorderManager: manages recorder consumers
    - DecoderManager: manages decoder consumers
    - TranscriptionManager: manages per-VFO transcription consumers
    """

    def __init__(self, sio=None, event_loop=None):
        self.logger = logging.getLogger("process-manager")
        self.sio = sio
        self.event_loop = event_loop
        self.processes: Dict[str, Dict[str, Any]] = {}  # Map of sdr_id to process information

        # Initialize specialized managers
        self.demodulator_manager = DemodulatorManager(self.processes)
        self.recorder_manager = RecorderManager(self.processes, sio=self.sio)
        self.audio_recorder_manager = AudioRecorderManager(self.processes, sio=self.sio)
        self.decoder_manager = DecoderManager(self.processes, self.demodulator_manager)
        self.transcription_manager = None  # Will be initialized when event loop is available
        self.lifecycle_manager = ProcessLifecycleManager(
            self.processes,
            self.sio,
            self.demodulator_manager,
            self.recorder_manager,
            self.decoder_manager,
            self.audio_recorder_manager,
        )

        # Initialize performance monitor
        self.performance_monitor = PerformanceMonitor(self, update_interval=2.0)
        self.performance_monitor.start()

        # Start background task to emit performance metrics to UI
        self._metrics_emission_task = None
        if self.sio:
            self._start_metrics_emission()

        # Set up signal handlers
        signal.signal(signal.SIGINT, self._signal_handler)
        signal.signal(signal.SIGTERM, self._signal_handler)

    def set_sio(self, sio):
        """
        Update the Socket.IO server instance after initialization

        Args:
            sio: Socket.IO server instance
        """
        self.sio = sio
        self.lifecycle_manager.sio = sio
        # The publisher is created before startup attaches Socket.IO. Keep its
        # server reference in sync for both live aircraft and library updates.
        self.lifecycle_manager.adsb_publisher.sio = sio
        self.recorder_manager.sio = sio
        self.audio_recorder_manager.sio = sio

        # Initialize transcription manager if we have both sio and event loop
        if self.event_loop and not self.transcription_manager:
            self.transcription_manager = TranscriptionManager(
                self.processes, self.sio, self.event_loop
            )
            # Update lifecycle manager with transcription manager
            self.lifecycle_manager.transcription_manager = self.transcription_manager
            self.logger.info("TranscriptionManager initialized")

        # Try to start metrics emission (will be deferred if no event loop)
        self._start_metrics_emission()

    def set_event_loop(self, event_loop):
        """
        Update the event loop after initialization

        Args:
            event_loop: Asyncio event loop
        """
        self.event_loop = event_loop

        # Initialize transcription manager if we have both sio and event loop
        if self.sio and not self.transcription_manager:
            self.transcription_manager = TranscriptionManager(
                self.processes, self.sio, self.event_loop
            )
            # Update lifecycle manager with transcription manager
            self.lifecycle_manager.transcription_manager = self.transcription_manager
            self.logger.info("TranscriptionManager initialized")

    def get_audio_consumer(self):
        """Get the global audio consumer from shutdown module."""
        try:
            return getattr(shutdown, "audio_consumer", None)
        except Exception:
            return None

    def start_monitoring(self):
        """
        Start performance monitoring emission.

        This should be called from within an async context (e.g., FastAPI lifespan).
        """
        if self.sio and not self._metrics_emission_task:
            self._start_metrics_emission()

    def _start_metrics_emission(self):
        """
        Start background task to emit performance metrics to UI.

        Note: This must be called from within an async context (running event loop).
        If called during module initialization, it will be deferred until start_monitoring() is called.
        """
        try:
            # Try to get the running event loop
            asyncio.get_running_loop()
            if self.sio and not self._metrics_emission_task:
                self._metrics_emission_task = asyncio.create_task(self._emit_performance_metrics())
                self.logger.debug("Started performance metrics emission task")
        except RuntimeError:
            # No event loop running yet - this is okay, will be started later via start_monitoring()
            self.logger.debug("Event loop not running yet, metrics emission will be started later")

    async def _emit_performance_metrics(self):
        """Background task that reads metrics from monitor and emits to UI via WebSocket"""

        while True:
            try:
                # Get latest metrics from monitor (blocking with timeout)
                # Timeout should be slightly longer than update_interval to avoid timeouts
                metrics = await asyncio.get_event_loop().run_in_executor(
                    None, self.performance_monitor.get_latest_metrics, 3.0
                )

                if metrics and self.sio:
                    # Emit to all connected clients
                    await self.sio.emit(SocketEvents.PERFORMANCE_METRICS, metrics)

            except Exception as e:
                self.logger.error(f"Error emitting performance metrics: {e}")
                self.logger.exception(e)
                # Continue running even if there's an error
                await asyncio.sleep(2.0)

    # ==================== Process Lifecycle Methods ====================

    def set_sdr_failure_handler(self, handler):
        """Forward unexpected SDR worker failures to the observation lifecycle."""
        self.lifecycle_manager.set_sdr_failure_handler(handler)

    async def get_center_frequency(self, sdr_id):
        """
        Get the current center frequency of an SDR worker process

        Args:
            sdr_id: Device identifier

        Returns:
            float: Current center frequency in Hz, or None if process not found/running
        """
        return await self.lifecycle_manager.get_center_frequency(sdr_id)

    async def start_sdr_process(self, sdr_device, sdr_config, client_id, force_takeover=False):
        """
        Start an SDR worker process

        Args:
            sdr_device: Dictionary with device connection parameters
            sdr_config: Dictionary with configuration parameters
            client_id: Client identifier

        Returns:
            The device ID for the started process
        """
        return await self.lifecycle_manager.start_sdr_process(
            sdr_device, sdr_config, client_id, force_takeover=force_takeover
        )

    async def stop_sdr_process(self, sdr_id, client_id=None):
        """
        Stop an SDR worker process

        Args:
            sdr_id: Device identifier
            client_id: Client identifier (optional)
        """
        await self.lifecycle_manager.stop_sdr_process(sdr_id, client_id)

    async def stop_sdr_join(self, sdr_id, client_id, sio=None):
        """Release a joiner, stopping the worker only when no clients remain."""
        return await self.lifecycle_manager.stop_sdr_join(sdr_id, client_id, sio=sio)

    async def update_configuration(self, sdr_id, config):
        """
        Update the configuration of an SDR worker process

        Args:
            sdr_id: Device identifier
            config: Dictionary with configuration parameters
        """
        await self.lifecycle_manager.update_configuration(sdr_id, config)

    def is_sdr_process_running(self, sdr_id):
        """
        Check if an SDR process exists and is running

        Args:
            sdr_id: Device identifier

        Returns:
            bool: True if the process exists and is running, False otherwise
        """
        return sdr_id in self.processes and self.processes[sdr_id]["process"].is_alive()

    # ==================== Read-only Introspection Helpers ====================

    def list_sdrs(self) -> List[str]:
        """Return a list of SDR IDs known to the manager (keys of the registry)."""
        return list(self.processes.keys())

    def get_sdr_status(self, sdr_id: str) -> Dict[str, Any]:
        """Return a simple status dict for a given SDR id (alive flag, pid, name)."""
        info: Dict[str, Any] = {"alive": False}
        pinfo: Optional[Dict[str, Any]] = self.processes.get(sdr_id)
        if not pinfo:
            return info
        proc = pinfo.get("process")
        if proc is not None:
            try:
                info["alive"] = bool(proc.is_alive())
                info["pid"] = getattr(proc, "pid", None)
                info["name"] = getattr(proc, "name", None)
            except Exception:
                # Be defensive; return best-effort info
                info["alive"] = False
        return info

    def list_all_consumers(self) -> Dict[str, Dict[str, Any]]:
        """
        Return a JSON-safe snapshot of clients and per-session consumers for all SDRs.

        Structure per SDR:
        {
          sdr_id: {
            "clients": [session_id, ...],
            "demodulators": { session_id: { vfo_number: class_name } },
            "recorders": { session_id: class_name_or_none },
            "decoders": { session_id: { vfo_number: class_name } }
          }
        }
        """
        result: Dict[str, Dict[str, Any]] = {}
        for sdr_id, pinfo in self.processes.items():
            entry: Dict[str, Any] = {
                "clients": list(pinfo.get("clients", [])),
                "demodulators": {},
                "recorders": {},
                "decoders": {},
            }

            # Demodulators: session_id -> {vfo_number: class_name}
            for sid, vfos in pinfo.get("demodulators", {}).items():
                entry["demodulators"][sid] = {}
                for vfo_num, vfo_entry in getattr(vfos, "items", lambda: [])():
                    # Prefer normalized "class_name" if present; fallback to instance type name
                    if isinstance(vfo_entry, dict):
                        class_name = vfo_entry.get("class_name")
                        if not class_name:
                            inst = vfo_entry.get("instance")
                            class_name = type(inst).__name__ if inst else None
                    else:
                        class_name = type(vfo_entry).__name__ if vfo_entry else None
                    entry["demodulators"][sid][vfo_num] = class_name

            # Recorders: session_id -> class_name
            for sid, rec_entry in pinfo.get("recorders", {}).items():
                if isinstance(rec_entry, dict):
                    class_name = rec_entry.get("class_name")
                    if not class_name:
                        inst = rec_entry.get("instance")
                        class_name = type(inst).__name__ if inst else None
                else:
                    class_name = type(rec_entry).__name__ if rec_entry else None
                entry["recorders"][sid] = class_name

            # Decoders: session_id -> {vfo_number: class_name}
            for sid, vfos in pinfo.get("decoders", {}).items():
                entry["decoders"][sid] = {}
                for vfo_num, vfo_entry in getattr(vfos, "items", lambda: [])():
                    if isinstance(vfo_entry, dict):
                        class_name = vfo_entry.get("class_name") or vfo_entry.get("decoder_type")
                        if not class_name:
                            inst = vfo_entry.get("instance")
                            class_name = type(inst).__name__ if inst else None
                    else:
                        class_name = type(vfo_entry).__name__ if vfo_entry else None
                    entry["decoders"][sid][vfo_num] = class_name

            result[sdr_id] = entry

        return result

    # ==================== Demodulator Methods ====================

    def start_demodulator(
        self, sdr_id, session_id, demodulator_class, audio_queue, vfo_number=None, **kwargs
    ):
        """
        Start a demodulator thread for a specific session and VFO.

        Args:
            sdr_id: Device identifier
            session_id: Session identifier (client session ID)
            demodulator_class: The demodulator class to instantiate
            audio_queue: Queue where demodulated audio will be placed
            vfo_number: VFO number (1-4). If None, uses session_id as key
            **kwargs: Additional arguments to pass to the demodulator constructor

        Returns:
            bool: True if started successfully, False otherwise
        """
        return self.demodulator_manager.start_demodulator(
            sdr_id, session_id, demodulator_class, audio_queue, vfo_number, **kwargs
        )

    def stop_demodulator(self, sdr_id, session_id, vfo_number=None):
        """
        Stop a demodulator thread for a specific session and optionally a specific VFO.

        Args:
            sdr_id: Device identifier
            session_id: Session identifier
            vfo_number: VFO number (1-4). If None, stops all demodulators for session

        Returns:
            bool: True if stopped successfully, False otherwise
        """
        return self.demodulator_manager.stop_demodulator(sdr_id, session_id, vfo_number)

    def get_active_demodulator(self, sdr_id, session_id):
        """
        Get the active demodulator for a session.

        Args:
            sdr_id: Device identifier
            session_id: Session identifier

        Returns:
            Demodulator instance or None if not found
        """
        return self.demodulator_manager.get_active_demodulator(sdr_id, session_id)

    def flush_all_demodulator_queues(self, sdr_id):
        """
        Flush all demodulator IQ queues for an SDR.

        Args:
            sdr_id: Device identifier
        """
        self.demodulator_manager.flush_all_demodulator_queues(sdr_id)

    # ==================== Recorder Methods ====================

    def start_recorder(self, sdr_id, session_id, recorder_class, **kwargs):
        """
        Start a recorder thread for a specific session.

        Args:
            sdr_id: Device identifier
            session_id: Session identifier (client session ID)
            recorder_class: The recorder class to instantiate
            **kwargs: Additional arguments to pass to the recorder constructor

        Returns:
            bool: True if started successfully, False otherwise
        """
        return self.recorder_manager.start_recorder(sdr_id, session_id, recorder_class, **kwargs)

    def stop_recorder(self, sdr_id, session_id, skip_auto_waterfall=False):
        """
        Stop a recorder thread for a specific session.

        Args:
            sdr_id: Device identifier
            session_id: Session identifier
            skip_auto_waterfall: If True, skip automatic waterfall generation

        Returns:
            bool: True if stopped successfully, False otherwise
        """
        return self.recorder_manager.stop_recorder(sdr_id, session_id, skip_auto_waterfall)

    def get_active_recorder(self, sdr_id, session_id):
        """
        Get the active recorder for a session.

        Args:
            sdr_id: Device identifier
            session_id: Session identifier

        Returns:
            Recorder instance or None if not found
        """
        return self.recorder_manager.get_active_recorder(sdr_id, session_id)

    # ==================== Audio Recorder Methods ====================

    def start_audio_recorder(self, sdr_id, session_id, vfo_number, recorder_class, **kwargs):
        """
        Start an audio recorder thread for a specific VFO.

        Args:
            sdr_id: Device identifier
            session_id: Session identifier (client session ID)
            vfo_number: VFO number (1-4)
            recorder_class: The recorder class to instantiate
            **kwargs: Additional arguments to pass to the recorder constructor

        Returns:
            bool: True if started successfully, False otherwise
        """
        return self.audio_recorder_manager.start_audio_recorder(
            sdr_id, session_id, vfo_number, recorder_class, **kwargs
        )

    def stop_audio_recorder(self, sdr_id, session_id, vfo_number):
        """
        Stop an audio recorder thread for a specific VFO.

        Args:
            sdr_id: Device identifier
            session_id: Session identifier
            vfo_number: VFO number

        Returns:
            bool: True if stopped successfully, False otherwise
        """
        return self.audio_recorder_manager.stop_audio_recorder(sdr_id, session_id, vfo_number)

    def get_active_audio_recorder(self, sdr_id, session_id, vfo_number):
        """
        Get the active audio recorder for a VFO.

        Args:
            sdr_id: Device identifier
            session_id: Session identifier
            vfo_number: VFO number

        Returns:
            AudioRecorder instance or None if not found
        """
        return self.audio_recorder_manager.get_active_recorder(sdr_id, session_id, vfo_number)

    def is_vfo_recording_audio(self, sdr_id, session_id, vfo_number):
        """
        Check if a VFO is currently recording audio.

        Args:
            sdr_id: Device identifier
            session_id: Session identifier
            vfo_number: VFO number

        Returns:
            bool: True if VFO is recording audio, False otherwise
        """
        return self.audio_recorder_manager.is_vfo_recording(sdr_id, session_id, vfo_number)

    # ==================== Decoder Methods ====================

    def start_decoder(
        self, sdr_id, session_id, decoder_class, data_queue, audio_out_queue=None, **kwargs
    ):
        """
        Start a decoder thread for a specific session.

        Args:
            sdr_id: Device identifier
            session_id: Session identifier (client session ID)
            decoder_class: The decoder class to instantiate
            data_queue: Queue where decoded data will be placed
            audio_out_queue: Optional queue for streaming demodulated audio to UI
            **kwargs: Additional arguments to pass to the decoder constructor

        Returns:
            bool: True if started successfully, False otherwise
        """
        return self.decoder_manager.start_decoder(
            sdr_id, session_id, decoder_class, data_queue, audio_out_queue, **kwargs
        )

    def stop_decoder(self, sdr_id, session_id, vfo_number=None):
        """
        Stop a decoder thread for a specific session and optionally a specific VFO.

        Args:
            sdr_id: Device identifier
            session_id: Session identifier
            vfo_number: VFO number (1-4). If None, stops all decoders for session

        Returns:
            bool: True if stopped successfully, False otherwise
        """
        return self.decoder_manager.stop_decoder(sdr_id, session_id, vfo_number)

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
        return self.decoder_manager.get_active_decoder(sdr_id, session_id, vfo_number)

    # ==================== Utility Methods ====================

    def _signal_handler(self, signum, frame):
        """
        Handle system signals for graceful shutdown

        Args:
            signum: Signal number
            frame: Current stack frame
        """
        self.logger.info(f"Received signal {signum}, shutting down all SDR processes...")
        for sdr_id in list(self.processes.keys()):
            asyncio.create_task(self.stop_sdr_process(sdr_id))

        # Stop performance monitor
        if self.performance_monitor:
            self.performance_monitor.stop()
            self.logger.info("Stopped performance monitor")

    def shutdown(self):
        """
        Gracefully shutdown the process manager and all monitoring tasks
        """
        self.logger.info("Shutting down process manager...")

        # Stop performance monitor
        if self.performance_monitor:
            self.performance_monitor.stop()
            self.logger.info("Stopped performance monitor")

        # Cancel metrics emission task
        if self._metrics_emission_task:
            self._metrics_emission_task.cancel()
            self.logger.info("Cancelled metrics emission task")


# Set up the process manager
process_manager = ProcessManager()
