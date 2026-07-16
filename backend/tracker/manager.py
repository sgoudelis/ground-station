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
TrackerManager: Clean interface for controlling the satellite tracker.

The tracker loop polls the database for tracking state changes. This manager
provides a simple API to update that state without directly coupling to the
database schema.
"""

import asyncio
import logging
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, Optional, cast

import crud
import crud.celestialvectors as crud_celestial_vectors
from celestial.bodycatalog import get_celestial_body
from common.constants import RigStates, RotatorStates, TrackerCommandScopes, TrackerCommandStatus
from db import AsyncSessionLocal
from orbits import CentralBody, OrbitServiceError, build_satellite_ephemeris_payload
from tracker.contracts import get_tracking_state_name, require_tracker_id
from tracker.ipc import (
    TRACKER_MSG_COMMAND,
    TRACKER_MSG_SET_HARDWARE,
    TRACKER_MSG_SET_LOCATION,
    TRACKER_MSG_SET_MAP_SETTINGS,
    TRACKER_MSG_SET_SATELLITE_EPHEMERIS,
    TRACKER_MSG_SET_TRACKING_STATE,
    TRACKER_MSG_SET_TRANSMITTERS,
    build_tracker_message,
)

logger = logging.getLogger("tracker-manager")


@dataclass
class PendingTrackingCommand:
    command_id: str
    sid: Optional[str]
    requested_changes: Dict[str, Any]
    desired_state: Dict[str, Any]
    scope: str
    submitted_at: float
    started: bool = False


class TrackerManager:
    """
    Manager for controlling the satellite tracker through database state updates.

    The tracker loop continuously polls the 'satellite-tracking' state record
    in the database. This manager provides a clean interface to update that
    state, which the tracker will pick up on its next iteration (~2 seconds).
    """

    def __init__(self, queue_to_tracker=None, tracker_id: str = ""):
        self.queue_to_tracker = queue_to_tracker
        self.tracker_id = require_tracker_id(tracker_id)
        self.tracking_state_name = get_tracking_state_name(self.tracker_id)
        self.current_tracking_state: Optional[Dict[str, Any]] = None
        self.pending_commands: Dict[str, PendingTrackingCommand] = {}
        self.command_timeout_sec: float = 20.0

    def _send_to_tracker(self, msg_type: str, payload: Dict[str, Any]) -> None:
        if not self.queue_to_tracker:
            logger.warning("Tracker queue not initialized; skipping IPC send")
            return
        message = build_tracker_message(msg_type, payload)
        message["tracker_id"] = self.tracker_id
        self.queue_to_tracker.put(message)

    @staticmethod
    def _normalize_target_type(tracking_state: Dict[str, Any]) -> str:
        target_type = str(tracking_state.get("target_type") or "").strip().lower()
        if target_type in {"satellite", "mission", "body"}:
            return target_type
        if str(tracking_state.get("mission_id") or "").strip():
            return "mission"
        if str(tracking_state.get("command") or "").strip():
            return "mission"
        if str(tracking_state.get("body_id") or "").strip():
            return "body"
        return "satellite"

    @staticmethod
    def _build_non_satellite_transmitter_target_key(tracking_state: Dict[str, Any]) -> str:
        target_type = TrackerManager._normalize_target_type(tracking_state)
        if target_type == "body":
            body_id = str(tracking_state.get("body_id") or "").strip().lower()
            return f"body:{body_id}" if body_id else ""
        if target_type == "mission":
            command = str(tracking_state.get("command") or "").strip()
            return f"mission:{command}" if command else ""
        return ""

    @staticmethod
    async def _fetch_non_satellite_transmitters(
        dbsession,
        *,
        tracking_state: Dict[str, Any],
    ) -> Dict[str, Any]:
        target_key = TrackerManager._build_non_satellite_transmitter_target_key(tracking_state)
        if not target_key:
            return {"success": True, "data": [], "error": None}
        return cast(
            Dict[str, Any],
            await crud.transmitters.fetch_transmitters_for_target_key(dbsession, target_key),
        )

    @staticmethod
    async def _load_cached_vector_payload(
        dbsession,
        *,
        target_key: str,
        allow_stale: bool = False,
    ) -> Optional[Dict[str, Any]]:
        cached = await crud_celestial_vectors.fetch_latest_celestial_vector_snapshot_for_target(
            dbsession,
            target_id=target_key,
            valid_only=True,
            as_of=datetime.now(timezone.utc),
        )
        stale = False
        if allow_stale and cached.get("success") and not isinstance(cached.get("data"), dict):
            # Tracker workers can still interpolate from stored orbit samples after
            # the freshness TTL expires; the scheduled sync will replace this later.
            cached = await crud_celestial_vectors.fetch_latest_celestial_vector_snapshot_for_target(
                dbsession,
                target_id=target_key,
                valid_only=False,
                as_of=datetime.now(timezone.utc),
            )
            stale = isinstance(cached.get("data"), dict)
        if not cached.get("success") or not isinstance(cached.get("data"), dict):
            return None
        cached_data = cached["data"] or {}
        cached_payload = cached_data.get("payload")
        if not isinstance(cached_payload, dict):
            return None
        payload = dict(cached_payload)
        if stale:
            payload["stale"] = True
            logger.warning(
                "Using stale celestial vector snapshot for tracker context "
                "(target_key=%s fetched_at=%s expires_at=%s)",
                target_key,
                cached_data.get("fetched_at"),
                cached_data.get("expires_at"),
            )
        return payload

    async def _build_mission_ephemeris_payload(
        self,
        dbsession,
        *,
        tracking_state: Dict[str, Any],
    ) -> Optional[Dict[str, Any]]:
        command = str(tracking_state.get("command") or "").strip()
        if not command:
            return None

        target_key = f"mission:{command}"
        payload = await self._load_cached_vector_payload(
            dbsession,
            target_key=target_key,
            allow_stale=True,
        )
        earth_payload = await self._load_cached_vector_payload(
            dbsession,
            target_key="body:earth",
            allow_stale=True,
        )
        if payload is None or earth_payload is None:
            return None

        stale = bool(payload.get("stale") or earth_payload.get("stale"))
        return {
            "target_type": "mission",
            "name": str(tracking_state.get("target_name") or command).strip() or command,
            "command": command,
            "position_xyz_au": payload.get("position_xyz_au"),
            "velocity_xyz_au_per_day": payload.get("velocity_xyz_au_per_day"),
            "orbit_samples_xyz_au": payload.get("orbit_samples_xyz_au") or [],
            "orbit_sample_times_utc": payload.get("orbit_sample_times_utc") or [],
            "earth_position_xyz_au": earth_payload.get("position_xyz_au"),
            "earth_velocity_xyz_au_per_day": earth_payload.get("velocity_xyz_au_per_day"),
            "earth_orbit_samples_xyz_au": earth_payload.get("orbit_samples_xyz_au") or [],
            "earth_orbit_sample_times_utc": earth_payload.get("orbit_sample_times_utc") or [],
            "source": payload.get("source", "horizons"),
            "fetched_at_utc": payload.get("fetched_at_utc"),
            "stale": stale,
        }

    async def _build_body_ephemeris_payload(
        self,
        dbsession,
        *,
        tracking_state: Dict[str, Any],
    ) -> Optional[Dict[str, Any]]:
        body_id = str(tracking_state.get("body_id") or "").strip().lower()
        if not body_id:
            return None
        body_payload = await self._load_cached_vector_payload(
            dbsession,
            target_key=f"body:{body_id}",
            allow_stale=True,
        )
        earth_payload = await self._load_cached_vector_payload(
            dbsession,
            target_key="body:earth",
            allow_stale=True,
        )
        if body_payload is None or earth_payload is None:
            return None
        body = get_celestial_body(body_id) or {}
        body_name = (
            str(tracking_state.get("target_name") or body.get("name") or body_id).strip() or body_id
        )
        stale = bool(body_payload.get("stale") or earth_payload.get("stale"))
        return {
            "target_type": "body",
            "body_id": body_id,
            "name": body_name,
            "position_xyz_au": body_payload.get("position_xyz_au"),
            "velocity_xyz_au_per_day": body_payload.get("velocity_xyz_au_per_day"),
            "orbit_samples_xyz_au": body_payload.get("orbit_samples_xyz_au") or [],
            "orbit_sample_times_utc": body_payload.get("orbit_sample_times_utc") or [],
            "earth_position_xyz_au": earth_payload.get("position_xyz_au"),
            "earth_velocity_xyz_au_per_day": earth_payload.get("velocity_xyz_au_per_day"),
            "earth_orbit_samples_xyz_au": earth_payload.get("orbit_samples_xyz_au") or [],
            "earth_orbit_sample_times_utc": earth_payload.get("orbit_sample_times_utc") or [],
            "source": body_payload.get("source", "horizons"),
            "fetched_at_utc": body_payload.get("fetched_at_utc"),
            "stale": stale,
        }

    async def _ensure_tracking_state(self) -> Optional[Dict[str, Any]]:
        if self.current_tracking_state:
            return self.current_tracking_state
        async with AsyncSessionLocal() as dbsession:
            current_state_reply = await crud.trackingstate.get_tracking_state(
                dbsession, name=self.tracking_state_name
            )
        if not current_state_reply.get("success"):
            logger.error(f"Failed to get tracking state: {current_state_reply}")
            return None
        current_value = (current_state_reply.get("data") or {}).get("value", {})
        if not current_value:
            return None
        self.current_tracking_state = dict(current_value)
        return self.current_tracking_state

    async def update_tracking_state(
        self, requester_sid: Optional[str] = None, **kwargs
    ) -> Dict[str, Any]:
        """
        Update any fields in the satellite tracking state.

        The tracker loop will detect these changes on its next iteration and
        respond accordingly (e.g., connecting hardware, changing satellites).

        Args:
            norad_id (int, optional): NORAD ID of satellite to track
            group_id (str, optional): UUID of satellite group
            rotator_state (str, optional): Rotator state - "connected", "disconnected",
                                          "tracking", "stopped", "parked"
            rig_state (str, optional): Rig state - "connected", "disconnected", "tuning"
            rotator_id (str, optional): UUID of rotator hardware or "none"
            rig_id (str, optional): UUID of rig hardware or "none"
            transmitter_id (str, optional): Transmitter id or "none"
            rig_vfo (str, optional): VFO configuration or "none"
            vfo1 (str, optional): VFO1 mode - "uplink" or "downlink"
            vfo2 (str, optional): VFO2 mode - "uplink" or "downlink"

        Returns:
            dict: Response from database operation with 'success' and 'data' fields

        Example:
            # Change target satellite
            await manager.update_tracking_state(norad_id=25544, group_id="abc-123")

            # Connect rotator
            await manager.update_tracking_state(rotator_state="connected")

            # Update multiple fields
            await manager.update_tracking_state(
                norad_id=20442,
                rotator_state="connected",
                rotator_id="2fb00a81-c0fd-4848-ab40-3101751d0534"
            )
        """
        if not kwargs:
            logger.warning("update_tracking_state called with no arguments")
            return {"success": False, "error": "No fields provided to update"}

        async with AsyncSessionLocal() as dbsession:
            # Get current tracking state
            current_state_reply = await crud.trackingstate.get_tracking_state(
                dbsession, name=self.tracking_state_name
            )

            if not current_state_reply.get("success"):
                logger.error(f"Failed to get current tracking state: {current_state_reply}")
                return dict(current_state_reply)

            current_value = (current_state_reply.get("data") or {}).get("value", {})
            effective_changes = {
                key: value for key, value in kwargs.items() if current_value.get(key) != value
            }
            updated_value = {**current_value, **kwargs}

            # Update tracking state in database
            result = await crud.trackingstate.set_tracking_state(
                dbsession,
                {
                    "name": self.tracking_state_name,
                    "value": updated_value,
                },
            )

            if result.get("success"):
                self.current_tracking_state = dict(updated_value)
                logger.info(
                    f"Updated tracking state: {', '.join(f'{k}={v}' for k, v in kwargs.items())}"
                )
            else:
                logger.error(f"Failed to update tracking state: {result}")

            command_id = None
            command_scope = None
            if result.get("success"):
                command_id = self._register_pending_command(
                    requester_sid=requester_sid,
                    requested_changes=effective_changes,
                    desired_state=updated_value,
                )
                if command_id and command_id in self.pending_commands:
                    command_scope = self.pending_commands[command_id].scope
                await self._sync_tracker_context(updated_value)

            response = dict(result)
            if command_id:
                response["command_id"] = command_id
                response["command_scope"] = command_scope or TrackerCommandScopes.TRACKING
            return response

    async def get_tracking_state(self) -> Optional[Dict[str, Any]]:
        """
        Get the current satellite tracking state from the database.

        Returns:
            dict or None: Current tracking state value containing norad_id, group_id,
                         rotator_state, rig_state, hardware IDs, etc. Returns None
                         if no tracking state exists.

        Example:
            state = await manager.get_tracking_state()
            # Returns: {
            #     "norad_id": 20442,
            #     "group_id": "8d8bdad0-...",
            #     "rotator_state": "connected",
            #     "rig_state": "disconnected",
            #     "rotator_id": "2fb00a81-...",
            #     ...
            # }
        """
        async with AsyncSessionLocal() as dbsession:
            result = await crud.trackingstate.get_tracking_state(
                dbsession, name=self.tracking_state_name
            )

            if result.get("success") and result.get("data"):
                value = result["data"].get("value")
                self.current_tracking_state = dict(value) if value else None
                return dict(value) if value else None

            logger.warning(f"Failed to get tracking state: {result}")
            return None

    async def stop_tracking(self) -> Dict[str, Any]:
        """
        Stop all tracking and disconnect hardware.

        This is a convenience method that sets both rotator and rig states
        to disconnected.

        Returns:
            dict: Response from database operation
        """
        return await self.update_tracking_state(
            rotator_state="disconnected",
            rig_state="disconnected",
        )

    async def notify_transmitters_changed(self, norad_id: int) -> None:
        logger.info(
            "notify_transmitters_changed called (norad_id=%s, tracking=%s)",
            norad_id,
            (self.current_tracking_state or {}).get("norad_id"),
        )
        if not norad_id:
            logger.debug("notify_transmitters_changed: no norad_id provided")
            return
        tracking_state = await self._ensure_tracking_state()
        if not tracking_state:
            logger.debug("notify_transmitters_changed: no tracking state available")
            return
        if str(tracking_state.get("norad_id")) != str(norad_id):
            logger.info(
                "notify_transmitters_changed: norad_id mismatch (tracking=%s notify=%s)",
                tracking_state.get("norad_id"),
                norad_id,
            )
            logger.debug(
                "notify_transmitters_changed: norad_id mismatch (tracking=%s notify=%s)",
                tracking_state.get("norad_id"),
                norad_id,
            )
            return
        logger.info("notify_transmitters_changed: fetching transmitters (norad_id=%s)", norad_id)
        async with AsyncSessionLocal() as dbsession:
            try:
                transmitters = await asyncio.wait_for(
                    crud.transmitters.fetch_transmitters_for_satellite(
                        dbsession, norad_id=norad_id
                    ),
                    timeout=5.0,
                )
            except asyncio.TimeoutError:
                logger.error(
                    "notify_transmitters_changed: fetch_transmitters timed out (norad_id=%s)",
                    norad_id,
                )
                return
        logger.info(
            "notify_transmitters_changed: fetch complete (norad_id=%s, success=%s, count=%s)",
            norad_id,
            transmitters.get("success"),
            len(transmitters.get("data", [])) if transmitters.get("data") else 0,
        )
        if transmitters.get("success"):
            logger.info(
                "notify_transmitters_changed: sending %s transmitters for norad_id=%s",
                len(transmitters.get("data", [])),
                norad_id,
            )
            logger.debug(
                "notify_transmitters_changed: sending %s transmitters for norad_id=%s",
                len(transmitters.get("data", [])),
                norad_id,
            )
            self._send_to_tracker(
                TRACKER_MSG_SET_TRANSMITTERS, {"items": transmitters.get("data", [])}
            )
        else:
            logger.debug(
                "notify_transmitters_changed: failed to fetch transmitters for norad_id=%s (%s)",
                norad_id,
                transmitters.get("error"),
            )

    async def notify_non_satellite_transmitters_changed(self, target_key: str) -> None:
        normalized_target_key = crud.transmitters.normalize_target_key(target_key)
        if not normalized_target_key:
            return

        tracking_state = await self._ensure_tracking_state()
        if not tracking_state:
            return

        current_target_key = self._build_non_satellite_transmitter_target_key(tracking_state)
        if current_target_key != normalized_target_key:
            return

        async with AsyncSessionLocal() as dbsession:
            transmitters = await crud.transmitters.fetch_transmitters_for_target_key(
                dbsession, normalized_target_key
            )
        if transmitters.get("success"):
            self._send_to_tracker(
                TRACKER_MSG_SET_TRANSMITTERS,
                {"items": transmitters.get("data", [])},
            )

    def notify_transmitters_changed_with_items(
        self, norad_id: int, transmitters: list[dict]
    ) -> None:
        if not norad_id:
            return
        if not transmitters:
            logger.info(
                "notify_transmitters_changed_with_items: no transmitters for norad_id=%s",
                norad_id,
            )
            return
        tracking_state = self.current_tracking_state or {}
        if str(tracking_state.get("norad_id")) != str(norad_id):
            return
        logger.info(
            "notify_transmitters_changed_with_items: sending %s transmitters for norad_id=%s",
            len(transmitters),
            norad_id,
        )
        self._send_to_tracker(TRACKER_MSG_SET_TRANSMITTERS, {"items": transmitters})

    async def notify_tle_updated(self, norad_id: int) -> None:
        if not norad_id:
            logger.debug("notify_tle_updated: no norad_id provided")
            return
        tracking_state = await self._ensure_tracking_state()
        if not tracking_state:
            logger.debug("notify_tle_updated: no tracking state available")
            return
        if str(tracking_state.get("norad_id")) != str(norad_id):
            logger.debug(
                "notify_tle_updated: norad_id mismatch (tracking=%s notify=%s)",
                tracking_state.get("norad_id"),
                norad_id,
            )
            return
        logger.info("notify_tle_updated: fetching satellite record (norad_id=%s)", norad_id)
        async with AsyncSessionLocal() as dbsession:
            try:
                satellites = await asyncio.wait_for(
                    crud.satellites.fetch_satellites(dbsession, norad_id=norad_id),
                    timeout=5.0,
                )
            except asyncio.TimeoutError:
                logger.error(
                    "notify_tle_updated: fetch_satellites timed out (norad_id=%s)", norad_id
                )
                return
        if not satellites.get("success") or not satellites.get("data"):
            logger.debug(
                "notify_tle_updated: satellite not found for norad_id=%s (%s)",
                norad_id,
                satellites.get("error"),
            )
            return
        sat = satellites["data"][0]
        logger.info("notify_tle_updated: sending TLE update for norad_id=%s", norad_id)
        logger.debug("notify_tle_updated: sending TLE update for norad_id=%s", norad_id)
        try:
            payload = build_satellite_ephemeris_payload(sat, central_body=CentralBody.EARTH)
        except OrbitServiceError as e:
            logger.error("notify_tle_updated: invalid orbit data for norad_id=%s (%s)", norad_id, e)
            return
        self._send_to_tracker(TRACKER_MSG_SET_SATELLITE_EPHEMERIS, payload)

    async def notify_tracking_inputs_from_db(self, norad_id: int) -> None:
        if not norad_id:
            logger.debug("notify_tracking_inputs_from_db: no norad_id provided")
            return
        tracking_state = await self._ensure_tracking_state()
        if not tracking_state:
            logger.debug("notify_tracking_inputs_from_db: no tracking state available")
            return
        if str(tracking_state.get("norad_id")) != str(norad_id):
            return
        async with AsyncSessionLocal() as dbsession:
            try:
                satellites = await asyncio.wait_for(
                    crud.satellites.fetch_satellites(dbsession, norad_id=norad_id),
                    timeout=5.0,
                )
                transmitters = await asyncio.wait_for(
                    crud.transmitters.fetch_transmitters_for_satellite(
                        dbsession, norad_id=norad_id
                    ),
                    timeout=5.0,
                )
            except asyncio.TimeoutError:
                logger.error(
                    "notify_tracking_inputs_from_db: fetch timed out (norad_id=%s)", norad_id
                )
                return
        if satellites.get("success") and satellites.get("data"):
            sat = satellites["data"][0]
            try:
                payload = build_satellite_ephemeris_payload(sat, central_body=CentralBody.EARTH)
            except OrbitServiceError as e:
                logger.error(
                    "notify_tracking_inputs_from_db: invalid orbit data for norad_id=%s (%s)",
                    norad_id,
                    e,
                )
            else:
                self._send_to_tracker(TRACKER_MSG_SET_SATELLITE_EPHEMERIS, payload)
        if transmitters.get("success"):
            self._send_to_tracker(
                TRACKER_MSG_SET_TRANSMITTERS,
                {"items": transmitters.get("data", [])},
            )

    async def sync_tracking_state_from_db(self) -> None:
        async with AsyncSessionLocal() as dbsession:
            current_state_reply = await crud.trackingstate.get_tracking_state(
                dbsession, name=self.tracking_state_name
            )
        if not current_state_reply.get("success"):
            logger.error(f"Failed to get tracking state: {current_state_reply}")
            return
        current_value = (current_state_reply.get("data") or {}).get("value", {})
        if not current_value:
            return
        self.current_tracking_state = dict(current_value)
        await self._sync_tracker_context(self.current_tracking_state)

    async def notify_locations_changed(self) -> None:
        async with AsyncSessionLocal() as dbsession:
            locations = await crud.locations.fetch_all_locations(dbsession)
        if locations.get("success") and locations.get("data"):
            self._send_to_tracker(TRACKER_MSG_SET_LOCATION, locations["data"][0])

    def notify_map_settings_changed(self, map_settings: Dict[str, Any]) -> None:
        if map_settings:
            self._send_to_tracker(TRACKER_MSG_SET_MAP_SETTINGS, dict(map_settings))

    async def notify_hardware_changed(
        self, rig_id: Optional[str] = None, rotator_id: Optional[str] = None
    ) -> None:
        if not self.current_tracking_state:
            return
        payload: Dict[str, Any] = {}
        async with AsyncSessionLocal() as dbsession:
            if rig_id:
                if self.current_tracking_state.get("rig_id") != rig_id:
                    rig_id = None
                else:
                    rigs = await crud.hardware.fetch_rigs(dbsession, rig_id=rig_id)
                    if rigs.get("success") and rigs.get("data"):
                        payload["rig"] = rigs["data"]
                        payload["rig_type"] = "radio"
                    else:
                        sdrs = await crud.hardware.fetch_sdr(dbsession, sdr_id=rig_id)
                        if sdrs.get("success") and sdrs.get("data"):
                            payload["sdr"] = sdrs["data"]
                            payload["rig_type"] = "sdr"
            if rotator_id and str(rotator_id).lower() != "none":
                if self.current_tracking_state.get("rotator_id") != rotator_id:
                    rotator_id = None
                else:
                    rotators = await crud.hardware.fetch_rotators(dbsession, rotator_id=rotator_id)
                    if rotators.get("success") and rotators.get("data"):
                        payload["rotator"] = rotators["data"]

        if payload:
            self._send_to_tracker(TRACKER_MSG_SET_HARDWARE, payload)

    async def _sync_tracker_context(self, tracking_state: Dict[str, Any]) -> None:
        """Push a snapshot of inputs the tracker normally reads from the DB."""
        self._send_to_tracker(TRACKER_MSG_SET_TRACKING_STATE, dict(tracking_state))

        async with AsyncSessionLocal() as dbsession:
            locations = await crud.locations.fetch_all_locations(dbsession)
            if locations.get("success") and locations.get("data"):
                self._send_to_tracker(TRACKER_MSG_SET_LOCATION, locations["data"][0])

            map_settings_reply = await crud.preferences.get_map_settings(
                dbsession, "target-map-settings"
            )
            map_settings = (map_settings_reply.get("data") or {}).get("value", {})
            self._send_to_tracker(TRACKER_MSG_SET_MAP_SETTINGS, map_settings)
            target_type = self._normalize_target_type(tracking_state)
            if target_type == "satellite":
                norad_id = tracking_state.get("norad_id")
                if norad_id:
                    satellites = await crud.satellites.fetch_satellites(
                        dbsession, norad_id=norad_id
                    )
                    if satellites.get("success") and satellites.get("data"):
                        sat = satellites["data"][0]
                        try:
                            payload = build_satellite_ephemeris_payload(
                                sat, central_body=CentralBody.EARTH
                            )
                        except OrbitServiceError as e:
                            logger.error(
                                "_sync_tracker_context: invalid orbit data for norad_id=%s (%s)",
                                norad_id,
                                e,
                            )
                        else:
                            self._send_to_tracker(TRACKER_MSG_SET_SATELLITE_EPHEMERIS, payload)

                    transmitters = await crud.transmitters.fetch_transmitters_for_satellite(
                        dbsession, norad_id=norad_id
                    )
                    if transmitters.get("success"):
                        self._send_to_tracker(
                            TRACKER_MSG_SET_TRANSMITTERS,
                            {"items": transmitters.get("data", [])},
                        )
            elif target_type == "mission":
                mission_payload = await self._build_mission_ephemeris_payload(
                    dbsession,
                    tracking_state=tracking_state,
                )
                if mission_payload:
                    self._send_to_tracker(TRACKER_MSG_SET_SATELLITE_EPHEMERIS, mission_payload)
                else:
                    mission_command = str(tracking_state.get("command") or "").strip()
                    logger.warning(
                        "_sync_tracker_context: no mission ephemeris payload for tracker '%s' (command='%s')",
                        self.tracker_id,
                        mission_command or "unknown",
                    )
                transmitters = await self._fetch_non_satellite_transmitters(
                    dbsession,
                    tracking_state=tracking_state,
                )
                if transmitters.get("success"):
                    self._send_to_tracker(
                        TRACKER_MSG_SET_TRANSMITTERS,
                        {"items": transmitters.get("data", [])},
                    )
            elif target_type == "body":
                body_payload = await self._build_body_ephemeris_payload(
                    dbsession,
                    tracking_state=tracking_state,
                )
                if body_payload:
                    self._send_to_tracker(TRACKER_MSG_SET_SATELLITE_EPHEMERIS, body_payload)
                else:
                    body_id = str(tracking_state.get("body_id") or "").strip().lower()
                    logger.warning(
                        "_sync_tracker_context: no body ephemeris payload for tracker '%s' (body_id='%s')",
                        self.tracker_id,
                        body_id or "unknown",
                    )
                transmitters = await self._fetch_non_satellite_transmitters(
                    dbsession,
                    tracking_state=tracking_state,
                )
                if transmitters.get("success"):
                    self._send_to_tracker(
                        TRACKER_MSG_SET_TRANSMITTERS,
                        {"items": transmitters.get("data", [])},
                    )

            rig_id = tracking_state.get("rig_id")
            rotator_id = tracking_state.get("rotator_id")
            if rig_id:
                rigs = await crud.hardware.fetch_rigs(dbsession, rig_id=rig_id)
                if rigs.get("success") and rigs.get("data"):
                    self._send_to_tracker(
                        TRACKER_MSG_SET_HARDWARE,
                        {"rig": rigs["data"], "rig_type": "radio"},
                    )
                else:
                    sdrs = await crud.hardware.fetch_sdr(dbsession, sdr_id=rig_id)
                    if sdrs.get("success") and sdrs.get("data"):
                        self._send_to_tracker(
                            TRACKER_MSG_SET_HARDWARE,
                            {"sdr": sdrs["data"], "rig_type": "sdr"},
                        )

            if rotator_id and str(rotator_id).lower() != "none":
                rotators = await crud.hardware.fetch_rotators(dbsession, rotator_id=rotator_id)
                if rotators.get("success") and rotators.get("data"):
                    self._send_to_tracker(TRACKER_MSG_SET_HARDWARE, {"rotator": rotators["data"]})

    def _infer_scope(self, requested_changes: Dict[str, Any]) -> str:
        keys = set(requested_changes.keys())
        if {"rotator_state", "rotator_id"} & keys:
            return cast(str, TrackerCommandScopes.ROTATOR)
        if {"rig_state", "rig_id", "rig_vfo", "vfo1", "vfo2", "transmitter_id"} & keys:
            return cast(str, TrackerCommandScopes.RIG)
        if {"norad_id", "group_id", "target_type", "mission_id", "command", "body_id"} & keys:
            return cast(str, TrackerCommandScopes.TARGET)
        return cast(str, TrackerCommandScopes.TRACKING)

    def _register_pending_command(
        self,
        requester_sid: Optional[str],
        requested_changes: Dict[str, Any],
        desired_state: Dict[str, Any],
    ) -> Optional[str]:
        if not requested_changes:
            return None
        command_id = str(uuid.uuid4())
        self.pending_commands[command_id] = PendingTrackingCommand(
            command_id=command_id,
            sid=requester_sid,
            requested_changes=dict(requested_changes),
            desired_state=dict(desired_state),
            scope=self._infer_scope(requested_changes),
            submitted_at=time.time(),
        )
        return command_id

    @staticmethod
    def _state_keys_match(actual_tracking_state: Dict[str, Any], expected: Dict[str, Any]) -> bool:
        for key, value in expected.items():
            if key not in actual_tracking_state:
                continue
            if actual_tracking_state.get(key) != value:
                return False
        return True

    @staticmethod
    def _rotator_success_for_state(desired_state: str, rotator_data: Dict[str, Any]) -> bool:
        if desired_state == RotatorStates.CONNECTED:
            return bool(rotator_data.get("connected"))
        if desired_state == RotatorStates.DISCONNECTED:
            return not bool(rotator_data.get("connected"))
        if desired_state == RotatorStates.TRACKING:
            return bool(rotator_data.get("connected")) and bool(rotator_data.get("tracking"))
        if desired_state == RotatorStates.STOPPED:
            return bool(rotator_data.get("connected")) and bool(rotator_data.get("stopped"))
        if desired_state == RotatorStates.PARKED:
            return bool(rotator_data.get("connected")) and bool(rotator_data.get("parked"))
        return True

    @staticmethod
    def _rig_success_for_state(desired_state: str, rig_data: Dict[str, Any]) -> bool:
        if desired_state == RigStates.CONNECTED:
            return bool(rig_data.get("connected"))
        if desired_state == RigStates.DISCONNECTED:
            return not bool(rig_data.get("connected"))
        if desired_state == RigStates.TRACKING:
            return bool(rig_data.get("connected")) and bool(rig_data.get("tracking"))
        if desired_state == RigStates.STOPPED:
            return bool(rig_data.get("connected")) and bool(rig_data.get("stopped"))
        return True

    def _is_command_succeeded(
        self, command: PendingTrackingCommand, tracking_update: Dict[str, Any]
    ) -> bool:
        tracking_state = tracking_update.get("tracking_state") or {}
        rotator_data = tracking_update.get("rotator_data") or {}
        rig_data = tracking_update.get("rig_data") or {}

        if not self._state_keys_match(tracking_state, command.requested_changes):
            return False

        desired_rotator_state = command.requested_changes.get("rotator_state")
        if desired_rotator_state and not self._rotator_success_for_state(
            desired_rotator_state, rotator_data
        ):
            return False

        desired_rig_state = command.requested_changes.get("rig_state")
        if desired_rig_state and not self._rig_success_for_state(desired_rig_state, rig_data):
            return False

        return True

    def process_tracking_update(self, tracking_update: Dict[str, Any]) -> list[Dict[str, Any]]:
        update_tracker_id = require_tracker_id(tracking_update.get("tracker_id"))
        if update_tracker_id != self.tracker_id:
            return []
        if not self.pending_commands:
            return []

        now = time.time()
        tracking_state = tracking_update.get("tracking_state") or {}
        rotator_data = tracking_update.get("rotator_data") or {}
        rig_data = tracking_update.get("rig_data") or {}

        status_events: list[Dict[str, Any]] = []
        to_remove: list[str] = []

        for command_id, command in self.pending_commands.items():
            if not command.started and self._state_keys_match(
                tracking_state, command.requested_changes
            ):
                command.started = True
                status_events.append(
                    {
                        "command_id": command.command_id,
                        "tracker_id": self.tracker_id,
                        "status": TrackerCommandStatus.STARTED,
                        "scope": command.scope,
                    }
                )

            if self._is_command_succeeded(command, tracking_update):
                status_events.append(
                    {
                        "command_id": command.command_id,
                        "tracker_id": self.tracker_id,
                        "status": TrackerCommandStatus.SUCCEEDED,
                        "scope": command.scope,
                    }
                )
                to_remove.append(command_id)
                continue

            if command.requested_changes.get("rotator_state") and rotator_data.get("error"):
                status_events.append(
                    {
                        "command_id": command.command_id,
                        "tracker_id": self.tracker_id,
                        "status": TrackerCommandStatus.FAILED,
                        "scope": command.scope,
                        "reason": "rotator_error",
                    }
                )
                to_remove.append(command_id)
                continue

            if command.requested_changes.get("rig_state") and rig_data.get("error"):
                status_events.append(
                    {
                        "command_id": command.command_id,
                        "tracker_id": self.tracker_id,
                        "status": TrackerCommandStatus.FAILED,
                        "scope": command.scope,
                        "reason": "rig_error",
                    }
                )
                to_remove.append(command_id)
                continue

            if now - command.submitted_at > self.command_timeout_sec:
                status_events.append(
                    {
                        "command_id": command.command_id,
                        "tracker_id": self.tracker_id,
                        "status": TrackerCommandStatus.FAILED,
                        "scope": command.scope,
                        "reason": "timeout",
                    }
                )
                to_remove.append(command_id)

        for command_id in to_remove:
            self.pending_commands.pop(command_id, None)

        return status_events

    def send_command(self, command: str, data: Optional[Dict[str, Any]] = None) -> None:
        self._send_to_tracker(TRACKER_MSG_COMMAND, {"command": command, "data": data})
