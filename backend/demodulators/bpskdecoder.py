# Ground Station - BPSK Decoder using GNU Radio
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
# BPSK decoder implementation based on gr-satellites by Daniel Estevez
# https://github.com/daniestevez/gr-satellites
# Copyright 2019 Daniel Estevez <daniel@destevez.net>
# SPDX-License-Identifier: GPL-3.0-or-later
#
# This decoder receives raw IQ samples directly from the SDR process (via iq_queue)
# and demodulates BPSK signals with AX.25 or DOKA (CCSDS) framing.
#
# ARCHITECTURE NOTES (2025-11-19):
# ================================
# 1. SIGNAL-CENTERED FREQUENCY TRANSLATION (CRITICAL):
#    - MUST translate to the actual signal frequency from transmitter config, NOT VFO center
#    - offset_freq = signal_frequency - sdr_center_frequency
#    - This centers the signal at baseband (0 Hz) regardless of VFO drift
#    - Allows decoding off-center signals in recordings and multiple simultaneous signals
#
# 2. BATCHED PROCESSING WITH FRESH FLOWGRAPHS:
#    - Processes samples in configurable batches (default 10 seconds via batch_interval parameter)
#    - Creates a NEW gr.top_block for each batch to avoid GNU Radio 3.10 reconnection issues
#    - Hierarchical blocks (bpsk_demodulator, ax25_deframer) cannot be reconnected
#    - Aggressive cleanup in finally block prevents shared memory exhaustion
#    - Processing happens outside the lock: samples continue accumulating while batch processes
#    - UI receives "decoding" status for both accumulation and batch processing phases
#
# 3. SIGNAL PROCESSING CHAIN:
#    - Frequency translation (signal to baseband)
#    - Decimation to target sample rate (78125 Hz for 9600 baud)
#    - FLL (Frequency Lock Loop) - 250 Hz bandwidth for tracking residual offset
#    - AGC (Automatic Gain Control)
#    - Symbol sync with matched RRC filter
#    - Costas loop - 100 Hz bandwidth for carrier phase recovery
#    - Binary slicer, NRZI decode, G3RUH descrambler, HDLC deframing
#
# 4. KEY PARAMETERS:
#    - Batch interval: 10 seconds default (configurable, balance between latency and signal lock time)
#    - Batch overlap: 5 seconds (50% overlap to capture signals at batch boundaries)
#    - FLL bandwidth: 75 Hz (handles residual offset after doppler compensation)
#    - Costas bandwidth: 35 Hz (carrier phase tracking)
#    - Sample rate: Automatically calculated based on baudrate (10x oversampling)
#
# 5. FEATURES:
#    - Supports AX.25 (G3RUH) and DOKA (CCSDS) framing
#    - Handles VFO drift and off-center signals in IQ recordings
#    - Extracts and reports AX.25 callsigns to UI
#    - Automatic framing detection from satellite configuration

import argparse
import gc
import logging
import multiprocessing
import os
import queue
import time
import traceback
from enum import Enum
from types import SimpleNamespace
from typing import Any, Dict

import numpy as np
import psutil

# Add setproctitle import for process naming
try:
    import setproctitle

    HAS_SETPROCTITLE = True
except ImportError:
    HAS_SETPROCTITLE = False

# Configure GNU Radio to use mmap-based buffers instead of shmget
# This prevents shared memory segment exhaustion
os.environ.setdefault("GR_BUFFER_TYPE", "vmcirc_mmap_tmpfile")

from gnuradio import blocks, gr  # noqa: E402
from satellites.components.demodulators.bpsk_demodulator import bpsk_demodulator  # noqa: E402
from scipy import signal  # noqa: E402

from constants import FramingType  # noqa: E402
from demodulators.basedecoderprocess import BaseDecoderProcess  # noqa: E402
from demodulators.deframerfactory import create_bpsk_deframer  # noqa: E402
from telemetry.parser import TelemetryParser  # noqa: E402

logger = logging.getLogger("bpskdecoder")

# Global configuration parameters for batch processing
BATCH_INTERVAL_SECONDS = 5.0  # Batch processing interval
BATCH_OVERLAP_SECONDS = 0.5  # Overlap between batches (tail retention)


class DecoderStatus(Enum):
    """Decoder status values."""

    IDLE = "idle"
    LISTENING = "listening"
    DETECTING = "detecting"
    DECODING = "decoding"
    SLEEPING = "sleeping"  # VFO out of SDR bandwidth
    COMPLETED = "completed"
    ERROR = "error"


