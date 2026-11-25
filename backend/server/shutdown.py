import asyncio
from typing import Optional

import tracker.runner
from audio.audiobroadcaster import AudioBroadcaster
from audio.audiostreamer import WebAudioStreamer
from common.logger import logger
from server import runtimestate
from session.service import active_sdr_clients, session_service
from tracking.passpool import shutdown_worker_pool

# Globals used by audio threads
audio_consumer: Optional[WebAudioStreamer] = None
audio_broadcaster: Optional[AudioBroadcaster] = None
SESSION_CLEANUP_TIMEOUT_SECONDS = 10
SDR_PROCESS_CLEANUP_TIMEOUT_SECONDS = 15


async def cleanup_trackers(message_tasks: tuple[asyncio.Task, ...]) -> None:
    """Drain tracker output during graceful exit, then retire readers before writers."""
    supervisor = tracker.runner.get_tracker_supervisor()
    try:
        # Joining on the event loop prevents Queue feeder threads in exiting
        # trackers from flushing. Keep their consumers and hardware IPC running.
        await asyncio.to_thread(supervisor.wait_for_stop, 3.0)
    finally:
        for task in message_tasks:
            task.cancel()
        await asyncio.gather(*message_tasks, return_exceptions=True)
        # A forced stop can leave a partial message in the shared pipe. No
        # reader may call get_nowait() after this: it can block in recv_bytes().
        await asyncio.to_thread(tracker.runner.stop_all_tracker_processes, timeout=0)


def cleanup_everything():
    """Cleanup function to stop all processes and threads."""
    logger.info("Cleaning up all processes and threads...")

    # Also runs when startup fails or a forced exit skips the ASGI lifespan.
    shutdown_worker_pool()

    # Terminate tracker processes
    try:
        supervisor = tracker.runner.get_tracker_supervisor()
        active_tracker_ids = supervisor.get_all_tracker_ids()
        if active_tracker_ids:
            logger.info("Stopping tracker processes: %s", ", ".join(active_tracker_ids))
            tracker.runner.stop_all_tracker_processes(timeout=3.0)
            logger.info("Tracker processes stopped")
    except Exception as e:  # pragma: no cover - best effort cleanup
        logger.warning(f"Error stopping tracker: {e}")

    # Stop audio threads
    try:
        if audio_consumer:
            audio_consumer.stop()
        if audio_broadcaster:
            audio_broadcaster.stop()
    except Exception as e:  # pragma: no cover
        logger.warning(f"Error stopping audio: {e}")

    # Stop all transcription consumers (per-VFO)
    try:
        process_manager = runtimestate.process_manager
        if process_manager and process_manager.transcription_manager:
            # Stop all transcription consumers across all SDRs and sessions
            for sdr_id in list(process_manager.processes.keys()):
                process_info = process_manager.processes.get(sdr_id, {})
                transcription_consumers = process_info.get("transcription_consumers", {})
                for session_id in list(transcription_consumers.keys()):
                    process_manager.transcription_manager.stop_transcription(sdr_id, session_id)
            logger.info("All transcription consumers stopped")
    except Exception as e:  # pragma: no cover
        logger.warning(f"Error stopping transcription consumers: {e}")

    logger.info("Tracker, audio and transcription cleanup complete")


async def cleanup_sessions() -> None:
    """Await cleanup for every remaining SDR session during ASGI shutdown."""
    if not active_sdr_clients:
        return

    session_ids = list(active_sdr_clients.keys())
    logger.info("Cleaning up %s remaining SDR session(s)...", len(session_ids))
    for session_id in session_ids:
        try:
            await asyncio.wait_for(
                session_service.cleanup_session(session_id),
                timeout=SESSION_CLEANUP_TIMEOUT_SECONDS,
            )
            logger.info("Cleaned up SDR session: %s", session_id)
        except asyncio.TimeoutError:
            logger.error(
                "Timed out after %ss cleaning SDR session %s",
                SESSION_CLEANUP_TIMEOUT_SECONDS,
                session_id,
            )
        except Exception as error:  # pragma: no cover - best effort cleanup
            logger.warning("Error cleaning up SDR session %s: %s", session_id, error)
    logger.info("All SDR sessions cleaned up")


async def cleanup_sdr_processes() -> None:
    """Stop SDR workers that remain after session cleanup."""
    process_manager = runtimestate.process_manager
    if not process_manager:
        return

    # Joiners do not have entries in active_sdr_clients. A failed or timed-out
    # session cleanup can also leave a worker in the process map.
    for sdr_id in list(process_manager.processes.keys()):
        try:
            await asyncio.wait_for(
                process_manager.stop_sdr_process(sdr_id),
                timeout=SDR_PROCESS_CLEANUP_TIMEOUT_SECONDS,
            )
            logger.info("Stopped remaining SDR process: %s", sdr_id)
        except asyncio.TimeoutError:
            logger.error(
                "Timed out after %ss stopping remaining SDR process %s",
                SDR_PROCESS_CLEANUP_TIMEOUT_SECONDS,
                sdr_id,
            )
        except Exception as error:  # pragma: no cover - best effort cleanup
            logger.warning("Error stopping remaining SDR process %s: %s", sdr_id, error)


def stop_tracker():
    """Simple function to kill all tracker processes."""
    try:
        tracker.runner.stop_all_tracker_processes(timeout=0.5)
    except Exception:  # pragma: no cover - best effort cleanup
        pass
