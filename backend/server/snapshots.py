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
Waterfall snapshot management module.

This module handles saving waterfall display snapshots to disk.
"""

import base64
import json
import re
from datetime import datetime, timezone
from pathlib import Path

from common.logger import logger
from common.pathguard import ensure_path_in_allowed_roots, get_snapshots_root


def _validate_snapshot_name(snapshot_name: str) -> str:
    candidate = (snapshot_name or "").strip()
    if not candidate:
        return "waterfall_snapshot"

    # Snapshot names are user-controlled input; only allow a basename.
    if Path(candidate).is_absolute():
        raise ValueError("Invalid snapshot name: absolute paths are not allowed")
    if ".." in candidate or "/" in candidate or "\\" in candidate:
        raise ValueError("Invalid snapshot name: directory traversal is not allowed")
    return candidate


def save_waterfall_snapshot(
    waterfall_image: str,
    snapshot_name: str = "",
    snapshots_root: Path | None = None,
    metadata: dict | None = None,
) -> dict:
    """
    Save a waterfall snapshot image to disk.

    Args:
        waterfall_image: Base64-encoded image data URL (format: data:image/png;base64,...)
        snapshot_name: Optional base name for the snapshot file (timestamp will be appended)
        metadata: Optional satellite context retained for library search

    Returns:
        dict: Result dictionary with 'success' bool and 'snapshot_path' or 'error' message

    Raises:
        Exception: If image data is invalid or file operations fail
    """
    try:
        if not waterfall_image:
            raise Exception("No waterfall image provided")

        # Generate timestamp
        now = datetime.now()
        date = now.strftime("%Y%m%d")
        time_str = now.strftime("%H%M%S")
        timestamp = f"{date}_{time_str}"

        validated_name = _validate_snapshot_name(snapshot_name)
        snapshot_name_with_timestamp = f"{validated_name}_{timestamp}"

        snapshots_dir = (snapshots_root or get_snapshots_root()).resolve()
        snapshots_dir.mkdir(parents=True, exist_ok=True)

        # Extract base64 data from data URL
        # Format: data:image/png;base64,iVBORw0KG...
        match = re.match(r"data:image/(\w+);base64,(.+)", waterfall_image)
        if match:
            image_data = match.group(2)
            image_bytes = base64.b64decode(image_data)

            # Save the image
            image_path = ensure_path_in_allowed_roots(
                (snapshots_dir / f"{snapshot_name_with_timestamp}.png"), [snapshots_dir]
            )
            # Keep only capture context, never arbitrary client-supplied metadata.
            context = {
                key: value
                for key, value in (metadata.items() if isinstance(metadata, dict) else ())
                if key in {"target_satellite_name", "target_satellite_norad_id"}
                and isinstance(value, (str, int))
                and not isinstance(value, bool)
            }
            # Keep capture time with the image so copying it to another station
            # does not make it appear to have been captured on the import date.
            context["captured_at"] = datetime.now(timezone.utc).isoformat()
            with image_path.open("wb") as f:
                f.write(image_bytes)
            try:
                image_path.with_suffix(".json").write_text(
                    json.dumps(context, ensure_ascii=False), encoding="utf-8"
                )
            except OSError:
                # Do not report success if durable capture metadata was lost.
                image_path.unlink(missing_ok=True)
                image_path.with_suffix(".json").unlink(missing_ok=True)
                raise

            logger.info(f"Saved waterfall snapshot: {image_path}")
            return {"success": True, "snapshot_path": str(image_path)}
        else:
            raise Exception("Invalid waterfall image data URL format")

    except Exception as e:
        logger.error(f"Error saving waterfall snapshot: {str(e)}")
        return {"success": False, "error": str(e)}
