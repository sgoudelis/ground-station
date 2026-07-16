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

import crud.locations as crud_locations
import crud.monitoredcelestial as crud_monitored
from celestial.bodycatalog import get_celestial_body, list_celestial_bodies
from celestial.horizons import fetch_celestial_vectors
from celestial.scene import build_celestial_scene, build_celestial_tracks, build_solar_system_scene
from celestial.spacecraftindex import get_spacecraft_index, search_spacecraft_index
from db import AsyncSessionLocal

_monitored_refresh_lock = asyncio.Lock()


def _find_static_spacecraft_match(query: str) -> Optional[Dict[str, Any]]:
    needle = (query or "").strip().lower()
    if not needle:
        return None

    for entry in get_spacecraft_index():
        if needle == str(entry.get("command") or "").strip().lower():
            return cast(Dict[str, Any], entry)
        if needle == str(entry.get("display_name") or "").strip().lower():
            return cast(Dict[str, Any], entry)
        aliases = entry.get("aliases") or []
        if any(needle == str(alias).strip().lower() for alias in aliases):
            return cast(Dict[str, Any], entry)
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
            }
        )

    return payload


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
    return cast(Dict[str, Any], scene)


async def get_solar_system_scene(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Any]:
    """Fetch solar system scene, cache-only unless the caller explicitly allows network."""
    logger.debug(f"Fetching solar system scene, data: {data}")
    payload = cast(Optional[Dict[str, Any]], data)
    allow_network_fetch = bool(
        payload.get("allow_network_fetch") if isinstance(payload, dict) else False
    )
    scene = await build_solar_system_scene(
        data=payload,
        logger=logger,
        allow_network_fetch=allow_network_fetch,
    )
    return cast(Dict[str, Any], scene)


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
    return cast(Dict[str, Any], tracks)


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
    return cast(Dict[str, Any], scene)


async def refresh_monitored_celestial_now(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Any]:
    """Force-refresh monitored celestial targets and persist refresh metadata."""
    if _monitored_refresh_lock.locked():
        return {"success": False, "error": "Monitored celestial refresh already in progress"}

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
            return cast(Dict[str, Any], tracks)

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
            target_key = (
                f"body:{str(target.get('body_id') or '').strip().lower()}"
                if target_type == "body"
                else f"mission:{str(target.get('command') or '').strip()}"
            )
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
        return cast(Dict[str, Any], tracks)


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
        entries = get_spacecraft_index()[:limit]
        return {"success": True, "data": entries, "error": None}
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

        rows = search_spacecraft_index(query=query, limit=limit)
        return {"success": True, "data": rows, "error": None}
    except Exception as exc:
        logger.error(f"Failed searching spacecraft index: {exc}")
        return {"success": False, "error": str(exc), "data": []}


async def get_celestial_body_catalog(
    sio: Any, data: Optional[Dict], logger: Any, sid: str
) -> Dict[str, Any]:
    """Return static celestial body catalog entries."""
    try:
        return {"success": True, "data": list_celestial_bodies(), "error": None}
    except Exception as exc:
        logger.error(f"Failed loading celestial body catalog: {exc}")
        return {"success": False, "error": str(exc), "data": []}


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
