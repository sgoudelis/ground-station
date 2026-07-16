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

from __future__ import annotations

from typing import Any, Dict, Optional

from hardware.airspynative import AirspyDevice, AirspyhfDevice, AirspyNativeError, parse_serial


def _clip(value: Any, min_value: int, max_value: int) -> int:
    try:
        numeric = int(float(value))
    except Exception:
        numeric = min_value
    return max(min_value, min(max_value, numeric))


def _has_explicit_value(value: Any) -> bool:
    if value is None:
        return False
    if isinstance(value, str) and value.strip() == "":
        return False
    return True


def _pick_gain_override(gains: Dict[str, Any], key: str, fallback: Any) -> Any:
    if not isinstance(gains, dict):
        return fallback
    candidate = gains.get(key)
    return candidate if _has_explicit_value(candidate) else fallback


def _normalize_type(sdr_details: Dict[str, Any]) -> str:
    device_type = str(sdr_details.get("type", "") or "").strip().lower()
    driver = str(sdr_details.get("driver", "") or "").strip().lower()

    if device_type in {"airspy", "airspyhf"}:
        return device_type
    if driver in {"airspy", "airspyhf"}:
        return driver
    # Default to Airspy if callers don't provide type metadata yet.
    return "airspy"


def probe_native_airspy(sdr_details: Dict[str, Any]) -> Dict[str, Any]:
    """
    Probe native Airspy/Airspy HF+ capabilities for waterfall configuration.
    """

    reply: Dict[str, Any] = {
        "success": None,
        "data": None,
        "error": None,
        "log": [],
    }

    device_type = _normalize_type(sdr_details)
    serial_raw = sdr_details.get("serial")
    serial: Optional[int] = None
    if serial_raw not in (None, ""):
        serial = parse_serial(serial_raw)

    try:
        if device_type == "airspyhf":
            hf_device = AirspyhfDevice.open(serial)
            try:
                rates = hf_device.get_samplerates()
            finally:
                hf_device.close()

            gains = list(range(0, 9))
            capabilities = {
                "settings": [],
                "clock_sources": [],
                "time_sources": [],
                "gain_elements": {"rx": ["hf_att"], "tx": []},
                "gain_ranges": {"rx": {"hf_att": {"min": 0, "max": 8, "step": 1}}, "tx": {}},
                "agc": {"supported_rx": True, "supported_tx": False, "settings": ["hf_agc"]},
                "bias_t": {"supported": False, "keys": [], "value": None},
            }

            data = {
                "rates": sorted({int(rate) for rate in rates if rate > 0}),
                "gains": gains,
                "has_bias_t": False,
                "has_tuner_agc": True,
                "antennas": {"rx": ["RX"], "tx": []},
                "frequency_ranges": {"rx": {"min": 0.009, "max": 260.0}},
                "clock_info": {},
                "temperature": {},
                "capabilities": capabilities,
            }
            reply["success"] = True
            reply["data"] = data
            reply["log"].append("INFO: Native Airspy HF+ probe completed")
            return reply

        airspy_device = AirspyDevice.open(serial)
        try:
            rates = airspy_device.get_samplerates()
        finally:
            airspy_device.close()

        gains = list(range(0, 22))
        capabilities = {
            "settings": [],
            "clock_sources": [],
            "time_sources": [],
            "gain_elements": {
                "rx": ["sensitivity", "linearity", "lna", "mixer", "vga"],
                "tx": [],
            },
            "gain_ranges": {
                "rx": {
                    "sensitivity": {"min": 0, "max": 21, "step": 1},
                    "linearity": {"min": 0, "max": 21, "step": 1},
                    "lna": {"min": 0, "max": 15, "step": 1},
                    "mixer": {"min": 0, "max": 15, "step": 1},
                    "vga": {"min": 0, "max": 15, "step": 1},
                },
                "tx": {},
            },
            "agc": {
                "supported_rx": True,
                "supported_tx": False,
                "settings": ["lna_agc", "mixer_agc"],
            },
            "bias_t": {"supported": True, "keys": ["rf_bias"], "value": None},
        }

        data = {
            "rates": sorted({int(rate) for rate in rates if rate > 0}),
            "gains": gains,
            "has_bias_t": True,
            "has_tuner_agc": True,
            "antennas": {"rx": ["RX"], "tx": []},
            "frequency_ranges": {"rx": {"min": 24.0, "max": 1750.0}},
            "clock_info": {},
            "temperature": {},
            "capabilities": capabilities,
        }
        reply["success"] = True
        reply["data"] = data
        reply["log"].append("INFO: Native Airspy probe completed")
        return reply

    except AirspyNativeError as exc:
        reply["success"] = False
        reply["error"] = str(exc)
        reply["log"].append(f"ERROR: {exc}")
        return reply
    except Exception as exc:
        reply["success"] = False
        reply["error"] = str(exc)
        reply["log"].append(f"ERROR: {exc}")
        return reply


def apply_native_airspy_gain(
    device_type: str,
    device: Any,
    gain: Any,
    tuner_agc: bool,
    bias_t: bool,
    sdr_settings: Optional[Dict[str, Any]] = None,
) -> None:
    """
    Apply gain/AGC/Bias-T controls on an already opened native Airspy device.
    """

    settings = sdr_settings or {}
    gains = settings.get("gains", {}) if isinstance(settings, dict) else {}
    normalized_type = (device_type or "airspy").lower()

    if normalized_type == "airspyhf":
        if tuner_agc:
            device.set_hf_agc(True)
        else:
            device.set_hf_agc(False)
            gain_value = _pick_gain_override(gains, "hf_att", gain)
            device.set_hf_att(_clip(gain_value, 0, 8))
        return

    # Airspy (R2/Mini style)
    if tuner_agc:
        device.set_lna_agc(True)
        device.set_mixer_agc(True)
    else:
        device.set_lna_agc(False)
        device.set_mixer_agc(False)
        sensitivity_value = _pick_gain_override(gains, "sensitivity", gain)
        device.set_sensitivity_gain(_clip(sensitivity_value, 0, 21))

    # Optional advanced per-stage overrides.
    if not tuner_agc and isinstance(gains, dict):
        linearity_value = gains.get("linearity")
        if _has_explicit_value(linearity_value):
            device.set_linearity_gain(_clip(linearity_value, 0, 21))
        lna_value = gains.get("lna")
        if _has_explicit_value(lna_value):
            device.set_lna_gain(_clip(lna_value, 0, 15))
        mixer_value = gains.get("mixer")
        if _has_explicit_value(mixer_value):
            device.set_mixer_gain(_clip(mixer_value, 0, 15))
        vga_value = gains.get("vga")
        if _has_explicit_value(vga_value):
            device.set_vga_gain(_clip(vga_value, 0, 15))

    device.set_bias_t(bool(bias_t))
