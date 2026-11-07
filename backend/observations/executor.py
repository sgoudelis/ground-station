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

"""Observation execution service - handles lifecycle of scheduled observations."""

import asyncio
import json
import traceback
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Optional, cast

from common.logger import logger
from common.satdump import resolve_satdump_output_dir, validate_satdump_pipeline
from common.sdrconfig import SDRConfig
from crud import trackingstate
from crud.hardware import fetch_sdr
from crud.scheduledobservations import fetch_scheduled_observations
from db import AsyncSessionLocal
from handlers.entities.filebrowser import emit_file_browser_state
from observations import events as observation_events
from observations.bundle import (
    add_bundle_session,
    create_observation_bundle,
    finalize_interrupted_observation_bundles,
    finalize_observation_bundle,
    observation_snapshot,
    write_bundle_manifest,
)
from observations.constants import (
    STATUS_CANCELLED,
    STATUS_COMPLETED,
    STATUS_FAILED,
    STATUS_RUNNING,
    STATUS_SCHEDULED,
)
from observations.helpers import (
    log_execution_event,
    remove_scheduled_stop_job,
    update_observation_status,
)
from observations.tasks.decoderhandler import DecoderHandler
from observations.tasks.recorderhandler import RecorderHandler
from observations.tasks.trackerhandler import TrackerHandler
from observations.tasks.transcriptionhandler import TranscriptionHandler
from server import runtimestate
from session.service import session_service
from session.tracker import session_tracker
from tasks.registry import get_task
from tracker.contracts import get_tracking_state_name
from tracker.runner import get_assigned_tracker_for_rotator
from vfos.state import INTERNAL_VFO_NUMBER, VFOManager

RESTART_INTERRUPTION_REASON = "Backend restarted while observation was running"
SHUTDOWN_INTERRUPTION_REASON = "Backend shutdown interrupted observation"
INTERRUPTION_CLEANUP_TIMEOUT_SECONDS = 90


