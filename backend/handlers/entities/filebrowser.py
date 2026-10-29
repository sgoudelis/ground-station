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

"""
File browser handlers for recordings and snapshots via Socket.IO.

This module provides Socket.IO message handlers for browsing and managing
IQ recordings and waterfall snapshots stored on the filesystem.
"""

import asyncio
import json
import shutil
import warnings
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Union
from urllib.parse import quote

from PIL import Image

from common import auth as authsvc
from common.decoded_thumbnails import get_decoded_thumbnail_url
from common.thumbnails import (
    THUMBNAIL_DIRECTORY,
    delete_image_thumbnail,
    get_image_thumbnail_path,
    get_image_thumbnail_url,
)
from library.inventory import get_inventory, publish_ready_artifacts

# Existing producers still use ``file_browser_state`` to announce storage
# lifecycle changes.  Keep that compatibility event, but update the single
# process-local library catalogue once here instead of making every browser
# scan storage independently.
_LIBRARY_MUTATION_ACTIONS = {
    "recording-started",
    "recording-stopped",
    "snapshot-saved",
    "audio-recording-started",
    "audio-recording-stopped",
    "transcription-started",
    "transcription-file-created",
    "transcription-stopped",
    "decoded-saved",
    "waterfall-generated",
    "satdump-completed",
    "observation-bundle-created",
    "observation-bundle-finalized",
    "delete-recording",
    "delete-snapshot",
    "delete-decoded",
    "delete-observation-bundle",
    "delete-audio",
    "delete-transcription",
    "delete-batch",
}


def get_disk_usage(path: Path) -> Dict[str, Union[int, str]]:
    """
    Get disk usage statistics for the filesystem containing the given path.

    Args:
        path: Path to check disk usage for

    Returns:
        Dictionary with 'total', 'used', and 'available' in bytes, optionally 'error' string
    """
    try:
        stat = shutil.disk_usage(path)
        return {
            "total": stat.total,
            "used": stat.used,
            "available": stat.free,
        }
    except Exception as e:
        return {
            "total": 0,
            "used": 0,
            "available": 0,
            "error": str(e),
        }


def parse_sigmf_metadata(meta_file_path: str) -> dict:
    """
    Parse a SigMF metadata file.

    Args:
        meta_file_path: Path to the .sigmf-meta file

    Returns:
        Dictionary containing parsed metadata or empty dict if parsing fails
    """
    try:
        with open(meta_file_path, "r") as f:
            metadata = json.load(f)

        global_meta = metadata.get("global", {})
        captures = metadata.get("captures", [])

        # Extract frequency from first capture if available
        center_frequency = None
        if captures and len(captures) > 0:
            center_frequency = captures[0].get("core:frequency")

        return {
            "datatype": global_meta.get("core:datatype"),
            "sample_rate": global_meta.get("core:sample_rate"),
            "version": global_meta.get("core:version"),
            "description": global_meta.get("core:description"),
            "recorder": global_meta.get("core:recorder"),
            "recording_in_progress": global_meta.get("gs:recording_in_progress", False),
            "start_time": global_meta.get("gs:start_time"),
            "finalized_time": global_meta.get("gs:finalized_time"),
            "session_id": global_meta.get("gs:session_id"),
            "target_satellite_norad_id": global_meta.get("gs:target_satellite_norad_id"),
            "target_satellite_name": global_meta.get("gs:target_satellite_name"),
            "center_frequency": center_frequency,
            "captures": captures,
            "annotations": metadata.get("annotations", []),
        }
    except Exception as e:
        return {"error": f"Failed to parse metadata: {str(e)}"}


def get_image_dimensions(image_path: str) -> Tuple[Any, ...]:
    """
    Get image dimensions without loading the full image.

    Args:
        image_path: Path to the image file

    Returns:
        Tuple of (width, height) or (None, None) if unable to determine
    """
    try:
        # Listing only reads the header; thumbnail decoding has its own pixel limit.
        # Keep Pillow's oversized-image error while avoiding warnings on valid waterfalls.
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", Image.DecompressionBombWarning)
            with Image.open(image_path) as img:
                size: Tuple[Any, ...] = img.size
                return size
    except Exception:
        return (None, None)


def build_recording_snapshot_info(
    snapshot_file: Path, url_prefix: str = "/recordings"
) -> Optional[Dict[str, Any]]:
    """Build snapshot and generated-thumbnail metadata for a recording.

    ``url_prefix`` is the static mount the snapshot is served from, so captures
    nested in an observation bundle can reuse this builder unchanged.
    """
    if not snapshot_file.exists() or not snapshot_file.is_file():
        return None

    mount_path = url_prefix.rstrip("/")
    width, height = get_image_dimensions(str(snapshot_file))
    # WaterfallGenerator creates this lightweight PNG beside the full-resolution
    # waterfall. Prefer it for cards instead of deriving another thumbnail from
    # the full image on every first browser visit.
    waterfall_thumbnail_path = snapshot_file.with_name(f"{snapshot_file.stem}_waterfall_thumb.png")
    thumbnail_url: Optional[str]
    if waterfall_thumbnail_path.exists() and waterfall_thumbnail_path.is_file():
        thumbnail_path = waterfall_thumbnail_path
        thumbnail_version = thumbnail_path.stat().st_mtime_ns
        thumbnail_url = f"{mount_path}/{quote(thumbnail_path.name)}?v={thumbnail_version}"
    else:
        # Recordings created before waterfall thumbnails were introduced retain
        # the generated JPEG fallback rather than losing their card preview.
        thumbnail_path = get_image_thumbnail_path(snapshot_file)
        thumbnail_url = get_image_thumbnail_url(snapshot_file, mount_path)

    thumbnail_info = None
    if thumbnail_url and thumbnail_path.exists() and thumbnail_path.is_file():
        thumbnail_width, thumbnail_height = get_image_dimensions(str(thumbnail_path))
        thumbnail_info = {
            "filename": thumbnail_path.name,
            "url": thumbnail_url,
            "size": thumbnail_path.stat().st_size,
            "width": thumbnail_width,
            "height": thumbnail_height,
        }

    snapshot_version = snapshot_file.stat().st_mtime_ns
    return {
        "filename": snapshot_file.name,
        "url": f"{mount_path}/{quote(snapshot_file.name)}?v={snapshot_version}",
        "thumbnail_url": thumbnail_url,
        "thumbnail": thumbnail_info,
        "size": snapshot_file.stat().st_size,
        "width": width,
        "height": height,
    }


def parse_transcription_metadata(transcription_file_path: str) -> Dict[str, Any]:
    """
    Parse metadata from a transcription file header.

    Args:
        transcription_file_path: Path to the transcription .txt file

    Returns:
        Dictionary containing parsed metadata or empty dict if parsing fails
    """
    try:
        metadata: Dict[str, Any] = {}
        with open(transcription_file_path, "r") as f:
            for line in f:
                line = line.strip()
                if not line.startswith("#"):
                    break  # End of header
                if line.startswith("# Provider:"):
                    metadata["provider"] = line.split(":", 1)[1].strip()
                elif line.startswith("# Session:"):
                    metadata["session_id"] = line.split(":", 1)[1].strip()
                elif line.startswith("# VFO:"):
                    metadata["vfo_number"] = int(line.split(":", 1)[1].strip())
                elif line.startswith("# Satellite:"):
                    # Parse "Satellite Name (NORAD: 12345)" format
                    sat_line = line.split(":", 1)[1].strip()
                    if sat_line != "Unknown (NORAD: N/A)":
                        # Extract name and NORAD ID
                        if "(NORAD:" in sat_line:
                            name_part = sat_line.split("(NORAD:")[0].strip()
                            norad_part = sat_line.split("(NORAD:")[1].strip().rstrip(")")
                            metadata["satellite_name"] = name_part
                            metadata["satellite_norad"] = norad_part
                        else:
                            metadata["satellite_name"] = sat_line
                    else:
                        metadata["satellite_name"] = None
                        metadata["satellite_norad"] = None
                elif line.startswith("# Transmitter:"):
                    transmitter_desc = line.split(":", 1)[1].strip()
                    metadata["transmitter_description"] = (
                        transmitter_desc if transmitter_desc != "Unknown" else None
                    )
                elif line.startswith("# Transmitter Mode:"):
                    transmitter_mode = line.split(":", 1)[1].strip()
                    metadata["transmitter_mode"] = (
                        transmitter_mode if transmitter_mode != "N/A" else None
                    )
                elif line.startswith("# Transmitter Frequency:"):
                    freq_str = line.split(":", 1)[1].strip()
                    if freq_str != "N/A Hz":
                        try:
                            # Remove " Hz" suffix and convert to int
                            metadata["transmitter_frequency"] = int(freq_str.replace(" Hz", ""))
                        except ValueError:
                            metadata["transmitter_frequency"] = None
                    else:
                        metadata["transmitter_frequency"] = None
                elif line.startswith("# Language:"):
                    metadata["language"] = line.split(":", 1)[1].strip()
                elif line.startswith("# Translate To:"):
                    metadata["translate_to"] = line.split(":", 1)[1].strip()
                elif line.startswith("# Translation Backend:"):
                    metadata["translation_backend"] = line.split(":", 1)[1].strip()
                elif line.startswith("# Started:"):
                    metadata["started"] = line.split(":", 1)[1].strip()
                elif line.startswith("# Ended:"):
                    metadata["ended"] = line.split(":", 1)[1].strip()
        return metadata
    except Exception as e:
        return {"error": f"Failed to parse metadata: {str(e)}"}


