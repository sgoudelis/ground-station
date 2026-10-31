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


import logging
from typing import Dict, Optional

from constants import FramingType
from constants.framing import FSK_DECODER_FRAMINGS
from demodulators.loraconfig import lora_metadata, normalize_lora
from pipeline.config.decoderconfig import DecoderConfig
from satconfig.config import SatelliteConfigService

logger = logging.getLogger("decoderconfigservice")


class DecoderConfigService:
    """
    Centralized service for resolving decoder configurations.

    Consolidates parameter resolution logic that was previously duplicated
    across GMSK, BPSK, APRS, and GFSK decoders.

    Resolution priority (highest to lowest):
    1. Manual overrides (passed via overrides parameter)
    2. Explicit settings on the selected transmitter record
    3. Satellite-specific configuration (gr-satellites database via SatelliteConfigService)
    4. Transmitter metadata detection (SatNOGS DB description/mode fields)
    5. Smart defaults (based on decoder type and baudrate)
    6. Fallback defaults (conservative values that work for most cases)

    Usage:
        config_service = DecoderConfigService()
        config = config_service.get_config(
            decoder_type='fsk',  # or 'gmsk', 'gfsk'
            satellite={'norad_id': 12345, 'name': 'MySat-1'},
            transmitter={'baud': 9600, 'deviation': 5000, 'description': 'FSK G3RUH'},
            overrides={'framing': 'ax25'}  # Optional manual overrides
        )
        # Pass config to decoder
        decoder = FSKDecoder(..., config=config, modulation_subtype="FSK")
    """

    def __init__(self):
        self.logger = logging.getLogger("decoderconfigservice")
        self.satconfig_service = SatelliteConfigService()

    def get_config(
        self,
        decoder_type: str,
        satellite: Optional[Dict] = None,
        transmitter: Optional[Dict] = None,
        overrides: Optional[Dict] = None,
    ) -> DecoderConfig:
        """
        Resolve decoder configuration from multiple sources.

        Args:
            decoder_type: Decoder type ('gmsk', 'bpsk', 'aprs', 'gfsk', 'fsk', 'geoscanimage', 'gnss')
            satellite: Satellite dict with 'norad_id', 'name', etc.
            transmitter: Transmitter dict with 'baud', 'deviation', 'mode', 'description', etc.
            overrides: Manual parameter overrides (highest priority)
        Returns:
            DecoderConfig: Resolved configuration with all parameters determined

        Examples:
            # Satellite with gr-satellites config
            config = service.get_config('gmsk', satellite={'norad_id': 99999}, transmitter={...})
            # Result: Uses satellite-specific config from gr-satellites DB

            # Unknown satellite with metadata
            config = service.get_config('gmsk', transmitter={'description': 'GMSK USP'})
            # Result: Detects USP framing from description, uses smart defaults

            # Manual configuration
            config = service.get_config('gmsk', overrides={'baudrate': 9600, 'framing': 'ax25'})
            # Result: Uses manual overrides with fallback defaults
        """
        satellite = satellite or {}
        transmitter = transmitter or {}
        overrides = overrides or {}

        if decoder_type == "radiosonde":
            # Sonde framing and symbol rate are fixed by the selected protocol;
            # satellite metadata must not turn this into an AX.25 receiver.
            rate = overrides.get("radiosonde_sample_rate", 48000)
            if type(rate) is not int or rate not in (48000, 96000):
                raise ValueError("Radiosonde sample rate must be 48000 or 96000")
            family = overrides.get("radiosonde_type", "auto")
            if not isinstance(family, str) or family not in ("auto", "rs41", "dfm", "m10m20"):
                raise ValueError("Radiosonde type must be auto, rs41, dfm or m10m20")
            return DecoderConfig(
                baudrate={"auto": 0, "rs41": 4800, "dfm": 2500, "m10m20": 9600}[family],
                framing=family,
                radiosonde_type=family,
                config_source="manual" if overrides else "radiosonde_defaults",
                radiosonde_sample_rate=rate,
                satellite=satellite or None,
                transmitter=transmitter or None,
            )

        if decoder_type == "lora":
            detected = lora_metadata(transmitter)
            params = normalize_lora({**detected, **overrides})
            return DecoderConfig(
                baudrate=0,
                framing="lora",
                config_source=(
                    "manual"
                    if overrides
                    else ("transmitter_metadata" if detected else "smart_default")
                ),
                satellite=satellite or None,
                transmitter=transmitter or None,
                **params,
            )

        # GNSS-SDR configuration is intentionally explicit and does not rely on
        # satellite framing/metadata detection used by packet decoders.
        if decoder_type == "gnss":
            mode = transmitter.get("mode", "")
            description = transmitter.get("description", "")

            config = DecoderConfig(
                baudrate=0,
                framing="gnss",
                config_source="transmitter_metadata" if (mode or description) else "smart_default",
                gnss_sample_rate=4_000_000,
                gnss_total_channels=24,
                gnss_output_rate_ms=500,
                gnss_doppler_max=6000,
                gnss_enable_gps=True,
                gnss_enable_galileo=False,
                gnss_enable_glonass=False,
                gnss_enable_beidou=False,
                gnss_enable_qzss=False,
            )

            if overrides:
                config = self._apply_overrides(config, overrides)

            config.satellite = satellite if satellite else None
            config.transmitter = transmitter if transmitter else None
            return config

        # Alferov/Geoscan image traffic is deliberately configured without
        # SatNOGS/gr-satellites inference.  Those data sources have previously
        # described this downlink inconsistently; only the user's parameters
        # control this isolated receiver.
        if decoder_type == "geoscanimage":
            config = DecoderConfig(
                baudrate=9600,
                deviation=5000,
                framing=FramingType.GEOSCAN,
                config_source="geoscan_image_defaults",
                framing_params={
                    "frame_size": 74,
                    "syncword_threshold": 4,
                    "satellite_id": 9,
                },
            )
            if overrides:
                config = self._apply_overrides(config, overrides)
            try:
                config.baudrate = max(1, int(config.baudrate))
            except (TypeError, ValueError):
                config.baudrate = 9600
            try:
                config.deviation = (
                    max(1, int(config.deviation)) if config.deviation is not None else 5000
                )
            except (TypeError, ValueError):
                config.deviation = 5000
            params = config.framing_params or {}
            try:
                frame_size = max(16, min(512, int(params.get("frame_size", 74))))
            except (TypeError, ValueError):
                frame_size = 74
            try:
                syncword_threshold = max(0, min(32, int(params.get("syncword_threshold", 4))))
            except (TypeError, ValueError):
                syncword_threshold = 4
            try:
                satellite_id = max(0, min(255, int(params.get("satellite_id", 9))))
            except (TypeError, ValueError):
                satellite_id = 9
            config.framing_params = {
                "frame_size": frame_size,
                "syncword_threshold": syncword_threshold,
                "satellite_id": satellite_id,
            }
            config.framing = FramingType.GEOSCAN
            config.satellite = satellite if satellite else None
            config.transmitter = transmitter if transmitter else None
            return config

        norad_id = satellite.get("norad_id")
        baudrate = self._resolve_baudrate(transmitter, overrides)
        # APRS is a dedicated Bell 202 decoder. Missing or malformed SatNOGS
        # baud metadata must not inherit the generic 9600-baud fallback.
        if decoder_type == "aprs" and "baudrate" not in overrides:
            try:
                baudrate = int(transmitter.get("baud") or 1200)
            except (TypeError, ValueError):
                baudrate = 1200
            if baudrate <= 0:
                baudrate = 1200
        downlink_freq = transmitter.get("downlink_low")

        # Try satellite-specific configuration first (highest priority after overrides)
        if norad_id and self.satconfig_service and not overrides:
            try:
                sat_params = self.satconfig_service.get_decoder_parameters(
                    norad_id=norad_id,
                    baudrate=baudrate,
                    frequency=downlink_freq,
                )
                self.logger.info(
                    f"Loaded satellite config for NORAD {norad_id}: {sat_params['source']}"
                )
                return self._build_config_from_satellite(
                    decoder_type, sat_params, satellite, transmitter, baudrate
                )
            except Exception as e:
                self.logger.warning(f"Failed to load satellite config for NORAD {norad_id}: {e}")
                self.logger.info("Falling back to metadata detection")

        # Detect from transmitter metadata (second priority)
        detected_config = self._detect_from_metadata(decoder_type, transmitter, baudrate)

        # Apply manual overrides (highest priority)
        if overrides:
            detected_config = self._apply_overrides(detected_config, overrides)

        if decoder_type == "aprs":
            # A dedicated APRS decoder never enables the G3RUH descrambler,
            # even if generic satellite metadata calls the framing AX.25.
            detected_config.framing = FramingType.APRS

        # Populate satellite and transmitter metadata as complete dicts
        detected_config.satellite = satellite if satellite else None
        detected_config.transmitter = transmitter if transmitter else None

        self.logger.debug(f"Resolved {decoder_type.upper()} config: {detected_config.to_dict()}")
        return detected_config

    def _resolve_baudrate(self, transmitter: Dict, overrides: Dict) -> int:
        """Extract baudrate from transmitter or overrides"""
        if "baudrate" in overrides:
            baudrate = overrides["baudrate"]
            if isinstance(baudrate, int):
                return baudrate
            try:
                return int(baudrate)
            except (ValueError, TypeError):
                self.logger.warning(f"Invalid baudrate in overrides: {baudrate}, using default")
                return self._get_default_baudrate(transmitter.get("mode", ""))

        baud = transmitter.get("baud")
        if baud is not None:
            # Handle invalid baud values (like "-", empty string, etc.)
            if isinstance(baud, int):
                return baud
            try:
                return int(baud)
            except (ValueError, TypeError):
                self.logger.warning(f"Invalid baud value in transmitter: '{baud}', using default")
                return self._get_default_baudrate(transmitter.get("mode", ""))

        return self._get_default_baudrate(transmitter.get("mode", ""))

    def _get_default_baudrate(self, mode: str) -> int:
        """Get default baudrate based on mode"""
        mode_upper = mode.upper()

        # Weather satellite modes (baudrate not typically used)
        if any(m in mode_upper for m in ["APT", "LRPT", "HRPT", "HRIT", "LRIT", "GGAK", "GMDSS"]):
            return 0  # Weather modes don't use traditional baudrate

        # Digital packet modes
        if "AFSK" in mode_upper:
            return 1200  # APRS default
        elif "GNSS" in mode_upper:
            return 0  # GNSS-SDR path does not use baudrate
        elif "BPSK" in mode_upper or "GMSK" in mode_upper or "GFSK" in mode_upper:
            return 9600  # Common for digital modes

        return 9600  # Generic fallback

    def _build_config_from_satellite(
        self, decoder_type: str, sat_params: Dict, satellite: Dict, transmitter: Dict, baudrate: int
    ) -> DecoderConfig:
        """Build configuration from satellite-specific parameters"""
        # If source is NOT satellite_config, satellite was not found in gr-satellites
        # In that case, detect framing from transmitter metadata instead of using default
        if sat_params.get("source") != "satellite_config":
            mode = transmitter.get("mode", "")
            description = transmitter.get("description", "")
            framing = self._detect_framing(mode, description)
            # Detect deviation from transmitter metadata
            deviation = self._detect_deviation(decoder_type, transmitter, baudrate)
            self.logger.info(
                f"Satellite not in gr-satellites: using transmitter metadata "
                f"(framing='{framing}', deviation={deviation})"
            )
            # Use transmitter_metadata as source since we're detecting from transmitter
            config_source = "transmitter_metadata" if (mode or description) else "smart_default"
        else:
            # Use framing and deviation from gr-satellites database
            framing = (
                FramingType.APRS
                if decoder_type == "aprs"
                else sat_params.get("framing", FramingType.AX25)
            )
            deviation = sat_params.get("deviation")
            config_source = "satellite_config"

        # A saved transmitter definition is more specific than satellite-wide
        # metadata, which may describe a different downlink on the same craft.
        stored_framing = str(transmitter.get("framing") or "").strip().lower()
        if decoder_type in {"fsk", "gmsk", "gfsk"} and stored_framing in FSK_DECODER_FRAMINGS:
            framing = stored_framing
            config_source = "transmitter_metadata"
        if (
            decoder_type in {"fsk", "gmsk", "gfsk", "aprs"}
            and transmitter.get("deviation") is not None
        ):
            deviation = self._detect_deviation(decoder_type, transmitter, baudrate)
            config_source = "transmitter_metadata"

        if decoder_type == "aprs":
            framing = FramingType.APRS

        config = DecoderConfig(
            baudrate=baudrate,
            framing=framing,
            config_source=config_source,
            deviation=deviation,
            differential=sat_params.get("differential", False),
        )

        # Framing-specific parameters
        config.framing_params = {}
        if framing == FramingType.GEOSCAN:
            # Prefer explicit YAML frame size if present; default to 66 otherwise
            frame_size = sat_params.get("frame_size")
            if frame_size is None:
                frame_size = 66
            config.framing_params["frame_size"] = frame_size

        # Add decoder-specific parameters
        if decoder_type == "aprs":
            config.af_carrier = int(
                transmitter.get("af_carrier") or sat_params.get("af_carrier") or 1700
            )

        # Populate satellite and transmitter metadata as complete dicts
        config.satellite = satellite if satellite else None
        config.transmitter = transmitter if transmitter else None

        return config

    def _detect_from_metadata(
        self, decoder_type: str, transmitter: Dict, baudrate: int
    ) -> DecoderConfig:
        """Detect configuration from transmitter metadata (mode, description fields)"""
        mode = str(transmitter.get("mode") or "").upper()
        description = str(transmitter.get("description") or "").upper()

        # Detect framing protocol
        framing = (
            FramingType.APRS if decoder_type == "aprs" else self._detect_framing(mode, description)
        )
        stored_framing = str(transmitter.get("framing") or "").strip().lower()
        if decoder_type in {"fsk", "gmsk", "gfsk"} and stored_framing in FSK_DECODER_FRAMINGS:
            framing = stored_framing

        # Detect deviation (FSK modes)
        deviation = self._detect_deviation(decoder_type, transmitter, baudrate)

        # Detect differential mode (BPSK)
        differential = "DBPSK" in mode or "DBPSK" in description

        config = DecoderConfig(
            baudrate=baudrate,
            framing=framing,
            config_source=(
                "transmitter_metadata"
                if (
                    mode
                    or description
                    or stored_framing
                    or transmitter.get("deviation") is not None
                )
                else "smart_default"
            ),
            deviation=deviation,
            differential=differential,
        )

        # Default framing params for certain framings when detected from metadata
        config.framing_params = {}
        if framing == FramingType.GEOSCAN:
            # Default GEOSCAN frame size if unknown
            config.framing_params["frame_size"] = 66

        # Add decoder-specific parameters
        if decoder_type == "aprs":
            config.af_carrier = self._detect_af_carrier(description, baudrate)

        return config

    def _detect_framing(self, mode: str, description: str) -> str:
        """
        Detect framing protocol from mode and description fields.

        Priority: Description field first (more detailed), then mode field.
        """
        # Convert to uppercase for case-insensitive matching
        mode_upper = mode.upper()
        description_upper = description.upper()

        # Check description first (more reliable)
        if "GEOSCAN" in description_upper:
            return str(FramingType.GEOSCAN)
        elif "USP" in description_upper:
            return str(FramingType.USP)
        elif "DOKA" in description_upper or "CCSDS" in description_upper:
            return str(FramingType.DOKA)
        elif "G3RUH" in description_upper:
            return str(FramingType.AX25)
        elif "AX.25" in description_upper or "AX25" in description_upper:
            return str(FramingType.AX25)

        # Check mode field
        if "GEOSCAN" in mode_upper:
            return str(FramingType.GEOSCAN)
        elif "USP" in mode_upper:
            return str(FramingType.USP)
        elif "DOKA" in mode_upper:
            return str(FramingType.DOKA)
        elif "AX.25" in mode_upper or "AX25" in mode_upper:
            return str(FramingType.AX25)

        # Default to AX.25 (most common for amateur satellites)
        return str(FramingType.AX25)

    def _detect_deviation(
        self, decoder_type: str, transmitter: Dict, baudrate: int
    ) -> Optional[float]:
        """Detect frequency deviation for FSK modes"""
        # Explicit deviation in transmitter dict (highest priority)
        if "deviation" in transmitter:
            deviation = transmitter["deviation"]
            if deviation is not None:
                return float(deviation)
            return None

        # Smart defaults based on decoder type and baudrate
        if decoder_type == "aprs":
            return 500
        elif decoder_type in ["fsk", "gmsk", "gfsk"]:
            # FSK-family decoders REQUIRE deviation (cannot be None)
            # Return smart defaults based on baudrate
            if baudrate <= 1200:
                return 600  # Low baudrate: narrow deviation
            elif baudrate <= 2400:
                return 1200  # 2400 baud
            elif baudrate <= 4800:
                return 2400  # 4800 baud
            elif baudrate <= 9600:
                return 5000  # 9600 baud (most common)
            else:
                return int(baudrate * 0.5)  # High baudrate: ~50% of baudrate
        elif decoder_type == "bpsk":
            return None  # BPSK doesn't use deviation

        return None

    def _detect_af_carrier(self, description: str, baudrate: int) -> int:
        """Detect the Bell 202 audio carrier used inside the FM signal."""
        return 1700

    def _apply_overrides(self, config: DecoderConfig, overrides: Dict) -> DecoderConfig:
        """Apply manual overrides to configuration"""
        if "baudrate" in overrides:
            config.baudrate = overrides["baudrate"]
        if "framing" in overrides:
            config.framing = overrides["framing"]
        if "deviation" in overrides:
            config.deviation = overrides["deviation"]
        if "af_carrier" in overrides:
            config.af_carrier = overrides["af_carrier"]
        if "differential" in overrides:
            config.differential = overrides["differential"]

        if "sstv_mode" in overrides:
            config.sstv_mode = str(overrides["sstv_mode"] or "auto").strip().lower()

        # LoRa-specific overrides
        if "sf" in overrides:
            config.sf = overrides["sf"]
        if "bw" in overrides:
            config.bw = overrides["bw"]
        if "cr" in overrides:
            config.cr = overrides["cr"]
        if "sync_word" in overrides:
            config.sync_word = overrides["sync_word"]
        if "preamble_len" in overrides:
            config.preamble_len = overrides["preamble_len"]
        if "fldro" in overrides:
            config.fldro = overrides["fldro"]

        # GNSS-specific overrides
        if "gnss_sample_rate" in overrides:
            config.gnss_sample_rate = overrides["gnss_sample_rate"]
        if "gnss_total_channels" in overrides:
            config.gnss_total_channels = overrides["gnss_total_channels"]
        if "gnss_output_rate_ms" in overrides:
            config.gnss_output_rate_ms = overrides["gnss_output_rate_ms"]
        if "gnss_doppler_max" in overrides:
            config.gnss_doppler_max = overrides["gnss_doppler_max"]
        if "gnss_enable_gps" in overrides:
            config.gnss_enable_gps = overrides["gnss_enable_gps"]
        if "gnss_enable_galileo" in overrides:
            config.gnss_enable_galileo = overrides["gnss_enable_galileo"]
        if "gnss_enable_glonass" in overrides:
            config.gnss_enable_glonass = overrides["gnss_enable_glonass"]
        if "gnss_enable_beidou" in overrides:
            config.gnss_enable_beidou = overrides["gnss_enable_beidou"]
        if "gnss_enable_qzss" in overrides:
            config.gnss_enable_qzss = overrides["gnss_enable_qzss"]

        # Framing-specific overrides
        if "framing_params" in overrides and isinstance(overrides["framing_params"], dict):
            # Merge with existing
            if not config.framing_params:
                config.framing_params = {}
            config.framing_params.update(overrides["framing_params"])

        config.config_source = "manual"
        return config


# Singleton instance for convenience
decoder_config_service = DecoderConfigService()
