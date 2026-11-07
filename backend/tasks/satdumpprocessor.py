"""
SatDump IQ recording processing task.

This task processes IQ recordings using SatDump with various satellite pipelines.
Supports progress tracking and graceful interruption.
"""

import os
import re
import shutil
import signal
import sqlite3
import subprocess
from multiprocessing import Queue
from pathlib import Path
from typing import Optional

from common.decoded_thumbnails import generate_decoded_thumbnail
from common.satdump import (
    resolve_satdump_bundle,
    resolve_satdump_output_dir,
    validate_satdump_pipeline,
)


class GracefulKiller:
    """Handle SIGTERM gracefully within the process."""

    def __init__(self):
        self.kill_now = False
        signal.signal(signal.SIGTERM, self.exit_gracefully)
        signal.signal(signal.SIGINT, self.exit_gracefully)

    def exit_gracefully(self, *args):
        self.kill_now = True


def _has_tle_content(path: Path) -> bool:
    """Return True when a TLE file contains at least one valid line pair."""
    if not path.exists() or path.stat().st_size == 0:
        return False

    has_line1 = False
    has_line2 = False
    try:
        with path.open("r") as handle:
            for line in handle:
                line = line.strip()
                if line.startswith("1 "):
                    has_line1 = True
                elif line.startswith("2 "):
                    has_line2 = True
                if has_line1 and has_line2:
                    return True
    except Exception:
        return False
    return False


def _build_tle_file_from_ground_station_db(db_path: Path, output_path: Path) -> int:
    """Build a SatDump-compatible TLE file from Ground Station's satellites table."""
    if not db_path.exists():
        return 0

    entries: list[str] = []
    inserted = 0

    try:
        conn = sqlite3.connect(str(db_path))
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT name, tle1, tle2
            FROM satellites
            WHERE tle1 IS NOT NULL AND tle1 != '' AND tle2 IS NOT NULL AND tle2 != ''
            """
        )

        for name, tle1, tle2 in cursor.fetchall():
            line1 = str(tle1).strip()
            line2 = str(tle2).strip()
            if not line1.startswith("1 ") or not line2.startswith("2 "):
                continue

            sat_name = (str(name).strip() if name is not None else "") or "UNKNOWN"
            entries.extend([sat_name, line1, line2, ""])
            inserted += 1
    except Exception:
        return 0
    finally:
        try:
            conn.close()
        except Exception:
            pass

    if inserted > 0:
        tmp_path = output_path.with_suffix(output_path.suffix + ".tmp")
        with tmp_path.open("w") as handle:
            handle.write("\n".join(entries).rstrip() + "\n")
        tmp_path.replace(output_path)

    return inserted


def _count_omm_only_satellites(db_path: Path) -> int:
    """Count records SatDump cannot receive through its TLE-only override."""
    if not db_path.exists():
        return 0
    try:
        conn = sqlite3.connect(str(db_path))
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT COUNT(*)
            FROM satellites
            WHERE tle1 IS NULL OR tle1 = '' OR tle2 IS NULL OR tle2 = ''
            """
        )
        return int(cursor.fetchone()[0])
    except Exception:
        return 0
    finally:
        try:
            conn.close()
        except Exception:
            pass


