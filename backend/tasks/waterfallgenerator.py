"""
Waterfall generation background task.

This task generates waterfall spectrograms from SigMF IQ recordings.
It's designed to run as a background task with progress reporting.
"""

import logging
import multiprocessing
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


def generate_waterfall_task(
    recording_path: str,
    options: Optional[Dict[str, Any]] = None,
    _progress_queue: Optional[Queue] = None,
):
    """
    Generate waterfall spectrogram from a SigMF recording.

    Args:
        recording_path: Path to the recording (without extension)
        options: Optional manual waterfall generation options (UI-provided)
        _progress_queue: Queue for sending progress updates (injected by manager)

    Returns:
        Dict with generation results
    """
    # Set process name
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

        # Monkey-patch the logger to send progress updates
        if _progress_queue:
            original_info = generator.logger.info

            def progress_info(msg):
                original_info(msg)
                # Parse progress from message if it contains "Progress: XX%"
                if "Progress:" in msg and "%" in msg:
                    try:
                        # Extract percentage from "Progress: 50%"
                        progress_str = msg.split("Progress:")[1].split("%")[0].strip()
                        progress = float(progress_str)
                        _progress_queue.put(
                            {
                                "type": "output",
                                "output": msg,
                                "stream": "stdout",
                                "progress": progress,
                            }
                        )
                    except (ValueError, IndexError):
                        _progress_queue.put({"type": "output", "output": msg, "stream": "stdout"})
                else:
                    _progress_queue.put({"type": "output", "output": msg, "stream": "stdout"})

            generator.logger.info = progress_info

        # Generate waterfall
        success = generator.generate_from_sigmf(recording_path_obj)

        if success:
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
