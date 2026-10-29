# Copyright (c) 2026 Efstratios Goudelis
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

"""Filesystem bundles for artifacts produced by automated observations."""

import json
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict

from common.filenames import sanitize_filename_component

BUNDLE_SUFFIX = ".gsobs"
ARTIFACT_DIRECTORIES = ("recordings", "audio", "decoded", "transcriptions", "snapshots")


def observation_snapshot(observation: Dict[str, Any]) -> Dict[str, Any]:
    """Build the durable scheduler metadata stored with a produced observation."""
    satellite = observation.get("satellite") or {}
    pass_details = observation.get("pass") or {}

    # Keep the bundle self-contained after scheduler retention removes the
    # source row, while avoiding transient execution logs and unrelated state.
    return {
        "name": observation.get("name"),
        "status": observation.get("status"),
        "enabled": observation.get("enabled"),
        "satellite": {
            "name": satellite.get("name"),
            "norad_id": satellite.get("norad_id"),
            "group_id": satellite.get("group_id"),
        },
        "pass": {
            "event_start": pass_details.get("event_start"),
            "event_end": pass_details.get("event_end"),
            "peak_altitude": pass_details.get("peak_altitude"),
        },
        "task_start": observation.get("task_start"),
        "task_end": observation.get("task_end"),
        "task_start_elevation": observation.get("task_start_elevation"),
        "rotator": observation.get("rotator") or {},
        "rig": observation.get("rig") or {},
        "transmitter": observation.get("transmitter") or {},
        "sessions": observation.get("sessions") or [],
        "created_at": observation.get("created_at"),
        "updated_at": observation.get("updated_at"),
    }


def create_observation_bundle(
    observation_id: str, satellite: Dict[str, Any], backend_dir: Path
) -> Path:
    """Create and describe the artifact bundle for one automated observation."""
    observations_dir = backend_dir / "data" / "observations"
    observations_dir.mkdir(parents=True, exist_ok=True)

    satellite_name = sanitize_filename_component(
        str(satellite.get("name") or "unknown"), default="unknown"
    )
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    bundle_dir = observations_dir / f"{satellite_name}_{timestamp}{BUNDLE_SUFFIX}"
    if bundle_dir.exists():
        # A retry or two observations may legitimately start within the same
        # second. Preserve the readable name while ensuring no bundle collides.
        base_name = f"{satellite_name}_{timestamp}_{observation_id[:8]}"
        bundle_dir = observations_dir / f"{base_name}{BUNDLE_SUFFIX}"
        sequence = 2
        while bundle_dir.exists():
            bundle_dir = observations_dir / f"{base_name}_{sequence}{BUNDLE_SUFFIX}"
            sequence += 1

    bundle_dir.mkdir(parents=True, exist_ok=False)
    for directory in ARTIFACT_DIRECTORIES:
        (bundle_dir / directory).mkdir(exist_ok=True)

    manifest = {
        "schema_version": 2,
        "observation_id": observation_id,
        "satellite": {
            "name": satellite.get("name"),
            "norad_id": satellite.get("norad_id"),
        },
        "created_at": datetime.now(timezone.utc).isoformat(),
        "artifact_directories": list(ARTIFACT_DIRECTORIES),
        # Bundles are visible as soon as AOS starts, before an artifact is
        # necessarily produced. The UI uses this state to distinguish them
        # from finalized observations.
        "status": "in_progress",
        "in_progress": True,
    }
    write_bundle_manifest(bundle_dir, manifest)
    return bundle_dir


def write_bundle_manifest(bundle_dir: Path, values: Dict[str, Any]) -> None:
    """Merge values into the bundle manifest without losing initial identity metadata."""
    manifest_path = bundle_dir / "manifest.json"
    manifest: Dict[str, Any] = {}
    if manifest_path.exists():
        try:
            manifest = json.loads(manifest_path.read_text())
        except (OSError, json.JSONDecodeError):
            manifest = {}
    manifest.update(values)
    manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")


