"""
Background Task Manager (Multiprocessing) - Manages long-running tasks with real-time progress updates.

Refactored to use multiprocessing instead of subprocess for better security:
- No shell command execution
- Direct Python function calls
- Inter-process communication via Queue
- Process isolation

Features:
- Start Python functions as separate processes
- Real-time progress updates via Queue
- Process status tracking (running, completed, failed, stopped)
- Graceful termination with timeout
- In-memory task tracking with persisted orbital sync end-state snapshots
- No shell command injection vulnerabilities

Usage Example (Python):
    from server.startup import background_task_manager
    from tasks.example_task_mp import example_long_task

    # Start a task
    task_id = await background_task_manager.start_task(
        func=example_long_task,
        args=("Task Name", 300, 5),  # duration=300s, interval=5s
        name="Example Task"
    )

    # Stop a task
    await background_task_manager.stop_task(task_id, timeout=5.0)

    # Get running tasks
    tasks = background_task_manager.get_running_tasks()

Usage Example (JavaScript via Socket.IO):
    // Start a 5-minute test task
    __socket.emit('background_task:start', {
        task_name: 'example_long_task',
        args: ['Test Task', 300, 5],  // name, duration, interval
        name: 'Example 5-Minute Task'
    }, (response) => console.log(response));

    // Start a quick task
    __socket.emit('background_task:start', {
        task_name: 'example_quick_task',
        args: ['Hello from browser!'],
        name: 'Quick Test'
    });

    // Start a failing task (for testing error handling)
    __socket.emit('background_task:start', {
        task_name: 'example_failing_task',
        args: ['This will fail!'],
        name: 'Failing Task'
    });
"""

import asyncio
import multiprocessing as mp
import time
import traceback
import uuid
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from queue import Empty
from typing import Any, Callable, Dict, List, Optional, Tuple

from common.logger import logger
from common.satdump import resolve_satdump_bundle, resolve_satdump_output_dir
from db import AsyncSessionLocal
from handlers.entities.filebrowser import emit_file_browser_state
from hardware.soapysdrbrowser import DISCOVERY_SEARCH_SECONDS, update_discovered_servers
from observations.bundle import add_bundle_processing_task, finish_bundle_processing_task
from server.schedulerstate import get_orbital_sync_next_run_time
from tasks.waterfallgenerator import generate_waterfall_task
from tlesync.persist import is_terminal_orbital_sync_state, save_orbital_sync_state
from tlesync.state import sync_state_manager
from tracker.runner import get_all_tracker_managers

WORKER_EXIT_TIMEOUT_SECONDS = 5.0
WORKER_TERMINATE_TIMEOUT_SECONDS = 2.0
WORKER_KILL_TIMEOUT_SECONDS = 1.0
PROCESS_POLL_INTERVAL_SECONDS = 0.05


class TaskStatus(Enum):
    """Task execution states."""

    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    STOPPED = "stopped"


class TaskMessage:
    """Message types for inter-process communication."""

    OUTPUT = "output"  # Progress output message
    ERROR = "error"  # Error message
    COMPLETE = "complete"  # Task completed successfully
    FAILED = "failed"  # Task failed with exception


@dataclass
class TaskInfo:
    """Information about a running background task."""

    task_id: str
    name: str
    func_name: str
    args: Tuple[Any, ...]
    kwargs: Dict[str, Any]
    status: TaskStatus
    process: Optional[mp.Process] = None
    pid: Optional[int] = None
    start_time: float = field(default_factory=time.time)
    end_time: Optional[float] = None
    return_code: Optional[int] = None
    output_lines: List[str] = field(default_factory=list)
    error_lines: List[str] = field(default_factory=list)
    queue: Optional[mp.Queue] = None
    tracker_notified: bool = False
    # A result can arrive before interpreter/thread cleanup finishes in the child.
    reported_status: Optional[TaskStatus] = None
    result_received_at: Optional[float] = None
    stop_requested: bool = False
    observation_bundle: Optional[Path] = None
    bundle_finalized: bool = False
    termination_lock: asyncio.Lock = field(default_factory=asyncio.Lock, repr=False)


def _is_soapysdr_task(task_name: str, func_name: str) -> bool:
    normalized_name = str(task_name or "").strip().lower()
    normalized_func_name = str(func_name or "").strip().lower()
    return "soapysdr" in normalized_name or "soapysdr" in normalized_func_name