async def emit_file_browser_state(sio, state_data, logger, room=None):
    """
    Emit file browser state.

    Args:
        sio: Socket.IO server instance
        state_data: State data to emit
        logger: Logger instance
        room: Optional Socket.IO room/session id target
    """
    try:
        action = state_data.get("action")
        if action in _LIBRARY_MUTATION_ACTIONS:
            inventory = get_inventory()
            revision = await asyncio.to_thread(inventory.rebuild)
            publish_ready_artifacts(inventory)
            # This event carries only a revision.  Clients request their
            # current page through the acknowledged query command.
            await sio.emit(
                "library.changed",
                {"revision": revision, "changes": [{"operation": "reconciled", "id": "*"}]},
                room=authsvc.AUTHENTICATED_SOCKET_ROOM,
            )
        await sio.emit("file_browser_state", state_data, room=room)
        logger.debug(f"Emitted file_browser_state: {action or 'unknown'}")
    except Exception as e:
        logger.error(f"Error emitting file_browser_state: {str(e)}")


async def emit_file_browser_error(sio, error_message, action, logger, room=None):
    """
    Emit file browser error.

    Args:
        sio: Socket.IO server instance
        error_message: Error message
        action: Action that caused the error
        logger: Logger instance
        room: Optional Socket.IO room/session id target
    """
    try:
        await sio.emit("file_browser_error", {"error": error_message, "action": action}, room=room)
        logger.error(f"Emitted file_browser_error for action '{action}': {error_message}")
    except Exception as e:
        logger.error(f"Error emitting file_browser_error: {str(e)}")


def delete_recording_files(recordings_dir: Path, recording_name: str, logger) -> List[str]:
    """
    Delete all files associated with a recording.

    Args:
        recordings_dir: Path to recordings directory
        recording_name: Name of the recording (without extension)
        logger: Logger instance

    Returns:
        List of deleted file names
    """
    data_file = recordings_dir / f"{recording_name}.sigmf-data"
    meta_file = recordings_dir / f"{recording_name}.sigmf-meta"
    snapshot_file = recordings_dir / f"{recording_name}.png"

    deleted_files = []

    # Delete data file
    if data_file.exists():
        data_file.unlink()
        deleted_files.append(data_file.name)

    # Delete metadata file
    if meta_file.exists():
        meta_file.unlink()
        deleted_files.append(meta_file.name)

    # Delete snapshot file if it exists
    if snapshot_file.exists():
        snapshot_file.unlink()
        deleted_files.append(snapshot_file.name)

    thumbnail_file = delete_image_thumbnail(snapshot_file)
    if thumbnail_file:
        deleted_files.append(str(thumbnail_file.relative_to(recordings_dir)))

    if deleted_files:
        logger.info(f"Deleted recording '{recording_name}': {', '.join(deleted_files)}")

    return deleted_files


def delete_snapshot_file(snapshots_dir: Path, snapshot_filename: str, logger) -> bool:
    """
    Delete a snapshot file.

    Args:
        snapshots_dir: Path to snapshots directory
        snapshot_filename: Name of the snapshot file
        logger: Logger instance

    Returns:
        True if file was deleted, False if file did not exist
    """
    snapshot_file = snapshots_dir / snapshot_filename

    if not snapshot_file.exists():
        return False

    snapshot_file.unlink()
    snapshot_file.with_suffix(".json").unlink(missing_ok=True)
    delete_image_thumbnail(snapshot_file)
    logger.info(f"Deleted snapshot: {snapshot_filename}")
    return True


def delete_decoded_file(decoded_dir: Path, decoded_filename: str, logger) -> bool:
    """
    Delete a decoded file.

    Args:
        decoded_dir: Path to decoded directory
        decoded_filename: Name of the decoded file
        logger: Logger instance

    Returns:
        True if file was deleted, False if file did not exist
    """
    decoded_file = decoded_dir / decoded_filename

    if not decoded_file.exists():
        return False

    decoded_file.unlink()
    logger.info(f"Deleted decoded file: {decoded_filename}")
    return True


def delete_decoded_folder(decoded_dir: Path, foldername: str, logger) -> bool:
    """
    Delete a decoded folder and all its contents (e.g., SatDump output folders).

    Args:
        decoded_dir: Path to decoded directory
        foldername: Name of the folder to delete
        logger: Logger instance

    Returns:
        True if folder was deleted, False if folder did not exist
    """
    folder = decoded_dir / foldername

    if not folder.exists() or not folder.is_dir():
        return False

    try:
        shutil.rmtree(folder)
        logger.info(f"Deleted decoded folder: {foldername}")
        return True
    except Exception as e:
        logger.error(f"Failed to delete folder {foldername}: {e}")
        return False


def delete_observation_bundle(observations_dir: Path, foldername: str, logger) -> bool:
    """Delete one complete automated-observation artifact bundle."""
    if not foldername.endswith(".gsobs") or not validate_filename(foldername):
        return False
    bundle_dir = observations_dir / foldername
    if not bundle_dir.exists() or not bundle_dir.is_dir():
        return False
    try:
        shutil.rmtree(bundle_dir)
        logger.info(f"Deleted observation bundle: {foldername}")
        return True
    except Exception as e:
        logger.error(f"Failed to delete observation bundle {foldername}: {e}")
        return False


