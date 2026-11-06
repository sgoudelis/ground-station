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

"""Schema-based runtime app settings read/write service."""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Literal, Optional, Tuple
from urllib.parse import urlsplit

from common.appconfig import DEFAULT_APP_CONFIG
from common.arguments import app_config_cli_overrides, arguments, resolved_app_config_path

logger = logging.getLogger("app-settings")

ApplyMode = Literal["hot", "restart_required"]
FieldType = Literal["string", "integer", "boolean", "string_list"]
ValidatedSettingValue = bool | int | str | List[str]

LEGACY_ALIASES: Dict[str, str] = {
    "orbital_sync_satellite_metadata_urls": "tle_sync_satellite_metadata_urls",
    "orbital_sync_transmitter_urls": "tle_sync_transmitter_urls",
}


@dataclass(frozen=True)
class AppSettingField:
    key: str
    value_type: FieldType
    default: Any
    description: str
    apply_mode: ApplyMode
    minimum: Optional[int] = None
    maximum: Optional[int] = None
    choices: Optional[Tuple[Any, ...]] = None
    sensitive: bool = False
    cli_flag: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "key": self.key,
            "value_type": self.value_type,
            "default": self.default,
            "description": self.description,
            "apply_mode": self.apply_mode,
            "minimum": self.minimum,
            "maximum": self.maximum,
            "choices": list(self.choices) if self.choices else None,
            "sensitive": self.sensitive,
            "cli_flag": self.cli_flag,
        }


FIELDS: Tuple[AppSettingField, ...] = (
    AppSettingField(
        key="host",
        value_type="string",
        default=DEFAULT_APP_CONFIG["host"],
        description="Host interface used by the backend web server.",
        apply_mode="restart_required",
        cli_flag="--host",
    ),
    AppSettingField(
        key="port",
        value_type="integer",
        default=DEFAULT_APP_CONFIG["port"],
        description="TCP port used by the backend web server.",
        apply_mode="restart_required",
        minimum=1,
        maximum=65535,
        cli_flag="--port",
    ),
    AppSettingField(
        key="db",
        value_type="string",
        default=DEFAULT_APP_CONFIG["db"],
        description="SQLite database path used by the backend.",
        apply_mode="restart_required",
        cli_flag="--db",
    ),
    AppSettingField(
        key="temp_db",
        value_type="boolean",
        default=DEFAULT_APP_CONFIG["temp_db"],
        description="Use an ephemeral /tmp database on startup.",
        apply_mode="restart_required",
        cli_flag="--temp-db",
    ),
    AppSettingField(
        key="log_level",
        value_type="string",
        default=DEFAULT_APP_CONFIG["log_level"],
        description="Application log verbosity level.",
        apply_mode="restart_required",
        choices=("DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"),
        cli_flag="--log-level",
    ),
    AppSettingField(
        key="log_config",
        value_type="string",
        default=DEFAULT_APP_CONFIG["log_config"],
        description="Path to logging YAML configuration file.",
        apply_mode="restart_required",
        cli_flag="--log-config",
    ),
    AppSettingField(
        key="track_interval_ms",
        value_type="integer",
        default=DEFAULT_APP_CONFIG["track_interval_ms"],
        description="Tracker loop interval in milliseconds.",
        apply_mode="restart_required",
        minimum=1,
        maximum=5999,
        cli_flag="--track-interval-ms",
    ),
    AppSettingField(
        key="max_tracker_targets",
        value_type="integer",
        default=DEFAULT_APP_CONFIG["max_tracker_targets"],
        description="Maximum number of target-* tracker slots.",
        apply_mode="restart_required",
        minimum=1,
        maximum=100,
        cli_flag="--max-tracker-targets",
    ),
    AppSettingField(
        key="parakeet_url",
        value_type="string",
        default=DEFAULT_APP_CONFIG["parakeet_url"],
        description="Parakeet service base URL. Leave empty to disable it. Changes apply to new transcription workers.",
        apply_mode="hot",
    ),
    AppSettingField(
        key="libretranslate_url",
        value_type="string",
        default=DEFAULT_APP_CONFIG["libretranslate_url"],
        description="LibreTranslate service base URL. Leave empty to disable local translation. Changes apply to new transcription workers.",
        apply_mode="hot",
    ),
    AppSettingField(
        key="orbital_sync_satellite_metadata_urls",
        value_type="string_list",
        default=DEFAULT_APP_CONFIG["orbital_sync_satellite_metadata_urls"],
        description="Satellite metadata endpoint list used during orbital sync.",
        apply_mode="hot",
    ),
    AppSettingField(
        key="orbital_sync_transmitter_urls",
        value_type="string_list",
        default=DEFAULT_APP_CONFIG["orbital_sync_transmitter_urls"],
        description="Transmitter metadata endpoint list used during orbital sync.",
        apply_mode="hot",
    ),
    AppSettingField(
        key="celestial_periodic_sync_enabled",
        value_type="boolean",
        default=DEFAULT_APP_CONFIG["celestial_periodic_sync_enabled"],
        description="Enable periodic monitored celestial vector synchronization job.",
        apply_mode="restart_required",
    ),
    AppSettingField(
        key="celestial_periodic_sync_interval_minutes",
        value_type="integer",
        default=DEFAULT_APP_CONFIG["celestial_periodic_sync_interval_minutes"],
        description="Interval (minutes) for periodic celestial vector synchronization.",
        apply_mode="restart_required",
        minimum=5,
        maximum=24 * 60,
    ),
    AppSettingField(
        key="celestial_sync_past_hours",
        value_type="integer",
        default=DEFAULT_APP_CONFIG["celestial_sync_past_hours"],
        description="Past-hour window used for monitored celestial periodic cache refresh.",
        apply_mode="restart_required",
        minimum=0,
        maximum=24 * 365,
    ),
)