class BPSKMessageHandler(gr.basic_block):
    """Message handler to receive PDU messages from HDLC/CCSDS deframers

    Notes:
      - We only wrap frames with AX.25 HDLC flags when framing == 'ax25'.
      - For CCSDS/DOKA, we forward raw bytes as-is.
    """

    def __init__(
        self,
        callback,
        logger: logging.Logger | None = None,
        framing: str = FramingType.AX25,
        shm_monitor_interval=10,  # kept for signature parity
        shm_restart_threshold=1000,  # kept for signature parity
    ):
        gr.basic_block.__init__(self, name="bpsk_message_handler", in_sig=None, out_sig=None)
        self.callback = callback
        self.logger = logger or logging.getLogger("bpskdecoder")
        self.framing = framing
        self.message_port_register_in(gr.pmt.intern("in"))
        self.set_msg_handler(gr.pmt.intern("in"), self.handle_msg)
        self.packets_decoded = 0

    def handle_msg(self, msg):
        """Handle incoming PDU messages from deframer (AX.25 or CCSDS)"""
        try:
            # Extract packet data from PDU
            if gr.pmt.is_pair(msg):
                packet_data = gr.pmt.to_python(gr.pmt.cdr(msg))
            else:
                packet_data = gr.pmt.to_python(msg)

            # Convert numpy array to bytes
            if isinstance(packet_data, np.ndarray):
                packet_data = bytes(packet_data)

            if isinstance(packet_data, bytes):
                self.packets_decoded += 1
                callsigns = None

                # AX.25 callsign parsing and HDLC flag wrapping only when AX.25 framing.
                if self.framing == FramingType.AX25:
                    try:
                        if len(packet_data) >= 14:
                            dest_call = "".join(
                                chr((packet_data[i] >> 1) & 0x7F) for i in range(6)
                            ).strip()
                            dest_ssid = (packet_data[6] >> 1) & 0x0F
                            src_call = "".join(
                                chr((packet_data[i] >> 1) & 0x7F) for i in range(7, 13)
                            ).strip()
                            src_ssid = (packet_data[13] >> 1) & 0x0F
                            callsigns = {
                                "from": f"{src_call}-{src_ssid}",
                                "to": f"{dest_call}-{dest_ssid}",
                            }
                    except Exception:
                        # Silent failure on callsign parsing; downstream may still parse
                        pass

                # Output bytes according to framing
                out_bytes = packet_data
                if self.framing == FramingType.AX25:
                    # Add HDLC flags for compatibility with AX.25 parsers
                    out_bytes = bytes([0x7E]) + packet_data + bytes([0x7E])
                if self.callback:
                    self.callback(out_bytes, callsigns)
            else:
                self.logger.warning(f"Unexpected packet data type: {type(packet_data)}")

        except Exception as e:
            self.logger.error(f"Error handling message: {e}")
            traceback.print_exc()