def _prepare_satdump_tle_cache(backend_dir: Path, progress_queue: Optional[Queue] = None) -> Path:
    """
    Prepare a local SatDump-compatible TLE file for --tle_override.

    Returns:
        Path to a TLE file.
    """
    cache_dir = backend_dir / "data" / "satdump_cache"
    cache_dir.mkdir(parents=True, exist_ok=True)
    tles_path = cache_dir / "satdump_tles.txt"

    if not _has_tle_content(tles_path):
        seeded = False

        # First try existing caches.
        source_candidates: list[Path] = []
        current_home = os.environ.get("HOME", "")
        if current_home:
            source_candidates.append(
                Path(current_home) / ".config" / "satdump" / "satdump_tles.txt"
            )
        source_candidates.append(
            backend_dir / "data" / "satdump_home" / ".config" / "satdump" / "satdump_tles.txt"
        )
        source_candidates.append(
            backend_dir / "data" / "satdump_config" / "satdump" / "satdump_tles.txt"
        )

        for source in source_candidates:
            if source.resolve() == tles_path.resolve():
                continue
            if _has_tle_content(source):
                shutil.copy2(source, tles_path)
                seeded = True
                if progress_queue:
                    progress_queue.put(
                        {
                            "type": "output",
                            "output": f"Seeded SatDump TLE cache from: {source}",
                            "stream": "stdout",
                        }
                    )
                break

        # Fallback: build a TLE cache from Ground Station DB records.
        if not seeded:
            db_path = backend_dir / "data" / "db" / "gs.db"
            count = _build_tle_file_from_ground_station_db(db_path, tles_path)
            if count > 0 and progress_queue:
                progress_queue.put(
                    {
                        "type": "output",
                        "output": f"Built SatDump TLE cache from database ({count} entries)",
                        "stream": "stdout",
                    }
                )
            omitted = _count_omm_only_satellites(db_path)
            if omitted and progress_queue:
                progress_queue.put(
                    {
                        "type": "output",
                        "output": (
                            f"Notice: {omitted} OMM-only satellite(s) were omitted from the "
                            "SatDump TLE cache because SatDump receives TLE-compatible lines only."
                        ),
                        "stream": "stderr",
                    }
                )

        if not _has_tle_content(tles_path) and progress_queue:
            progress_queue.put(
                {
                    "type": "output",
                    "output": "Warning: Local SatDump TLE cache is empty; SatDump may attempt network TLE updates",
                    "stream": "stderr",
                }
            )

    return tles_path


def _cleanup_empty_directory(directory: Path, progress_queue: Optional[Queue] = None):
    """
    Remove directory if it's empty or contains only empty subdirectories.

    Args:
        directory: Path to check and potentially remove
        progress_queue: Optional queue for logging
    """
    try:
        if not directory.exists():
            return

        # Check if directory has any files (recursively)
        has_files = any(directory.rglob("*"))

        if not has_files or _is_directory_empty(directory):
            if progress_queue:
                progress_queue.put(
                    {
                        "type": "output",
                        "output": f"Cleaning up empty output directory: {directory}",
                        "stream": "stdout",
                    }
                )
            shutil.rmtree(directory)
    except Exception as e:
        if progress_queue:
            progress_queue.put(
                {
                    "type": "output",
                    "output": f"Warning: Failed to clean up directory: {e}",
                    "stream": "stderr",
                }
            )


def _is_directory_empty(directory: Path) -> bool:
    """
    Check if directory is empty or contains only empty subdirectories.

    Args:
        directory: Path to check

    Returns:
        True if directory is empty or contains only empty subdirectories
    """
    if not directory.is_dir():
        return False

    for item in directory.iterdir():
        if item.is_file():
            return False
        if item.is_dir() and not _is_directory_empty(item):
            return False

    return True


def _delete_sigmf_recording(recording_file: Path, progress_queue: Optional[Queue]) -> None:
    """Delete both parts of a processed SigMF recording."""
    try:
        base_path = recording_file
        if base_path.name.endswith(".sigmf-data"):
            base_path = base_path.with_suffix("")

        data_path = base_path.with_suffix(".sigmf-data")
        meta_path = base_path.with_suffix(".sigmf-meta")
        for path in (data_path, meta_path):
            if path.exists():
                path.unlink()

        if progress_queue:
            progress_queue.put(
                {
                    "type": "output",
                    "output": f"Deleted IQ recording: {data_path} (+.sigmf-meta)",
                    "stream": "stdout",
                }
            )
    except Exception as e:
        if progress_queue:
            progress_queue.put(
                {
                    "type": "output",
                    "output": f"Warning: Failed to delete IQ recording: {e}",
                    "stream": "stderr",
                }
            )


