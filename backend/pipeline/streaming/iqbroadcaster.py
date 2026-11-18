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

from __future__ import annotations

import logging
import multiprocessing
import queue
import threading
import time
from dataclasses import asdict
from typing import Any, Dict, Optional, Union

from common.streamqueue import StreamQueue
from monitoring.timing import TimingCollector, timestamp_ns
from vfos.state import VFOManager


class IQBroadcaster(threading.Thread):
    """
    Reads IQ samples from a single source queue (multiprocessing.Queue from SDR worker)
    and broadcasts copies to multiple subscriber queues (one per active demodulator).

    This allows multiple VFOs/demodulators to process the same IQ samples simultaneously
    without gaps, as each gets its own complete copy of the sample stream.

    The broadcaster runs as a daemon thread and will automatically stop when the
    main process exits.
    """

    def __init__(self, source_queue, sdr_id: str):
        """
        Initialize the IQ broadcaster.

        Args:
            source_queue: The multiprocessing.Queue to read IQ samples from (from SDR worker)
            sdr_id: Identifier for this SDR device (used for logging)
        """
        super().__init__(daemon=True, name=f"IQBroadcaster-{sdr_id}")
        self.source_queue = source_queue
        self.sdr_id = sdr_id
        self.subscribers: Dict[str, dict] = {}  # session_id -> {queue, delivered, dropped}
        self.running = True
        self.lock = threading.Lock()
        self.logger = logging.getLogger("iq-broadcaster")

        # VFO state manager for injecting VFO states into IQ messages
        self.vfo_manager = VFOManager()

        # Performance monitoring stats
        self.stats: Dict[str, Any] = {
            "messages_in": 0,
            "messages_broadcast": 0,
            "messages_dropped": 0,
            "queue_timeouts": 0,
            "last_activity": None,
            "errors": 0,
        }
        self.stats_lock = threading.Lock()
        self.timing = TimingCollector()

    def subscribe(
        self,
        session_id: str,
        maxsize: int = 50,
        for_process: bool = False,
        session_id_hint: Optional[str] = None,
    ) -> Union[queue.Queue[Any], multiprocessing.Queue[Any]]:
        """
        Create a new subscriber queue for a session.

        Args:
            session_id: Session identifier (client session ID)
            maxsize: Maximum size of the subscriber queue (default: 50)
                    If the demodulator can't keep up and the queue fills,
                    new samples will be dropped for that subscriber.
            for_process: If True, creates multiprocessing.Queue for Process subscribers.
                        Use this when subscriber is a multiprocessing.Process rather than
                        a threading.Thread. Default: False (threading queue)
            session_id_hint: Optional canonical session ID used for metadata enrichment.

        Returns:
            Queue that will receive copies of IQ samples (threading or multiprocessing)
        """
        with self.lock:
            if not self.running:
                raise RuntimeError("IQ broadcaster is stopping")
            if session_id not in self.subscribers:
                # Create appropriate queue type based on subscriber needs
                subscriber_queue: Union[queue.Queue[Any], multiprocessing.Queue[Any]]
                if for_process:
                    subscriber_queue = StreamQueue(maxsize=maxsize)
                    queue_type = "multiprocessing"
                else:
                    subscriber_queue = queue.Queue(maxsize=maxsize)
                    queue_type = "threading"

                resolved_session_id = session_id_hint or self._extract_session_id(session_id)
                if not resolved_session_id:
                    resolved_session_id = session_id
                self.subscribers[session_id] = {
                    "queue": subscriber_queue,
                    "session_id": resolved_session_id,
                    "maxsize": maxsize,
                    "is_process_queue": for_process,
                    "delivered": 0,
                    "dropped": 0,
                }
                self.logger.info(
                    f"Subscribed session {session_id} (queue: {queue_type}, maxsize={maxsize})"
                )
            result: Union[queue.Queue[Any], multiprocessing.Queue[Any]] = self.subscribers[
                session_id
            ]["queue"]
            return result

    def unsubscribe(self, session_id: str):
        """
        Remove a subscriber queue.

        Args:
            session_id: Session identifier to unsubscribe
        """
        with self.lock:
            if session_id in self.subscribers:
                subscriber_info = self.subscribers[session_id]
                queue_size = self._safe_queue_size(subscriber_info["queue"])
                self.logger.info(
                    f"Unsubscribed session {session_id}: "
                    f"delivered={subscriber_info.get('delivered', 0)} "
                    f"dropped={subscriber_info.get('dropped', 0)} "
                    f"maxsize={subscriber_info.get('maxsize')} "
                    f"qsize={queue_size if queue_size is not None else 'unknown'}"
                )
                self._remove_subscriber(session_id)

    def _remove_subscriber(self, session_id: str) -> None:
        # Call under self.lock so fanout cannot publish to a discarded queue.
        subscriber = self.subscribers.pop(session_id)
        if subscriber.get("is_process_queue"):
            subscriber["queue"].discard()

    def get_subscriber_count(self) -> int:
        """
        Get the number of active subscribers.

        Returns:
            int: Number of active subscriber queues
        """
        with self.lock:
            return len(self.subscribers)

    def flush_all_queues(self):
        """
        Flush (empty) all subscriber queues.

        This is useful when sample rate changes, since all buffered data
        at the old sample rate becomes invalid.
        """
        with self.lock:
            for session_id, subscriber_info in self.subscribers.items():
                subscriber_queue = subscriber_info["queue"]
                flushed_count = 0
                while not subscriber_queue.empty():
                    try:
                        subscriber_queue.get_nowait()
                        flushed_count += 1
                    except queue.Empty:
                        break
                if flushed_count > 0:
                    self.logger.debug(
                        f"Flushed {flushed_count} items from queue for session {session_id}"
                    )

    def _extract_session_id(self, subscription_key: str) -> str:
        """
        Extract session_id from subscription key.

        Subscription keys have format:
        - "decoder:{session_id}:vfo{N}" for decoders
        - "recorder:{session_id}" for recorders
        - "demodulator:{session_id}:vfo{N}" for audio demodulators

        Args:
            subscription_key: Subscription key string

        Returns:
            Session ID or empty string if not found
        """
        # Pattern to extract session_id from various subscription key formats
        # Subscription keys are: "type:session_id:vfo" or "type:session_id"
        # For internal sessions: "decoder:internal:obs-123:vfo1" -> need "internal:obs-123"
        # For regular sessions: "decoder:regular-session-id:vfo1" -> need "regular-session-id"
        parts = subscription_key.split(":")
        if len(parts) < 2:
            return ""

        # Check if this is an internal session (has "internal:" prefix)
        if parts[1] == "internal":
            if len(parts) >= 4:
                # "decoder:internal:obs-123:vfo1" -> "internal:obs-123"
                # "decoder:internal:obs-123:uuid:vfo1" -> "internal:obs-123:uuid"
                if parts[3].startswith("vfo") and parts[3][3:].isdigit():
                    return f"{parts[1]}:{parts[2]}"
                return f"{parts[1]}:{parts[2]}:{parts[3]}"
            if len(parts) >= 3:
                # "decoder:internal:obs-123" -> "internal:obs-123"
                return f"{parts[1]}:{parts[2]}"
            return "internal"

        # Non-internal session IDs do not contain ':' in practice.
        return parts[1]

    def _safe_queue_size(self, q) -> Optional[int]:
        """Best-effort queue size retrieval for diagnostics."""
        if not hasattr(q, "qsize"):
            return None
        try:
            return int(q.qsize())
        except Exception:
            return None

    def _enrich_iq_message_with_vfo_states(
        self, iq_message: Dict[str, Any], session_id: str
    ) -> Dict[str, Any]:
        """
        Add VFO states to IQ message for the given session.

        Fetches all VFO states for the session from VFOManager and adds them
        to the IQ message. Each decoder can then extract its specific VFO state.

        Args:
            iq_message: Original IQ message from SDR worker
            session_id: Session ID to fetch VFO states for

        Returns:
            Enriched IQ message with vfo_states dict added
        """
        try:
            # Get all VFO states for this session (returns dict of {vfo_number: VFOState})
            vfo_states = self.vfo_manager.get_all_vfo_states(session_id)

            # Convert VFOState dataclasses to dicts for serialization
            vfo_states_dict = {}
            for vfo_number, vfo_state in vfo_states.items():
                vfo_states_dict[vfo_number] = asdict(vfo_state)

            # Add to IQ message
            iq_message["vfo_states"] = vfo_states_dict

        except Exception as e:
            # If we fail to get VFO states, log but don't crash the broadcaster
            # The decoder will handle missing vfo_states gracefully
            self.logger.debug(f"Failed to get VFO states for session {session_id}: {e}")
            iq_message["vfo_states"] = {}

        return iq_message

    def run(self):
        """
        Main broadcaster loop.

        Continuously reads IQ samples from the source queue and broadcasts
        copies to all subscriber queues. If a subscriber's queue is full,
        the sample is dropped for that subscriber only.
        """
        self.logger.info(f"IQ broadcaster started for SDR {self.sdr_id}")

        while self.running:
            try:

                # Get IQ samples from the SDR worker process
                # Use timeout to allow checking self.running periodically
                try:
                    iq_message = self.source_queue.get(timeout=0.1)

                    # Update stats
                    with self.stats_lock:
                        self.stats["messages_in"] += 1
                        self.stats["last_activity"] = time.time()

                except queue.Empty:
                    with self.stats_lock:
                        self.stats["queue_timeouts"] += 1
                    continue

                # All subscribers see the same monotonically increasing sequence.
                # A gap reveals a dropped queue item to stateful stream decoders.
                iq_message["iq_sequence"] = self.stats["messages_in"]

                # Broadcast to all subscribers
                fanout_started = self.timing.start()
                captured_at_ns = iq_message.get("pipeline_captured_at_ns")
                if captured_at_ns is not None:
                    self.timing.record_duration(
                        "source_queue_age", (time.perf_counter_ns() - captured_at_ns) / 1_000_000.0
                    )
                pipeline_started_ns = captured_at_ns or timestamp_ns()
                if pipeline_started_ns is not None:
                    # This marks the first in-process handoff. Workers run in
                    # separate processes, so this is the earliest common clock.
                    iq_message["pipeline_started_at_ns"] = pipeline_started_ns
                with self.lock:
                    dead_subscribers = []
                    for subscription_key, subscriber_info in self.subscribers.items():
                        subscriber_queue = subscriber_info["queue"]
                        is_process_queue = subscriber_info.get("is_process_queue", False)

                        # Extract session_id from subscription key and enrich message with VFO states
                        session_id = subscriber_info.get("session_id") or self._extract_session_id(
                            subscription_key
                        )
                        if session_id:
                            # Create enriched message with VFO states for this specific session
                            enriched_message = self._enrich_iq_message_with_vfo_states(
                                iq_message.copy(), session_id
                            )
                        else:
                            # Fallback if we can't extract session_id (shouldn't happen)
                            enriched_message = iq_message.copy()
                            enriched_message["vfo_states"] = {}

                        try:
                            enqueued_at_ns = timestamp_ns()
                            if enqueued_at_ns is not None:
                                enriched_message["iq_enqueued_at_ns"] = enqueued_at_ns
                            # Handle both threading and multiprocessing queues
                            if is_process_queue:
                                # Multiprocessing queue - use block=False
                                subscriber_queue.put(enriched_message, block=False)
                            else:
                                # Threading queue - use put_nowait()
                                subscriber_queue.put_nowait(enriched_message)

                            subscriber_info["delivered"] += 1
                            with self.stats_lock:
                                self.stats["messages_broadcast"] += 1

                        except (queue.Full, Exception) as e:
                            # Handle full queue for both types
                            if isinstance(e, queue.Full) or (
                                is_process_queue and "full" in str(e).lower()
                            ):
                                # Subscriber can't keep up - drop this sample
                                subscriber_info["dropped"] += 1
                                with self.stats_lock:
                                    self.stats["messages_dropped"] += 1
                            else:
                                # Mark subscriber for removal if there's an error
                                self.logger.warning(
                                    f"Error broadcasting to {subscription_key}: {e}"
                                )
                                dead_subscribers.append(subscription_key)

                    # Clean up dead subscribers
                    for dead_key in dead_subscribers:
                        self._remove_subscriber(dead_key)
                        self.logger.info(f"Removed dead subscriber {dead_key}")

                self.timing.record_since("fanout", fanout_started)

            except Exception as e:
                if self.running:
                    self.logger.error(f"Error in broadcaster loop: {e}")
                    self.logger.exception(e)
                    with self.stats_lock:
                        self.stats["errors"] += 1

        self.logger.info(f"IQ broadcaster stopped for SDR {self.sdr_id}")

    def stop(self):
        """
        Stop the broadcaster thread.
        """
        with self.lock:
            self.running = False
            # Also release subscriptions left by failed consumer cleanup.
            for session_id in list(self.subscribers):
                self._remove_subscriber(session_id)
        self.logger.info(f"Stopping IQ broadcaster for SDR {self.sdr_id}")