class BPSKFlowgraph(gr.top_block):
    """
    Continuous BPSK flowgraph using gr-satellites components

    Uses tested gr-satellites bpsk_demodulator and ax25_deframer components.
    Runs continuously to maintain stateful blocks (FLL, Costas, clock recovery, etc.)
    """

    def __init__(
        self,
        sample_rate,
        callback,
        status_callback=None,
        baudrate=9600,
        f_offset=0,
        differential=False,
        rrc_alpha=0.35,
        fll_bw=25,
        clk_bw=0.06,
        clk_limit=0.004,
        costas_bw=50,
        packet_size=256,
        batch_interval=5.0,
        framing=FramingType.AX25,  # Framing protocol: 'ax25' or 'doka'
    ):
        """
        Initialize BPSK decoder flowgraph using gr-satellites components

        Args:
            sample_rate: Input sample rate (Hz)
            callback: Function to call when packet is decoded
            status_callback: Function to call for status updates (status, info)
            baudrate: Symbol rate / baud rate (symbols/sec)
            f_offset: Frequency offset in Hz
            differential: Perform non-coherent DBPSK decoding (bool)
            rrc_alpha: RRC roll-off factor
            fll_bw: FLL bandwidth (Hz)
            clk_bw: Clock recovery bandwidth (relative to baudrate)
            clk_limit: Clock recovery limit (relative to baudrate)
            costas_bw: Costas loop bandwidth (Hz)
            packet_size: Size of packet in bytes (unused, kept for compatibility)
            batch_interval: Batch processing interval in seconds (default: 3.0)
            framing: Framing protocol - 'ax25' (G3RUH) or 'doka' (CCSDS)
        """
        super().__init__("BPSK Decoder")

        self.sample_rate = sample_rate
        self.baudrate = baudrate
        self.callback = callback
        self.status_callback = status_callback
        self.differential = differential
        self.batch_interval = batch_interval
        self.framing = framing  # Store framing protocol

        # Accumulate samples in a buffer
        self.sample_buffer = np.array([], dtype=np.complex64)
        self.sample_lock = multiprocessing.Lock()
        self.current_mode = "decoding"  # Track current mode

        # Flow rate tracking
        self.last_batch_time = time.time()
        self.last_batch_samples = 0

        # VFO state tracking for batch logging
        # Store VFO values that correspond to the buffered samples
        self.batch_vfo_center = 0
        self.batch_vfo_bandwidth = 0

    def process_samples(self, samples, vfo_center, vfo_bandwidth):
        """
        Process IQ samples through the flowgraph

        Accumulates samples in a buffer and processes them periodically
        to maintain state continuity while avoiding repeated start/stop cycles.

        Args:
            samples: numpy array of complex64 samples
            vfo_center: VFO center frequency used for DSP processing these samples
            vfo_bandwidth: VFO bandwidth used for DSP processing these samples
        """
        should_process = False
        buffer_size = 0
        with self.sample_lock:
            self.sample_buffer = np.concatenate([self.sample_buffer, samples])
            buffer_size = len(self.sample_buffer)
            # Store the most recent VFO values (these will be logged in batch)
            self.batch_vfo_center = vfo_center
            self.batch_vfo_bandwidth = vfo_bandwidth

            # Process when we have enough samples (batch_interval seconds worth)
            # Balance between decode latency and signal lock time
            min_process_samples = int(self.sample_rate * self.batch_interval)

            if buffer_size >= min_process_samples:
                should_process = True
            elif self.current_mode != "decoding":
                # Transition back to decoding mode (accumulating samples)
                self.current_mode = "decoding"
                if self.status_callback:
                    self.status_callback(DecoderStatus.DECODING, {"buffer_samples": buffer_size})

        # Process outside the lock so incoming samples don't block
        if should_process:
            # Transition to decoding mode (processing batch)
            with self.sample_lock:
                self.current_mode = "decoding"
            if self.status_callback:
                self.status_callback(DecoderStatus.DECODING, {"buffer_samples": buffer_size})

            self._process_buffer()

    def _process_buffer(self):
        """Process accumulated samples through the flowgraph"""
        # Copy buffer outside the lock to allow incoming samples to continue
        with self.sample_lock:
            if len(self.sample_buffer) == 0:
                return
            samples_to_process = self.sample_buffer.copy()
            # Keep a tail for continuity while processing.
            # Increase overlap to reduce chances of dropping frames that straddle batches.
            tail_samples = int(self.sample_rate * BATCH_OVERLAP_SECONDS)
            if len(self.sample_buffer) > tail_samples:
                self.sample_buffer = self.sample_buffer[-tail_samples:]
            else:
                self.sample_buffer = np.array([], dtype=np.complex64)

        # Calculate flow rate (samples per second)
        current_time = time.time()
        time_elapsed = current_time - self.last_batch_time
        samples_count = len(samples_to_process)
        flow_rate_sps = samples_count / time_elapsed if time_elapsed > 0 else 0

        # Update tracking variables for next batch
        self.last_batch_time = current_time
        self.last_batch_samples = samples_count

        tb = None
        try:
            # Create a NEW flowgraph for each batch to avoid connection conflicts
            # This is necessary because hierarchical blocks can't be easily disconnected

            # Create a temporary top_block
            tb = gr.top_block("BPSK Batch Processor")

            # Create vector source with accumulated samples
            source = blocks.vector_source_c(samples_to_process.tolist(), repeat=False)

            # Create fresh instances of demodulator and deframer
            # Optimized for LOW SNR signals (6-7 dB) - balanced bandwidth for lock acquisition
            # 200/80 Hz settings provided best results in testing
            options = argparse.Namespace(
                rrc_alpha=0.35,
                fll_bw=200,  # Balanced FLL bandwidth for low SNR (best tested setting)
                clk_bw=0.08,  # Moderate bandwidth for symbol rate tracking
                clk_limit=0.005,  # Moderate timing deviation tolerance
                costas_bw=80,  # Balanced Costas bandwidth for low SNR (best tested setting)
                f_offset=0,
                disable_fll=False,
                manchester_block_size=32,
                syncword_threshold=4,  # Allow 4 bit errors in syncword (CCSDS default)
            )

            # Create BPSK demodulator
            # The FLL (Frequency Lock Loop) handles any residual frequency offset
            # after our frequency translation, so we set f_offset=0 and let it auto-track
            demod = bpsk_demodulator(
                baudrate=self.baudrate,
                samp_rate=self.sample_rate,
                iq=True,
                f_offset=0,  # Let FLL auto-track with 250 Hz bandwidth
                differential=self.differential,
                manchester=False,
                options=options,
            )

            deframer, frame_info = create_bpsk_deframer(self.framing, options)

            logger.info(
                f"Batch: {len(samples_to_process)} samp ({time_elapsed:.1f}s, {flow_rate_sps/1e3:.1f}kS/s) | "
                f"BPSK: {self.baudrate}bd, {self.sample_rate:.0f}sps, diff={self.differential} | "
                f"Frame: {frame_info} | VFO: {self.batch_vfo_center:.0f}Hz, BW={self.batch_vfo_bandwidth:.0f}Hz"
            )

            # Create message handler for this batch (pass framing and logger)
            msg_handler = BPSKMessageHandler(
                self.callback,
                logger=logging.getLogger("bpskdecoder"),
                framing=self.framing,
            )

            # Build flowgraph
            tb.connect(source, demod, deframer)
            tb.msg_connect((deframer, "out"), (msg_handler, "in"))

            # Run the flowgraph
            tb.start()
            tb.wait()

            # Explicitly stop
            try:
                tb.stop()
            except Exception:
                pass

        except Exception as e:
            logger.error(f"Error processing buffer: {e}")
            traceback.print_exc()
            # Clear buffer on error to avoid repeated failures
            with self.sample_lock:
                self.sample_buffer = np.array([], dtype=np.complex64)
        finally:
            # Explicit cleanup to prevent shared memory leaks
            if "tb" in locals() and tb is not None:
                try:
                    # Ensure flowgraph is stopped
                    tb.stop()
                    tb.wait()
                except Exception:
                    pass

                # Disconnect all blocks
                try:
                    tb.disconnect_all()
                except Exception:
                    pass

                # Delete references to allow garbage collection
                try:
                    del msg_handler
                    del deframer
                    del demod
                    del source
                except Exception:
                    pass

                # Delete the top_block to release resources
                del tb

                # Force garbage collection to clean up GNU Radio objects
                # and release shared memory segments
                gc.collect()

                # Longer delay to allow system to clean up shared memory
                # GNU Radio 3.10+ has issues with rapid flowgraph creation/destruction
                time.sleep(0.1)

    def flush_buffer(self):
        """Process any remaining samples in the buffer"""
        should_process = False
        buffer_size = 0
        with self.sample_lock:
            if len(self.sample_buffer) > 0:
                buffer_size = len(self.sample_buffer)
                should_process = True
        # CRITICAL: Call _process_buffer() OUTSIDE the lock to avoid blocking the entire app.
        # _process_buffer() runs GNU Radio flowgraph synchronously (tb.wait()) and sleeps 100ms,
        # which would freeze all threads trying to acquire sample_lock if called inside the lock.
        if should_process:
            logger.info(f"Flushing {buffer_size} remaining samples from BPSK flowgraph")
            self._process_buffer()

    def _is_doka_signal(self):
        """
        Check if this is a DOKA signal based on framing configuration.

        Returns:
            bool: True if this is a DOKA signal
        """
        return hasattr(self, "framing") and self.framing == FramingType.DOKA

    def _on_packet_decoded(self, payload, callsigns=None):
        """Called when a BPSK packet is successfully decoded"""
        if self.callback:
            self.callback(payload, callsigns)


