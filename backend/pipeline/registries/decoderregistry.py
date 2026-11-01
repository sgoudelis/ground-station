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
from dataclasses import dataclass
from typing import Dict, List, Optional, Type

from demodulators.adsbdecoder import AdsbDecoder

logger = logging.getLogger("decoder-registry")
unavailable_decoder_reasons: Dict[str, str] = {}

# Import decoder classes
try:
    from demodulators.aprsdecoder import APRSDecoder
except Exception as error:
    logger.warning("APRS decoder is unavailable: %s", error)
    unavailable_decoder_reasons["aprs"] = f"{type(error).__name__}: {error}"
    APRSDecoder = None

try:
    from demodulators.bpskdecoder import BPSKDecoder
except Exception as error:
    logger.warning("BPSK decoder is unavailable: %s", error)
    unavailable_decoder_reasons["bpsk"] = f"{type(error).__name__}: {error}"
    BPSKDecoder = None

try:
    from demodulators.fskdecoder import FSKDecoder
except Exception as error:
    logger.warning("FSK decoder is unavailable: %s", error)
    unavailable_decoder_reasons["fsk"] = f"{type(error).__name__}: {error}"
    FSKDecoder = None

try:
    from demodulators.gfskdecoder import GFSKDecoder
except Exception as error:
    logger.warning("GFSK decoder is unavailable: %s", error)
    unavailable_decoder_reasons["gfsk"] = f"{type(error).__name__}: {error}"
    GFSKDecoder = None

try:
    from demodulators.gmskdecoder import GMSKDecoder
except Exception as error:
    logger.warning("GMSK decoder is unavailable: %s", error)
    unavailable_decoder_reasons["gmsk"] = f"{type(error).__name__}: {error}"
    GMSKDecoder = None

try:
    from demodulators.morsedecoder import MorseDecoder
except Exception as error:
    logger.warning("Morse decoder is unavailable: %s", error)
    unavailable_decoder_reasons["morse"] = f"{type(error).__name__}: {error}"
    MorseDecoder = None

try:
    from demodulators.sstvdecoder import SSTVDecoder
except Exception as error:
    logger.warning("SSTV decoder is unavailable: %s", error)
    unavailable_decoder_reasons["sstv"] = f"{type(error).__name__}: {error}"
    SSTVDecoder = None

try:
    from demodulators.geoscanimage import GeoscanImageDecoder
except Exception as error:
    logger.warning("Geoscan image decoder is unavailable: %s", error)
    unavailable_decoder_reasons["geoscanimage"] = f"{type(error).__name__}: {error}"
    GeoscanImageDecoder = None

try:
    from demodulators.gnsssdrdecoder import GNSSSdrDecoder
except Exception as error:
    logger.warning("GNSS decoder is unavailable: %s", error)
    unavailable_decoder_reasons["gnss"] = f"{type(error).__name__}: {error}"
    GNSSSdrDecoder = None


RadiosondeDecoder: Optional[Type] = None
try:
    from demodulators.radiosondedecoder import RadiosondeDecoder as _RadiosondeDecoder

    RadiosondeDecoder = _RadiosondeDecoder
except Exception as error:
    logger.warning("Radiosonde decoder is unavailable: %s", error)
    unavailable_decoder_reasons["radiosonde"] = f"{type(error).__name__}: {error}"
    RadiosondeDecoder = None


LoRaDecoder: Optional[Type] = None
try:
    from demodulators.loradecoder import LoRaDecoder as _LoRaDecoder

    LoRaDecoder = _LoRaDecoder
except Exception as error:
    logger.warning("LoRa decoder is unavailable: %s", error)
    unavailable_decoder_reasons["lora"] = f"{type(error).__name__}: {error}"
    LoRaDecoder = None


@dataclass
class DecoderCapabilities:
    """Capabilities and requirements for a decoder"""

    name: str
    decoder_class: Type
    needs_raw_iq: bool  # True = subscribes directly to IQ broadcaster, False = needs audio
    required_demodulator: Optional[str]  # Name of demodulator needed (None if needs_raw_iq=True)
    demodulator_mode: Optional[str]  # Specific mode for demodulator (e.g., "cw" for Morse)
    default_bandwidth: int  # Default bandwidth in Hz
    supports_transmitter_config: bool  # True = can use locked transmitter settings
    restart_on_params: List[
        str
    ]  # List of DecoderConfig parameter names that trigger decoder restart
    description: str

    @property
    def needs_internal_demod(self) -> bool:
        """Check if decoder needs an internal demodulator"""
        return not self.needs_raw_iq and self.required_demodulator is not None


