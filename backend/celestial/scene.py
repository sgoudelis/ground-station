# Copyright (c) 2025 Efstratios Goudelis
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Scene builder for celestial page (Horizons-backed solar system + targets)."""

from __future__ import annotations

import asyncio
import math
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

import crud.celestialvectors as crud_celestial_vectors
import crud.locations as crud_locations
import crud.monitoredcelestial as crud_monitored
from celestial.asteroidzones import get_static_asteroid_zones
from celestial.bodycatalog import list_celestial_bodies
from celestial.horizons import fetch_celestial_vectors
from celestial.observermath import compute_observer_sky_position
from common.arguments import arguments
from db import AsyncSessionLocal


def _config_int(name: str, default: int, minimum: int) -> int:
    try:
        value = int(getattr(arguments, name, default))
    except (TypeError, ValueError):
        value = int(default)
    return max(minimum, value)


# Celestial cache policy is fixed by code, not by app config.
CACHE_TTL_SECONDS = 120
VECTOR_DB_TTL_SECONDS = 2 * 60 * 60
VECTOR_EPOCH_BUCKET_MINUTES = 60
COMPUTED_EPOCH_BUCKET_SECONDS = 60
SCHEDULED_SYNC_PAST_HOURS = _config_int("celestial_sync_past_hours", 1, 0)
SCHEDULED_SYNC_FUTURE_HOURS = 24
SCHEDULED_SYNC_STEP_MINUTES = 60
MAX_SAMPLES_PER_TARGET = 1500
DEFAULT_CELESTIAL_TARGETS: List[Dict[str, str]] = []
CELESTIAL_PASS_HORIZON_DEG = 0.0
CURVE_DENSIFY_TARGET_STEP_SECONDS = 5 * 60
CURVE_DENSIFY_MAX_INSERTS_PER_SEGMENT = 8
OBSERVER_SKY_TARGET_STEP_MINUTES = 5
MAX_OBSERVER_SKY_SAMPLES_PER_TARGET = 1500
DEFAULT_FRAME = "heliocentric-ecliptic"
DEFAULT_CENTER = "sun"
BODY_HORIZONS_COMMANDS: Dict[str, str] = {
    # Major planets.
    "mercury": "199",
    "venus": "299",
    "earth": "399",
    "mars": "499",
    "jupiter": "599",
    "saturn": "699",
    "uranus": "799",
    "neptune": "899",
    # IAU-recognized dwarf planets.
    # Use small-body selector for Ceres to avoid major-body ID collision with Mercury.
    "ceres": "1;",
    "pluto": "999",
    "haumea": "136108",
    "makemake": "136472",
    "eris": "136199",
    # Moons currently exposed by the body catalog.
    "moon": "301",
    "io": "501",
    "europa": "502",
    "ganymede": "503",
    "callisto": "504",
    "enceladus": "602",
    "rhea": "605",
    "titan": "606",
    "iapetus": "608",
}
_BODY_CATALOG_BY_ID: Dict[str, Dict[str, Any]] = {
    str(item.get("body_id") or "").strip().lower(): item
    for item in list_celestial_bodies()
    if str(item.get("body_id") or "").strip()
}


@dataclass
class CacheEntry:
    payload: Dict[str, Any]
    fetched_at_monotonic: float


_computed_cache: Dict[str, CacheEntry] = {}
_computed_cache_lock = threading.Lock()
_scheduled_sync_lock = asyncio.Lock()


def _target_key_from_parts(
    target_type: str,
    *,
    command: Optional[str] = None,
    body_id: Optional[str] = None,
) -> str:
    normalized_type = str(target_type or "mission").strip().lower()
    if normalized_type == "body":
        normalized_body = str(body_id or "").strip().lower()
        return f"body:{normalized_body}" if normalized_body else ""
    normalized_command = str(command or "").strip()
    return f"mission:{normalized_command}" if normalized_command else ""


def _parse_epoch(data: Optional[Dict[str, Any]]) -> datetime:
    if not data:
        return datetime.now(timezone.utc)

    epoch_raw = data.get("epoch")
    if not epoch_raw:
        return datetime.now(timezone.utc)

    try:
        epoch_str = str(epoch_raw).strip()
        if epoch_str.endswith("Z"):
            epoch_str = epoch_str[:-1] + "+00:00"
        parsed = datetime.fromisoformat(epoch_str)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)
    except Exception:
        return datetime.now(timezone.utc)


def _build_body_target_payload(
    *,
    body_id: str,
    name: Optional[str] = None,
    color: Any = None,
    target_key: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    normalized_body_id = str(body_id or "").strip().lower()
    if not normalized_body_id:
        return None

    catalog_entry = _BODY_CATALOG_BY_ID.get(normalized_body_id) or {}
    body_class = str(catalog_entry.get("body_type") or "").strip().lower() or None
    parent_body_id = str(catalog_entry.get("parent_body_id") or "").strip().lower() or None
    horizons_command = str(BODY_HORIZONS_COMMANDS.get(normalized_body_id) or "").strip()
    display_name = str(name or catalog_entry.get("name") or normalized_body_id).strip()

    return {
        "target_type": "body",
        "target_key": str(
            target_key or _target_key_from_parts("body", body_id=normalized_body_id)
        ).strip(),
        "body_id": normalized_body_id,
        # Keep "command" populated for existing UI/tooling paths that expect a command-like field.
        "command": horizons_command or normalized_body_id,
        "horizons_command": horizons_command,
        "name": display_name,
        "color": color,
        "body_class": body_class,
        "parent_body_id": parent_body_id,
        "always_in_scene": normalized_body_id != "sun",
    }


def _normalize_targets(data: Optional[Dict[str, Any]]) -> List[Dict[str, Any]]:
    if not data:
        return DEFAULT_CELESTIAL_TARGETS.copy()

    requested = data.get("celestial")
    if not requested:
        return DEFAULT_CELESTIAL_TARGETS.copy()

    normalized: List[Dict[str, Any]] = []

    for item in requested:
        if isinstance(item, str):
            command = item.strip()
            if command:
                normalized.append(
                    {
                        "target_type": "mission",
                        "target_key": _target_key_from_parts("mission", command=command),
                        "command": command,
                        "horizons_command": command,
                        "name": command,
                    }
                )
            continue

        if isinstance(item, dict):
            color = item.get("color")
            target_type = (
                str(item.get("target_type") or item.get("targetType") or "mission").strip().lower()
            )

            if target_type == "body":
                body_id = (
                    str(
                        item.get("body_id")
                        or item.get("bodyId")
                        or item.get("id")
                        or item.get("target")
                        or ""
                    )
                    .strip()
                    .lower()
                )
                if not body_id:
                    continue
                body_payload = _build_body_target_payload(
                    body_id=body_id,
                    name=str(item.get("name") or body_id).strip(),
                    color=color,
                    target_key=_target_key_from_parts("body", body_id=body_id),
                )
                if body_payload:
                    normalized.append(body_payload)
                continue

            command = str(item.get("command") or item.get("id") or item.get("target") or "").strip()
            if not command:
                continue
            name = str(item.get("name") or command).strip()
            normalized.append(
                {
                    "target_type": "mission",
                    "target_key": _target_key_from_parts("mission", command=command),
                    "command": command,
                    "horizons_command": command,
                    "name": name,
                    "color": color,
                }
            )

    return normalized


def _build_builtin_body_targets() -> List[Dict[str, Any]]:
    """Build the always-in-scene body target list from the body catalog."""
    rows: List[Dict[str, Any]] = []
    for entry in list_celestial_bodies():
        body_id = str(entry.get("body_id") or "").strip().lower()
        if not body_id or body_id == "sun":
            continue

        body_payload = _build_body_target_payload(
            body_id=body_id,
            name=str(entry.get("name") or body_id).strip(),
            target_key=_target_key_from_parts("body", body_id=body_id),
        )
        if not body_payload:
            continue
        body_payload["always_in_scene"] = True
        rows.append(body_payload)
    return rows


async def _ensure_scene_targets_registered(
    targets: List[Dict[str, Any]],
    logger: Any,
) -> None:
    """Persist target metadata so snapshots can reference an explicit target row."""
    if not targets:
        return

    upsert_rows: List[Dict[str, Any]] = []
    for target in targets:
        target_key = str(target.get("target_key") or "").strip()
        target_type = str(target.get("target_type") or "").strip().lower()
        if not target_key or target_type not in {"mission", "body"}:
            continue

        upsert_rows.append(
            {
                "id": target_key,
                "target_type": target_type,
                "body_class": target.get("body_class"),
                "display_name": str(target.get("name") or target_key).strip(),
                "horizons_command": str(
                    target.get("horizons_command") or target.get("command") or ""
                ).strip()
                or None,
                "body_id": str(target.get("body_id") or "").strip().lower() or None,
                "parent_body_id": str(target.get("parent_body_id") or "").strip().lower() or None,
                "always_in_scene": bool(target.get("always_in_scene", False)),
                "enabled": True,
            }
        )

    if not upsert_rows:
        return

    async with AsyncSessionLocal() as dbsession:
        result = await crud_celestial_vectors.ensure_celestial_targets(dbsession, upsert_rows)
    if not result.get("success"):
        logger.warning("Failed to register celestial targets: %s", result.get("error"))


def _parse_projection_options(data: Optional[Dict[str, Any]]) -> Tuple[int, int, int]:
    if not data:
        return 24, 24, 60

    def parse_int(name: str, default: int, low: int, high: int) -> int:
        try:
            value = int(data.get(name, default))
        except (TypeError, ValueError):
            return default
        return max(low, min(high, value))

    past_hours = parse_int("past_hours", 24, 1, 24 * 365)
    future_hours = parse_int("future_hours", 24, 1, 24 * 365)
    step_minutes = parse_int("step_minutes", 60, 5, 24 * 60)
    adaptive_step_minutes = _compute_adaptive_step_minutes(
        past_hours=past_hours,
        future_hours=future_hours,
        requested_step_minutes=step_minutes,
        max_samples=MAX_SAMPLES_PER_TARGET,
    )
    return past_hours, future_hours, adaptive_step_minutes


def _parse_iso_utc(value: Any) -> Optional[datetime]:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        if text.endswith("Z"):
            text = text[:-1] + "+00:00"
        parsed = datetime.fromisoformat(text)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)
    except Exception:
        return None


def _build_window_timestamps(
    epoch: datetime,
    past_hours: int,
    future_hours: int,
    step_minutes: int,
) -> List[datetime]:
    start = epoch - timedelta(hours=int(past_hours))
    end = epoch + timedelta(hours=int(future_hours))
    step = timedelta(minutes=max(1, int(step_minutes)))
    timestamps: List[datetime] = []
    current = start
    while current <= end:
        timestamps.append(current)
        current = current + step
    if not timestamps or timestamps[-1] < end:
        timestamps.append(end)
    return timestamps


def _round_up(value: int, base: int) -> int:
    if base <= 1:
        return max(1, value)
    return int(math.ceil(value / base) * base)


def _compute_adaptive_step_minutes(
    past_hours: int,
    future_hours: int,
    requested_step_minutes: int,
    max_samples: int,
) -> int:
    span_hours = max(1, int(past_hours) + int(future_hours))

    # Increase minimum resolution progressively as window span grows.
    if span_hours <= 72:
        min_step_for_span = 30
    elif span_hours <= 14 * 24:
        min_step_for_span = 60
    elif span_hours <= 60 * 24:
        min_step_for_span = 180
    elif span_hours <= 180 * 24:
        min_step_for_span = 360
    else:
        min_step_for_span = 720

    effective_step = max(int(requested_step_minutes), min_step_for_span)

    # Enforce hard sample cap per target by raising step if needed.
    span_minutes = span_hours * 60
    estimated_samples = int(span_minutes / effective_step) + 1
    if estimated_samples > max_samples:
        required_step = _round_up(
            int(math.ceil(span_minutes / max(1, max_samples - 1))),
            5,
        )
        effective_step = max(effective_step, required_step)

    return min(max(5, effective_step), 24 * 60)


def _compute_observer_sample_step_minutes(
    past_hours: int,
    future_hours: int,
    source_step_minutes: int,
) -> int:
    """Choose local sky sampling density without requiring extra Horizons calls."""
    span_hours = max(1, int(past_hours) + int(future_hours))
    span_minutes = span_hours * 60

    # Short planetarium windows need real az/el samples, otherwise each sparse
    # vector sample becomes a visible kink in the projected sky path.
    if span_hours <= 72:
        desired_step = OBSERVER_SKY_TARGET_STEP_MINUTES
    elif span_hours <= 14 * 24:
        desired_step = 15
    elif span_hours <= 60 * 24:
        desired_step = 60
    elif span_hours <= 180 * 24:
        desired_step = 180
    else:
        desired_step = 360

    source_step = max(OBSERVER_SKY_TARGET_STEP_MINUTES, int(source_step_minutes))
    effective_step = min(source_step, desired_step)
    estimated_samples = int(span_minutes / effective_step) + 1
    if estimated_samples > MAX_OBSERVER_SKY_SAMPLES_PER_TARGET:
        required_step = _round_up(
            int(math.ceil(span_minutes / max(1, MAX_OBSERVER_SKY_SAMPLES_PER_TARGET - 1))),
            OBSERVER_SKY_TARGET_STEP_MINUTES,
        )
        effective_step = max(effective_step, required_step)

    return min(max(OBSERVER_SKY_TARGET_STEP_MINUTES, effective_step), 24 * 60)


def _bucket_epoch(epoch: datetime, bucket_seconds: int) -> datetime:
    utc_epoch = epoch.astimezone(timezone.utc)
    timestamp = int(utc_epoch.timestamp())
    bucketed = timestamp - (timestamp % max(1, int(bucket_seconds)))
    return datetime.fromtimestamp(bucketed, tz=timezone.utc)


def _extract_orbit_samples(
    payload: Dict[str, Any],
    *,
    epoch_fallback: datetime,
    past_hours: int,
    future_hours: int,
) -> List[Tuple[datetime, List[float]]]:
    positions_obj = payload.get("orbit_samples_xyz_au")
    positions: List[List[float]] = []
    if isinstance(positions_obj, list):
        for sample in positions_obj:
            if not isinstance(sample, list) or len(sample) < 3:
                continue
            try:
                position = [float(sample[0]), float(sample[1]), float(sample[2])]
            except (TypeError, ValueError):
                continue
            positions.append(position)

    if len(positions) < 2:
        return []

    raw_times_obj = payload.get("orbit_sample_times_utc")
    sample_times: List[datetime] = []
    if isinstance(raw_times_obj, list) and len(raw_times_obj) == len(positions):
        parsed_times = [_parse_iso_utc(item) for item in raw_times_obj]
        if all(item is not None for item in parsed_times):
            sample_times = [item for item in parsed_times if item is not None]

    if len(sample_times) != len(positions):
        start = epoch_fallback - timedelta(hours=int(past_hours))
        span_seconds = max(1.0, float((int(past_hours) + int(future_hours)) * 3600))
        if len(positions) == 1:
            sample_times = [epoch_fallback]
        else:
            sample_times = [
                start + timedelta(seconds=(span_seconds * idx / max(1, len(positions) - 1)))
                for idx in range(len(positions))
            ]

    return list(zip(sample_times, positions))


def _interpolate_position_from_samples(
    samples: List[Tuple[datetime, List[float]]],
    at_time: datetime,
) -> Optional[List[float]]:
    if not samples:
        return None
    ordered = sorted(samples, key=lambda item: item[0])
    first_time, first_pos = ordered[0]
    last_time, last_pos = ordered[-1]
    if at_time <= first_time:
        return [float(first_pos[0]), float(first_pos[1]), float(first_pos[2])]
    if at_time >= last_time:
        return [float(last_pos[0]), float(last_pos[1]), float(last_pos[2])]

    cursor = 0
    for sample_time, _sample_position in ordered[1:]:
        if sample_time >= at_time:
            break
        cursor += 1
    left_time, left_pos = ordered[cursor]
    right_time, right_pos = ordered[cursor + 1]
    span_seconds = (right_time - left_time).total_seconds()
    if span_seconds <= 1e-9:
        return [float(left_pos[0]), float(left_pos[1]), float(left_pos[2])]
    ratio = max(0.0, min(1.0, (at_time - left_time).total_seconds() / span_seconds))
    return [
        float(left_pos[0]) + ((float(right_pos[0]) - float(left_pos[0])) * ratio),
        float(left_pos[1]) + ((float(right_pos[1]) - float(left_pos[1])) * ratio),
        float(left_pos[2]) + ((float(right_pos[2]) - float(left_pos[2])) * ratio),
    ]


def _interpolate_position_xyz_au_at_epoch(
    *,
    payload: Dict[str, Any],
    epoch: datetime,
    past_hours: int,
    future_hours: int,
) -> Optional[List[float]]:
    """Interpolate a mission position at the requested epoch using cached orbit samples."""
    samples = _extract_orbit_samples(
        payload,
        epoch_fallback=epoch,
        past_hours=past_hours,
        future_hours=future_hours,
    )
    if not samples:
        return None

    ordered = sorted(samples, key=lambda item: item[0])
    first_time, first_pos = ordered[0]
    last_time, last_pos = ordered[-1]
    if epoch <= first_time:
        return [float(first_pos[0]), float(first_pos[1]), float(first_pos[2])]
    if epoch >= last_time:
        return [float(last_pos[0]), float(last_pos[1]), float(last_pos[2])]

    for index in range(1, len(ordered)):
        left_time, left_pos = ordered[index - 1]
        right_time, right_pos = ordered[index]
        if epoch > right_time:
            continue

        span_seconds = (right_time - left_time).total_seconds()
        if span_seconds <= 1e-9:
            return [float(left_pos[0]), float(left_pos[1]), float(left_pos[2])]
        ratio = max(0.0, min(1.0, (epoch - left_time).total_seconds() / span_seconds))
        return [
            float(left_pos[0]) + ((float(right_pos[0]) - float(left_pos[0])) * ratio),
            float(left_pos[1]) + ((float(right_pos[1]) - float(left_pos[1])) * ratio),
            float(left_pos[2]) + ((float(right_pos[2]) - float(left_pos[2])) * ratio),
        ]

    return [float(last_pos[0]), float(last_pos[1]), float(last_pos[2])]


def _extract_earth_position_xyz_au(planets: List[Dict[str, Any]]) -> Optional[List[float]]:
    for body in planets:
        if str(body.get("id") or "").lower() == "earth":
            position = body.get("position_xyz_au")
            if isinstance(position, list) and len(position) >= 3:
                try:
                    return [float(position[0]), float(position[1]), float(position[2])]
                except (TypeError, ValueError):
                    return None
    return None


def _extract_earth_orbit_samples(
    rows: List[Dict[str, Any]],
    *,
    epoch: datetime,
    past_hours: int,
    future_hours: int,
) -> List[Tuple[datetime, List[float]]]:
    """Extract Earth heliocentric orbit samples from scene rows when available."""
    for row in rows:
        if str(row.get("id") or "").strip().lower() != "earth":
            continue
        samples = _extract_orbit_samples(
            row,
            epoch_fallback=epoch,
            past_hours=past_hours,
            future_hours=future_hours,
        )
        if samples:
            return samples
        break
    return []


async def _load_earth_observer_vectors(
    *,
    epoch: datetime,
    past_hours: int,
    future_hours: int,
    step_minutes: int,
    observer_location: Optional[Dict[str, Any]],
    force_refresh: bool,
    allow_network_fetch: bool,
    logger: Any,
) -> Tuple[Optional[List[float]], List[Tuple[datetime, List[float]]]]:
    """
    Load Earth vectors using the same Horizons snapshot pipeline as targets.

    Using Earth vectors from the same source avoids observer-angle drift caused by
    mixing Horizons target vectors with low-precision Earth ephemerides.
    """
    earth_snapshot = await _get_vectors_snapshot(
        target_key=_target_key_from_parts("body", body_id="earth"),
        command=str(BODY_HORIZONS_COMMANDS.get("earth") or "399"),
        epoch=epoch,
        past_hours=past_hours,
        future_hours=future_hours,
        step_minutes=step_minutes,
        observer_location=observer_location,
        force_refresh=force_refresh,
        logger=logger,
        allow_network_fetch=allow_network_fetch,
    )
    payload = earth_snapshot.get("payload")
    if isinstance(payload, dict):
        earth_samples = _extract_orbit_samples(
            payload,
            epoch_fallback=epoch,
            past_hours=past_hours,
            future_hours=future_hours,
        )
        position_obj = payload.get("position_xyz_au")
        if isinstance(position_obj, list) and len(position_obj) >= 3:
            try:
                return (
                    [float(position_obj[0]), float(position_obj[1]), float(position_obj[2])],
                    earth_samples,
                )
            except (TypeError, ValueError):
                pass
        interpolated = _interpolate_position_from_samples(earth_samples, epoch)
        if interpolated:
            return interpolated, earth_samples
        logger.warning(
            "Earth Horizons payload is missing usable observer vectors (cache=%s)",
            earth_snapshot.get("cache"),
        )
    else:
        logger.warning(
            "Earth Horizons vectors unavailable for observer calculations (cache=%s error=%s)",
            earth_snapshot.get("cache"),
            earth_snapshot.get("error"),
        )

    # Never fall back to low-precision Earth vectors for observer pass calculations.
    return None, []


def _build_body_snapshot_by_id(planets: List[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    snapshot = {
        str(body.get("id") or "").strip().lower(): dict(body) for body in planets if body.get("id")
    }
    # Sun is the heliocentric frame origin; expose it as a selectable body target
    # without duplicating it in the regular planets array.
    snapshot.setdefault(
        "sun",
        {
            "id": "sun",
            "name": "Sun",
            "body_type": "star",
            "position_xyz_au": [0.0, 0.0, 0.0],
            "velocity_xyz_au_per_day": [0.0, 0.0, 0.0],
            "orbit_samples_xyz_au": [],
            "phase": None,
        },
    )
    return snapshot


async def _build_horizons_solar_system_bodies(
    *,
    epoch: datetime,
    past_hours: int,
    future_hours: int,
    step_minutes: int,
    observer_location: Optional[Dict[str, Any]],
    force_refresh: bool,
    allow_network_fetch: bool,
    logger: Any,
) -> Tuple[Dict[str, Any], List[Dict[str, Any]]]:
    """
    Build the solar-system body list from Horizons snapshots.

    This list is independent from monitored targets and is always included in scene payloads.
    """
    builtin_targets = _build_builtin_body_targets()
    await _ensure_scene_targets_registered(builtin_targets, logger)

    planets: List[Dict[str, Any]] = []
    stale_count = 0
    missing_count = 0
    for target in builtin_targets:
        body_id = str(target.get("body_id") or "").strip().lower()
        target_key = str(target.get("target_key") or "").strip()
        command = str(target.get("horizons_command") or "").strip()
        if not body_id or not target_key or not command:
            continue

        snapshot = await _get_vectors_snapshot(
            target_key=target_key,
            command=command,
            epoch=epoch,
            past_hours=past_hours,
            future_hours=future_hours,
            step_minutes=step_minutes,
            observer_location=observer_location,
            force_refresh=force_refresh,
            logger=logger,
            allow_network_fetch=allow_network_fetch,
        )
        payload = snapshot.get("payload")
        if not isinstance(payload, dict):
            missing_count += 1
            # Keep a body metadata row when Horizons is unavailable. Do not
            # synthesize origin vectors here: [0,0,0] is the heliocentric Sun
            # and would create misleading overlap in the solar-system canvas.
            planets.append(
                {
                    "id": body_id,
                    "name": str(target.get("name") or body_id),
                    "body_type": target.get("body_class") or "body",
                    "parent_id": target.get("parent_body_id"),
                    "position_xyz_au": None,
                    "velocity_xyz_au_per_day": None,
                    "orbit_samples_xyz_au": [],
                    "source": "horizons",
                    "cache": snapshot.get("cache"),
                    "stale": True,
                    "error": snapshot.get("error") or "No data returned",
                    "phase": None,
                }
            )
            continue

        row_payload = {
            "id": body_id,
            "name": str(target.get("name") or body_id),
            "body_type": target.get("body_class") or "body",
            "parent_id": target.get("parent_body_id"),
            "position_xyz_au": payload.get("position_xyz_au"),
            "velocity_xyz_au_per_day": payload.get("velocity_xyz_au_per_day"),
            "orbit_samples_xyz_au": payload.get("orbit_samples_xyz_au") or [],
            "orbit_sample_times_utc": payload.get("orbit_sample_times_utc") or [],
            "source": payload.get("source") or "horizons",
            "cache": snapshot.get("cache"),
            "stale": bool(snapshot.get("stale")),
            "phase": None,
        }
        if snapshot.get("error"):
            row_payload["error"] = snapshot.get("error")
        if row_payload["stale"]:
            stale_count += 1
        planets.append(row_payload)

    solar_meta = {
        "source": "horizons",
        "reference": "JPL Horizons vectors",
        "epoch_utc": epoch.astimezone(timezone.utc).isoformat(),
        "body_type_counts": {
            "planet": sum(1 for row in planets if str(row.get("body_type")) == "planet"),
            "dwarf": sum(1 for row in planets if str(row.get("body_type")) == "dwarf"),
            "moon": sum(1 for row in planets if str(row.get("body_type")) == "moon"),
        },
        "cache": {
            "stale_count": stale_count,
            "missing_count": missing_count,
        },
    }

    return solar_meta, planets


async def _load_observer_location() -> Optional[Dict[str, Any]]:
    """Load the first configured ground-station location for observer sky coordinates."""
    async with AsyncSessionLocal() as dbsession:
        result = await crud_locations.fetch_all_locations(dbsession)

    rows_obj = result.get("data") if isinstance(result, dict) else None
    rows = rows_obj if isinstance(rows_obj, list) else []
    if not rows:
        return None

    first = rows[0]
    try:
        lat = float(first.get("lat"))
        lon = float(first.get("lon"))
        alt_m = float(first.get("alt") or 0.0)
    except (TypeError, ValueError):
        return None

    return {
        "id": first.get("id"),
        "name": first.get("name"),
        "lat": lat,
        "lon": lon,
        "alt_m": alt_m,
    }


def _attach_observer_view_local(
    row: Dict[str, Any],
    epoch: datetime,
    observer_location: Optional[Dict[str, Any]],
    earth_position_xyz_au: Optional[List[float]],
    logger: Any,
) -> None:
    """Attach observer-centric sky position and visibility metadata using local math."""
    if not observer_location or not earth_position_xyz_au:
        row["sky_position"] = None
        row["visibility"] = {
            "above_horizon": None,
            "visible": None,
            "horizon_threshold_deg": 0.0,
        }
        return

    target_position = row.get("position_xyz_au")
    if not isinstance(target_position, list) or len(target_position) < 3:
        row["sky_position"] = None
        row["visibility"] = {
            "above_horizon": None,
            "visible": None,
            "horizon_threshold_deg": 0.0,
            "error": "Missing target position vector",
        }
        return

    try:
        observer_view = compute_observer_sky_position(
            target_heliocentric_xyz_au=[
                float(target_position[0]),
                float(target_position[1]),
                float(target_position[2]),
            ],
            earth_heliocentric_xyz_au=earth_position_xyz_au,
            epoch=epoch,
            observer_lat_deg=float(observer_location["lat"]),
            observer_lon_deg=float(observer_location["lon"]),
        )
        row["sky_position"] = observer_view.get("sky_position")
        row["visibility"] = observer_view.get("visibility")
    except Exception as exc:
        logger.warning(f"Local observer math failed for celestial '{row.get('command')}': {exc}")
        row["sky_position"] = None
        row["visibility"] = {
            "above_horizon": None,
            "visible": None,
            "horizon_threshold_deg": 0.0,
            "error": str(exc),
        }


def _interpolate_crossing_point(
    previous: Dict[str, Any],
    current: Dict[str, Any],
    horizon_deg: float,
) -> Dict[str, Any]:
    prev_el = float(previous["el_deg"])
    curr_el = float(current["el_deg"])
    prev_time = previous["time"]
    curr_time = current["time"]
    denominator = curr_el - prev_el
    if abs(denominator) < 1e-9:
        ratio = 0.0
    else:
        ratio = (float(horizon_deg) - prev_el) / denominator
    ratio = max(0.0, min(1.0, ratio))

    crossing_time = prev_time + timedelta(seconds=(curr_time - prev_time).total_seconds() * ratio)
    prev_az = float(previous["az_deg"])
    curr_az = float(current["az_deg"])
    delta_az = ((curr_az - prev_az + 540.0) % 360.0) - 180.0
    crossing_az = (prev_az + (delta_az * ratio)) % 360.0

    return {
        "time": crossing_time,
        "az_deg": crossing_az,
        "el_deg": float(horizon_deg),
    }


def _serialize_pass_curve_point(
    point: Dict[str, Any],
    *,
    elevation_deg: Optional[float] = None,
) -> Dict[str, Any]:
    point_time = point["time"]
    point_elevation = float(elevation_deg) if elevation_deg is not None else float(point["el_deg"])
    return {
        "time": point_time.astimezone(timezone.utc).isoformat(),
        "azimuth": float(point["az_deg"]),
        "elevation": point_elevation,
    }


def _deduplicate_curve_points(points: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    deduplicated: List[Dict[str, Any]] = []
    for point in points:
        point_time = str(point.get("time") or "").strip()
        if deduplicated and deduplicated[-1].get("time") == point_time:
            if float(point.get("elevation", -math.inf)) >= float(
                deduplicated[-1].get("elevation", -math.inf)
            ):
                deduplicated[-1] = point
            continue
        deduplicated.append(point)
    return deduplicated


def _interpolate_serialized_curve_point(
    previous: Dict[str, Any],
    current: Dict[str, Any],
    ratio: float,
) -> Optional[Dict[str, Any]]:
    prev_time = _parse_iso_utc(previous.get("time"))
    curr_time = _parse_iso_utc(current.get("time"))
    if not prev_time or not curr_time:
        return None

    ratio = max(0.0, min(1.0, float(ratio)))
    point_time = prev_time + timedelta(seconds=(curr_time - prev_time).total_seconds() * ratio)

    prev_az = float(previous.get("azimuth", 0.0))
    curr_az = float(current.get("azimuth", prev_az))
    # Interpolate azimuth using the shortest angular delta to avoid wrap jumps near 0°/360°.
    delta_az = ((curr_az - prev_az + 540.0) % 360.0) - 180.0
    azimuth = (prev_az + (delta_az * ratio)) % 360.0

    prev_el = float(previous.get("elevation", 0.0))
    curr_el = float(current.get("elevation", prev_el))
    elevation = prev_el + ((curr_el - prev_el) * ratio)

    return {
        "time": point_time.astimezone(timezone.utc).isoformat(),
        "azimuth": azimuth,
        "elevation": elevation,
    }


def _densify_curve_points(points: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    if len(points) < 2:
        return points

    densified: List[Dict[str, Any]] = [points[0]]
    for index in range(1, len(points)):
        previous = points[index - 1]
        current = points[index]
        prev_time = _parse_iso_utc(previous.get("time"))
        curr_time = _parse_iso_utc(current.get("time"))
        if prev_time and curr_time:
            delta_seconds = max(0.0, (curr_time - prev_time).total_seconds())
            if delta_seconds > float(CURVE_DENSIFY_TARGET_STEP_SECONDS):
                desired_segments = int(
                    math.ceil(delta_seconds / float(CURVE_DENSIFY_TARGET_STEP_SECONDS))
                )
                # Keep growth bounded on very large windows while still smoothing sparse segments.
                insert_count = max(
                    0,
                    min(CURVE_DENSIFY_MAX_INSERTS_PER_SEGMENT, desired_segments - 1),
                )
                for insert_index in range(1, insert_count + 1):
                    ratio = insert_index / float(insert_count + 1)
                    interpolated = _interpolate_serialized_curve_point(previous, current, ratio)
                    if interpolated:
                        densified.append(interpolated)
        densified.append(current)
    return _deduplicate_curve_points(densified)


def _build_pass_elevation_curve(
    *,
    ordered_samples: List[Dict[str, Any]],
    start_index: int,
    end_index: int,
    start_crossing: Optional[Dict[str, Any]],
    end_crossing: Optional[Dict[str, Any]],
    horizon_deg: float,
) -> List[Dict[str, Any]]:
    if not ordered_samples:
        return []

    clamped_start = max(0, min(start_index, len(ordered_samples) - 1))
    clamped_end = max(clamped_start, min(end_index, len(ordered_samples) - 1))
    curve_points: List[Dict[str, Any]] = []

    if start_crossing:
        curve_points.append(
            _serialize_pass_curve_point(start_crossing, elevation_deg=float(horizon_deg))
        )

    for sample in ordered_samples[clamped_start : clamped_end + 1]:
        if float(sample["el_deg"]) < float(horizon_deg):
            continue
        curve_points.append(_serialize_pass_curve_point(sample))

    if end_crossing:
        curve_points.append(
            _serialize_pass_curve_point(end_crossing, elevation_deg=float(horizon_deg))
        )

    deduplicated = _deduplicate_curve_points(curve_points)
    if len(deduplicated) < 2:
        return []
    return _densify_curve_points(deduplicated)


def _build_pass_events_from_samples(
    row: Dict[str, Any],
    samples: List[Dict[str, Any]],
    horizon_deg: float,
) -> List[Dict[str, Any]]:
    if len(samples) < 2:
        return []

    ordered_samples = sorted(samples, key=lambda item: item["time"])
    events: List[Dict[str, Any]] = []
    active_pass: Optional[Dict[str, Any]] = None

    for index, sample in enumerate(ordered_samples):
        is_above = float(sample["el_deg"]) > float(horizon_deg)
        previous = ordered_samples[index - 1] if index > 0 else None
        previous_above = (
            bool(previous) and float(previous["el_deg"]) > float(horizon_deg) if previous else False
        )

        if active_pass is None and is_above:
            if previous and not previous_above:
                crossing = _interpolate_crossing_point(previous, sample, horizon_deg=horizon_deg)
                start_time = crossing["time"]
                start_az = float(crossing["az_deg"])
                estimated_start = False
            else:
                start_time = sample["time"]
                start_az = float(sample["az_deg"])
                estimated_start = index == 0

            active_pass = {
                "start_time": start_time,
                "start_azimuth_deg": start_az,
                "peak_time": sample["time"],
                "peak_elevation_deg": float(sample["el_deg"]),
                "peak_azimuth_deg": float(sample["az_deg"]),
                "start_index": index,
                "start_crossing": crossing if previous and not previous_above else None,
                "estimated_start": estimated_start,
            }

        if active_pass:
            if float(sample["el_deg"]) > float(active_pass["peak_elevation_deg"]):
                active_pass["peak_elevation_deg"] = float(sample["el_deg"])
                active_pass["peak_time"] = sample["time"]
                active_pass["peak_azimuth_deg"] = float(sample["az_deg"])

            if previous and previous_above and not is_above:
                crossing = _interpolate_crossing_point(previous, sample, horizon_deg=horizon_deg)
                end_time = crossing["time"]
                end_az = float(crossing["az_deg"])
                start_index = int(active_pass.get("start_index", index))
                end_index = max(start_index, index - 1)
                elevation_curve = _build_pass_elevation_curve(
                    ordered_samples=ordered_samples,
                    start_index=start_index,
                    end_index=end_index,
                    start_crossing=active_pass.get("start_crossing"),
                    end_crossing=crossing,
                    horizon_deg=horizon_deg,
                )
                duration_seconds = max(
                    0.0,
                    (end_time - active_pass["start_time"]).total_seconds(),
                )
                target_key = str(row.get("target_key") or "").strip()
                event_start_iso = active_pass["start_time"].astimezone(timezone.utc).isoformat()
                events.append(
                    {
                        "id": f"{target_key}_{event_start_iso}",
                        "target_key": target_key,
                        "target_type": row.get("target_type"),
                        "name": row.get("name"),
                        "command": row.get("command"),
                        "body_id": row.get("body_id"),
                        "color": row.get("color"),
                        "source": row.get("source"),
                        "cache": row.get("cache"),
                        "stale": bool(row.get("stale")),
                        "event_start": event_start_iso,
                        "event_end": end_time.astimezone(timezone.utc).isoformat(),
                        "peak_time": active_pass["peak_time"].astimezone(timezone.utc).isoformat(),
                        "duration_seconds": duration_seconds,
                        "start_azimuth_deg": float(active_pass["start_azimuth_deg"]),
                        "end_azimuth_deg": end_az,
                        "peak_azimuth_deg": float(active_pass["peak_azimuth_deg"]),
                        "peak_elevation_deg": float(active_pass["peak_elevation_deg"]),
                        "start_azimuth": float(active_pass["start_azimuth_deg"]),
                        "end_azimuth": end_az,
                        "peak_azimuth": float(active_pass["peak_azimuth_deg"]),
                        "peak_altitude": float(active_pass["peak_elevation_deg"]),
                        "elevation_curve": elevation_curve,
                        "estimated_start": bool(active_pass["estimated_start"]),
                        "estimated_end": False,
                        "horizon_threshold_deg": float(horizon_deg),
                    }
                )
                active_pass = None

    if active_pass:
        final_sample = ordered_samples[-1]
        end_time = final_sample["time"]
        end_az = float(final_sample["az_deg"])
        start_index = int(active_pass.get("start_index", 0))
        end_index = len(ordered_samples) - 1
        elevation_curve = _build_pass_elevation_curve(
            ordered_samples=ordered_samples,
            start_index=start_index,
            end_index=end_index,
            start_crossing=active_pass.get("start_crossing"),
            end_crossing=None,
            horizon_deg=horizon_deg,
        )
        duration_seconds = max(
            0.0,
            (end_time - active_pass["start_time"]).total_seconds(),
        )
        target_key = str(row.get("target_key") or "").strip()
        event_start_iso = active_pass["start_time"].astimezone(timezone.utc).isoformat()
        events.append(
            {
                "id": f"{target_key}_{event_start_iso}",
                "target_key": target_key,
                "target_type": row.get("target_type"),
                "name": row.get("name"),
                "command": row.get("command"),
                "body_id": row.get("body_id"),
                "color": row.get("color"),
                "source": row.get("source"),
                "cache": row.get("cache"),
                "stale": bool(row.get("stale")),
                "event_start": event_start_iso,
                "event_end": end_time.astimezone(timezone.utc).isoformat(),
                "peak_time": active_pass["peak_time"].astimezone(timezone.utc).isoformat(),
                "duration_seconds": duration_seconds,
                "start_azimuth_deg": float(active_pass["start_azimuth_deg"]),
                "end_azimuth_deg": end_az,
                "peak_azimuth_deg": float(active_pass["peak_azimuth_deg"]),
                "peak_elevation_deg": float(active_pass["peak_elevation_deg"]),
                "start_azimuth": float(active_pass["start_azimuth_deg"]),
                "end_azimuth": end_az,
                "peak_azimuth": float(active_pass["peak_azimuth_deg"]),
                "peak_altitude": float(active_pass["peak_elevation_deg"]),
                "elevation_curve": elevation_curve,
                "estimated_start": bool(active_pass["estimated_start"]),
                "estimated_end": True,
                "horizon_threshold_deg": float(horizon_deg),
            }
        )

    return events


def _extract_row_observer_samples(
    row: Dict[str, Any],
    *,
    epoch: datetime,
    past_hours: int,
    future_hours: int,
    step_minutes: int,
    observer_location: Optional[Dict[str, Any]],
    earth_position_xyz_au: Optional[List[float]],
    earth_orbit_samples: Optional[List[Tuple[datetime, List[float]]]],
    logger: Any,
) -> List[Dict[str, Any]]:
    if not observer_location:
        return []

    try:
        observer_lat_deg = float(observer_location["lat"])
        observer_lon_deg = float(observer_location["lon"])
    except (TypeError, ValueError, KeyError):
        return []

    samples: List[Dict[str, Any]] = []
    earth_samples = earth_orbit_samples or []

    positions_obj = row.get("orbit_samples_xyz_au")
    positions: List[List[float]] = []
    if isinstance(positions_obj, list):
        for sample in positions_obj:
            if not isinstance(sample, list) or len(sample) < 3:
                continue
            try:
                position = [float(sample[0]), float(sample[1]), float(sample[2])]
            except (TypeError, ValueError):
                continue
            positions.append(position)

    if len(positions) < 2:
        # Require Horizons orbit samples for observer pass generation.
        return []

    raw_times_obj = row.get("orbit_sample_times_utc")
    sample_times: List[datetime] = []
    if isinstance(raw_times_obj, list) and len(raw_times_obj) == len(positions):
        parsed_times = [_parse_iso_utc(item) for item in raw_times_obj]
        if all(item is not None for item in parsed_times):
            sample_times = [item for item in parsed_times if item is not None]

    if len(sample_times) != len(positions):
        start = epoch - timedelta(hours=int(past_hours))
        span_seconds = max(1.0, float((int(past_hours) + int(future_hours)) * 3600))
        if len(positions) == 1:
            sample_times = [epoch]
        else:
            sample_times = [
                start + timedelta(seconds=(span_seconds * idx / max(1, len(positions) - 1)))
                for idx in range(len(positions))
            ]

    target_samples = list(zip(sample_times, positions))
    observer_step_minutes = _compute_observer_sample_step_minutes(
        past_hours=past_hours,
        future_hours=future_hours,
        source_step_minutes=step_minutes,
    )
    observer_sample_times = _build_window_timestamps(
        epoch=epoch,
        past_hours=past_hours,
        future_hours=future_hours,
        step_minutes=observer_step_minutes,
    )

    for sample_time in observer_sample_times:
        target_position = _interpolate_position_from_samples(target_samples, sample_time)
        if not target_position:
            continue

        earth_position_for_sample = _interpolate_position_from_samples(
            earth_samples,
            sample_time,
        )
        if not earth_position_for_sample:
            if earth_position_xyz_au and len(earth_position_xyz_au) >= 3:
                earth_position_for_sample = [
                    float(earth_position_xyz_au[0]),
                    float(earth_position_xyz_au[1]),
                    float(earth_position_xyz_au[2]),
                ]
        if not earth_position_for_sample:
            continue

        try:
            observer_view = compute_observer_sky_position(
                target_heliocentric_xyz_au=target_position,
                earth_heliocentric_xyz_au=earth_position_for_sample,
                epoch=sample_time,
                observer_lat_deg=observer_lat_deg,
                observer_lon_deg=observer_lon_deg,
            )
            sky_position = observer_view.get("sky_position")
            if not isinstance(sky_position, dict):
                continue
            az_obj = sky_position.get("az_deg")
            el_obj = sky_position.get("el_deg")
            if not isinstance(az_obj, (int, float, str)) or not isinstance(
                el_obj, (int, float, str)
            ):
                continue
            az_deg = float(az_obj)
            el_deg = float(el_obj)
            if not math.isfinite(az_deg) or not math.isfinite(el_deg):
                continue
            samples.append({"time": sample_time, "az_deg": az_deg, "el_deg": el_deg})
        except Exception as exc:
            logger.debug(
                "Observer sample calculation failed for celestial "
                f"'{row.get('target_key') or row.get('command') or row.get('body_id')}': {exc}"
            )
            continue

    return samples


def _build_celestial_passes(
    rows: List[Dict[str, Any]],
    *,
    epoch: datetime,
    past_hours: int,
    future_hours: int,
    step_minutes: int,
    observer_location: Optional[Dict[str, Any]],
    earth_position_xyz_au: Optional[List[float]],
    earth_orbit_samples: Optional[List[Tuple[datetime, List[float]]]] = None,
    logger: Any,
) -> List[Dict[str, Any]]:
    passes: List[Dict[str, Any]] = []
    for row in rows:
        samples = _extract_row_observer_samples(
            row=row,
            epoch=epoch,
            past_hours=past_hours,
            future_hours=future_hours,
            step_minutes=step_minutes,
            observer_location=observer_location,
            earth_position_xyz_au=earth_position_xyz_au,
            earth_orbit_samples=earth_orbit_samples,
            logger=logger,
        )
        if len(samples) < 2:
            continue
        events = _build_pass_events_from_samples(
            row=row,
            samples=samples,
            horizon_deg=CELESTIAL_PASS_HORIZON_DEG,
        )
        for event in events:
            event["sample_count"] = len(samples)
        passes.extend(events)

    passes.sort(key=lambda item: str(item.get("event_start") or ""))
    return passes


async def _load_vectors_from_db(
    target_key: str,
    epoch_bucket_utc: datetime,
    past_hours: int,
    future_hours: int,
    step_minutes: int,
    frame: str = DEFAULT_FRAME,
    center: str = DEFAULT_CENTER,
    valid_only: bool = True,
) -> Optional[Dict[str, Any]]:
    async with AsyncSessionLocal() as dbsession:
        result = await crud_celestial_vectors.fetch_celestial_vector_snapshot(
            dbsession,
            target_id=target_key,
            epoch_bucket_utc=epoch_bucket_utc,
            past_hours=past_hours,
            future_hours=future_hours,
            step_minutes=step_minutes,
            frame=frame,
            center=center,
            valid_only=valid_only,
            as_of=datetime.now(timezone.utc),
        )
    if not result.get("success"):
        return None
    row = result.get("data")
    return row if isinstance(row, dict) else None


async def _store_vectors_in_db(
    target_key: str,
    epoch_bucket_utc: datetime,
    past_hours: int,
    future_hours: int,
    step_minutes: int,
    payload: Dict[str, Any],
    source: str,
    frame: str = DEFAULT_FRAME,
    center: str = DEFAULT_CENTER,
    error: Optional[str] = None,
    ttl_seconds: int = VECTOR_DB_TTL_SECONDS,
) -> None:
    position_xyz_au = payload.get("position_xyz_au")
    velocity_xyz_au_per_day = payload.get("velocity_xyz_au_per_day")
    orbit_samples_xyz_au = payload.get("orbit_samples_xyz_au")
    orbit_sample_times_utc = payload.get("orbit_sample_times_utc")
    async with AsyncSessionLocal() as dbsession:
        await crud_celestial_vectors.upsert_celestial_vector_snapshot(
            dbsession,
            data={
                "target_id": target_key,
                "epoch_bucket_utc": epoch_bucket_utc,
                "past_hours": past_hours,
                "future_hours": future_hours,
                "step_minutes": step_minutes,
                "frame": frame,
                "center": center,
                "position_xyz_au": position_xyz_au,
                "velocity_xyz_au_per_day": velocity_xyz_au_per_day,
                "orbit_samples_xyz_au": orbit_samples_xyz_au,
                "orbit_sample_times_utc": orbit_sample_times_utc,
                "horizons_signature": payload.get("horizons_signature"),
                "source": source,
                "error": error,
                "fetched_at": datetime.now(timezone.utc),
                "expires_at": datetime.now(timezone.utc)
                + timedelta(seconds=max(60, int(ttl_seconds))),
            },
        )


async def _get_vectors_snapshot(
    command: str,
    epoch: datetime,
    past_hours: int,
    future_hours: int,
    step_minutes: int,
    observer_location: Optional[Dict[str, Any]],
    force_refresh: bool,
    logger: Any,
    allow_network_fetch: bool = True,
    target_key: str = "",
) -> Dict[str, Any]:
    normalized_target_key = str(target_key or "").strip()
    if not normalized_target_key:
        normalized_target_key = _target_key_from_parts("mission", command=command)
    if not normalized_target_key:
        return {
            "payload": None,
            "cache": "miss",
            "stale": True,
            "error": "Target key is required",
        }

    epoch_bucket_utc = _bucket_epoch(epoch, VECTOR_EPOCH_BUCKET_MINUTES * 60)
    if not force_refresh:
        cached = await _load_vectors_from_db(
            target_key=normalized_target_key,
            epoch_bucket_utc=epoch_bucket_utc,
            past_hours=past_hours,
            future_hours=future_hours,
            step_minutes=step_minutes,
            frame=DEFAULT_FRAME,
            center=DEFAULT_CENTER,
            valid_only=True,
        )
        if cached and isinstance(cached.get("payload"), dict):
            return {
                "payload": dict(cached["payload"]),
                "cache": "db-hit",
                "stale": False,
                "error": None,
            }

    if not allow_network_fetch:
        return {
            "payload": None,
            "cache": "cache-only-miss",
            "stale": True,
            "error": f"No cached vectors available for target '{normalized_target_key}'",
        }

    try:
        fetched = await asyncio.to_thread(
            fetch_celestial_vectors,
            command,
            epoch,
            past_hours,
            future_hours,
            step_minutes,
        )
    except Exception as exc:
        logger.warning(f"Horizons fetch failed for celestial '{command}': {exc}")
        return {
            "payload": None,
            "cache": "miss",
            "stale": True,
            "error": str(exc),
        }

    await _store_vectors_in_db(
        target_key=normalized_target_key,
        epoch_bucket_utc=epoch_bucket_utc,
        past_hours=past_hours,
        future_hours=future_hours,
        step_minutes=step_minutes,
        payload=fetched,
        source="horizons",
        frame=DEFAULT_FRAME,
        center=DEFAULT_CENTER,
        error=None,
        ttl_seconds=VECTOR_DB_TTL_SECONDS,
    )
    return {"payload": fetched, "cache": "db-miss", "stale": False, "error": None}


async def _fetch_celestial_with_cache(
    targets: List[Dict[str, Any]],
    epoch: datetime,
    past_hours: int,
    future_hours: int,
    step_minutes: int,
    observer_location: Optional[Dict[str, Any]],
    earth_position_xyz_au: Optional[List[float]],
    body_snapshot_by_id: Dict[str, Dict[str, Any]],
    force_refresh: bool,
    allow_network_fetch: bool,
    logger,
    per_row_callback: Optional[Any] = None,
) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    now_monotonic = time.monotonic()
    total_targets = len(targets)

    for index, target in enumerate(targets):
        target_type = str(target.get("target_type") or "mission").strip().lower()
        target_key = str(target.get("target_key") or "").strip()
        name = target["name"]
        color = target.get("color")

        if target_type == "body":
            body_id = str(target.get("body_id") or "").strip().lower()
            body_row = body_snapshot_by_id.get(body_id)
            if body_row:
                body_payload = dict(body_row)
                body_payload["target_type"] = "body"
                body_payload["target_key"] = target_key or _target_key_from_parts(
                    "body", body_id=body_id
                )
                body_payload["body_id"] = body_id
                body_payload["command"] = str(
                    target.get("horizons_command") or target.get("command") or body_id
                )
                body_payload["name"] = name or body_payload.get("name") or body_id
                body_payload["color"] = color
                body_payload["source"] = body_payload.get("source") or "horizons"
                body_payload["stale"] = False
                body_payload["cache"] = body_payload.get("cache") or "scene-base-hit"
                _attach_observer_view_local(
                    row=body_payload,
                    epoch=epoch,
                    observer_location=observer_location,
                    earth_position_xyz_au=earth_position_xyz_au,
                    logger=logger,
                )
                rows.append(body_payload)
                if per_row_callback:
                    await per_row_callback(dict(body_payload), index + 1, total_targets)
                continue

            horizons_command = str(
                target.get("horizons_command")
                or target.get("command")
                or BODY_HORIZONS_COMMANDS.get(body_id)
                or ""
            ).strip()
            if not horizons_command:
                body_error = {
                    "target_type": "body",
                    "target_key": target_key or _target_key_from_parts("body", body_id=body_id),
                    "body_id": body_id,
                    "command": body_id,
                    "name": name,
                    "color": color,
                    "source": "horizons",
                    "stale": True,
                    "cache": "missing-command",
                    "error": f"No Horizons command mapping configured for body '{body_id}'",
                    "sky_position": None,
                    "visibility": {
                        "above_horizon": None,
                        "visible": None,
                        "horizon_threshold_deg": 0.0,
                    },
                }
                rows.append(body_error)
                if per_row_callback:
                    await per_row_callback(dict(body_error), index + 1, total_targets)
                continue

            snapshot = await _get_vectors_snapshot(
                target_key=target_key or _target_key_from_parts("body", body_id=body_id),
                command=horizons_command,
                epoch=epoch,
                past_hours=past_hours,
                future_hours=future_hours,
                step_minutes=step_minutes,
                observer_location=observer_location,
                force_refresh=force_refresh,
                logger=logger,
                allow_network_fetch=allow_network_fetch,
            )
            payload = snapshot.get("payload")
            if isinstance(payload, dict):
                row_payload = dict(payload)
                row_payload["target_type"] = "body"
                row_payload["target_key"] = target_key or _target_key_from_parts(
                    "body", body_id=body_id
                )
                row_payload["body_id"] = body_id
                row_payload["command"] = horizons_command
                row_payload["name"] = name
                row_payload["color"] = color
                row_payload["body_class"] = target.get("body_class")
                row_payload["parent_body_id"] = target.get("parent_body_id")
                row_payload["stale"] = bool(snapshot.get("stale"))
                row_payload["cache"] = snapshot.get("cache")
                if snapshot.get("error"):
                    row_payload["error"] = snapshot.get("error")
                _attach_observer_view_local(
                    row=row_payload,
                    epoch=epoch,
                    observer_location=observer_location,
                    earth_position_xyz_au=earth_position_xyz_au,
                    logger=logger,
                )
                rows.append(row_payload)
                if per_row_callback:
                    await per_row_callback(dict(row_payload), index + 1, total_targets)
                continue

            body_error = {
                "target_type": "body",
                "target_key": target_key or _target_key_from_parts("body", body_id=body_id),
                "body_id": body_id,
                "command": horizons_command,
                "name": name,
                "color": color,
                "source": "horizons",
                "stale": True,
                "cache": snapshot.get("cache"),
                "error": snapshot.get("error") or "No data returned",
                "sky_position": None,
                "visibility": {
                    "above_horizon": None,
                    "visible": None,
                    "horizon_threshold_deg": 0.0,
                },
            }
            rows.append(body_error)
            if per_row_callback:
                await per_row_callback(dict(body_error), index + 1, total_targets)
            continue

        command = str(target.get("horizons_command") or target.get("command") or "").strip()
        if not command:
            continue
        observer_cache_key = "no-observer"
        if observer_location:
            observer_cache_key = (
                f"{observer_location.get('id')}"
                f"|{observer_location.get('lat')}"
                f"|{observer_location.get('lon')}"
                f"|{observer_location.get('alt_m')}"
            )
        epoch_cache_key = _bucket_epoch(epoch, COMPUTED_EPOCH_BUCKET_SECONDS).isoformat()
        cache_key = (
            f"{target_key or _target_key_from_parts('mission', command=command)}|{epoch_cache_key}"
            f"|p{past_hours}|f{future_hours}|s{step_minutes}"
            f"|obs:{observer_cache_key}"
        )

        use_cached = False
        cached_entry: Optional[CacheEntry] = None

        with _computed_cache_lock:
            cached_entry = _computed_cache.get(cache_key)
            if (
                cached_entry
                and not force_refresh
                and now_monotonic - cached_entry.fetched_at_monotonic <= CACHE_TTL_SECONDS
            ):
                use_cached = True

        if use_cached and cached_entry:
            cached_payload = dict(cached_entry.payload)
            cached_payload["target_type"] = "mission"
            cached_payload["target_key"] = target_key or _target_key_from_parts(
                "mission", command=command
            )
            cached_payload["name"] = name
            cached_payload["color"] = color
            cached_payload["stale"] = bool(cached_payload.get("stale"))
            cached_payload["cache"] = "computed-hit"
            rows.append(cached_payload)
            if per_row_callback:
                await per_row_callback(dict(cached_payload), index + 1, total_targets)
            continue

        snapshot = await _get_vectors_snapshot(
            target_key=target_key or _target_key_from_parts("mission", command=command),
            command=command,
            epoch=epoch,
            past_hours=past_hours,
            future_hours=future_hours,
            step_minutes=step_minutes,
            observer_location=observer_location,
            force_refresh=force_refresh,
            logger=logger,
            allow_network_fetch=allow_network_fetch,
        )

        payload = snapshot.get("payload")
        if isinstance(payload, dict):
            row_payload = dict(payload)
            row_payload["target_type"] = "mission"
            row_payload["target_key"] = target_key or _target_key_from_parts(
                "mission", command=command
            )
            row_payload["name"] = name
            row_payload["color"] = color
            row_payload["stale"] = bool(snapshot.get("stale"))
            row_payload["cache"] = snapshot.get("cache")
            if snapshot.get("error"):
                row_payload["error"] = snapshot.get("error")
            # Keep "current" vectors fresh between periodic Horizons syncs.
            interpolated_position = _interpolate_position_xyz_au_at_epoch(
                payload=row_payload,
                epoch=epoch,
                past_hours=past_hours,
                future_hours=future_hours,
            )
            if interpolated_position:
                row_payload["position_xyz_au"] = interpolated_position
            _attach_observer_view_local(
                row=row_payload,
                epoch=epoch,
                observer_location=observer_location,
                earth_position_xyz_au=earth_position_xyz_au,
                logger=logger,
            )
            with _computed_cache_lock:
                _computed_cache[cache_key] = CacheEntry(
                    payload=dict(row_payload),
                    fetched_at_monotonic=time.monotonic(),
                )
            rows.append(row_payload)
            if per_row_callback:
                await per_row_callback(dict(row_payload), index + 1, total_targets)
            continue

        error_row = {
            "target_type": "mission",
            "target_key": target_key or _target_key_from_parts("mission", command=command),
            "name": name,
            "command": command,
            "color": color,
            "source": "horizons",
            "stale": True,
            "cache": snapshot.get("cache"),
            "error": snapshot.get("error") or "No data returned",
            "sky_position": None,
            "visibility": {
                "above_horizon": None,
                "visible": None,
                "horizon_threshold_deg": 0.0,
            },
        }
        rows.append(error_row)
        if per_row_callback:
            await per_row_callback(dict(error_row), index + 1, total_targets)

    return rows


async def build_celestial_scene(
    data: Optional[Dict[str, Any]],
    logger,
    force_refresh: bool = False,
    allow_network_fetch: bool = True,
    per_row_callback: Optional[Any] = None,
) -> Dict[str, Any]:
    """Build a scene payload for UI rendering and backend sharing."""
    epoch = _parse_epoch(data)
    targets = _normalize_targets(data)
    past_hours, future_hours, step_minutes = _parse_projection_options(data)
    observer_location = await _load_observer_location()
    await _ensure_scene_targets_registered(targets, logger)
    solar_meta, planets = await _build_horizons_solar_system_bodies(
        epoch=epoch,
        past_hours=past_hours,
        future_hours=future_hours,
        step_minutes=step_minutes,
        observer_location=observer_location,
        force_refresh=force_refresh,
        allow_network_fetch=allow_network_fetch,
        logger=logger,
    )
    earth_position_xyz_au = _extract_earth_position_xyz_au(planets)
    earth_orbit_samples = _extract_earth_orbit_samples(
        planets,
        epoch=epoch,
        past_hours=past_hours,
        future_hours=future_hours,
    )
    body_snapshot_by_id = _build_body_snapshot_by_id(planets)
    asteroid_zones, asteroid_resonance_gaps, asteroid_meta = get_static_asteroid_zones()
    celestial = await _fetch_celestial_with_cache(
        targets,
        epoch,
        past_hours,
        future_hours,
        step_minutes,
        observer_location,
        earth_position_xyz_au,
        body_snapshot_by_id,
        force_refresh,
        allow_network_fetch,
        logger,
        per_row_callback,
    )
    celestial_passes = _build_celestial_passes(
        rows=celestial,
        epoch=epoch,
        past_hours=past_hours,
        future_hours=future_hours,
        step_minutes=step_minutes,
        observer_location=observer_location,
        earth_position_xyz_au=earth_position_xyz_au,
        earth_orbit_samples=earth_orbit_samples,
        logger=logger,
    )

    return {
        "success": True,
        "data": {
            "timestamp_utc": epoch.isoformat(),
            "frame": DEFAULT_FRAME,
            "center": DEFAULT_CENTER,
            "units": {
                "position": "au",
                "velocity": "au/day",
            },
            "planets": planets,
            "celestial": celestial,
            "celestial_passes": celestial_passes,
            "asteroid_zones": asteroid_zones,
            "asteroid_resonance_gaps": asteroid_resonance_gaps,
            "meta": {
                "solar_system": solar_meta,
                "celestial_source": "horizons",
                "asteroid_zones": asteroid_meta,
                "cache_ttl_seconds": CACHE_TTL_SECONDS,
                "vector_db_ttl_seconds": VECTOR_DB_TTL_SECONDS,
                "projection": {
                    "past_hours": past_hours,
                    "future_hours": future_hours,
                    "step_minutes": step_minutes,
                },
                "passes": {
                    "horizon_threshold_deg": CELESTIAL_PASS_HORIZON_DEG,
                    "count": len(celestial_passes),
                },
                "observer_location": observer_location,
                "visibility_definition": "visible == elevation_deg > 0",
            },
        },
    }


async def build_solar_system_scene(
    data: Optional[Dict[str, Any]],
    logger,
) -> Dict[str, Any]:
    """Build only the Horizons-backed solar-system portion for fast initial render."""
    epoch = _parse_epoch(data)
    past_hours, future_hours, step_minutes = _parse_projection_options(data)
    solar_meta, planets = await _build_horizons_solar_system_bodies(
        epoch=epoch,
        past_hours=past_hours,
        future_hours=future_hours,
        step_minutes=step_minutes,
        observer_location=None,
        force_refresh=False,
        allow_network_fetch=True,
        logger=logger,
    )
    asteroid_zones, asteroid_resonance_gaps, asteroid_meta = get_static_asteroid_zones()

    return {
        "success": True,
        "data": {
            "timestamp_utc": epoch.isoformat(),
            "frame": DEFAULT_FRAME,
            "center": DEFAULT_CENTER,
            "units": {
                "position": "au",
                "velocity": "au/day",
            },
            "planets": planets,
            "asteroid_zones": asteroid_zones,
            "asteroid_resonance_gaps": asteroid_resonance_gaps,
            "meta": {
                "solar_system": solar_meta,
                "asteroid_zones": asteroid_meta,
                "cache_ttl_seconds": CACHE_TTL_SECONDS,
                "vector_db_ttl_seconds": VECTOR_DB_TTL_SECONDS,
                "projection": {
                    "past_hours": past_hours,
                    "future_hours": future_hours,
                    "step_minutes": step_minutes,
                },
            },
        },
    }


async def build_celestial_tracks(
    data: Optional[Dict[str, Any]],
    logger,
    force_refresh: bool = False,
    allow_network_fetch: bool = True,
    per_row_callback: Optional[Any] = None,
) -> Dict[str, Any]:
    """Build only Horizons-backed tracked celestial objects."""
    epoch = _parse_epoch(data)
    targets = _normalize_targets(data)
    past_hours, future_hours, step_minutes = _parse_projection_options(data)
    observer_location = await _load_observer_location()
    await _ensure_scene_targets_registered(targets, logger)
    earth_position_xyz_au, earth_orbit_samples = await _load_earth_observer_vectors(
        epoch=epoch,
        past_hours=past_hours,
        future_hours=future_hours,
        step_minutes=step_minutes,
        observer_location=observer_location,
        force_refresh=force_refresh,
        allow_network_fetch=allow_network_fetch,
        logger=logger,
    )
    body_snapshot_by_id: Dict[str, Dict[str, Any]] = {}
    celestial = await _fetch_celestial_with_cache(
        targets,
        epoch,
        past_hours,
        future_hours,
        step_minutes,
        observer_location,
        earth_position_xyz_au,
        body_snapshot_by_id,
        force_refresh,
        allow_network_fetch,
        logger,
        per_row_callback,
    )
    celestial_passes = _build_celestial_passes(
        rows=celestial,
        epoch=epoch,
        past_hours=past_hours,
        future_hours=future_hours,
        step_minutes=step_minutes,
        observer_location=observer_location,
        earth_position_xyz_au=earth_position_xyz_au,
        earth_orbit_samples=earth_orbit_samples,
        logger=logger,
    )

    return {
        "success": True,
        "data": {
            "timestamp_utc": epoch.isoformat(),
            "frame": DEFAULT_FRAME,
            "center": DEFAULT_CENTER,
            "units": {
                "position": "au",
                "velocity": "au/day",
            },
            "celestial": celestial,
            "celestial_passes": celestial_passes,
            "meta": {
                "celestial_source": "horizons",
                "cache_ttl_seconds": CACHE_TTL_SECONDS,
                "vector_db_ttl_seconds": VECTOR_DB_TTL_SECONDS,
                "projection": {
                    "past_hours": past_hours,
                    "future_hours": future_hours,
                    "step_minutes": step_minutes,
                },
                "passes": {
                    "horizon_threshold_deg": CELESTIAL_PASS_HORIZON_DEG,
                    "count": len(celestial_passes),
                },
                "observer_location": observer_location,
                "visibility_definition": "visible == elevation_deg > 0",
            },
        },
    }


async def refresh_celestial_vector_snapshots_cache(logger: Any) -> Dict[str, Any]:
    """Refresh Horizons vectors for monitored missions and always-in-scene bodies."""
    if _scheduled_sync_lock.locked():
        return {
            "success": False,
            "skipped": True,
            "error": "Scheduled celestial vectors sync already running",
        }

    async with _scheduled_sync_lock:
        payload = {
            "past_hours": SCHEDULED_SYNC_PAST_HOURS,
            "future_hours": SCHEDULED_SYNC_FUTURE_HOURS,
            "step_minutes": SCHEDULED_SYNC_STEP_MINUTES,
        }
        past_hours, future_hours, step_minutes = _parse_projection_options(payload)
        epoch = datetime.now(timezone.utc)

        async with AsyncSessionLocal() as dbsession:
            monitored_result = await crud_monitored.fetch_monitored_celestial(
                dbsession,
                enabled_only=True,
            )

        if not monitored_result.get("success"):
            return {
                "success": False,
                "error": monitored_result.get("error")
                or "Failed loading monitored celestial targets",
            }

        rows_obj = monitored_result.get("data")
        rows: List[Dict[str, Any]] = rows_obj if isinstance(rows_obj, list) else []
        mission_targets: List[Dict[str, Any]] = []
        for row in rows:
            target_type = str(row.get("target_type") or "mission").strip().lower()
            if target_type != "mission":
                continue
            command = str(row.get("command") or "").strip()
            if not command:
                continue
            mission_targets.append(
                {
                    "target_type": "mission",
                    "target_key": _target_key_from_parts("mission", command=command),
                    "name": str(row.get("display_name") or command).strip() or command,
                    "command": command,
                    "horizons_command": command,
                    "always_in_scene": False,
                }
            )

        builtin_targets = _build_builtin_body_targets()
        all_targets_by_key: Dict[str, Dict[str, Any]] = {}
        for target in builtin_targets + mission_targets:
            target_key = str(target.get("target_key") or "").strip()
            if not target_key:
                continue
            all_targets_by_key[target_key] = target

        all_targets = list(all_targets_by_key.values())
        if not all_targets:
            return {
                "success": True,
                "count": 0,
                "refreshed": 0,
                "failed": 0,
                "projection": {
                    "past_hours": past_hours,
                    "future_hours": future_hours,
                    "step_minutes": step_minutes,
                },
            }

        await _ensure_scene_targets_registered(all_targets, logger)

        refreshed = 0
        failed = 0
        errors: List[Dict[str, str]] = []

        # Keep the scheduler job deterministic and easy to observe in logs.
        for target in all_targets:
            target_key = str(target.get("target_key") or "").strip()
            command = str(target.get("horizons_command") or target.get("command") or "").strip()
            if not target_key or not command:
                failed += 1
                errors.append(
                    {
                        "target_key": target_key or "unknown",
                        "error": "Missing Horizons command",
                    }
                )
                continue
            snapshot = await _get_vectors_snapshot(
                target_key=target_key,
                command=command,
                epoch=epoch,
                past_hours=past_hours,
                future_hours=future_hours,
                step_minutes=step_minutes,
                observer_location=None,
                force_refresh=False,
                logger=logger,
                allow_network_fetch=True,
            )
            if isinstance(snapshot.get("payload"), dict):
                refreshed += 1
                continue
            failed += 1
            errors.append(
                {
                    "target_key": target_key,
                    "error": str(snapshot.get("error") or "Unknown error"),
                }
            )

        return {
            "success": failed == 0,
            "count": len(all_targets),
            "refreshed": refreshed,
            "failed": failed,
            "mission_count": len(mission_targets),
            "always_in_scene_count": len(builtin_targets),
            "errors": errors,
            "projection": {
                "past_hours": past_hours,
                "future_hours": future_hours,
                "step_minutes": step_minutes,
            },
        }
