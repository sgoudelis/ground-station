"""
Waterfall generation background task.

This task generates waterfall spectrograms from SigMF IQ recordings.
It's designed to run as a background task with progress reporting.
"""

import json
import logging
import multiprocessing
import threading
from multiprocessing import Queue
from pathlib import Path
from typing import Any, Dict, Optional

try:
    import setproctitle

    HAS_SETPROCTITLE = True
except ImportError:
    HAS_SETPROCTITLE = False

from fft.waterfallgenerator import WaterfallConfig, WaterfallGenerator

logger = logging.getLogger("waterfall-task")


class _ProgressHandler(logging.Handler):
    def __init__(self, progress_queue: Queue):
        super().__init__(level=logging.INFO)
        self.progress_queue = progress_queue

    def emit(self, record: logging.LogRecord) -> None:
        if record.levelno != logging.INFO:
            return
        rendered = record.getMessage()
        message: Dict[str, Any] = {
            "type": "output",
            "output": rendered,
            "stream": "stdout",
        }
        if "Progress:" in rendered and "%" in rendered:
            try:
                message["progress"] = float(rendered.split("Progress:")[1].split("%")[0].strip())
            except (ValueError, IndexError):
                pass
        self.progress_queue.put(message)


def generate_waterfall_task(
    recording_path: str,
    options: Optional[Dict[str, Any]] = None,
    _progress_queue: Optional[Queue] = None,
    delete_after_waterfall: bool = False,
):
    """
    Generate waterfall spectrogram from a SigMF recording.

    Args:
        recording_path: Path to the recording (without extension)
        options: Optional manual waterfall generation options (UI-provided)
        _progress_queue: Queue for sending progress updates (injected by manager)
        delete_after_waterfall: Remove IQ samples after successful image generation;
            retain the SigMF metadata for the waterfall viewer.

    Returns:
        Dict with generation results
    """
    # The fallback runs in a thread inside the server; only rename a task process.
    if threading.current_thread() is threading.main_thread():
        if HAS_SETPROCTITLE:
            setproctitle.setproctitle("Ground Station - Waterfall-Generator")
        multiprocessing.current_process().name = "Ground Station - Waterfall-Generator"

    try:
        recording_path_obj = Path(recording_path)
        if recording_path_obj.suffix in {".sigmf-data", ".sigmf-meta"}:
            recording_path_obj = recording_path_obj.with_suffix("")

        recording_path_str = str(recording_path_obj)
        if recording_path_str.startswith("/recordings/") or recording_path_str.startswith(
            "/decoded/"
        ):
            backend_dir = Path(__file__).parent.parent
            recording_path_obj = backend_dir / "data" / recording_path_str.lstrip("/")
        elif not recording_path_obj.is_absolute():
            backend_dir = Path(__file__).parent.parent
            recording_path_obj = backend_dir / "data" / recording_path_str.lstrip("/")

        if _progress_queue:
            _progress_queue.put(
                {
                    "type": "output",
                    "output": f"Starting waterfall generation for: {recording_path_obj.name}",
                    "stream": "stdout",
                    "progress": 0,
                }
            )

        # Load default config and merge validated UI overrides.
        config = WaterfallConfig.from_overrides(options)

        # Create generator
        generator = WaterfallGenerator(config)

        # Attach progress reporting for this invocation without replacing a
        # shared logger method or leaking callbacks into the next task.
        progress_handler = _ProgressHandler(_progress_queue) if _progress_queue else None
        original_log_level = generator.logger.level
        if progress_handler is not None:
            generator.logger.addHandler(progress_handler)
            # Task progress must remain available when console logging is quiet.
            generator.logger.setLevel(logging.INFO)
        try:
            success = generator.generate_from_sigmf(recording_path_obj)
        finally:
            if progress_handler is not None:
                generator.logger.removeHandler(progress_handler)
                generator.logger.setLevel(original_log_level)

        if success:
            if delete_after_waterfall is True:
                # Keep the samples on any generation/finalization failure. Mark the
                # retained metadata first so a crash after unlink cannot hide the image.
                image_path = Path(f"{recording_path_obj}.png")
                if not image_path.is_file() or image_path.stat().st_size == 0:
                    raise RuntimeError("Waterfall image is missing; retaining IQ data")
                meta_path = Path(f"{recording_path_obj}.sigmf-meta")
                metadata = json.loads(meta_path.read_text())
                metadata.setdefault("global", {})["gs:iq_data_deleted"] = True
                temporary_meta = meta_path.with_suffix(".sigmf-meta.tmp")
                temporary_meta.write_text(json.dumps(metadata, indent=2) + "\n")
                temporary_meta.replace(meta_path)
                Path(f"{recording_path_obj}.sigmf-data").unlink()
                logger.info("Deleted IQ samples after waterfall generation: %s", recording_path_obj)

            if _progress_queue:
                _progress_queue.put(
                    {
                        "type": "output",
                        "output": "Waterfall generation completed successfully!",
                        "stream": "stdout",
                        "progress": 100,
                    }
                )

            return {
                "status": "completed",
                "recording_path": str(recording_path_obj),
                "waterfall_path": f"{recording_path_obj}.png",
            }
        else:
            error_msg = f"Waterfall generation failed for {recording_path_obj.name}"
            if _progress_queue:
                _progress_queue.put({"type": "error", "error": error_msg, "stream": "stderr"})
            raise RuntimeError(error_msg)

    except Exception as e:
        error_msg = f"Error generating waterfall: {str(e)}"
        logger.error(error_msg)
        if _progress_queue:
            _progress_queue.put({"type": "error", "error": error_msg, "stream": "stderr"})
        raise