def add_bundle_session(bundle_dir: Path, session_id: str, session_key: str) -> None:
    """Record every internal SDR session that contributed to a bundle."""
    manifest_path = bundle_dir / "manifest.json"
    try:
        manifest: Dict[str, Any] = json.loads(manifest_path.read_text())
    except (OSError, json.JSONDecodeError):
        manifest = {}
    sessions = manifest.setdefault("sessions", [])
    entry = {"session_id": session_id, "session_key": session_key}
    if entry not in sessions:
        sessions.append(entry)
    manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")


def bundle_has_artifacts(bundle_dir: Path) -> bool:
    """Return whether a bundle contains a user-visible produced artifact."""
    manifest_path = bundle_dir / "manifest.json"
    return any(
        file_path.is_file() and file_path != manifest_path
        # JSON metadata files only describe another product and are not displayed as
        # artifacts in the file browser.
        and file_path.suffix.lower() != ".json"
        for file_path in bundle_dir.rglob("*")
    )


def finalize_observation_bundle(bundle_dir: Path, status: str) -> bool:
    """Finalize a bundle and remove it when its observation produced no artifacts.

    Returns ``True`` when the finalized bundle remains on disk and ``False`` when
    it was removed as empty.
    """
    manifest_path = bundle_dir / "manifest.json"
    try:
        manifest: Dict[str, Any] = json.loads(manifest_path.read_text())
    except (OSError, json.JSONDecodeError):
        manifest = {}
    snapshot = manifest.get("scheduled_observation")
    if isinstance(snapshot, dict):
        # The snapshot starts as the scheduled configuration. Its terminal
        # status must follow the bundle because the scheduler row is temporary.
        snapshot = {**snapshot, "status": status}

    values = {
        "status": status,
        "in_progress": False,
        "finalized_at": datetime.now(timezone.utc).isoformat(),
    }
    if snapshot is not None:
        values["scheduled_observation"] = snapshot

    write_bundle_manifest(
        bundle_dir,
        values,
    )
    if bundle_has_artifacts(bundle_dir):
        return True

    shutil.rmtree(bundle_dir)
    return False


def finalize_interrupted_observation_bundles(
    observation_id: str, backend_dir: Path, status: str = "failed"
) -> int:
    """Finalize in-progress bundles that belong to an interrupted observation.

    Bundle paths are intentionally readable and do not always contain the full
    observation ID, so recovery uses the manifest as its source of truth.
    """
    observations_dir = backend_dir / "data" / "observations"
    if not observations_dir.exists():
        return 0

    finalized_count = 0
    for bundle_dir in observations_dir.glob(f"*{BUNDLE_SUFFIX}"):
        manifest_path = bundle_dir / "manifest.json"
        try:
            manifest = json.loads(manifest_path.read_text())
        except (OSError, json.JSONDecodeError):
            continue

        if not isinstance(manifest, dict):
            continue
        if manifest.get("observation_id") != observation_id:
            continue
        if not manifest.get("in_progress", manifest.get("status") == "in_progress"):
            continue

        finalize_observation_bundle(bundle_dir, status)
        finalized_count += 1

    return finalized_count


def prune_finalized_empty_observation_bundles(backend_dir: Path) -> int:
    """Remove empty bundles left behind after an earlier process lifetime.

    Only bundles whose manifest has reached a terminal observation status are
    considered. Active observations can legitimately have no artifact yet.
    """
    observations_dir = backend_dir / "data" / "observations"
    if not observations_dir.exists():
        return 0

    terminal_statuses = {"completed", "completed_with_warnings", "failed", "cancelled"}
    removed_count = 0
    for bundle_dir in observations_dir.glob(f"*{BUNDLE_SUFFIX}"):
        manifest_path = bundle_dir / "manifest.json"
        try:
            manifest = json.loads(manifest_path.read_text())
        except (OSError, json.JSONDecodeError):
            # An unreadable manifest is not enough evidence that this bundle is stale.
            continue

        if not isinstance(manifest, dict) or manifest.get("status") not in terminal_statuses:
            continue
        if bundle_has_artifacts(bundle_dir):
            continue

        shutil.rmtree(bundle_dir)
        removed_count += 1

    return removed_count
