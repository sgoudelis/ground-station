# Ground Station - Base Decoder
# Developed by Claude (Anthropic AI) for the Ground Station project
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
#
# Base class for all decoders with shared packet handling logic.

import base64
import json
import logging
import os
import queue
import threading
import time
from typing import Any, Dict, Optional

import numpy as np

from constants import get_modulation_display, payload_protocol_from_framing
from telemetry.context import ParseContext
from telemetry.result import failure_result
from telemetry.service import parse_packet

logger = logging.getLogger("basedecoder")

# Load satellite callsign to NORAD ID lookup table
_CALLSIGN_LOOKUP = None


def _load_callsign_lookup():
    """Load the satellite callsign to NORAD ID lookup table."""
    global _CALLSIGN_LOOKUP
    if _CALLSIGN_LOOKUP is None:
        try:
            lookup_path = os.path.join(
                os.path.dirname(os.path.dirname(__file__)), "satellite-norad-lookup.json"
            )
            with open(lookup_path, "r") as f:
                data = json.load(f)
                _CALLSIGN_LOOKUP = data.get("satellites", {})
            logger.info(f"Loaded {len(_CALLSIGN_LOOKUP)} satellite callsigns from lookup table")
        except Exception as e:
            logger.error(f"Failed to load callsign lookup table: {e}")
            _CALLSIGN_LOOKUP = {}
    return _CALLSIGN_LOOKUP


