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
from pathlib import Path

from fft.waterfallgenerator import WaterfallConfig, WaterfallGenerator
from handlers.entities.filebrowser import emit_file_browser_state
from pipeline.managers.consumerbase import ConsumerManager
from server import runtimestate
from tasks.registry import get_task


class RecorderManager(ConsumerManager):
    """
    Manager for recorder consumers
    """

    def __init__(self, processes, sio=None):
        super().__init__(processes)
        self.logger = logging.getLogger("recorder-manager")
        self.sio = sio  # Socket.IO instance for emitting notifications

        # Internal/fallback generation always uses built-in defaults.
        self.waterfall_generator = WaterfallGenerator(WaterfallConfig())

    def start_recorder(self, sdr_id, session_id, recorder_class, recorder_id=None, **kwargs):
        """
        Start a recorder thread for a specific session.

        Args:
            sdr_id: Device identifier
            session_id: Session identifier (client session ID)
            recorder_class: The recorder class to instantiate (e.g., IQRecorder)
            **kwargs: Additional arguments to pass to the recorder constructor (e.g., recording_path)

        Returns:
            bool: True if started successfully, False otherwise
        """
        return self._start_iq_consumer(
            sdr_id,
            session_id,
            recorder_class,
            None,
            "recorders",
            "recorder",
            consumer_key_override=recorder_id,
            **kwargs,
        )

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
        if sdr_id not in self.processes:
            return False

        process_info = self.processes[sdr_id]
        recorders = process_info.get("recorders", {})

        if session_id not in recorders:
            return False

        try:
            recorder_entry = recorders[session_id]
            # Handle both old format (direct instance) and new format (dict with instance + key)
            if isinstance(recorder_entry, dict):
                recorder = recorder_entry["instance"]
                subscription_key = recorder_entry["subscription_key"]
            else:
                recorder = recorder_entry
                subscription_key = session_id  # Fallback for old format

            recorder_name = type(recorder).__name__

            # Get recording path before stopping (for IQ recordings)
            recording_path = getattr(recorder, "recording_path", None)

            recorder.stop()
            recorder.join(timeout=2.0)  # Wait up to 2 seconds

            # Unsubscribe from the broadcaster using the correct subscription key
            broadcaster = process_info.get("iq_broadcaster")
            if broadcaster:
                broadcaster.unsubscribe(subscription_key)

            del recorders[session_id]
            self.logger.info(f"Stopped {recorder_name} for session {session_id}")

            # Emit file browser state update to notify UI of new IQ recording
            # Only emit for IQRecorder (not for other recorder types)
            if recorder_name == "IQRecorder":
                self.logger.info(
                    f"IQ recorder stopped - sio={self.sio is not None}, "
                    f"recording_path={recording_path}, skip_auto_waterfall={skip_auto_waterfall}"
                )

                if self.sio and recording_path:
                    asyncio.create_task(self._emit_recording_stopped_notification(recording_path))
                    # Generate waterfall spectrograms (unless UI already provided one)
                    if not skip_auto_waterfall:
                        self.logger.info(f"Scheduling waterfall generation for {recording_path}")
                        asyncio.create_task(self._generate_waterfall_async(recording_path))
                    else:
                        self.logger.info(
                            f"Skipping auto-waterfall generation for {recording_path} (UI provided)"
                        )
                elif not self.sio:
                    self.logger.warning(
                        "Socket.IO instance not available, skipping waterfall generation"
                    )
                elif not recording_path:
                    self.logger.warning(
                        "Recording path not available, skipping waterfall generation"
                    )

            return True

        except Exception as e:
            self.logger.error(f"Error stopping recorder: {str(e)}")
            return False

    def stop_all_recorders_for_session(self, sdr_id, session_id, skip_auto_waterfall=False):
        """
        Stop all recorder threads for a specific session.

        Args:
            sdr_id: Device identifier
            session_id: Session identifier
            skip_auto_waterfall: If True, skip automatic waterfall generation

        Returns:
            int: Number of recorders stopped
        """
        if sdr_id not in self.processes:
            return 0

        process_info = self.processes[sdr_id]
        recorders = process_info.get("recorders", {})
        if not recorders:
            return 0

        stopped = 0
        for recorder_key in list(recorders.keys()):
            recorder_entry = recorders.get(recorder_key)
            if isinstance(recorder_entry, dict):
                recorder_instance = recorder_entry.get("instance")
                recorder_session = getattr(recorder_instance, "session_id", None)
            else:
                recorder_session = getattr(recorder_entry, "session_id", None)

            if recorder_session != session_id:
                continue

            if self.stop_recorder(sdr_id, recorder_key, skip_auto_waterfall=skip_auto_waterfall):
                stopped += 1

        return stopped

    async def _emit_recording_stopped_notification(self, recording_path):
        """
        Emit file browser state update for IQ recording stopped.

        Args:
            recording_path: Path to the IQ recording file (without extension)
        """
        try:
            await emit_file_browser_state(
                self.sio,
                {
                    "action": "recording-stopped",
                    "recording_path": str(recording_path),
                },
                self.logger,
            )
        except Exception as e:
            self.logger.error(f"Error emitting recording-stopped notification: {e}")

    async def _generate_waterfall_async(self, recording_path):
        """
        Generate waterfall spectrograms using the background task system.

        Args:
            recording_path: Path to the IQ recording file (without extension)
        """
        try:
            background_task_manager = runtimestate.background_task_manager

            if not background_task_manager:
                self.logger.error(
                    "Background task manager not available, falling back to legacy method"
                )
                # Fallback to old method if task manager not available
                loop = asyncio.get_event_loop()
                success = await loop.run_in_executor(
                    None, self.waterfall_generator.generate_from_sigmf, Path(recording_path)
                )
                if success and self.sio:
                    await emit_file_browser_state(
                        self.sio,
                        {"action": "waterfall-generated", "recording_path": recording_path},
                        self.logger,
                    )
                return

            # Use background task system
            task_func = get_task("generate_waterfall")
            recording_name = Path(recording_path).name

            task_id = await background_task_manager.start_task(
                func=task_func,
                args=(str(recording_path),),
                kwargs={},
                name=f"Waterfall: {recording_name}",
            )

            self.logger.info(f"Started waterfall generation task {task_id} for {recording_path}")

            # Note: The completion will be handled by the task manager's completion event
            # which will emit "background_task:completed" to the UI
            # The UI can then emit the file browser update if needed

        except Exception as e:
            self.logger.error(f"Error starting waterfall generation task: {e}")
            self.logger.exception(e)

    def _stop_consumer(self, sdr_id, session_id, storage_key, vfo_number=None):
        """
        Implementation of base class method for stopping recorders
        """
        return self.stop_recorder(sdr_id, session_id)

    def get_active_recorder(self, sdr_id, session_id):
        """
        Get the active recorder for a session.

        Args:
            sdr_id: Device identifier
            session_id: Session identifier

        Returns:
            Recorder instance or None if not found
        """
        if sdr_id not in self.processes:
            return None

        process_info = self.processes[sdr_id]
        recorders = process_info.get("recorders", {})
        recorder_entry = recorders.get(session_id)

        if recorder_entry is None:
            return None

        # Handle both old format (direct instance) and new format (dict with instance)
        if isinstance(recorder_entry, dict):
            return recorder_entry.get("instance")
        return recorder_entry
