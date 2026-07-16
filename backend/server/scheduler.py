"""Background task scheduler for the ground station."""

import asyncio
import logging
from typing import Any, Dict, Optional

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger

import crud.monitoredcelestial as crud_monitored
import crud.preferences as crud_preferences
import observations.events as obs_events
from celestial.scene import (
    SCHEDULED_SYNC_FUTURE_HOURS,
    SCHEDULED_SYNC_PAST_HOURS,
    SCHEDULED_SYNC_STEP_MINUTES,
    build_celestial_tracks,
    refresh_celestial_vector_snapshots_cache,
)
from common import auth as authsvc
from common.arguments import arguments
from common.logger import logger
from db import AsyncSessionLocal
from observations.constants import DEFAULT_AUTO_GENERATE_INTERVAL_HOURS
from observations.generator import generate_observations_for_monitored_satellites
from server.schedulerstate import ORBITAL_SYNC_JOB_ID, set_scheduler_reference
from tasks.registry import get_task
from tracker.runner import get_tracker_supervisor

# Suppress apscheduler internal INFO logs (only show warnings and errors)
logging.getLogger("apscheduler").setLevel(logging.WARNING)

# Global scheduler instance
scheduler: Optional[AsyncIOScheduler] = None
CELESTIAL_TRACKS_BROADCAST_JOB_ID = "emit_cached_celestial_tracks"
CELESTIAL_TRACKS_BROADCAST_INTERVAL_SECONDS = 5
CELESTIAL_MAP_SETTINGS_NAME = "celestial-map-settings"
MAX_CELESTIAL_PROJECTION_HOURS = 4320
_celestial_sync_warmup_task: Optional[asyncio.Task] = None
_ORBITAL_SYNC_TASK_PATTERNS = (
    "orbital data sync",
    "orbital_sync",
    "orbital-sync",
    "tle sync",
    "tle_sync",
)


def _is_orbital_sync_task(task: Dict[str, Any]) -> bool:
    """Identify orbital synchronization tasks from background task metadata."""
    task_name = str(task.get("name") or "").strip().lower()
    task_command = str(task.get("command") or "").strip().lower()
    return any(
        pattern in task_name or pattern in task_command for pattern in _ORBITAL_SYNC_TASK_PATTERNS
    )


def _coerce_int_setting(value: Any, fallback: int, minimum: int, maximum: int) -> int:
    try:
        parsed = int(float(value))
    except (TypeError, ValueError):
        return int(fallback)
    return max(int(minimum), min(parsed, int(maximum)))


def _projection_payload_from_map_settings(settings: Dict[str, Any]) -> Dict[str, int]:
    """Return the global celestial projection window saved by the UI."""
    return {
        "past_hours": _coerce_int_setting(
            settings.get("pastHours", settings.get("past_hours")),
            SCHEDULED_SYNC_PAST_HOURS,
            0,
            MAX_CELESTIAL_PROJECTION_HOURS,
        ),
        "future_hours": _coerce_int_setting(
            settings.get("futureHours", settings.get("future_hours")),
            SCHEDULED_SYNC_FUTURE_HOURS,
            1,
            MAX_CELESTIAL_PROJECTION_HOURS,
        ),
        "step_minutes": _coerce_int_setting(
            settings.get("stepMinutes", settings.get("step_minutes")),
            SCHEDULED_SYNC_STEP_MINUTES,
            1,
            24 * 60,
        ),
    }