class BaseDecoder:
    """
    Base class for all decoders providing shared packet processing logic.

    This class consolidates the common packet handling logic that was previously
    duplicated across all decoder implementations (~200 lines per decoder).

    Subclasses must define these attributes in __init__:
    - packet_count: int - Number of packets decoded
    - stats_lock: threading.Lock - Lock for thread-safe stats access
    - stats: Dict[str, Any] - Statistics dictionary
    - telemetry_parser: TelemetryParser - Parser for telemetry data
    - output_dir: str - Directory for output files
    - session_id: str - Session identifier
    - baudrate: int - Baud rate
    - vfo: Optional[int] - VFO identifier
    - satellite: Dict - Satellite metadata dict (norad_id, name, etc.)
    - transmitter: Dict - Transmitter metadata dict (description, mode, downlink_low, etc.)
    - norad_id: Optional[int] - NORAD satellite ID (extracted from satellite dict)
    - satellite_name: str - Satellite name (extracted from satellite dict)
    - transmitter_description: str - Transmitter description (extracted from transmitter dict)
    - transmitter_mode: str - Transmitter mode (extracted from transmitter dict)
    - transmitter_downlink_freq: Optional[float] - Downlink frequency in Hz (extracted from transmitter dict)
    - config_source: str - Configuration source
    - framing: str - Framing protocol
    - data_queue: queue.Queue - Queue for output data

    Subclasses must implement:
    - _get_decoder_type(): Return decoder type string ("afsk", "bpsk", etc.)
    - _get_decoder_specific_metadata(): Return dict with decoder-specific params
    - _get_filename_params(): Return string for filename (e.g., '1200baud')
    - _get_parameters_string(): Return human-readable parameters for UI
    - _get_demodulator_params_metadata(): Return demodulator parameters
    - _get_vfo_state(): Return VFO state object or None

    Subclasses may optionally override:
    - _should_accept_packet(payload, callsigns): Custom packet validation
    - _get_decoder_config_metadata(): Custom decoder config metadata
    - _get_payload_protocol(): Custom payload protocol detection
    - _get_signal_metadata(vfo_state): Custom signal metadata
    """

    # Type hints for attributes that must be defined by subclasses
    packet_count: int
    stats_lock: threading.Lock
    stats: Dict[str, Any]
    telemetry_parser: Any  # TelemetryParser
    output_dir: str
    session_id: str
    baudrate: int
    vfo: Optional[int]
    satellite: Dict
    transmitter: Dict
    norad_id: Optional[int]
    satellite_name: str
    transmitter_description: str
    transmitter_mode: str
    transmitter_downlink_freq: Optional[float]
    config_source: str
    framing: str
    data_queue: Any  # queue.Queue
    sdr_center_freq: Optional[float]
    sample_rate: Optional[float]
    sdr_sample_rate: Optional[float]

    # Signal power measurement (optional - initialized by subclass if needed)
    power_measurements: list = []
    max_power_history: int = 100
    current_power_dbfs: Optional[float] = None

    def _measure_signal_power(self, samples):
        """
        Measure signal power in dBFS (dB relative to full scale).

        This method should be called after frequency translation but before
        decimation/AGC to get the most accurate raw signal strength.

        Args:
            samples: Complex IQ samples (numpy array)

        Returns:
            float: Power in dBFS, or None if measurement fails
        """
        if samples is None or len(samples) == 0:
            return None

        try:
            # Calculate instantaneous power: |I + jQ|^2 = I^2 + Q^2
            power_linear = np.abs(samples) ** 2

            # Calculate mean power
            mean_power = np.mean(power_linear)

            # Avoid log of zero
            if mean_power <= 0:
                return None

            # Convert to dBFS (dB relative to full scale)
            # Full scale for complex samples is 1.0, so 0 dBFS = power of 1.0
            power_dbfs = 10 * np.log10(mean_power)

            # Queue messages are later encoded as JSON by Socket.IO.  NumPy
            # scalars (notably float32 for complex64 IQ) are not JSON serializable.
            return float(power_dbfs)

        except Exception as e:
            logger.debug(f"Error measuring signal power: {e}")
            return None

    def _update_power_measurement(self, power_dbfs):
        """
        Update power measurement history.

        Call this after measuring power to update the current power
        and maintain a rolling history of measurements.

        Args:
            power_dbfs: Power measurement in dBFS
        """
        if power_dbfs is not None:
            self.current_power_dbfs = power_dbfs
            self.power_measurements.append(power_dbfs)
            # Keep only recent measurements
            if len(self.power_measurements) > self.max_power_history:
                self.power_measurements.pop(0)

    def _get_power_statistics(self):
        """
        Get power statistics for inclusion in status messages.

        Returns:
            dict: Power statistics (current, avg, max, min) in dBFS
        """
        stats = {}
        if self.current_power_dbfs is not None:
            stats["signal_power_dbfs"] = round(float(self.current_power_dbfs), 1)
        if len(self.power_measurements) > 0:
            stats["signal_power_avg_dbfs"] = round(float(np.mean(self.power_measurements)), 1)
            stats["signal_power_max_dbfs"] = round(float(np.max(self.power_measurements)), 1)
            stats["signal_power_min_dbfs"] = round(float(np.min(self.power_measurements)), 1)
        return stats

    def _on_packet_decoded(
        self, payload: bytes, callsigns: Optional[Dict[str, str]] = None
    ) -> None:
        """
        Shared packet processing logic for all decoders.

        Handles:
        - Packet validation
        - Counting and stats
        - Telemetry parsing
        - File saving (binary + metadata)
        - UI message construction and sending

        Args:
            payload: Raw packet bytes
            callsigns: Optional dict with 'from' and 'to' callsigns
        """
        try:
            # Validate packet (subclass-specific logic)
            if not self._should_accept_packet(payload, callsigns):
                return

            # Increment counter
            self.packet_count += 1
            with self.stats_lock:
                self.stats["packets_decoded"] = self.packet_count

            decoder_type = self._get_decoder_type()
            decoder_display = get_modulation_display(decoder_type)
            logger.info(f"{decoder_display} transmission decoded: {len(payload)} bytes")

            # Preserve reception independently of parsing, identity lookup or UI
            # metadata. Even a programming error must leave the original bytes.
            decode_timestamp = time.time()
            filename = self._generate_filename(decode_timestamp)
            filepath = os.path.join(self.output_dir, filename)
            with open(filepath, "wb") as f:
                f.write(payload)

            # Capture and reparse resolve exactly the same context and byte
            # convention. Store it so future parser changes need no guessing.
            try:
                parse_context = ParseContext.from_metadata(
                    {
                        "decoder_config": self._get_decoder_config_metadata(),
                        "decoder": {"type": decoder_type},
                        "satellite": self.satellite or {},
                    }
                )
                telemetry_result = parse_packet(payload, parse_context, self.telemetry_parser)
            except Exception as exc:
                logger.exception("Could not resolve packet parsing context")
                parse_context = ParseContext(protocol="unknown")
                telemetry_result = failure_result(payload, "unknown", str(exc))
            if telemetry_result.get("success"):
                logger.info(f"Telemetry parsed: {telemetry_result.get('parser', 'unknown')}")

            # Only the validated shared AX.25 reader may supply missing callsigns.
            frame = telemetry_result.get("frame") or {}
            if (
                not callsigns
                and isinstance(frame.get("source"), str)
                and isinstance(frame.get("destination"), str)
            ):
                callsigns = {"from": frame["source"], "to": frame["destination"]}
            identified_norad_id, identified_satellite = self._identify_satellite(callsigns)

            # Build metadata
            metadata = self._build_metadata(
                payload,
                decode_timestamp,
                filename,
                filepath,
                callsigns,
                telemetry_result,
                identified_norad_id,
                identified_satellite,
            )
            metadata["parse_context"] = parse_context.to_dict()

            # Save metadata JSON
            metadata_filename = filename.replace(".bin", ".json")
            metadata_filepath = os.path.join(self.output_dir, metadata_filename)
            with open(metadata_filepath, "w") as f:
                json.dump(metadata, f, indent=2, allow_nan=False)
            logger.info(f"Saved metadata: {metadata_filepath}")

            # Send to UI
            self._send_packet_to_ui(
                payload,
                decode_timestamp,
                filename,
                filepath,
                metadata_filename,
                metadata_filepath,
                callsigns,
                telemetry_result,
                identified_norad_id,
                identified_satellite,
            )

        except Exception as e:
            logger.error(f"Error processing decoded packet: {e}")
            logger.exception(e)
            with self.stats_lock:
                self.stats["errors"] += 1

    def _should_accept_packet(self, payload: bytes, callsigns: Optional[Dict[str, str]]) -> bool:
        """
        Determine if packet should be processed.

        Default: accept all packets.
        Override in subclass for decoder-specific validation.

        Args:
            payload: Raw packet bytes
            callsigns: Optional dict with 'from' and 'to' callsigns

        Returns:
            bool: True if packet should be processed
        """
        return True

    @staticmethod
    def _identify_satellite(callsigns):
        """Identity enrichment must never prevent packet metadata from being saved."""
        if not callsigns or not callsigns.get("from"):
            return None, None
        source = callsigns["from"]
        lookup = _load_callsign_lookup()
        # All AX.25 SSIDs (0–15) share the base callsign's identity.
        for candidate in (source, source.split("-", 1)[0]):
            norad_id = lookup.get(candidate)
            if norad_id:
                return norad_id, candidate
        return None, None

    def _generate_filename(self, timestamp: float) -> str:
        """
        Generate filename for decoded packet.

        Args:
            timestamp: Unix timestamp

        Returns:
            str: Filename for binary packet file
        """
        timestamp_str = time.strftime("%Y%m%d_%H%M%S", time.localtime(timestamp))
        timestamp_us = int((timestamp % 1) * 1000000)
        decoder_type = self._get_decoder_type()

        # Get decoder-specific params for filename
        params = self._get_filename_params()
        return f"{decoder_type}_{params}_{timestamp_str}_{timestamp_us:06d}.bin"

    def _build_metadata(
        self,
        payload: bytes,
        timestamp: float,
        filename: str,
        filepath: str,
        callsigns: Optional[Dict[str, str]],
        telemetry_result: Dict[str, Any],
        identified_norad_id: Optional[int] = None,
        identified_satellite: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Build comprehensive metadata dictionary.

        Args:
            payload: Raw packet bytes
            timestamp: Unix timestamp
            filename: Binary filename
            filepath: Binary filepath
            callsigns: Optional dict with 'from' and 'to' callsigns
            telemetry_result: Dict with telemetry parsing results
            identified_norad_id: Optional NORAD ID from callsign lookup
            identified_satellite: Optional satellite name from callsign lookup

        Returns:
            dict: Comprehensive metadata
        """
        vfo_state = self._get_vfo_state()

        metadata = {
            "packet": {
                "number": self.packet_count,
                "length_bytes": len(payload),
                "timestamp": timestamp,
                "timestamp_iso": time.strftime("%Y-%m-%dT%H:%M:%S%z", time.localtime(timestamp)),
                "hex": payload.hex(),
            },
            "decoder": self._get_decoder_metadata(),
            "signal": self._get_signal_metadata(vfo_state),
            "vfo": self._get_vfo_metadata(vfo_state),
            "satellite": self._get_satellite_metadata(),
            "transmitter": self._get_transmitter_metadata(),
            "decoder_config": self._get_decoder_config_metadata(),
            "demodulator_parameters": self._get_demodulator_params_metadata(),
            "file": {
                "binary": filename,
                "binary_path": filepath,
            },
        }

        # Add callsigns if available
        if callsigns:
            metadata["ax25"] = {
                "from_callsign": callsigns.get("from"),
                "to_callsign": callsigns.get("to"),
            }
            # Add identified satellite info if available
            if identified_norad_id:
                metadata["ax25"]["identified_norad_id"] = identified_norad_id
                metadata["ax25"]["identified_satellite"] = identified_satellite

        # Add telemetry
        metadata["telemetry"] = telemetry_result

        return metadata

    def _get_decoder_metadata(self) -> Dict[str, Any]:
        """
        Get decoder-specific metadata.

        Returns:
            dict: Decoder metadata including type, session, baudrate, and specific params
        """
        base: Dict[str, Any] = {
            "type": self._get_decoder_type(),
            "session_id": self.session_id,
            "baudrate": self.baudrate,
        }
        base.update(self._get_decoder_specific_metadata())
        return base

    def _get_signal_metadata(self, vfo_state: Any) -> Dict[str, Any]:
        """
        Get signal metadata including power measurements.

        Args:
            vfo_state: VFO state object or None

        Returns:
            dict: Signal metadata including frequency, sample rates, and power statistics
        """
        sdr_center = getattr(self, "sdr_center_freq", None)
        metadata = {
            "frequency_hz": vfo_state.center_freq if vfo_state else None,
            "frequency_mhz": vfo_state.center_freq / 1e6 if vfo_state else None,
            "sample_rate_hz": getattr(self, "sample_rate", None),
            "sdr_sample_rate_hz": getattr(self, "sdr_sample_rate", None),
            "sdr_center_freq_hz": sdr_center,
            "sdr_center_freq_mhz": (sdr_center / 1e6 if sdr_center is not None else None),
        }

        # Add power statistics if available
        metadata.update(self._get_power_statistics())

        return metadata

    def _get_vfo_metadata(self, vfo_state: Any) -> Dict[str, Any]:
        """
        Get VFO metadata.

        Args:
            vfo_state: VFO state object or None

        Returns:
            dict: VFO metadata
        """
        return {
            "id": self.vfo,
            "center_freq_hz": vfo_state.center_freq if vfo_state else None,
            "center_freq_mhz": vfo_state.center_freq / 1e6 if vfo_state else None,
            "bandwidth_hz": vfo_state.bandwidth if vfo_state else None,
            "bandwidth_khz": vfo_state.bandwidth / 1e3 if vfo_state else None,
            "active": vfo_state.active if vfo_state else None,
        }

    def _get_satellite_metadata(self) -> Dict[str, Any]:
        """
        Get satellite metadata.

        Returns:
            dict: Satellite metadata (empty dict if no satellite)
        """
        if self.norad_id:
            return {
                "norad_id": self.norad_id,
                "name": self.satellite_name,
            }
        return {}

    def _get_transmitter_metadata(self) -> Dict[str, Any]:
        """
        Get transmitter metadata.

        Returns:
            dict: Transmitter metadata
        """
        return {
            "description": self.transmitter_description,
            "mode": self.transmitter_mode,
            "downlink_freq_hz": self.transmitter_downlink_freq,
        }

    def _get_decoder_config_metadata(self) -> Dict[str, Any]:
        """
        Get decoder config metadata.

        Override in subclass if custom logic needed.

        Returns:
            dict: Decoder config metadata
        """
        return {
            "source": self.config_source,
            "framing": self.framing,
            "payload_protocol": self._get_payload_protocol(),
        }

    def _get_payload_protocol(self) -> str:
        """
        Determine payload protocol based on framing.

        Override in subclass if custom logic needed.

        Returns:
            str: Payload protocol name
        """
        if hasattr(self, "framing"):
            return str(payload_protocol_from_framing(self.framing, default="ax25"))
        return "ax25"

    def _send_packet_to_ui(
        self,
        payload: bytes,
        timestamp: float,
        filename: str,
        filepath: str,
        metadata_filename: str,
        metadata_filepath: str,
        callsigns: Optional[Dict[str, str]],
        telemetry_result: Dict[str, Any],
        identified_norad_id: Optional[int] = None,
        identified_satellite: Optional[str] = None,
    ) -> None:
        """
        Send decoded packet to UI via data queue.

        Args:
            payload: Raw packet bytes
            timestamp: Unix timestamp
            filename: Binary filename
            filepath: Binary filepath
            metadata_filename: Metadata JSON filename
            metadata_filepath: Metadata JSON filepath
            callsigns: Optional dict with 'from' and 'to' callsigns
            telemetry_result: Dict with telemetry parsing results
            identified_norad_id: Optional NORAD ID from callsign lookup
            identified_satellite: Optional satellite name from callsign lookup
        """
        packet_base64 = base64.b64encode(payload).decode()
        decoder_type = self._get_decoder_type()

        output_data: Dict[str, Any] = {
            "format": "application/octet-stream",
            "filename": filename,
            "filepath": filepath,
            "metadata_filename": metadata_filename,
            "metadata_filepath": metadata_filepath,
            "packet_data": packet_base64,
            "packet_length": len(payload),
            "packet_number": self.packet_count,
            "parameters": self._get_parameters_string(),
        }

        # Add callsigns if available
        if callsigns:
            output_data["callsigns"] = callsigns.copy()
            # Add identified satellite info if available
            if identified_norad_id:
                output_data["callsigns"]["identified_norad_id"] = identified_norad_id
                output_data["callsigns"]["identified_satellite"] = identified_satellite

        # Add satellite info
        if self.norad_id:
            output_data["satellite"] = {
                "norad_id": self.norad_id,
                "name": self.satellite_name,
            }

        # Files and events carry the same result, including parse failures.
        output_data["telemetry"] = telemetry_result

        # Add decoder config
        output_data["decoder_config"] = self._get_decoder_config_metadata()

        # Add signal metadata (includes frequency, sample rates, and power measurements if available)
        vfo_state = self._get_vfo_state()
        output_data["signal"] = self._get_signal_metadata(vfo_state)

        msg: Dict[str, Any] = {
            "type": "decoder-output",
            "decoder_type": decoder_type,
            "session_id": self.session_id,
            "vfo": self.vfo,
            "timestamp": timestamp,
            "output": output_data,
        }

        try:
            self.data_queue.put(msg, block=False)
            with self.stats_lock:
                self.stats["data_messages_out"] += 1
        except queue.Full:
            logger.warning("Data queue full, dropping packet output")

    # Abstract methods - must be implemented by subclasses

    def _get_decoder_type(self) -> str:
        """
        Return decoder type string.

        MUST override in subclass.

        Returns:
            str: Decoder type ("afsk", "bpsk", "gmsk", "gfsk")
        """
        raise NotImplementedError("Subclass must implement _get_decoder_type()")

    def _get_decoder_specific_metadata(self) -> Dict[str, Any]:
        """
        Return dict with decoder-specific metadata.

        MUST override in subclass.

        Returns:
            dict: Decoder-specific metadata (e.g., deviation, af_carrier, etc.)
        """
        raise NotImplementedError("Subclass must implement _get_decoder_specific_metadata()")

    def _get_filename_params(self) -> str:
        """
        Return string for filename parameters.

        MUST override in subclass.

        Returns:
            str: Filename parameter string (e.g., "1200baud")
        """
        raise NotImplementedError("Subclass must implement _get_filename_params()")

    def _get_parameters_string(self) -> str:
        """
        Return human-readable parameters string for UI.

        MUST override in subclass.

        Returns:
            str: Parameters string (e.g., "1200baud, 1700Hz carrier, 500Hz dev")
        """
        raise NotImplementedError("Subclass must implement _get_parameters_string()")

    def _get_demodulator_params_metadata(self) -> Dict[str, Any]:
        """
        Return demodulator parameters metadata.

        MUST override in subclass.

        Returns:
            dict: Demodulator parameters
        """
        raise NotImplementedError("Subclass must implement _get_demodulator_params_metadata()")

    def _get_vfo_state(self) -> Any:
        """
        Get VFO state for this decoder.

        MUST override in subclass.

        Returns:
            VFO state object or None
        """
        raise NotImplementedError("Subclass must implement _get_vfo_state()")


__all__ = ["BaseDecoder"]
