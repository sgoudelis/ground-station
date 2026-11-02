# Copyright (c) 2026 Efstratios Goudelis

import logging
import math
from typing import Any, Dict


def apply_bandwidth(
    sdr: Any,
    direction: int,
    channel: int,
    sample_rate: float,
    selection: Any,
    driver: str,
    logger: logging.Logger,
) -> Dict[str, Any]:
    """Apply a discrete hardware filter and report its readback, without changing the rate."""
    mode = "driver" if selection is None else selection
    status: Dict[str, Any] = {
        "mode": mode,
        "sample_rate": sample_rate,
        "requested_hz": None,
        "actual_hz": None,
        "error": None,
    }
    try:
        if selection is not None:
            if mode == "driver":
                # Zero restores the driver's policy after a manual/Auto selection.
                requested = 0.0
            else:
                bandwidths = sorted(
                    {
                        float(value)
                        for value in sdr.listBandwidths(direction, channel)
                        if math.isfinite(float(value)) and float(value) > 0
                    }
                )
                if driver.lower() == "sdrplay" and sample_rate <= 2_000_000:
                    # SDRplay's low-rate paths use low IF and/or decimation;
                    # the wide zero-IF filters are not appropriate for these paths.
                    bandwidths = [value for value in bandwidths if value <= 1_536_000]
                if not bandwidths:
                    raise ValueError("No compatible IF bandwidths are available")
                if mode == "auto":
                    # Cover the sampled span where possible; otherwise use the
                    # widest compatible filter and expose the limit in readback.
                    requested = next(
                        (value for value in bandwidths if value >= sample_rate), bandwidths[-1]
                    )
                else:
                    requested = float(selection)
                    if isinstance(selection, bool) or requested not in bandwidths:
                        raise ValueError("The selected IF bandwidth is not supported at this rate")
                status["requested_hz"] = requested
            sdr.setBandwidth(direction, channel, requested)
    except Exception as exc:
        status["error"] = str(exc)
        logger.warning("Failed to apply IF bandwidth %s: %s", mode, exc)

    try:
        actual = float(sdr.getBandwidth(direction, channel))
        if math.isfinite(actual) and actual > 0:
            status["actual_hz"] = actual
            requested = status["requested_hz"]
            if (
                not status["error"]
                and requested is not None
                and not math.isclose(actual, requested, rel_tol=1e-6)
            ):
                status["error"] = (
                    f"Receiver applied {actual:g} Hz instead of the requested {requested:g} Hz"
                )
                logger.warning(status["error"])
            logger.info("IF bandwidth: mode=%s, applied=%g Hz", mode, actual)
        elif selection is not None and not status["error"]:
            status["error"] = "Receiver did not report its applied IF bandwidth"
    except Exception as exc:
        # Unconfigured devices without bandwidth support must continue streaming.
        if selection is not None and not status["error"]:
            status["error"] = f"Cannot read applied IF bandwidth: {exc}"
        logger.debug("IF bandwidth readback unavailable: %s", exc)
    return status