async def _build_enabled_monitored_celestial_payload() -> Dict[str, Any]:
    """Build a scene payload from enabled monitored celestial rows."""
    async with AsyncSessionLocal() as dbsession:
        monitored_result = await crud_monitored.fetch_monitored_celestial(
            dbsession,
            enabled_only=True,
        )
        map_settings_result = await crud_preferences.get_map_settings(
            dbsession,
            name=CELESTIAL_MAP_SETTINGS_NAME,
        )

    if not monitored_result.get("success"):
        raise RuntimeError(
            monitored_result.get("error") or "Failed loading monitored celestial targets"
        )

    entries_obj = monitored_result.get("data")
    entries = entries_obj if isinstance(entries_obj, list) else []
    settings_row = map_settings_result.get("data") if map_settings_result.get("success") else {}
    settings_value = settings_row.get("value") if isinstance(settings_row, dict) else {}
    projection_payload = _projection_payload_from_map_settings(
        settings_value if isinstance(settings_value, dict) else {}
    )
    payload: Dict[str, Any] = {
        **projection_payload,
        "celestial": [],
    }

    for item in entries:
        target_type = str(item.get("target_type") or "mission").strip().lower()
        if target_type == "body":
            body_id = str(item.get("body_id") or "").strip().lower()
            if not body_id:
                continue
            payload["celestial"].append(
                {
                    "target_type": "body",
                    "body_id": body_id,
                    "name": item.get("display_name") or body_id,
                    "color": item.get("color"),
                }
            )
            continue

        command = str(item.get("command") or "").strip()
        if not command:
            continue
        payload["celestial"].append(
            {
                "target_type": "mission",
                "command": command,
                "name": item.get("display_name") or command,
                "color": item.get("color"),
            }
        )

    return payload


async def emit_cached_celestial_tracks_job(sio):
    """Broadcast current monitored celestial tracks using cached vectors only."""
    try:
        if await authsvc.is_setup_required(force_refresh=False):
            return

        payload = await _build_enabled_monitored_celestial_payload()
        if not payload["celestial"]:
            return

        tracks = await build_celestial_tracks(
            data=payload,
            logger=logger,
            force_refresh=False,
            allow_network_fetch=False,
            register_targets=False,
            use_computed_cache=False,
        )
        if not tracks.get("success"):
            logger.debug("Cached celestial tracks broadcast skipped: %s", tracks.get("error"))
            return

        scene_data_obj = tracks.get("data")
        scene_data = scene_data_obj if isinstance(scene_data_obj, dict) else {}
        rows_obj = scene_data.get("celestial")
        rows = rows_obj if isinstance(rows_obj, list) else []
        if not rows:
            return

        # Avoid replacing a valid browser state with startup cache misses.
        if not any(isinstance(row.get("sky_position"), dict) for row in rows):
            logger.debug("Cached celestial tracks broadcast skipped: no cached sky positions")
            return

        await sio.emit("celestial-tracks-update", scene_data)
    except Exception as e:
        logger.error(f"Error broadcasting cached celestial tracks: {e}")
        logger.exception(e)


def _normalize_target_type(tracking_state: Dict[str, Any]) -> str:
    target_type = str(tracking_state.get("target_type") or "").strip().lower()
    if target_type in {"satellite", "mission", "body"}:
        return target_type
    if str(tracking_state.get("command") or "").strip():
        return "mission"
    if str(tracking_state.get("body_id") or "").strip():
        return "body"
    return "satellite"


async def _resync_active_non_satellite_trackers() -> Dict[str, int]:
    """Push refreshed celestial vectors into active mission/body tracker workers."""
    supervisor = get_tracker_supervisor()
    active_tracker_ids = [
        tracker_id
        for tracker_id in supervisor.get_all_tracker_ids()
        if supervisor.is_alive(tracker_id)
    ]
    if not active_tracker_ids:
        return {"active": 0, "resynced": 0, "failed": 0}

    managers = supervisor.get_managers()
    resynced = 0
    failed = 0

    for tracker_id in active_tracker_ids:
        manager = managers.get(tracker_id)
        if manager is None:
            continue

        tracking_state = manager.current_tracking_state or await manager.get_tracking_state() or {}
        if _normalize_target_type(tracking_state) not in {"mission", "body"}:
            continue

        try:
            await manager.sync_tracking_state_from_db()
            resynced += 1
        except Exception:
            failed += 1
            logger.exception(
                "Failed to resync tracker context after celestial vector refresh (tracker_id=%s)",
                tracker_id,
            )

    return {"active": len(active_tracker_ids), "resynced": resynced, "failed": failed}


