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

import json
import logging
from pathlib import Path
from typing import Any, Dict

logger = logging.getLogger("app-config")


DEFAULT_APP_CONFIG: Dict[str, Any] = {
    "_comment": "Ground Station app defaults. Remove or change values to override.",
    "host": "0.0.0.0",
    "port": 5000,
    "db": "data/db/gs.db",
    "temp_db": False,
    "log_level": "INFO",
    "log_config": "data/configs/log_config.yaml",
    "track_interval_ms": 2000,
    "max_tracker_targets": 10,
    # Shared Parakeet inference endpoint. New transcription workers use hot updates.
    "parakeet_url": "",
    # Optional self-hosted text translation endpoint.
    "libretranslate_url": "",
    # Optional override list for satellite metadata API endpoints used during orbital sync.
    # If this list is empty, sync falls back to the original SatNOGS URL.
    "orbital_sync_satellite_metadata_urls": ["http://db.satnogs.org/api/satellites/?format=json"],
    # Optional override list for transmitter API endpoints used during orbital sync.
    # If this list is empty, sync falls back to the original SatNOGS URL.
    "orbital_sync_transmitter_urls": ["http://db.satnogs.org/api/transmitters/?format=json"],
    # Legacy key aliases retained for backward compatibility.
    "tle_sync_satellite_metadata_urls": ["http://db.satnogs.org/api/satellites/?format=json"],
    "tle_sync_transmitter_urls": ["http://db.satnogs.org/api/transmitters/?format=json"],
    # Celestial vectors cache and synchronization timings.
    "celestial_periodic_sync_enabled": True,
    "celestial_periodic_sync_interval_minutes": 60,
    "celestial_sync_past_hours": 1,
}


def load_app_config(config_path: Path) -> Dict[str, Any]:
    """
    Load app configuration from JSON file.

    If the file does not exist, write defaults and return them.
    Keys starting with '_' are ignored.
    """
    try:
        if config_path.exists():
            with config_path.open("r") as f:
                config_data = json.load(f)
            if isinstance(config_data, dict):
                config_data = {k: v for k, v in config_data.items() if not k.startswith("_")}
                return {**DEFAULT_APP_CONFIG, **config_data}
            logger.warning("App config at %s is not a JSON object, using defaults", config_path)
            return dict(DEFAULT_APP_CONFIG)

        config_path.parent.mkdir(parents=True, exist_ok=True)
        with config_path.open("w") as f:
            json.dump(DEFAULT_APP_CONFIG, f, indent=2)
        logger.info("Wrote default app config to %s", config_path)
        return dict(DEFAULT_APP_CONFIG)
    except Exception as e:
        logger.warning("Failed to load app config from %s: %s", config_path, e)
        return dict(DEFAULT_APP_CONFIG)