class ObservationExecutor:
    """
    Executes scheduled observations by orchestrating SDR, VFO, decoder, and tracker components.

    This service is triggered by APScheduler at AOS (Acquisition of Signal) time,
    starts all necessary processes, and stops them at LOS (Loss of Signal) time.
    """

    def __init__(self, process_manager: Any, sio: Any):
        """
        Initialize the observation executor.

        Args:
            process_manager: ProcessManager instance for SDR/decoder lifecycle
            sio: Socket.IO server instance for event emission
        """
        self.process_manager = process_manager
        self.sio = sio
        self._vfo_manager: Optional[VFOManager] = None

        # Initialize task handlers
        self.decoder_handler = DecoderHandler(process_manager)
        self.recorder_handler = RecorderHandler(process_manager)
        self.transcription_handler = TranscriptionHandler(process_manager)
        self.tracker_handler = TrackerHandler(sio=sio)

        # Track actively executing observations to prevent concurrent starts
        self._running_observations: set[str] = set()
        self._observations_lock: Optional[asyncio.Lock] = None  # Will be initialized lazily
        self._iq_recording_info: Dict[str, Dict[str, Dict[int, Dict[str, Any]]]] = {}
        self._bundle_dirs: Dict[str, Path] = {}
        self._tracker_context_by_observation: Dict[str, Dict[str, Any]] = {}
        self._starting_observations: set[str] = set()
        self._failing_observations: set[str] = set()
        self._pending_sdr_failures: Dict[str, str] = {}

        failure_handler_setter = getattr(process_manager, "set_sdr_failure_handler", None)
        if callable(failure_handler_setter):
            failure_handler_setter(self.handle_sdr_failure)

    @property
    def vfo_manager(self):
        """Return cached VFOManager instance."""
        if self._vfo_manager is None:
            self._vfo_manager = VFOManager()
        return self._vfo_manager

    async def _publish_bundle_change(self, action: str, observation_id: str, **state: Any) -> None:
        """Update the library after an observation changes bundle storage."""
        if not self.sio:
            return
        await emit_file_browser_state(
            self.sio,
            {"action": action, "observation_id": observation_id, **state},
            logger,
        )

    async def _finalize_bundle(self, observation_id: str, bundle_dir: Path, status: str) -> bool:
        """Finalize a bundle and publish its final filesystem state once.

        Individual workers normally announce their completed files. The bundle
        boundary is still authoritative: it captures manifest-only changes and
        artifacts from a worker that could not publish its own completion event.
        """
        retained: bool = bool(finalize_observation_bundle(bundle_dir, status))
        await self._publish_bundle_change(
            "observation-bundle-finalized", observation_id, retained=retained
        )
        return retained

    def _get_observations_lock(self) -> asyncio.Lock:
        """Lazy-load asyncio.Lock to avoid event loop issues during initialization."""
        if self._observations_lock is None:
            self._observations_lock = asyncio.Lock()
        return self._observations_lock

    async def handle_sdr_failure(
        self, sdr_id: str, internal_session_ids: set[str], message: str
    ) -> None:
        """Fail observations whose SDR worker stopped or reported an unrecoverable error."""
        observation_ids: set[str] = set()
        for session_id in internal_session_ids:
            metadata = session_tracker.get_session_metadata(session_id) or {}
            observation_id = metadata.get("observation_id")
            if not observation_id and VFOManager.is_internal_session(session_id):
                internal_part = session_id[len(VFOManager.INTERNAL_PREFIX) :]
                observation_id = internal_part.split(":", 1)[0]
            if observation_id:
                observation_ids.add(str(observation_id))

        error_message = f"SDR {sdr_id} failed: {message}"
        for observation_id in observation_ids:
            # The startup path owns rollback while resources are still being
            # assembled. Recording the failure lets it stop every partial session.
            if observation_id in self._starting_observations:
                self._pending_sdr_failures[observation_id] = error_message
                continue
            await self._fail_running_observation(observation_id, error_message)

    async def _fail_running_observation(self, observation_id: str, error_message: str) -> None:
        if observation_id in self._failing_observations:
            return
        self._failing_observations.add(observation_id)
        should_finalize = False
        try:
            async with AsyncSessionLocal() as session:
                result = await fetch_scheduled_observations(session, observation_id)
            if not result.get("success") or not result.get("data"):
                logger.error(
                    "Cannot fail observation %s after runtime interruption: not found",
                    observation_id,
                )
                return

            observation = result["data"]
            current_status = str(observation.get("status") or "").lower()
            if current_status in {STATUS_CANCELLED, STATUS_COMPLETED, STATUS_FAILED}:
                return
            should_finalize = True

            # Commit FAILED before cleanup so a delayed LOS job cannot overwrite it.
            await log_execution_event(observation_id, error_message, "error")
            updated = await update_observation_status(
                self.sio, observation_id, STATUS_FAILED, error_message
            )
            if not updated:
                logger.error(
                    "Failed to persist interrupted observation %s as failed", observation_id
                )
            await remove_scheduled_stop_job(observation_id)

            try:
                await self._stop_observation_task(observation_id, observation)
            except Exception as cleanup_error:
                logger.exception(
                    "Failed to clean up observation %s after runtime interruption: %s",
                    observation_id,
                    cleanup_error,
                )
                await log_execution_event(
                    observation_id,
                    f"Cleanup after runtime interruption failed: {cleanup_error}",
                    "error",
                )

        finally:
            self._running_observations.discard(observation_id)
            self._starting_observations.discard(observation_id)
            self._pending_sdr_failures.pop(observation_id, None)

            bundle_dir = self._bundle_dirs.pop(observation_id, None)
            if should_finalize and bundle_dir and bundle_dir.exists():
                await self._finalize_bundle(observation_id, bundle_dir, "failed")

            # A fresh process has no in-memory bundle map. Recover matching
            # bundles by their persisted manifest so the UI does not show them
            # as in progress forever after a restart.
            if should_finalize:
                try:
                    finalized_count = finalize_interrupted_observation_bundles(
                        observation_id, Path(__file__).parents[1]
                    )
                    if finalized_count:
                        await self._publish_bundle_change(
                            "observation-bundle-finalized",
                            observation_id,
                            recovered=finalized_count,
                        )
                except Exception:
                    logger.exception(
                        "Failed to finalize interrupted bundle for observation %s",
                        observation_id,
                    )
            self._failing_observations.discard(observation_id)

    async def interrupt_running_observations(
        self,
        reason: str,
        cleanup_timeout: float = INTERRUPTION_CLEANUP_TIMEOUT_SECONDS,
    ) -> Dict[str, int]:
        """Fail and clean up every observation persisted as running.

        The failed status is committed before runtime cleanup begins. This is
        deliberate: cleanup can involve hardware and worker processes, so a
        timeout must never leave the durable status stuck at ``running``.
        """
        async with AsyncSessionLocal() as session:
            result = await fetch_scheduled_observations(session)

        if not result.get("success"):
            raise RuntimeError(result.get("error") or "Failed to fetch observations")

        running_ids = [
            str(observation["id"])
            for observation in result.get("data", [])
            if observation.get("id")
            and str(observation.get("status") or "").lower() == STATUS_RUNNING
        ]
        stats = {"found": len(running_ids), "failed": 0, "timed_out": 0, "errors": 0}

        for observation_id in running_ids:
            try:
                await asyncio.wait_for(
                    self._fail_running_observation(observation_id, reason),
                    timeout=cleanup_timeout,
                )
                stats["failed"] += 1
            except asyncio.TimeoutError:
                stats["timed_out"] += 1
                logger.error(
                    "Timed out after %.1fs cleaning interrupted observation %s; "
                    "its failed transition was attempted before cleanup",
                    cleanup_timeout,
                    observation_id,
                )
            except Exception:
                stats["errors"] += 1
                logger.exception("Failed to reconcile interrupted observation %s", observation_id)

        return stats

    def _get_session_key(self, session: Dict[str, Any], session_index: int) -> str:
        sdr_id = session.get("sdr", {}).get("id") if isinstance(session, dict) else None
        return str(sdr_id) if sdr_id else f"session-{session_index}"

    @staticmethod
    def _requires_observation_bundle(sessions: list[Dict[str, Any]]) -> bool:
        """Include derived products even when their source IQ is disposable."""
        bundled_task_types = {"decoder", "audio_recording", "transcription", "iq_recording"}

        for session in sessions:
            tasks = session.get("tasks", []) if isinstance(session, dict) else []
            for task in tasks:
                if not isinstance(task, dict):
                    # Preserve artifacts for malformed or future task shapes.
                    return True

                task_type = task.get("type")
                if task_type in bundled_task_types:
                    return True

                if task_type:
                    # Unknown task types may write artifacts, so default to the
                    # safe bundle-preserving behavior.
                    return True

        return False

    @staticmethod
    def _resolve_tracker_id(rotator_config: Dict[str, Any]) -> str:
        """Resolve tracker slot id from current rotator ownership only."""
        owner_tracker_id = get_assigned_tracker_for_rotator(rotator_config.get("id"))
        if owner_tracker_id is None:
            return ""
        tracker_id = str(owner_tracker_id).strip()
        if not tracker_id or tracker_id.lower() == "none":
            return ""
        return tracker_id

    async def start_observation(self, observation_id: str) -> Dict[str, Any]:
        """
        Start an observation at AOS time.

        This method:
        1. Loads observation configuration from database
        2. Persists RUNNING before starting runtime resources
        3. Checks if SDR is available (logs warning if in use)
        4. Creates internal VFO session
        5. Starts SDR processes for each session
        6. Configures VFOs based on session tasks
        7. Starts decoders, recorders, and trackers

        Args:
            observation_id: The observation ID to start

        Returns:
            Dictionary with success status and error message if failed
        """
        started_sessions: list[tuple[str, Dict[str, Any]]] = []
        tracker_context: Optional[Dict[str, Any]] = None
        try:
            logger.info(f"Starting observation: {observation_id}")
            await log_execution_event(observation_id, "Start requested", "info")

            # Check if this observation is already running (prevent duplicate execution)
            lock = self._get_observations_lock()
            async with lock:
                if observation_id in self._running_observations:
                    error_msg = f"Observation {observation_id} is already executing"
                    logger.error(error_msg)
                    await log_execution_event(observation_id, error_msg, "error")
                    return {"success": False, "error": error_msg}

                # Mark as running immediately to prevent race condition
                self._running_observations.add(observation_id)
                logger.debug(f"Marked observation {observation_id} as executing")

            # 1. Load observation from database
            async with AsyncSessionLocal() as session:
                result = await fetch_scheduled_observations(session, observation_id)
                if not result["success"] or not result["data"]:
                    error_msg = f"Observation not found: {observation_id}"
                    logger.error(error_msg)
                    await log_execution_event(observation_id, error_msg, "error")
                    self._running_observations.discard(observation_id)
                    return {"success": False, "error": error_msg}

                observation = result["data"]

            # 2. Check if observation is enabled and scheduled
            if not observation.get("enabled", True):
                logger.warning(f"Observation {observation_id} is disabled, skipping")
                await log_execution_event(observation_id, "Observation is disabled", "warning")
                self._running_observations.discard(observation_id)
                return {"success": False, "error": "Observation is disabled"}

            status = observation.get("status", "").lower()
            if status != STATUS_SCHEDULED:
                error_msg = f"Invalid status: {observation.get('status')}"
                logger.warning(
                    f"Observation {observation_id} has status {observation.get('status')}, skipping"
                )
                await log_execution_event(observation_id, error_msg, "warning")
                self._running_observations.discard(observation_id)
                return {"success": False, "error": error_msg}

            sessions = observation.get("sessions", []) or []
            if not sessions:
                error_msg = f"Observation {observation_id} has no sessions configured"
                logger.error(error_msg)
                await log_execution_event(observation_id, error_msg, "error")
                await update_observation_status(self.sio, observation_id, STATUS_FAILED, error_msg)
                await remove_scheduled_stop_job(observation_id)
                self._running_observations.discard(observation_id)
                return {"success": False, "error": error_msg}

            # 3. If rotator is required and currently parked, either unpark or cancel
            rotator_config = observation.get("rotator", {}) or {}
            if rotator_config.get("tracking_enabled") and rotator_config.get("id"):
                tracker_id = self._resolve_tracker_id(rotator_config)
                if not tracker_id:
                    logger.warning(
                        "Observation %s rotator has no assigned tracker slot yet; skipping parked-state precheck",
                        observation_id,
                    )
                else:
                    state_name = get_tracking_state_name(tracker_id)
                async with AsyncSessionLocal() as session:
                    tracking_state_reply = (
                        await trackingstate.get_tracking_state(session, state_name)
                        if tracker_id
                        else {"success": True, "data": None}
                    )
                    if tracking_state_reply.get("success"):
                        tracking_value = (tracking_state_reply.get("data") or {}).get("value", {})
                        rotator_state = str(tracking_value.get("rotator_state", "")).lower()
                        if rotator_state == "parked":
                            if not bool(rotator_config.get("unpark_before_tracking", False)):
                                msg = (
                                    f"Rotator is parked; cancelling observation {observation_id} "
                                    f"(unpark_before_tracking is disabled)"
                                )
                                logger.warning(msg)
                                await log_execution_event(observation_id, msg, "warning")
                                await update_observation_status(
                                    self.sio, observation_id, STATUS_CANCELLED
                                )
                                await remove_scheduled_stop_job(observation_id)
                                self._running_observations.discard(observation_id)
                                return {"success": False, "error": msg}
                            await log_execution_event(
                                observation_id,
                                "Rotator is parked; unpark_before_tracking is enabled, will unpark before tracking",
                                "info",
                            )
                    else:
                        logger.warning(
                            f"Failed to fetch tracking state; proceeding with observation "
                            f"{observation_id}: {tracking_state_reply.get('error')}"
                        )

            # 4. Check if SDRs are available (not in use by other sessions)
            for session_index, session in enumerate(sessions, start=1):
                sdr_config_dict = session.get("sdr", {}) if isinstance(session, dict) else {}
                sdr_id = sdr_config_dict.get("id")

                if not sdr_id:
                    error_msg = f"Observation {observation_id} session {session_index} has no SDR configured"
                    logger.error(error_msg)
                    await log_execution_event(observation_id, error_msg, "error")
                    await update_observation_status(
                        self.sio, observation_id, STATUS_FAILED, error_msg
                    )
                    await remove_scheduled_stop_job(observation_id)
                    self._running_observations.discard(observation_id)
                    return {"success": False, "error": error_msg}

                # Check if SDR is already in use - if so, we'll hijack it and reconfigure
                sessions_using_sdr = session_tracker.get_sessions_for_sdr(sdr_id)
                if sessions_using_sdr:
                    msg = f"SDR '{sdr_id}' in use by {len(sessions_using_sdr)} session(s), will hijack"
                    logger.info(msg)
                    await log_execution_event(observation_id, msg, "info")
                else:
                    logger.info(
                        "SDR %s is not assigned to another session; hardware readiness "
                        "will be verified during observation startup %s",
                        sdr_id,
                        observation_id,
                    )

            # Persist the lifecycle transition before starting any tracker, SDR,
            # decoder, or recorder. A crash from this point forward is therefore
            # recoverable as an interrupted RUNNING observation on next startup.
            self._starting_observations.add(observation_id)
            running_persisted = await update_observation_status(
                self.sio, observation_id, STATUS_RUNNING
            )
            if running_persisted is False:
                raise RuntimeError("Failed to persist running observation status")

            # 5. Start tracker before any session tasks so doppler-dependent flows are ready
            combined_tasks: list[Dict[str, Any]] = []
            for session in sessions:
                combined_tasks.extend(session.get("tasks", []) if isinstance(session, dict) else [])

            rotator_config = observation.get("rotator", {}) or {}
            rig_config = observation.get("rig", {}) or {}
            satellite = observation.get("satellite", {})
            # Use the same task-end/LOS boundary as the scheduled stop job so a
            # slow rotator cannot keep startup waiting beyond the observation.
            stop_times = [
                datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
                for value in (
                    observation.get("pass", {}).get("event_end"),
                    observation.get("task_end"),
                )
                if value
            ]
            tracker_start_result = await self.tracker_handler.start_tracker_task(
                observation_id,
                satellite,
                rotator_config,
                combined_tasks,
                rig_config,
                handoff_deadline=min(stop_times) if stop_times else None,
            )
            if not tracker_start_result.get("success"):
                tracker_error = tracker_start_result.get("error", "tracker_start_failed")
                tracker_message = tracker_start_result.get(
                    "message",
                    f"Failed to start tracker for observation {observation_id}",
                )

                await log_execution_event(
                    observation_id,
                    f"Tracker start failed ({tracker_error}): {tracker_message}",
                    "error",
                )

                self._running_observations.discard(observation_id)
                self._starting_observations.discard(observation_id)
                self._tracker_context_by_observation.pop(observation_id, None)

                status = STATUS_CANCELLED if tracker_error == "rotator_in_use" else STATUS_FAILED
                await update_observation_status(
                    self.sio,
                    observation_id,
                    status,
                    f"{tracker_error}: {tracker_message}",
                )
                await remove_scheduled_stop_job(observation_id)
                return {
                    "success": False,
                    "error": tracker_message,
                    "code": tracker_error,
                }

            tracker_context = {
                "tracker_id": tracker_start_result.get("tracker_id"),
                "created": bool(tracker_start_result.get("created", False)),
                "reused_existing": bool(tracker_start_result.get("reused_existing", False)),
                "ephemeral": bool(tracker_start_result.get("ephemeral", False)),
            }
            self._tracker_context_by_observation[observation_id] = tracker_context

            # Derived SatDump products belong to the same bundle as live artifacts,
            # including passes whose IQ input is removed after decoding.
            if self._requires_observation_bundle(sessions):
                bundle_dir = create_observation_bundle(
                    observation_id, satellite, Path(__file__).parents[1]
                )
                self._bundle_dirs[observation_id] = bundle_dir
                write_bundle_manifest(
                    bundle_dir,
                    {
                        "observation_name": observation.get("name"),
                        "scheduled_observation": observation_snapshot(
                            {**observation, "status": STATUS_RUNNING}
                        ),
                    },
                )
                await self._publish_bundle_change("observation-bundle-created", observation_id)
            else:
                logger.info(
                    "Observation %s has no artifact-producing tasks; skipping bundle creation",
                    observation_id,
                )

            # 6. Execute observation sessions
            logger.info(f"Executing observation tasks for {observation['name']}")
            await log_execution_event(
                observation_id, f"Starting tasks for {observation['name']}", "info"
            )

            for session_index, session in enumerate(sessions, start=1):
                pending_failure = self._pending_sdr_failures.pop(observation_id, None)
                if pending_failure:
                    raise RuntimeError(pending_failure)
                session_key = self._get_session_key(session, session_index)
                await self._execute_observation_session(
                    observation_id, session_key, observation, session
                )
                started_sessions.append((session_key, session))
                pending_failure = self._pending_sdr_failures.pop(observation_id, None)
                if pending_failure:
                    raise RuntimeError(pending_failure)
                if session_index < len(sessions):
                    await asyncio.sleep(0.5)

            self._starting_observations.discard(observation_id)
            pending_failure = self._pending_sdr_failures.pop(observation_id, None)
            if pending_failure:
                await self._fail_running_observation(observation_id, pending_failure)
                return {"success": False, "error": pending_failure}
            await log_execution_event(observation_id, "All tasks started successfully", "info")

            logger.info(f"Observation {observation_id} started successfully")
            return {"success": True}

        except Exception as e:
            self._starting_observations.discard(observation_id)
            self._pending_sdr_failures.pop(observation_id, None)
            error_msg = f"Error starting observation {observation_id}: {e}"
            logger.error(error_msg)
            logger.error(traceback.format_exc())
            await log_execution_event(observation_id, error_msg, "error")

            if started_sessions:
                satellite = observation.get("satellite", {}) if "observation" in locals() else {}
                for session_key, session in started_sessions:
                    try:
                        await self._stop_observation_session(
                            observation_id, session_key, session, satellite
                        )
                    except Exception as cleanup_error:
                        logger.error(
                            f"Failed to clean up session {session_key} after start error: {cleanup_error}"
                        )

            if "observation" in locals():
                rotator_config = observation.get("rotator", {}) or {}
                active_tracker_context = self._tracker_context_by_observation.get(
                    observation_id, tracker_context
                )
                if active_tracker_context:
                    try:
                        tracker_stopped = await self.tracker_handler.stop_tracker_task(
                            observation_id,
                            rotator_config,
                            tracker_context=active_tracker_context,
                        )
                        if tracker_stopped:
                            self._tracker_context_by_observation.pop(observation_id, None)
                    except Exception as cleanup_error:
                        logger.error(
                            "Failed to clean up tracker for observation %s after start error: %s",
                            observation_id,
                            cleanup_error,
                        )

            # Clean up running observation tracking
            self._running_observations.discard(observation_id)
            failed_bundle_dir = self._bundle_dirs.pop(observation_id, None)
            if failed_bundle_dir:
                await self._finalize_bundle(observation_id, failed_bundle_dir, "failed")

            await update_observation_status(self.sio, observation_id, STATUS_FAILED, str(e))
            # Remove scheduled stop job on error
            await remove_scheduled_stop_job(observation_id)
            return {"success": False, "error": error_msg}

    async def stop_observation(self, observation_id: str) -> Dict[str, Any]:
        """
        Stop an observation at LOS time.

        This method:
        1. Stops SDR process (cascades to decoders/recorders)
        2. Disconnects observation hardware and closes its temporary target
        3. Cleans up internal VFO session
        4. Updates observation status to COMPLETED

        Args:
            observation_id: The observation ID to stop

        Returns:
            Dictionary with success status and error message if failed
        """
        stop_errors = []

        try:
            logger.info(f"Stopping observation: {observation_id}")
            await log_execution_event(observation_id, "Stop requested", "info")

            # 1. Load observation from database
            async with AsyncSessionLocal() as session:
                result = await fetch_scheduled_observations(session, observation_id)
                if not result["success"] or not result["data"]:
                    error_msg = f"Observation not found: {observation_id}"
                    logger.error(error_msg)
                    await log_execution_event(observation_id, error_msg, "error")
                    return {"success": False, "error": error_msg}

                observation = result["data"]

            current_status = str(observation.get("status") or "").lower()
            if current_status in {STATUS_CANCELLED, STATUS_COMPLETED, STATUS_FAILED}:
                # A delayed or duplicate LOS job must not turn a failed start
                # into a successful observation after there is nothing to stop.
                logger.info(
                    "Skipping stop for terminal observation %s (status=%s)",
                    observation_id,
                    current_status,
                )
                return {
                    "success": True,
                    "skipped": True,
                    "status": current_status,
                }

            # 2. Stop observation task - collect errors but continue
            try:
                await self._stop_observation_task(observation_id, observation)
                await log_execution_event(observation_id, "All tasks stopped", "info")
            except Exception as task_error:
                error_msg = f"Error stopping tasks: {task_error}"
                stop_errors.append(error_msg)
                logger.error(error_msg)
                logger.error(traceback.format_exc())
                await log_execution_event(observation_id, error_msg, "error")

            # 3. Determine final status based on errors
            if stop_errors:
                # Observation ran but cleanup had issues
                combined_errors = "; ".join(stop_errors)
                warning_msg = f"Completed with cleanup warnings: {combined_errors}"
                await update_observation_status(
                    self.sio, observation_id, STATUS_COMPLETED, warning_msg
                )
                await log_execution_event(observation_id, warning_msg, "warning")
                logger.warning(f"Observation {observation_id} completed but cleanup had issues")
            else:
                await update_observation_status(self.sio, observation_id, STATUS_COMPLETED)
                await log_execution_event(
                    observation_id, "Observation completed successfully", "info"
                )

            # 4. Remove from running observations tracking
            self._running_observations.discard(observation_id)
            bundle_dir = self._bundle_dirs.pop(observation_id, None)
            if bundle_dir:
                retained_bundle = await self._finalize_bundle(
                    observation_id,
                    bundle_dir,
                    "completed" if not stop_errors else "completed_with_warnings",
                )
                if not retained_bundle:
                    logger.info("Removed empty observation bundle at LOS: %s", bundle_dir.name)

            if not stop_errors:
                logger.info(
                    f"Observation {observation['name']} ({observation_id}) stopped successfully"
                )
            return {"success": len(stop_errors) == 0, "errors": stop_errors}

        except Exception as e:
            # Critical failure during stop
            error_msg = f"Critical error stopping observation {observation_id}: {e}"
            logger.error(error_msg)
            logger.error(traceback.format_exc())
            await log_execution_event(observation_id, error_msg, "error")

            # Clean up running observation tracking even on error
            self._running_observations.discard(observation_id)
            failed_bundle_dir = self._bundle_dirs.pop(observation_id, None)
            if failed_bundle_dir:
                await self._finalize_bundle(observation_id, failed_bundle_dir, "failed")

            # Mark observation as failed since stop encountered a critical error
            try:
                await update_observation_status(self.sio, observation_id, STATUS_FAILED, error_msg)
            except Exception as update_error:
                logger.error(f"Failed to update observation status to failed: {update_error}")

            return {"success": False, "error": error_msg}

    async def cancel_observation(self, observation_id: str) -> Dict[str, Any]:
        """
        Cancel a running or scheduled observation.

        This will:
        1. Stop the observation if it's currently running
        2. Remove all scheduled jobs (start/stop) from APScheduler
        3. Update status to CANCELLED

        Args:
            observation_id: The observation ID to cancel

        Returns:
            Dictionary with success status and error message if failed
        """
        try:
            logger.info(f"Cancelling observation: {observation_id}")

            # 1. Load observation from database
            async with AsyncSessionLocal() as session:
                result = await fetch_scheduled_observations(session, observation_id)
                if not result["success"] or not result["data"]:
                    error_msg = f"Observation not found: {observation_id}"
                    logger.error(error_msg)
                    return {"success": False, "error": error_msg}

                observation = result["data"]
                status = observation.get("status")

            # 2. Remove scheduled jobs from APScheduler
            if observation_events.observation_sync:
                await observation_events.observation_sync.remove_observation(observation_id)
                logger.info(f"Removed scheduled jobs for observation {observation_id}")

            # 3. If running, stop it
            if status == STATUS_RUNNING:
                await self._stop_observation_task(observation_id, observation)

            # 4. Update status to CANCELLED
            await update_observation_status(self.sio, observation_id, STATUS_CANCELLED)

            # 4b. Persist cancellation in the execution log
            await log_execution_event(observation_id, "Observation cancelled", "info")

            # 5. Remove from running observations tracking
            self._running_observations.discard(observation_id)
            bundle_dir = self._bundle_dirs.pop(observation_id, None)
            if bundle_dir:
                # Cancellation can stop an active observation before LOS. Do
                # not leave a bundle permanently marked as in progress.
                await self._finalize_bundle(observation_id, bundle_dir, "cancelled")

            logger.info(f"Observation {observation_id} cancelled successfully")
            return {"success": True}

        except Exception as e:
            error_msg = f"Error cancelling observation {observation_id}: {e}"
            logger.error(error_msg)
            logger.error(traceback.format_exc())
            return {"success": False, "error": error_msg}

    # ============================================================================
    # TASK EXECUTION
    # ============================================================================

    async def _execute_observation_session(
        self,
        observation_id: str,
        session_key: str,
        observation: Dict[str, Any],
        session: Dict[str, Any],
    ) -> None:
        """
        Execute a single SDR session for an observation at AOS time.

        This is where the real work happens:
        - Create internal VFO session via SessionService
        - Start SDR process with session sdr config
        - Configure VFOs per transmitter
        - Start decoders/recorders based on session tasks array

        Args:
            observation_id: The observation ID
            session_key: Unique key for this session (used in internal session ID)
            observation: The observation data dict
            session: The session data dict
        """

        # Extract configuration
        satellite = observation.get("satellite", {})
        tasks = session.get("tasks", [])
        bundle_dir = self._bundle_dirs.get(observation_id)

        logger.info(f"Starting observation for {satellite.get('name', 'unknown')}")
        logger.info(f"Observation ID: {observation_id}")
        logger.info(f"Tasks: {len(tasks)} configured")

        try:
            # 1. Extract SDR configuration and create session
            sdr_config_dict = session.get("sdr", {})
            if not sdr_config_dict:
                raise ValueError("No SDR configuration found in observation data")

            sdr_id = sdr_config_dict.get("id")
            if not sdr_id:
                raise ValueError("SDR ID missing from configuration")

            # Fetch SDR device details from database to get correct type
            async with AsyncSessionLocal() as db_session:
                sdr_result = await fetch_sdr(db_session, sdr_id)
                if not sdr_result or not sdr_result.get("success"):
                    raise ValueError(f"SDR with ID {sdr_id} not found in database")

                sdr_device = sdr_result["data"]

            # Build SDR config dict (operational parameters)
            sdr_config = SDRConfig(
                sdr_id=sdr_id,
                center_freq=sdr_config_dict.get("center_frequency", 100000000),
                sample_rate=sdr_config_dict.get("sample_rate", 2048000),
                gain=sdr_config_dict.get("gain", 20),
                ppm_error=sdr_config_dict.get("ppm_error", 0),
                antenna=sdr_config_dict.get("antenna_port", "RX"),
                bias_t=sdr_config_dict.get("bias_t", 0),
                tuner_agc=sdr_config_dict.get("tuner_agc", False),
                rtl_agc=sdr_config_dict.get("rtl_agc", False),
                soapy_agc=sdr_config_dict.get("soapy_agc", False),
                offset_freq=sdr_config_dict.get("offset_freq", 0),
                fft_size=sdr_config_dict.get("fft_size", 16384),
                fft_window=sdr_config_dict.get("fft_window", "hamming"),
                fft_averaging=sdr_config_dict.get("fft_averaging", 1),
                serial_number=(sdr_device.get("serial") or sdr_device.get("serial_number") or 0),
                # Preserve the same device-specific controls used for live reception.
                sdr_settings=sdr_config_dict.get("sdr_settings") or {},
            ).to_dict()

            # 2. Register internal observation session (creates session, starts SDR)
            metadata = {
                "observation_id": observation_id,
                "satellite_name": satellite.get("name"),
                "norad_id": satellite.get("norad_id"),
            }
            session_id = await session_service.register_internal_observation(
                observation_id=observation_id,
                sdr_device=sdr_device,
                sdr_config=sdr_config,
                vfo_number=1,  # Register with VFO 1 initially
                metadata=metadata,
                session_key=session_key,
            )

            if bundle_dir:
                add_bundle_session(bundle_dir, session_id, session_key)

            logger.info(f"Internal session created: {session_id}")

            # 3. Process tasks
            vfo_counter = 1  # Counter for assigning VFO numbers to VFO-based tasks

            for task_index, task in enumerate(tasks, start=1):
                task_type = task.get("type")
                task_config = task.get("config", {})
                vfo_number = None

                if task_type in {"decoder", "audio_recording", "transcription"}:
                    # Assign VFO number for this task (1-VFO_NUMBER)
                    if vfo_counter > INTERNAL_VFO_NUMBER:
                        await log_execution_event(
                            observation_id,
                            f"Skipped {task_type} task {task_index} in SDR session {session_key}: "
                            f"maximum of {INTERNAL_VFO_NUMBER} VFOs reached",
                            "warning",
                        )
                        continue
                    vfo_number = vfo_counter
                    vfo_counter += 1  # Increment for next VFO task
                    task_config["vfo_number"] = vfo_number

                # Task failures belong in the observation log; they must not prevent
                # independent tasks in this session from starting or fail the observation.
                task_error = None
                try:
                    if task_type == "decoder":
                        task_started = await self.decoder_handler.start_decoder_task(
                            observation_id,
                            session_id,
                            sdr_id,
                            sdr_config,
                            task_config,
                            task_config["vfo_number"],
                            bundle_dir,
                        )

                    elif task_type == "iq_recording":
                        recorder_id = f"{session_id}:iq:{task_index}"
                        recording_path = await self.recorder_handler.start_iq_recording_task(
                            observation_id,
                            session_id,
                            sdr_id,
                            satellite,
                            task_config,
                            recorder_id=recorder_id,
                            bundle_dir=bundle_dir,
                        )
                        task_started = bool(recording_path)
                        if recording_path:
                            self._iq_recording_info.setdefault(observation_id, {}).setdefault(
                                session_key, {}
                            )[task_index] = {
                                "recording_path": recording_path,
                                "task_config": task_config,
                            }

                    elif task_type == "audio_recording":
                        task_started = await self.recorder_handler.start_audio_recording_task(
                            observation_id,
                            session_id,
                            sdr_id,
                            sdr_config,
                            satellite,
                            task_config,
                            bundle_dir,
                        )

                    elif task_type == "transcription":
                        task_started = await self.transcription_handler.start_transcription_task(
                            observation_id,
                            session_id,
                            sdr_id,
                            sdr_config,
                            satellite,
                            task_config,
                            bundle_dir,
                        )
                    else:
                        continue
                except Exception as error:
                    task_started = False
                    task_error = str(error)
                    logger.exception(
                        "Error starting %s task %s for observation %s",
                        task_type,
                        task_index,
                        observation_id,
                    )

                if not task_started:
                    context = f", VFO {vfo_number}" if vfo_number is not None else ""
                    detail = f": {task_error}" if task_error else ""
                    await log_execution_event(
                        observation_id,
                        f"Failed to start {task_type} task {task_index} "
                        f"in SDR session {session_key}{context}{detail}",
                        "error",
                    )

            logger.info(f"Observation {observation_id} session {session_key} started")

        except Exception as e:
            logger.error(f"Failed to start observation {observation_id}: {e}")
            logger.error(traceback.format_exc())
            raise

    async def _stop_observation_task(
        self, observation_id: str, observation: Dict[str, Any]
    ) -> None:
        """
        Stop the observation task at LOS time.

        This is where cleanup happens:
        - Stop SDR process (cascades to all consumers)
        - Stop tracker
        - Cleanup internal VFO session via SessionService

        Args:
            observation_id: The observation ID
            observation: The observation data dict
        """
        satellite = observation.get("satellite", {})
        sessions = observation.get("sessions", []) or []

        logger.info(f"Stopping observation for {satellite.get('name', 'unknown')}")
        logger.info(f"Observation ID: {observation_id}")

        try:
            # 1. Release observation hardware and remove its temporary tracker.
            rotator_config = observation.get("rotator", {}) or {}
            tracker_context = self._tracker_context_by_observation.get(observation_id)
            tracker_stop_ok = await self.tracker_handler.stop_tracker_task(
                observation_id,
                rotator_config,
                tracker_context=tracker_context,
            )
            if tracker_stop_ok or not tracker_context:
                self._tracker_context_by_observation.pop(observation_id, None)
            else:
                logger.warning(
                    "Tracker cleanup for observation %s reported failure; keeping context for retry",
                    observation_id,
                )

            # 2. Stop decoders explicitly before cleaning up each session
            for session_index, session in enumerate(sessions, start=1):
                session_key = self._get_session_key(session, session_index)
                await self._stop_observation_session(
                    observation_id, session_key, session, satellite
                )

            logger.info(
                f"Observation task {observation_id} cleaned up (decoders stopped, sessions unregistered, VFOs cleaned)"
            )
            if not tracker_stop_ok:
                raise RuntimeError(
                    "OBS tracker cleanup could not be completed; context retained for retry"
                )

        except Exception as e:
            logger.error(f"Failed to stop observation {observation_id}: {e}")
            logger.error(traceback.format_exc())
            raise

    async def _stop_observation_session(
        self,
        observation_id: str,
        session_key: str,
        session: Dict[str, Any],
        satellite: Dict[str, Any],
    ) -> None:
        session_id = VFOManager.make_internal_session_id(observation_id, session_key)
        sdr_id = session.get("sdr", {}).get("id")
        if not sdr_id:
            sdr_id = session_tracker.get_session_sdr(session_id)

        if sdr_id:
            try:
                session_config = session_service.get_session_config(session_id)
                if session_config and session_config.get("bias_t"):
                    bias_off_config = {**session_config, "bias_t": False}
                    await self.process_manager.update_configuration(sdr_id, bias_off_config)
                    session_config["bias_t"] = False
                    logger.info(
                        "Disabled Bias-T before detaching SDR %s for observation %s (%s)",
                        sdr_id,
                        observation_id,
                        session_key,
                    )
            except Exception as e:
                logger.warning(
                    "Failed to disable Bias-T for SDR %s before cleanup of observation %s (%s): %s",
                    sdr_id,
                    observation_id,
                    session_key,
                    e,
                )

            tasks = session.get("tasks", [])
            has_decoder_task = any(task.get("type") == "decoder" for task in tasks)
            has_audio_task = any(task.get("type") == "audio_recording" for task in tasks)
            has_transcription_task = any(task.get("type") == "transcription" for task in tasks)
            has_iq_task = any(task.get("type") == "iq_recording" for task in tasks)

            vfo_manager = VFOManager()
            active_vfos = vfo_manager.get_active_vfos(session_id)
            vfo_numbers = [vfo.vfo_number for vfo in active_vfos]
            if not vfo_numbers:
                vfo_numbers = list(range(1, INTERNAL_VFO_NUMBER + 1))

            for vfo_number in vfo_numbers:
                if has_decoder_task:
                    self.decoder_handler.stop_decoder_task(sdr_id, session_id, vfo_number)
                if has_audio_task:
                    self.recorder_handler.stop_audio_recording_task(sdr_id, session_id, vfo_number)
                if has_transcription_task:
                    self.transcription_handler.stop_transcription_task(
                        sdr_id, session_id, vfo_number
                    )

            if has_iq_task:
                skip_auto_waterfall = any(
                    task.get("type") == "iq_recording"
                    and (task.get("config") or {}).get("enable_post_processing")
                    and (task.get("config") or {}).get("delete_after_post_processing")
                    for task in tasks
                )
                if skip_auto_waterfall:
                    logger.info(
                        "Skipping auto-waterfall generation because IQ recording will be deleted after SatDump"
                    )
                stopped_count = (
                    self.process_manager.recorder_manager.stop_all_recorders_for_session(
                        sdr_id, session_id, skip_auto_waterfall=skip_auto_waterfall
                    )
                )
                if stopped_count == 0:
                    self.recorder_handler.stop_iq_recording_task(
                        sdr_id, session_id, skip_auto_waterfall=skip_auto_waterfall
                    )

                await self._start_satdump_postprocessing(
                    observation_id, session_key, tasks, session.get("sdr", {}) or {}
                )

        await session_service.cleanup_internal_observation(observation_id, session_key=session_key)

        vfo_manager = VFOManager()
        vfo_manager.cleanup_internal_vfos(observation_id, session_key=session_key)

        logger.info(
            f"Observation {observation_id} session {session_key} cleaned up for {satellite.get('name', 'unknown')}"
        )

    async def _start_satdump_postprocessing(
        self,
        observation_id: str,
        session_key: str,
        tasks: list[dict],
        sdr_config: Dict[str, Any],
    ) -> None:
        task_info = self._iq_recording_info.get(observation_id, {}).get(session_key, {})

        if not task_info:
            if observation_id in self._iq_recording_info:
                self._iq_recording_info[observation_id].pop(session_key, None)
                if not self._iq_recording_info[observation_id]:
                    self._iq_recording_info.pop(observation_id, None)
            return

        background_task_manager = runtimestate.background_task_manager
        if not background_task_manager:
            logger.error("Background task manager not available for SatDump post-processing")
            return

        for task_index, task in enumerate(tasks, start=1):
            if task.get("type") != "iq_recording":
                continue

            task_config = task.get("config", {}) or {}
            if not task_config.get("enable_post_processing"):
                continue

            # Saved observations can predate validation at the command boundary.
            try:
                pipeline = validate_satdump_pipeline(task_config.get("post_process_pipeline"))
            except ValueError as exc:
                logger.warning(f"Skipping SatDump IQ task {task_index} in {observation_id}: {exc}")
                continue

            recording_entry = task_info.get(task_index)
            recording_path = recording_entry.get("recording_path") if recording_entry else None
            if not recording_path:
                logger.warning(
                    f"No recording path available for IQ task {task_index} in {observation_id}"
                )
                continue

            recording_file = f"{recording_path}.sigmf-data"
            metadata = self._load_sigmf_metadata(recording_path)
            samplerate = self._resolve_samplerate(metadata, sdr_config, task_config)
            baseband_format = self._resolve_baseband_format(metadata)
            try:
                bundle_dir = self._bundle_dirs.get(observation_id)
                output_dir = self._build_satdump_output_dir(recording_path, pipeline, bundle_dir)
            except ValueError as exc:
                logger.warning(f"Skipping SatDump IQ task {task_index} in {observation_id}: {exc}")
                continue
            recording_name = Path(recording_path).name
            # Saved observations without this setting should preserve failed IQ captures.
            retain_input_on_failure = task_config.get("retain_iq_on_satdump_failure") is not False

            try:
                task_id = await background_task_manager.start_task(
                    func=get_task("satdump_process"),
                    args=(recording_file, output_dir, pipeline),
                    kwargs={
                        "samplerate": samplerate,
                        "baseband_format": baseband_format,
                        "finish_processing": True,
                        "delete_input_after": task_config.get(
                            "delete_after_post_processing", False
                        ),
                        "retain_input_on_failure": retain_input_on_failure,
                        **({"observation_bundle": str(bundle_dir)} if bundle_dir else {}),
                    },
                    name=f"SatDump: {recording_name} ({pipeline})",
                )
                logger.info(f"Started SatDump post-processing task {task_id} for {recording_file}")
            except Exception as e:
                logger.error(f"Failed to start SatDump post-processing for {recording_file}: {e}")

        if observation_id in self._iq_recording_info:
            self._iq_recording_info[observation_id].pop(session_key, None)
            if not self._iq_recording_info[observation_id]:
                self._iq_recording_info.pop(observation_id, None)

    def _load_sigmf_metadata(self, recording_path: str) -> Dict[str, Any]:
        meta_path = Path(f"{recording_path}.sigmf-meta")
        if not meta_path.exists():
            return {}
        try:
            with meta_path.open("r") as handle:
                return cast(Dict[str, Any], json.load(handle))
        except Exception as e:
            logger.warning(f"Failed to load SigMF metadata from {meta_path}: {e}")
            return {}

    def _resolve_samplerate(
        self, metadata: Dict[str, Any], sdr_config: Dict[str, Any], task_config: Dict[str, Any]
    ) -> int:
        sample_rate = metadata.get("global", {}).get("core:sample_rate")
        if sample_rate:
            return int(sample_rate)

        sdr_rate = sdr_config.get("sample_rate")
        decimation_factor = int(task_config.get("decimation_factor") or 1)
        if sdr_rate:
            try:
                return int(float(sdr_rate) / max(decimation_factor, 1))
            except Exception:
                return int(float(sdr_rate))
        return 0

    def _resolve_baseband_format(self, metadata: Dict[str, Any]) -> str:
        datatype = metadata.get("global", {}).get("core:datatype", "")
        datatype = datatype.lower() if datatype else ""
        if "cf32" in datatype or "c32" in datatype:
            return "f32"
        if "ci16" in datatype or "c16" in datatype:
            return "i16"
        if "ci8" in datatype or "c8" in datatype or "cu8" in datatype:
            return "i8"
        return "f32"

    def _build_satdump_output_dir(
        self, recording_path: str, pipeline: str, bundle_dir: Optional[Path] = None
    ) -> str:
        pipeline = validate_satdump_pipeline(pipeline)
        recording_base = Path(recording_path).name
        backend_dir = Path(__file__).resolve().parents[1]
        decoded_dir = bundle_dir / "decoded" if bundle_dir else backend_dir / "data" / "decoded"
        output_dir = decoded_dir / f"{recording_base}.satdump_{pipeline}"
        return str(resolve_satdump_output_dir(output_dir, backend_dir, bundle_dir))