async def sync_satellite_data_job(background_task_manager):
    """
    Job wrapper for orbital synchronization that uses the background task manager.

    This runs orbital sync as a background task, making it:
    - Visible in the task manager UI
    - Cancellable by users
    - Consistent with manual sync triggers
    """
    try:
        logger.info("Running scheduled satellite data synchronization as background task...")

        # Get the orbital sync task function
        orbital_sync_task = get_task("orbital_sync")

        # Start as background task
        task_id = await background_task_manager.start_task(
            func=orbital_sync_task,
            args=(),
            kwargs={},
            name="Scheduled Orbital Data Sync",
            task_id=None,
        )

        logger.info(f"Scheduled orbital sync started as background task: {task_id}")

    except ValueError as e:
        # Singleton task already running (likely a manual sync is in progress)
        logger.info(f"Skipping scheduled orbital sync: {e}")

    except Exception as e:
        logger.error(f"Error starting scheduled satellite synchronization: {e}")
        logger.exception(e)


def check_and_restart_decoders_job(process_manager):
    """Job to check decoder health and restart if needed."""
    try:
        restarted = process_manager.decoder_manager.check_and_restart_decoders()
        if restarted > 0:
            logger.info(f"Decoder health check: {restarted} decoder(s) restarted")
    except Exception as e:
        logger.error(f"Error during decoder health check: {e}")
        logger.exception(e)


async def generate_observations_job():
    """Job to automatically generate scheduled observations from monitored satellites."""
    try:
        logger.info("Running automatic observation generation...")
        async with AsyncSessionLocal() as session:
            result = await generate_observations_for_monitored_satellites(session)

            if result["success"]:
                stats = result.get("data", {})
                logger.info(
                    f"Automatic observation generation completed: "
                    f"{stats.get('generated', 0)} created, "
                    f"{stats.get('updated', 0)} updated, "
                    f"{stats.get('skipped', 0)} skipped, "
                    f"{stats.get('satellites_processed', 0)} satellites processed"
                )

                # Emit event to all clients if observations were changed
                if stats.get("generated", 0) > 0 or stats.get("updated", 0) > 0:
                    await obs_events.emit_scheduled_observations_changed()

                    # Sync all observations to APScheduler
                    if obs_events.observation_sync:
                        sync_result = await obs_events.observation_sync.sync_all_observations()
                        if sync_result["success"]:
                            sync_stats = sync_result.get("stats", {})
                            logger.info(
                                f"APScheduler sync complete: {sync_stats.get('scheduled', 0)} scheduled"
                            )
            else:
                logger.error(f"Automatic observation generation failed: {result.get('error')}")

    except Exception as e:
        logger.error(f"Error during automatic observation generation: {e}")
        logger.exception(e)


async def run_initial_observation_generation():
    """Run observation generation once on startup."""
    try:
        logger.info("Running initial observation generation on startup...")
        async with AsyncSessionLocal() as session:
            result = await generate_observations_for_monitored_satellites(session)

            if result["success"]:
                stats = result.get("data", {})
                logger.info(
                    f"Initial observation generation completed: "
                    f"{stats.get('generated', 0)} created, "
                    f"{stats.get('updated', 0)} updated, "
                    f"{stats.get('skipped', 0)} skipped, "
                    f"{stats.get('satellites_processed', 0)} satellites processed"
                )

                # Emit event to all clients if observations were changed
                if stats.get("generated", 0) > 0 or stats.get("updated", 0) > 0:
                    await obs_events.emit_scheduled_observations_changed()

                # Note: Sync to APScheduler is handled by startup.py after this completes
            else:
                logger.error(f"Initial observation generation failed: {result.get('error')}")

    except Exception as e:
        logger.error(f"Error during initial observation generation: {e}")
        logger.exception(e)


