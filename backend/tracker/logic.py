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


import asyncio
import logging
import multiprocessing
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import psutil

from celestial.observermath import compute_observer_sky_position
from common.arguments import arguments as args
from common.constants import DictKeys, SocketEvents
from orbits import CentralBody, OrbitServiceError, get_propagation_input
from tracker.contracts import require_tracker_id
from tracker.data import compiled_satellite_data_from_inputs
from tracker.ipc import (
    TRACKER_MSG_COMMAND,
    TRACKER_MSG_SET_HARDWARE,
    TRACKER_MSG_SET_LOCATION,
    TRACKER_MSG_SET_MAP_SETTINGS,
    TRACKER_MSG_SET_SATELLITE_EPHEMERIS,
    TRACKER_MSG_SET_TRACKING_STATE,
    TRACKER_MSG_SET_TRANSMITTERS,
)
from tracker.righandler import RigHandler
from tracker.rotatorhandler import RotatorHandler
from tracker.statemanager import StateManager
from tracking.doppler import calculate_range_rate_from_heliocentric_vectors

logger = logging.getLogger("tracker-worker")


class TrackerOutputQueueProxy:
    """Inject tracker_id into every tracker->main process message."""

    def __init__(self, queue_out: multiprocessing.Queue, tracker_id: str):
        self._queue_out = queue_out
        self._tracker_id = require_tracker_id(tracker_id)

    def put(self, message: Dict[str, Any]):
        if not isinstance(message, dict):
            self._queue_out.put(message)
            return

        enriched = dict(message)
        enriched.setdefault("tracker_id", self._tracker_id)
        data = enriched.get(DictKeys.DATA)
        if isinstance(data, dict):
            data_copy = dict(data)
            data_copy.setdefault("tracker_id", self._tracker_id)
            enriched[DictKeys.DATA] = data_copy
        self._queue_out.put(enriched)