def build_observation_bundle_recordings(
    bundle_dir: Path,
) -> Tuple[List[Dict[str, Any]], Dict[str, str]]:
    """Collapse the IQ captures of a .gsobs bundle into recording payloads.

    A single capture produces several files on disk (SigMF data/meta plus the
    waterfall and its thumbnail). The observation dialog must present each
    capture as one card, so this returns the recording payloads in the same
    shape the File Browser uses for standalone captures, alongside a map of
    bundle-relative path -> owning recording name that lets callers hide the
    individual member files.
    """
    recordings: List[Dict[str, Any]] = []
    owner_by_path: Dict[str, str] = {}

    recordings_dir = bundle_dir / "recordings"
    if not recordings_dir.is_dir():
        return recordings, owner_by_path

    # Bundle files are served from the observations mount, not /recordings.
    url_prefix = f"/observations/{quote(bundle_dir.name)}/recordings"

    for meta_file in sorted(recordings_dir.glob("*.sigmf-meta")):
        base_name = meta_file.stem
        data_file = recordings_dir / f"{base_name}.sigmf-data"
        if not data_file.exists():
            continue

        metadata = parse_sigmf_metadata(str(meta_file))
        snapshot_file = recordings_dir / f"{base_name}.png"
        data_stat = data_file.stat()
        meta_stat = meta_file.stat()

        # Everything the capture owns folds into its single card.
        member_files = (
            data_file,
            meta_file,
            snapshot_file,
            recordings_dir / f"{base_name}_waterfall_thumb.png",
        )
        for member_file in member_files:
            if member_file.is_file():
                owner_by_path[member_file.relative_to(bundle_dir).as_posix()] = base_name

        recordings.append(
            {
                "type": "recording",
                "name": base_name,
                "observation_bundle": bundle_dir.name,
                "data_file": data_file.name,
                "meta_file": meta_file.name,
                "data_size": data_stat.st_size,
                "meta_size": meta_stat.st_size,
                "created": datetime.fromtimestamp(data_stat.st_ctime, timezone.utc).isoformat(),
                "modified": datetime.fromtimestamp(data_stat.st_mtime, timezone.utc).isoformat(),
                "metadata": metadata,
                "session_id": metadata.get("session_id"),
                "snapshot": build_recording_snapshot_info(snapshot_file, url_prefix),
                "recording_in_progress": metadata.get("recording_in_progress", False),
                "download_urls": {
                    "data": f"{url_prefix}/{quote(data_file.name)}",
                    "meta": f"{url_prefix}/{quote(meta_file.name)}",
                },
            }
        )

    return recordings, owner_by_path


def build_observation_bundle_item(bundle_dir: Path) -> Dict[str, Any]:
    """Build the compact folder-card payload for one .gsobs directory."""
    manifest: Dict[str, Any] = {}
    manifest_path = bundle_dir / "manifest.json"
    if manifest_path.exists():
        try:
            manifest_data = json.loads(manifest_path.read_text())
            # Bundles from older or manually edited sources may contain a JSON
            # scalar/list; only an object can serve as observation metadata.
            if isinstance(manifest_data, dict):
                manifest = manifest_data
        except (OSError, json.JSONDecodeError):
            manifest = {}

    artifacts: List[Dict[str, Any]] = []
    images: List[Dict[str, Any]] = []
    total_size = 0
    image_extensions = {".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp"}
    kind_by_directory = {
        "recordings": "recording",
        "audio": "audio",
        "decoded": "decoded",
        "transcriptions": "transcription",
        "snapshots": "snapshot",
    }
    # Captures are exposed as grouped recordings; their member files stay in
    # ``artifacts`` (tagged with the owner) so downloads and counts stay complete.
    bundle_recordings, recording_owner_by_path = build_observation_bundle_recordings(bundle_dir)
    for file_path in sorted(bundle_dir.rglob("*")):
        # JSON files hold manifests and decoder/audio metadata that
        # power the dedicated viewers and are not user-facing observation artifacts.
        if (
            not file_path.is_file()
            or file_path == manifest_path
            or file_path.suffix.lower() == ".json"
        ):
            continue
        relative_path = file_path.relative_to(bundle_dir)
        # Generated preview caches are an implementation detail of the viewers.
        if THUMBNAIL_DIRECTORY in relative_path.parent.parts:
            continue
        artifact_kind = kind_by_directory.get(relative_path.parts[0], "file")
        url = f"/observations/{quote(bundle_dir.name)}/{quote(relative_path.as_posix())}"
        file_size = file_path.stat().st_size
        artifact = {
            "name": file_path.name,
            "path": relative_path.as_posix(),
            "url": url,
            "size": file_size,
            "kind": artifact_kind,
            "file_type": file_path.suffix.lower(),
            # Set when the file is already represented by a grouped recording
            # card, so the dialog does not list it a second time on its own.
            "recording_name": recording_owner_by_path.get(relative_path.as_posix()),
        }
        artifacts.append(artifact)
        total_size += file_size
        if file_path.suffix.lower() in image_extensions:
            images.append(artifact)

    stat = bundle_dir.stat()
    satellite_data = manifest.get("satellite")
    satellite: Dict[str, Any] = satellite_data if isinstance(satellite_data, dict) else {}
    # rglob() sorts the full waterfall before its ``_waterfall_thumb`` sibling.
    # Explicitly choose the generator output so observation-folder cards do not
    # download a multi-megabyte waterfall merely to render a preview.
    waterfall_thumbnails = [
        image
        for image in images
        if image["path"].startswith("recordings/")
        and image["name"].endswith("_waterfall_thumb.png")
    ]
    return {
        # Reuse the established folder-card/table presentation, while folder_kind
        # selects the generic observation dialog instead of a SatDump dialog.
        "type": "decoded_folder",
        "folder_kind": "observation",
        "name": bundle_dir.stem,
        "foldername": bundle_dir.name,
        "size": total_size,
        "created": datetime.fromtimestamp(stat.st_ctime, timezone.utc).isoformat(),
        "modified": datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat(),
        "url": f"/observations/{quote(bundle_dir.name)}",
        "download_url": f"/api/observations/{quote(bundle_dir.name)}/download",
        "thumbnail_url": (
            waterfall_thumbnails[0]["url"]
            if waterfall_thumbnails
            else images[0]["url"] if images else None
        ),
        "satellite_name": satellite.get("name", "Unknown"),
        "satellite_id": satellite.get("norad_id"),
        "image_count": len(images),
        "artifact_count": len(artifacts),
        "recording_count": len(bundle_recordings),
        "images": images,
        "artifacts": artifacts,
        # One entry per IQ capture, ready for the standalone Recording Details
        # dialog without the frontend having to re-fetch SigMF metadata.
        "recordings": bundle_recordings,
        # Keep the lifecycle state easy for cards and tables to consume without
        # every frontend caller needing to inspect the complete manifest.
        "observation_status": manifest.get("status", "unknown"),
        "observation_in_progress": bool(
            manifest.get("in_progress", manifest.get("status") in {"in_progress", "running"})
        ),
        "metadata": manifest,
    }


def delete_audio_file(audio_dir: Path, audio_filename: str, logger) -> bool:
    """
    Delete an audio recording file and its associated metadata.

    Args:
        audio_dir: Path to audio directory
        audio_filename: Name of the audio file
        logger: Logger instance

    Returns:
        True if file was deleted, False if file did not exist
    """
    audio_file = audio_dir / audio_filename

    if not audio_file.exists():
        return False

    # Delete the audio file
    audio_file.unlink()
    logger.info(f"Deleted audio file: {audio_filename}")

    # Delete associated JSON metadata if it exists
    if audio_filename.endswith(".wav"):
        json_file = audio_dir / audio_filename.replace(".wav", ".json")
        if json_file.exists():
            json_file.unlink()
            logger.info(f"Deleted audio metadata: {json_file.name}")

    return True


def delete_transcription_file(
    transcriptions_dir: Path, transcription_filename: str, logger
) -> bool:
    """
    Delete a transcription file.

    Args:
        transcriptions_dir: Path to transcriptions directory
        transcription_filename: Name of the transcription file
        logger: Logger instance

    Returns:
        True if file was deleted, False if file did not exist or could not be deleted
    """
    transcription_file = transcriptions_dir / transcription_filename

    if not transcription_file.exists():
        return False

    try:
        transcription_file.unlink()
        logger.info(f"Deleted transcription file: {transcription_filename}")
        return True
    except PermissionError:
        logger.error(f"Cannot delete transcription file (file is open): {transcription_filename}")
        return False
    except Exception as e:
        logger.error(f"Failed to delete transcription file {transcription_filename}: {e}")
        return False


def validate_filename(filename: str) -> bool:
    """
    Validate that a filename is safe (no directory traversal attempts).

    Args:
        filename: Filename to validate

    Returns:
        True if filename is safe, False otherwise
    """
    return ".." not in filename and "/" not in filename and "\\" not in filename


