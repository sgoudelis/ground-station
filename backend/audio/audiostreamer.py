# Ground Station - Web Audio Consumer
# Developed by Claude (Anthropic AI) for the Ground Station project
#
# This module bridges the gap between demodulated audio (from FM/AM/SSB demodulators)
# and web clients via Socket.IO. It runs as a background thread that:
#
# 1. Consumes audio chunks from the shared audio_queue (fed by demodulators)
# 2. Applies per-session VFO settings (volume, active/mute state)
# 3. Routes audio only to the originating session (multi-user support)
# 4. Emits audio data to web clients via Socket.IO for real-time playback
# 5. Includes VFO state information with each audio packet
#
# This ensures each user hears only their own VFO's audio with their own
# volume settings, enabling multiple independent receivers on the same SDR hardware.
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
import queue
import threading
import time
from typing import Any, Dict

import numpy as np

from monitoring.timing import TimingCollector
from vfos.state import VFOManager

# Configure logging
logger = logging.getLogger("audio-streamer")


class WebAudioStreamer(threading.Thread):
    def __init__(self, audio_queue, sio, loop):
        super().__init__(daemon=True, name="Ground Station - WebAudioStreamer")
        self.audio_queue = audio_queue
        self.sio = sio
        self.loop = loop  # Pass the main event loop
        self.vfo_manager = VFOManager()  # Singleton VFO manager
        self.running = True

        # Performance monitoring stats
        self.stats: Dict[str, Any] = {
            "audio_chunks_in": 0,
            "audio_samples_in": 0,
            "messages_emitted": 0,
            "pending_emits": 0,
            "emit_errors": 0,
            "queue_timeouts": 0,
            "last_activity": None,
            "errors": 0,
        }
        self.stats_lock = threading.Lock()
        self.timing = TimingCollector()

        # Per-session activity tracking
        self.session_stats: Dict[str, Dict[str, Any]] = {}
        self.session_stats_lock = threading.Lock()

    def run(self):
        while self.running:
            try:
                # Get audio message from queue (now contains session_id and audio data)
                audio_message = self.audio_queue.get(timeout=1.0)

                audio_enqueued_at_ns = audio_message.get("audio_enqueued_at_ns")
                if audio_enqueued_at_ns is not None:
                    self.timing.record_duration(
                        "queue_age", (time.perf_counter_ns() - audio_enqueued_at_ns) / 1_000_000.0
                    )
                pipeline_started_at_ns = audio_message.get("pipeline_started_at_ns")
                if pipeline_started_at_ns is not None:
                    self.timing.record_duration(
                        "pipeline_age",
                        (time.perf_counter_ns() - pipeline_started_at_ns) / 1_000_000.0,
                    )
                processing_started = self.timing.start()

                # Update stats
                with self.stats_lock:
                    self.stats["audio_chunks_in"] += 1
                    self.stats["last_activity"] = time.time()

                # Extract session_id, audio chunk, and vfo_number from the message
                originating_session_id = audio_message.get("session_id")
                audio_chunk = audio_message.get("audio")
                vfo_number = audio_message.get("vfo_number")  # For multi-VFO support

                if originating_session_id is None or audio_chunk is None:
                    logger.warning("Received malformed audio message, skipping")
                    self.audio_queue.task_done()
                    continue

                # Update sample count
                with self.stats_lock:
                    self.stats["audio_samples_in"] += len(audio_chunk)

                # Only process audio for the originating session
                try:
                    # Get VFO state - vfo_number is required
                    if vfo_number is None:
                        logger.error(
                            f"vfo_number is required for audio routing (session {originating_session_id})"
                        )
                        self.audio_queue.task_done()
                        continue

                    vfo_state = self.vfo_manager.get_vfo_state(originating_session_id, vfo_number)

                    # Check if VFO exists
                    # Multi-VFO mode: stream all active VFOs simultaneously (removed 'selected' check)
                    if vfo_state is None:
                        self.audio_queue.task_done()
                        continue

                    # Process audio based on VFO settings
                    prepare_started = self.timing.start()
                    if vfo_state.active:
                        # Convert volume from the 0-100 range to 0.0-1.5 multiplier
                        volume_multiplier = vfo_state.volume / 100.0 * 1.5
                        processed_audio = audio_chunk * volume_multiplier
                    else:
                        # Skip if VFO is inactive (no need to send muted audio)
                        self.audio_queue.task_done()
                        continue

                    # Prepare VFO data for transmission
                    vfo_data = {
                        "center_freq": vfo_state.center_freq,
                        "bandwidth": vfo_state.bandwidth,
                        "modulation": vfo_state.modulation,
                        "active": vfo_state.active,
                        "selected": vfo_state.selected,
                        "volume": vfo_state.volume,
                        "squelch": vfo_state.squelch,
                        "vfo_number": vfo_state.vfo_number,
                    }

                    # Convert to Web Audio compatible format
                    # Ensure float32 format and proper range (-1.0 to 1.0)
                    processed_audio = processed_audio.astype(np.float32)
                    processed_audio = np.clip(processed_audio, -1.0, 1.0)
                    self.timing.record_since("prepare", prepare_started)

                    # Ship raw little-endian float32 PCM as a Socket.IO binary
                    # attachment. The browser wraps the ArrayBuffer in a
                    # Float32Array directly, so there is no JSON float parsing on
                    # the client's main thread (a JSON list was ~5x the bytes).
                    encode_started = self.timing.start()
                    sample_count = int(processed_audio.size)
                    audio_data = processed_audio.tobytes()
                    self.timing.record_since("encode", encode_started)

                    # Detect if audio is stereo (interleaved L/R) or mono
                    # Stereo demodulators produce interleaved samples: [L0, R0, L1, R1, ...]
                    # Mono demodulators produce: [M0, M1, M2, ...]
                    # We detect stereo by checking if modulation is FM_STEREO
                    is_stereo = vfo_state.modulation.upper() == "FM_STEREO"
                    channels = 2 if is_stereo else 1

                    # Schedule the emit() in the main event loop ONLY for the originating session
                    # Use fire-and-forget to avoid blocking the audio consumer thread
                    emit_started = self.timing.start()
                    with self.session_stats_lock:
                        session_stat = self.session_stats.setdefault(
                            originating_session_id,
                            {
                                "audio_chunks_in": 0,
                                "audio_samples_in": 0,
                                "messages_emitted": 0,
                                "pending_emits": 0,
                                "emit_errors": 0,
                                "last_activity": None,
                            },
                        )
                        session_stat["pending_emits"] += 1
                    with self.stats_lock:
                        self.stats["pending_emits"] += 1
                    emit_future = asyncio.run_coroutine_threadsafe(
                        self.sio.emit(
                            "audio-data",
                            {
                                "samples": audio_data,
                                "sample_rate": 44100,
                                "channels": channels,  # Mono (1) or Stereo (2)
                                "format": "float32",  # Little-endian float32 PCM bytes
                                # Number of samples (including both L and R for stereo)
                                "length": sample_count,
                                "vfo": vfo_data,
                                "session_id": originating_session_id,
                                "rf_power_db": audio_message.get(
                                    "rf_power_db"
                                ),  # RF power measurement
                                "rf_power_method": audio_message.get("rf_power_method"),
                                "squelch_debug": audio_message.get("squelch_debug"),
                            },
                            room=originating_session_id,
                        ),  # Emit ONLY to the originating session
                        self.loop,
                    )
                    self.timing.record_since("emit_schedule", emit_started)

                    def on_emit_complete(
                        future,
                        emit_started_ns=emit_started,
                        session_id=originating_session_id,
                    ):
                        # The future completes on the event loop, so this measures
                        # both local scheduling delay and Socket.IO emit work.
                        # Bind values from this specific emission. The callback can
                        # run after the streaming loop has begun processing another
                        # audio chunk for a different session.
                        self.timing.record_since("emit_completion", emit_started_ns)
                        failed = False
                        try:
                            future.result()
                        except Exception:
                            failed = True
                        with self.stats_lock:
                            self.stats["pending_emits"] = max(0, self.stats["pending_emits"] - 1)
                            if failed:
                                self.stats["emit_errors"] += 1
                        with self.session_stats_lock:
                            completed_stat = self.session_stats.get(session_id)
                            if completed_stat:
                                completed_stat["pending_emits"] = max(
                                    0, completed_stat.get("pending_emits", 0) - 1
                                )
                                if failed:
                                    completed_stat["emit_errors"] = (
                                        completed_stat.get("emit_errors", 0) + 1
                                    )

                    emit_future.add_done_callback(on_emit_complete)
                    # Don't wait for result - fire and forget to keep audio flowing

                    # Update stats
                    with self.stats_lock:
                        self.stats["messages_emitted"] += 1

                    # Update per-session stats
                    with self.session_stats_lock:
                        session_stat = self.session_stats[originating_session_id]
                        session_stat["audio_chunks_in"] += 1
                        session_stat["audio_samples_in"] += len(audio_chunk)
                        session_stat["messages_emitted"] += 1
                        session_stat["last_activity"] = time.time()

                    self.timing.record_since("processing", processing_started)

                except Exception as e:
                    logger.error(
                        f"Error processing audio for session {originating_session_id} when sending audio data: {e}"
                    )
                    with self.stats_lock:
                        self.stats["errors"] += 1

                # Mark the task as done after processing
                self.audio_queue.task_done()

            except queue.Empty:
                # Continue if no data available
                with self.stats_lock:
                    self.stats["queue_timeouts"] += 1
                continue
            except Exception as e:
                logger.error(f"Audio consumer error: {e}")
                continue

    def stop(self):
        self.running = False

    def cleanup_session(self, session_id: str):
        """Remove session stats when a session disconnects."""
        with self.session_stats_lock:
            if session_id in self.session_stats:
                del self.session_stats[session_id]
                logger.info(f"Cleaned up WebAudioStreamer stats for session: {session_id}")