def satdump_process_recording(
    recording_path: str,
    output_dir: str,
    satellite: str,
    samplerate: int = 0,
    baseband_format: str = "i16",
    finish_processing: bool = True,
    delete_input_after: bool = False,
    retain_input_on_failure: bool = True,
    observation_bundle: Optional[str] = None,
    _progress_queue: Optional[Queue] = None,
):
    """
    Process an IQ recording with SatDump.

    Args:
        recording_path: Path to the input IQ recording file
        output_dir: Output directory for decoded products
        satellite: Satellite/pipeline identifier (e.g., 'meteor_m2-x_lrpt', 'noaa_apt')
        samplerate: Sample rate in Hz (0 = auto-detect from filename)
        baseband_format: Input format ('i16', 'i8', 'f32', 'w16', 'w8', etc.)
        finish_processing: Whether to run product generation after decoding
        delete_input_after: Delete SigMF input after processing
        retain_input_on_failure: Keep SigMF input when decoding fails
        observation_bundle: Explicit owner for automated processing only
        _progress_queue: Queue for sending progress updates

    Returns:
        Dict with processing results
    """
    backend_dir = Path(__file__).parent.parent
    # Validate before mkdir, subprocess execution, or any failure cleanup can run.
    satellite = validate_satdump_pipeline(satellite)
    output_path = resolve_satdump_output_dir(output_dir, backend_dir, observation_bundle)
    killer = GracefulKiller()

    # Resolve paths relative to backend/data directory
    recording_file = Path(recording_path)
    # Check if path starts with /recordings/ or /decoded/ (relative app paths)
    if not recording_file.exists():
        recording_file = backend_dir / "data" / recording_path.lstrip("/")
    if observation_bundle:
        # Automated workers may only delete input owned by their own bundle.
        recording_file = recording_file.resolve()
        bundle = resolve_satdump_bundle(observation_bundle, backend_dir)
        recording_file.relative_to(bundle / "recordings")

    # Validate inputs
    if not recording_file.exists():
        error_msg = f"Recording file not found: {recording_file}"
        if _progress_queue:
            _progress_queue.put({"type": "error", "error": error_msg, "stream": "stderr"})
        raise FileNotFoundError(error_msg)

    # Create output directory
    output_dir_preexisted = output_path.exists()
    output_path.mkdir(parents=True, exist_ok=True)

    # Build SatDump command using resolved absolute paths (SatDump 1.2.x CLI)
    # satdump <pipeline> baseband <in> <out> --samplerate <sr> --baseband_format <fmt> ...
    fmt_map = {
        "f32": "cf32",
        "i16": "cs16",
        "i8": "cs8",
        "u8": "cu8",
        "w16": "w16",
        "w8": "w8",
    }
    baseband_format = fmt_map.get(baseband_format, baseband_format)

    cmd = [
        "satdump",
        satellite,
        "baseband",
        str(recording_file),
        str(output_path),
        "--samplerate",
        str(samplerate),
        "--baseband_format",
        str(baseband_format),
        "--fill_missing",
        "--dc_block",
    ]

    # Log basic task info
    if _progress_queue:
        _progress_queue.put(
            {
                "type": "output",
                "output": "Starting SatDump processing",
                "stream": "stdout",
            }
        )
        _progress_queue.put(
            {
                "type": "output",
                "output": f"Satellite/Pipeline: {satellite}",
                "stream": "stdout",
            }
        )
        _progress_queue.put(
            {
                "type": "output",
                "output": f"Input: {recording_file}",
                "stream": "stdout",
            }
        )
        _progress_queue.put(
            {
                "type": "output",
                "output": f"Output: {output_path}",
                "stream": "stdout",
            }
        )

    try:
        satdump_tles_path = _prepare_satdump_tle_cache(backend_dir, _progress_queue)
        cmd_runtime = list(cmd)

        if _progress_queue and satdump_tles_path.exists():
            _progress_queue.put(
                {
                    "type": "output",
                    "output": f"SatDump TLE cache: {satdump_tles_path}",
                    "stream": "stdout",
                }
            )

        # Force local TLE usage and bypass launch-time network fetch/update paths.
        if _has_tle_content(satdump_tles_path):
            cmd_runtime.extend(["--tle_override", str(satdump_tles_path)])
            if _progress_queue:
                _progress_queue.put(
                    {
                        "type": "output",
                        "output": "SatDump TLE mode: local override (offline-safe)",
                        "stream": "stdout",
                    }
                )

        if _progress_queue:
            _progress_queue.put(
                {
                    "type": "output",
                    "output": f"Command: {' '.join(cmd_runtime)}",
                    "stream": "stdout",
                }
            )
            _progress_queue.put({"type": "output", "output": "-" * 60, "stream": "stdout"})

        # Start the subprocess
        process = subprocess.Popen(
            cmd_runtime,
            cwd=str(backend_dir),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            universal_newlines=True,
            bufsize=1,
        )

        # Stream output
        last_progress: Optional[float] = None
        while True:
            # Check for graceful shutdown
            if killer.kill_now:
                if _progress_queue:
                    _progress_queue.put(
                        {
                            "type": "output",
                            "output": "Terminating SatDump process...",
                            "stream": "stdout",
                        }
                    )
                process.terminate()
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill()
                return {"status": "interrupted", "message": "Process was interrupted"}

            # Read output
            if process.stdout:
                line = process.stdout.readline()
                if not line:
                    # Process finished
                    break
            else:
                break

            line = line.rstrip()
            line = re.sub(r"^\[\d{2}:\d{2}:\d{2}\s+-\s+\d{2}/\d{2}/\d{4}\]\s*", "", line)
            if line and _progress_queue:
                # Filter out debug (D) and trace (T) messages from SatDump
                if "(D)" in line or "(T)" in line:
                    continue

                # Filter out "Loading pipelines from file" messages
                if "Loading pipelines from file" in line:
                    continue

                # Parse progress from SatDump output
                progress = None
                if "Progress" in line or "%" in line:
                    # Try to extract percentage
                    try:
                        # Look for patterns like "Progress: 45.2%" or "[45%]"
                        match = re.search(r"(\d+(?:\.\d+)?)\s*%", line)
                        if match:
                            progress = float(match.group(1))
                    except Exception:
                        pass
                if progress is not None:
                    if last_progress is None or progress >= last_progress:
                        last_progress = progress
                progress_to_emit = last_progress

                _progress_queue.put(
                    {
                        "type": "output",
                        "output": line,
                        "stream": "stdout",
                        "progress": progress_to_emit if progress_to_emit is not None else None,
                    }
                )

        # Wait for process to complete
        return_code = process.wait()

        # SatDump 1.2.x doesn't have `satdump process`, so skip post-processing here.

        # Check if output directory has any decoded products (images, data files)
        # SatDump v1.2.3 returns exit code 1 even when decoding succeeded
        has_images = False
        has_output = False
        if output_path.exists():
            # Check for any image files or data products
            has_images = (
                any(output_path.rglob("*.png"))
                or any(output_path.rglob("*.jpg"))
                or any(output_path.rglob("*.jpeg"))
            )
            has_output = has_images or any(output_path.rglob("product.cbor"))

        if not has_images:
            # Retained failures can be inspected and reprocessed from the recordings browser.
            if delete_input_after and not retain_input_on_failure:
                _delete_sigmf_recording(recording_file, _progress_queue)
            if output_path.exists() and not output_dir_preexisted:
                if _progress_queue:
                    _progress_queue.put(
                        {
                            "type": "output",
                            "output": (
                                "No decoded images found; removing SatDump output directory"
                            ),
                            "stream": "stdout",
                        }
                    )
                shutil.rmtree(output_path)

            error_msg = "SatDump completed without decoded images"
            if _progress_queue:
                _progress_queue.put({"type": "error", "error": error_msg, "stream": "stderr"})
            raise RuntimeError(error_msg)

        # SatDump v1.2.x returns exit code 1 even when decoding succeeded
        if return_code == 0 or (return_code == 1 and has_output):
            generate_decoded_thumbnail(output_path, progress_queue=_progress_queue, force=True)
            if delete_input_after:
                _delete_sigmf_recording(recording_file, _progress_queue)
            if _progress_queue:
                _progress_queue.put(
                    {
                        "type": "output",
                        "output": "-" * 60,
                        "stream": "stdout",
                        "progress": 100,
                    }
                )
                if return_code == 1:
                    _progress_queue.put(
                        {
                            "type": "output",
                            "output": "SatDump completed with exit code 1 but products were generated successfully",
                            "stream": "stdout",
                        }
                    )
                else:
                    _progress_queue.put(
                        {
                            "type": "output",
                            "output": "SatDump processing completed successfully!",
                            "stream": "stdout",
                        }
                    )
                _progress_queue.put(
                    {
                        "type": "output",
                        "output": f"Output files saved to: {output_path}",
                        "stream": "stdout",
                    }
                )

            return {
                "status": "completed",
                "output_dir": str(output_path),
                "satellite": satellite,
                "return_code": return_code,
            }
        else:
            if delete_input_after and not retain_input_on_failure:
                _delete_sigmf_recording(recording_file, _progress_queue)
            # Clean up empty output directory
            _cleanup_empty_directory(output_path, _progress_queue)

            error_msg = f"SatDump process failed with return code {return_code}"
            if _progress_queue:
                _progress_queue.put({"type": "error", "error": error_msg, "stream": "stderr"})
            raise RuntimeError(error_msg)

    except Exception as e:
        # Clean up empty output directory on exception
        _cleanup_empty_directory(output_path, _progress_queue)

        error_msg = f"Error during SatDump processing: {str(e)}"
        if _progress_queue:
            _progress_queue.put({"type": "error", "error": error_msg, "stream": "stderr"})
        raise
