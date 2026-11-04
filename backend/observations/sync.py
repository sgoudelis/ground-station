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

"""Observation scheduler synchronization - keeps APScheduler in sync with database."""

import traceback
from datetime import datetime, timezone
from typing import Any, Dict, List

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.date import DateTrigger
from sqlalchemy import update

from common.logger import logger
from crud.scheduledobservations import fetch_scheduled_observations
from db import AsyncSessionLocal
from db.models import ScheduledObservations
from observations.constants import STATUS_MISSED, STATUS_RUNNING, STATUS_SCHEDULED
from observations.executor import ObservationExecutor
from observations.helpers import log_execution_event, update_observation_status


class ObservationSchedulerSync:
    """
    Synchronizes scheduled observations between database and APScheduler.

    This service ensures that APScheduler jobs are created/updated/removed
    whenever observations are created/updated/deleted in the database.
    """

    def __init__(self, scheduler: AsyncIOScheduler, executor: ObservationExecutor):
        """
        Initialize the scheduler sync service.

        Args:
            scheduler: APScheduler instance
            executor: ObservationExecutor instance for task execution
        """
        self.scheduler = scheduler
        self.executor = executor
        self._job_prefix = "obs"  # Prefix for all observation jobs
        self.sio = executor.sio  # Socket.IO instance for event emission

    def _is_scheduler_running(self) -> bool:
        """
        Check if APScheduler is running and healthy.

        Returns:
            True if scheduler is running, False otherwise
        """
        try:
            return bool(self.scheduler.running)
        except Exception as e:
            logger.error(f"Error checking scheduler status: {e}")
            return False

    def _make_job_id(self, observation_id: str, event_type: str) -> str:
        """
        Generate a unique job ID for an observation event.

        Args:
            observation_id: The observation ID
            event_type: Either "start" (AOS) or "stop" (LOS)

        Returns:
            Unique job ID string
        """
        return f"{self._job_prefix}_{observation_id}_{event_type}"

    async def sync_observation(self, observation_id: str) -> Dict[str, Any]:
        """
        Synchronize a single observation with APScheduler.

        This method:
        1. Fetches observation from database
        2. Ensures running observations retain a stop job, even when disabled
        3. Rebuilds start/stop jobs for enabled, scheduled observations
        4. Removes jobs for disabled or terminal observations

        Args:
            observation_id: The observation ID to sync

        Returns:
            Dictionary with success status and error message if failed
        """
        try:
            logger.debug(f"Syncing observation {observation_id} to APScheduler")

            # Check scheduler health first
            if not self._is_scheduler_running():
                error_msg = "APScheduler is not running - cannot schedule observation"
                logger.error(error_msg)
                await log_execution_event(observation_id, error_msg, "error")
                return {"success": False, "error": error_msg}

            # 1. Fetch observation from database
            async with AsyncSessionLocal() as session:
                result = await fetch_scheduled_observations(session, observation_id)
                if not result["success"]:
                    # A failed read does not mean the observation was deleted.
                    return {"success": False, "error": result.get("error")}
                if not result["data"]:
                    logger.warning(f"Observation not found: {observation_id}")
                    # Remove jobs if they exist (observation was deleted)
                    await self._remove_observation_jobs(observation_id)
                    return {"success": True, "action": "removed"}

                observation = result["data"]

            # 2. Running observations still need cleanup, regardless of enabled state.
            enabled = observation.get("enabled", True)
            status = observation.get("status", STATUS_SCHEDULED)
            status_lower = status.lower() if isinstance(status, str) else ""
            if status_lower == STATUS_RUNNING:
                await self._remove_observation_jobs(observation_id, event_types=("start",))
                stop_time = self._get_stop_time(observation)
                now = datetime.now(timezone.utc)
                # Recover observations whose stop job was lost and is already overdue.
                await self._schedule_stop_job(observation_id, observation, max(stop_time, now))
                return {"success": True, "action": "scheduled_stop"}

            # 3. Rebuild jobs only for enabled, scheduled observations.
            await self._remove_observation_jobs(observation_id)
            pass_info = observation.get("pass", {})
            event_start = pass_info.get("event_start")
            event_end = pass_info.get("event_end")

            # Only schedule if enabled, scheduled status, and has valid times
            if not enabled:
                logger.debug(f"Observation {observation_id} is disabled, not scheduling")
                return {"success": True, "action": "skipped_disabled"}

            if status_lower != STATUS_SCHEDULED:
                logger.warning(
                    f"Observation {observation_id} ({observation.get('name')}) has status '{status}', not scheduling (expected '{STATUS_SCHEDULED}')"
                )
                return {"success": True, "action": "skipped_status"}

            if not event_start or not event_end:
                logger.warning(f"Observation {observation_id} missing event times")
                return {"success": False, "error": "Missing event times"}

            # 3.5. Clear execution log to prevent accumulation on restart
            # Only do this for observations that will actually be scheduled
            # This preserves execution history for completed/failed/cancelled observations
            await self._clear_execution_log(observation_id)

            # 4. Parse event times
            aos_time = datetime.fromisoformat(event_start.replace("Z", "+00:00"))
            los_time = datetime.fromisoformat(event_end.replace("Z", "+00:00"))
            now = datetime.now(timezone.utc)

            # Skip if event has already passed
            if los_time < now:
                logger.debug(f"Observation {observation_id} is in the past, not scheduling")
                return {"success": True, "action": "skipped_past"}

            # 4.5. Get task start time (pre-calculated and stored in observation)
            task_start_str = observation.get("task_start")
            task_start_time = (
                datetime.fromisoformat(task_start_str.replace("Z", "+00:00"))
                if task_start_str
                else aos_time
            )

            # 5. Schedule observation start job
            # If task_start differs from AOS, schedule start at task_start time
            # Otherwise, schedule at AOS time
            # TODO: Split this into separate AOS (SDR/tracking only) and task_start (decoders/recorders) jobs
            start_time = (
                task_start_time if (task_start_time and task_start_time > aos_time) else aos_time
            )

            if start_time > now:
                start_job_id = self._make_job_id(observation_id, "start")
                try:
                    self.scheduler.add_job(
                        self.executor.start_observation,
                        trigger=DateTrigger(run_date=start_time),
                        args=[observation_id],
                        id=start_job_id,
                        name=f"Start observation: {observation.get('name', observation_id)}",
                        replace_existing=True,
                        misfire_grace_time=300,  # 5 minute grace period
                    )

                    # Verify job was actually added
                    job = self.scheduler.get_job(start_job_id)
                    if not job:
                        raise RuntimeError(
                            f"Start job {start_job_id} was not created in APScheduler"
                        )

                    logger.info(
                        f"Scheduled start job for {observation.get('name')} at {start_time.isoformat()}"
                    )
                    await log_execution_event(
                        observation_id,
                        f"Start job scheduled for {start_time.isoformat()}",
                        "info",
                    )
                except Exception as e:
                    error_msg = f"Failed to add start job to APScheduler: {e}"
                    logger.error(error_msg)
                    await log_execution_event(observation_id, error_msg, "error")
                    raise  # Re-raise to be caught by outer exception handler
            else:
                logger.debug(
                    f"Start time for observation {observation_id} has passed, not scheduling start job"
                )

            # 6. Schedule observation stop job
            # TODO: Split this into separate task_end (decoders/recorders) and LOS (SDR/tracking) jobs
            stop_time = self._get_stop_time(observation)
            if stop_time > now:
                await self._schedule_stop_job(observation_id, observation, stop_time)

            return {"success": True, "action": "scheduled"}

        except Exception as e:
            error_msg = f"Error syncing observation {observation_id}: {e}"
            logger.error(error_msg)
            logger.error(traceback.format_exc())
            return {"success": False, "error": error_msg}

    async def sync_all_observations(self) -> Dict[str, Any]:
        """
        Synchronize all observations from database to APScheduler.

        This is typically called:
        - On startup to rebuild scheduler state
        - After bulk operations (auto-generation, regeneration)

        Returns:
            Dictionary with success status, statistics, and errors
        """
        try:
            logger.info("Starting full observation synchronization to APScheduler")

            # Snapshot before reading so jobs created during synchronization are not pruned.
            existing_job_ids = [job.id for job in self.scheduler.get_jobs()]

            # 1. Read successfully before changing any existing jobs.
            async with AsyncSessionLocal() as session:
                result = await fetch_scheduled_observations(session)
                if not result["success"]:
                    error_msg = f"Failed to fetch observations: {result.get('error')}"
                    logger.error(error_msg)
                    return {"success": False, "error": error_msg}

                observations = result.get("data", [])

            logger.info(f"Found {len(observations)} observations in database")

            # 2. Check for missed observations and mark them
            now = datetime.now(timezone.utc)
            missed_count = 0
            for observation in observations:
                obs_id = observation.get("id")
                status = observation.get("status", "").lower()

                # Only check scheduled observations
                if status == STATUS_SCHEDULED:
                    # Get task_end time
                    task_end_str = observation.get("task_end")
                    if task_end_str:
                        task_end_time = datetime.fromisoformat(task_end_str.replace("Z", "+00:00"))

                        # If task_end is in the past, mark as missed
                        if task_end_time < now:
                            logger.info(
                                f"Marking observation {obs_id} ({observation.get('name')}) as missed "
                                f"(task_end {task_end_time.isoformat()} is in the past)"
                            )
                            await update_observation_status(self.sio, obs_id, STATUS_MISSED)
                            missed_count += 1

            # 3. Sync each observation
            stats = {
                "total": len(observations),
                "scheduled": 0,
                "scheduled_stop": 0,
                "skipped_disabled": 0,
                "skipped_status": 0,
                "skipped_past": 0,
                "missed": missed_count,
                "errors": 0,
            }
            errors = []

            for observation in observations:
                obs_id = observation.get("id")
                if not obs_id:
                    continue

                result = await self.sync_observation(obs_id)
                if result["success"]:
                    action = result.get("action", "unknown")
                    if action in stats:
                        stats[action] += 1
                else:
                    stats["errors"] += 1
                    errors.append({"id": obs_id, "error": result.get("error")})

            # Only prune jobs belonging to deleted observations; active stop jobs
            # must remain scheduled throughout regeneration.
            valid_job_ids = {
                self._make_job_id(observation["id"], event_type)
                for observation in observations
                if observation.get("id")
                for event_type in ("start", "stop")
            }
            removed_count = 0
            for job_id in existing_job_ids:
                if job_id.startswith(f"{self._job_prefix}_") and job_id not in valid_job_ids:
                    try:
                        self.scheduler.remove_job(job_id)
                        removed_count += 1
                    except Exception as e:
                        logger.warning(f"Failed to remove orphaned job {job_id}: {e}")
            logger.info(f"Removed {removed_count} orphaned observation jobs")

            logger.info(
                f"Full synchronization complete: {stats['scheduled']} scheduled, "
                f"{stats['scheduled_stop']} running stops scheduled, "
                f"{stats['skipped_disabled']} disabled, {stats['skipped_status']} wrong status, "
                f"{stats['skipped_past']} past, {stats.get('missed', 0)} marked as missed, "
                f"{stats['errors']} errors"
            )

            return {"success": True, "stats": stats, "errors": errors}

        except Exception as e:
            error_msg = f"Error during full observation synchronization: {e}"
            logger.error(error_msg)
            logger.error(traceback.format_exc())
            return {"success": False, "error": error_msg}

    async def remove_observation(self, observation_id: str) -> Dict[str, Any]:
        """
        Remove an observation from APScheduler.

        Args:
            observation_id: The observation ID to remove

        Returns:
            Dictionary with success status
        """
        try:
            await self._remove_observation_jobs(observation_id)
            logger.info(f"Removed observation jobs for {observation_id}")
            return {"success": True}
        except Exception as e:
            error_msg = f"Error removing observation {observation_id}: {e}"
            logger.error(error_msg)
            return {"success": False, "error": error_msg}

    # ============================================================================
    # HELPER METHODS
    # ============================================================================

    def _get_stop_time(self, observation: Dict[str, Any]) -> datetime:
        """Stop at task end or LOS, whichever comes first."""
        event_end = observation.get("pass", {}).get("event_end")
        if not event_end:
            raise ValueError("Missing event end time")
        los_time = datetime.fromisoformat(event_end.replace("Z", "+00:00"))
        task_end = observation.get("task_end")
        if task_end:
            return min(datetime.fromisoformat(task_end.replace("Z", "+00:00")), los_time)
        return los_time

    async def _schedule_stop_job(
        self, observation_id: str, observation: Dict[str, Any], stop_time: datetime
    ) -> None:
        """Retain correct stop jobs and replace outdated ones without a scheduling gap."""
        stop_job_id = self._make_job_id(observation_id, "stop")
        try:
            existing_job = self.scheduler.get_job(stop_job_id)
            if existing_job and existing_job.next_run_time == stop_time:
                # Repeated regeneration must not accumulate duplicate scheduling logs.
                return
            self.scheduler.add_job(
                self.executor.stop_observation,
                trigger=DateTrigger(run_date=stop_time),
                args=[observation_id],
                id=stop_job_id,
                name=f"Stop observation: {observation.get('name', observation_id)}",
                replace_existing=True,
                misfire_grace_time=300,  # 5 minute grace period
            )
            if not self.scheduler.get_job(stop_job_id):
                raise RuntimeError(f"Stop job {stop_job_id} was not created in APScheduler")

            logger.info(
                f"Scheduled stop job for {observation.get('name')} at {stop_time.isoformat()}"
            )
            await log_execution_event(
                observation_id, f"Stop job scheduled for {stop_time.isoformat()}", "info"
            )
        except Exception as e:
            error_msg = f"Failed to add stop job to APScheduler: {e}"
            logger.error(error_msg)
            await log_execution_event(observation_id, error_msg, "error")
            raise

    async def _clear_execution_log(self, observation_id: str) -> None:
        """
        Clear the execution log for an observation.
        Called when rescheduling to prevent accumulation of old scheduling events.

        Args:
            observation_id: The observation ID
        """
        try:
            async with AsyncSessionLocal() as session:
                stmt = (
                    update(ScheduledObservations)
                    .where(ScheduledObservations.id == observation_id)
                    .values(execution_log=[])
                )
                await session.execute(stmt)
                await session.commit()
                logger.debug(f"Cleared execution log for observation {observation_id}")
        except Exception as e:
            logger.warning(f"Failed to clear execution log for {observation_id}: {e}")
            # Non-critical error, continue with scheduling

    async def _remove_observation_jobs(
        self, observation_id: str, event_types: tuple[str, ...] = ("start", "stop")
    ) -> int:
        """
        Remove all APScheduler jobs for a specific observation.

        Args:
            observation_id: The observation ID
            event_types: Job types to remove; running observations only remove stale starts

        Returns:
            Number of jobs removed
        """
        count = 0
        for event_type in event_types:
            job_id = self._make_job_id(observation_id, event_type)
            try:
                self.scheduler.remove_job(job_id)
                count += 1
                logger.debug(f"Removed job {job_id}")
            except Exception:
                # Job doesn't exist, that's fine
                pass
        return count

    def get_scheduled_observation_jobs(self) -> List[Dict[str, Any]]:
        """
        Get all currently scheduled observation jobs.

        Returns:
            List of job info dictionaries
        """
        jobs = []
        for job in self.scheduler.get_jobs():
            if job.id.startswith(f"{self._job_prefix}_"):
                # Extract observation ID and event type from job ID
                parts = job.id.split("_", 2)
                if len(parts) >= 3:
                    obs_id = parts[1]
                    event_type = parts[2]
                else:
                    obs_id = job.id
                    event_type = "unknown"

                jobs.append(
                    {
                        "job_id": job.id,
                        "observation_id": obs_id,
                        "event_type": event_type,
                        "name": job.name,
                        "next_run_time": (
                            job.next_run_time.isoformat() if job.next_run_time else None
                        ),
                    }
                )
        return jobs