FIELDS_BY_KEY: Dict[str, AppSettingField] = {field.key: field for field in FIELDS}


def _read_config_dict(config_path: Path) -> Dict[str, Any]:
    if not config_path.exists():
        return {}
    try:
        with config_path.open("r", encoding="utf-8") as file:
            loaded = json.load(file)
        if isinstance(loaded, dict):
            return loaded
        logger.warning("App config at %s is not a JSON object, treating as empty", config_path)
        return {}
    except Exception as exc:
        logger.warning("Failed reading app config at %s: %s", config_path, exc)
        return {}


def _atomic_write_json(config_path: Path, data: Dict[str, Any]) -> None:
    config_path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = config_path.with_name(f".{config_path.name}.tmp")
    with temp_path.open("w", encoding="utf-8") as file:
        json.dump(data, file, indent=2)
        file.write("\n")
    temp_path.replace(config_path)


def _coerce_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"true", "1", "yes", "y", "on"}:
            return True
        if normalized in {"false", "0", "no", "n", "off"}:
            return False
    raise ValueError("Expected boolean value")


def _coerce_int(value: Any) -> int:
    if isinstance(value, bool):
        raise ValueError("Expected integer value")
    if isinstance(value, int):
        return value
    if isinstance(value, str):
        stripped = value.strip()
        if not stripped:
            raise ValueError("Expected integer value")
        return int(stripped)
    return int(value)


def _coerce_string_list(value: Any) -> List[str]:
    if isinstance(value, str):
        # Accept newline/comma input for easier text-area editing.
        candidates = [item.strip() for item in value.replace(",", "\n").splitlines()]
        return [item for item in candidates if item]

    if isinstance(value, (list, tuple)):
        normalized: List[str] = []
        for item in value:
            if not isinstance(item, str):
                raise ValueError("Expected list of strings")
            stripped = item.strip()
            if stripped:
                normalized.append(stripped)
        return normalized

    raise ValueError("Expected list of strings")


