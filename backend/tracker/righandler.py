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
Rig handler for satellite tracking.
Handles all rig-related operations including connection, frequency control, and doppler calculation.
"""

import logging

from common.constants import DictKeys, SocketEvents, TrackingEvents
from controllers.rig import RigController
from controllers.sdr import SDRController
from hardware.client import RigProxy
from hardware.rigcontrol import RigExecution
from tracking.doppler import calculate_doppler_shift_from_range_rate

logger = logging.getLogger("tracker-worker")


class RigHandler(RigExecution):
    """Handles all rig-related operations for satellite tracking."""

    def __init__(self, tracker):
        """
        Initialize the rig handler.

        :param tracker: Reference to the parent SatelliteTracker instance
        """
        self.tracker = tracker
        self.last_vfo_update_time = 0.0  # Track when VFO frequencies were last updated
        self.failed_tx_control_modes: set[str] = set()

    @staticmethod
    def _fmt_state_value(value):
        return "none" if value is None else value

    @staticmethod
    def _normalize_frequency(value) -> float:
        try:
            return float(value)
        except (TypeError, ValueError):
            return 0.0

    def apply_non_satellite_target_idle(self) -> None:
        """Reset rig telemetry when tracking a non-satellite target.

        Called when the active non-satellite target has no selected transmitter.
        """
        self.tracker.rig_data["transmitter_id"] = "none"
        self.tracker.rig_data["original_freq"] = 0
        self.tracker.rig_data["downlink_observed_freq"] = 0
        self.tracker.rig_data["doppler_shift"] = 0
        self.tracker.rig_data["uplink_freq"] = 0
        self.tracker.rig_data["uplink_observed_freq"] = 0
        self.tracker.rig_data["uplink_doppler_shift"] = 0
        self.tracker.rig_data["transmitters"] = []
        self.tracker.rig_data["tracking"] = False
        self.tracker.rig_data["tuning"] = False
        self.tracker.rig_data["stopped"] = True

    def clear_transmitter_doppler(self) -> None:
        """Clear corrections when the satellite's range rate is unavailable."""
        self.tracker.rig_data["transmitter_id"] = self.tracker.current_transmitter_id
        self.tracker.rig_data["original_freq"] = 0
        self.tracker.rig_data["downlink_observed_freq"] = 0
        self.tracker.rig_data["doppler_shift"] = 0
        self.tracker.rig_data["uplink_freq"] = 0
        self.tracker.rig_data["uplink_observed_freq"] = 0
        self.tracker.rig_data["uplink_doppler_shift"] = 0
        self.tracker.rig_data["transmitters"] = []
        self.tracker.rig_data["tracking"] = False
        self.tracker.rig_data["tuning"] = False
        self.tracker.rig_data["stopped"] = True

    async def update_transmitter_doppler(self, *, range_rate_km_s: float | None = None) -> None:
        """Build TLE, OMM, or celestial transmitter telemetry from range rate."""
        transmitters: list[dict] = []
        for transmitter in self.tracker.input_transmitters:
            downlink_freq = self._normalize_frequency(transmitter.get("downlink_low", 0))
            uplink_freq = self._normalize_frequency(transmitter.get("uplink_low", 0))
            if downlink_freq <= 0 and uplink_freq <= 0:
                continue

            if downlink_freq > 0:
                downlink_observed_freq, doppler_shift = calculate_doppler_shift_from_range_rate(
                    range_rate_km_s=range_rate_km_s,
                    transmitted_freq_hz=downlink_freq,
                )
            else:
                downlink_observed_freq, doppler_shift = 0, 0

            if uplink_freq > 0:
                uplink_observed_rx, uplink_doppler = calculate_doppler_shift_from_range_rate(
                    range_rate_km_s=range_rate_km_s,
                    transmitted_freq_hz=uplink_freq,
                )
                # Keep the same uplink correction convention used in satellite tracking.
                uplink_observed_freq = (2 * uplink_freq) - uplink_observed_rx
                uplink_doppler_shift = -uplink_doppler
            else:
                uplink_observed_freq, uplink_doppler_shift = 0, 0

            transmitters.append(
                {
                    "id": transmitter.get("id"),
                    "description": transmitter.get("description"),
                    "type": transmitter.get("type"),
                    "mode": transmitter.get("mode"),
                    "invert": transmitter.get("invert", False),
                    "source": transmitter.get("source"),
                    "alive": transmitter.get("alive"),
                    # Decoder suggestions consume these fields from the VFO's
                    # locked transmitter, not from the satellite details list.
                    "baud": transmitter.get("baud"),
                    "deviation": transmitter.get("deviation"),
                    "framing": transmitter.get("framing"),
                    "lora_config": transmitter.get("lora_config"),
                    "downlink_low": downlink_freq,
                    "downlink_high": transmitter.get("downlink_high"),
                    "uplink_low": uplink_freq,
                    "uplink_high": transmitter.get("uplink_high"),
                    "downlink_observed_freq": downlink_observed_freq,
                    "doppler_shift": doppler_shift,
                    "uplink_observed_freq": uplink_observed_freq,
                    "uplink_doppler_shift": uplink_doppler_shift,
                }
            )

        self.tracker.rig_data["transmitters"] = transmitters
        self.tracker.rig_data["transmitter_id"] = self.tracker.current_transmitter_id

        current_transmitter = next(
            (
                item
                for item in transmitters
                if item.get("id") == self.tracker.current_transmitter_id
            ),
            None,
        )
        if not current_transmitter:
            self.tracker.rig_data["original_freq"] = 0
            self.tracker.rig_data["downlink_observed_freq"] = 0
            self.tracker.rig_data["doppler_shift"] = 0
            self.tracker.rig_data["uplink_freq"] = 0
            self.tracker.rig_data["uplink_observed_freq"] = 0
            self.tracker.rig_data["uplink_doppler_shift"] = 0
            self.tracker.rig_data["tracking"] = False
            self.tracker.rig_data["tuning"] = False
            self.tracker.rig_data["stopped"] = True
            return

        self.tracker.rig_data["original_freq"] = current_transmitter.get("downlink_low", 0)
        self.tracker.rig_data["downlink_observed_freq"] = current_transmitter.get(
            "downlink_observed_freq", 0
        )
        self.tracker.rig_data["doppler_shift"] = current_transmitter.get("doppler_shift", 0)
        self.tracker.rig_data["uplink_freq"] = current_transmitter.get("uplink_low", 0)
        self.tracker.rig_data["uplink_observed_freq"] = current_transmitter.get(
            "uplink_observed_freq", 0
        )
        self.tracker.rig_data["uplink_doppler_shift"] = current_transmitter.get(
            "uplink_doppler_shift", 0
        )

        if self.tracker.current_rig_state == "tracking":
            self.tracker.rig_data["tracking"] = True
            self.tracker.rig_data["stopped"] = False
            return

        self.tracker.rig_data["tracking"] = False
        self.tracker.rig_data["stopped"] = True

    async def connect_to_rig(self):
        """Connect to rig hardware (radio or SDR)."""
        if self.tracker.current_rig_id is not None and (
            self.tracker.rig_controller is None or isinstance(self.tracker.rig_controller, RigProxy)
        ):
            try:
                rig_details = self.tracker.rig_details
                rig_type = (self.tracker.input_hardware or {}).get("rig_type", "radio")

                if not rig_details:
                    raise Exception(
                        f"No rig details provided for ID: {self.tracker.current_rig_id}"
                    )

                # Create appropriate controller
                if rig_type == "sdr":
                    self.tracker.rig_controller = SDRController(sdr_details=rig_details)
                else:
                    client = getattr(self.tracker, "hardware_client", None)
                    self.tracker.rig_controller = (
                        RigProxy(client, self.tracker.current_rig_id, rig_details)
                        if client
                        else RigController(host=rig_details["host"], port=rig_details["port"])
                    )

                self.tracker.rig_details.update(
                    {
                        "host": self.tracker.rig_details["host"],
                        "port": self.tracker.rig_details.get("port"),
                    },
                )

                await self.tracker.rig_controller.connect()
                self.failed_tx_control_modes.clear()

                # Update state
                self.tracker.rig_data.update(
                    {
                        "connected": True,
                        "tracking": False,
                        "tuning": False,
                        "device_type": rig_details.get("type", "hardware"),
                        "host": self.tracker.rig_details.get("host", ""),
                        "port": self.tracker.rig_details.get("port", ""),
                        "radio_mode": rig_details.get("radio_mode", "duplex"),
                        "tx_control_mode": rig_details.get("tx_control_mode", "auto"),
                        "active_tx_control_mode": "vfo_switch",
                        "retune_interval_ms": int(rig_details.get("retune_interval_ms", 2000)),
                    }
                )

                self.tracker.queue_out.put(
                    {
                        DictKeys.EVENT: SocketEvents.SATELLITE_TRACKING,
                        DictKeys.DATA: {
                            DictKeys.EVENTS: [{DictKeys.NAME: TrackingEvents.RIG_CONNECTED}],
                            DictKeys.RIG_DATA: self.tracker.rig_data.copy(),
                        },
                    }
                )

            except Exception as e:
                logger.error(f"Failed to connect to rig: {e}")
                logger.exception(e)
                await self.handle_rig_error(e)

    async def handle_rig_error(self, error):
        """Handle rig connection errors."""
        self.tracker.rig_data.update(
            {
                "connected": False,
                "tracking": False,
                "tuning": False,
                "error": True,
                "error_message": str(error),
                "host": self.tracker.rig_data.get("host", ""),
                "port": self.tracker.rig_data.get("port", ""),
            }
        )

        updated_tracking_state = dict(self.tracker.input_tracking_state or {})
        updated_tracking_state["rig_state"] = "disconnected"
        self.tracker.input_tracking_state = updated_tracking_state

        self.tracker.queue_out.put(
            {
                DictKeys.EVENT: SocketEvents.SATELLITE_TRACKING,
                DictKeys.DATA: {
                    DictKeys.EVENTS: [
                        {DictKeys.NAME: TrackingEvents.RIG_ERROR, "error": str(error)}
                    ],
                    DictKeys.RIG_DATA: self.tracker.rig_data.copy(),
                    DictKeys.TRACKING_STATE: updated_tracking_state,
                },
            }
        )

        self.tracker.rig_controller = None

    async def handle_rig_state_change(self, old, new):
        """Handle rig state changes."""
        logger.info(
            "Rig state change detected from '%s' to '%s'",
            self._fmt_state_value(old),
            self._fmt_state_value(new),
        )

        if new == "connected":
            await self.connect_to_rig()
            if self.tracker.rig_controller is not None:
                self.tracker.rig_data["connected"] = True

        elif new == "disconnected":
            await self.disconnect_rig()
            self.tracker.rig_data["connected"] = False
            self.tracker.rig_data["tracking"] = False
            self.tracker.rig_data["stopped"] = True

        elif new == "tracking":
            await self.connect_to_rig()
            if self.tracker.rig_controller is None:
                return
            self.tracker.rig_data["tracking"] = True
            self.tracker.rig_data["stopped"] = False

        elif new == "stopped":
            if isinstance(self.tracker.rig_controller, RigProxy):
                await self.tracker.rig_controller.call("mode", mode="stopped")
            self.tracker.rig_data["tracking"] = False
            self.tracker.rig_data["tuning"] = False
            self.tracker.rig_data["stopped"] = True

    async def disconnect_rig(self):
        """Disconnect from rig."""
        if self.tracker.rig_controller is not None:
            logger.info("Disconnecting from rig...")
            try:
                await self.tracker.rig_controller.disconnect()
                self.tracker.rig_data.update(
                    {"connected": False, "tracking": False, "tuning": False}
                )
                self.tracker.queue_out.put(
                    {
                        DictKeys.EVENT: SocketEvents.SATELLITE_TRACKING,
                        DictKeys.DATA: {
                            DictKeys.EVENTS: [{DictKeys.NAME: TrackingEvents.RIG_DISCONNECTED}],
                            DictKeys.RIG_DATA: self.tracker.rig_data.copy(),
                        },
                    }
                )
            except Exception as e:
                logger.error(f"Error disconnecting from rig: {e}")
                await self.handle_rig_error(e)
            finally:
                self.tracker.rig_controller = None

    async def control_rig_frequency(self):
        """Submit one complete tuning transaction to the device worker."""
        if isinstance(self.tracker.rig_controller, RigProxy):
            if self.tracker.current_rig_state == "tracking":
                data = await self.tracker.rig_controller.tune(
                    self.tracker.input_tracking_state,
                    self.tracker.rig_data,
                )
                self.tracker.rig_data.update(data)
            return
        await super().control_rig_frequency()

    async def update_hardware_frequency(self):
        """Update current rig frequency (no VFO reading to avoid switching)."""
        if self.tracker.rig_controller:
            # Get main frequency (current VFO)
            self.tracker.rig_data["frequency"] = await self.tracker.rig_controller.get_frequency()

            # Don't read VFO data from rig to avoid VFO switching
            # VFO data is populated by control_rig_frequency() when setting frequencies
