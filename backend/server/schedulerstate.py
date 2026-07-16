"""Shared runtime state helpers for APScheduler metadata."""

from datetime import datetime, timezone
from typing import Optional

from apscheduler.schedulers.asyncio import AsyncIOScheduler

from common.logger import logger

ORBITAL_SYNC_JOB_ID = "sync_satellite_data"
_scheduler_ref: Optional[AsyncIOScheduler] = None


def set_scheduler_reference(instance: Optional[AsyncIOScheduler]) -> None:
    """Store the live scheduler instance for metadata lookups across modules."""
    global _scheduler_ref
    _scheduler_ref = instance


def get_orbital_sync_next_run_time() -> Optional[str]:
    """
    Return the next APScheduler run time for orbital sync as an ISO8601 UTC string.

    This is used by UI sync-state payloads so the frontend can show when the next
    scheduled orbital sync job is expected to run.
    """
    if _scheduler_ref is None:
        return None

    try:
        job = _scheduler_ref.get_job(ORBITAL_SYNC_JOB_ID)
    except Exception:
        logger.exception("Failed to read orbital sync APScheduler job metadata")
        return None

    if not job or not job.next_run_time:
        return None

    next_run_raw = job.next_run_time
    if not isinstance(next_run_raw, datetime):
        return None

    next_run = next_run_raw
    if next_run.tzinfo is None:
        next_run = next_run.replace(tzinfo=timezone.utc)
    return next_run.astimezone(timezone.utc).isoformat()
