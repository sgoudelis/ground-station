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


import argparse
import os
import secrets
from pathlib import Path

from common.appconfig import DEFAULT_APP_CONFIG, load_app_config

parser = argparse.ArgumentParser(description="Start the Ground Station app with custom arguments.")
parser.add_argument(
    "--config",
    type=str,
    default=None,
    help="Path to the main app configuration file (defaults to data/configs/app_config.json)",
)
parser.add_argument("--host", type=str, default=None, help="Host to run the server on")
parser.add_argument("--port", type=int, default=None, help="Port to run the server on")
parser.add_argument("--db", type=str, default=None, help="Path to the database file")
parser.add_argument(
    "--temp-db",
    action="store_true",
    default=None,
    help="Use a temporary /tmp/<random>.db database path (first-time mode)",
)
parser.add_argument(
    "--log-level",
    type=str,
    default=None,
    choices=["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"],
    help="Set the logging level",
)
parser.add_argument(
    "--log-config",
    type=str,
    default=None,
    help="Path to the logger configuration file (defaults to data/configs/log_config.yaml)",
)
# Existing startup commands may still pass this option. Keep parsing it, but
# do not load it into runtime configuration because no authentication code uses it.
parser.add_argument(
    "--secret-key",
    type=str,
    default=None,
    help="Deprecated and ignored; accepted for compatibility with existing startup commands",
)
parser.add_argument(
    "--track-interval-ms",
    type=int,
    default=None,
    help="Milliseconds between track updates",
)
parser.add_argument(
    "--max-tracker-targets",
    type=int,
    default=None,
    help="Maximum number of active target-N tracker slots",
)

# Export resolved config context for runtime configuration handlers/UI.
resolved_app_config_path: Path
app_config_cli_overrides: set[str]
raw_startup_cli_args: argparse.Namespace | None

# Only parse arguments if we're not in an alembic context
if os.environ.get("ALEMBIC_CONTEXT"):
    # Create a namespace with default values for alembic context
    resolved_app_config_path = Path("data/configs/app_config.json")
    app_config_cli_overrides = set()
    raw_startup_cli_args = None
    arguments = argparse.Namespace(
        host="0.0.0.0",
        port=5000,
        db="data/db/gs.db",
        temp_db=False,
        log_level="INFO",
        log_config="data/configs/log_config.yaml",
        track_interval_ms=2000,
        max_tracker_targets=10,
        parakeet_url=DEFAULT_APP_CONFIG["parakeet_url"],
        libretranslate_url=DEFAULT_APP_CONFIG["libretranslate_url"],
        orbital_sync_satellite_metadata_urls=["http://db.satnogs.org/api/satellites/?format=json"],
        orbital_sync_transmitter_urls=["http://db.satnogs.org/api/transmitters/?format=json"],
        tle_sync_satellite_metadata_urls=["http://db.satnogs.org/api/satellites/?format=json"],
        tle_sync_transmitter_urls=["http://db.satnogs.org/api/transmitters/?format=json"],
        celestial_periodic_sync_enabled=True,
        celestial_periodic_sync_interval_minutes=60,
        celestial_sync_past_hours=1,
    )
else:
    _raw_args = parser.parse_args()
    raw_startup_cli_args = _raw_args
    app_config_cli_overrides = {
        key
        for key, value in {
            "host": _raw_args.host,
            "port": _raw_args.port,
            "db": _raw_args.db,
            "temp_db": _raw_args.temp_db,
            "log_level": _raw_args.log_level,
            "log_config": _raw_args.log_config,
            "track_interval_ms": _raw_args.track_interval_ms,
            "max_tracker_targets": _raw_args.max_tracker_targets,
        }.items()
        if value is not None
    }

    if _raw_args.config:
        _config_path = Path(_raw_args.config)
    else:
        if Path("data").is_dir():
            _config_path = Path("data/configs/app_config.json")
        elif Path("backend/data").is_dir():
            _config_path = Path("backend/data/configs/app_config.json")
        else:
            _config_path = Path("data/configs/app_config.json")
    resolved_app_config_path = _config_path
    _file_config = load_app_config(_config_path)

    def _pick(cli_value, key):
        return cli_value if cli_value is not None else _file_config.get(key)

    file_track_interval_ms = _file_config.get("track_interval_ms")
    if file_track_interval_ms is None and "track_interval" in _file_config:
        file_track_interval_ms = int(float(_file_config["track_interval"]) * 1000)

    cli_track_interval_ms = _raw_args.track_interval_ms
    orbital_sync_satellite_metadata_urls = _file_config.get(
        "orbital_sync_satellite_metadata_urls"
    ) or _file_config.get("tle_sync_satellite_metadata_urls")
    orbital_sync_transmitter_urls = _file_config.get(
        "orbital_sync_transmitter_urls"
    ) or _file_config.get("tle_sync_transmitter_urls")

    arguments = argparse.Namespace(
        host=_pick(_raw_args.host, "host"),
        port=_pick(_raw_args.port, "port"),
        db=_pick(_raw_args.db, "db"),
        temp_db=_pick(_raw_args.temp_db, "temp_db"),
        log_level=_pick(_raw_args.log_level, "log_level"),
        log_config=_pick(_raw_args.log_config, "log_config"),
        track_interval_ms=(
            cli_track_interval_ms if cli_track_interval_ms is not None else file_track_interval_ms
        ),
        max_tracker_targets=_pick(_raw_args.max_tracker_targets, "max_tracker_targets"),
        parakeet_url=_file_config.get("parakeet_url"),
        libretranslate_url=_file_config.get("libretranslate_url"),
        orbital_sync_satellite_metadata_urls=orbital_sync_satellite_metadata_urls,
        orbital_sync_transmitter_urls=orbital_sync_transmitter_urls,
        tle_sync_satellite_metadata_urls=orbital_sync_satellite_metadata_urls,
        tle_sync_transmitter_urls=orbital_sync_transmitter_urls,
        celestial_periodic_sync_enabled=_file_config.get("celestial_periodic_sync_enabled"),
        celestial_periodic_sync_interval_minutes=_file_config.get(
            "celestial_periodic_sync_interval_minutes"
        ),
        celestial_sync_past_hours=_file_config.get("celestial_sync_past_hours"),
    )

if getattr(arguments, "temp_db", False):
    temp_db_path = os.path.join("/tmp", f"{secrets.token_hex(8)}.db")
    arguments.db = temp_db_path

if getattr(arguments, "temp_db", False) or "GS_DB" not in os.environ:
    os.environ["GS_DB"] = arguments.db