async def filebrowser_request_routing(sio, cmd, data, logger, sid):
    """
    Route file browser requests via Socket.IO.

    This function processes commands and emits state updates via pub/sub model.
    No return value - all responses are emitted as events.

    Args:
        sio: Socket.IO server instance
        cmd: Command string specifying the action to perform
        data: Additional data for the command
        logger: Logger instance
        sid: Socket.IO session ID
    """

    # Get the data directories
    # __file__ is handlers/entities/filebrowser.py, so we need to go up 2 levels to get to backend/
    backend_dir = Path(__file__).parent.parent.parent
    recordings_dir = backend_dir / "data" / "recordings"
    snapshots_dir = backend_dir / "data" / "snapshots"
    decoded_dir = backend_dir / "data" / "decoded"
    audio_dir = backend_dir / "data" / "audio"
    transcriptions_dir = backend_dir / "data" / "transcriptions"
    observations_dir = backend_dir / "data" / "observations"

    try:
        if cmd == "list-files":
            # Extract filter parameters only - no pagination
            show_recordings = data.get("showRecordings", True) if data else True
            show_snapshots = data.get("showSnapshots", True) if data else True
            show_decoded = data.get("showDecoded", True) if data else True
            show_audio = data.get("showAudio", True) if data else True
            show_transcriptions = data.get("showTranscriptions", True) if data else True

            logger.info(
                f"Listing all files (recordings: {show_recordings}, snapshots: {show_snapshots}, decoded: {show_decoded}, audio: {show_audio}, transcriptions: {show_transcriptions})"
            )

            processed_items = []

            # Gather and process recordings if filter enabled
            if show_recordings and recordings_dir.exists():
                meta_files = list(recordings_dir.glob("*.sigmf-meta"))

                for idx, meta_file in enumerate(meta_files):
                    # Cooperative yield so large directory scans do not block audio/socket events.
                    if idx % 25 == 0:
                        await asyncio.sleep(0)
                    base_name = meta_file.stem
                    data_file = recordings_dir / f"{base_name}.sigmf-data"

                    if not data_file.exists():
                        logger.warning(f"Data file missing for {meta_file.name}")
                        continue

                    data_stat = data_file.stat()
                    meta_stat = meta_file.stat()
                    metadata = parse_sigmf_metadata(str(meta_file))

                    # Check if recording is in progress
                    is_recording_in_progress = metadata.get("recording_in_progress", False)

                    # Check for waterfall snapshot
                    snapshot_file = recordings_dir / f"{base_name}.png"
                    snapshot_info = build_recording_snapshot_info(snapshot_file)

                    processed_items.append(
                        {
                            "type": "recording",
                            "name": base_name,
                            "data_file": data_file.name,
                            "meta_file": meta_file.name,
                            "data_size": data_stat.st_size,
                            "meta_size": meta_stat.st_size,
                            "created": datetime.fromtimestamp(
                                data_stat.st_ctime, timezone.utc
                            ).isoformat(),
                            "modified": datetime.fromtimestamp(
                                data_stat.st_mtime, timezone.utc
                            ).isoformat(),
                            "metadata": metadata,
                            "session_id": metadata.get("session_id"),
                            "snapshot": snapshot_info,
                            "recording_in_progress": is_recording_in_progress,
                            "download_urls": {
                                "data": f"/recordings/{data_file.name}",
                                "meta": f"/recordings/{meta_file.name}",
                            },
                        }
                    )

            # Gather and process snapshots if filter enabled
            if show_snapshots and snapshots_dir.exists():
                png_files = list(snapshots_dir.glob("*.png"))

                for idx, png_file in enumerate(png_files):
                    # Cooperative yield so large directory scans do not block audio/socket events.
                    if idx % 25 == 0:
                        await asyncio.sleep(0)
                    file_stat = png_file.stat()
                    width, height = get_image_dimensions(str(png_file))

                    processed_items.append(
                        {
                            "type": "snapshot",
                            "name": png_file.stem,
                            "filename": png_file.name,
                            "size": file_stat.st_size,
                            "created": datetime.fromtimestamp(
                                file_stat.st_ctime, timezone.utc
                            ).isoformat(),
                            "modified": datetime.fromtimestamp(
                                file_stat.st_mtime, timezone.utc
                            ).isoformat(),
                            "width": width,
                            "height": height,
                            "url": f"/snapshots/{png_file.name}",
                            "thumbnail_url": get_image_thumbnail_url(png_file, "/snapshots"),
                        }
                    )

            # Gather and process decoded files if filter enabled
            if show_decoded and decoded_dir.exists():
                # STEP 1: Find all SatDump folders (directories with .satdump_ in name)
                satdump_folders = [
                    d for d in decoded_dir.iterdir() if d.is_dir() and ".satdump_" in d.name
                ]

                for idx, folder in enumerate(satdump_folders):
                    # Cooperative yield so large directory scans do not block audio/socket events.
                    if idx % 10 == 0:
                        await asyncio.sleep(0)
                    folder_stat = folder.stat()

                    # Parse dataset.json for metadata
                    dataset_file = folder / "dataset.json"
                    dataset_meta = {}
                    if dataset_file.exists():
                        try:
                            with open(dataset_file, "r") as f:
                                dataset_meta = json.load(f)
                        except Exception as e:
                            logger.warning(f"Failed to parse {dataset_file}: {e}")

                    # Parse telemetry.json for telemetry data
                    telemetry_file = folder / "telemetry.json"
                    telemetry_data = None
                    if telemetry_file.exists():
                        try:
                            with open(telemetry_file, "r") as f:
                                telemetry_data = json.load(f)
                                # Extract first entry with digital_tlm if available
                                if isinstance(telemetry_data, list):
                                    for entry in telemetry_data:
                                        if isinstance(entry, dict) and "digital_tlm" in entry:
                                            telemetry_data = entry
                                            break
                        except Exception as e:
                            logger.warning(f"Failed to parse {telemetry_file}: {e}")
                            telemetry_data = None

                    # Find all images in subdirectories
                    images = []
                    total_size = 0
                    for img_idx, img_file in enumerate(folder.rglob("*.png")):
                        # Cooperative yield so large directory scans do not block audio/socket events.
                        if img_idx % 25 == 0:
                            await asyncio.sleep(0)
                        img_stat = img_file.stat()
                        width, height = get_image_dimensions(str(img_file))
                        relative_path = img_file.relative_to(folder)

                        images.append(
                            {
                                "filename": img_file.name,
                                "path": str(relative_path),
                                "size": img_stat.st_size,
                                "width": width,
                                "height": height,
                                "url": f"/decoded/{folder.name}/{relative_path}",
                            }
                        )
                        total_size += img_stat.st_size

                    # Count .cadu files
                    cadu_files = list(folder.glob("*.cadu"))
                    for cadu in cadu_files:
                        total_size += cadu.stat().st_size

                    # Extract satellite info from folder name
                    # Format: METEOR-M2_3_20260114_185724.satdump_meteor_m2-x_lrpt
                    sat_name = None
                    sat_id = None
                    timestamp_str = None
                    pipeline = None

                    folder_parts = folder.name.split(".")
                    if len(folder_parts) >= 2:
                        name_part = folder_parts[0]  # METEOR-M2_3_20260114_185724
                        pipeline = folder_parts[1].replace("satdump_", "")  # meteor_m2-x_lrpt

                        # Extract satellite name (METEOR-M2_3)
                        parts = name_part.split("_")
                        if len(parts) >= 3:
                            sat_name = f"{parts[0]}-{parts[1]}"  # METEOR-M2_3
                            sat_id = parts[1]  # 3
                            timestamp_str = (
                                f"{parts[2]}_{parts[3]}" if len(parts) >= 4 else parts[2]
                            )

                    # Always serve the lightweight generated thumbnail for folder cards.
                    thumbnail_url = get_decoded_thumbnail_url(folder, lazy_generate=True)

                    processed_items.append(
                        {
                            "type": "decoded_folder",
                            "name": folder.stem,
                            "foldername": folder.name,
                            "size": total_size,
                            "created": datetime.fromtimestamp(
                                folder_stat.st_ctime, timezone.utc
                            ).isoformat(),
                            "modified": datetime.fromtimestamp(
                                folder_stat.st_mtime, timezone.utc
                            ).isoformat(),
                            "url": f"/decoded/{folder.name}",
                            "thumbnail_url": thumbnail_url,
                            "satellite_name": sat_name or dataset_meta.get("satellite", "Unknown"),
                            "satellite_id": sat_id,
                            "timestamp": timestamp_str,
                            "pipeline": pipeline,
                            "products": dataset_meta.get("products", []),
                            "image_count": len(images),
                            "images": images,
                            "has_cadu": len(cadu_files) > 0,
                            "metadata": dataset_meta,
                            "telemetry": telemetry_data,
                        }
                    )

                # Keep each automated observation compact in the browser even when
                # it produced recordings, packets, audio, and transcripts together.
                if observations_dir.exists():
                    for bundle_dir in sorted(observations_dir.glob("*.gsobs")):
                        if bundle_dir.is_dir():
                            processed_items.append(build_observation_bundle_item(bundle_dir))

                # STEP 2: Support multiple file types in decoded directory (exclude .json metadata files)
                decoded_files = []
                for pattern in ["*.png", "*.jpg", "*.jpeg", "*.txt", "*.bin"]:
                    decoded_files.extend(list(decoded_dir.glob(pattern)))

                for idx, decoded_file in enumerate(decoded_files):
                    # Cooperative yield so large directory scans do not block audio/socket events.
                    if idx % 25 == 0:
                        await asyncio.sleep(0)
                    file_stat = decoded_file.stat()

                    # Get image dimensions if it's an image file
                    width, height = None, None
                    if decoded_file.suffix.lower() in [".png", ".jpg", ".jpeg"]:
                        width, height = get_image_dimensions(str(decoded_file))

                    # Determine decoder type, satellite name, transmitter info, and frequency from metadata
                    decoder_type = None
                    satellite_name = None
                    satellite_norad_id = None
                    source_callsign = None
                    transmitter_description = None
                    transmitter_mode = None
                    frequency_hz = None
                    frequency_mhz = None
                    decoder_mode = None  # For SSTV mode, BPSK baudrate, etc.
                    baudrate = None
                    session_id = None

                    # Check if there's a corresponding .json metadata file
                    metadata_file = decoded_dir / f"{decoded_file.stem}.json"
                    if metadata_file.exists():
                        try:
                            with open(metadata_file, "r") as f:
                                metadata = json.load(f)
                                if not isinstance(metadata, dict):
                                    logger.warning(
                                        f"Decoded metadata for {decoded_file.name} is not an object; skipping details."
                                    )
                                    metadata = {}
                                # Extract decoder type and session_id
                                decoder_info = metadata.get("decoder") or {}
                                decoder_type = decoder_info.get("type", "").upper()
                                decoder_mode = decoder_info.get("mode")  # SSTV mode like "Robot 36"
                                baudrate = decoder_info.get("baudrate")  # For FSK/BPSK
                                session_id = decoder_info.get(
                                    "session_id"
                                )  # Session ID for linking to observations

                                # Extract satellite info from satellite metadata (preferred)
                                satellite_info = metadata.get("satellite") or {}
                                satellite_name = satellite_info.get("name")
                                satellite_norad_id = satellite_info.get("norad_id")

                                # Extract transmitter info
                                transmitter_info = metadata.get("transmitter") or {}
                                transmitter_description = transmitter_info.get("description")
                                transmitter_mode = transmitter_info.get("mode")

                                # Extract frequency from signal metadata
                                signal_info = metadata.get("signal") or {}
                                frequency_hz = signal_info.get("frequency_hz")
                                frequency_mhz = signal_info.get("frequency_mhz")

                                # An AX.25 source is the transmitting station. APRS sources
                                # are commonly terrestrial operators or digipeaters, so do
                                # not place their callsigns in satellite metadata.
                                ax25_info = metadata.get("ax25") or {}
                                source_callsign = ax25_info.get("from_callsign") or None

                                # Preserve the legacy satellite-callsign inference for the
                                # other packet decoders until their metadata is migrated.
                                if (
                                    not satellite_name
                                    and source_callsign
                                    and decoder_type != "APRS"
                                ):
                                    # Extract base satellite name (e.g., "TVL2-6-1" -> "TEVEL-2-6")
                                    if source_callsign.startswith("TVL2-"):
                                        parts = source_callsign.split("-")
                                        if len(parts) >= 2:
                                            satellite_name = f"TEVEL-2-{parts[1]}"
                                    else:
                                        # For other satellites, use callsign as-is
                                        satellite_name = source_callsign
                        except Exception as e:
                            logger.warning(f"Failed to parse metadata for {decoded_file.name}: {e}")

                    # Legacy: Determine decoder type from filename if not in metadata
                    if not decoder_type and decoded_file.name.startswith("sstv_"):
                        decoder_type = "SSTV"

                    processed_items.append(
                        {
                            "type": "decoded",
                            "name": decoded_file.stem,
                            "filename": decoded_file.name,
                            "size": file_stat.st_size,
                            "created": datetime.fromtimestamp(
                                file_stat.st_ctime, timezone.utc
                            ).isoformat(),
                            "modified": datetime.fromtimestamp(
                                file_stat.st_mtime, timezone.utc
                            ).isoformat(),
                            "width": width,
                            "height": height,
                            "url": f"/decoded/{decoded_file.name}",
                            "file_type": decoded_file.suffix.lower(),
                            "decoder_type": decoder_type,
                            "decoder_mode": decoder_mode,
                            "baudrate": baudrate,
                            "satellite_name": satellite_name,
                            "satellite_norad_id": satellite_norad_id,
                            "source_callsign": source_callsign,
                            "transmitter_description": transmitter_description,
                            "transmitter_mode": transmitter_mode,
                            "frequency_hz": frequency_hz,
                            "frequency_mhz": frequency_mhz,
                            "session_id": session_id,
                        }
                    )

            # Gather and process audio files if filter enabled
            if show_audio and audio_dir.exists():
                # Find all WAV audio files
                audio_files = list(audio_dir.glob("*.wav"))

                for idx, audio_file in enumerate(audio_files):
                    # Cooperative yield so large directory scans do not block audio/socket events.
                    if idx % 25 == 0:
                        await asyncio.sleep(0)
                    file_stat = audio_file.stat()

                    # Parse metadata from JSON file
                    metadata_file = audio_dir / f"{audio_file.stem}.json"
                    metadata = {}
                    if metadata_file.exists():
                        try:
                            with open(metadata_file, "r") as f:
                                metadata = json.load(f)
                        except Exception as e:
                            logger.warning(
                                f"Failed to parse audio metadata for {audio_file.name}: {e}"
                            )

                    # Extract key metadata
                    vfo_number = metadata.get("vfo_number")
                    demodulator_type = metadata.get("demodulator_type", "")
                    satellite_name = metadata.get("target_satellite_name")
                    satellite_norad_id = metadata.get("target_satellite_norad_id")
                    duration_seconds = metadata.get("duration_seconds")
                    sample_rate = metadata.get("sample_rate")
                    status = metadata.get("status", "unknown")
                    center_frequency = metadata.get("center_frequency")
                    vfo_frequency = metadata.get("vfo_frequency")
                    session_id = metadata.get("session_id")

                    processed_items.append(
                        {
                            "type": "audio",
                            "name": audio_file.stem,
                            "filename": audio_file.name,
                            "size": file_stat.st_size,
                            "created": datetime.fromtimestamp(
                                file_stat.st_ctime, timezone.utc
                            ).isoformat(),
                            "modified": datetime.fromtimestamp(
                                file_stat.st_mtime, timezone.utc
                            ).isoformat(),
                            "url": f"/audio/{audio_file.name}",
                            "file_type": ".wav",
                            "vfo_number": vfo_number,
                            "demodulator_type": demodulator_type,
                            "satellite_name": satellite_name,
                            "satellite_norad_id": satellite_norad_id,
                            "duration_seconds": duration_seconds,
                            "sample_rate": sample_rate,
                            "status": status,
                            "center_frequency": center_frequency,
                            "vfo_frequency": vfo_frequency,
                            "session_id": session_id,
                            "metadata": metadata,
                        }
                    )

            # Gather and process transcription files if filter enabled
            if show_transcriptions and transcriptions_dir.exists():
                # Find all transcription text files
                transcription_files = list(transcriptions_dir.glob("*.txt"))

                for idx, transcription_file in enumerate(transcription_files):
                    # Cooperative yield so large directory scans do not block audio/socket events.
                    if idx % 25 == 0:
                        await asyncio.sleep(0)
                    file_stat = transcription_file.stat()

                    # Parse metadata from file header
                    metadata = parse_transcription_metadata(str(transcription_file))

                    # Extract key metadata
                    provider = metadata.get("provider")
                    session_id = metadata.get("session_id")
                    vfo_number = metadata.get("vfo_number")
                    satellite_name = metadata.get("satellite_name")
                    satellite_norad = metadata.get("satellite_norad")
                    transmitter_description = metadata.get("transmitter_description")
                    transmitter_mode = metadata.get("transmitter_mode")
                    transmitter_frequency = metadata.get("transmitter_frequency")
                    language = metadata.get("language")
                    translate_to = metadata.get("translate_to")
                    translation_backend = metadata.get("translation_backend")
                    started = metadata.get("started")
                    ended = metadata.get("ended")

                    processed_items.append(
                        {
                            "type": "transcription",
                            "name": transcription_file.stem,
                            "filename": transcription_file.name,
                            "size": file_stat.st_size,
                            "created": datetime.fromtimestamp(
                                file_stat.st_ctime, timezone.utc
                            ).isoformat(),
                            "modified": datetime.fromtimestamp(
                                file_stat.st_mtime, timezone.utc
                            ).isoformat(),
                            "url": f"/transcriptions/{transcription_file.name}",
                            "file_type": ".txt",
                            "provider": provider,
                            "session_id": session_id,
                            "vfo_number": vfo_number,
                            "satellite_name": satellite_name,
                            "satellite_norad": satellite_norad,
                            "transmitter_description": transmitter_description,
                            "transmitter_mode": transmitter_mode,
                            "transmitter_frequency": transmitter_frequency,
                            "language": language,
                            "translate_to": translate_to,
                            "translation_backend": translation_backend,
                            "started": started,
                            "ended": ended,
                            "metadata": metadata,
                        }
                    )

            # Get disk usage for the recordings directory
            disk_usage = get_disk_usage(recordings_dir)

            # Emit state update with all items
            await emit_file_browser_state(
                sio,
                {
                    "action": "list-files",
                    "items": processed_items,
                    "diskUsage": disk_usage,
                },
                logger,
                room=sid,
            )

        elif cmd == "list-recordings":
            # SigMF playback uses a dedicated, unfiltered recording response.
            logger.debug("Listing recordings for SigMF playback")

            recordings = []

            # A deployment can retain only observation bundles, so neither
            # storage location should suppress the other from playback.
            if not recordings_dir.exists() and not observations_dir.exists():
                await emit_file_browser_state(
                    sio,
                    {"action": "list-recordings", "items": []},
                    logger,
                    room=sid,
                )
                return

            # Include both manual captures and the recordings nested in the
            # per-observation artifact bundles. Playback receives a relative
            # path for bundle files; pathguard resolves and constrains it.
            recording_sources: List[Tuple[Path, Optional[Path]]] = []
            if recordings_dir.exists():
                recording_sources.append((recordings_dir, None))
            if observations_dir.exists():
                recording_sources.extend(
                    (candidate_bundle_dir / "recordings", candidate_bundle_dir)
                    for candidate_bundle_dir in observations_dir.glob("*.gsobs")
                    if candidate_bundle_dir.is_dir()
                )

            for source_dir, recording_bundle_dir in recording_sources:
                for meta_file in source_dir.glob("*.sigmf-meta"):
                    base_name = meta_file.stem
                    data_file = source_dir / f"{base_name}.sigmf-data"

                    if not data_file.exists():
                        logger.warning(f"Data file missing for {meta_file.name}")
                        continue

                    data_stat = data_file.stat()
                    meta_stat = meta_file.stat()
                    metadata = parse_sigmf_metadata(str(meta_file))
                    snapshot_file = source_dir / f"{base_name}.png"

                    # Bundle files live under the observations mount, so their
                    # snapshot and download URLs cannot use /recordings.
                    url_prefix = (
                        "/recordings"
                        if recording_bundle_dir is None
                        else f"/observations/{quote(recording_bundle_dir.name)}/recordings"
                    )

                    if recording_bundle_dir is None:
                        playback_path = base_name
                        display_name = base_name
                    else:
                        # resolve_sigmf_meta_path starts relative paths under
                        # data/recordings, so one parent reaches data/ and then
                        # enters the trusted observations root.
                        playback_path = str(
                            Path("..")
                            / "observations"
                            / recording_bundle_dir.name
                            / "recordings"
                            / base_name
                        )
                        display_name = f"{recording_bundle_dir.stem} / {base_name}"

                    recordings.append(
                        {
                            "type": "recording",
                            "name": base_name,
                            "display_name": display_name,
                            "playback_path": playback_path,
                            "observation_bundle": (
                                recording_bundle_dir.name if recording_bundle_dir else None
                            ),
                            "data_file": data_file.name,
                            "meta_file": meta_file.name,
                            "data_size": data_stat.st_size,
                            "meta_size": meta_stat.st_size,
                            "created": datetime.fromtimestamp(
                                data_stat.st_ctime, timezone.utc
                            ).isoformat(),
                            "modified": datetime.fromtimestamp(
                                data_stat.st_mtime, timezone.utc
                            ).isoformat(),
                            "metadata": metadata,
                            "snapshot": build_recording_snapshot_info(snapshot_file, url_prefix),
                            "recording_in_progress": metadata.get("recording_in_progress", False),
                            "download_urls": {
                                "data": f"{url_prefix}/{quote(data_file.name)}",
                                "meta": f"{url_prefix}/{quote(meta_file.name)}",
                            },
                        }
                    )

            # This is intentionally separate from list-files: SigMF playback
            # needs an unfiltered recording inventory even when the File
            # Browser currently hides recordings.
            await emit_file_browser_state(
                sio,
                {"action": "list-recordings", "items": recordings},
                logger,
                room=sid,
            )

        elif cmd == "get-recording-details":
            logger.info(f"Getting recording details for: {data}")
            recording_name = data.get("name")

            if not recording_name:
                return {"success": False, "error": "Recording name not provided"}

            # Validate recording name (security check)
            if ".." in recording_name or "/" in recording_name or "\\" in recording_name:
                return {"success": False, "error": "Invalid recording name"}

            data_file = recordings_dir / f"{recording_name}.sigmf-data"
            meta_file = recordings_dir / f"{recording_name}.sigmf-meta"

            if not data_file.exists() or not meta_file.exists():
                return {"success": False, "error": "Recording not found"}

            # Get file stats
            data_stat = data_file.stat()
            meta_stat = meta_file.stat()

            # Parse metadata
            metadata = parse_sigmf_metadata(str(meta_file))

            # Check if recording is in progress (extracted by parse_sigmf_metadata)
            is_recording_in_progress = metadata.get("recording_in_progress", False)

            # Check for waterfall snapshot
            snapshot_file = recordings_dir / f"{recording_name}.png"
            snapshot_info = build_recording_snapshot_info(snapshot_file)

            recording = {
                "name": recording_name,
                "data_file": data_file.name,
                "meta_file": meta_file.name,
                "data_size": data_stat.st_size,
                "meta_size": meta_stat.st_size,
                "created": datetime.fromtimestamp(data_stat.st_ctime, timezone.utc).isoformat(),
                "modified": datetime.fromtimestamp(data_stat.st_mtime, timezone.utc).isoformat(),
                "metadata": metadata,
                "snapshot": snapshot_info,
                "recording_in_progress": is_recording_in_progress,
                "download_urls": {
                    "data": f"/recordings/{data_file.name}",
                    "meta": f"/recordings/{meta_file.name}",
                },
            }
            return {"success": True, "data": recording}

        elif cmd == "delete-recording":
            logger.info(f"Deleting recording: {data}")
            recording_name = data.get("name")

            if not recording_name:
                await emit_file_browser_error(
                    sio, "Recording name not provided", "delete-recording", logger
                )
                return

            # Validate recording name (security check)
            if not validate_filename(recording_name):
                await emit_file_browser_error(
                    sio, "Invalid recording name", "delete-recording", logger
                )
                return

            deleted_files = delete_recording_files(recordings_dir, recording_name, logger)

            if not deleted_files:
                await emit_file_browser_error(
                    sio, "Recording not found", "delete-recording", logger
                )
                return

            # Emit state update with delete action
            await emit_file_browser_state(
                sio,
                {
                    "action": "delete-recording",
                    "name": recording_name,
                    "deleted_files": deleted_files,
                    "message": f"Deleted {len(deleted_files)} file(s)",
                },
                logger,
            )

        elif cmd == "list-snapshots":
            # DEPRECATED: Use 'list-files' command instead
            # Legacy command kept for backward compatibility
            logger.warning("list-snapshots is deprecated, use list-files instead")

            snapshots = []

            # Ensure directory exists
            if not snapshots_dir.exists():
                return {
                    "success": True,
                    "data": {"items": []},
                }

            # Find all PNG files
            png_files = list(snapshots_dir.glob("*.png"))

            for png_file in png_files:
                file_stat = png_file.stat()

                # Try to get image dimensions
                width, height = get_image_dimensions(str(png_file))

                snapshot = {
                    "name": png_file.stem,
                    "filename": png_file.name,
                    "size": file_stat.st_size,
                    "created": datetime.fromtimestamp(file_stat.st_ctime, timezone.utc).isoformat(),
                    "modified": datetime.fromtimestamp(
                        file_stat.st_mtime, timezone.utc
                    ).isoformat(),
                    "width": width,
                    "height": height,
                    "url": f"/snapshots/{png_file.name}",
                    "thumbnail_url": get_image_thumbnail_url(png_file, "/snapshots"),
                }
                snapshots.append(snapshot)

        elif cmd == "delete-snapshot":
            logger.info(f"Deleting snapshot: {data}")
            snapshot_filename = data.get("filename")

            if not snapshot_filename:
                await emit_file_browser_error(
                    sio, "Snapshot filename not provided", "delete-snapshot", logger
                )
                return

            # Validate filename (security check)
            if not validate_filename(snapshot_filename):
                await emit_file_browser_error(
                    sio, "Invalid snapshot filename", "delete-snapshot", logger
                )
                return

            if not snapshot_filename.endswith(".png"):
                await emit_file_browser_error(
                    sio, "Only PNG files can be deleted", "delete-snapshot", logger
                )
                return

            deleted = delete_snapshot_file(snapshots_dir, snapshot_filename, logger)

            if not deleted:
                await emit_file_browser_error(sio, "Snapshot not found", "delete-snapshot", logger)
                return

            # Emit state update with delete action
            await emit_file_browser_state(
                sio,
                {
                    "action": "delete-snapshot",
                    "filename": snapshot_filename,
                    "message": f"Deleted snapshot: {snapshot_filename}",
                },
                logger,
            )

        elif cmd == "delete-decoded":
            logger.info(f"Deleting decoded file/folder: {data}")
            decoded_filename = data.get("filename")
            decoded_foldername = data.get("foldername")
            is_folder = data.get("is_folder", False)

            # Determine what we're deleting
            identifier = decoded_foldername if is_folder else decoded_filename

            if not identifier:
                await emit_file_browser_error(
                    sio, "Decoded filename or foldername not provided", "delete-decoded", logger
                )
                return

            # Validate identifier (security check)
            if not validate_filename(identifier):
                await emit_file_browser_error(
                    sio, "Invalid decoded filename or foldername", "delete-decoded", logger
                )
                return

            # Delete folder or file
            if is_folder:
                deleted = delete_decoded_folder(decoded_dir, identifier, logger)
                item_type = "folder"
            else:
                deleted = delete_decoded_file(decoded_dir, identifier, logger)
                item_type = "file"

            if not deleted:
                await emit_file_browser_error(
                    sio, f"Decoded {item_type} not found", "delete-decoded", logger
                )
                return

            # Emit state update with delete action
            await emit_file_browser_state(
                sio,
                {
                    "action": "delete-decoded",
                    "filename": decoded_filename,
                    "foldername": decoded_foldername,
                    "is_folder": is_folder,
                    "message": f"Deleted decoded {item_type}: {identifier}",
                },
                logger,
            )

        elif cmd == "delete-observation-bundle":
            logger.info(f"Deleting observation bundle: {data}")
            foldername = (data or {}).get("foldername", "")
            if not validate_filename(foldername) or not foldername.endswith(".gsobs"):
                await emit_file_browser_error(
                    sio,
                    "Invalid observation bundle name",
                    "delete-observation-bundle",
                    logger,
                )
                return
            if not delete_observation_bundle(observations_dir, foldername, logger):
                await emit_file_browser_error(
                    sio,
                    "Observation bundle not found",
                    "delete-observation-bundle",
                    logger,
                )
                return
            await emit_file_browser_state(
                sio,
                {
                    "action": "delete-observation-bundle",
                    "foldername": foldername,
                    "message": f"Deleted observation bundle: {foldername}",
                },
                logger,
            )

        elif cmd == "delete-audio":
            logger.info(f"Deleting audio file: {data}")
            audio_filename = data.get("filename")

            if not audio_filename:
                await emit_file_browser_error(
                    sio, "Audio filename not provided", "delete-audio", logger
                )
                return

            # Validate filename (security check)
            if not validate_filename(audio_filename):
                await emit_file_browser_error(sio, "Invalid audio filename", "delete-audio", logger)
                return

            deleted = delete_audio_file(audio_dir, audio_filename, logger)

            if not deleted:
                await emit_file_browser_error(sio, "Audio file not found", "delete-audio", logger)
                return

            # Emit state update with delete action
            await emit_file_browser_state(
                sio,
                {
                    "action": "delete-audio",
                    "filename": audio_filename,
                    "message": f"Deleted audio file: {audio_filename}",
                },
                logger,
            )

        elif cmd == "delete-transcription":
            logger.info(f"Deleting transcription file: {data}")
            transcription_filename = data.get("filename")

            if not transcription_filename:
                await emit_file_browser_error(
                    sio, "Transcription filename not provided", "delete-transcription", logger
                )
                return

            # Validate filename (security check)
            if not validate_filename(transcription_filename):
                await emit_file_browser_error(
                    sio, "Invalid transcription filename", "delete-transcription", logger
                )
                return

            deleted = delete_transcription_file(transcriptions_dir, transcription_filename, logger)

            if not deleted:
                await emit_file_browser_error(
                    sio, "Transcription file not found", "delete-transcription", logger
                )
                return

            # Emit state update with delete action
            await emit_file_browser_state(
                sio,
                {
                    "action": "delete-transcription",
                    "filename": transcription_filename,
                    "message": f"Deleted transcription file: {transcription_filename}",
                },
                logger,
            )

        elif cmd == "delete-batch":
            logger.info(f"Batch delete: {data}")
            items = data.get("items", [])

            if not items or not isinstance(items, list):
                await emit_file_browser_error(
                    sio, "No items provided for batch delete", "delete-batch", logger
                )
                return

            deleted_recordings = []
            deleted_snapshots = []
            deleted_decoded = []
            deleted_audio = []
            deleted_transcriptions = []
            deleted_observation_bundles = []
            failed_items = []
            total_files_deleted = []

            # Process each item
            for item in items:
                item_type = item.get("type")

                if item_type == "recording":
                    recording_name = item.get("name")
                    if not recording_name:
                        failed_items.append({"type": "recording", "error": "Missing name"})
                        continue

                    # Validate recording name
                    if not validate_filename(recording_name):
                        failed_items.append(
                            {
                                "type": "recording",
                                "name": recording_name,
                                "error": "Invalid filename",
                            }
                        )
                        continue

                    # Delete recording
                    deleted_files = delete_recording_files(recordings_dir, recording_name, logger)
                    if deleted_files:
                        deleted_recordings.append(recording_name)
                        total_files_deleted.extend(deleted_files)
                    else:
                        failed_items.append(
                            {"type": "recording", "name": recording_name, "error": "Not found"}
                        )

                elif item_type == "snapshot":
                    snapshot_filename = item.get("filename")
                    if not snapshot_filename:
                        failed_items.append({"type": "snapshot", "error": "Missing filename"})
                        continue

                    # Validate filename
                    if not validate_filename(snapshot_filename):
                        failed_items.append(
                            {
                                "type": "snapshot",
                                "filename": snapshot_filename,
                                "error": "Invalid filename",
                            }
                        )
                        continue

                    if not snapshot_filename.endswith(".png"):
                        failed_items.append(
                            {
                                "type": "snapshot",
                                "filename": snapshot_filename,
                                "error": "Not a PNG file",
                            }
                        )
                        continue

                    # Delete snapshot
                    deleted = delete_snapshot_file(snapshots_dir, snapshot_filename, logger)
                    if deleted:
                        deleted_snapshots.append(snapshot_filename)
                        total_files_deleted.append(snapshot_filename)
                    else:
                        failed_items.append(
                            {
                                "type": "snapshot",
                                "filename": snapshot_filename,
                                "error": "Not found",
                            }
                        )

                elif item_type == "observation_bundle":
                    foldername = item.get("foldername")
                    if (
                        not foldername
                        or not validate_filename(foldername)
                        or not foldername.endswith(".gsobs")
                    ):
                        failed_items.append(
                            {
                                "type": "observation_bundle",
                                "foldername": foldername,
                                "error": "Invalid bundle",
                            }
                        )
                        continue
                    if delete_observation_bundle(observations_dir, foldername, logger):
                        deleted_observation_bundles.append(foldername)
                        total_files_deleted.append(foldername)
                    else:
                        failed_items.append(
                            {
                                "type": "observation_bundle",
                                "foldername": foldername,
                                "error": "Not found",
                            }
                        )

                elif item_type == "decoded" or item_type == "decoded_folder":
                    decoded_filename = item.get("filename")
                    decoded_foldername = item.get("foldername")
                    is_folder = item_type == "decoded_folder"

                    identifier = decoded_foldername if is_folder else decoded_filename

                    if not identifier:
                        failed_items.append(
                            {"type": item_type, "error": "Missing filename/foldername"}
                        )
                        continue

                    # Validate identifier
                    if not validate_filename(identifier):
                        failed_items.append(
                            {
                                "type": item_type,
                                "filename": decoded_filename,
                                "foldername": decoded_foldername,
                                "error": "Invalid filename/foldername",
                            }
                        )
                        continue

                    # Delete decoded file or folder
                    if is_folder:
                        deleted = delete_decoded_folder(decoded_dir, identifier, logger)
                    else:
                        deleted = delete_decoded_file(decoded_dir, identifier, logger)

                    if deleted:
                        deleted_decoded.append(identifier)
                        total_files_deleted.append(identifier)
                    else:
                        failed_items.append(
                            {
                                "type": item_type,
                                "filename": decoded_filename,
                                "foldername": decoded_foldername,
                                "error": "Not found",
                            }
                        )

                elif item_type == "audio":
                    audio_filename = item.get("filename")
                    if not audio_filename:
                        failed_items.append({"type": "audio", "error": "Missing filename"})
                        continue

                    # Validate filename
                    if not validate_filename(audio_filename):
                        failed_items.append(
                            {
                                "type": "audio",
                                "filename": audio_filename,
                                "error": "Invalid filename",
                            }
                        )
                        continue

                    # Delete audio file
                    deleted = delete_audio_file(audio_dir, audio_filename, logger)
                    if deleted:
                        deleted_audio.append(audio_filename)
                        total_files_deleted.append(audio_filename)
                    else:
                        failed_items.append(
                            {
                                "type": "audio",
                                "filename": audio_filename,
                                "error": "Not found",
                            }
                        )

                elif item_type == "transcription":
                    transcription_filename = item.get("filename")
                    if not transcription_filename:
                        failed_items.append({"type": "transcription", "error": "Missing filename"})
                        continue

                    # Validate filename
                    if not validate_filename(transcription_filename):
                        failed_items.append(
                            {
                                "type": "transcription",
                                "filename": transcription_filename,
                                "error": "Invalid filename",
                            }
                        )
                        continue

                    # Delete transcription file
                    deleted = delete_transcription_file(
                        transcriptions_dir, transcription_filename, logger
                    )
                    if deleted:
                        deleted_transcriptions.append(transcription_filename)
                        total_files_deleted.append(transcription_filename)
                    else:
                        failed_items.append(
                            {
                                "type": "transcription",
                                "filename": transcription_filename,
                                "error": "Not found",
                            }
                        )
                else:
                    failed_items.append({"type": item_type, "error": "Unknown type"})

            # Build summary message
            success_count = (
                len(deleted_recordings)
                + len(deleted_snapshots)
                + len(deleted_decoded)
                + len(deleted_audio)
                + len(deleted_transcriptions)
                + len(deleted_observation_bundles)
            )
            message_parts = []
            if deleted_recordings:
                message_parts.append(f"{len(deleted_recordings)} recording(s)")
            if deleted_snapshots:
                message_parts.append(f"{len(deleted_snapshots)} snapshot(s)")
            if deleted_decoded:
                message_parts.append(f"{len(deleted_decoded)} decoded file(s)")
            if deleted_audio:
                message_parts.append(f"{len(deleted_audio)} audio file(s)")
            if deleted_transcriptions:
                message_parts.append(f"{len(deleted_transcriptions)} transcription(s)")
            if deleted_observation_bundles:
                message_parts.append(f"{len(deleted_observation_bundles)} observation bundle(s)")

            message = f"Deleted {', '.join(message_parts)}" if message_parts else "No items deleted"

            if failed_items:
                message += f" ({len(failed_items)} failed)"

            logger.info(f"Batch delete completed: {message}")

            # Emit state update with batch delete action
            await emit_file_browser_state(
                sio,
                {
                    "action": "delete-batch",
                    "deleted_recordings": deleted_recordings,
                    "deleted_snapshots": deleted_snapshots,
                    "deleted_decoded": deleted_decoded,
                    "deleted_audio": deleted_audio,
                    "deleted_transcriptions": deleted_transcriptions,
                    "deleted_files": total_files_deleted,
                    "failed_items": failed_items,
                    "success_count": success_count,
                    "failed_count": len(failed_items),
                    "message": message,
                },
                logger,
            )

        else:
            logger.warning(f"Unknown file browser command: {cmd}")
            await emit_file_browser_error(sio, f"Unknown command: {cmd}", cmd, logger)

    except Exception as e:
        logger.error(f"Error handling file browser command '{cmd}': {str(e)}")
        logger.exception(e)
        await emit_file_browser_error(sio, str(e), cmd, logger)


def _build_filebrowser_command_handler(command: str):
    """Create a registry-compatible handler for a file-browser command."""

    async def _handler(
        sio: Any, data: Optional[Dict], logger: Any, sid: str
    ) -> Dict[str, Union[bool, str]]:
        reply = await filebrowser_request_routing(sio, command, data, logger, sid)
        if isinstance(reply, dict):
            return reply
        # The file browser mostly communicates via emitted state/error events.
        return {"success": True}

    return _handler


def register_handlers(registry):
    """Register file browser commands with the unified command registry."""
    commands = (
        "list-files",
        "list-recordings",
        "get-recording-details",
        "delete-recording",
        "list-snapshots",
        "delete-snapshot",
        "delete-decoded",
        "delete-observation-bundle",
        "delete-audio",
        "delete-transcription",
        "delete-batch",
    )
    registry.register_batch(
        {
            f"filebrowser.{command}": (_build_filebrowser_command_handler(command), "api_call")
            for command in commands
        }
    )
