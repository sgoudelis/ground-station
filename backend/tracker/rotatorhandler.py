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
Rotator handler for satellite tracking.
Handles all rotator-related operations including connection, positioning, and limit checking.
"""

import logging
import math
import time

from common.constants import DictKeys, SocketEvents, TrackingEvents
from controllers.rotator import RotatorController

logger = logging.getLogger("tracker-worker")


class RotatorHandler:
    """Handles all rotator-related operations for satellite tracking."""

    def __init__(self, tracker):
        """
        Initialize the rotator handler.

        :param tracker: Reference to the parent SatelliteTracker instance
        """
        self.tracker = tracker

    @staticmethod
    def _fmt_state_value(value):
        return "none" if value is None else value

    def _reset_slew_state(self):
        """Reset in-flight rotator command tracking."""
        self.tracker.rotator_command_state.update(
            {
                "in_flight": False,
                "target_az": None,
                "target_el": None,
                "last_command_ts": 0.0,
                "settle_hits": 0,
            }
        )
        self.tracker.rotator_data["slewing"] = False

    def _target_within_tolerance(self, current_az, current_el, target_az, target_el) -> bool:
        az_tol = float(self.tracker.az_tolerance)
        el_tol = float(self.tracker.el_tolerance)
        mode = self._get_azimuth_mode()
        if mode == "0_450":
            # Overlap mode tracks absolute mechanical azimuth, so wraparound math is invalid.
            az_err = abs(float(current_az) - float(target_az))
        else:
            az_err = self._angular_distance_deg(float(current_az), float(target_az))
        return bool(az_err <= az_tol and abs(current_el - target_el) <= el_tol)

    @staticmethod
    def _angular_distance_deg(a: float, b: float) -> float:
        """Smallest angular distance between two azimuth values in degrees."""
        return abs(((a - b + 180.0) % 360.0) - 180.0)

    def _get_azimuth_mode(self) -> str:
        mode = str(self.tracker.rotator_details.get("azimuth_mode", "0_360"))
        return mode if mode in {"0_360", "-180_180", "0_450"} else "0_360"

    @staticmethod
    def _is_finite_number(value) -> bool:
        return isinstance(value, (int, float)) and math.isfinite(float(value))

    def _normalize_azimuth_for_mode(self, azimuth: float, mode: str) -> float:
        # Sky geometry always resolves to a compass bearing; overlap mode still starts from 0..360.
        if mode == "-180_180":
            normalized = azimuth % 360
            return normalized if normalized <= 180 else normalized - 360
        return azimuth % 360

    def _get_overlap_candidates_for_bearing(self, bearing_az: float) -> list[float]:
        """Map a 0..360 bearing into all equivalent absolute azimuths inside rotator limits."""
        minaz = float(self.tracker.azimuth_limits[0])
        maxaz = float(self.tracker.azimuth_limits[1])
        base = float(bearing_az) % 360.0

        candidates: list[float] = []
        start_turn = int(math.floor((minaz - base) / 360.0)) - 1
        end_turn = int(math.ceil((maxaz - base) / 360.0)) + 1

        for turn in range(start_turn, end_turn + 1):
            candidate = base + (360.0 * turn)
            if minaz <= candidate <= maxaz:
                candidates.append(candidate)

        deduped = sorted({round(candidate, 6) for candidate in candidates})
        return [float(candidate) for candidate in deduped]

    def _resolve_overlap_target_azimuth(
        self, bearing_az: float, current_az: float, active_target_az
    ) -> float | None:
        candidates = self._get_overlap_candidates_for_bearing(bearing_az)
        if not candidates:
            return None

        minaz = float(self.tracker.azimuth_limits[0])
        maxaz = float(self.tracker.azimuth_limits[1])

        reference = None
        if self._is_finite_number(active_target_az) and minaz <= float(active_target_az) <= maxaz:
            reference = float(active_target_az)
        elif self._is_finite_number(current_az) and minaz <= float(current_az) <= maxaz:
            reference = float(current_az)

        if reference is None:
            return float(candidates[0])

        return float(min(candidates, key=lambda candidate: (abs(candidate - reference), candidate)))

    def _unwrap_overlap_azimuth(self, raw_az: float) -> float:
        """
        Recover absolute turn information for overlap rotators when hardware reports wrapped bearings.

        Example: with limits [0, 450], a reported 10° can mean either 10° or 370°.
        """
        minaz = float(self.tracker.azimuth_limits[0])
        maxaz = float(self.tracker.azimuth_limits[1])
        raw_value = float(raw_az)

        if minaz <= raw_value <= maxaz and (raw_value < 0.0 or raw_value > 360.0):
            # Values outside the normal compass-bearing range carry absolute turn
            # information. Preserve them instead of treating them as wrapped aliases.
            return raw_value

        candidates: list[float] = []
        for turn in range(-2, 3):
            candidate = raw_value + (360.0 * turn)
            if minaz <= candidate <= maxaz:
                candidates.append(candidate)

        if not candidates:
            return float(max(minaz, min(raw_value, maxaz)))

        state = self.tracker.rotator_command_state
        reference = None
        if state.get("in_flight") and self._is_finite_number(state.get("target_az")):
            reference = float(state["target_az"])
        elif self._is_finite_number(self.tracker.rotator_data.get("az")):
            reference = float(self.tracker.rotator_data["az"])

        if reference is None:
            return float(min(candidates, key=lambda candidate: abs(candidate - raw_value)))

        return float(
            min(
                candidates,
                key=lambda candidate: (abs(candidate - reference), abs(candidate - raw_value)),
            )
        )

    def _is_bearing_reachable(self, bearing_az: float, mode: str) -> bool:
        if mode == "0_450":
            return bool(self._get_overlap_candidates_for_bearing(bearing_az))
        return bool(self.tracker.azimuth_limits[0] <= bearing_az <= self.tracker.azimuth_limits[1])

    def _azimuth_delta_for_mode(self, first: float, second: float, mode: str) -> float:
        if mode == "0_450":
            return abs(float(first) - float(second))
        return self._angular_distance_deg(float(first), float(second))

    def _to_command_azimuth(self, azimuth_0_360: float) -> float:
        mode = self._get_azimuth_mode()
        if mode == "0_450":
            return float(azimuth_0_360)
        return self._normalize_azimuth_for_mode(float(azimuth_0_360), mode)

    async def _issue_rotator_command(self, target_az, target_el):
        """Send a single rotator command and update in-flight state."""
        position_gen = self.tracker.rotator_controller.set_position(target_az, target_el)
        self.tracker.rotator_data["stopped"] = False

        try:
            az, el, is_slewing = await anext(position_gen)
            self.tracker.rotator_data["slewing"] = is_slewing
            self.tracker.rotator_command_state.update(
                {
                    "in_flight": is_slewing,
                    "target_az": target_az,
                    "target_el": target_el,
                    "last_command_ts": time.time(),
                    "settle_hits": 0,
                }
            )
            logger.debug(f"Current position: AZ={az}°, EL={el}°, slewing={is_slewing}")
        except StopAsyncIteration:
            logger.info(f"Slewing to AZ={target_az}° EL={target_el}° complete")
            self._reset_slew_state()
        except Exception as error:
            # Explicit no-fallback behavior for overlap mode:
            # when a controller rejects extended azimuth commands, freeze tracking and emit an error.
            if self._get_azimuth_mode() == "0_450":
                self._reset_slew_state()
                self.tracker.rotator_data.update(
                    {
                        "error": True,
                        "stopped": True,
                        "outofbounds": True,
                    }
                )
                self.tracker.queue_out.put(
                    {
                        DictKeys.EVENT: SocketEvents.SATELLITE_TRACKING,
                        DictKeys.DATA: {
                            DictKeys.EVENTS: [
                                {DictKeys.NAME: TrackingEvents.ROTATOR_ERROR, "error": str(error)}
                            ],
                            DictKeys.ROTATOR_DATA: self.tracker.rotator_data.copy(),
                        },
                    }
                )
                logger.error("Rotator command failed in 0_450 mode: %s", error)
                return
            raise

    def update_rotator_limits(self):
        """Update rotator limits from rotator_details if available."""
        if self.tracker.rotator_details:
            minaz = self.tracker.rotator_details.get("minaz")
            maxaz = self.tracker.rotator_details.get("maxaz")
            minel = self.tracker.rotator_details.get("minel")
            maxel = self.tracker.rotator_details.get("maxel")
            parkaz = self.tracker.rotator_details.get("parkaz")
            parkel = self.tracker.rotator_details.get("parkel")
            az_tolerance = self.tracker.rotator_details.get("aztolerance")
            el_tolerance = self.tracker.rotator_details.get("eltolerance")

            if minaz is not None and maxaz is not None:
                self.tracker.azimuth_limits = (minaz, maxaz)
                self.tracker.rotator_data["minaz"] = minaz
                self.tracker.rotator_data["maxaz"] = maxaz
                logger.debug(f"Updated azimuth limits to: {self.tracker.azimuth_limits}")

            if minel is not None and maxel is not None:
                self.tracker.elevation_limits = (minel, maxel)
                self.tracker.rotator_data["minel"] = minel
                self.tracker.rotator_data["maxel"] = maxel
                logger.debug(f"Updated elevation limits to: {self.tracker.elevation_limits}")

            self.tracker.rotator_data["parkaz"] = parkaz
            self.tracker.rotator_data["parkel"] = parkel

            if az_tolerance is not None:
                self.tracker.az_tolerance = float(az_tolerance)
                logger.debug(f"Updated azimuth tolerance to: {self.tracker.az_tolerance}")

            if el_tolerance is not None:
                self.tracker.el_tolerance = float(el_tolerance)
                logger.debug(f"Updated elevation tolerance to: {self.tracker.el_tolerance}")

    async def connect_to_rotator(self):
        """Connect to the rotator hardware."""
        has_rotator_id = (
            self.tracker.current_rotator_id is not None
            and str(self.tracker.current_rotator_id).strip().lower() != "none"
        )
        if has_rotator_id and self.tracker.rotator_controller is None:
            try:
                rotator_details = self.tracker.rotator_details
                if not rotator_details:
                    raise Exception(
                        f"No rotator details provided for ID: {self.tracker.current_rotator_id}"
                    )

                self.tracker.rotator_data.update(
                    {
                        "host": self.tracker.rotator_details["host"],
                        "port": self.tracker.rotator_details["port"],
                    }
                )

                self.tracker.rotator_controller = RotatorController(
                    host=rotator_details["host"], port=rotator_details["port"]
                )

                await self.tracker.rotator_controller.connect()

                # Update rotator limits from rotator_details
                self.update_rotator_limits()

                # Update state
                self.tracker.rotator_data.update(
                    {
                        "connected": True,
                        "tracking": False,
                        "slewing": False,
                        "outofbounds": False,
                        "stopped": True,
                        "error": False,
                    }
                )

                self.tracker.queue_out.put(
                    {
                        DictKeys.EVENT: SocketEvents.SATELLITE_TRACKING,
                        DictKeys.DATA: {
                            DictKeys.EVENTS: [{DictKeys.NAME: TrackingEvents.ROTATOR_CONNECTED}],
                            DictKeys.ROTATOR_DATA: self.tracker.rotator_data.copy(),
                        },
                    }
                )

            except Exception as e:
                logger.error(f"Failed to connect to rotator: {e}")
                logger.exception(e)
                await self.handle_rotator_error(e)

    async def handle_rotator_error(self, error):
        """Handle rotator connection errors."""
        self.tracker.rotator_data.update(
            {
                "connected": False,
                "tracking": False,
                "slewing": False,
                "stopped": False,
                "error": True,
                "host": self.tracker.rotator_data.get("host", ""),
                "port": self.tracker.rotator_data.get("port", ""),
            }
        )

        updated_tracking_state = dict(self.tracker.input_tracking_state or {})
        updated_tracking_state["rotator_state"] = "disconnected"
        self.tracker.input_tracking_state = updated_tracking_state

        self.tracker.queue_out.put(
            {
                DictKeys.EVENT: SocketEvents.SATELLITE_TRACKING,
                DictKeys.DATA: {
                    DictKeys.EVENTS: [
                        {DictKeys.NAME: TrackingEvents.ROTATOR_ERROR, "error": str(error)}
                    ],
                    DictKeys.ROTATOR_DATA: self.tracker.rotator_data.copy(),
                    DictKeys.TRACKING_STATE: updated_tracking_state,
                },
            }
        )

        self.tracker.rotator_controller = None

    async def handle_rotator_state_change(self, old, new):
        """Handle rotator state changes."""
        logger.info(
            "Rotator state change detected from '%s' to '%s'",
            self._fmt_state_value(old),
            self._fmt_state_value(new),
        )

        self.tracker.rotator_data["minelevation"] = False
        self.tracker.rotator_data["maxelevation"] = False
        self.tracker.rotator_data["minazimuth"] = False
        self.tracker.rotator_data["maxazimuth"] = False

        if new == "connected":
            self._reset_slew_state()
            await self.connect_to_rotator()
            if self.tracker.rotator_controller is not None and self.tracker.rotator_data.get(
                "connected"
            ):
                self.tracker.rotator_data["connected"] = True
                self.tracker.rotator_data["stopped"] = True
                self.tracker.rotator_data["parked"] = False
        elif new == "tracking":
            self._reset_slew_state()
            await self.connect_to_rotator()
            if self.tracker.rotator_controller is not None and self.tracker.rotator_data.get(
                "connected"
            ):
                self.tracker.rotator_data["tracking"] = True
                self.tracker.rotator_data["stopped"] = False
                self.tracker.rotator_data["parked"] = False
        elif new == "stopped":
            self._reset_slew_state()
            self.tracker.rotator_data["tracking"] = False
            self.tracker.rotator_data["slewing"] = False
            self.tracker.rotator_data["stopped"] = True
            self.tracker.rotator_data["parked"] = False
        elif new == "disconnected":
            self._reset_slew_state()
            await self.disconnect_rotator()
            self.tracker.rotator_data["tracking"] = False
            self.tracker.rotator_data["stopped"] = True
            self.tracker.rotator_data["parked"] = False
        elif new == "parked":
            self._reset_slew_state()
            await self.park_rotator()
        else:
            logger.error(f"Unknown tracking state: {new}")

    async def disconnect_rotator(self):
        """Disconnect from rotator."""
        self._reset_slew_state()
        if self.tracker.rotator_controller is not None:
            logger.info(
                f"Disconnecting from rotator at "
                f"{self.tracker.rotator_controller.host}:{self.tracker.rotator_controller.port}..."
            )
            try:
                await self.tracker.rotator_controller.disconnect()
                self.tracker.rotator_data["connected"] = False
                self.tracker.queue_out.put(
                    {
                        DictKeys.EVENT: SocketEvents.SATELLITE_TRACKING,
                        DictKeys.DATA: {
                            DictKeys.EVENTS: [{DictKeys.NAME: TrackingEvents.ROTATOR_DISCONNECTED}],
                            DictKeys.ROTATOR_DATA: self.tracker.rotator_data.copy(),
                        },
                    }
                )
            except Exception as e:
                logger.error(f"Error disconnecting from rotator: {e}")
                logger.exception(e)
            finally:
                self.tracker.rotator_controller = None

    async def park_rotator(self):
        """Park the rotator."""
        self._reset_slew_state()
        self.tracker.rotator_data.update({"tracking": False, "slewing": False})

        try:
            if self.tracker.rotator_controller is None:
                await self.connect_to_rotator()
            if self.tracker.rotator_controller is None:
                raise Exception("Rotator is not connected")

            park_az = self.tracker.rotator_details.get("parkaz")
            park_el = self.tracker.rotator_details.get("parkel")
            if park_az is None and park_el is None:
                park_reply = await self.tracker.rotator_controller.park()
            elif park_az is not None and park_el is not None:
                park_reply = await self.tracker.rotator_controller.park(
                    park_az=float(park_az),
                    park_el=float(park_el),
                )
            else:
                raise Exception("parkaz and parkel must either both be set or both be null")

            if park_reply:
                self.tracker.rotator_data["parked"] = True
                self.tracker.rotator_data["stopped"] = True
                self.tracker.queue_out.put(
                    {
                        DictKeys.EVENT: SocketEvents.SATELLITE_TRACKING,
                        DictKeys.DATA: {
                            DictKeys.EVENTS: [{DictKeys.NAME: TrackingEvents.ROTATOR_PARKED}],
                            DictKeys.ROTATOR_DATA: self.tracker.rotator_data.copy(),
                        },
                    }
                )
            else:
                raise Exception("Failed to park rotator")
        except Exception as e:
            logger.error(f"Failed to park rotator: {e}")
            logger.exception(e)

    def check_position_limits(self, skypoint, satellite_name):
        """Check if satellite position is within limits."""
        events = []
        out_of_bounds = False
        mode = self._get_azimuth_mode()
        sky_az = self._normalize_azimuth_for_mode(skypoint[0], mode)
        az_in_range = self._is_bearing_reachable(sky_az, mode)
        az_below = sky_az < self.tracker.azimuth_limits[0]
        az_above = sky_az > self.tracker.azimuth_limits[1]

        # Check azimuth limits
        if not az_in_range and az_below:
            logger.debug(
                f"Azimuth below minimum for satellite #{self.tracker.current_norad_id} {satellite_name}"
            )
            if self.tracker.in_tracking_state() and not self.tracker.notified.get(
                TrackingEvents.MIN_AZIMUTH_OUT_OF_BOUNDS, False
            ):
                events.append({DictKeys.NAME: TrackingEvents.MIN_AZIMUTH_OUT_OF_BOUNDS})
            self.tracker.notified[TrackingEvents.MIN_AZIMUTH_OUT_OF_BOUNDS] = True
            self.tracker.rotator_data["minazimuth"] = True
            self.tracker.rotator_data["maxazimuth"] = False
            out_of_bounds = True
        elif not az_in_range and az_above:
            logger.debug(
                f"Azimuth above maximum for satellite #{self.tracker.current_norad_id} {satellite_name}"
            )
            if self.tracker.in_tracking_state() and not self.tracker.notified.get(
                TrackingEvents.MAX_AZIMUTH_OUT_OF_BOUNDS, False
            ):
                events.append({DictKeys.NAME: TrackingEvents.MAX_AZIMUTH_OUT_OF_BOUNDS})
            self.tracker.notified[TrackingEvents.MAX_AZIMUTH_OUT_OF_BOUNDS] = True
            self.tracker.rotator_data["minazimuth"] = False
            self.tracker.rotator_data["maxazimuth"] = True
            out_of_bounds = True
        else:
            # Azimuth is within bounds
            self.tracker.rotator_data["minazimuth"] = False
            self.tracker.rotator_data["maxazimuth"] = False

        # Check elevation limits
        if skypoint[1] < self.tracker.elevation_limits[0]:
            logger.debug(
                f"Elevation below minimum for satellite "
                f"#{self.tracker.current_norad_id} {satellite_name}"
            )
            if self.tracker.in_tracking_state() and not self.tracker.notified.get(
                TrackingEvents.MIN_ELEVATION_OUT_OF_BOUNDS, False
            ):
                events.append({DictKeys.NAME: TrackingEvents.MIN_ELEVATION_OUT_OF_BOUNDS})
            self.tracker.notified[TrackingEvents.MIN_ELEVATION_OUT_OF_BOUNDS] = True
            self.tracker.rotator_data["minelevation"] = True
            self.tracker.rotator_data["maxelevation"] = False
            out_of_bounds = True
        elif skypoint[1] > self.tracker.elevation_limits[1]:
            logger.debug(
                f"Elevation above maximum for satellite "
                f"#{self.tracker.current_norad_id} {satellite_name}"
            )
            if self.tracker.in_tracking_state() and not self.tracker.notified.get(
                TrackingEvents.MAX_ELEVATION_OUT_OF_BOUNDS, False
            ):
                events.append({DictKeys.NAME: TrackingEvents.MAX_ELEVATION_OUT_OF_BOUNDS})
            self.tracker.notified[TrackingEvents.MAX_ELEVATION_OUT_OF_BOUNDS] = True
            self.tracker.rotator_data["minelevation"] = False
            self.tracker.rotator_data["maxelevation"] = True
            out_of_bounds = True
        else:
            # Elevation is within bounds
            self.tracker.rotator_data["minelevation"] = False
            self.tracker.rotator_data["maxelevation"] = False

        # Update outofbounds and stopped flags
        if out_of_bounds:
            self.tracker.rotator_data["outofbounds"] = True
            self.tracker.rotator_data["stopped"] = True
        else:
            self.tracker.rotator_data["outofbounds"] = False

        # Send events if any
        if events:
            self.tracker.queue_out.put(
                {
                    DictKeys.EVENT: SocketEvents.SATELLITE_TRACKING,
                    DictKeys.DATA: {
                        DictKeys.EVENTS: events,
                        DictKeys.DATA: {
                            "satellite_data": self.tracker.satellite_data,
                        },
                    },
                }
            )

    async def control_rotator_position(self, skypoint):
        """Control rotator position for tracking or nudging."""
        if (
            self.tracker.rotator_controller
            and self.tracker.current_rotator_state == "tracking"
            and not self.tracker.rotator_data["outofbounds"]
            and not self.tracker.rotator_data["minelevation"]
            and not self.tracker.rotator_data["error"]
        ):
            mode = self._get_azimuth_mode()
            sky_az = self._normalize_azimuth_for_mode(skypoint[0], mode)
            current_az = self.tracker.rotator_data["az"]
            current_el = self.tracker.rotator_data["el"]
            state = self.tracker.rotator_command_state

            target_az: float
            if mode == "0_450":
                resolved_target_az = self._resolve_overlap_target_azimuth(
                    bearing_az=sky_az,
                    current_az=current_az,
                    active_target_az=state.get("target_az"),
                )
                if resolved_target_az is None:
                    self.tracker.rotator_data["outofbounds"] = True
                    self.tracker.rotator_data["stopped"] = True
                    self.tracker.rotator_data["slewing"] = False
                    return
                target_az = resolved_target_az
            else:
                # Clamp target position to rotator limits
                target_az = max(
                    self.tracker.azimuth_limits[0],
                    min(sky_az, self.tracker.azimuth_limits[1]),
                )
            target_el = max(
                self.tracker.elevation_limits[0],
                min(skypoint[1], self.tracker.elevation_limits[1]),
            )
            command_target_az = self._to_command_azimuth(target_az)

            # No command currently in flight: send only if needed.
            if not state["in_flight"]:
                needs_move = not self._target_within_tolerance(
                    current_az, current_el, command_target_az, target_el
                )
                if needs_move:
                    await self._issue_rotator_command(command_target_az, target_el)
                else:
                    self.tracker.rotator_data["slewing"] = False

            # Command in flight: avoid duplicate command spam while slewing.
            else:
                active_target_az = state["target_az"]
                active_target_el = state["target_el"]
                if active_target_az is None or active_target_el is None:
                    self._reset_slew_state()
                    return

                reached_active_target = self._target_within_tolerance(
                    current_az, current_el, active_target_az, active_target_el
                )
                if reached_active_target:
                    # Reflect actual position status immediately for UI/telemetry.
                    self.tracker.rotator_data["slewing"] = False
                    state["settle_hits"] += 1
                    if state["settle_hits"] >= self.tracker.rotator_settle_hits_required:
                        self._reset_slew_state()
                        # Command is complete; avoid running refresh/retarget checks below
                        # with the reset timestamp (which would otherwise force a re-command).
                        return
                else:
                    state["settle_hits"] = 0
                    self.tracker.rotator_data["slewing"] = True

                # Retarget if the sky target moved far enough, or refresh on watchdog timeout.
                target_drift = max(
                    self._azimuth_delta_for_mode(command_target_az, active_target_az, mode),
                    abs(target_el - active_target_el),
                )
                command_age = time.time() - float(state["last_command_ts"] or 0.0)
                should_retarget = target_drift >= self.tracker.rotator_retarget_threshold_deg
                should_refresh = command_age >= self.tracker.rotator_command_refresh_sec

                if should_retarget or should_refresh:
                    await self._issue_rotator_command(command_target_az, target_el)

        elif self.tracker.rotator_controller and self.tracker.current_rotator_state != "tracking":
            self._reset_slew_state()
            # Handle nudge commands when not tracking
            if self.tracker.nudge_offset["az"] != 0 or self.tracker.nudge_offset["el"] != 0:
                new_az = self.tracker.rotator_data["az"] + self.tracker.nudge_offset["az"]
                new_el = self.tracker.rotator_data["el"] + self.tracker.nudge_offset["el"]

                # Clamp nudge position to rotator limits
                new_az = max(
                    self.tracker.azimuth_limits[0],
                    min(new_az, self.tracker.azimuth_limits[1]),
                )
                new_el = max(
                    self.tracker.elevation_limits[0],
                    min(new_el, self.tracker.elevation_limits[1]),
                )

                await self._issue_rotator_command(self._to_command_azimuth(new_az), new_el)
        else:
            # No rotator available or movement blocked by limits.
            self._reset_slew_state()

    async def update_hardware_position(self):
        """Update current rotator position."""
        if self.tracker.rotator_controller:
            az, el = await self.tracker.rotator_controller.get_position()
            if self._get_azimuth_mode() == "0_450":
                az = self._unwrap_overlap_azimuth(float(az))
            self.tracker.rotator_data["az"] = az
            self.tracker.rotator_data["el"] = el