async def sync_celestial_vector_snapshots_job(background_task_manager, sio=None):
    """Periodic cache-fill job that prefetches celestial vector snapshots from Horizons."""
    try:
        # During first-time setup we avoid scheduled celestial writes so setup auth/bootstrap
        # writes do not contend with cache refresh transactions on SQLite.
        if await authsvc.is_setup_required(force_refresh=True):
            logger.info(
                "Skipping scheduled celestial vector snapshot sync: setup is still required."
            )
            return

        # Orbital sync is a long-running writer. Skip this scheduled cache fill while
        # orbital sync is active to avoid concurrent writer lock contention.
        if background_task_manager:
            running_tasks = background_task_manager.get_running_tasks()
            if any(_is_orbital_sync_task(task) for task in running_tasks):
                logger.info(
                    "Skipping scheduled celestial vector snapshot sync: orbital sync is running."
                )
                return

        result = await refresh_celestial_vector_snapshots_cache(logger=logger)
        if result.get("success"):
            logger.info(
                "Scheduled celestial vector snapshot sync completed: refreshed=%s failed=%s count=%s",
                result.get("refreshed", 0),
                result.get("failed", 0),
                result.get("count", 0),
            )
            tracker_resync = await _resync_active_non_satellite_trackers()
            logger.info(
                "Tracker context resync after celestial sync: active=%s resynced=%s failed=%s",
                tracker_resync.get("active", 0),
                tracker_resync.get("resynced", 0),
                tracker_resync.get("failed", 0),
            )
            if sio is not None:
                await emit_cached_celestial_tracks_job(sio)
            return
        if result.get("skipped"):
            logger.info("Scheduled celestial vector snapshot sync skipped: %s", result.get("error"))
            return
        logger.warning(
            "Scheduled celestial vector snapshot sync completed with errors: %s",
            result.get("error"),
        )
    except Exception as e:
        logger.error(f"Error during scheduled celestial vector snapshot sync: {e}")
        logger.exception(e)


async def run_celestial_sync_warmup_job(
    background_task_manager,
    sio,
    delay_seconds: float = 3.0,
    max_wait_seconds: float = 15 * 60,
):
    """
    Run one immediate celestial sync pass after startup/setup and emit tracks on completion.

    This keeps the page passive while still pushing data as soon as backend cache-fill work is done.
    """
    try:
        if delay_seconds > 0:
            await asyncio.sleep(delay_seconds)

        waited_seconds = 0.0
        poll_interval_seconds = 5.0
        while background_task_manager:
            running_tasks = background_task_manager.get_running_tasks()
            if not any(_is_orbital_sync_task(task) for task in running_tasks):
                break
            if waited_seconds >= max_wait_seconds:
                logger.warning(
                    "Skipping celestial sync warmup after waiting %.1fs for orbital sync to finish.",
                    waited_seconds,
                )
                return
            await asyncio.sleep(poll_interval_seconds)
            waited_seconds += poll_interval_seconds

        await sync_celestial_vector_snapshots_job(background_task_manager, sio=sio)
    except Exception:
        logger.exception("Celestial sync warmup job failed")


def schedule_celestial_sync_warmup_job(
    background_task_manager,
    sio,
    delay_seconds: float = 3.0,
    max_wait_seconds: float = 15 * 60,
) -> asyncio.Task:
    """
    Schedule at most one in-flight celestial warmup task.

    Startup/setup can both request warmup around the same time; this guard keeps it single-flight.
    """
    global _celestial_sync_warmup_task

    if _celestial_sync_warmup_task is not None and not _celestial_sync_warmup_task.done():
        logger.info("Celestial sync warmup already scheduled/running; skipping duplicate request.")
        return _celestial_sync_warmup_task

    _celestial_sync_warmup_task = asyncio.create_task(
        run_celestial_sync_warmup_job(
            background_task_manager,
            sio,
            delay_seconds=delay_seconds,
            max_wait_seconds=max_wait_seconds,
        )
    )
    return _celestial_sync_warmup_task