class SatelliteTracker:
    """
    Satellite tracking class that manages rotator and rig controllers
    for automated satellite tracking in a multiprocessing environment.
    """

    def __init__(
        self,
        queue_out: multiprocessing.Queue,
        queue_in: multiprocessing.Queue,
        stop_event=None,
        tracker_id: str = "",
    ):
        """Initialize the satellite tracker with queues and configuration."""
        # Store queue references
        self.rotator_details: Dict[str, Any] = {}
        self.rig_details: Dict[str, Any] = {}
        self.tracker_id = require_tracker_id(tracker_id)
        self.queue_out = TrackerOutputQueueProxy(queue_out, self.tracker_id)
        self.queue_in = queue_in
        self.stop_event = stop_event

        # Configuration constants (will be updated from rotator_details)
        self.azimuth_limits = (0, 360)
        self.elevation_limits = (0, 90)
        self.az_tolerance = 2.0
        self.el_tolerance = 2.0

        # State tracking
        self.current_rotator_id = "none"
        self.current_rig_id = "none"
        self.current_transmitter_id = "none"
        self.current_rig_vfo = "none"
        self.current_vfo1 = "uplink"
        self.current_vfo2 = "downlink"
        self.current_rotator_state = "disconnected"
        self.current_rig_state = "disconnected"
        self.current_target_type = "satellite"
        self.current_norad_id = None
        self.current_group_id = None

        # Hardware controllers
        self.rotator_controller = None
        self.rig_controller = None

        # Data structures
        self.rotator_data = {
            "az": 0,
            "el": 0,
            "connected": False,
            "tracking": False,
            "slewing": False,
            "outofbounds": False,
            "minelevation": False,
            "maxelevation": False,
            "minazimuth": False,
            "maxazimuth": False,
            "stopped": False,
            "error": False,
            "host": "",
            "port": 0,
            "minaz": None,
            "maxaz": None,
            "minel": None,
            "maxel": None,
            "parkaz": None,
            "parkel": None,
        }
        self.rig_data = {
            "connected": False,
            "tracking": False,
            "stopped": False,
            "error": False,
            "frequency": 0,
            "downlink_observed_freq": 0,
            "doppler_shift": 0,
            "original_freq": 0,
            "transmitter_id": "none",
            "transmitters": [],
            "device_type": "",
            "host": "",
            "port": 0,
            "radio_mode": "duplex",
            "tx_control_mode": "auto",
            "active_tx_control_mode": "vfo_switch",
            "retune_interval_ms": 2000,
            "vfo1": {
                "frequency": 0,
                "mode": "UNKNOWN",
                "bandwidth": 0,
            },
            "vfo2": {
                "frequency": 0,
                "mode": "UNKNOWN",
                "bandwidth": 0,
            },
        }

        # Operational state
        self.notified: Dict[str, bool] = {}
        self.nudge_offset = {"az": 0, "el": 0}
        self.rotator_command_state: Dict[str, Any] = {
            "in_flight": False,
            "target_az": None,
            "target_el": None,
            "last_command_ts": 0.0,
            "settle_hits": 0,
        }
        self.rotator_retarget_threshold_deg = 2.0
        self.rotator_command_refresh_sec = 6.0
        self.rotator_settle_hits_required = 2

        # Satellite data
        self.satellite_data: Dict[str, Any] = {}

        # State change tracking (replacing StateTracker)
        self.prev_norad_id: Optional[int] = None
        self.prev_rotator_state: Optional[str] = None
        self.prev_rotator_id: Optional[str] = None
        self.prev_rig_state: Optional[str] = None
        self.prev_transmitter_id: Optional[str] = None
        self.prev_rig_id: Optional[str] = None

        # Events to send the UI
        self.events: List[Dict[str, Any]] = []

        # Performance monitoring
        self.start_loop_date: Optional[datetime] = None

        # Stats tracking
        self.stats: Dict[str, Any] = {
            "updates_sent": 0,
            "commands_processed": 0,
            "db_queries": 0,
            "tracking_cycles": 0,
            "rotator_updates": 0,
            "rig_updates": 0,
            "last_activity": None,
            "errors": 0,
            "cpu_percent": 0.0,
            "memory_mb": 0.0,
            "memory_percent": 0.0,
        }
        self.last_stats_send = time.time()
        self.stats_send_interval = 1.0

        # CPU and memory monitoring
        self.process = psutil.Process()
        self.last_cpu_check = time.time()
        self.cpu_check_interval = 0.5

        # Initialize handlers
        self.rotator_handler = RotatorHandler(self)
        self.rig_handler = RigHandler(self)
        self.state_manager = StateManager(self)

        # Inputs provided by manager via IPC
        self.input_tracking_state: Optional[Dict[str, Any]] = None
        self.input_location: Optional[Dict[str, Any]] = None
        self.input_transmitters: List[Dict[str, Any]] = []
        self.input_satellite: Optional[Dict[str, Any]] = None
        self.input_target_ephemeris: Optional[Dict[str, Any]] = None
        self.input_map_settings: Dict[str, Any] = {}
        self.input_hardware: Dict[str, Any] = {}

    def in_tracking_state(self) -> bool:
        """Check if rotator is currently in tracking state."""
        return self.current_rotator_state == "tracking"

    @staticmethod
    def _normalize_target_type(tracking_state: Dict[str, Any]) -> str:
        target_type = str(tracking_state.get("target_type") or "").strip().lower()
        if target_type in {"satellite", "mission", "body"}:
            return target_type
        if str(tracking_state.get("command") or "").strip():
            return "mission"
        if str(tracking_state.get("body_id") or "").strip():
            return "body"
        return "satellite"

    @staticmethod
    def _parse_iso_utc(value: Any) -> Optional[datetime]:
        text = str(value or "").strip()
        if not text:
            return None
        try:
            if text.endswith("Z"):
                text = text[:-1] + "+00:00"
            parsed = datetime.fromisoformat(text)
        except Exception:
            return None
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)

    @classmethod
    def _interpolate_orbit_position(
        cls,
        payload: Dict[str, Any],
        *,
        samples_key: str,
        times_key: str,
        epoch: datetime,
    ) -> Optional[List[float]]:
        raw_positions = payload.get(samples_key)
        if not isinstance(raw_positions, list) or not raw_positions:
            return None

        positions: List[List[float]] = []
        for item in raw_positions:
            if not isinstance(item, list) or len(item) < 3:
                continue
            try:
                positions.append([float(item[0]), float(item[1]), float(item[2])])
            except (TypeError, ValueError):
                continue
        if not positions:
            return None

        if len(positions) == 1:
            return positions[0]

        raw_times = payload.get(times_key)
        if not isinstance(raw_times, list) or len(raw_times) != len(positions):
            return None
        time_position_pairs: List[tuple[datetime, List[float]]] = []
        for raw_time, position in zip(raw_times, positions):
            parsed_time = cls._parse_iso_utc(raw_time)
            if parsed_time is None:
                return None
            time_position_pairs.append((parsed_time, position))

        ordered = sorted(time_position_pairs, key=lambda item: item[0])
        first_time, first_pos = ordered[0]
        last_time, last_pos = ordered[-1]
        if first_time is None or last_time is None:
            return None
        if epoch <= first_time:
            return [float(first_pos[0]), float(first_pos[1]), float(first_pos[2])]
        if epoch >= last_time:
            return [float(last_pos[0]), float(last_pos[1]), float(last_pos[2])]

        for index in range(1, len(ordered)):
            left_time, left_pos = ordered[index - 1]
            right_time, right_pos = ordered[index]
            if left_time is None or right_time is None:
                continue
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

    @classmethod
    def _interpolate_mission_position(
        cls, payload: Dict[str, Any], epoch: datetime
    ) -> Optional[List[float]]:
        return cls._interpolate_orbit_position(
            payload,
            samples_key="orbit_samples_xyz_au",
            times_key="orbit_sample_times_utc",
            epoch=epoch,
        )

    @classmethod
    def _interpolate_earth_position(
        cls, payload: Dict[str, Any], epoch: datetime
    ) -> Optional[List[float]]:
        return cls._interpolate_orbit_position(
            payload,
            samples_key="earth_orbit_samples_xyz_au",
            times_key="earth_orbit_sample_times_utc",
            epoch=epoch,
        )

    @staticmethod
    def _parse_position_vector(value: Any) -> Optional[List[float]]:
        if not isinstance(value, list) or len(value) < 3:
            return None
        try:
            return [float(value[0]), float(value[1]), float(value[2])]
        except (TypeError, ValueError):
            return None

    @staticmethod
    def _parse_velocity_vector(value: Any) -> Optional[List[float]]:
        if not isinstance(value, list) or len(value) < 3:
            return None
        try:
            return [float(value[0]), float(value[1]), float(value[2])]
        except (TypeError, ValueError):
            return None

    @classmethod
    def _interpolate_orbit_velocity(
        cls,
        payload: Dict[str, Any],
        *,
        samples_key: str,
        times_key: str,
        epoch: datetime,
    ) -> Optional[List[float]]:
        positions_obj = payload.get(samples_key)
        raw_times_obj = payload.get(times_key)
        if not isinstance(positions_obj, list) or not isinstance(raw_times_obj, list):
            return None
        if len(positions_obj) < 2 or len(raw_times_obj) < 2:
            return None

        paired_samples: List[tuple[datetime, List[float]]] = []
        for index, raw_time in enumerate(raw_times_obj):
            if index >= len(positions_obj):
                break
            parsed_time = cls._parse_iso_utc(raw_time)
            parsed_position = cls._parse_position_vector(positions_obj[index])
            if parsed_time is None or parsed_position is None:
                continue
            paired_samples.append((parsed_time, parsed_position))

        if len(paired_samples) < 2:
            return None

        ordered = sorted(paired_samples, key=lambda item: item[0])
        left_time: Optional[datetime]
        right_time: Optional[datetime]
        left_pos: Optional[List[float]]
        right_pos: Optional[List[float]]
        if epoch <= ordered[0][0]:
            left_time, left_pos = ordered[0]
            right_time, right_pos = ordered[1]
        elif epoch >= ordered[-1][0]:
            left_time, left_pos = ordered[-2]
            right_time, right_pos = ordered[-1]
        else:
            left_time = right_time = None
            left_pos = right_pos = None
            for index in range(1, len(ordered)):
                candidate_left_time, candidate_left_pos = ordered[index - 1]
                candidate_right_time, candidate_right_pos = ordered[index]
                if epoch > candidate_right_time:
                    continue
                left_time, left_pos = candidate_left_time, candidate_left_pos
                right_time, right_pos = candidate_right_time, candidate_right_pos
                break
            if left_time is None or right_time is None or left_pos is None or right_pos is None:
                return None

        if left_time is None or right_time is None or left_pos is None or right_pos is None:
            return None

        span_seconds = (right_time - left_time).total_seconds()
        if span_seconds <= 1e-9:
            return None

        span_days = span_seconds / 86400.0
        return [(float(right_pos[axis]) - float(left_pos[axis])) / span_days for axis in range(3)]

    @classmethod
    def _resolve_orbit_velocity(
        cls,
        payload: Dict[str, Any],
        *,
        velocity_key: str,
        samples_key: str,
        times_key: str,
        epoch: datetime,
    ) -> Optional[List[float]]:
        velocity = cls._parse_velocity_vector(payload.get(velocity_key))
        if velocity:
            return velocity
        return cls._interpolate_orbit_velocity(
            payload,
            samples_key=samples_key,
            times_key=times_key,
            epoch=epoch,
        )

    @staticmethod
    def _build_non_satellite_data(
        *,
        target_type: str,
        target_name: str,
        az_deg: float,
        el_deg: float,
        command: Optional[str] = None,
        body_id: Optional[str] = None,
        transmitters: Optional[List[Dict[str, Any]]] = None,
    ) -> Dict[str, Any]:
        return {
            "details": {
                "name": target_name,
                "target_type": target_type,
                "command": command,
                "body_id": body_id,
                "norad_id": None,
                "is_geostationary": False,
            },
            "position": {
                "lat": 0.0,
                "lon": 0.0,
                "alt": 0.0,
                "az": float(az_deg),
                "el": float(el_deg),
            },
            "paths": {"past": [], "future": []},
            "coverage": [],
            "transmitters": list(transmitters or []),
            "error": False,
        }

    def _resolve_target_context(
        self,
        tracking_state: Dict[str, Any],
        location: Dict[str, Any],
    ) -> Optional[Dict[str, Any]]:
        target_type = self._normalize_target_type(tracking_state)

        try:
            observer_lat = float(location["lat"])
            observer_lon = float(location["lon"])
        except (TypeError, ValueError, KeyError):
            logger.warning("Invalid observer location in tracker loop")
            return None
        try:
            observer_alt_m = float(location.get("alt") or 0.0)
        except (TypeError, ValueError):
            observer_alt_m = 0.0

        now_epoch = datetime.now(timezone.utc)
        input_payload = dict(self.input_target_ephemeris or {})

        if target_type == "satellite":
            norad_id = tracking_state.get("norad_id")
            if not norad_id:
                logger.warning("No norad id found in satellite tracking state, skipping iteration")
                return None
            if not input_payload or input_payload.get("norad_id") != norad_id:
                logger.warning("No matching satellite ephemeris provided, skipping iteration")
                return None

            satellite_data = compiled_satellite_data_from_inputs(
                input_payload,
                self.input_location,
                self.input_transmitters,
                self.input_map_settings,
            )
            if satellite_data.get("error"):
                logger.warning(
                    "Could not compute satellite details for satellite %s",
                    norad_id,
                )
                return None

            try:
                propagation_input = get_propagation_input(
                    input_payload, central_body=CentralBody.EARTH
                )
            except OrbitServiceError as e:
                logger.warning("Invalid satellite ephemeris payload for tracker loop: %s", e)
                return None

            satellite_tles = [propagation_input.tle1, propagation_input.tle2]
            satellite_name = str(input_payload.get("name") or norad_id)
            skypoint = (
                float(satellite_data["position"]["az"]),
                float(satellite_data["position"]["el"]),
            )
            return {
                "target_type": "satellite",
                "target_name": satellite_name,
                "target_id": str(norad_id),
                "skypoint": skypoint,
                "satellite_data": satellite_data,
                "satellite_tles": satellite_tles,
            }

        target_identifier = str(
            tracking_state.get("command")
            or tracking_state.get("body_id")
            or tracking_state.get("target_name")
            or "unknown"
        ).strip()
        if not target_identifier:
            target_identifier = "unknown"

        earth_position = self._interpolate_earth_position(input_payload, now_epoch)
        if not earth_position:
            earth_position = self._parse_position_vector(input_payload.get("earth_position_xyz_au"))
        if not earth_position:
            if not input_payload:
                logger.warning(
                    "Missing %s ephemeris payload in tracker worker context "
                    "(tracker_id=%s target=%s). The manager may not have a valid cached "
                    "vector snapshot for this target yet.",
                    target_type,
                    self.tracker_id,
                    target_identifier,
                )
                return None

            payload_target_type = str(input_payload.get("target_type") or "unknown").strip()
            payload_identifier = str(
                input_payload.get("command")
                or input_payload.get("body_id")
                or input_payload.get("norad_id")
                or input_payload.get("name")
                or "unknown"
            ).strip()
            if not payload_identifier:
                payload_identifier = "unknown"
            logger.warning(
                "Missing earth ephemeris in tracker worker payload "
                "(tracker_id=%s target_type=%s target=%s payload_target_type=%s "
                "payload_target=%s earth_samples=%s payload_keys=%s)",
                self.tracker_id,
                target_type,
                target_identifier,
                payload_target_type or "unknown",
                payload_identifier,
                len(input_payload.get("earth_orbit_samples_xyz_au") or []),
                sorted(input_payload.keys()),
            )
            return None

        if target_type == "mission":
            command = str(
                tracking_state.get("command") or input_payload.get("command") or ""
            ).strip()
            if not command:
                logger.warning("Mission target is missing Horizons command")
                return None

            position_xyz_au = self._interpolate_mission_position(input_payload, now_epoch)
            if not position_xyz_au:
                position_xyz_au = self._parse_position_vector(input_payload.get("position_xyz_au"))
            if not position_xyz_au:
                logger.warning(
                    "Mission target '%s' has no position samples available in worker context",
                    command,
                )
                return None

            observer_view = compute_observer_sky_position(
                target_heliocentric_xyz_au=position_xyz_au,
                earth_heliocentric_xyz_au=earth_position,
                epoch=now_epoch,
                observer_lat_deg=observer_lat,
                observer_lon_deg=observer_lon,
            )
            sky_position = observer_view.get("sky_position") or {}
            az_deg = float(sky_position.get("az_deg", 0.0))
            el_deg = float(sky_position.get("el_deg", 0.0))
            target_name = (
                str(
                    tracking_state.get("target_name") or input_payload.get("name") or command
                ).strip()
                or command
            )
            target_velocity = self._resolve_orbit_velocity(
                input_payload,
                velocity_key="velocity_xyz_au_per_day",
                samples_key="orbit_samples_xyz_au",
                times_key="orbit_sample_times_utc",
                epoch=now_epoch,
            )
            earth_velocity = self._resolve_orbit_velocity(
                input_payload,
                velocity_key="earth_velocity_xyz_au_per_day",
                samples_key="earth_orbit_samples_xyz_au",
                times_key="earth_orbit_sample_times_utc",
                epoch=now_epoch,
            )
            range_rate_km_s = None
            if target_velocity and earth_velocity:
                range_rate_km_s = calculate_range_rate_from_heliocentric_vectors(
                    target_position_xyz_au=position_xyz_au,
                    target_velocity_xyz_au_per_day=target_velocity,
                    earth_position_xyz_au=earth_position,
                    earth_velocity_xyz_au_per_day=earth_velocity,
                    observer_lat_deg=observer_lat,
                    observer_lon_deg=observer_lon,
                    observer_elevation_m=observer_alt_m,
                    epoch=now_epoch,
                )
            return {
                "target_type": "mission",
                "target_name": target_name,
                "target_id": command,
                "skypoint": (az_deg, el_deg),
                "satellite_data": self._build_non_satellite_data(
                    target_type="mission",
                    target_name=target_name,
                    az_deg=az_deg,
                    el_deg=el_deg,
                    command=command,
                    transmitters=self.input_transmitters,
                ),
                "satellite_tles": None,
                "range_rate_km_s": range_rate_km_s,
            }

        body_id = (
            str(tracking_state.get("body_id") or input_payload.get("body_id") or "").strip().lower()
        )
        if not body_id:
            logger.warning("Body target is missing body_id")
            return None
        body_position = self._interpolate_mission_position(input_payload, now_epoch)
        if not body_position:
            body_position = self._parse_position_vector(input_payload.get("position_xyz_au"))
        if not body_position:
            logger.warning(
                "Body target '%s' has no position samples available in worker context", body_id
            )
            return None

        observer_view = compute_observer_sky_position(
            target_heliocentric_xyz_au=body_position,
            earth_heliocentric_xyz_au=earth_position,
            epoch=now_epoch,
            observer_lat_deg=observer_lat,
            observer_lon_deg=observer_lon,
        )
        sky_position = observer_view.get("sky_position") or {}
        az_deg = float(sky_position.get("az_deg", 0.0))
        el_deg = float(sky_position.get("el_deg", 0.0))
        target_name = (
            str(tracking_state.get("target_name") or input_payload.get("name") or body_id).strip()
            or body_id
        )
        target_velocity = self._resolve_orbit_velocity(
            input_payload,
            velocity_key="velocity_xyz_au_per_day",
            samples_key="orbit_samples_xyz_au",
            times_key="orbit_sample_times_utc",
            epoch=now_epoch,
        )
        earth_velocity = self._resolve_orbit_velocity(
            input_payload,
            velocity_key="earth_velocity_xyz_au_per_day",
            samples_key="earth_orbit_samples_xyz_au",
            times_key="earth_orbit_sample_times_utc",
            epoch=now_epoch,
        )
        range_rate_km_s = None
        if target_velocity and earth_velocity:
            range_rate_km_s = calculate_range_rate_from_heliocentric_vectors(
                target_position_xyz_au=body_position,
                target_velocity_xyz_au_per_day=target_velocity,
                earth_position_xyz_au=earth_position,
                earth_velocity_xyz_au_per_day=earth_velocity,
                observer_lat_deg=observer_lat,
                observer_lon_deg=observer_lon,
                observer_elevation_m=observer_alt_m,
                epoch=now_epoch,
            )
        return {
            "target_type": "body",
            "target_name": target_name,
            "target_id": body_id,
            "skypoint": (az_deg, el_deg),
            "satellite_data": self._build_non_satellite_data(
                target_type="body",
                target_name=target_name,
                az_deg=az_deg,
                el_deg=el_deg,
                body_id=body_id,
                transmitters=self.input_transmitters,
            ),
            "satellite_tles": None,
            "range_rate_km_s": range_rate_km_s,
        }

    async def run(self):
        """Main tracking loop."""
        # Validate interval
        assert (
            0 < args.track_interval_ms < 6000
        ), f"track_interval_ms must be between 1 and 5999, got {args.track_interval_ms}"

        interval_seconds = args.track_interval_ms / 1000.0

        tracker: Dict[str, Any] = {}

        logger.info(
            "Tracker process started (tracker_id=%s pid=%s, interval=%ss)",
            self.tracker_id,
            self.process.pid,
            interval_seconds,
        )
        while True:
            # Update CPU and memory usage periodically
            current_time = time.time()
            if current_time - self.last_cpu_check >= self.cpu_check_interval:
                try:
                    cpu_percent = self.process.cpu_percent()
                    mem_info = self.process.memory_info()
                    memory_mb = mem_info.rss / (1024 * 1024)
                    memory_percent = self.process.memory_percent()
                    self.stats["cpu_percent"] = cpu_percent
                    self.stats["memory_mb"] = memory_mb
                    self.stats["memory_percent"] = memory_percent
                    self.last_cpu_check = current_time
                except Exception:
                    pass

            # Send stats periodically via queue_out
            if current_time - self.last_stats_send >= self.stats_send_interval:
                self.queue_out.put(
                    {
                        "type": "stats",
                        "tracker_id": self.tracker_id,
                        "stats": self.stats.copy(),
                        "timestamp": current_time,
                    }
                )
                self.last_stats_send = current_time

            # Process commands first
            should_stop = await self.state_manager.process_commands()
            if should_stop:
                break

            # Initialize to None at the start of each iteration
            initial_tracking_state = None

            try:
                self.stats["tracking_cycles"] += 1
                self.stats["last_activity"] = time.time()
                self.start_loop_date = datetime.now(timezone.utc)
                self.events = []

                tracking_state = self.input_tracking_state
                if not tracking_state:
                    continue

                initial_tracking_state = dict(tracking_state)

                if not self.input_location:
                    logger.warning("No location provided to tracker, skipping iteration")
                    continue
                location = self.input_location

                target_context = self._resolve_target_context(tracking_state, location)
                if not target_context:
                    continue

                tracker = dict(tracking_state)
                target_type = target_context["target_type"]
                if target_type != "satellite":
                    # Keep mission/body target typing explicit in emitted payloads
                    # without mutating runtime tracking-state ownership.
                    tracker["target_type"] = target_type

                self.satellite_data = target_context["satellite_data"]
                satellite_tles = target_context.get("satellite_tles")
                satellite_name = target_context["target_name"]
                skypoint = target_context["skypoint"]

                # Update current state variables
                self.current_target_type = target_type
                self.current_norad_id = (
                    tracker.get("norad_id", None) if target_type == "satellite" else None
                )
                self.current_group_id = (
                    tracker.get("group_id", None) if target_type == "satellite" else None
                )
                self.current_rotator_id = tracker.get("rotator_id", "none")
                self.current_rig_id = tracker.get("rig_id", "none")
                self.current_transmitter_id = tracker.get("transmitter_id", "none")
                self.current_rig_vfo = tracker.get("rig_vfo", "none")
                self.current_vfo1 = tracker.get("vfo1", "uplink")
                self.current_vfo2 = tracker.get("vfo2", "downlink")
                self.current_rotator_state = tracker.get("rotator_state", "disconnected")
                self.current_rig_state = tracker.get("rig_state", "disconnected")

                # Check for state changes and handle them
                changes = self.state_manager.check_state_changes()
                await self.state_manager.process_state_changes(changes)

                # Validate hardware states
                await self.state_manager.validate_hardware_states()

                # Update hardware positions (allow tracking to continue if rotator fails)
                try:
                    await self.rotator_handler.update_hardware_position()
                except Exception as e:
                    logger.warning(f"Rotator communication failed, continuing tracking: {e}")

                # Update rig frequency (allow tracking to continue if rig fails)
                try:
                    await self.rig_handler.update_hardware_frequency()
                except Exception as e:
                    logger.warning(f"Rig communication failed, continuing tracking: {e}")

                # Check position limits
                self.rotator_handler.check_position_limits(skypoint, satellite_name)

                if target_type == "satellite" and satellite_tles:
                    # Handle transmitter tracking
                    await self.rig_handler.handle_transmitter_tracking(satellite_tles, location)

                    # Calculate doppler shift for all active transmitters
                    await self.rig_handler.calculate_all_transmitters_doppler(
                        satellite_tles, location
                    )
                    transmitters = self.rig_data.get("transmitters") or []
                    transmitter_count = len(transmitters) if isinstance(transmitters, list) else 0
                    logger.debug(
                        "Target #%s %s az=%.4f el=%.4f tx=%s dopplers=%s",
                        self.current_norad_id,
                        satellite_name,
                        skypoint[0],
                        skypoint[1],
                        self.current_transmitter_id,
                        transmitter_count,
                    )

                    # Control rig frequency
                    await self.rig_handler.control_rig_frequency()
                else:
                    await self.rig_handler.handle_non_satellite_transmitter_tracking(
                        range_rate_km_s=target_context.get("range_rate_km_s")
                    )
                    await self.rig_handler.control_rig_frequency()
                    logger.debug(
                        "Target %s:%s az=%.4f el=%.4f (non-satellite mode)",
                        target_type,
                        target_context["target_id"],
                        skypoint[0],
                        skypoint[1],
                    )

                # Control rotator position
                await self.rotator_handler.control_rotator_position(skypoint)

            except Exception as e:
                logger.error(f"Error in satellite tracking task: {e}")
                logger.exception(e)
                self.stats["errors"] += 1

            finally:
                # Check for race condition: re-read tracking state and compare
                final_tracking_state = self.input_tracking_state

                # Send updates via the queue
                # Check if we have satellite data and tracker data
                if self.satellite_data and tracker:
                    # Check if tracking state changed during iteration
                    if (
                        initial_tracking_state
                        and final_tracking_state
                        and initial_tracking_state != final_tracking_state
                    ):
                        pass
                    else:
                        try:
                            full_msg = {
                                DictKeys.EVENT: SocketEvents.SATELLITE_TRACKING,
                                DictKeys.DATA: {
                                    DictKeys.SATELLITE_DATA: self.satellite_data,
                                    DictKeys.EVENTS: self.events.copy(),
                                    DictKeys.ROTATOR_DATA: self.rotator_data.copy(),
                                    DictKeys.RIG_DATA: self.rig_data.copy(),
                                    DictKeys.TRACKING_STATE: tracker.copy(),
                                },
                            }
                            self.queue_out.put(full_msg)
                            self.stats["updates_sent"] += 1

                        except Exception as e:
                            logger.critical(f"Error sending satellite tracking data: {e}")
                            self.stats["errors"] += 1
                            logger.exception(e)

                # Calculate sleep time
                if self.start_loop_date:
                    loop_duration = round(
                        (datetime.now(timezone.utc) - self.start_loop_date).total_seconds(),
                        2,
                    )
                else:
                    loop_duration = 0

                if loop_duration > interval_seconds:
                    logger.warning(
                        f"Single tracking loop iteration took longer "
                        f"({loop_duration}) than the configured "
                        f"interval ({interval_seconds})"
                    )

                remaining_time_to_sleep = max((interval_seconds - loop_duration), 0)

                # Clean up data states
                self.state_manager.cleanup_data_states()

                # Check if stop_event is set before sleeping
                if self.stop_event and self.stop_event.is_set():
                    logger.info("Stop event detected, exiting tracking task")
                    break

                await asyncio.sleep(remaining_time_to_sleep)

    def apply_input_message(self, message: Dict[str, Any]) -> None:
        """Apply IPC message payloads sent from the manager."""
        msg_type = message.get("type")
        payload = message.get("payload", {})

        if msg_type == TRACKER_MSG_SET_TRACKING_STATE:
            self.input_tracking_state = dict(payload)
        elif msg_type == TRACKER_MSG_SET_LOCATION:
            self.input_location = dict(payload)
        elif msg_type == TRACKER_MSG_SET_TRANSMITTERS:
            self.input_transmitters = list(payload.get("items", []))
        elif msg_type == TRACKER_MSG_SET_SATELLITE_EPHEMERIS:
            self.input_target_ephemeris = dict(payload)
            self.input_satellite = dict(payload)
        elif msg_type == TRACKER_MSG_SET_MAP_SETTINGS:
            self.input_map_settings = dict(payload)
        elif msg_type == TRACKER_MSG_SET_HARDWARE:
            self.input_hardware.update(payload)
            if payload.get("rig"):
                self.rig_details = payload["rig"]
            if payload.get("sdr"):
                self.rig_details = payload["sdr"]
            if payload.get("rotator"):
                self.rotator_details = payload["rotator"]
        elif msg_type == TRACKER_MSG_COMMAND:
            # handled in StateManager.process_commands
            return


async def satellite_tracking_task(
    queue_out: multiprocessing.Queue,
    queue_in: multiprocessing.Queue,
    stop_event=None,
    tracker_id: str = "",
):
    """
    Wrapper function that creates and runs a SatelliteTracker instance.
    This maintains compatibility with existing multiprocessing code.

    Periodically tracks and transmits satellite position and details along with user location data
    using multiprocessing Queue instead of Socket.IO for inter-process communication.

    This function performs satellite tracking by retrieving tracking states, determining current
    satellite position, and calculating azimuth and elevation values based on user geographic
    location. Data retrieval is achieved through database queries for satellite and user
    information, and updates are transmitted via the queue_out Queue.

    :param queue_out: Queue to send tracking data to the main process
    :type queue_out: multiprocessing.Queue
    :param queue_in: Queue to receive commands from the main process
    :type queue_in: multiprocessing.Queue
    :param stop_event: Event to signal this function to stop execution
    :type stop_event: multiprocessing.Event
    :return: None
    """
    tracker = SatelliteTracker(queue_out, queue_in, stop_event, tracker_id=tracker_id)
    await tracker.run()