def _normalize_for_compare(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"))


def _validate_value(field: AppSettingField, value: Any) -> ValidatedSettingValue:
    coerced: ValidatedSettingValue
    if field.value_type == "boolean":
        coerced = _coerce_bool(value)
    elif field.value_type == "integer":
        coerced = _coerce_int(value)
    elif field.value_type == "string":
        coerced = str(value).strip() if value is not None else ""
    elif field.value_type == "string_list":
        coerced = _coerce_string_list(value)
    else:
        raise ValueError(f"Unsupported field type '{field.value_type}'")

    if field.choices and coerced not in field.choices:
        raise ValueError(f"Value must be one of: {', '.join(map(str, field.choices))}")

    # Empty service URLs leave their optional integrations disabled.
    if field.key in {"parakeet_url", "libretranslate_url"} and coerced:
        parsed = urlsplit(str(coerced))
        if (
            parsed.scheme not in {"http", "https"}
            or not parsed.hostname
            or parsed.username is not None
            or parsed.password is not None
            or parsed.query
            or parsed.fragment
            or any(character.isspace() for character in str(coerced))
        ):
            raise ValueError(
                "Enter an HTTP or HTTPS service URL without credentials or query parameters"
            )
        try:
            port = parsed.port  # Accessing port rejects malformed port numbers.
        except ValueError as exc:
            raise ValueError("Enter a valid service port") from exc
        if port == 0:
            raise ValueError("Enter a valid service port")

    if isinstance(coerced, int):
        if field.minimum is not None and coerced < field.minimum:
            raise ValueError(f"Value must be >= {field.minimum}")
        if field.maximum is not None and coerced > field.maximum:
            raise ValueError(f"Value must be <= {field.maximum}")

    return coerced


def _field_defined_in_file(field: AppSettingField, raw_config: Dict[str, Any]) -> bool:
    if field.key in raw_config:
        return True
    alias = LEGACY_ALIASES.get(field.key)
    return bool(alias and alias in raw_config)


def _field_value_from_runtime(field: AppSettingField) -> Any:
    value = getattr(arguments, field.key, field.default)
    if field.value_type == "string_list":
        return _coerce_string_list(value)
    if field.value_type == "boolean":
        return bool(value)
    if field.value_type == "integer":
        try:
            return _coerce_int(value)
        except Exception:
            return field.default
    return str(value) if value is not None else ""


class AppSettingsService:
    def __init__(self):
        self.config_path = resolved_app_config_path

    def get_payload(self) -> Dict[str, Any]:
        raw_config = _read_config_dict(self.config_path)
        values: Dict[str, Any] = {}
        source_by_key: Dict[str, str] = {}
        locked_by_key: Dict[str, bool] = {}
        defined_in_file: Dict[str, bool] = {}

        for field in FIELDS:
            values[field.key] = _field_value_from_runtime(field)
            key_defined = _field_defined_in_file(field, raw_config)
            defined_in_file[field.key] = key_defined
            locked_by_key[field.key] = field.key in app_config_cli_overrides
            if locked_by_key[field.key]:
                source_by_key[field.key] = "cli"
            elif key_defined:
                source_by_key[field.key] = "file"
            else:
                source_by_key[field.key] = "default"

        return {
            "config_path": str(self.config_path),
            "fields": [field.to_dict() for field in FIELDS],
            "values": values,
            "source": source_by_key,
            "locked": locked_by_key,
            "defined_in_file": defined_in_file,
            "overridden_by_cli": sorted(app_config_cli_overrides),
        }

    def update(self, updates: Dict[str, Any]) -> Dict[str, Any]:
        if not isinstance(updates, dict) or not updates:
            return {"success": False, "error": "No settings provided"}

        unknown_keys = sorted(key for key in updates.keys() if key not in FIELDS_BY_KEY)
        if unknown_keys:
            return {
                "success": False,
                "error": f"Unknown settings: {', '.join(unknown_keys)}",
            }

        raw_config = _read_config_dict(self.config_path)
        write_config = dict(raw_config)
        write_config.setdefault(
            "_comment", DEFAULT_APP_CONFIG.get("_comment", "Ground Station app config")
        )
        changed_keys: List[str] = []
        changed_hot_keys: List[str] = []
        changed_restart_keys: List[str] = []
        validation_errors: Dict[str, str] = {}

        for key, input_value in updates.items():
            field = FIELDS_BY_KEY[key]
            if key in app_config_cli_overrides:
                # Saving a CLI-controlled value would report success but never change the runtime.
                validation_errors[key] = (
                    "Controlled by a startup command; change that command instead"
                )
                continue
            try:
                normalized_value = _validate_value(field, input_value)
            except Exception as exc:
                validation_errors[key] = str(exc)
                continue

            previous_value = write_config.get(key, field.default)
            if _normalize_for_compare(previous_value) != _normalize_for_compare(normalized_value):
                changed_keys.append(key)
                if field.apply_mode == "hot":
                    changed_hot_keys.append(key)
                else:
                    changed_restart_keys.append(key)

            write_config[key] = normalized_value

            alias = LEGACY_ALIASES.get(key)
            if alias and alias in write_config:
                # Keep future configs canonical; legacy keys are fallback-read only.
                write_config.pop(alias, None)

        if validation_errors:
            return {
                "success": False,
                "error": "One or more settings are invalid",
                "data": {"validation_errors": validation_errors},
            }

        if changed_keys:
            try:
                _atomic_write_json(self.config_path, write_config)
            except Exception as exc:
                logger.error("Failed writing app config to %s: %s", self.config_path, exc)
                return {
                    "success": False,
                    "error": f"Failed writing app config file: {exc}",
                }

            # Only keys marked as hot are updated in-process.
            for key in changed_hot_keys:
                setattr(arguments, key, write_config[key])
                alias = LEGACY_ALIASES.get(key)
                if alias:
                    setattr(arguments, alias, write_config[key])

        payload = self.get_payload()
        payload.update(
            {
                "changed_keys": changed_keys,
                "changed_hot_keys": changed_hot_keys,
                "changed_restart_keys": changed_restart_keys,
                "restart_required": bool(changed_restart_keys),
            }
        )
        return {"success": True, "data": payload}


app_settings_service = AppSettingsService()
