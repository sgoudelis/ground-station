# Copyright (c) 2026 Efstratios Goudelis
"""Worker-owned operation execution and causally related completion events."""

import copy
import os
import time
import uuid

from tracker.contracts import requests_rotator_motion


class WorkerOperations:
    def __init__(self, tracker):
        self.tracker = tracker
        self.pending = {}
        self.cancelled = set()
        self.sequence = 0
        self.epoch = None
        self.generation = str(uuid.uuid4())
        self.started_at = time.time()
        # Last hardware snapshot content that was published, for change detection.
        self._last_published = None
        self._last_published_at = 0.0

    def snapshot(self):
        self.sequence += 1
        return {
            "tracker_id": self.tracker.tracker_id,
            "worker_epoch": self.epoch,
            "worker_generation": self.generation,
            "worker_pid": os.getpid(),
            "worker_started_at": self.started_at,
            "sequence": self.sequence,
            "observed_at": time.time(),
            "tracking_state": dict(self.tracker.input_tracking_state or {}),
            "rotator_data": self.tracker.rotator_data.copy(),
            "rig_data": copy.deepcopy(self.tracker.rig_data),
        }

    def emit(self, operation, status, reason=None, *, reconciled=False):
        self.tracker.queue_out.put(
            {
                "event": "tracker-command-status",
                "data": {
                    "command_id": operation["command_id"],
                    "status": status,
                    "epoch": operation["epoch"],
                    "worker_generation": self.generation,
                    "reason": reason,
                    **({"reconciled": True} if reconciled else {}),
                    **({"snapshot": self.snapshot()} if status != "started" else {}),
                },
            }
        )

    def accept(self, payload):
        operation = payload.get("operation")
        if operation:
            self.epoch = operation["epoch"]
            if operation["command_id"] in self.cancelled:
                self.emit(operation, "cancelled", "Superseded by Stop")
                return
            if time.time() > operation["deadline"]:
                self.emit(operation, "failed", "Command expired before execution")
                return
            if self.tracker.rotator_data.get("motion_unconfirmed") and requests_rotator_motion(
                operation["action"], operation["changes"]
            ):
                # The worker is authoritative even when a browser/supervisor has
                # not received the latest motion observation yet.
                self.emit(
                    operation,
                    "failed",
                    "Rotator motion is unconfirmed; wait for stationary position readings",
                )
                return
            is_stop = (
                operation["action"] == "stop"
                or operation["changes"].get("rotator_state") == "stopped"
            )
            if is_stop:
                self.cancelled.update(operation.get("supersedes", []))
                for key, previous in list(self.pending.items()):
                    if set(operation["scopes"]).intersection(previous["scopes"]):
                        self.cancelled.add(key)
                        self.emit(previous, "cancelled", "Superseded by Stop")
                        del self.pending[key]
                if "rotator" in operation["scopes"]:
                    self.tracker.manual_rotator_target = None
                    self.tracker.nudge_offset = {"az": 0, "el": 0}
        previous_state = dict(self.tracker.input_tracking_state or {})
        for message in payload.get("messages", []):
            if operation and previous_state and message.get("type") == "set_tracking_state":
                # A rig request may have been prepared before the worker stopped
                # or failed the rotator. Apply only this operation's fields so
                # its full context cannot resurrect unrelated hardware work.
                message = {
                    **message,
                    "payload": {
                        **(self.tracker.input_tracking_state or {}),
                        **operation["changes"],
                    },
                }
            self.tracker.apply_input_message(message)
        if operation:
            self.pending[operation["command_id"]] = {
                **operation,
                "begun": False,
                "settle_hits": 0,
                "previous_state": previous_state,
            }

    def cancel(self, command_id):
        self.cancelled.add(command_id)
        operation = self.pending.get(command_id)
        if not operation:
            return
        if (
            operation.get("begun")
            and operation["changes"].get("rotator_state") == "stopped"
            and self.tracker.rotator_handler.stop_result
        ):
            # S already ran. Expiry must not silently issue it again or turn an
            # acknowledged but still moving mount into a successful Stop.
            self.pending.pop(command_id)
            self.emit(
                operation,
                "unknown",
                "Stop did not confirm stationary motion before its deadline; tracking remains paused",
                reconciled=True,
            )
            return
        if operation.get("begun") and "rotator" in operation["scopes"]:
            # Keep the operation outstanding until the physical Stop has run.
            # An early terminal event could otherwise unlock a new Move that
            # the old Stop would immediately discard.
            operation["cancelling"] = True
            operation["stop_deadline"] = time.time() + 30
            self.tracker.rotator_handler.stop_result = None
            self.tracker.input_tracking_state["rotator_state"] = "stopped"
            self.tracker.prev_rotator_state = None
            self.tracker.manual_rotator_target = None
            return
        if not operation.get("begun"):
            for field, value in operation["changes"].items():
                if self.tracker.input_tracking_state.get(field) == value:
                    self.tracker.input_tracking_state[field] = operation["previous_state"].get(
                        field
                    )
        self.pending.pop(command_id)
        self.emit(operation, "cancelled", "Command deadline exceeded")

    def begin_cycle(self):
        self.tracker.rotator_position_fresh = False
        self.tracker.rig_frequency_fresh = False
        state = self.tracker.input_tracking_state or {}
        for key, operation in list(self.pending.items()):
            if operation.get("cancelling"):
                if time.time() > operation["stop_deadline"]:
                    self.pending.pop(key)
                    self.emit(
                        operation,
                        "unknown",
                        "Cancellation could not confirm stationary motion; tracking remains paused",
                        reconciled=True,
                    )
                continue
            if time.time() > operation["deadline"]:
                self.cancel(key)
                continue
            if any(
                state.get(f"{scope}_id") != device
                for scope, device in operation["device_ids"].items()
            ):
                self.emit(operation, "cancelled", "Device assignment changed")
                del self.pending[key]
                continue
            if any(state.get(field) != value for field, value in operation["changes"].items()):
                self.emit(operation, "cancelled", "Tracking state changed before completion")
                del self.pending[key]
                continue
            if operation["action"] == "move" and state.get("rotator_state") not in {
                "connected",
                "stopped",
            }:
                self.tracker.manual_rotator_target = None
                self.emit(operation, "cancelled", "Manual movement superseded by mode change")
                del self.pending[key]
                continue
            if operation["begun"]:
                continue
            operation["begun"] = True
            self.emit(operation, "started")
            # Repeated desired states still have a real execution result (for
            # example retrying Connect after a failed connection).
            for scope in ("rotator", "rig"):
                if f"{scope}_state" in operation["changes"]:
                    setattr(self.tracker, f"prev_{scope}_state", None)
            if operation["action"] == "move":
                self.tracker.manual_rotator_target = dict(operation["position"])
            elif operation["action"] == "stop" and "rotator" in operation["scopes"]:
                self.tracker.rotator_handler.stop_result = None
                self.tracker.input_tracking_state["rotator_state"] = "stopped"
                self.tracker.prev_rotator_state = None

    def finish_cycle(self):
        state = self.tracker.input_tracking_state or {}
        for key, operation in list(self.pending.items()):
            if not operation["begun"]:
                continue
            stopping = "rotator" in operation["scopes"] and (
                operation["action"] == "stop"
                or operation["changes"].get("rotator_state") == "stopped"
                or operation.get("cancelling")
            )
            stop_result = self.tracker.rotator_handler.stop_result if stopping else None
            if stop_result and stop_result[0] != "succeeded":
                # Recovery is finished, but an unanswered S remains unconfirmed.
                # A hardware motion flag keeps movement locked independently of
                # the command registry, allowing Stop/Disconnect without polling forever.
                status, reason = stop_result
                self.emit(operation, status, reason, reconciled=status == "unknown")
                del self.pending[key]
                continue
            error = next(
                (
                    self.tracker.rotator_data.get("error_message") or "Rotator operation failed"
                    for scope in operation["scopes"]
                    if scope == "rotator" and self.tracker.rotator_data.get("error")
                ),
                None,
            )
            if "rig" in operation["scopes"] and self.tracker.rig_data.get("error"):
                error = self.tracker.rig_data.get("error_message") or "Rig operation failed"
            if error:
                if stopping and self.tracker.rotator_data.get("motion_unconfirmed"):
                    self.emit(
                        operation,
                        "unknown",
                        f"Physical Stop could not be verified: {error}",
                        reconciled=True,
                    )
                else:
                    self.emit(operation, "failed", error)
                del self.pending[key]
                continue
            if operation.get("cancelling"):
                if self.tracker.rotator_data.get("stopped"):
                    self.emit(operation, "cancelled", "Command deadline exceeded; movement stopped")
                    del self.pending[key]
                continue
            if operation["action"] == "move":
                position = operation["position"]
                at_target = (
                    self.tracker.rotator_position_fresh
                    and self.tracker.rotator_handler._target_within_tolerance(
                        self.tracker.rotator_data["az"],
                        self.tracker.rotator_data["el"],
                        position["az"],
                        position["el"],
                    )
                )
                operation["settle_hits"] = operation["settle_hits"] + 1 if at_target else 0
                complete = operation["settle_hits"] >= 2
            else:
                complete = all(
                    state.get(field) == value for field, value in operation["changes"].items()
                )
                for scope in ("rotator", "rig"):
                    desired = operation["changes"].get(f"{scope}_state")
                    if not desired:
                        continue
                    data = getattr(self.tracker, f"{scope}_data")
                    if desired == "disconnected":
                        complete &= data.get("connected") is False
                    elif desired == "stopped":
                        complete &= data.get("stopped") is True
                    else:
                        complete &= data.get("connected") is True
                        if desired in {"tracking", "stopped", "parked"}:
                            complete &= data.get(desired) is True or (
                                desired == "parked" and data.get("park_requested") is True
                            )
            if complete:
                reason = (
                    "Park command sent; hardware does not report arrival"
                    if self.tracker.rotator_data.get("park_requested")
                    and operation["changes"].get("rotator_state") == "parked"
                    else None
                )
                if stop_result:
                    reason = stop_result[1]
                self.emit(operation, "succeeded", reason)
                del self.pending[key]

    # Idle trackers must still prove they are alive: the UI marks hardware stale
    # after 15s without a snapshot, so repeat unchanged state well inside that.
    HEARTBEAT_SECONDS = 5.0

    def publish(self, force=False):
        # Every published snapshot costs the browser a full tracking-page
        # render, so skip the tick when nothing the UI shows has changed.
        current = (
            dict(self.tracker.input_tracking_state or {}),
            self.tracker.rotator_data,
            self.tracker.rig_data,
        )
        now = time.time()
        unchanged = self._last_published is not None and current == self._last_published
        if not force and unchanged and now - self._last_published_at < self.HEARTBEAT_SECONDS:
            return
        self._last_published = copy.deepcopy(current)
        self._last_published_at = now
        self.tracker.queue_out.put({"event": "tracker-hardware-state", "data": self.snapshot()})
