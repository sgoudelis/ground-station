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
import re
import time
from dataclasses import dataclass
from multiprocessing import Queue
from multiprocessing.synchronize import Event as MpEvent
from typing import Any, Dict, Optional

import setproctitle

from common.arguments import arguments
from hardware.client import HardwareClient
from hardware.service import hardware
from tracker.contracts import require_tracker_id
from tracker.logic import SatelliteTracker
from tracker.manager import TrackerManager

logger = logging.getLogger("tracker-worker")


@dataclass
class TrackerRuntime:
    tracker_id: str
    process: multiprocessing.Process
    queue_to_tracker: Queue
    stop_event: MpEvent


class TrackerSupervisor:
    TARGET_TRACKER_ID_PATTERN = re.compile(r"^target-(\d+)$")
    OUTPUT_QUEUE_LOCK_TIMEOUT_SECONDS = 2.0

    def __init__(self):
        self.output_queue: Queue = multiprocessing.Queue()
        self.runtimes: Dict[str, TrackerRuntime] = {}
        self.managers: Dict[str, TrackerManager] = {}
        self.tracker_rotator_map: Dict[str, str] = {}
        self.rotator_tracker_map: Dict[str, str] = {}
        configured_limit = getattr(arguments, "max_tracker_targets", 10)
        try:
            configured_limit = int(configured_limit)
        except (TypeError, ValueError):
            configured_limit = 10
        self.max_target_slots: int = max(1, configured_limit)

    @classmethod
    def _parse_target_slot_number(cls, tracker_id: str) -> Optional[int]:
        matched = cls.TARGET_TRACKER_ID_PATTERN.match(tracker_id)
        if not matched:
            return None
        try:
            parsed = int(matched.group(1))
        except (TypeError, ValueError):
            return None
        return parsed if parsed > 0 else None

    @classmethod
    def _is_target_tracker_id(cls, tracker_id: str) -> bool:
        return cls._parse_target_slot_number(tracker_id) is not None

    def _all_known_tracker_ids(self) -> set[str]:
        return (
            set(self.runtimes.keys())
            | set(self.managers.keys())
            | set(self.tracker_rotator_map.keys())
            | set(self.rotator_tracker_map.values())
        )

    def _active_target_tracker_ids(self) -> set[str]:
        return {
            tracker_id
            for tracker_id in self._all_known_tracker_ids()
            if self._is_target_tracker_id(tracker_id)
        }

    def _build_tracker_slot_limit_error(
        self,
        tracker_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        return {
            "success": False,
            "error": "tracker_slot_limit_reached",
            "message": (
                f"Maximum number of active target slots reached " f"({self.max_target_slots})."
            ),
            "data": {
                "tracker_id": tracker_id,
                "limit": self.max_target_slots,
                "active_targets": len(self._active_target_tracker_ids()),
            },
        }

    def _allocate_target_tracker_id(self) -> Optional[str]:
        """Allocate the lowest free target-N slot within configured limit."""
        active_target_ids = self._active_target_tracker_ids()
        if len(active_target_ids) >= self.max_target_slots:
            return None

        used_slot_numbers = {
            slot_number
            for tracker_id in active_target_ids
            if (slot_number := self._parse_target_slot_number(tracker_id))
            and 1 <= slot_number <= self.max_target_slots
        }

        for slot_number in range(1, self.max_target_slots + 1):
            if slot_number not in used_slot_numbers:
                return f"target-{slot_number}"
        return None

    def create_tracker_slot(self) -> Dict[str, Any]:
        """Create a new tracker slot id without assigning a rotator."""
        tracker_id = self._allocate_target_tracker_id()
        if not tracker_id:
            return self._build_tracker_slot_limit_error()
        return {
            "success": True,
            "tracker_id": tracker_id,
            "created": True,
        }

    def create_observation_tracker_slot(self, observation_id: str) -> Dict[str, Any]:
        """
        Create an observation-scoped tracker id (obs-*) that does not consume target slots.
        """
        observation_token = str(observation_id or "").strip()
        if not observation_token:
            observation_token = f"{int(time.time() * 1000)}"

        base_tracker_id = (
            observation_token
            if observation_token.startswith("obs-")
            else f"obs-{observation_token}"
        )
        base_tracker_id = require_tracker_id(base_tracker_id)

        known_tracker_ids = self._all_known_tracker_ids()
        tracker_id = base_tracker_id
        suffix = 2
        while tracker_id in known_tracker_ids:
            tracker_id = f"{base_tracker_id}-{suffix}"
            suffix += 1

        return {
            "success": True,
            "tracker_id": tracker_id,
            "created": True,
        }

    @staticmethod
    def _normalize_rotator_id(candidate: Optional[str]) -> Optional[str]:
        if candidate is None:
            return None
        normalized = str(candidate).strip()
        if not normalized or normalized == "none":
            return None
        return normalized

    def _build_process(self, tracker_id: str, queue_to_tracker: Queue, stop_event: MpEvent):
        normalized_id = require_tracker_id(tracker_id)
        hardware_connection = hardware.register_tracker(normalized_id)

        def run_tracking_task():
            title = f"Ground Station - SatelliteTracker[{normalized_id}]"
            setproctitle.setproctitle(title)
            multiprocessing.current_process().name = title

            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            try:
                tracker = SatelliteTracker(
                    queue_out=self.output_queue,
                    queue_in=queue_to_tracker,
                    stop_event=stop_event,
                    tracker_id=normalized_id,
                    hardware_client=HardwareClient(hardware_connection),
                )
                loop.run_until_complete(tracker.run())
            except Exception as e:
                logger.error("Error in tracker process '%s': %s", normalized_id, e)
                logger.exception(e)
            finally:
                loop.close()

        return multiprocessing.Process(
            target=run_tracking_task, name="Ground Station - SatelliteTracker"
        )

    def start_tracker(self, tracker_id: str) -> TrackerRuntime:
        normalized_id = require_tracker_id(tracker_id)
        existing = self.runtimes.get(normalized_id)
        if existing and existing.process.is_alive():
            return existing
        hardware.unregister_tracker(normalized_id)

        queue_to_tracker: Queue = multiprocessing.Queue()
        stop_event = multiprocessing.Event()
        process = self._build_process(normalized_id, queue_to_tracker, stop_event)
        process.start()
        hardware.tracker_started(normalized_id)

        runtime = TrackerRuntime(
            tracker_id=normalized_id,
            process=process,
            queue_to_tracker=queue_to_tracker,
            stop_event=stop_event,
        )
        self.runtimes[normalized_id] = runtime

        logger.info("Started tracker process '%s' with PID %s", normalized_id, process.pid)

        manager = self.managers.get(normalized_id)
        if manager is None:
            manager = TrackerManager(queue_to_tracker=queue_to_tracker, tracker_id=normalized_id)
            self.managers[normalized_id] = manager
        else:
            manager.queue_to_tracker = queue_to_tracker

        return runtime

    @staticmethod
    def _terminate_tracker_process(runtime: TrackerRuntime) -> bool:
        """Terminate a tracker process and escalate to kill when necessary."""
        if not runtime.process.is_alive():
            return True

        try:
            runtime.process.terminate()
        except Exception:
            logger.exception("Failed terminating tracker process '%s'", runtime.tracker_id)
        runtime.process.join(timeout=0.3)

        if runtime.process.is_alive():
            try:
                runtime.process.kill()
            except Exception:
                logger.exception("Failed killing tracker process '%s'", runtime.tracker_id)
            runtime.process.join(timeout=0.3)

        if runtime.process.is_alive():
            logger.error(
                "Tracker process '%s' is still alive after kill; deferring cleanup",
                runtime.tracker_id,
            )
            return False
        return True

    def _force_stop_tracker(
        self,
        runtime: TrackerRuntime,
        *,
        defer_if_writer_busy: bool = True,
    ) -> bool:
        """Force-stop a worker while preserving its output pipe when still in use."""
        write_lock = getattr(self.output_queue, "_wlock", None)
        if write_lock is None:
            if not defer_if_writer_busy:
                logger.warning(
                    "Tracker output queue has no writer lock; forcing shutdown of '%s'",
                    runtime.tracker_id,
                )
                return self._terminate_tracker_process(runtime)
            logger.error(
                "Tracker process '%s' cannot be stopped safely: output queue has no writer lock",
                runtime.tracker_id,
            )
            return False

        try:
            lock_timeout = self.OUTPUT_QUEUE_LOCK_TIMEOUT_SECONDS if defer_if_writer_busy else 0
            lock_acquired = write_lock.acquire(timeout=lock_timeout)
        except Exception:
            logger.exception(
                "Failed acquiring the tracker output queue lock for '%s'",
                runtime.tracker_id,
            )
            if not defer_if_writer_busy:
                return self._terminate_tracker_process(runtime)
            return False

        if not lock_acquired:
            # A Queue message spans multiple pipe writes when its payload is large. Killing
            # its producer while the writer lock is held can strand an incomplete message;
            # the next reader then blocks the main event loop waiting for bytes that will
            # never arrive. Leaving one stopping worker alive is safer than corrupting the
            # output channel shared by every tracker.
            if defer_if_writer_busy:
                logger.error(
                    "Tracker process '%s' still owns the output queue writer; deferring forced stop",
                    runtime.tracker_id,
                )
                return False

            # During application shutdown there will be no future queue reader to
            # protect. The child must exit so multiprocessing cannot hold the
            # interpreter open after cleanup has completed.
            logger.warning(
                "Tracker process '%s' still owns the output queue writer; forcing shutdown",
                runtime.tracker_id,
            )
            return self._terminate_tracker_process(runtime)

        try:
            return self._terminate_tracker_process(runtime)
        finally:
            write_lock.release()

    def stop_tracker(
        self,
        tracker_id: str,
        timeout: float = 3.0,
        *,
        defer_if_writer_busy: bool = True,
    ) -> bool:
        normalized_id = require_tracker_id(tracker_id)
        runtime = self.runtimes.get(normalized_id)
        if not runtime:
            # Keep ownership maps consistent even when runtime is already gone.
            hardware.unregister_tracker(normalized_id)
            self._release_rotator_ownership(normalized_id)
            return True

        stopped = not runtime.process.is_alive()
        if not stopped:
            runtime.stop_event.set()
            runtime.process.join(timeout=timeout)
            stopped = not runtime.process.is_alive()
            if not stopped:
                logger.warning(
                    "Tracker process '%s' did not exit within %.1fs; requesting forced stop",
                    normalized_id,
                    timeout,
                )
                stopped = self._force_stop_tracker(
                    runtime,
                    defer_if_writer_busy=defer_if_writer_busy,
                )

        if not stopped:
            return False

        # Avoid queue finalizer hangs during teardown.
        try:
            runtime.queue_to_tracker.cancel_join_thread()
            runtime.queue_to_tracker.close()
        except Exception:
            pass
        self.runtimes.pop(normalized_id, None)
        hardware.unregister_tracker(normalized_id)
        self._release_rotator_ownership(normalized_id)
        return True

    def stop_all(self, timeout: float = 3.0) -> None:
        # Let every worker begin its graceful shutdown before waiting on any one
        # of them. This prevents later workers from losing the whole timeout while
        # an earlier worker is stuck.
        for runtime in self.runtimes.values():
            runtime.stop_event.set()

        for tracker_id in list(self.runtimes.keys()):
            # The shared output queue is discarded after global shutdown. Never
            # leave a non-daemon child alive merely to preserve that queue.
            self.stop_tracker(
                tracker_id,
                timeout=timeout,
                defer_if_writer_busy=False,
            )

    def remove_tracker(self, tracker_id: str, timeout: float = 3.0) -> Dict[str, Any]:
        normalized_id = require_tracker_id(tracker_id)
        if not self.stop_tracker(normalized_id, timeout=timeout):
            return {
                "success": False,
                "error": "tracker_stop_deferred",
                "message": (f"Tracker '{normalized_id}' is still stopping; retry removal shortly"),
                "tracker_id": normalized_id,
            }
        self.managers.pop(normalized_id, None)
        # Repeat the repair after manager removal so partially inconsistent maps
        # cannot leave hardware reserved by a tracker that no longer exists.
        self._release_rotator_ownership(normalized_id)
        return {"success": True, "tracker_id": normalized_id}

    def get_runtime(self, tracker_id: str) -> Optional[TrackerRuntime]:
        return self.runtimes.get(require_tracker_id(tracker_id))

    def get_or_create_manager(self, tracker_id: str) -> TrackerManager:
        normalized_id = require_tracker_id(tracker_id)
        runtime = self.get_runtime(normalized_id)
        if runtime is None or not runtime.process.is_alive():
            runtime = self.start_tracker(normalized_id)

        manager = self.managers.get(normalized_id)
        if manager is None:
            manager = TrackerManager(
                queue_to_tracker=runtime.queue_to_tracker,
                tracker_id=normalized_id,
            )
            self.managers[normalized_id] = manager
        else:
            manager.queue_to_tracker = runtime.queue_to_tracker
        return manager

    def get_all_tracker_ids(self) -> list[str]:
        return sorted(self.runtimes.keys())

    def is_alive(self, tracker_id: str) -> bool:
        runtime = self.get_runtime(tracker_id)
        return bool(runtime and runtime.process and runtime.process.is_alive())

    def get_managers(self) -> Dict[str, TrackerManager]:
        return dict(self.managers)

    def _release_rotator_ownership(self, tracker_id: str) -> None:
        """Remove both sides of every rotator assignment owned by a tracker."""
        normalized_tracker_id = require_tracker_id(tracker_id)
        assigned_rotator_id = self.tracker_rotator_map.pop(normalized_tracker_id, None)
        if (
            assigned_rotator_id
            and self.rotator_tracker_map.get(assigned_rotator_id) == normalized_tracker_id
        ):
            self.rotator_tracker_map.pop(assigned_rotator_id, None)

        # Repair orphaned reverse entries too. These entries are invisible in the
        # tracker list but otherwise keep rejecting a rotator as already in use.
        orphaned_rotator_ids = [
            rotator_id
            for rotator_id, owner_tracker_id in self.rotator_tracker_map.items()
            if owner_tracker_id == normalized_tracker_id
        ]
        for rotator_id in orphaned_rotator_ids:
            self.rotator_tracker_map.pop(rotator_id, None)

    def _get_consistent_rotator_owner(self, rotator_id: str) -> Optional[str]:
        """Return the owner after discarding an orphaned reverse assignment."""
        owner_tracker_id = self.rotator_tracker_map.get(rotator_id)
        if owner_tracker_id and self.tracker_rotator_map.get(owner_tracker_id) != rotator_id:
            logger.warning(
                "Discarding stale rotator ownership: rotator '%s' references removed tracker '%s'",
                rotator_id,
                owner_tracker_id,
            )
            self.rotator_tracker_map.pop(rotator_id, None)
            return None
        return owner_tracker_id

    def assign_rotator(self, tracker_id: str, rotator_id: Optional[str]) -> Dict[str, Any]:
        normalized_tracker_id = require_tracker_id(tracker_id)
        normalized_rotator_id = self._normalize_rotator_id(rotator_id)
        previous_rotator_id = self.tracker_rotator_map.get(normalized_tracker_id)

        if previous_rotator_id == normalized_rotator_id:
            return {
                "success": True,
                "tracker_id": normalized_tracker_id,
                "rotator_id": normalized_rotator_id,
                "previous_rotator_id": previous_rotator_id,
            }

        if normalized_rotator_id:
            owner_tracker_id = self._get_consistent_rotator_owner(normalized_rotator_id)
            if owner_tracker_id and owner_tracker_id != normalized_tracker_id:
                return {
                    "success": False,
                    "error": "rotator_in_use",
                    "tracker_id": normalized_tracker_id,
                    "rotator_id": normalized_rotator_id,
                    "owner_tracker_id": owner_tracker_id,
                    "previous_rotator_id": previous_rotator_id,
                }

        if previous_rotator_id:
            self.rotator_tracker_map.pop(previous_rotator_id, None)

        if normalized_rotator_id:
            self.rotator_tracker_map[normalized_rotator_id] = normalized_tracker_id
            self.tracker_rotator_map[normalized_tracker_id] = normalized_rotator_id
        else:
            self.tracker_rotator_map.pop(normalized_tracker_id, None)

        return {
            "success": True,
            "tracker_id": normalized_tracker_id,
            "rotator_id": normalized_rotator_id,
            "previous_rotator_id": previous_rotator_id,
        }

    def swap_rotators(self, tracker_a_id: str, tracker_b_id: str) -> Dict[str, Any]:
        normalized_tracker_a_id = require_tracker_id(tracker_a_id)
        normalized_tracker_b_id = require_tracker_id(tracker_b_id)

        if normalized_tracker_a_id == normalized_tracker_b_id:
            rotator_id = self.tracker_rotator_map.get(normalized_tracker_a_id)
            return {
                "success": True,
                "tracker_a_id": normalized_tracker_a_id,
                "tracker_b_id": normalized_tracker_b_id,
                "tracker_a_rotator_id": rotator_id,
                "tracker_b_rotator_id": rotator_id,
                "previous_tracker_a_rotator_id": rotator_id,
                "previous_tracker_b_rotator_id": rotator_id,
            }

        tracker_a_rotator_id = self.tracker_rotator_map.get(normalized_tracker_a_id)
        tracker_b_rotator_id = self.tracker_rotator_map.get(normalized_tracker_b_id)

        if tracker_b_rotator_id:
            self.tracker_rotator_map[normalized_tracker_a_id] = tracker_b_rotator_id
            self.rotator_tracker_map[tracker_b_rotator_id] = normalized_tracker_a_id
        else:
            self.tracker_rotator_map.pop(normalized_tracker_a_id, None)

        if tracker_a_rotator_id:
            self.tracker_rotator_map[normalized_tracker_b_id] = tracker_a_rotator_id
            self.rotator_tracker_map[tracker_a_rotator_id] = normalized_tracker_b_id
        else:
            self.tracker_rotator_map.pop(normalized_tracker_b_id, None)

        return {
            "success": True,
            "tracker_a_id": normalized_tracker_a_id,
            "tracker_b_id": normalized_tracker_b_id,
            "tracker_a_rotator_id": tracker_b_rotator_id,
            "tracker_b_rotator_id": tracker_a_rotator_id,
            "previous_tracker_a_rotator_id": tracker_a_rotator_id,
            "previous_tracker_b_rotator_id": tracker_b_rotator_id,
        }

    def get_assigned_rotator(self, tracker_id: str) -> Optional[str]:
        return self.tracker_rotator_map.get(require_tracker_id(tracker_id))

    def get_assigned_tracker_for_rotator(self, rotator_id: Optional[str]) -> Optional[str]:
        normalized_rotator_id = self._normalize_rotator_id(rotator_id)
        if not normalized_rotator_id:
            return None
        return self._get_consistent_rotator_owner(normalized_rotator_id)

    def ensure_tracker_for_rotator(self, rotator_id: Optional[str]) -> Dict[str, Any]:
        """Resolve owner tracker for rotator, creating a new target-N slot when missing."""
        normalized_rotator_id = self._normalize_rotator_id(rotator_id)
        if not normalized_rotator_id:
            return {
                "success": False,
                "error": "invalid_rotator_id",
                "message": "rotator_id is required to resolve tracker ownership",
            }

        owner_tracker_id = self._get_consistent_rotator_owner(normalized_rotator_id)
        if owner_tracker_id:
            return {
                "success": True,
                "tracker_id": owner_tracker_id,
                "rotator_id": normalized_rotator_id,
                "created": False,
            }

        tracker_id = self._allocate_target_tracker_id()
        if not tracker_id:
            return self._build_tracker_slot_limit_error()
        assignment_result = self.assign_rotator(tracker_id, normalized_rotator_id)
        if not assignment_result.get("success"):
            return dict(assignment_result)

        return {
            "success": True,
            "tracker_id": tracker_id,
            "rotator_id": normalized_rotator_id,
            "created": True,
        }

    def _tracker_sort_key(self, tracker_id: str) -> tuple[int, int, str]:
        slot_number = self._parse_target_slot_number(tracker_id)
        if slot_number is not None:
            return (0, slot_number, tracker_id)
        if tracker_id.startswith("obs-"):
            return (1, 0, tracker_id)
        return (2, 0, tracker_id)

    def get_instances_payload(self) -> Dict[str, Any]:
        tracker_ids = sorted(self._all_known_tracker_ids(), key=self._tracker_sort_key)
        instances: list[Dict[str, Any]] = []
        for tracker_id in tracker_ids:
            runtime = self.runtimes.get(tracker_id)
            manager = self.managers.get(tracker_id)
            target_number = self._parse_target_slot_number(tracker_id)
            tracking_state = (
                dict(manager.current_tracking_state)
                if manager and manager.current_tracking_state
                else {}
            )
            instances.append(
                {
                    "tracker_id": tracker_id,
                    "target_number": target_number,
                    "rotator_id": self.tracker_rotator_map.get(tracker_id),
                    "is_alive": bool(runtime and runtime.process and runtime.process.is_alive()),
                    "pid": runtime.process.pid if runtime and runtime.process else None,
                    "tracking_state": tracking_state,
                }
            )

        return {
            "instances": instances,
            "updated_at": time.time(),
        }


_tracker_supervisor = TrackerSupervisor()

queue_from_tracker: Queue = _tracker_supervisor.output_queue


def start_tracker_process(tracker_id: str):
    normalized_id = require_tracker_id(tracker_id)
    runtime = _tracker_supervisor.start_tracker(normalized_id)
    return runtime.process, runtime.queue_to_tracker, queue_from_tracker, runtime.stop_event


def stop_tracker_process(tracker_id: str, timeout: float = 3.0) -> bool:
    return _tracker_supervisor.stop_tracker(tracker_id, timeout=timeout)


def stop_all_tracker_processes(timeout: float = 3.0) -> None:
    _tracker_supervisor.stop_all(timeout=timeout)


def get_tracker_manager(tracker_id: str) -> TrackerManager:
    manager = _tracker_supervisor.get_or_create_manager(tracker_id)
    return manager


def get_existing_tracker_manager(tracker_id: str) -> Optional[TrackerManager]:
    normalized_id = require_tracker_id(tracker_id)
    return _tracker_supervisor.get_managers().get(normalized_id)


def remove_tracker_instance(tracker_id: str, timeout: float = 3.0) -> Dict[str, Any]:
    return _tracker_supervisor.remove_tracker(tracker_id, timeout=timeout)


def get_tracker_supervisor() -> TrackerSupervisor:
    return _tracker_supervisor


def assign_rotator_to_tracker(tracker_id: str, rotator_id: Optional[str]) -> Dict[str, Any]:
    return _tracker_supervisor.assign_rotator(tracker_id, rotator_id)


def restore_tracker_rotator_assignment(tracker_id: str, rotator_id: Optional[str]) -> None:
    _tracker_supervisor.assign_rotator(tracker_id, rotator_id)


def get_assigned_rotator_for_tracker(tracker_id: str) -> Optional[str]:
    return _tracker_supervisor.get_assigned_rotator(tracker_id)


def get_assigned_tracker_for_rotator(rotator_id: Optional[str]) -> Optional[str]:
    return _tracker_supervisor.get_assigned_tracker_for_rotator(rotator_id)


def ensure_tracker_for_rotator(rotator_id: Optional[str]) -> Dict[str, Any]:
    return _tracker_supervisor.ensure_tracker_for_rotator(rotator_id)


def create_tracker_slot() -> Dict[str, Any]:
    return _tracker_supervisor.create_tracker_slot()


def create_observation_tracker_slot(observation_id: str) -> Dict[str, Any]:
    return _tracker_supervisor.create_observation_tracker_slot(observation_id)


def swap_rotators_between_trackers(tracker_a_id: str, tracker_b_id: str) -> Dict[str, Any]:
    return _tracker_supervisor.swap_rotators(tracker_a_id, tracker_b_id)


def get_tracker_instances_payload() -> Dict[str, Any]:
    return _tracker_supervisor.get_instances_payload()


def get_all_tracker_managers() -> Dict[str, TrackerManager]:
    return _tracker_supervisor.get_managers()