def start_scheduler(sio, process_manager, background_task_manager):
    """Initialize and start the background task scheduler."""
    global scheduler

    if scheduler is not None:
        logger.warning("Scheduler already started")
        return scheduler

    scheduler = AsyncIOScheduler()
    set_scheduler_reference(scheduler)

    # Schedule satellite data synchronization every 24 hours
    scheduler.add_job(
        sync_satellite_data_job,
        trigger=IntervalTrigger(hours=24),
        args=[background_task_manager],
        id=ORBITAL_SYNC_JOB_ID,
        name="Synchronize satellite data",
        replace_existing=True,
    )

    # Schedule decoder health check every 60 seconds as a safety net
    # Primary restart mechanism is event-driven via data_queue (immediate response)
    # This is a backup in case message delivery fails
    scheduler.add_job(
        check_and_restart_decoders_job,
        trigger=IntervalTrigger(seconds=60),
        args=[process_manager],
        id="check_restart_decoders",
        name="Check and restart decoders (fallback)",
        replace_existing=True,
    )

    # Schedule automatic observation generation
    # Default: every 12 hours (configurable via preferences)
    scheduler.add_job(
        generate_observations_job,
        trigger=IntervalTrigger(hours=DEFAULT_AUTO_GENERATE_INTERVAL_HOURS),
        id="generate_observations",
        name="Generate scheduled observations",
        replace_existing=True,
    )

    celestial_sync_enabled = bool(getattr(arguments, "celestial_periodic_sync_enabled", True))
    try:
        celestial_sync_interval_minutes = int(
            getattr(arguments, "celestial_periodic_sync_interval_minutes", 60)
        )
    except (TypeError, ValueError):
        celestial_sync_interval_minutes = 60
    celestial_sync_interval_minutes = max(5, celestial_sync_interval_minutes)
    if celestial_sync_enabled:
        # Let startup settle before the first Horizons cache-fill run.
        scheduler.add_job(
            sync_celestial_vector_snapshots_job,
            trigger=IntervalTrigger(minutes=celestial_sync_interval_minutes),
            args=[background_task_manager, sio],
            id="sync_celestial_vector_snapshots",
            name="Synchronize celestial vector snapshots",
            replace_existing=True,
            max_instances=1,
            coalesce=True,
        )

    scheduler.add_job(
        emit_cached_celestial_tracks_job,
        trigger=IntervalTrigger(seconds=CELESTIAL_TRACKS_BROADCAST_INTERVAL_SECONDS),
        args=[sio],
        id=CELESTIAL_TRACKS_BROADCAST_JOB_ID,
        name="Broadcast cached celestial tracks",
        replace_existing=True,
        max_instances=1,
        coalesce=True,
    )

    scheduler.start()

    # Consolidated startup log with job details
    jobs = scheduler.get_jobs()
    job_count = len(jobs)
    logger.info(
        f"Background task scheduler started: {job_count} job{'s' if job_count != 1 else ''} scheduled"
    )
    for job in jobs:
        # Format next run time without microseconds for cleaner display
        next_run = (
            job.next_run_time.strftime("%Y-%m-%d %H:%M:%S %Z") if job.next_run_time else "N/A"
        )
        logger.info(f"  - {job.name} → next run: {next_run}")

    return scheduler


def stop_scheduler():
    """Stop the background task scheduler."""
    global scheduler

    if scheduler is None:
        return

    logger.info("Stopping background task scheduler...")
    scheduler.shutdown(wait=False)
    set_scheduler_reference(None)
    scheduler = None
    logger.info("Background task scheduler stopped")
