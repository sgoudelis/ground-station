# Ground Station - Audio Broadcaster
# Developed by Claude (Anthropic AI) for the Ground Station project
#
# This module implements a thread-safe pub/sub pattern for audio distribution.
# It receives audio from a single input queue (fed by demodulators) and broadcasts
# to multiple subscribers (playback, transcription, recording, etc.).
#
# Key features:
# - Runs in its own thread for non-blocking operation
# - Multiple independent subscribers with configurable queue sizes
# - Per-subscriber statistics and monitoring
# - Graceful handling of slow consumers (drop messages rather than block)
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
import traceback
from copy import deepcopy
from typing import Any, Dict, Optional, Union

from common.streamqueue import StreamQueue

# Configure logging
logger = logging.getLogger("audio-broadcaster")


class AudioBroadcaster(threading.Thread):
    """
    Thread-safe audio broadcaster using pub/sub pattern.

    Receives audio from single input queue and distributes to multiple
    subscriber queues. Each subscriber gets a copy of every audio message.
    """

    def __init__(
        self,
        input_queue: queue.Queue,
        session_id: Optional[str] = None,
        vfo_number: Optional[int] = None,
    ):
        """
        Initialize the audio broadcaster.

        Args:
            input_queue: Source queue that receives audio from demodulators
            session_id: Optional session identifier for logging
            vfo_number: Optional VFO number for logging
        """
        super().__init__(daemon=True, name="Ground Station - AudioBroadcaster")
        self.input_queue = input_queue
        self.subscribers: Dict[str, dict] = {}
        self.subscribers_lock = threading.Lock()
        self.running = True
        self.session_id = session_id
        self.vfo_number = vfo_number

        # Statistics
        self.stats: Dict[str, Any] = {
            "messages_received": 0,
            "messages_broadcast": 0,
            "errors": 0,
            "queue_timeouts": 0,
            "last_activity": None,
        }

    def subscribe(
        self, name: str, maxsize: int = 10, for_process: bool = False
    ) -> Union[queue.Queue[Any], multiprocessing.Queue[Any]]:
        """
        Subscribe to audio stream.

        Args:
            name: Subscriber name (e.g., "playback", "transcription")
            maxsize: Maximum queue size for this subscriber
            for_process: If True, creates multiprocessing.Queue for Process subscribers.
                        Use this when subscriber is a multiprocessing.Process rather than
                        a threading.Thread. Default: False (threading queue)

        Returns:
            Queue that will receive audio messages (threading or multiprocessing)
        """
        subscriber_queue: Union[queue.Queue[Any], multiprocessing.Queue[Any]]
        with self.subscribers_lock:
            if not self.running:
                raise RuntimeError("Audio broadcaster is stopping")
            # Create and replace under the fanout lock so stop() cannot miss a
            # newly allocated process queue or publish to the old one.
            if for_process:
                subscriber_queue = StreamQueue(maxsize=maxsize)
                queue_type = "multiprocessing"
            else:
                subscriber_queue = queue.Queue(maxsize=maxsize)
                queue_type = "threading"
            if name in self.subscribers:
                self._remove_subscriber(name)
            self.subscribers[name] = {
                "queue": subscriber_queue,
                "maxsize": maxsize,
                "is_process_queue": for_process,
                "delivered": 0,
                "dropped": 0,
                "errors": 0,
            }

        logger.info(
            f"New subscriber: '{name}' (queue: {queue_type}, size: {maxsize}, "
            f"total subscribers: {len(self.subscribers)})"
        )
        return subscriber_queue

    def subscribe_existing_queue(self, name: str, existing_queue: queue.Queue) -> None:
        """
        Subscribe an existing queue to audio stream.

        Useful when the caller already has a queue (e.g., for UI streaming)
        and wants to receive audio copies without creating an intermediate queue.

        Args:
            name: Subscriber name (e.g., "ui:session123")
            existing_queue: Pre-existing queue to receive audio messages
        """
        with self.subscribers_lock:
            if not self.running:
                raise RuntimeError("Audio broadcaster is stopping")
            if name in self.subscribers:
                self._remove_subscriber(name)
            self.subscribers[name] = {
                "queue": existing_queue,
                "maxsize": existing_queue._maxsize if hasattr(existing_queue, "_maxsize") else 0,
                "delivered": 0,
                "dropped": 0,
                "errors": 0,
            }

        logger.info(
            f"New subscriber with existing queue: '{name}' "
            f"(total subscribers: {len(self.subscribers)})"
        )

    def unsubscribe(self, name: str):
        """
        Unsubscribe from audio stream.

        Args:
            name: Subscriber name to remove
        """
        with self.subscribers_lock:
            if name in self.subscribers:
                self._remove_subscriber(name)
                logger.info(f"Subscriber removed: '{name}' (remaining: {len(self.subscribers)})")

    def _remove_subscriber(self, name: str) -> None:
        # Caller holds subscribers_lock. Existing queues belong to their caller;
        # only queues created for our process subscribers are ours to discard.
        subscriber = self.subscribers.pop(name)
        if subscriber.get("is_process_queue"):
            subscriber["queue"].discard()

    def run(self):
        """Main broadcast loop - runs in separate thread"""
        context = f"session={self.session_id}" if self.session_id else "unknown session"
        if self.vfo_number:
            context += f", VFO {self.vfo_number}"
        logger.info(f"Audio broadcaster started for {context} (id={id(self)})")

        while self.running:
            try:

                # Get audio from input queue (blocking with timeout)
                audio_message = self.input_queue.get(timeout=1.0)
                self.stats["messages_received"] += 1
                self.stats["last_activity"] = time.time()

                # Broadcast to all subscribers
                with self.subscribers_lock:
                    for name, subscriber in self.subscribers.items():
                        try:
                            # Create a copy for each subscriber to avoid shared state issues
                            message_copy = deepcopy(audio_message)

                            # Handle both threading and multiprocessing queues
                            subscriber_queue = subscriber["queue"]
                            is_process_queue = subscriber.get("is_process_queue", False)

                            if is_process_queue:
                                # Multiprocessing queue - use block=False
                                subscriber_queue.put(message_copy, block=False)
                            else:
                                # Threading queue - use put_nowait()
                                subscriber_queue.put_nowait(message_copy)

                            subscriber["delivered"] += 1
                            self.stats["messages_broadcast"] += 1

                        except (queue.Full, Exception) as e:
                            # Handle full queue for both types
                            if isinstance(e, queue.Full) or (
                                is_process_queue and "full" in str(e).lower()
                            ):
                                # Subscriber queue is full - drop message
                                subscriber["dropped"] += 1

                                # Log warning periodically
                                if subscriber["dropped"] % 100 == 0:
                                    logger.warning(
                                        f"Subscriber '{name}' queue full - "
                                        f"dropped {subscriber['dropped']} messages total"
                                    )
                            else:
                                # Other error
                                subscriber["errors"] += 1
                                self.stats["errors"] += 1
                                logger.error(f"Error broadcasting to '{name}': {e}")

                # Note: task_done() only exists on queue.Queue (threading), not multiprocessing.Queue
                # If input_queue is a threading queue, mark task as done for join() support
                if hasattr(self.input_queue, "task_done"):
                    self.input_queue.task_done()

            except queue.Empty:
                # No data available - continue waiting
                self.stats["queue_timeouts"] += 1
                continue

            except Exception as e:
                logger.error(f"Broadcaster error: {e}")
                self.stats["errors"] += 1

        context = f"session={self.session_id}" if self.session_id else "unknown session"
        if self.vfo_number:
            context += f", VFO {self.vfo_number}"
        logger.info(
            f"Audio broadcaster stopped for {context} (id={id(self)}, received={self.stats['messages_received']}, broadcast={self.stats['messages_broadcast']})"
        )

    def stop(self):
        """Stop the broadcaster thread"""
        context = f"session={self.session_id}" if self.session_id else "unknown session"
        if self.vfo_number:
            context += f", VFO {self.vfo_number}"

        # Get caller info for debugging
        caller_info = traceback.extract_stack()[-2]
        caller = f"{caller_info.filename.split('/')[-1]}:{caller_info.lineno} in {caller_info.name}"

        logger.info(
            f"Stopping audio broadcaster for {context} (id={id(self)}, called from: {caller})"
        )
        with self.subscribers_lock:
            self.running = False
            for name in list(self.subscribers):
                self._remove_subscriber(name)

    def get_stats(self) -> dict:
        """
        Get broadcaster statistics.

        Returns:
            Dictionary with overall stats and per-subscriber stats
        """
        with self.subscribers_lock:
            subscriber_stats = {
                name: {
                    "delivered": sub["delivered"],
                    "dropped": sub["dropped"],
                    "errors": sub["errors"],
                    "maxsize": sub["maxsize"],
                }
                for name, sub in self.subscribers.items()
            }

        return {
            "overall": self.stats.copy(),
            "subscribers": subscriber_stats,
            "active_subscribers": len(self.subscribers),
        }

    def log_stats(self):
        """Log current statistics"""
        stats = self.get_stats()
        logger.info(
            f"Broadcaster stats: "
            f"received={stats['overall']['messages_received']}, "
            f"broadcast={stats['overall']['messages_broadcast']}, "
            f"errors={stats['overall']['errors']}, "
            f"subscribers={stats['active_subscribers']}"
        )

        for name, sub_stats in stats["subscribers"].items():
            logger.info(
                f"  {name}: delivered={sub_stats['delivered']}, "
                f"dropped={sub_stats['dropped']}, errors={sub_stats['errors']}"
            )
