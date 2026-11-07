# Copyright (c) 2026 Efstratios Goudelis

import logging
import math
from typing import Any, Dict


def read_bandwidth(sdr: Any, direction: int, channel: int):
    """Read an optional hardware filter without making unsupported devices fail startup."""
    try:
        value = float(sdr.getBandwidth(direction, channel))
        return value if math.isfinite(value) and value > 0 else None
    except Exception:
        return None


def get_bandwidth_ranges(sdr: Any, direction: int, channel: int):
    """Keep range endpoints distinct from a list of discrete filter choices."""
    ranges = []
    for item in sdr.getBandwidthRange(direction, channel):
        low, high = float(item.minimum()), float(item.maximum())
        step = float(item.step() or 0)
        if all(math.isfinite(value) for value in (low, high, step)) and 0 < low <= high:
            ranges.append({"min": low, "max": high, "step": max(0, step)})
    return ranges


def apply_bandwidth(
    sdr: Any,
    direction: int,
    channel: int,
    sample_rate: float,
    selection: Any,
    driver: str,
    logger: logging.Logger,
    default_bandwidth: Any = None,
) -> Dict[str, Any]:
    """Apply a supported filter and report its readback, without changing the rate."""
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
                # Zero is not a portable reset: UHD clamps it to 200 kHz.
                # Restore the filter measured before this worker changed it.
                requested = float(default_bandwidth or 0)
                if not math.isfinite(requested) or requested <= 0:
                    raise ValueError(
                        "Driver bandwidth is unavailable; restart reception to restore it"
                    )
                status["requested_hz"] = requested
            else:
                ranges = []
                if driver.lower() == "uhd":
                    try:
                        ranges = get_bandwidth_ranges(sdr, direction, channel)
                    except (AttributeError, NotImplementedError):
                        pass
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
                if not bandwidths and not ranges:
                    raise ValueError("No compatible IF bandwidths are available")
                if ranges and mode == "auto":
                    # UHD's listBandwidths can contain only the endpoints of a
                    # continuous range. Request the sampled span inside that range.
                    choices = []
                    for item in ranges:
                        target = max(item["min"], min(sample_rate, item["max"]))
                        if item["step"]:
                            target = min(
                                item["max"],
                                item["min"]
                                + math.ceil((target - item["min"]) / item["step"] - 1e-9)
                                * item["step"],
                            )
                        choices.append(target)
                    requested = min(
                        (value for value in choices if value >= sample_rate), default=max(choices)
                    )
                elif mode == "auto":
                    # Cover the sampled span where possible; otherwise use the
                    # widest compatible filter and expose the limit in readback.
                    requested = next(
                        (value for value in bandwidths if value >= sample_rate), bandwidths[-1]
                    )
                else:
                    requested = float(selection)
                    supported = (
                        any(
                            item["min"] <= requested <= item["max"]
                            and (
                                not item["step"]
                                or abs(
                                    (requested - item["min"]) / item["step"]
                                    - round((requested - item["min"]) / item["step"])
                                )
                                < 1e-6
                            )
                            for item in ranges
                        )
                        if ranges
                        else requested in bandwidths
                    )
                    if isinstance(selection, bool) or not math.isfinite(requested) or not supported:
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