class BPSKDecoder(BaseDecoderProcess):
    """Real-time BPSK decoder using GNU Radio (multiprocessing-based)

    Runs as a separate process to isolate GNU Radio shared memory segments.
    Monitors SHM usage and signals restart when threshold exceeded.
    """

    def __init__(
        self,
        iq_queue,
        data_queue,
        session_id,
        config,  # Pre-resolved DecoderConfig from DecoderConfigService (contains all params + metadata)
        output_dir="data/decoded",
        vfo=None,
        batch_interval=BATCH_INTERVAL_SECONDS,  # Batch processing interval in seconds
        packet_size=256,  # Optional override for packet size
        shm_monitor_interval=10,  # Check SHM every 60 seconds
        shm_restart_threshold=1000,  # Restart when segments exceed this
    ):
        # Initialize base process (handles multiprocessing setup)
        super().__init__(
            iq_queue=iq_queue,
            data_queue=data_queue,
            session_id=session_id,
            config=config,
            output_dir=output_dir,
            vfo=vfo,
            shm_monitor_interval=shm_monitor_interval,
            shm_restart_threshold=shm_restart_threshold,
        )

        # BPSK-specific attributes
        self.sample_rate = None  # VFO bandwidth sample rate (after decimation)
        self.sdr_sample_rate = None  # Full SDR sample rate
        self.sdr_center_freq = None  # SDR center frequency
        self.decimation_filter = None  # Filter for decimation
        self.batch_interval = batch_interval

        logger.debug(
            f"BPSKDecoder initialized: packet_count=0, SHM threshold={shm_restart_threshold}"
        )

        # Extract all parameters from resolved config (including metadata)
        self.baudrate = config.baudrate
        self.differential = config.differential if config.differential is not None else False
        self.framing = config.framing
        self.config_source = config.config_source
        self.packet_size = config.packet_size or packet_size

        # Extract satellite and transmitter metadata from config
        self.satellite = config.satellite or {}
        self.transmitter = config.transmitter or {}

        # Extract commonly used fields for convenience
        self.norad_id = self.satellite.get("norad_id")
        self.satellite_name = self.satellite.get("name") or "Unknown"
        self.transmitter_description = self.transmitter.get("description") or "Unknown"
        self.transmitter_mode = self.transmitter.get("mode") or "BPSK"
        self.transmitter_downlink_freq = self.transmitter.get("downlink_low")

        # Log debug if downlink frequency not available (not a warning - expected for manual VFO mode)
        if not self.transmitter_downlink_freq:
            logger.debug("Transmitter downlink frequency not available in config (manual VFO mode)")
            logger.debug(f"Config metadata: {config.to_dict()}")

        # Build smart parameter summary - only show non-None optional params
        param_parts = [
            f"{self.baudrate}bd",
            f"{self.framing.upper()}",
        ]

        if self.differential:
            param_parts.append("differential")
        if self.packet_size:
            param_parts.append(f"pkt_sz={self.packet_size}B")

        params_str = ", ".join(param_parts)

        # Build satellite info (compact format)
        sat_info = f"{self.satellite_name}"
        if self.norad_id:
            sat_info += f" (NORAD {self.norad_id})"

        # Build transmitter info (compact format)
        tx_info = f"TX: {self.transmitter_description}"
        if self.transmitter_downlink_freq:
            tx_info += f" @ {self.transmitter_downlink_freq/1e6:.3f}MHz"

        # Single consolidated initialization log with all relevant parameters
        logger.info(
            f"BPSK decoder initialized: session={session_id}, VFO {vfo} | {sat_info} | {tx_info} | {params_str} | "
            f"batch={self.batch_interval}s | src: {self.config_source}"
        )

        os.makedirs(self.output_dir, exist_ok=True)

        # GNU Radio flowgraph (will be initialized when we know sample rate)
        self.flowgraph = None

        # Performance monitoring stats
        self.stats: Dict[str, Any] = {
            "iq_chunks_in": 0,
            "samples_in": 0,
            "data_messages_out": 0,
            "queue_timeouts": 0,
            "packets_decoded": 0,
            "last_activity": None,
            "errors": 0,
            # Ingest-side flow metrics (updated every stats tick)
            "ingest_samples_per_sec": 0.0,
            "ingest_chunks_per_sec": 0.0,
            # Out-of-band accounting
            "samples_dropped_out_of_band": 0,
        }

        # Signal power measurement (from BaseDecoder)
        self.power_measurements = []
        self.max_power_history = 100
        self.current_power_dbfs = None

        # Cached VFO state (populated from IQ messages)
        self.cached_vfo_state = None

        # Track sleeping state to avoid spamming status updates
        self.is_sleeping = False
        self.sleep_reason = None

        # Previous snapshot for 1 Hz rate computation (authoritative at decoder side)
        self._rates_prev_ts = None
        self._rates_prev_counters = {
            "iq_chunks_in": 0,
            "samples_in": 0,
            "data_messages_out": 0,
        }

    def _get_decoder_type_for_init(self) -> str:
        """Return decoder type for process naming."""
        return "BPSK"

    def _get_vfo_state(self):
        """Get cached VFO state for metadata purposes."""
        # Create a simple namespace object from cached dict for backward compatibility
        if self.cached_vfo_state:
            return SimpleNamespace(**self.cached_vfo_state)
        return None

    def _frequency_translate(self, samples, offset_freq, sample_rate):
        """Translate frequency by offset (shift signal in frequency domain)."""
        if offset_freq == 0:
            return samples

        # Generate complex exponential for frequency shift
        t = np.arange(len(samples)) / sample_rate
        shift = np.exp(-2j * np.pi * offset_freq * t)
        return samples * shift

    def _design_decimation_filter(self, decimation_factor, bandwidth, sample_rate):
        """Design low-pass filter for decimation."""
        # Cutoff at bandwidth/2 (Nyquist for target bandwidth)
        cutoff = bandwidth / 2
        # Transition band: 10% of bandwidth
        transition = bandwidth * 0.1
        # Design FIR filter
        numtaps = int(sample_rate / transition) | 1  # Ensure odd
        if numtaps > 1001:  # Limit filter length
            numtaps = 1001
        return signal.firwin(numtaps, cutoff, fs=sample_rate)

    def _decimate_iq(self, samples, decimation_factor):
        """Decimate IQ samples with filtering."""
        if decimation_factor == 1:
            return samples

        # Apply low-pass filter
        filtered = signal.lfilter(self.decimation_filter, 1, samples)
        # Decimate
        return filtered[::decimation_factor]

    def _is_doka_signal(self):
        """
        Check if this is a DOKA signal based on framing configuration.

        Returns:
            bool: True if this is a DOKA signal
        """
        return hasattr(self, "framing") and self.framing == FramingType.DOKA

    def _get_decoder_type(self):
        """Return decoder type string"""
        return "bpsk"

    def _get_decoder_specific_metadata(self):
        """Return BPSK-specific metadata"""
        return {
            "differential": self.differential,
            "packet_size": self.packet_size,
            "batch_interval": self.batch_interval,
        }

    def _get_filename_params(self):
        """Return filename parameters"""
        return f"{self.baudrate}baud"

    def _get_parameters_string(self):
        """Return human-readable parameters string"""
        return f"{self.baudrate}baud"

    def _get_demodulator_params_metadata(self):
        """Return BPSK demodulator parameters"""
        return {
            "fll_bandwidth_hz": 200,
            "costas_bandwidth_hz": 80,
            "rrc_alpha": 0.35,
            "clock_recovery_bandwidth": 0.08,
            "clock_recovery_limit": 0.005,
        }

    def _is_vfo_in_sdr_bandwidth(self, vfo_center, sdr_center, sdr_sample_rate):
        """
        Check if VFO center frequency is within SDR bandwidth (with small edge margin).

        Returns tuple: (is_in_band, offset_from_sdr_center, margin_hz)
        """
        offset = vfo_center - sdr_center
        half_sdr_bandwidth = sdr_sample_rate / 2
        usable_bandwidth = half_sdr_bandwidth * 0.98  # 2% margin for roll-off
        is_in_band = abs(offset) <= usable_bandwidth
        margin_hz = usable_bandwidth - abs(offset)
        return is_in_band, offset, margin_hz

    def _on_flowgraph_status(self, status, info=None):
        """Callback when flowgraph status changes"""
        self._send_status_update(status, info)

    def _send_status_update(self, status, info=None):
        """Send status update to UI"""
        # Build decoder configuration info
        config_info = {
            "baudrate": self.baudrate,
            "differential": self.differential,
            "framing": self.framing,  # Use detected framing protocol directly
            "transmitter": self.transmitter_description,
            "transmitter_mode": self.transmitter_mode,
            "transmitter_downlink_mhz": (
                round(self.transmitter_downlink_freq / 1e6, 3)
                if self.transmitter_downlink_freq
                else None
            ),
        }

        # Add power measurements if available
        config_info.update(self._get_power_statistics())

        # Merge with any additional info passed in
        if info:
            config_info.update(info)

        msg = {
            "type": "decoder-status",
            "status": status.value,
            "decoder_type": self._get_decoder_type(),
            "decoder_id": self.decoder_id,
            "session_id": self.session_id,
            "vfo": self.vfo,
            "timestamp": time.time(),
            "info": config_info,
        }
        try:
            self.data_queue.put(msg, block=False)
            with self.stats_lock:
                self.stats["data_messages_out"] += 1
        except queue.Full:
            logger.warning("Data queue full, dropping status update")

    def _send_stats_update(self):
        """Send statistics update to UI and performance monitor"""
        # Full performance stats for monitoring (thread-safe copy)
        with self.stats_lock:
            perf_stats = self.stats.copy()
            ingest_sps = perf_stats.get("ingest_samples_per_sec", 0.0)
            ingest_cps = perf_stats.get("ingest_chunks_per_sec", 0.0)

        # UI-friendly stats (include ingest rates so UI can display flow even when sleeping)
        ui_stats = {
            "packets_decoded": self.packet_count,
            "baudrate": self.baudrate,
            "is_sleeping": self.is_sleeping,
            "ingest_samples_per_sec": round(ingest_sps, 1),
            "ingest_chunks_per_sec": round(ingest_cps, 2),
            "ingest_kSps": round(ingest_sps / 1e3, 2),
        }
        ui_stats.update(self._get_power_statistics())

        # Add sleeping state to performance stats
        perf_stats["is_sleeping"] = self.is_sleeping

        # Compute authoritative 1 Hz rates at the decoder side (no smoothing)
        now_ts = time.time()
        prev_ts = self._rates_prev_ts
        dt = now_ts - prev_ts if prev_ts is not None else None
        rates = {}
        try:
            curr_iq_chunks = perf_stats.get("iq_chunks_in", 0)
            curr_samples = (
                perf_stats.get("samples_in", 0) or perf_stats.get("iq_samples_in", 0) or 0
            )
            curr_msgs_out = perf_stats.get("data_messages_out", 0)

            if dt and dt > 0:
                rates = {
                    "iq_chunks_in_per_sec": (
                        curr_iq_chunks - self._rates_prev_counters.get("iq_chunks_in", 0)
                    )
                    / dt,
                    "samples_in_per_sec": (
                        curr_samples - self._rates_prev_counters.get("samples_in", 0)
                    )
                    / dt,
                    "data_messages_out_per_sec": (
                        curr_msgs_out - self._rates_prev_counters.get("data_messages_out", 0)
                    )
                    / dt,
                }
            else:
                rates = {
                    "iq_chunks_in_per_sec": 0.0,
                    "samples_in_per_sec": 0.0,
                    "data_messages_out_per_sec": 0.0,
                }
        except Exception:
            # Be conservative in case of unexpected values
            rates = {
                "iq_chunks_in_per_sec": 0.0,
                "samples_in_per_sec": 0.0,
                "data_messages_out_per_sec": 0.0,
            }

        # Mirror rates into perf_stats for persistence/consumers
        perf_stats["rates"] = rates

        # Update previous snapshot for next tick
        self._rates_prev_ts = now_ts
        self._rates_prev_counters = {
            "iq_chunks_in": perf_stats.get("iq_chunks_in", 0),
            "samples_in": perf_stats.get("samples_in", 0)
            or perf_stats.get("iq_samples_in", 0)
            or 0,
            "data_messages_out": perf_stats.get("data_messages_out", 0),
        }

        msg = {
            "type": "decoder-stats",
            "decoder_type": self._get_decoder_type(),
            "session_id": self.session_id,
            "vfo": self.vfo,
            "timestamp": time.time(),
            "stats": ui_stats,  # UI-friendly stats
            "perf_stats": perf_stats,  # Full performance stats for PerformanceMonitor
            "rates": rates,  # Authoritative rates computed at decoder side
        }
        try:
            self.data_queue.put(msg, block=False)
            with self.stats_lock:
                self.stats["data_messages_out"] += 1
        except queue.Full:
            pass

    def run(self):
        """Main thread loop - processes IQ samples continuously"""
        # Set process name for visibility in system monitoring tools
        if HAS_SETPROCTITLE:
            setproctitle.setproctitle(f"Ground Station - BPSK Decoder (VFO {self.vfo})")

        # Initialize components in subprocess (CRITICAL!)
        self.telemetry_parser = TelemetryParser()

        # Initialize stats in subprocess (update existing dict)
        self.stats.update(
            {
                "iq_chunks_in": 0,
                "samples_in": 0,
                "data_messages_out": 0,
                "queue_timeouts": 0,
                "packets_decoded": 0,
                "last_activity": None,
                "errors": 0,
                "cpu_percent": 0.0,
                "memory_mb": 0.0,
                "memory_percent": 0.0,
                # Ingest-side flow metrics (updated every stats tick)
                "ingest_samples_per_sec": 0.0,
                "ingest_chunks_per_sec": 0.0,
                # Out-of-band accounting
                "samples_dropped_out_of_band": 0,
            }
        )

        logger.info(f"BPSK decoder started for {self.session_id}")
        self._send_status_update(DecoderStatus.LISTENING)

        chunks_received = 0
        flowgraph_started = False
        last_stats_time = time.time()  # Track time for periodic stats updates

        # Track ingest rates regardless of decoding state (in-band or out-of-band)
        ingest_window_start = time.time()
        ingest_samples_accum = 0
        ingest_chunks_accum = 0

        # CPU and memory monitoring
        process = psutil.Process()
        last_cpu_check = time.time()
        cpu_check_interval = 0.5  # Update CPU usage every 0.5 seconds

        try:
            while self.running.value == 1:  # Changed from self.running
                # Update CPU and memory usage periodically
                current_time = time.time()
                if current_time - last_cpu_check >= cpu_check_interval:
                    try:
                        cpu_percent = process.cpu_percent()
                        mem_info = process.memory_info()
                        memory_mb = mem_info.rss / (1024 * 1024)
                        memory_percent = process.memory_percent()

                        with self.stats_lock:
                            self.stats["cpu_percent"] = cpu_percent
                            self.stats["memory_mb"] = memory_mb
                            self.stats["memory_percent"] = memory_percent
                        last_cpu_check = current_time
                    except Exception as e:
                        logger.debug(f"Error updating CPU/memory usage: {e}")

                # Per-iteration work; ensure stats tick executes even on `continue`
                try:
                    # Read IQ samples from iq_queue
                    try:
                        iq_message = self.iq_queue.get(timeout=0.2)  # 200ms timeout
                    except queue.Empty:
                        with self.stats_lock:
                            self.stats["queue_timeouts"] += 1
                        iq_message = None

                    if iq_message is None:
                        # nothing to process this iteration
                        pass
                    else:
                        # Update stats
                        with self.stats_lock:
                            self.stats["iq_chunks_in"] += 1
                            self.stats["last_activity"] = time.time()

                        # Extract IQ samples and metadata from message
                        samples = iq_message.get("samples")
                        sdr_center = iq_message.get(
                            "logical_center_freq_hz", iq_message.get("center_freq")
                        )
                        sdr_rate = iq_message.get("sample_rate")

                        if samples is None or len(samples) == 0:
                            continue

                        # Update sample count
                        with self.stats_lock:
                            self.stats["samples_in"] += len(samples)

                        # Update ingest accumulators (count what we pull, even if we skip processing)
                        ingest_samples_accum += len(samples)
                        ingest_chunks_accum += 1

                        # Get VFO parameters from IQ message (added by IQBroadcaster)
                        vfo_states = iq_message.get("vfo_states", {})
                        vfo_state_dict = vfo_states.get(self.vfo)

                        if not vfo_state_dict or not vfo_state_dict.get("active", False):
                            continue  # VFO not active, skip

                        # Cache VFO state for metadata purposes
                        self.cached_vfo_state = vfo_state_dict

                        vfo_center = vfo_state_dict.get("center_freq", 0)
                        vfo_bandwidth = vfo_state_dict.get("bandwidth", 10000)

                        # Validate VFO center is within SDR bandwidth
                        is_in_band, vfo_offset, margin = self._is_vfo_in_sdr_bandwidth(
                            vfo_center, sdr_center, sdr_rate
                        )

                        if not is_in_band:
                            # VFO is outside SDR bandwidth - enter sleeping state
                            with self.stats_lock:
                                self.stats["samples_dropped_out_of_band"] += len(samples)

                            if not self.is_sleeping:
                                self.is_sleeping = True
                                sdr_bw_mhz = sdr_rate / 1e6
                                self.sleep_reason = (
                                    f"VFO out of SDR bandwidth: VFO={vfo_center/1e6:.3f}MHz, "
                                    f"SDR={sdr_center/1e6:.3f}MHz±{sdr_bw_mhz/2:.2f}MHz, "
                                    f"offset={vfo_offset/1e3:.1f}kHz, exceeded by {abs(margin)/1e3:.1f}kHz"
                                )
                                logger.warning(self.sleep_reason)
                                self._send_status_update(
                                    DecoderStatus.SLEEPING,
                                    {
                                        "reason": "vfo_out_of_sdr_bandwidth",
                                        "vfo_center_mhz": round(vfo_center / 1e6, 3),
                                        "sdr_center_mhz": round(sdr_center / 1e6, 3),
                                        "sdr_bandwidth_mhz": round(sdr_rate / 1e6, 2),
                                        "vfo_offset_khz": round(vfo_offset / 1e3, 1),
                                        "exceeded_by_khz": round(abs(margin) / 1e3, 1),
                                        "samples_dropped": self.stats[
                                            "samples_dropped_out_of_band"
                                        ],
                                    },
                                )
                            continue  # Skip processing this chunk

                        # VFO is in band - check if we're waking up from sleep
                        if self.is_sleeping:
                            self.is_sleeping = False
                            logger.info(
                                f"VFO back in SDR bandwidth, resuming decoding: VFO={vfo_center/1e6:.3f}MHz, "
                                f"SDR={sdr_center/1e6:.3f}MHz, offset={vfo_offset/1e3:.1f}kHz"
                            )
                            self._send_status_update(
                                DecoderStatus.DECODING,
                                {
                                    "resumed_from_sleep": True,
                                    "vfo_center_mhz": round(vfo_center / 1e6, 3),
                                    "sdr_center_mhz": round(sdr_center / 1e6, 3),
                                },
                            )

                        # Initialize on first message
                        if self.sdr_sample_rate is None:
                            self.sdr_sample_rate = sdr_rate
                            self.sdr_center_freq = sdr_center

                            # Calculate decimation factor for optimal samples per symbol
                            # Target 8 samples per symbol
                            target_sps = 8
                            target_sample_rate = self.baudrate * target_sps
                            decimation = int(self.sdr_sample_rate / target_sample_rate)
                            if decimation < 1:
                                decimation = 1
                            self.sample_rate = self.sdr_sample_rate / decimation

                            # Design decimation filter
                            self.decimation_filter = self._design_decimation_filter(
                                decimation, vfo_bandwidth, self.sdr_sample_rate
                            )

                            # Calculate offset frequency for logging
                            offset_freq_init = vfo_center - sdr_center

                            # Initialize flowgraph (before consolidated log to avoid duplicate messages)
                            # Note: We don't pass f_offset here since each batch creates new flowgraph
                            self.flowgraph = BPSKFlowgraph(
                                sample_rate=self.sample_rate,
                                callback=self._on_packet_decoded,
                                status_callback=self._on_flowgraph_status,
                                baudrate=self.baudrate,
                                differential=self.differential,
                                packet_size=self.packet_size,
                                batch_interval=self.batch_interval,
                                framing=self.framing,  # Pass framing protocol
                            )
                            flowgraph_started = True

                            # Consolidated initialization log
                            tx_info = (
                                f", TX={self.transmitter_downlink_freq/1e6:.3f}MHz"
                                if self.transmitter_downlink_freq
                                else ""
                            )
                            diff_info = " (differential)" if self.differential else ""
                            logger.info(
                                f"BPSK decoder started: session={self.session_id} | "
                                f"{self.baudrate}bd, {target_sample_rate/1e3:.2f}kS/s ({target_sps}sps){diff_info}, {self.framing.upper()}, pkt_sz={self.packet_size}B | "
                                f"SDR={self.sdr_sample_rate/1e6:.2f}MS/s@{sdr_center/1e6:.3f}MHz, "
                                f"VFO={vfo_center/1e6:.3f}MHz (ofs={offset_freq_init/1e3:.1f}kHz, BW={vfo_bandwidth/1e3:.0f}kHz, dec={decimation}) | "
                                f"batch={self.batch_interval}s{tx_info}"
                            )

                        # Step 1: Frequency translation to put SIGNAL at baseband center
                        offset_freq = vfo_center - sdr_center
                        translated = self._frequency_translate(
                            samples, offset_freq, self.sdr_sample_rate
                        )

                        # Measure signal power AFTER frequency translation, BEFORE decimation/AGC
                        power_dbfs = self._measure_signal_power(translated)
                        self._update_power_measurement(power_dbfs)

                        # Step 2: Decimate to target sample rate
                        decimation = int(self.sdr_sample_rate / self.sample_rate)
                        if decimation < 1:
                            decimation = 1
                        decimated = self._decimate_iq(translated, decimation)

                        # Process samples through flowgraph
                        if flowgraph_started and self.flowgraph is not None:
                            self.flowgraph.process_samples(decimated, vfo_center, vfo_bandwidth)

                        # Send periodic status updates
                        if chunks_received % 50 == 0:
                            self._send_status_update(
                                DecoderStatus.DECODING,
                                {
                                    "packets_decoded": self.packet_count,
                                },
                            )

                        chunks_received += 1

                        # Monitor shared memory every 100 chunks
                        if chunks_received % 100 == 0:
                            self._monitor_shared_memory()
                finally:
                    # Send stats periodically based on time (every 1 second) regardless of chunk rate
                    current_time = time.time()
                    if current_time - last_stats_time >= 1.0:
                        # Compute ingest rates for the last window
                        dt = current_time - ingest_window_start
                        if dt > 0:
                            ingest_sps = ingest_samples_accum / dt
                            ingest_cps = ingest_chunks_accum / dt
                        else:
                            ingest_sps = 0.0
                            ingest_cps = 0.0

                        # Store in stats for both UI-friendly and performance metrics
                        with self.stats_lock:
                            self.stats["ingest_samples_per_sec"] = ingest_sps
                            self.stats["ingest_chunks_per_sec"] = ingest_cps

                        # Reset window
                        ingest_window_start = current_time
                        ingest_samples_accum = 0
                        ingest_chunks_accum = 0

                        self._send_stats_update()
                        last_stats_time = current_time

        except Exception as e:
            logger.error(f"BPSK decoder error: {e}")
            logger.exception(e)
            with self.stats_lock:
                self.stats["errors"] += 1
            self._send_status_update(DecoderStatus.ERROR)
        except KeyboardInterrupt:
            pass
        finally:
            # Flush any remaining samples
            if flowgraph_started and self.flowgraph:
                logger.info("Flushing remaining samples from BPSK flowgraph")
                try:
                    self.flowgraph.flush_buffer()
                except Exception as e:
                    logger.error(f"Error flushing buffer: {e}")

        logger.info(
            f"BPSK decoder process stopped for {self.session_id}. "
            f"Final SHM segments: {self.get_shm_segment_count()}"
        )

        # stop() method removed - now in BaseDecoderProcess

        # Send final status update
        msg = {
            "type": "decoder-status",
            "status": "closed",
            "decoder_type": self._get_decoder_type(),
            "decoder_id": self.decoder_id,
            "session_id": self.session_id,
            "vfo": self.vfo,
            "timestamp": time.time(),
        }
        try:
            self.data_queue.put(msg, block=False)
            with self.stats_lock:
                self.stats["data_messages_out"] += 1
        except queue.Full:
            pass
