# Copyright (c) 2026 Efstratios Goudelis

"""Hardware readback is separate from the configuration a client requested."""

import math
import time
from typing import Any, Dict


def _read(readers, logger):
    status: Dict[str, Any] = {"timestamp": time.time(), "errors": {}}
    for name, read in readers.items():
        try:
            value = read()
            if isinstance(value, float) and not math.isfinite(value):
                raise ValueError("Receiver returned a non-finite value")
            status[name] = value
        except Exception as exc:
            status[name] = None
            status["errors"][name] = str(exc)
            logger.debug("Receiver %s readback unavailable: %s", name, exc)
    return status


def read_soapy_receiver(sdr, direction, channel, logger):
    return _read(
        {
            "gain_db": lambda: float(sdr.getGain(direction, channel)),
            "antenna": lambda: sdr.getAntenna(direction, channel),
            "bandwidth_hz": lambda: float(sdr.getBandwidth(direction, channel)),
            "sample_rate": lambda: float(sdr.getSampleRate(direction, channel)),
            "frequency_hz": lambda: float(sdr.getFrequency(direction, channel)),
            "agc": lambda: (
                bool(sdr.getGainMode(direction, channel))
                if sdr.hasGainMode(direction, channel)
                else False
            ),
            "clock_source": sdr.getClockSource if hasattr(sdr, "getClockSource") else lambda: None,
            "time_source": sdr.getTimeSource if hasattr(sdr, "getTimeSource") else lambda: None,
        },
        logger,
    )


def read_uhd_receiver(usrp, channel, logger):
    return _read(
        {
            "gain_db": lambda: float(usrp.get_rx_gain(channel)),
            "antenna": lambda: usrp.get_rx_antenna(channel),
            "bandwidth_hz": lambda: float(usrp.get_rx_bandwidth(channel)),
            "sample_rate": lambda: float(usrp.get_rx_rate(channel)),
            "frequency_hz": lambda: float(usrp.get_rx_freq(channel)),
            # UHD versions without an AGC getter must report unknown, not guess.
            "agc": lambda: bool(usrp.get_rx_agc(channel)),
            "clock_source": lambda: usrp.get_clock_source(0),
            "time_source": lambda: usrp.get_time_source(0),
        },
        logger,
    )
