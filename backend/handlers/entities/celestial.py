# Copyright (c) 2025 Efstratios Goudelis
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Celestial page handlers (offline solar system + Horizons celestial)."""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, cast

import crud.celestialvectors as crud_celestial_vectors
import crud.locations as crud_locations
import crud.monitoredcelestial as crud_monitored
from celestial.bodycatalog import get_celestial_body, list_celestial_bodies
from celestial.horizons import fetch_celestial_vectors, get_horizons_status
from celestial.scene import (
    build_celestial_scene,
    build_celestial_tracks,
    build_solar_system_scene,
    refresh_celestial_vector_snapshots_cache,
)
from celestial.spacecraftindex import get_spacecraft_index, search_spacecraft_index
from celestial.status import build_celestial_ephemeris_status, emit_celestial_ephemeris_status
from common.targetkey import build_target_key, normalize_target_key
from db import AsyncSessionLocal

_monitored_refresh_lock = asyncio.Lock()


def _find_static_spacecraft_match(query: str) -> Optional[Dict[str, Any]]:
    needle = (query or "").strip().lower()
    if not needle:
        return None

    for entry in get_spacecraft_index():
        if needle == str(entry.get("command") or "").strip().lower():
            return entry
        if needle == str(entry.get("display_name") or "").strip().lower():
            return entry
        aliases = entry.get("aliases") or []
        if any(needle == str(alias).strip().lower() for alias in aliases):
            return entry
    return None


async def _validate_monitored_target_payload(data: Dict[str, Any]) -> Dict[str, Any]:
    target_type = (
        str(data.get("target_type") or data.get("targetType") or "mission").strip().lower()
    )
    display_name = str(data.get("display_name") or data.get("displayName") or "").strip()

    if target_type not in {"mission", "body"}:
        return {"success": False, "error": "target_type must be either 'mission' or 'body'"}

    if target_type == "body":
        body_id = str(data.get("body_id") or data.get("bodyId") or "").strip().lower()
        if not body_id:
            return {"success": False, "error": "body_id is required for body targets"}
        body = get_celestial_body(body_id)
        if not body:
            return {"success": False, "error": f"Unknown body_id '{body_id}'"}
        if body.get("monitorable") is False:
            return {
                "success": False,
                "error": f"Body '{body.get('name') or body_id}' cannot be monitored",
            }
        return {
            "success": True,
            "data": {
                "target_type": "body",
                "body_id": body_id,
                "command": None,
                "display_name": display_name or str(body.get("name") or body_id),
            },
        }

    command = str(data.get("command") or "").strip()
    source_mode = (
        str(data.get("source_mode") or data.get("sourceMode") or "catalog").strip().lower()
    )

    if not command:
        return {"success": False, "error": "Horizons command is required for mission targets"}
    if not display_name:
        return {"success": False, "error": "Display name is required"}

    static_match = _find_static_spacecraft_match(command)

    if source_mode == "exact":
        try:
            await asyncio.to_thread(fetch_celestial_vectors, command, datetime.now(timezone.utc))
        except Exception as exc:
            return {
                "success": False,
                "error": f"Exact Horizons verification failed for command '{command}': {exc}",
            }
        return {
            "success": True,
            "data": {
                "target_type": "mission",
                "display_name": display_name,
                "command": command,
                "body_id": None,
            },
        }

    if not static_match:
        return {
            "success": False,
            "error": "Command not found in static spacecraft catalog. Use exact mode to verify directly against Horizons.",
        }

    return {
        "success": True,
        "data": {
            "target_type": "mission",
            "display_name": display_name or static_match.get("display_name") or command,
            "command": static_match.get("command") or command,
            "body_id": None,
        },
    }


async def _build_scene_payload(data: Optional[Dict], logger: Any) -> Dict[str, Any]:
    payload: Dict[str, Any] = dict(data) if isinstance(data, dict) else {}

    if payload.get("celestial"):
        return payload

    async with AsyncSessionLocal() as dbsession:
        monitored_result = await crud_monitored.fetch_monitored_celestial(
            dbsession, enabled_only=True
        )

    if not monitored_result.get("success"):
        logger.warning(
            f"Failed to load monitored celestial targets for scene: {monitored_result.get('error')}"
        )
        return payload

    entries_obj = monitored_result.get("data")
    entries: List[Dict[str, Any]] = entries_obj if isinstance(entries_obj, list) else []
    payload["celestial"] = []
    for item in entries:
        target_type = str(item.get("target_type") or "mission").strip().lower()
        if target_type == "body":
            body_id = str(item.get("body_id") or "").strip().lower()
            if not body_id:
                continue
            payload["celestial"].append(
                {
                    "target_type": "body",
                    "body_id": body_id,
                    "name": item.get("display_name") or body_id,
                    "color": item.get("color"),
                    "past_hours": item.get("projection_past_hours"),
                    "future_hours": item.get("projection_future_hours"),
                    "step_minutes": item.get("projection_step_minutes"),
                }
            )
            continue

        if not item.get("command"):
            continue
        payload["celestial"].append(
            {
                "target_type": "mission",
                "command": item.get("command"),
                "name": item.get("display_name") or item.get("command"),
                "color": item.get("color"),
                "past_hours": item.get("projection_past_hours"),
                "future_hours": item.get("projection_future_hours"),
                "step_minutes": item.get("projection_step_minutes"),
            }
        )

    return payload


def _empty_celestial_tracks_payload() -> Dict[str, Any]:
    """Build a complete empty payload that clears retained browser track state."""
    return {
        "timestamp_utc": datetime.now(timezone.utc).isoformat(),
        "frame": "heliocentric-ecliptic",
        "center": "sun",
        "units": {
            "position": "au",
            "velocity": "au/day",
        },
        "celestial": [],
        "celestial_passes": [],
        "observer_bodies": [],
    }


async def _broadcast_current_cached_celestial_tracks(
    sio: Any,
    logger: Any,
    projection: Optional[Dict[str, Any]] = None,
) -> None:
    """Broadcast enabled monitored targets from cache, including an empty state."""
    payload = await _build_scene_payload(projection, logger)
    targets_obj = payload.get("celestial")
    targets = targets_obj if isinstance(targets_obj, list) else []
    if not targets:
        # An explicit empty payload removes tracks and passes retained by clients.
        await sio.emit("celestial-tracks-update", _empty_celestial_tracks_payload())
        return

    tracks = await build_celestial_tracks(
        data=payload,
        logger=logger,
        force_refresh=False,
        allow_network_fetch=False,
        register_targets=False,
        use_computed_cache=False,
    )
    if not tracks.get("success"):
        logger.debug(f"Cached celestial tracks broadcast skipped: {tracks.get('error')}")
        return

    scene_data_obj = tracks.get("data")
    scene_data = scene_data_obj if isinstance(scene_data_obj, dict) else {}
    rows_obj = scene_data.get("celestial")
    rows = rows_obj if isinstance(rows_obj, list) else []

    # Avoid replacing a valid browser state with temporary cache misses.
    has_usable_position = any(
        isinstance(row, dict) and isinstance(row.get("sky_position"), dict) for row in rows
    )
    if rows and has_usable_position:
        await sio.emit("celestial-tracks-update", scene_data)


async def _load_stream_observer_location() -> Optional[Dict[str, Any]]:
    async with AsyncSessionLocal() as dbsession:
        observer_result = await crud_locations.fetch_all_locations(dbsession)
    observer_rows_obj = observer_result.get("data") if isinstance(observer_result, dict) else []
    observer_rows = observer_rows_obj if isinstance(observer_rows_obj, list) else []
    return observer_rows[0] if observer_rows else None


def _build_partial_row_emitter(
    sio: Any,
    payload: Dict[str, Any],
    observer_location: Optional[Dict[str, Any]],
):
    epoch_for_stream = payload.get("epoch")
    if not epoch_for_stream:
        epoch_for_stream = datetime.now(timezone.utc).isoformat()

    async def emit_partial_row(row: Dict[str, Any], index: int, total: int) -> None:
        await sio.emit(
            "celestial-track-row-update",
            {
                "row": row,
                "progress": {
                    "current": index,
                    "total": total,
                    "percent": (float(index) / float(total) * 100.0) if total > 0 else 100.0,
                },
                "timestamp_utc": epoch_for_stream,
                "frame": "heliocentric-ecliptic",
                "center": "sun",
                "units": {
                    "position": "au",
                    "velocity": "au/day",
                },
                "meta": {
                    "observer_location": observer_location,
                    "projection": {
                        "past_hours": payload.get("past_hours"),
                        "future_hours": payload.get("future_hours"),
                        "step_minutes": payload.get("step_minutes"),
                    },
                },
            },
        )

    return emit_partial_row


async def get_celestial_scene(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Any]:
    """Fetch current celestial scene, cache-only unless explicitly allowed."""
    logger.debug(f"Fetching celestial scene, data: {data}")
    payload = await _build_scene_payload(data, logger)
    allow_network_fetch = bool(payload.get("allow_network_fetch"))
    scene = await build_celestial_scene(
        data=payload,
        logger=logger,
        force_refresh=False,
        allow_network_fetch=allow_network_fetch,
    )
    return scene


async def get_solar_system_scene(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Any]:
    """Fetch solar system scene, cache-only unless the caller explicitly allows network."""
    logger.debug(f"Fetching solar system scene, data: {data}")
    payload = cast(Optional[Dict[str, Any]], data)
    allow_network_fetch = bool(
        payload.get("allow_network_fetch") if isinstance(payload, dict) else False
    )
    request_id = str(payload.get("request_id") or "") if isinstance(payload, dict) else ""

    async def emit_body(row: Dict[str, Any], index: int, total: int) -> None:
        await sio.emit(
            "solar-system-body-update",
            {
                "request_id": request_id,
                "body": row,
                "progress": {
                    "current": index,
                    "total": total,
                    "percent": (float(index) / float(total) * 100.0) if total else 100.0,
                },
            },
            to=sid,
        )

    scene = await build_solar_system_scene(
        data=payload,
        logger=logger,
        allow_network_fetch=allow_network_fetch,
        per_body_callback=emit_body if allow_network_fetch and request_id else None,
    )
    return scene


async def get_celestial_tracks(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Any]:
    """Fetch celestial tracks, cache-only unless explicitly allowed."""
    logger.debug(f"Fetching celestial tracks, data: {data}")
    payload = await _build_scene_payload(data, logger)
    allow_network_fetch = bool(payload.get("allow_network_fetch"))
    emit_partial_row = None
    if allow_network_fetch:
        observer_location = await _load_stream_observer_location()
        emit_partial_row = _build_partial_row_emitter(
            sio=sio,
            payload=payload,
            observer_location=observer_location,
        )
    tracks = await build_celestial_tracks(
        data=payload,
        logger=logger,
        force_refresh=False,
        allow_network_fetch=allow_network_fetch,
        per_row_callback=emit_partial_row,
    )
    return tracks


async def refresh_celestial_now(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Any]:
    """Force-refresh celestial scene and broadcast live update event."""
    logger.info(f"Force refreshing celestial scene, data: {data}")
    payload = await _build_scene_payload(data, logger)
    scene = await build_celestial_scene(
        data=payload,
        logger=logger,
        force_refresh=True,
        # Explicit user refresh should bypass cache-only mode and fetch fresh vectors.
        allow_network_fetch=True,
    )
    if scene.get("success"):
        scene_data_obj = scene.get("data")
        scene_data = cast(
            Dict[str, Any], scene_data_obj if isinstance(scene_data_obj, dict) else {}
        )
        await sio.emit("solar-system-scene-update", scene_data)
        await sio.emit("celestial-tracks-update", scene_data)
        await sio.emit("celestial-scene-update", scene_data)
    return scene


async def refresh_monitored_celestial_now(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Any]:
    """Force-refresh monitored celestial targets and persist refresh metadata."""
    # A monitor action can overlap a scene refresh that started just before it.
    # Queue behind that refresh so normal contention is not reported as a data failure.
    async with _monitored_refresh_lock:
        payload: Dict[str, Any] = dict(data) if isinstance(data, dict) else {}
        ids_obj = payload.get("ids")
        requested_ids: List[Any] = ids_obj if isinstance(ids_obj, list) else []
        selected_ids = {str(item) for item in requested_ids if item}

        async with AsyncSessionLocal() as dbsession:
            monitored_result = await crud_monitored.fetch_monitored_celestial(dbsession)

        if not monitored_result.get("success"):
            return {
                "success": False,
                "error": monitored_result.get("error") or "Failed to load monitored targets",
            }

        monitored_entries_obj = monitored_result.get("data")
        monitored_entries: List[Dict[str, Any]] = (
            monitored_entries_obj if isinstance(monitored_entries_obj, list) else []
        )
        if selected_ids:
            targets = [entry for entry in monitored_entries if str(entry.get("id")) in selected_ids]
        else:
            targets = [entry for entry in monitored_entries if entry.get("enabled")]

        payload["celestial"] = []
        for item in targets:
            target_type = str(item.get("target_type") or "mission").strip().lower()
            if target_type == "body":
                body_id = str(item.get("body_id") or "").strip().lower()
                if not body_id:
                    continue
                payload["celestial"].append(
                    {
                        "target_type": "body",
                        "body_id": body_id,
                        "name": item.get("display_name") or body_id,
                        "color": item.get("color"),
                        "past_hours": item.get("projection_past_hours"),
                        "future_hours": item.get("projection_future_hours"),
                        "step_minutes": item.get("projection_step_minutes"),
                    }
                )
                continue
            command = str(item.get("command") or "").strip()
            if not command:
                continue
            payload["celestial"].append(
                {
                    "target_type": "mission",
                    "command": command,
                    "name": item.get("display_name") or command,
                    "color": item.get("color"),
                    "past_hours": item.get("projection_past_hours"),
                    "future_hours": item.get("projection_future_hours"),
                    "step_minutes": item.get("projection_step_minutes"),
                }
            )

        logger.info(
            f"Force refreshing monitored celestial targets, count={len(payload['celestial'])}, selected={bool(selected_ids)}"
        )
        observer_location = await _load_stream_observer_location()
        emit_partial_row = _build_partial_row_emitter(
            sio=sio,
            payload=payload,
            observer_location=observer_location,
        )

        tracks = await build_celestial_tracks(
            data=payload,
            logger=logger,
            force_refresh=True,
            # Explicit user refresh should bypass cache-only mode and fetch fresh vectors.
            allow_network_fetch=True,
            per_row_callback=emit_partial_row,
        )
        if not tracks.get("success"):
            return tracks

        refreshed_at = datetime.now(timezone.utc)
        scene_data_obj = tracks.get("data")
        scene_data: Dict[str, Any] = scene_data_obj if isinstance(scene_data_obj, dict) else {}
        scene_rows_obj = scene_data.get("celestial")
        scene_rows: List[Dict[str, Any]] = (
            scene_rows_obj if isinstance(scene_rows_obj, list) else []
        )
        by_target_key = {
            str(row.get("target_key")): row for row in scene_rows if row.get("target_key")
        }

        updates = []
        for target in targets:
            target_type = str(target.get("target_type") or "mission").strip().lower()
            target_key = normalize_target_key(target.get("target_key")) or ""
            if not target_key.startswith(f"{target_type}:"):
                target_key = ""
            row = by_target_key.get(target_key)
            error = row.get("error") if isinstance(row, dict) else "No data returned"
            updates.append(
                {
                    "id": target.get("id"),
                    "last_refresh_at": refreshed_at,
                    "last_error": str(error) if error else None,
                }
            )

        if updates:
            async with AsyncSessionLocal() as dbsession:
                update_result = await crud_monitored.update_monitored_celestial_refresh_state(
                    dbsession, updates
                )
            if not update_result.get("success"):
                logger.warning(
                    f"Failed to persist monitored celestial refresh metadata: {update_result.get('error')}"
                )

        if not selected_ids:
            await sio.emit("celestial-tracks-update", tracks.get("data", {}))
        return tracks


async def get_monitored_celestial(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Any]:
    """Get all monitored celestial targets or one by ID."""
    target_id = data.get("id") if isinstance(data, dict) else None
    enabled_only = bool(data.get("enabled_only")) if isinstance(data, dict) else False

    async with AsyncSessionLocal() as dbsession:
        result = await crud_monitored.fetch_monitored_celestial(
            dbsession, target_id=target_id, enabled_only=enabled_only
        )

    return {
        "success": result.get("success", False),
        "data": result.get("data", [] if not target_id else None),
        "error": result.get("error"),
    }


async def create_monitored_celestial(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Any]:
    """Create a monitored celestial target."""
    if not isinstance(data, dict):
        return {"success": False, "error": "No data provided"}

    validation = await _validate_monitored_target_payload(data)
    if not validation.get("success"):
        return {"success": False, "error": validation.get("error")}

    normalized = validation.get("data") or {}
    payload = dict(data)
    payload["target_type"] = normalized.get("target_type")
    payload["display_name"] = normalized.get("display_name")
    payload["command"] = normalized.get("command")
    payload["body_id"] = normalized.get("body_id")

    async with AsyncSessionLocal() as dbsession:
        result = await crud_monitored.add_monitored_celestial(dbsession, payload)

    return {
        "success": result.get("success", False),
        "data": result.get("data"),
        "error": result.get("error"),
    }


async def update_monitored_celestial(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Any]:
    """Update a monitored celestial target."""
    if not isinstance(data, dict):
        return {"success": False, "error": "No data provided"}
    if not data.get("id"):
        return {"success": False, "error": "Target ID is required"}

    validation = await _validate_monitored_target_payload(data)
    if not validation.get("success"):
        return {"success": False, "error": validation.get("error")}

    normalized = validation.get("data") or {}
    payload = dict(data)
    payload["target_type"] = normalized.get("target_type")
    payload["display_name"] = normalized.get("display_name")
    payload["command"] = normalized.get("command")
    payload["body_id"] = normalized.get("body_id")

    async with AsyncSessionLocal() as dbsession:
        result = await crud_monitored.edit_monitored_celestial(dbsession, payload)

    return {
        "success": result.get("success", False),
        "data": result.get("data"),
        "error": result.get("error"),
    }


async def delete_monitored_celestial(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Any]:
    """Delete one or more monitored celestial targets."""
    ids: List[str] = []
    if isinstance(data, dict):
        ids_obj = data.get("ids")
        if isinstance(ids_obj, list):
            ids = [str(item) for item in ids_obj if item]
        elif data.get("id"):
            ids = [str(data.get("id"))]

    if not ids:
        return {"success": False, "error": "IDs are required"}

    async with AsyncSessionLocal() as dbsession:
        result = await crud_monitored.delete_monitored_celestial(dbsession, ids)

    if result.get("success"):
        try:
            # Clear deleted tracks and their pass events for every connected client.
            await _broadcast_current_cached_celestial_tracks(sio, logger)
        except Exception as exc:
            # The database mutation succeeded; a broadcast problem must not make
            # the client retry the deletion and report a false failure.
            logger.warning(f"Failed to broadcast celestial tracks after deletion: {exc}")

    return {
        "success": result.get("success", False),
        "data": result.get("data"),
        "error": result.get("error"),
    }


async def toggle_monitored_celestial_enabled(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Any]:
    """Enable or disable a monitored celestial target."""
    if not isinstance(data, dict):
        return {"success": False, "error": "No data provided"}

    target_id = data.get("id")
    enabled = data.get("enabled")

    if not target_id or enabled is None:
        return {"success": False, "error": "ID and enabled status required"}

    async with AsyncSessionLocal() as dbsession:
        result = await crud_monitored.toggle_monitored_celestial_enabled(
            dbsession, str(target_id), bool(enabled)
        )

    return {
        "success": result.get("success", False),
        "data": result.get("data"),
        "error": result.get("error"),
    }


async def get_spacecraft_index_entries(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Any]:
    """Return static spacecraft index entries."""
    try:
        limit = 200
        if isinstance(data, dict):
            requested_limit = data.get("limit")
            if isinstance(requested_limit, int) and requested_limit > 0:
                limit = min(requested_limit, 1000)
        rows = []
        for entry in get_spacecraft_index()[:limit]:
            command = str(entry.get("command") or "").strip()
            target_key = build_target_key(target_type="mission", command=command)
            if not target_key:
                continue
            rows.append(
                {
                    **entry,
                    "target_type": "mission",
                    "target_key": target_key,
                }
            )
        return {"success": True, "data": rows, "error": None}
    except Exception as exc:
        logger.error(f"Failed loading spacecraft index: {exc}")
        return {"success": False, "error": str(exc), "data": []}


async def search_spacecraft_index_entries(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Any]:
    """Search static spacecraft index entries."""
    try:
        query = ""
        limit = 20

        if isinstance(data, str):
            query = data
        elif isinstance(data, dict):
            query = str(data.get("query") or "")
            requested_limit = data.get("limit")
            if isinstance(requested_limit, int) and requested_limit > 0:
                limit = min(requested_limit, 100)

        rows = []
        for row in search_spacecraft_index(query=query, limit=limit):
            command = str(row.get("command") or "").strip()
            target_key = build_target_key(target_type="mission", command=command)
            if not target_key:
                continue
            rows.append(
                {
                    **row,
                    "target_type": "mission",
                    "target_key": target_key,
                }
            )
        return {"success": True, "data": rows, "error": None}
    except Exception as exc:
        logger.error(f"Failed searching spacecraft index: {exc}")
        return {"success": False, "error": str(exc), "data": []}


async def get_celestial_body_catalog(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Any]:
    """Return static celestial body catalog entries."""
    try:
        rows = []
        for row in list_celestial_bodies():
            target_key = build_target_key(target_type="body", body_id=row.get("body_id"))
            if target_key:
                rows.append({**row, "target_type": "body", "target_key": target_key})
        return {"success": True, "data": rows, "error": None}
    except Exception as exc:
        logger.error(f"Failed loading celestial body catalog: {exc}")
        return {"success": False, "error": str(exc), "data": []}


async def get_celestial_ephemeris_status(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Any]:
    """Return Horizons availability, cache health, and periodic sync settings."""
    response: Dict[str, Any] = await build_celestial_ephemeris_status(logger)
    return response


async def get_celestial_vector_snapshot_history(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Any]:
    """Return compact persisted-vector history for one canonical target key."""
    payload = data if isinstance(data, dict) else {}
    requested_key = payload.get("target_key")
    target_key = normalize_target_key(requested_key)
    # API boundaries accept only the persisted identity. Quietly normalizing a
    # legacy spelling here would make identity mistakes difficult to diagnose.
    if not isinstance(requested_key, str) or requested_key != target_key:
        return {
            "success": False,
            "data": None,
            "error": "target_key must be a canonical mission: or body: key",
        }

    requested_limit = payload.get("limit", 24)
    try:
        limit = int(requested_limit)
    except (TypeError, ValueError):
        return {"success": False, "data": None, "error": "limit must be an integer"}

    def optional_int(name: str) -> Optional[int]:
        value = payload.get(name)
        if value is None:
            return None
        return int(value)

    try:
        requested_past_hours = optional_int("past_hours")
        requested_future_hours = optional_int("future_hours")
        requested_step_minutes = optional_int("step_minutes")
    except (TypeError, ValueError):
        return {"success": False, "data": None, "error": "projection values must be integers"}

    async with AsyncSessionLocal() as dbsession:
        result: Dict[str, Any] = (
            await crud_celestial_vectors.fetch_celestial_vector_snapshot_history(
                dbsession,
                target_key,
                limit=limit,
                requested_past_hours=requested_past_hours,
                requested_future_hours=requested_future_hours,
                requested_step_minutes=requested_step_minutes,
            )
        )
    return result


async def delete_celestial_vector_snapshot(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Any]:
    """Delete one persisted vector snapshot belonging to a canonical target."""
    payload = data if isinstance(data, dict) else {}
    requested_key = payload.get("target_key")
    target_key = normalize_target_key(requested_key)
    if not isinstance(requested_key, str) or requested_key != target_key:
        return {
            "success": False,
            "data": None,
            "error": "target_key must be a canonical mission: or body: key",
        }

    snapshot_id = payload.get("snapshot_id")
    if not isinstance(snapshot_id, str) or not snapshot_id.strip():
        return {"success": False, "data": None, "error": "snapshot_id is required"}

    async with AsyncSessionLocal() as dbsession:
        return cast(
            Dict[str, Any],
            await crud_celestial_vectors.delete_celestial_vector_snapshots(
                dbsession,
                target_key,
                snapshot_id=snapshot_id,
            ),
        )


async def clear_celestial_vector_snapshots(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Any]:
    """Clear expired or all persisted vector snapshots for one target."""
    payload = data if isinstance(data, dict) else {}
    requested_key = payload.get("target_key")
    target_key = normalize_target_key(requested_key)
    if not isinstance(requested_key, str) or requested_key != target_key:
        return {
            "success": False,
            "data": None,
            "error": "target_key must be a canonical mission: or body: key",
        }

    expired_only = payload.get("expired_only", False)
    if not isinstance(expired_only, bool):
        return {"success": False, "data": None, "error": "expired_only must be a boolean"}

    async with AsyncSessionLocal() as dbsession:
        return cast(
            Dict[str, Any],
            await crud_celestial_vectors.delete_celestial_vector_snapshots(
                dbsession,
                target_key,
                expired_only=expired_only,
            ),
        )


async def prune_celestial_vector_snapshots(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Any]:
    """Remove expired snapshot history across all celestial targets."""
    async with AsyncSessionLocal() as dbsession:
        result = await crud_celestial_vectors.prune_expired_celestial_vector_snapshots(
            dbsession,
            expired_before=datetime.now(timezone.utc),
        )
    return cast(Dict[str, Any], result)


async def refresh_celestial_cache_now(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Any]:
    """Run the same complete cache refresh used by the periodic sync job."""

    async def emit_progress(progress: Dict[str, Any]) -> None:
        await sio.emit(
            "celestial-cache-refresh-progress",
            progress,
            to=sid,
        )

    try:
        result = await refresh_celestial_vector_snapshots_cache(
            logger,
            progress_callback=emit_progress,
            trigger="manual",
        )
    finally:
        # Every terminal outcome is pushed to all clients. The page no longer
        # has to issue a second request after synchronization finishes.
        await emit_celestial_ephemeris_status(sio, logger)

    # Return the breaker snapshot from the same point in time as the refresh.
    # This lets the UI explain an upstream outage even if status changes before
    # its follow-up status request completes.
    response_data = {
        **result,
        "provider_status": get_horizons_status(),
    }

    if result.get("success"):
        try:
            projection = result.get("projection")
            # Recompute from the snapshots that were just synchronized so every
            # connected celestial page receives the same fresh view.
            await _broadcast_current_cached_celestial_tracks(
                sio,
                logger,
                projection if isinstance(projection, dict) else None,
            )
        except Exception as exc:
            # The cache refresh has completed; a follow-up broadcast failure
            # should not report the synchronization itself as failed.
            logger.warning(f"Failed to broadcast synchronized celestial tracks: {exc}")

    return {
        "success": bool(result.get("success")),
        "data": response_data,
        "error": result.get("error"),
    }


def register_handlers(registry):
    """Register celestial handlers with command registry."""
    registry.register_batch(
        {
            "get-celestial-scene": (get_celestial_scene, "api_call"),
            "get-solar-system-scene": (get_solar_system_scene, "api_call"),
            "get-celestial-tracks": (get_celestial_tracks, "api_call"),
            "refresh-celestial-now": (refresh_celestial_now, "api_call"),
            "refresh-monitored-celestial-now": (
                refresh_monitored_celestial_now,
                "api_call",
            ),
            "get-monitored-celestial": (get_monitored_celestial, "api_call"),
            "get-spacecraft-index": (get_spacecraft_index_entries, "api_call"),
            "get-celestial-body-catalog": (get_celestial_body_catalog, "api_call"),
            "get-celestial-ephemeris-status": (
                get_celestial_ephemeris_status,
                "api_call",
            ),
            "get-celestial-vector-snapshot-history": (
                get_celestial_vector_snapshot_history,
                "api_call",
            ),
            "delete-celestial-vector-snapshot": (
                delete_celestial_vector_snapshot,
                "api_call",
            ),
            "clear-celestial-vector-snapshots": (
                clear_celestial_vector_snapshots,
                "api_call",
            ),
            "prune-celestial-vector-snapshots": (
                prune_celestial_vector_snapshots,
                "api_call",
            ),
            "refresh-celestial-cache-now": (
                refresh_celestial_cache_now,
                "api_call",
            ),
            "search-spacecraft-index": (
                search_spacecraft_index_entries,
                "api_call",
            ),
            "create-monitored-celestial": (create_monitored_celestial, "api_call"),
            "update-monitored-celestial": (update_monitored_celestial, "api_call"),
            "delete-monitored-celestial": (delete_monitored_celestial, "api_call"),
            "toggle-monitored-celestial-enabled": (
                toggle_monitored_celestial_enabled,
                "api_call",
            ),
        }
    )
