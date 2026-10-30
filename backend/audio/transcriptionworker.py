# Ground Station - Transcription Worker Base Class
# Developed by Claude (Anthropic AI) for the Ground Station project
#
# This module provides an abstract base class for transcription workers that
# stream audio to various speech-to-text APIs. It handles:
#
# 1. Audio buffering and queue management
# 2. Audio resampling and format conversion
# 3. Performance statistics tracking
# 4. Socket.IO event emissions to frontend
# 5. Thread lifecycle management
#
# Provider-specific implementations (Gemini, Deepgram, etc.) extend this class
# and implement the abstract methods for their specific API requirements.
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
import os
import queue
import threading
import time
import uuid
from abc import ABC, abstractmethod
from asyncio import Task
from concurrent.futures import Future
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, TextIO

import numpy as np
from langdetect import DetectorFactory, LangDetectException, detect_langs
from scipy import signal

from handlers.entities.filebrowser import emit_file_browser_state

DetectorFactory.seed = 0

# Configure logging
logger = logging.getLogger("transcription")


class TranscriptionWorker(ABC, threading.Thread):
    """
    Abstract base class for transcription workers.

    Handles common functionality like audio buffering, resampling, stats tracking,
    and Socket.IO events. Provider-specific implementations extend this class.
    """

    def __init__(
        self,
        transcription_queue,
        sio,
        loop,
        api_key: str,
        session_id: str,
        vfo_number: int,
        language: str = "auto",
        translate_to: str = "none",
        provider_name: str = "unknown",
        satellite: Optional[Dict[str, Any]] = None,
        transmitter: Optional[Dict[str, Any]] = None,
        output_dir: Optional[str] = None,
        translation_backend: str = "google",
    ):
        """
        Initialize the transcription worker.

        Args:
            transcription_queue: Queue receiving audio from per-VFO AudioBroadcaster
            sio: Socket.IO server instance for emitting to frontend
            loop: Asyncio event loop
            api_key: API key for the transcription service
            session_id: Session identifier
            vfo_number: VFO number (1-4)
            language: Source language code (e.g., "en", "es", "auto")
            translate_to: Target language code for translation (e.g., "en", "none")
            provider_name: Name of the provider (e.g., "gemini", "deepgram")
            satellite: Satellite information dict (optional)
            transmitter: Transmitter information dict (optional)
        """
        super().__init__(
            daemon=True,
            name=f"Ground Station - {provider_name.capitalize()}Worker-{session_id[:8]}-VFO{vfo_number}",
        )
        self.transcription_queue = transcription_queue
        self.sio = sio
        self.loop = loop  # Main server event loop (Socket.IO)
        self.api_key = api_key
        self.running = True
        self.provider_name = provider_name

        # VFO-specific settings (immutable after creation)
        self.session_id = session_id
        self.vfo_number = vfo_number
        # Status events from a replaced worker may arrive after its successor starts.
        self.decoder_id = f"transcription_{session_id}_{vfo_number}_{uuid.uuid4().hex}"
        self.worker_started_at = time.time()
        self.language = language
        self.translate_to = translate_to
        self.translation_backend = translation_backend
        self._last_translation_error = 0.0
        self._source_language_sample = ""
        self._last_detected_language: Optional[str] = None

        # Satellite and transmitter metadata
        self.satellite = satellite
        self.transmitter = transmitter
        # Scheduled observations pass their bundle's transcriptions directory here.
        # Manual sessions intentionally retain the established shared location.
        self.output_dir = output_dir

        # Audio buffer for this VFO (stores dicts with audio data and type)
        self.audio_buffer: List[Dict[str, Any]] = []

        # Streaming settings - configurable by subclasses
        self.chunk_duration = 3.0  # Send audio every 3 seconds for better context
        self.input_sample_rate = 44100  # Input from demodulators
        self.target_sample_rate = 16000  # Most APIs prefer 16kHz
        self.silence_threshold = 0.001  # RMS threshold for silence detection
        self.requires_api_key = True
        self.uses_receiver = True

        # Connection state
        self.connected: bool = False
        self.receiver_task: Optional[Task] = None
        self.provider_loop: Optional[asyncio.AbstractEventLoop] = None
        self.provider_loop_thread: Optional[threading.Thread] = None
        self._provider_loop_ready = threading.Event()

        # Connection backoff to prevent quota exhaustion
        self.last_connection_attempt = 0.0
        self.connection_backoff_seconds = 60

        # Performance monitoring stats
        self.stats: Dict[str, Any] = {
            "audio_chunks_in": 0,
            "audio_samples_in": 0,
            "transcriptions_sent": 0,
            "transcriptions_received": 0,
            "queue_timeouts": 0,
            "last_activity": None,
            "errors": 0,
            "connection_attempts": 0,
            "connection_failures": 0,
            "audio_samples_per_sec": 0.0,
            "audio_chunks_per_sec": 0.0,
            "is_connected": False,
            "audio_type": "unknown",
        }
        self.stats_lock = threading.Lock()

        # File output for transcriptions (created on first transcription)
        self.transcription_file: Optional[TextIO] = None
        self.transcription_file_path: Optional[str] = None
        self.transcription_file_created: bool = False

        # Word-level tracking for line building (matches UI logic)
        self.word_buffer: List[Dict[str, Any]] = []  # List of {word: str, timestamp: float}
        self.word_buffer_lock = threading.Lock()

        # Track last written text to avoid duplicates from partial/final updates
        self.last_written_text = ""

    def _start_provider_loop(self):
        """
        Start a dedicated asyncio event loop in a separate thread for transcription provider I/O.

        Why this exists:
        - The main server loop also drives Socket.IO and FFT delivery to clients.
        - Provider operations (connect/send/receive) can be bursty and, combined with
          CPU-heavy audio prep, can increase loop latency.
        - Running provider coroutines on an isolated loop prevents transcription work
          from contending with real-time SDR/FFT websocket emission on the main loop.

        Lifecycle:
        - Called once when the transcription worker thread starts.
        - Creates/stores `self.provider_loop`, then runs it forever in a helper thread.
        - Signals readiness via `_provider_loop_ready` so callers can safely schedule work.
        - Stopped by `_stop_provider_loop()` during worker shutdown.
        """
        if self.provider_loop and self.provider_loop.is_running():
            return

        # Reset readiness in case this worker restarts its provider loop.
        self._provider_loop_ready.clear()

        def _run_provider_loop():
            # Each thread needs its own event loop instance.
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            self.provider_loop = loop
            # Allow run() to begin scheduling provider coroutines safely.
            self._provider_loop_ready.set()
            loop.run_forever()
            loop.close()

        self.provider_loop_thread = threading.Thread(
            target=_run_provider_loop,
            daemon=True,
            name=(
                f"Ground Station - {self.provider_name.capitalize()}IOLoop-"
                f"{self.session_id[:8]}-VFO{self.vfo_number}"
            ),
        )
        self.provider_loop_thread.start()
        # Wait briefly so self.provider_loop is available before first schedule attempt.
        self._provider_loop_ready.wait(timeout=2.0)

    def _stop_provider_loop(self):
        """Stop dedicated provider I/O loop."""
        if self.provider_loop and self.provider_loop.is_running():
            self.provider_loop.call_soon_threadsafe(self.provider_loop.stop)

        if self.provider_loop_thread and self.provider_loop_thread.is_alive():
            self.provider_loop_thread.join(timeout=2.0)

        self.provider_loop = None
        self.provider_loop_thread = None
        self._provider_loop_ready.clear()

    async def _cleanup_provider_resources(self):
        """Cancel provider receiver and disconnect active provider session."""
        if self.receiver_task and not self.receiver_task.done():
            self.receiver_task.cancel()
            try:
                await self.receiver_task
            except asyncio.CancelledError:
                pass
            except Exception:
                pass
        self.receiver_task = None

        try:
            await self._disconnect()
        except Exception:
            pass

    async def _safe_sio_emit(self, event: str, payload: dict, room: Optional[str] = None):
        """Emit on main Socket.IO event loop from any thread/loop."""
        emit_coro = self.sio.emit(event, payload, room=room)

        try:
            current_loop = asyncio.get_running_loop()
        except RuntimeError:
            current_loop = None

        if current_loop is self.loop:
            await emit_coro
            return

        fut: Future = asyncio.run_coroutine_threadsafe(emit_coro, self.loop)
        await asyncio.wrap_future(fut)

    def _prepare_audio_payload(self, audio_data: np.ndarray) -> Any:
        """Provider preprocessing hook executed in the transcription thread."""
        return audio_data

    def _setup_transcription_file(self):
        """Create transcription output file with timestamp-based naming (lazy initialization)."""
        if self.transcription_file_created:
            return

        try:
            if self.output_dir:
                transcriptions_dir = self.output_dir
            else:
                current_dir = os.path.dirname(os.path.abspath(__file__))
                backend_dir = os.path.dirname(current_dir)
                transcriptions_dir = os.path.join(backend_dir, "data", "transcriptions")

            # Ensure directory exists
            os.makedirs(transcriptions_dir, exist_ok=True)

            # Generate filename with timestamp
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            filename = f"transcription_{self.session_id[:8]}_vfo{self.vfo_number}_{self.provider_name}_{timestamp}.txt"
            self.transcription_file_path = os.path.join(transcriptions_dir, filename)

            # Open file for writing
            self.transcription_file = open(
                self.transcription_file_path, "w", encoding="utf-8", buffering=1
            )

            # Write header
            # Extract satellite and transmitter metadata
            satellite_name = self.satellite.get("name", "Unknown") if self.satellite else "Unknown"
            satellite_norad = self.satellite.get("norad_id", "N/A") if self.satellite else "N/A"
            transmitter_desc = (
                self.transmitter.get("description", "Unknown") if self.transmitter else "Unknown"
            )
            transmitter_mode = self.transmitter.get("mode", "N/A") if self.transmitter else "N/A"
            transmitter_freq = (
                self.transmitter.get("downlink_low", "N/A") if self.transmitter else "N/A"
            )

            header = (
                f"# Ground Station Transcription\n"
                f"# Provider: {self.provider_name}\n"
                f"# Session: {self.session_id}\n"
                f"# VFO: {self.vfo_number}\n"
                f"# Satellite: {satellite_name} (NORAD: {satellite_norad})\n"
                f"# Transmitter: {transmitter_desc}\n"
                f"# Transmitter Mode: {transmitter_mode}\n"
                f"# Transmitter Frequency: {transmitter_freq} Hz\n"
                f"# Language: {self.language}\n"
                f"# Translate To: {self.translate_to}\n"
                f"# Translation Backend: {self.translation_backend}\n"
                f"# Started: {datetime.now(timezone.utc).isoformat()}\n"
                f"#\n"
                f"# Format: [HH:MM:SS] transcribed text (up to 20 words per line)\n"
                f"#\n\n"
            )
            self.transcription_file.write(header)
            self.transcription_file.flush()

            self.transcription_file_created = True
            logger.info(f"Transcription file created: {self.transcription_file_path}")
            self._notify_library_file_created()

        except Exception as e:
            logger.error(f"Failed to create transcription file: {e}", exc_info=True)
            self.transcription_file = None
            self.transcription_file_path = None

    def _notify_library_file_created(self) -> None:
        """Refresh library listings when lazy transcription output first exists."""
        if not self.sio or not self.loop or self.loop.is_closed():
            return
        try:
            asyncio.run_coroutine_threadsafe(
                emit_file_browser_state(
                    self.sio,
                    {"action": "transcription-file-created"},
                    logger,
                ),
                self.loop,
            )
        except RuntimeError:
            # Shutdown can close the main loop while this worker is finishing.
            logger.debug("Could not announce transcription file creation during shutdown")

    def _write_to_file(self, text: str, timestamp: Optional[float] = None, is_final: bool = True):
        """
        Write transcription to file using UI-matching line building logic.

        Matches the algorithm from transcription-subtitles.jsx:
        - Splits text into words with timestamps
        - Builds lines with max 20 words
        - Starts new line if 1+ minute gap between words
        - Uses first word's timestamp for each line

        Args:
            text: Transcribed text to write
            timestamp: Unix timestamp (defaults to current time)
            is_final: Whether this is a final transcription (for potential deduplication)
        """
        # Create file on first transcription (lazy initialization)
        if not self.transcription_file_created:
            self._setup_transcription_file()

        if not self.transcription_file:
            return

        try:
            if timestamp is None:
                timestamp = time.time()

            # Deduplicate: if this text is a prefix of last written (partial update), skip
            # Only write if text is completely new or extends beyond previous
            if self.last_written_text and text.strip().startswith(self.last_written_text.strip()):
                # Extract only the new part
                new_part = text[len(self.last_written_text) :].strip()
                if not new_part:
                    return  # No new content, skip
                text = new_part

            # Update last written tracker
            if is_final:
                self.last_written_text = text.strip()

            # Split text into words (matches UI: split(/\s+/))
            words = text.split()
            if not words:
                return

            with self.word_buffer_lock:
                # Add words to buffer with timestamp
                for word in words:
                    self.word_buffer.append({"word": word, "timestamp": timestamp})

                # Build lines from word buffer (matches UI logic)
                lines_to_write: List[Dict[str, Any]] = []
                current_line_words: List[str] = []
                current_line_timestamp: Optional[float] = None
                last_timestamp = None

                max_words_per_line = 20
                one_minute_ms = 60.0  # 60 seconds in timestamp (float seconds)

                for word_obj in self.word_buffer:
                    word = word_obj["word"]
                    word_timestamp = word_obj["timestamp"]

                    # Check if we need to start a new line (matches UI conditions)
                    should_start_new_line = len(current_line_words) >= max_words_per_line or (
                        last_timestamp is not None
                        and (word_timestamp - last_timestamp) >= one_minute_ms
                    )

                    if should_start_new_line and current_line_words:
                        # Write completed line
                        lines_to_write.append(
                            {
                                "timestamp": current_line_timestamp,
                                "text": " ".join(current_line_words),
                            }
                        )
                        # Start new line
                        current_line_words = [word]
                        current_line_timestamp = word_timestamp
                    else:
                        # Add to current line
                        current_line_words.append(word)
                        if current_line_timestamp is None:
                            current_line_timestamp = word_timestamp

                    last_timestamp = word_timestamp

                # Write completed lines to file
                if self.transcription_file:
                    for line_obj in lines_to_write:
                        line_timestamp = line_obj["timestamp"]
                        if isinstance(line_timestamp, (int, float)):
                            dt = datetime.fromtimestamp(line_timestamp)
                            time_str = dt.strftime("%H:%M:%S")
                            line_text = line_obj.get("text", "")
                            if line_text:
                                self.transcription_file.write(f"[{time_str}] {line_text}\n")

                    # Remove written words from buffer, keep incomplete line
                    if lines_to_write:
                        words_written = sum(
                            len(str(line.get("text", "")).split()) for line in lines_to_write
                        )
                        self.word_buffer = self.word_buffer[words_written:]

                    self.transcription_file.flush()

        except Exception as e:
            logger.error(f"Failed to write to transcription file: {e}", exc_info=True)

    def run(self):
        """Main processing loop"""
        self._start_provider_loop()

        logger.info(
            f"{self.provider_name.capitalize()} transcription worker started for session {self.session_id[:8]} "
            f"VFO {self.vfo_number} (language={self.language}, translate_to={self.translate_to})"
        )

        # Send initial startup status to UI immediately.
        self._send_status_to_ui("starting")

        # Rate tracking and stats heartbeat
        rate_window_start = time.time()
        rate_samples_accum = 0
        rate_chunks_accum = 0
        last_stats_time = time.time()
        last_status_print = time.time()

        while self.running:
            try:
                # Get audio message from queue
                audio_message = self.transcription_queue.get(timeout=1.0)

                # Update stats
                with self.stats_lock:
                    self.stats["audio_chunks_in"] += 1
                    self.stats["last_activity"] = time.time()

                # Extract audio chunk and metadata
                audio_chunk = audio_message.get("audio")
                audio_type = audio_message.get("audio_type", "mono")

                if audio_chunk is None:
                    logger.warning("Received malformed audio message for transcription")
                    self.transcription_queue.task_done()
                    continue

                # Update sample count and rate accumulators
                with self.stats_lock:
                    self.stats["audio_samples_in"] += len(audio_chunk)
                    self.stats["audio_type"] = audio_type
                rate_samples_accum += len(audio_chunk)
                rate_chunks_accum += 1

                # Add audio to buffer along with its type
                self.audio_buffer.append({"audio": audio_chunk, "type": audio_type})

                # Calculate total duration of buffered audio
                total_samples = sum(len(chunk["audio"]) for chunk in self.audio_buffer)
                is_stereo = audio_type == "stereo"

                if is_stereo:
                    duration = (total_samples / 2) / self.input_sample_rate
                else:
                    duration = total_samples / self.input_sample_rate

                # Send when we have accumulated chunk_duration seconds
                if duration >= self.chunk_duration:
                    # Concatenate all buffered chunks
                    concatenated = np.concatenate([chunk["audio"] for chunk in self.audio_buffer])

                    # Convert stereo to mono if needed
                    if is_stereo:
                        left_channel = concatenated[0::2]
                        right_channel = concatenated[1::2]
                        concatenated = (left_channel + right_channel) / 2.0

                    # Check if audio has sufficient energy (not just silence)
                    rms = np.sqrt(np.mean(concatenated**2))

                    self.audio_buffer = []
                    self._handle_audio_window(np.asarray(concatenated, dtype=np.float32), rms)

                self.transcription_queue.task_done()

            except queue.Empty:
                with self.stats_lock:
                    self.stats["queue_timeouts"] += 1
                continue

            except Exception as e:
                logger.error(f"Transcription worker error: {e}", exc_info=True)
                with self.stats_lock:
                    self.stats["errors"] += 1
                continue
            finally:
                # Time-based stats tick (every ~1s), compute rates
                now = time.time()
                if now - last_stats_time >= 1.0:
                    dt = now - rate_window_start
                    if dt > 0:
                        rate_sps = rate_samples_accum / dt
                        rate_cps = rate_chunks_accum / dt
                    else:
                        rate_sps = 0.0
                        rate_cps = 0.0

                    with self.stats_lock:
                        self.stats["audio_samples_per_sec"] = rate_sps
                        self.stats["audio_chunks_per_sec"] = rate_cps
                        self.stats["is_connected"] = self.connected

                    # Reset window
                    rate_window_start = now
                    rate_samples_accum = 0
                    rate_chunks_accum = 0
                    last_stats_time = now

                # Print status every 5 seconds
                if now - last_status_print >= 5.0:
                    with self.stats_lock:
                        stats_copy = self.stats.copy()
                    logger.info(
                        f"[{self.provider_name.upper()}] [VFO {self.vfo_number}] "
                        f"Connected={stats_copy['is_connected']}, "
                        f"AudioType={stats_copy['audio_type']}, "
                        f"Audio Rate={stats_copy['audio_chunks_per_sec']:.1f} chunks/s, "
                        f"Sent={stats_copy['transcriptions_sent']}, "
                        f"Received={stats_copy['transcriptions_received']}, "
                        f"Errors={stats_copy['errors']}"
                    )

                    # Emit status to frontend.
                    # Keep "starting" visible until we have sent any audio to provider.
                    if stats_copy["is_connected"]:
                        status = "transcribing"
                    elif stats_copy["transcriptions_sent"] == 0:
                        status = "starting"
                    else:
                        status = "idle"

                    self._send_status_to_ui(status)

                    last_status_print = now

        if self.provider_loop:
            try:
                cleanup_future = asyncio.run_coroutine_threadsafe(
                    self._cleanup_provider_resources(), self.provider_loop
                )
                cleanup_future.result(timeout=getattr(self, "cleanup_timeout_seconds", 3.0))
            except Exception:
                pass
            self._stop_provider_loop()

        # Provider cleanup may finish a final transcription after stop() was called.
        self._close_transcription_file()
        self._send_status_to_ui("closed")
        logger.info(f"{self.provider_name.capitalize()} transcription worker stopped")

    def _handle_audio_window(self, audio_data: np.ndarray, rms: float):
        """Handle a demodulated window; HTTP providers can group speech windows."""
        if rms < self.silence_threshold:
            return
        payload = self._prepare_audio_payload(audio_data)
        if self.provider_loop:
            asyncio.run_coroutine_threadsafe(
                self._stream_audio(audio_payload=payload), self.provider_loop
            )

    def _send_status_to_ui(self, status: str):
        """
        Send status update to UI via Socket.IO.

        Args:
            status: Status string ("starting", "idle", "connecting", "transcribing", "closed")
        """
        with self.stats_lock:
            stats_copy = self.stats.copy()

        asyncio.run_coroutine_threadsafe(
            self.sio.emit(
                "decoder-data",
                {
                    "type": "decoder-status",
                    "session_id": self.session_id,
                    "vfo": self.vfo_number,
                    "decoder_type": "transcription",
                    "decoder_id": self.decoder_id,
                    "worker_started_at": self.worker_started_at,
                    "status": status,
                    "timestamp": time.time(),
                    "progress": None,
                    "mode": None,
                    "info": {
                        "provider": self.provider_name,
                        "language": self.language,
                        "translate_to": self.translate_to,
                        "translation_backend": self.translation_backend,
                        "audio_type": stats_copy["audio_type"],
                        "audio_chunks_in": stats_copy["audio_chunks_in"],
                        "audio_samples_in": stats_copy["audio_samples_in"],
                        "transcriptions_sent": stats_copy["transcriptions_sent"],
                        "transcriptions_received": stats_copy["transcriptions_received"],
                        "queue_timeouts": stats_copy["queue_timeouts"],
                        "errors": stats_copy["errors"],
                        "connection_attempts": stats_copy["connection_attempts"],
                        "connection_failures": stats_copy["connection_failures"],
                        "audio_samples_per_sec": stats_copy["audio_samples_per_sec"],
                        "audio_chunks_per_sec": stats_copy["audio_chunks_per_sec"],
                    },
                },
                room=self.session_id,
            ),
            self.loop,
        )

    def _resample_audio(
        self, audio_array: np.ndarray, target_rate: Optional[int] = None
    ) -> np.ndarray:
        """
        Resample audio from input_sample_rate to target_sample_rate.

        Args:
            audio_array: Audio samples as float32 numpy array
            target_rate: Target sample rate (defaults to self.target_sample_rate)

        Returns:
            Resampled audio as float32 numpy array
        """
        if target_rate is None:
            target_rate = self.target_sample_rate

        if self.input_sample_rate == target_rate:
            return audio_array

        num_samples = int(len(audio_array) * target_rate / self.input_sample_rate)
        return signal.resample(audio_array, num_samples).astype(np.float32)

    def _normalize_audio(self, audio_array: np.ndarray, target_level: float = 0.7) -> np.ndarray:
        """
        Normalize audio amplitude to target level.

        Args:
            audio_array: Audio samples as numpy array
            target_level: Target amplitude level (0.0 to 1.0)

        Returns:
            Normalized audio array
        """
        peak = np.max(np.abs(audio_array))
        if peak > 0.001:  # Avoid division by zero
            return audio_array * (target_level / peak)
        return audio_array

    async def _send_error_to_ui(self, error: Exception):
        """
        Send user-friendly error message to UI via Socket.IO.

        Args:
            error: Exception that occurred
        """
        error_str = str(error).lower()

        # Detect specific error types
        if "quota" in error_str or "exceeded" in error_str:
            error_type = "quota_exceeded"
            error_message = f"{self.provider_name.capitalize()} API quota exceeded"
            error_details = "API quota limit reached. Check your billing or wait for quota reset."
        elif "api key" in error_str or "authentication" in error_str or "unauthorized" in error_str:
            error_type = "invalid_api_key"
            error_message = f"Invalid {self.provider_name.capitalize()} API key"
            error_details = (
                "The API key is invalid or has been revoked. Please check your settings."
            )
        elif "rate limit" in error_str:
            error_type = "rate_limit"
            error_message = f"{self.provider_name.capitalize()} rate limit reached"
            error_details = "Sending requests too quickly. Wait a moment and try again."
        elif "deadline" in error_str or "timeout" in error_str:
            # Timeout errors are recoverable - don't send to UI
            return
        elif "network" in error_str or "connection" in error_str:
            error_type = "network_error"
            error_message = f"Network error connecting to {self.provider_name.capitalize()}"
            error_details = "Could not connect. Check your internet connection."
        else:
            error_type = "unknown_error"
            error_message = f"Transcription error: {str(error)[:100]}"
            error_details = str(error)

        await self._safe_sio_emit(
            "transcription-error",
            {
                "session_id": self.session_id,
                "vfo_number": self.vfo_number,
                "provider": self.provider_name,
                "error_type": error_type,
                "message": error_message,
                "details": error_details,
                "timestamp": datetime.now().isoformat(),
            },
            room=self.session_id,
        )

    async def _report_translation_failure(self) -> None:
        """Surface failures without flooding the UI for each partial transcript."""
        with self.stats_lock:
            self.stats["errors"] += 1
        now = time.monotonic()
        if now - self._last_translation_error < 60:
            return
        self._last_translation_error = now
        await self._safe_sio_emit(
            "transcription-error",
            {
                "session_id": self.session_id,
                "vfo_number": self.vfo_number,
                "provider": self.provider_name,
                "error_type": "translation_error",
                "message": f"{self.translation_backend.capitalize()} translation failed; original transcript shown",
                "details": "Check the translation service configuration and language pair.",
                "timestamp": datetime.now().isoformat(),
            },
            room=self.session_id,
        )

    def _detect_source_language(self, text: str) -> Optional[str]:
        """Infer auto-selected source language from a short rolling transcript window."""
        if self.language != "auto":
            return None

        # Radio speech often arrives in tiny fragments. Keep recent original
        # text so callsigns or single words do not drive the subtitle label.
        self._source_language_sample = f"{self._source_language_sample} {text}".strip()[-500:]
        if sum(char.isalpha() for char in self._source_language_sample) < 20:
            return self._last_detected_language

        try:
            candidates = detect_langs(self._source_language_sample)
        except LangDetectException:
            return self._last_detected_language
        if candidates and candidates[0].prob >= 0.9:
            self._last_detected_language = str(candidates[0].lang)
        return self._last_detected_language

    async def _emit_transcription(
        self,
        text: str,
        language: str,
        is_final: bool,
        confidence: Optional[float] = None,
        detected_language: Optional[str] = None,
    ):
        """
        Emit transcription result to UI.

        Args:
            text: Transcribed text
            language: Detected/configured language code
            is_final: Whether this is a final or partial transcription
            confidence: Optional confidence score (0.0 to 1.0)
            detected_language: Language inferred from original transcript text
        """
        transcription_data = {
            "text": text,
            "session_id": self.session_id,
            "vfo_number": self.vfo_number,
            "language": language,
            "is_final": is_final,
            "provider": self.provider_name,
        }

        if confidence is not None:
            transcription_data["confidence"] = confidence
        if detected_language:
            transcription_data["detected_language"] = detected_language

        # Log based on completeness
        log_type = "final" if is_final else "partial"
        logger.info(f"[{self.provider_name.upper()}] Transcription {log_type} ({language}): {text}")

        await self._safe_sio_emit("transcription-data", transcription_data, room=self.session_id)

        # Write all transcriptions to file (both partial and final)
        # This ensures we don't lose any text even if only partials are received
        self._write_to_file(text, is_final=is_final)

        # Update stats
        with self.stats_lock:
            self.stats["transcriptions_received"] += 1

    def stop(self):
        """Stop the transcription worker"""
        logger.info(f"Stopping {self.provider_name} transcription worker...")
        self.running = False

    def _close_transcription_file(self):
        """Flush and close the file after provider work has finished."""
        # Close transcription file
        if self.transcription_file:
            try:
                # Flush any remaining words in buffer
                with self.word_buffer_lock:
                    if self.word_buffer:
                        # Write incomplete line with remaining words
                        if self.word_buffer:
                            first_timestamp = self.word_buffer[0]["timestamp"]
                            remaining_words = [w["word"] for w in self.word_buffer]
                            dt = datetime.fromtimestamp(first_timestamp)
                            time_str = dt.strftime("%H:%M:%S")
                            self.transcription_file.write(
                                f"[{time_str}] {' '.join(remaining_words)}\n"
                            )
                        self.word_buffer = []

                # Write footer with end time
                footer = f"\n# Ended: {datetime.now(timezone.utc).isoformat()}\n"
                self.transcription_file.write(footer)
                self.transcription_file.close()
                logger.info(f"Transcription file closed: {self.transcription_file_path}")
            except Exception as e:
                logger.error(f"Error closing transcription file: {e}")
            finally:
                self.transcription_file = None

    # Abstract methods that must be implemented by subclasses

    @abstractmethod
    async def _connect(self):
        """
        Connect to the transcription service API.
        Must set self.connected = True on success.
        """
        pass

    @abstractmethod
    async def _disconnect(self):
        """
        Disconnect from the transcription service API.
        Must set self.connected = False.
        """
        pass

    @abstractmethod
    async def _send_audio_to_provider(self, audio_payload: Any):
        """
        Send audio data to the provider's API.

        Args:
            audio_payload: Provider-ready audio payload
        """
        pass

    @abstractmethod
    async def _receive_loop(self):
        """
        Background task to receive transcription results from the provider.
        Should call self._emit_transcription() when results are received.
        """
        pass

    async def _stream_audio(self, audio_payload: Any):
        """
        Stream audio to the transcription service.

        Args:
            audio_payload: Provider-ready audio payload
        """
        try:
            # Check if API key is configured
            if self.requires_api_key and not self.api_key:
                logger.debug(
                    f"No API key configured for {self.provider_name}, skipping transcription"
                )
                return

            # Connect if not connected
            if not self.connected:
                # Check backoff period
                time_since_last_attempt = time.time() - self.last_connection_attempt
                if time_since_last_attempt < self.connection_backoff_seconds:
                    return

                self._send_status_to_ui("connecting")
                self.last_connection_attempt = time.time()

                # Update connection attempt stats
                with self.stats_lock:
                    self.stats["connection_attempts"] += 1

                await self._connect()

                # Start receiver task if not already running
                if (
                    self.connected
                    and self.uses_receiver
                    and (self.receiver_task is None or self.receiver_task.done())
                ):
                    self.receiver_task = asyncio.create_task(self._receive_loop())

            # Send audio to provider
            if self.connected:
                await self._send_audio_to_provider(audio_payload)

                # Update stats
                with self.stats_lock:
                    self.stats["transcriptions_sent"] += 1

        except Exception as e:
            logger.error(f"Audio streaming error: {e}", exc_info=True)
            self.connected = False

            # Update connection failure stats
            with self.stats_lock:
                self.stats["connection_failures"] += 1

            await self._send_error_to_ui(e)
