# Copyright (c) 2026 Efstratios Goudelis
# SPDX-License-Identifier: GPL-3.0-or-later
"""Physical rig tuning transactions, independent of target producers."""

import logging
import time

from controllers.rig import RigController
from controllers.sdr import SDRController

logger = logging.getLogger("rig-execution")


class RigExecution:
    def __init__(self, context):
        self.tracker = context
        self.last_vfo_update_time = 0.0
        self.failed_tx_control_modes: set[str] = set()

    def _get_retune_interval_seconds(self) -> float:
        details = self.tracker.rig_details or {}
        configured = details.get("retune_interval_ms", 2000)
        try:
            interval_ms = int(configured)
        except (TypeError, ValueError):
            interval_ms = 2000
        interval_ms = min(max(interval_ms, 100), 60000)
        self.tracker.rig_data["retune_interval_ms"] = interval_ms
        return interval_ms / 1000.0

    def _apply_radio_mode_to_targets(
        self,
        mode: str,
        vfo1_freq,
        vfo2_freq,
        downlink_vfo,
        ptt_active: bool,
    ) -> tuple[float, float, str | None]:
        """Apply radio_mode semantics to computed targets.

        Returns a tuple of (vfo1_freq, vfo2_freq, downlink_vfo).
        """
        mode = mode or "duplex"

        if mode == "monitor":
            if self.tracker.current_vfo1 == "uplink":
                vfo1_freq = 0
            if self.tracker.current_vfo2 == "uplink":
                vfo2_freq = 0
            return vfo1_freq, vfo2_freq, downlink_vfo

        if mode == "uplink_only":
            if self.tracker.current_vfo1 == "downlink":
                vfo1_freq = 0
            if self.tracker.current_vfo2 == "downlink":
                vfo2_freq = 0
            return vfo1_freq, vfo2_freq, None

        if mode == "simplex":
            selected_vfo = str(self.tracker.current_rig_vfo or "").strip()
            keep_vfo = None
            if selected_vfo in {"1", "2"}:
                keep_vfo = selected_vfo
            elif downlink_vfo in {"1", "2"}:
                keep_vfo = downlink_vfo
            else:
                keep_vfo = "1"

            if keep_vfo == "1":
                vfo2_freq = 0
                downlink_vfo = "1" if self.tracker.current_vfo1 == "downlink" else None
            else:
                vfo1_freq = 0
                downlink_vfo = "2" if self.tracker.current_vfo2 == "downlink" else None
            return vfo1_freq, vfo2_freq, downlink_vfo

        if mode == "ptt_guarded" and ptt_active:
            # During TX, freeze uplink retunes but still allow downlink updates.
            if self.tracker.current_vfo1 == "uplink":
                vfo1_freq = 0
            if self.tracker.current_vfo2 == "uplink":
                vfo2_freq = 0
            return vfo1_freq, vfo2_freq, downlink_vfo

        # duplex/default: leave both paths enabled
        return vfo1_freq, vfo2_freq, downlink_vfo

    async def control_rig_frequency(self):
        """Control rig frequency based on doppler calculations for both VFOs."""
        if self.tracker.rig_controller and self.tracker.current_rig_state == "tracking":
            # Check if this is an SDR or hardware rig
            if isinstance(self.tracker.rig_controller, SDRController):
                # SDR: Don't set center frequency - user controls that manually from UI
                # VFO frequency updates are handled in vfos/updates.py:handle_vfo_updates_for_tracking()
                logger.debug(
                    f"SDR tracking - doppler freq: {self.tracker.rig_data['downlink_observed_freq']:.0f} Hz (VFO updates handled separately)"
                )

            else:
                current_time = time.time()
                retune_interval_seconds = self._get_retune_interval_seconds()
                if current_time - self.last_vfo_update_time < retune_interval_seconds:
                    return
                self.last_vfo_update_time = current_time

                transmitter = None
                if self.tracker.current_transmitter_id != "none":
                    for t in self.tracker.rig_data.get("transmitters", []):
                        if t["id"] == self.tracker.current_transmitter_id:
                            transmitter = t
                            break
                if not transmitter:
                    return

                vfo1_freq = None
                vfo2_freq = None
                downlink_vfo = None
                if self.tracker.current_vfo1 == "uplink":
                    vfo1_freq = transmitter.get("uplink_observed_freq", 0)
                elif self.tracker.current_vfo1 == "downlink":
                    vfo1_freq = transmitter.get("downlink_observed_freq", 0)
                    downlink_vfo = "1"

                if self.tracker.current_vfo2 == "uplink":
                    vfo2_freq = transmitter.get("uplink_observed_freq", 0)
                elif self.tracker.current_vfo2 == "downlink":
                    vfo2_freq = transmitter.get("downlink_observed_freq", 0)
                    downlink_vfo = "2"

                configured_tx_control_mode = (self.tracker.rig_details or {}).get(
                    "tx_control_mode", "auto"
                )
                effective_tx_control_mode = self._resolve_tx_control_mode(
                    configured_tx_control_mode
                )
                configured_radio_mode = (self.tracker.rig_details or {}).get("radio_mode", "duplex")

                ptt_active = await self._is_ptt_active()
                if ptt_active and configured_radio_mode != "ptt_guarded":
                    logger.debug("PTT active, skipping rig retune cycle for safety")
                    return

                vfo1_freq, vfo2_freq, downlink_vfo = self._apply_radio_mode_to_targets(
                    mode=configured_radio_mode,
                    vfo1_freq=vfo1_freq,
                    vfo2_freq=vfo2_freq,
                    downlink_vfo=downlink_vfo,
                    ptt_active=ptt_active,
                )

                allow_downlink = any(
                    [
                        self.tracker.current_vfo1 == "downlink" and vfo1_freq and vfo1_freq > 0,
                        self.tracker.current_vfo2 == "downlink" and vfo2_freq and vfo2_freq > 0,
                    ]
                )
                allow_uplink = any(
                    [
                        self.tracker.current_vfo1 == "uplink" and vfo1_freq and vfo1_freq > 0,
                        self.tracker.current_vfo2 == "uplink" and vfo2_freq and vfo2_freq > 0,
                    ]
                )

                self.tracker.rig_data["radio_mode"] = configured_radio_mode
                self.tracker.rig_data["tx_control_mode"] = configured_tx_control_mode
                self.tracker.rig_data["active_tx_control_mode"] = effective_tx_control_mode

                if effective_tx_control_mode == "split_tx_cmd":
                    try:
                        await self._control_split_tx_cmd(
                            transmitter=transmitter,
                            vfo1_freq=vfo1_freq,
                            vfo2_freq=vfo2_freq,
                            allow_downlink=allow_downlink,
                            allow_uplink=allow_uplink,
                        )
                        return
                    except Exception as e:
                        logger.warning(
                            "split_tx_cmd strategy failed (%s); attempting fallback strategy", e
                        )
                        self.failed_tx_control_modes.add("split_tx_cmd")
                        if (
                            configured_tx_control_mode == "auto"
                            and isinstance(self.tracker.rig_controller, RigController)
                            and self.tracker.rig_controller.supports_explicit_vfo_cmd
                            and "vfo_explicit" not in self.failed_tx_control_modes
                        ):
                            try:
                                await self._control_vfo_explicit(
                                    transmitter=transmitter,
                                    vfo1_freq=vfo1_freq,
                                    vfo2_freq=vfo2_freq,
                                )
                                self.tracker.rig_data["active_tx_control_mode"] = "vfo_explicit"
                                return
                            except Exception as explicit_error:
                                logger.warning(
                                    "vfo_explicit fallback strategy failed (%s); using vfo_switch",
                                    explicit_error,
                                )
                                self.failed_tx_control_modes.add("vfo_explicit")
                        self.tracker.rig_data["active_tx_control_mode"] = "vfo_switch"

                if effective_tx_control_mode == "vfo_explicit":
                    try:
                        await self._control_vfo_explicit(
                            transmitter=transmitter,
                            vfo1_freq=vfo1_freq,
                            vfo2_freq=vfo2_freq,
                        )
                        return
                    except Exception as e:
                        logger.warning(
                            "vfo_explicit strategy failed (%s); falling back to vfo_switch", e
                        )
                        self.failed_tx_control_modes.add("vfo_explicit")
                        self.tracker.rig_data["active_tx_control_mode"] = "vfo_switch"

                await self._control_vfo_switch(
                    transmitter=transmitter,
                    vfo1_freq=vfo1_freq,
                    vfo2_freq=vfo2_freq,
                    downlink_vfo=downlink_vfo,
                )

    def _resolve_tx_control_mode(self, configured_tx_control_mode: str) -> str:
        if configured_tx_control_mode == "vfo_switch":
            return "vfo_switch"
        if configured_tx_control_mode == "split_tx_cmd":
            return "split_tx_cmd"
        if configured_tx_control_mode == "vfo_explicit":
            return "vfo_explicit"
        if isinstance(self.tracker.rig_controller, RigController):
            if (
                self.tracker.rig_controller.supports_split_tx_cmd
                and "split_tx_cmd" not in self.failed_tx_control_modes
            ):
                return "split_tx_cmd"
            if (
                self.tracker.rig_controller.supports_explicit_vfo_cmd
                and "vfo_explicit" not in self.failed_tx_control_modes
            ):
                return "vfo_explicit"
        return "vfo_switch"

    async def _is_ptt_active(self) -> bool:
        if not isinstance(self.tracker.rig_controller, RigController):
            return False
        if not self.tracker.rig_controller.supports_ptt_query:
            return False
        try:
            ptt_state = await self.tracker.rig_controller.get_ptt()
            return bool(ptt_state)
        except Exception:
            return False

    async def _control_split_tx_cmd(
        self, transmitter, vfo1_freq, vfo2_freq, allow_downlink: bool, allow_uplink: bool
    ):
        if not isinstance(self.tracker.rig_controller, RigController):
            return

        downlink_freq = 0
        uplink_freq = 0

        # Prefer already-resolved VFO frequencies (includes offset/radio_mode logic).
        if self.tracker.current_vfo1 == "downlink" and vfo1_freq and vfo1_freq > 0:
            downlink_freq = vfo1_freq
        if self.tracker.current_vfo2 == "downlink" and vfo2_freq and vfo2_freq > 0:
            downlink_freq = vfo2_freq
        if self.tracker.current_vfo1 == "uplink" and vfo1_freq and vfo1_freq > 0:
            uplink_freq = vfo1_freq
        if self.tracker.current_vfo2 == "uplink" and vfo2_freq and vfo2_freq > 0:
            uplink_freq = vfo2_freq

        # Fallback to transmitter frequencies if VFO assignment did not yield a target.
        if (not downlink_freq or downlink_freq <= 0) and allow_downlink:
            downlink_freq = transmitter.get("downlink_observed_freq", 0)
        if (not uplink_freq or uplink_freq <= 0) and allow_uplink:
            uplink_freq = transmitter.get("uplink_observed_freq", 0)

        if allow_downlink and downlink_freq and downlink_freq > 0:
            success = await self.tracker.rig_controller.set_frequency_direct(downlink_freq)
            if not success:
                raise RuntimeError("Failed setting downlink via direct RX command")

        if allow_uplink and uplink_freq and uplink_freq > 0:
            success = await self.tracker.rig_controller.set_tx_frequency(uplink_freq)
            if not success:
                raise RuntimeError("Failed setting uplink via split TX command")

        self.tracker.rig_data["vfo1"] = {
            "frequency": vfo1_freq or 0,
            "mode": transmitter.get("mode", "UNKNOWN"),
            "bandwidth": 0,
        }
        self.tracker.rig_data["vfo2"] = {
            "frequency": vfo2_freq or 0,
            "mode": transmitter.get("mode", "UNKNOWN"),
            "bandwidth": 0,
        }

    async def _control_vfo_switch(self, transmitter, vfo1_freq, vfo2_freq, downlink_vfo):
        # Set VFO 1 frequency if configured
        if vfo1_freq and vfo1_freq > 0:
            try:
                frequency_gen = self.tracker.rig_controller.set_frequency(vfo1_freq, vfo="1")
                current_frequency, is_tuning = await anext(frequency_gen)

                self.tracker.rig_data["vfo1"] = {
                    "frequency": vfo1_freq,
                    "mode": transmitter.get("mode", "UNKNOWN"),
                    "bandwidth": 0,
                }

                logger.debug(
                    "Hardware rig VFO 1 (%s): %s Hz, tuning=%s",
                    self.tracker.current_vfo1,
                    current_frequency,
                    is_tuning,
                )
            except StopAsyncIteration:
                logger.info(
                    "Hardware rig VFO 1 tuned to %s Hz (%s)",
                    vfo1_freq,
                    self.tracker.current_vfo1,
                )
            except Exception as e:
                logger.error(f"Error setting VFO 1 frequency: {e}")

        # Set VFO 2 frequency if configured
        if vfo2_freq and vfo2_freq > 0:
            try:
                frequency_gen = self.tracker.rig_controller.set_frequency(vfo2_freq, vfo="2")
                current_frequency, is_tuning = await anext(frequency_gen)

                self.tracker.rig_data["vfo2"] = {
                    "frequency": vfo2_freq,
                    "mode": transmitter.get("mode", "UNKNOWN"),
                    "bandwidth": 0,
                }

                logger.debug(
                    "Hardware rig VFO 2 (%s): %s Hz, tuning=%s",
                    self.tracker.current_vfo2,
                    current_frequency,
                    is_tuning,
                )
            except StopAsyncIteration:
                logger.info(
                    "Hardware rig VFO 2 tuned to %s Hz (%s)",
                    vfo2_freq,
                    self.tracker.current_vfo2,
                )
            except Exception as e:
                logger.error(f"Error setting VFO 2 frequency: {e}")

        # Keep downlink VFO selected for user operation.
        if downlink_vfo:
            try:
                vfo_name = "VFOA" if downlink_vfo == "1" else "VFOB"
                await self.tracker.rig_controller.set_vfo(vfo_name)
                logger.debug(f"Selected {vfo_name} (downlink) for user operation")
            except Exception as e:
                logger.error(f"Error selecting downlink VFO: {e}")

    async def _control_vfo_explicit(self, transmitter, vfo1_freq, vfo2_freq):
        if not isinstance(self.tracker.rig_controller, RigController):
            return

        if vfo1_freq and vfo1_freq > 0:
            success = await self.tracker.rig_controller.set_frequency_explicit_vfo(
                "VFOA", vfo1_freq
            )
            if not success:
                raise RuntimeError("Failed to set explicit VFOA frequency")
            self.tracker.rig_data["vfo1"] = {
                "frequency": vfo1_freq,
                "mode": transmitter.get("mode", "UNKNOWN"),
                "bandwidth": 0,
            }
            logger.debug("Explicit VFOA tuned to %s Hz", vfo1_freq)

        if vfo2_freq and vfo2_freq > 0:
            success = await self.tracker.rig_controller.set_frequency_explicit_vfo(
                "VFOB", vfo2_freq
            )
            if not success:
                raise RuntimeError("Failed to set explicit VFOB frequency")
            self.tracker.rig_data["vfo2"] = {
                "frequency": vfo2_freq,
                "mode": transmitter.get("mode", "UNKNOWN"),
                "bandwidth": 0,
            }
            logger.debug("Explicit VFOB tuned to %s Hz", vfo2_freq)