class DecoderRegistry:
    """
    Singleton registry for protocol decoders.

    This centralizes all decoder requirements and capabilities,
    making it easy to add new decoders and maintain consistency.

    Decoders convert IQ or audio samples to decoded data (images, packets, text).
    """

    _instance: Optional["DecoderRegistry"] = None
    _initialized: bool = False

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        if self._initialized:
            return

        # Define capabilities for each decoder (only when class imports succeeded)
        self._decoders = {}

        self._decoders["adsb"] = DecoderCapabilities(
            name="adsb",
            decoder_class=AdsbDecoder,
            needs_raw_iq=True,
            required_demodulator=None,
            demodulator_mode=None,
            default_bandwidth=2000000,
            supports_transmitter_config=False,
            restart_on_params=["adsb_save_interval", "adsb_capture_messages"],
            description="Manual 1090 MHz ADS-B receiver through readsb",
        )

        if RadiosondeDecoder is not None:
            self._decoders["radiosonde"] = DecoderCapabilities(
                name="radiosonde",
                decoder_class=RadiosondeDecoder,
                needs_raw_iq=True,
                required_demodulator=None,
                demodulator_mode=None,
                default_bandwidth=20000,
                supports_transmitter_config=False,
                restart_on_params=[
                    "radiosonde_type",
                    "radiosonde_sample_rate",
                    "radiosonde_save_interval",
                ],
                description="Automatic RS41, DFM and M10/M20 telemetry from VFO-centered IQ (RS)",
            )

        if LoRaDecoder is not None:
            self._decoders["lora"] = DecoderCapabilities(
                name="lora",
                decoder_class=LoRaDecoder,
                needs_raw_iq=True,
                required_demodulator=None,
                demodulator_mode=None,
                default_bandwidth=125000,
                supports_transmitter_config=True,
                restart_on_params=[
                    "sf",
                    "bw",
                    "cr",
                    "sync_word",
                    "preamble_len",
                    "fldro",
                    "ldro_mode",
                    "implicit_header",
                    "payload_length",
                    "has_crc",
                    "invert_iq",
                ],
                description="Streaming LoRa PHY receiver (TinyGS-compatible settings)",
            )

        if APRSDecoder is not None:
            self._decoders["aprs"] = DecoderCapabilities(
                name="aprs",
                decoder_class=APRSDecoder,
                needs_raw_iq=True,
                required_demodulator=None,
                demodulator_mode=None,
                default_bandwidth=12500,
                supports_transmitter_config=True,
                restart_on_params=["baudrate", "af_carrier", "deviation", "framing"],
                description="APRS Bell 202 decoder with integrated FM demodulation from raw IQ",
            )

        if SSTVDecoder is not None:
            self._decoders["sstv"] = DecoderCapabilities(
                name="sstv",
                decoder_class=SSTVDecoder,
                needs_raw_iq=True,  # Receives IQ directly (integrated FM demod)
                required_demodulator=None,  # Has integrated FM demodulator
                demodulator_mode=None,
                default_bandwidth=12500,  # 12.5 kHz for SSTV
                supports_transmitter_config=True,  # SSTV now accepts satellite/transmitter metadata
                restart_on_params=["sstv_mode"],
                description="Slow-scan television image decoder (process-based with integrated FM demod)",
            )

        if GeoscanImageDecoder is not None:
            self._decoders["geoscanimage"] = DecoderCapabilities(
                name="geoscanimage",
                decoder_class=GeoscanImageDecoder,
                needs_raw_iq=True,
                required_demodulator=None,
                demodulator_mode=None,
                default_bandwidth=20_000,
                # Its PHY/framing parameters are explicit user choices.  A
                # transmitter may select a frequency, never a receiver profile.
                supports_transmitter_config=False,
                restart_on_params=["baudrate", "deviation", "framing_params"],
                description="Geoscan/Alferov JPEG image decoder over raw-IQ FSK",
            )

        if MorseDecoder is not None:
            self._decoders["morse"] = DecoderCapabilities(
                name="morse",
                decoder_class=MorseDecoder,
                needs_raw_iq=False,
                required_demodulator="ssb",  # Needs internal SSB demodulator
                demodulator_mode="cw",  # CW mode specifically
                default_bandwidth=2500,  # 2.5 kHz for CW
                supports_transmitter_config=False,
                restart_on_params=[],  # TODO: Add Morse-specific parameters
                description="Morse code (CW) decoder",
            )

        if FSKDecoder is not None:
            self._decoders["fsk"] = DecoderCapabilities(
                name="fsk",
                decoder_class=FSKDecoder,
                needs_raw_iq=True,  # Works on raw IQ samples
                required_demodulator=None,  # No demodulator needed
                demodulator_mode=None,
                default_bandwidth=20000,  # 20 kHz typical
                supports_transmitter_config=True,
                restart_on_params=["baudrate", "deviation", "framing", "framing_params"],
                description="Frequency Shift Keying decoder (FSK/GFSK/GMSK)",
            )

        if GMSKDecoder is not None:
            self._decoders["gmsk"] = DecoderCapabilities(
                name="gmsk",
                decoder_class=GMSKDecoder,  # Alias to FSKDecoder
                needs_raw_iq=True,  # Works on raw IQ samples
                required_demodulator=None,  # No demodulator needed
                demodulator_mode=None,
                default_bandwidth=20000,  # 20 kHz typical
                supports_transmitter_config=True,
                restart_on_params=["baudrate", "deviation", "framing", "framing_params"],
                description="Gaussian Minimum Shift Keying decoder (alias to FSK)",
            )

        if GFSKDecoder is not None:
            self._decoders["gfsk"] = DecoderCapabilities(
                name="gfsk",
                decoder_class=GFSKDecoder,  # Extends FSKDecoder with modulation_subtype="GFSK"
                needs_raw_iq=True,  # Works on raw IQ samples
                required_demodulator=None,  # No demodulator needed
                demodulator_mode=None,
                default_bandwidth=20000,  # 20 kHz typical
                supports_transmitter_config=True,
                restart_on_params=["baudrate", "deviation", "framing", "framing_params"],
                description="Gaussian Frequency Shift Keying decoder",
            )

        if BPSKDecoder is not None:
            self._decoders["bpsk"] = DecoderCapabilities(
                name="bpsk",
                decoder_class=BPSKDecoder,
                needs_raw_iq=True,  # Works on raw IQ samples
                required_demodulator=None,  # No demodulator needed
                demodulator_mode=None,
                default_bandwidth=20000,  # 20 kHz typical
                supports_transmitter_config=True,
                restart_on_params=["baudrate", "differential", "framing", "framing_params"],
                description="Binary Phase Shift Keying decoder",
            )

        if GNSSSdrDecoder is not None:
            self._decoders["gnss"] = DecoderCapabilities(
                name="gnss",
                decoder_class=GNSSSdrDecoder,
                needs_raw_iq=True,  # Works on raw IQ samples
                required_demodulator=None,  # No demodulator needed
                demodulator_mode=None,
                default_bandwidth=2_000_000,  # Typical wide L1 capture window
                supports_transmitter_config=True,
                restart_on_params=[
                    "gnss_sample_rate",
                    "gnss_total_channels",
                    "gnss_output_rate_ms",
                    "gnss_doppler_max",
                    "gnss_enable_gps",
                    "gnss_enable_galileo",
                    "gnss_enable_glonass",
                    "gnss_enable_beidou",
                    "gnss_enable_qzss",
                ],
                description="GNSS-SDR based multi-constellation L1 decoder",
            )

        self._initialized = True

    def get_capabilities(self, decoder_name: str) -> Optional[DecoderCapabilities]:
        """Get capabilities for a decoder by name"""
        return self._decoders.get(decoder_name)

    def get_decoder_class(self, decoder_name: str) -> Optional[Type]:
        """Get decoder class by name"""
        caps = self.get_capabilities(decoder_name)
        return caps.decoder_class if caps else None

    def get_unavailable_reason(self, decoder_name: str) -> Optional[str]:
        """Return the recorded module-import error for an unavailable decoder."""
        return unavailable_decoder_reasons.get(decoder_name)

    def is_raw_iq_decoder(self, decoder_name: str) -> bool:
        """Check if decoder works on raw IQ samples"""
        caps = self.get_capabilities(decoder_name)
        return caps.needs_raw_iq if caps else False

    def needs_internal_demod(self, decoder_name: str) -> bool:
        """Check if decoder needs an internal demodulator"""
        caps = self.get_capabilities(decoder_name)
        return caps.needs_internal_demod if caps else False

    def get_required_demodulator(self, decoder_name: str) -> Optional[str]:
        """Get the required demodulator name for this decoder"""
        caps = self.get_capabilities(decoder_name)
        return caps.required_demodulator if caps else None

    def get_demodulator_mode(self, decoder_name: str) -> Optional[str]:
        """Get the required demodulator mode for this decoder"""
        caps = self.get_capabilities(decoder_name)
        return caps.demodulator_mode if caps else None

    def supports_transmitter_config(self, decoder_name: str) -> bool:
        """Check if decoder supports transmitter configuration"""
        caps = self.get_capabilities(decoder_name)
        return caps.supports_transmitter_config if caps else False

    def list_decoders(self) -> List[str]:
        """List all available decoder names"""
        return list(self._decoders.keys())

    def get_raw_iq_decoder_names(self) -> set:
        """Get set of decoder names that work on raw IQ"""
        return {name for name, caps in self._decoders.items() if caps.needs_raw_iq}

    def exists(self, decoder_name: str) -> bool:
        """Check if a decoder exists in the registry"""
        return decoder_name in self._decoders

    def get_restart_params(self, decoder_name: str) -> List[str]:
        """Get list of parameter names that trigger decoder restart"""
        caps = self.get_capabilities(decoder_name)
        return caps.restart_on_params if caps else []


# Singleton instance
decoder_registry = DecoderRegistry()