def _is_orbital_sync_task(task_name: str, func_name: str) -> bool:
    normalized_name = str(task_name or "").strip().lower()
    normalized_func_name = str(func_name or "").strip().lower()
    patterns = ("orbital_sync", "orbital data sync", "tle_sync", "tle sync")
    return any(
        pattern in normalized_name or pattern in normalized_func_name for pattern in patterns
    )


def _task_wrapper(func: Callable, args: Tuple, kwargs: Dict, queue: mp.Queue):
    """
    Wrapper function that runs in the child process.

    Catches all output and exceptions, sends them back via queue.
    """
    try:
        # Call the actual task function
        result = func(*args, **kwargs, _progress_queue=queue)

        # Send completion message
        queue.put({"type": TaskMessage.COMPLETE, "result": result, "timestamp": time.time()})

    except Exception as e:
        # Send failure message
        queue.put(
            {
                "type": TaskMessage.FAILED,
                "error": str(e),
                "exception_type": type(e).__name__,
                "traceback": traceback.format_exc(),
                "timestamp": time.time(),
            }
        )
        raise


class BackgroundTaskManager:
    """
    Manages background tasks as separate processes with real-time progress updates.

    Features:
    - Multiprocessing execution (no shell commands)
    - Real-time progress via Queue
    - Socket.IO event emission for UI updates
    - Task cancellation support
    - Automatic cleanup on completion
    - In-memory task tracking (orbital sync end state persisted separately)
    """

    def __init__(self, socketio):
        """
        Initialize the background task manager.

        Args:
            socketio: Socket.IO server instance for emitting events
        """
        self.sio = socketio
        self.tasks: Dict[str, TaskInfo] = {}
        self._monitor_tasks: Dict[str, asyncio.Task] = {}
        self._shutting_down = False
        logger.info("BackgroundTaskManager (multiprocessing) initialized")

    async def _persist_orbital_sync_state(self, state: Dict[str, Any]) -> None:
        """
        Persist terminal orbital sync snapshots for post-restart UI hydration.

        Only terminal snapshots are persisted to avoid frequent writes while a
        sync is still in progress.
        """
        try:
            async with AsyncSessionLocal() as dbsession:
                await save_orbital_sync_state(dbsession, state)
        except Exception:
            logger.exception("Failed to persist orbital sync state snapshot")

    async def start_task(
        self,
        func: Callable,
        args: Tuple[Any, ...] = (),
        kwargs: Optional[Dict[str, Any]] = None,
        name: Optional[str] = None,
        task_id: Optional[str] = None,
        observation_bundle: Optional[str] = None,
    ) -> str:
        """
        Start a new background task.

        Args:
            func: Python function to execute
            args: Positional arguments for the function
            kwargs: Keyword arguments for the function
            name: Human-readable task name (defaults to function name)
            task_id: Optional task ID (generated if not provided)
            observation_bundle: Owner of an observation's follow-up waterfall

        Returns:
            Task ID string

        Raises:
            RuntimeError: If task fails to start
            ValueError: If a singleton task is already running
        """
        if self._shutting_down:
            raise RuntimeError("Background task manager is shutting down")

        if task_id is None:
            task_id = str(uuid.uuid4())

        if name is None:
            name = func.__name__

        if kwargs is None:
            kwargs = {}

        # Discovery and refresh share the same server snapshot. Multiple clients
        # must not launch competing workers even if each disables its own button.
        if _is_soapysdr_task(name, func.__name__):
            if any(
                task.status == TaskStatus.RUNNING and _is_soapysdr_task(task.name, task.func_name)
                for task in self.tasks.values()
            ):
                raise ValueError("A SoapySDR discovery task is already running")

        # Check for singleton tasks (tasks that should not run concurrently with themselves)
        # Orbital sync is a singleton task because it modifies shared database state.
        # Keep legacy tle_sync pattern for backward compatibility.
        singleton_task_patterns = ["Orbital Data Sync", "orbital_sync", "TLE Sync", "tle_sync"]
        is_singleton = any(
            pattern in name or pattern in func.__name__ for pattern in singleton_task_patterns
        )

        if is_singleton:
            # Check if this singleton task is already running
            for existing_task_id, existing_task in self.tasks.items():
                if existing_task.status == TaskStatus.RUNNING:
                    # Check if it's the same singleton task type
                    is_same_singleton = any(
                        pattern in existing_task.name or pattern == func.__name__
                        for pattern in singleton_task_patterns
                    )
                    if is_same_singleton:
                        error_msg = (
                            f"Cannot start '{name}': An orbital sync task is already running "
                            f"(ID: {existing_task_id})"
                        )
                        logger.warning(error_msg)
                        raise ValueError(error_msg)

        logger.info(f"Starting background task '{name}' (ID: {task_id}): {func.__name__}")

        bundle_dir = None
        process = None
        try:
            bundle_owner = observation_bundle or kwargs.get("observation_bundle")
            if bundle_owner:
                backend_dir = Path(__file__).resolve().parents[1]
                bundle_dir = resolve_satdump_bundle(bundle_owner, backend_dir)
                source = Path(args[0]).resolve()
                source.relative_to(bundle_dir / "recordings")
                if func.__name__ == "satdump_process_recording":
                    output = resolve_satdump_output_dir(args[1], backend_dir, bundle_dir)
                    pipeline = args[2]
                elif func is generate_waterfall_task:
                    output = source.with_suffix(".png")
                    pipeline = "waterfall"
                else:
                    raise ValueError("Unsupported observation processing task")
                add_bundle_processing_task(bundle_dir, task_id, str(source), str(output), pipeline)

            # Create inter-process queue for communication
            queue: mp.Queue = mp.Queue()

            # Create process
            process = mp.Process(
                target=_task_wrapper, args=(func, args, kwargs, queue), name=f"BGTask-{name}"
            )
            process.start()

            # Create task info
            task_info = TaskInfo(
                task_id=task_id,
                name=name,
                func_name=func.__name__,
                args=args,
                kwargs=kwargs,
                status=TaskStatus.RUNNING,
                process=process,
                pid=process.pid,
                queue=queue,
                observation_bundle=bundle_dir,
            )

            self.tasks[task_id] = task_info

            # Emit task started event
            await self.sio.emit(
                "background_task:started",
                {
                    "task_id": task_id,
                    "name": name,
                    "command": func.__name__,
                    "args": [str(a) for a in args],  # Convert to strings for JSON
                    "pid": process.pid,
                    "start_time": task_info.start_time,
                },
            )

            if _is_soapysdr_task(name, func.__name__):
                # Publish discovery lifecycle events for hardware-page notifications.
                await self.sio.emit(
                    "soapysdr:discovery_started",
                    {
                        "task_id": task_id,
                        "name": name,
                        "duration": DISCOVERY_SEARCH_SECONDS,
                    },
                )

            # Socket.IO notifications above can yield to shutdown. That path
            # already owns the registered process and must not gain a late monitor.
            if self._shutting_down:
                return task_id

            # Start monitoring in background
            monitor_task = asyncio.create_task(self._monitor_task(task_id))
            self._monitor_tasks[task_id] = monitor_task

            logger.info(f"Background task '{name}' started with PID {process.pid}")
            return task_id

        except Exception as e:
            # A notification failure after launch must not release protection
            # while a worker can still write into the bundle.
            if bundle_dir and process is not None and process.is_alive() and task_id in self.tasks:
                await self._terminate_process(self.tasks[task_id], WORKER_TERMINATE_TIMEOUT_SECONDS)
            if bundle_dir and (process is None or not process.is_alive()):
                finish_bundle_processing_task(bundle_dir, task_id, "failed", str(e))
            logger.error(f"Failed to start background task '{name}': {e}")
            await self.sio.emit(
                "background_task:error",
                {"task_id": task_id, "name": name, "error": str(e)},
            )
            raise RuntimeError(f"Failed to start task: {e}")

    async def _finish_bundle_processing(self, task_info: TaskInfo) -> None:
        """Publish terminal storage state only after the worker has exited."""
        if not task_info.observation_bundle or task_info.bundle_finalized:
            return
        if task_info.process and task_info.process.is_alive():
            return
        finish_bundle_processing_task(
            task_info.observation_bundle,
            task_info.task_id,
            task_info.status.value,
            "\n".join(task_info.error_lines[-5:]) or None,
        )
        task_info.bundle_finalized = True
        await emit_file_browser_state(
            self.sio,
            {"action": "observation-bundle-finalized", "task_id": task_info.task_id},
            logger,
        )

    async def _monitor_task(self, task_id: str):
        """
        Monitor a task's queue for messages and emit progress updates.

        Args:
            task_id: ID of task to monitor
        """
        task_info = self.tasks.get(task_id)
        if not task_info:
            logger.error(f"Cannot monitor task {task_id}: not found")
            return

        process = task_info.process
        queue = task_info.queue

        if not process or not queue:
            logger.error(f"Cannot monitor task {task_id}: missing process or queue")
            return

        try:
            # Monitor queue for messages
            process_exited_at: Optional[float] = None
            while True:
                # Explicit stops own finalization while the monitor continues to
                # exist. This prevents a killed worker also emitting completion.
                if task_info.stop_requested:
                    await asyncio.sleep(PROCESS_POLL_INTERVAL_SECONDS)
                    continue

                # Check before reading messages so output cannot starve the
                # deadline. asyncio timeouts cannot stop native executor threads.
                if (
                    task_info.result_received_at is not None
                    and time.monotonic() - task_info.result_received_at
                    >= WORKER_EXIT_TIMEOUT_SECONDS
                    and process.is_alive()
                ):
                    error = "Task returned, but worker failed to exit before its cleanup deadline"
                    logger.error("Background task '%s': %s", task_info.name, error)
                    if not await self._terminate_process(
                        task_info, timeout=WORKER_TERMINATE_TIMEOUT_SECONDS
                    ):
                        raise RuntimeError(f"Could not stop worker for task '{task_info.name}'")
                    if task_info.stop_requested:
                        return
                    await self._handle_message(
                        task_id, {"type": TaskMessage.FAILED, "error": error}
                    )
                    # The result already followed the task's output in the FIFO.
                    # Do not read a queue that SIGKILL may have interrupted.
                    break

                try:
                    message = queue.get_nowait()
                    await self._handle_message(task_id, message)
                    continue
                except Empty:
                    pass
                except Exception as e:
                    logger.error(f"Error processing message for task {task_id}: {e}")
                    await asyncio.sleep(0.1)
                    continue

                if process.is_alive():
                    await asyncio.sleep(0.1)
                    continue

                # Give multiprocessing queue feeder threads a short grace period
                # to flush trailing messages after process exit.
                if process_exited_at is None:
                    process_exited_at = time.monotonic()
                    await asyncio.sleep(0.05)
                    continue
                if time.monotonic() - process_exited_at < 0.5:
                    await asyncio.sleep(0.05)
                    continue

                break

            # Wait for process to complete
            process.join(timeout=0)
            return_code = process.exitcode if process.exitcode is not None else -1

            if task_info.stop_requested or task_info.status == TaskStatus.STOPPED:
                return

            # Update task info
            task_info.end_time = time.time()
            task_info.return_code = return_code

            # Finalize only after exit, combining the reported outcome with the
            # actual exit code. A result alone does not establish success.
            if task_info.status == TaskStatus.RUNNING:
                if return_code == 0 and task_info.reported_status != TaskStatus.FAILED:
                    task_info.status = TaskStatus.COMPLETED
                    logger.info(f"Background task '{task_info.name}' completed successfully")
                else:
                    task_info.status = TaskStatus.FAILED
                    logger.warning(
                        f"Background task '{task_info.name}' failed with exit code {return_code}"
                    )
            elif task_info.status == TaskStatus.COMPLETED and return_code != 0:
                # Defensive guard: if task reported completion but exited non-zero,
                # treat it as failed to avoid false-success states.
                task_info.status = TaskStatus.FAILED
                logger.warning(
                    "Background task '%s' exited with non-zero code %s after completion message",
                    task_info.name,
                    return_code,
                )

            # Emit completion event
            await self.sio.emit(
                "background_task:completed",
                {
                    "task_id": task_id,
                    "name": task_info.name,
                    "status": task_info.status.value,
                    "return_code": return_code,
                    "duration": task_info.end_time - task_info.start_time,
                },
            )

            if (
                task_info.status == TaskStatus.FAILED
                and _is_soapysdr_task(task_info.name, task_info.func_name)
                and not any(line.startswith("FAILED:") for line in task_info.error_lines)
            ):
                await self.sio.emit(
                    "soapysdr:discovery_error",
                    {
                        "task_id": task_id,
                        "name": task_info.name,
                        "error": f"Task failed with return code {return_code}",
                    },
                )

            # Special handling for waterfall generation tasks
            if task_info.name.startswith("Waterfall:") and task_info.status == TaskStatus.COMPLETED:
                try:
                    # Extract recording path from task name (format: "Waterfall: filename")
                    # We need the full path though, which should be in the task's args
                    # For now, just emit a generic waterfall-generated event
                    await emit_file_browser_state(
                        self.sio,
                        {
                            "action": "waterfall-generated",
                            "task_id": task_id,
                        },
                        logger,
                    )
                except Exception as e:
                    logger.error(f"Error emitting waterfall-generated notification: {e}")

            # Special handling for SatDump processing tasks
            if task_info.name.startswith("SatDump:") and task_info.status == TaskStatus.COMPLETED:
                try:
                    await emit_file_browser_state(
                        self.sio,
                        {
                            "action": "satdump-completed",
                            "task_id": task_id,
                        },
                        logger,
                    )
                except Exception as e:
                    logger.error(f"Error emitting satdump-completed notification: {e}")

            if (
                task_info.name.startswith("SatDump:")
                and task_info.status == TaskStatus.FAILED
                and not self._shutting_down
                and task_info.kwargs.get("delete_input_after")
                and task_info.kwargs.get("retain_input_on_failure", True)
                and task_info.args
            ):
                try:
                    recording_file = Path(task_info.args[0])
                    recording_base = recording_file.with_suffix("")
                    metadata_file = recording_base.with_suffix(".sigmf-meta")
                    if recording_file.is_file() and metadata_file.is_file():
                        # The recorder skipped its normal waterfall because this IQ
                        # was expected to be deleted after SatDump succeeded.
                        waterfall_task_id = await self.start_task(
                            func=generate_waterfall_task,
                            args=(str(recording_base),),
                            name=f"Waterfall: {recording_base.name}",
                            observation_bundle=(
                                str(task_info.observation_bundle)
                                if task_info.observation_bundle
                                else None
                            ),
                        )
                        logger.info(
                            "Started waterfall task %s for retained SatDump IQ %s",
                            waterfall_task_id,
                            recording_file,
                        )
                except Exception:
                    logger.exception("Failed to start waterfall for retained SatDump IQ")

            # Register any retained-input waterfall first, so protection transfers
            # to that job without briefly exposing the bundle as finished.
            await self._finish_bundle_processing(task_info)

        except asyncio.CancelledError:
            logger.info(f"Monitoring cancelled for task '{task_info.name}'")
            raise
        except Exception as e:
            logger.error(f"Error monitoring task '{task_info.name}': {e}")
            task_info.status = TaskStatus.FAILED
            task_info.end_time = time.time()
            await self._finish_bundle_processing(task_info)
            await self.sio.emit(
                "background_task:error",
                {"task_id": task_id, "name": task_info.name, "error": str(e)},
            )
        finally:
            # Cleanup monitor task reference
            self._monitor_tasks.pop(task_id, None)
            # Close queue
            if queue:
                queue.close()

    async def _handle_message(self, task_id: str, message: Dict):
        """
        Handle a message from the task process.

        Args:
            task_id: Task ID
            message: Message dict from queue
        """
        task_info = self.tasks.get(task_id)
        if not task_info:
            return

        msg_type = message.get("type")

        if msg_type == TaskMessage.OUTPUT:
            # Progress output
            output = message.get("output", "")
            stream = message.get("stream", "stdout")
            progress = message.get("progress")  # Get progress value if available

            if stream == "stderr":
                task_info.error_lines.append(output)
            else:
                task_info.output_lines.append(output)

            # Emit progress update
            emit_data = {
                "task_id": task_id,
                "name": task_info.name,
                "stream": stream,
                "output": output,
            }

            # Include progress value if provided
            if progress is not None:
                emit_data["progress"] = progress

            await self.sio.emit("background_task:progress", emit_data)

        elif msg_type == TaskMessage.ERROR:
            # Error message
            error = message.get("error", "Unknown error")
            task_info.error_lines.append(f"ERROR: {error}")

            await self.sio.emit(
                "background_task:progress",
                {
                    "task_id": task_id,
                    "name": task_info.name,
                    "stream": "stderr",
                    "output": f"ERROR: {error}",
                },
            )

        elif msg_type == TaskMessage.COMPLETE:
            # Keep owning the live process even after its function has returned.
            task_info.reported_status = TaskStatus.COMPLETED
            if task_info.result_received_at is None:
                task_info.result_received_at = time.monotonic()

        elif msg_type == TaskMessage.FAILED:
            task_info.reported_status = TaskStatus.FAILED
            if task_info.result_received_at is None:
                task_info.result_received_at = time.monotonic()
            error = message.get("error", "Unknown error")
            task_info.error_lines.append(f"FAILED: {error}")
            await self.sio.emit(
                "background_task:progress",
                {
                    "task_id": task_id,
                    "name": task_info.name,
                    "stream": "stderr",
                    "output": f"FAILED: {error}",
                },
            )
            await self.sio.emit(
                "background_task:error",
                {
                    "task_id": task_id,
                    "name": task_info.name,
                    "error": error,
                },
            )
            if _is_soapysdr_task(task_info.name, task_info.func_name):
                await self.sio.emit(
                    "soapysdr:discovery_error",
                    {
                        "task_id": task_id,
                        "name": task_info.name,
                        "error": error,
                    },
                )

        elif msg_type == "discovery_update":
            # SoapySDR discovery data update from background task
            servers_data = message.get("servers", {})
            server_count = message.get("server_count", 0)
            active_count = message.get("active_count", 0)
            sdr_count = message.get("sdr_count", 0)
            refresh_count = message.get("refresh_count")

            logger.info(
                f"Received discovery update: {server_count} server(s), {active_count} active"
            )

            # Update the main process's discovered_servers
            try:
                update_discovered_servers(servers_data)
                logger.info("Updated main process discovered_servers")

                # Emit Socket.IO event based on whether this is initial discovery or refresh
                if refresh_count is not None:
                    # This is a refresh
                    await self.sio.emit(
                        "soapysdr:refresh_complete",
                        {
                            "refresh_count": refresh_count,
                            "active_count": active_count,
                            "sdr_count": sdr_count,
                            "servers": servers_data,
                        },
                    )
                else:
                    # This is initial discovery
                    await self.sio.emit(
                        "soapysdr:discovery_complete",
                        {
                            "server_count": server_count,
                            "active_count": active_count,
                            "sdr_count": sdr_count,
                            "servers": servers_data,
                        },
                    )

            except Exception as e:
                logger.error(f"Failed to update discovered servers: {e}")

        elif msg_type in ("orbital_sync_state", "tle_sync_state"):
            # Orbital synchronization state update from background task
            state = dict(message.get("state", {}) or {})
            progress = message.get("progress", 0)

            # Keep main-process sync state in sync for fetch-sync-state requests
            try:
                sync_state_manager.set_state(state)
            except Exception as e:
                logger.error(f"Failed to update main sync state: {e}")

            if is_terminal_orbital_sync_state(state):
                await self._persist_orbital_sync_state(state)

            # Keep scheduler-derived fields runtime-only (not stored in tracking_state).
            payload_state = dict(state)
            payload_state["next_scheduled_sync_at"] = get_orbital_sync_next_run_time()

            # Forward the complete sync state to the frontend
            # This maintains compatibility with existing UI expectations
            await self.sio.emit("sat-sync-events", payload_state)

            # Also emit generic progress update for task list visibility
            await self.sio.emit(
                "background_task:progress",
                {
                    "task_id": task_id,
                    "name": task_info.name,
                    "stream": "stdout",
                    "output": payload_state.get("message", "Synchronizing..."),
                    "progress": progress,
                },
            )

            if (
                state.get("status") == "complete"
                and state.get("success")
                and not task_info.tracker_notified
            ):
                task_info.tracker_notified = True
                try:
                    managers = get_all_tracker_managers()

                    satellite_norad_ids = {
                        sat.get("norad_id")
                        for sat in (state.get("modified", {}) or {}).get("satellites", [])
                    }
                    satellite_norad_ids.update(
                        {
                            sat.get("norad_id")
                            for sat in (state.get("newly_added", {}) or {}).get("satellites", [])
                        }
                    )
                    satellite_norad_ids = {nid for nid in satellite_norad_ids if nid}

                    transmitter_norad_ids = {
                        tx.get("norad_id")
                        for tx in (state.get("modified", {}) or {}).get("transmitters", [])
                    }
                    transmitter_norad_ids.update(
                        {
                            tx.get("norad_id")
                            for tx in (state.get("newly_added", {}) or {}).get("transmitters", [])
                        }
                    )
                    transmitter_norad_ids.update(
                        {
                            tx.get("norad_id")
                            for tx in (state.get("removed", {}) or {}).get("transmitters", [])
                        }
                    )
                    transmitter_norad_ids = {nid for nid in transmitter_norad_ids if nid}

                    all_norad_ids = set()
                    all_norad_ids.update(satellite_norad_ids)
                    all_norad_ids.update(transmitter_norad_ids)

                    for norad_id in sorted(all_norad_ids):
                        for manager in managers.values():
                            await manager.notify_tracking_inputs_from_db(norad_id)

                except Exception as e:
                    logger.debug(f"Failed to notify tracker manager after orbital sync: {e}")

    @staticmethod
    async def _wait_for_process_exit(process: mp.Process, timeout: float) -> bool:
        """Poll without blocking the event loop or leaving an executor join behind."""
        deadline = time.monotonic() + timeout
        while process.is_alive():
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                return False
            await asyncio.sleep(min(PROCESS_POLL_INTERVAL_SECONDS, remaining))
        process.join(timeout=0)
        return True

    async def _terminate_process(self, task_info: TaskInfo, timeout: float) -> bool:
        """Stop and reap a worker regardless of its recorded task/result status."""
        # A deadline and an administrator stop can overlap. Only one caller may
        # signal a worker at a time; later callers just reap the exited process.
        async with task_info.termination_lock:
            process = task_info.process
            if process is None:
                return True
            if not process.is_alive():
                process.join(timeout=0)
                return True

            process.terminate()
            if await self._wait_for_process_exit(process, timeout):
                return True

            logger.warning("Task '%s' did not terminate, sending SIGKILL", task_info.name)
            process.kill()
            if await self._wait_for_process_exit(process, WORKER_KILL_TIMEOUT_SECONDS):
                return True

            logger.error("Worker for task '%s' is still alive after SIGKILL", task_info.name)
            return False

    async def stop_task(self, task_id: str, timeout: float = 5.0) -> bool:
        """
        Stop a running background task.

        Sends SIGTERM, waits for timeout, then sends SIGKILL if still running.

        Args:
            task_id: ID of task to stop
            timeout: Seconds to wait for graceful termination before killing

        Returns:
            True if task was stopped, False if not found or already finished
        """
        task_info = self.tasks.get(task_id)
        if not task_info:
            logger.warning(f"Cannot stop task {task_id}: not found")
            return False

        process = task_info.process
        if not process:
            logger.warning(f"Cannot stop task {task_id}: no process")
            return False

        if not process.is_alive():
            process.join(timeout=0)
            return False

        logger.info(f"Stopping background task '{task_info.name}' (PID: {process.pid})")

        task_info.stop_requested = True
        try:
            if not await self._terminate_process(task_info, timeout):
                return False

            # The queue must stay available until the worker has exited. Await
            # monitor cancellation so it cannot race later state/queue cleanup.
            monitor_task = self._monitor_tasks.get(task_id)
            if monitor_task and not monitor_task.done():
                monitor_task.cancel()
                await asyncio.gather(monitor_task, return_exceptions=True)

            # Update task info
            task_info.status = TaskStatus.STOPPED
            task_info.end_time = time.time()
            task_info.return_code = process.exitcode
            await self._finish_bundle_processing(task_info)

            if _is_orbital_sync_task(task_info.name, task_info.func_name):
                stopped_message = "Orbital data synchronization stopped by user"
                current_state = dict(sync_state_manager.get_state() or {})
                errors = list(current_state.get("errors") or [])
                if stopped_message not in errors:
                    errors.append(stopped_message)
                current_state.update(
                    {
                        "status": "complete",
                        "progress": 100,
                        "success": False,
                        "message": stopped_message,
                        "active_sources": [],
                        "errors": errors,
                    }
                )
                sync_state_manager.set_state(current_state)
                await self._persist_orbital_sync_state(sync_state_manager.get_state())
                payload_state = dict(sync_state_manager.get_state() or {})
                payload_state["next_scheduled_sync_at"] = get_orbital_sync_next_run_time()
                await self.sio.emit("sat-sync-events", payload_state)

            # Emit stopped event
            await self.sio.emit(
                "background_task:stopped",
                {
                    "task_id": task_id,
                    "name": task_info.name,
                    "duration": task_info.end_time - task_info.start_time,
                },
            )

            return True

        except Exception as e:
            logger.error(f"Error stopping task '{task_info.name}': {e}")
            return False
        finally:
            task_info.stop_requested = False

    def get_task(self, task_id: str) -> Optional[Dict]:
        """
        Get information about a specific task.

        Args:
            task_id: Task ID

        Returns:
            Task information dict, or None if not found
        """
        task_info = self.tasks.get(task_id)
        if not task_info:
            return None

        return {
            "task_id": task_info.task_id,
            "name": task_info.name,
            "command": task_info.func_name,
            "args": [str(a) for a in task_info.args],
            "status": task_info.status.value,
            "pid": task_info.pid,
            "start_time": task_info.start_time,
            "end_time": task_info.end_time,
            "return_code": task_info.return_code,
            "output_line_count": len(task_info.output_lines),
            "error_line_count": len(task_info.error_lines),
        }

    def get_all_tasks(self) -> List[Dict]:
        """
        Get information about all tasks.

        Returns:
            List of task information dicts
        """
        result = []
        for task_id in self.tasks.keys():
            task = self.get_task(task_id)
            if task is not None:
                result.append(task)
        return result

    def get_running_tasks(self) -> List[Dict]:
        """
        Get information about currently running tasks.

        Returns:
            List of running task information dicts
        """
        result = []
        for task_id, task_info in self.tasks.items():
            if task_info.status == TaskStatus.RUNNING:
                task = self.get_task(task_id)
                if task is not None:
                    result.append(task)
        return result

    def cleanup_finished_tasks(self, max_age_seconds: float = 3600):
        """
        Remove finished tasks older than specified age.

        Args:
            max_age_seconds: Maximum age in seconds for finished tasks
        """
        current_time = time.time()
        tasks_to_remove = []

        for task_id, task_info in self.tasks.items():
            # Failed monitoring or a reported result must never drop ownership
            # of a worker that Python would still join during interpreter exit.
            if task_info.process and task_info.process.is_alive():
                continue
            if task_info.status != TaskStatus.RUNNING and task_info.end_time:
                age = current_time - task_info.end_time
                if age > max_age_seconds:
                    tasks_to_remove.append(task_id)

        for task_id in tasks_to_remove:
            logger.debug(f"Removing finished task {task_id} from memory")
            removed_task: Optional[TaskInfo] = self.tasks.pop(task_id, None)
            # Close queue if still open
            if removed_task and removed_task.queue:
                removed_task.queue.close()

        if tasks_to_remove:
            logger.info(f"Cleaned up {len(tasks_to_remove)} finished tasks")

    async def shutdown(self):
        """
        Shutdown the task manager and stop all running tasks.
        """
        logger.info("Shutting down BackgroundTaskManager...")
        self._shutting_down = True

        # Task metadata is not proof of process exit. Signal live workers in
        # parallel so shutdown time does not grow by one timeout per worker.
        live_tasks = [
            task_id
            for task_id, info in self.tasks.items()
            if info.process and info.process.is_alive()
        ]

        if live_tasks:
            logger.info("Stopping %s live background worker(s)...", len(live_tasks))
            await asyncio.gather(
                *(
                    self.stop_task(task_id, timeout=WORKER_TERMINATE_TIMEOUT_SECONDS)
                    for task_id in live_tasks
                ),
                return_exceptions=True,
            )

        # Monitor finalizers remove themselves from the mapping, so iterate over
        # a snapshot and await them before closing queues a second time.
        monitors = list(self._monitor_tasks.values())
        for monitor_task in monitors:
            if not monitor_task.done():
                monitor_task.cancel()
        await asyncio.gather(*monitors, return_exceptions=True)

        survivors = []
        for task_info in self.tasks.values():
            if task_info.process:
                if task_info.process.is_alive():
                    survivors.append(task_info.task_id)
                    continue
                task_info.process.join(timeout=0)
            # Shutdown can cancel a monitor after its worker exits but before
            # it consumes the terminal message. Persist that interruption too.
            if task_info.observation_bundle and not task_info.bundle_finalized:
                task_info.status = TaskStatus.STOPPED
                await self._finish_bundle_processing(task_info)
            if task_info.queue:
                task_info.queue.close()

        if survivors:
            raise RuntimeError(f"Background workers did not exit during shutdown: {survivors}")

        logger.info("BackgroundTaskManager shutdown complete")
