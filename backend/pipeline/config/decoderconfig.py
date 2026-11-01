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


from dataclasses import dataclass
from typing import Any, Dict, Optional


@dataclass
class DecoderConfig:
    """
    Resolved decoder configuration with all parameters determined.

    This is the result of parameter resolution from multiple sources:
    - Satellite-specific configuration (gr-satellites database)
    - Transmitter metadata (SatNOGS DB)
    - Smart defaults based on modulation type
    - Manual overrides

    Used to:
    1. Pass pre-resolved parameters to decoders
    2. Compare configurations to detect parameter changes (for decoder restart logic)
    3. Provide single source of truth for decoder parameters
    """

    # Common parameters (all decoders)
    baudrate: int
    framing: str  # 'ax25', 'usp', 'geoscan', 'doka', etc.
    config_source: str  # 'satellite_config', 'smart_default', 'transmitter_metadata', 'manual'

    # FSK/APRS-specific parameters
    deviation: Optional[float] = None  # Frequency deviation in Hz; may be fractional

    # APRS Bell 202-specific parameters
    af_carrier: Optional[int] = None  # Audio frequency carrier in Hz (1700 for APRS)

    # BPSK-specific parameters
    differential: Optional[bool] = None  # DBPSK mode

    # SSTV-specific parameters
    sstv_mode: str = "auto"  # 'auto' or a supported forced mode key

    # LoRa-specific parameters
    sf: Optional[int] = None  # Spreading factor (7-12)
    bw: Optional[int] = None  # Bandwidth (125000, 250000, 500000)
    cr: Optional[int] = None  # Coding rate (1-4, corresponding to 4/5 through 4/8)
    sync_word: Optional[list] = None  # Sync word ([0, 0] for auto-detect)
    preamble_len: Optional[int] = None  # Preamble length (default: 8)
    fldro: Optional[bool] = None  # Low Data Rate Optimization (default: False)

    ldro_mode: Optional[int] = None
    implicit_header: Optional[bool] = None
    payload_length: Optional[int] = None
    has_crc: Optional[bool] = None
    invert_iq: Optional[bool] = None

    # Weather satellite specific parameters (SatDump)
    pipeline: Optional[str] = None  # SatDump pipeline name (e.g., 'noaa_apt', 'meteor_m2-x_lrpt')
    target_sample_rate: Optional[int] = (
        None  # Target sample rate for pipeline (e.g., 48000 for APT)
    )

    # Radiosonde family selection and input rate after VFO channelization
    radiosonde_sample_rate: int = 48000
    radiosonde_type: str = "auto"
    radiosonde_save_interval: int = 5  # Seconds; zero retains every validated packet.

    adsb_save_interval: int = 5
    adsb_capture_messages: bool = False

    # GNSS-SDR specific parameters
    gnss_sample_rate: Optional[int] = None  # Input sample rate expected by GNSS-SDR
    gnss_total_channels: Optional[int] = None  # Total acquisition/tracking channels
    gnss_output_rate_ms: Optional[int] = None  # PVT output interval in milliseconds
    gnss_doppler_max: Optional[int] = None  # Max Doppler search window in Hz
    gnss_enable_gps: Optional[bool] = None
    gnss_enable_galileo: Optional[bool] = None
    gnss_enable_glonass: Optional[bool] = None
    gnss_enable_beidou: Optional[bool] = None
    gnss_enable_qzss: Optional[bool] = None

    # Optional metadata
    packet_size: Optional[int] = None  # Expected packet size in bytes

    # Framing-specific parameters (protocol options passed to deframers)
    framing_params: Optional[Dict[str, Any]] = None

    # Satellite metadata (for logging, file naming, telemetry parsing)
    satellite: Optional[Dict] = None

    # Transmitter metadata (for logging, file naming, reference)
    transmitter: Optional[Dict] = None

    def __eq__(self, other):
        """
        Compare configurations to detect parameter changes.

        Used by DecoderManager to determine if decoder needs to be restarted
        when configuration changes (e.g., different satellite selected).

        Returns:
            bool: True if configurations are identical
        """
        if not isinstance(other, DecoderConfig):
            return False

        return (
            self.baudrate == other.baudrate
            and self.framing == other.framing
            and self.deviation == other.deviation
            and self.af_carrier == other.af_carrier
            and self.differential == other.differential
            and self.sstv_mode == other.sstv_mode
            and self.radiosonde_type == other.radiosonde_type
            and self.radiosonde_sample_rate == other.radiosonde_sample_rate
            and self.radiosonde_save_interval == other.radiosonde_save_interval
            and self.adsb_save_interval == other.adsb_save_interval
            and self.adsb_capture_messages == other.adsb_capture_messages
            and self.sf == other.sf
            and self.bw == other.bw
            and self.cr == other.cr
            and self.sync_word == other.sync_word
            and self.preamble_len == other.preamble_len
            and self.fldro == other.fldro
            and self.ldro_mode == other.ldro_mode
            and self.implicit_header == other.implicit_header
            and self.payload_length == other.payload_length
            and self.has_crc == other.has_crc
            and self.invert_iq == other.invert_iq
            and self.pipeline == other.pipeline
            and self.target_sample_rate == other.target_sample_rate
            and self.gnss_sample_rate == other.gnss_sample_rate
            and self.gnss_total_channels == other.gnss_total_channels
            and self.gnss_output_rate_ms == other.gnss_output_rate_ms
            and self.gnss_doppler_max == other.gnss_doppler_max
            and self.gnss_enable_gps == other.gnss_enable_gps
            and self.gnss_enable_galileo == other.gnss_enable_galileo
            and self.gnss_enable_glonass == other.gnss_enable_glonass
            and self.gnss_enable_beidou == other.gnss_enable_beidou
            and self.gnss_enable_qzss == other.gnss_enable_qzss
            and (self.framing_params or {}) == (other.framing_params or {})
        )

    def __hash__(self):
        """Allow DecoderConfig to be used as dict key"""
        # Convert dicts/lists to hashable representations
        framing_params_tuple = (
            tuple(sorted((self.framing_params or {}).items()))
            if (self.framing_params is not None)
            else None
        )

        return hash(
            (
                self.baudrate,
                self.framing,
                self.deviation,
                self.af_carrier,
                self.differential,
                self.sstv_mode,
                self.radiosonde_type,
                self.radiosonde_sample_rate,
                self.radiosonde_save_interval,
                self.adsb_save_interval,
                self.adsb_capture_messages,
                self.sf,
                self.bw,
                self.cr,
                tuple(self.sync_word) if self.sync_word else None,
                self.preamble_len,
                self.fldro,
                self.ldro_mode,
                self.implicit_header,
                self.payload_length,
                self.has_crc,
                self.invert_iq,
                self.pipeline,
                self.target_sample_rate,
                self.gnss_sample_rate,
                self.gnss_total_channels,
                self.gnss_output_rate_ms,
                self.gnss_doppler_max,
                self.gnss_enable_gps,
                self.gnss_enable_galileo,
                self.gnss_enable_glonass,
                self.gnss_enable_beidou,
                self.gnss_enable_qzss,
                framing_params_tuple,
            )
        )

    def to_dict(self):
        """Convert to dictionary for logging/serialization"""
        return {
            "baudrate": self.baudrate,
            "framing": self.framing,
            "config_source": self.config_source,
            "deviation": self.deviation,
            "af_carrier": self.af_carrier,
            "differential": self.differential,
            "sstv_mode": self.sstv_mode,
            "radiosonde_type": self.radiosonde_type,
            "radiosonde_sample_rate": self.radiosonde_sample_rate,
            "radiosonde_save_interval": self.radiosonde_save_interval,
            "adsb_save_interval": self.adsb_save_interval,
            "adsb_capture_messages": self.adsb_capture_messages,
            "sf": self.sf,
            "bw": self.bw,
            "cr": self.cr,
            "sync_word": self.sync_word,
            "preamble_len": self.preamble_len,
            "fldro": self.fldro,
            "ldro_mode": self.ldro_mode,
            "implicit_header": self.implicit_header,
            "payload_length": self.payload_length,
            "has_crc": self.has_crc,
            "invert_iq": self.invert_iq,
            "pipeline": self.pipeline,
            "target_sample_rate": self.target_sample_rate,
            "gnss_sample_rate": self.gnss_sample_rate,
            "gnss_total_channels": self.gnss_total_channels,
            "gnss_output_rate_ms": self.gnss_output_rate_ms,
            "gnss_doppler_max": self.gnss_doppler_max,
            "gnss_enable_gps": self.gnss_enable_gps,
            "gnss_enable_galileo": self.gnss_enable_galileo,
            "gnss_enable_glonass": self.gnss_enable_glonass,
            "gnss_enable_beidou": self.gnss_enable_beidou,
            "gnss_enable_qzss": self.gnss_enable_qzss,
            "packet_size": self.packet_size,
            "framing_params": self.framing_params,
            "satellite": self.satellite,
            "transmitter": self.transmitter,
        }
