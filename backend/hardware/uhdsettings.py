# Copyright (c) 2026 Efstratios Goudelis

"""Native UHD settings and the filter adapter shared with SoapyUHD."""

from dataclasses import dataclass


@dataclass
class _Range:
    low: float
    high: float
    increment: float

    def minimum(self):
        return self.low

    def maximum(self):
        return self.high

    def step(self):
        return self.increment


class UhdBandwidth:
    def __init__(self, usrp):
        self.usrp = usrp

    def getBandwidth(self, _direction, channel):
        return self.usrp.get_rx_bandwidth(channel)

    def setBandwidth(self, _direction, channel, value):
        self.usrp.set_rx_bandwidth(value, channel)

    def getBandwidthRange(self, _direction, channel):
        ranges = self.usrp.get_rx_bandwidth_range(channel)
        return [_Range(ranges.start(), ranges.stop(), ranges.step())]

    def listBandwidths(self, direction, channel):
        return [
            value
            for item in self.getBandwidthRange(direction, channel)
            for value in (item.minimum(), item.maximum())
        ]


def apply_uhd_sources(usrp, settings, previous=None):
    # Older clients saved these fields even though native UHD ignored them.
    # Only the new explicit namespace opts into changing motherboard sources.
    sources = (settings or {}).get("uhd") or {}
    previous_sources = (previous or {}).get("uhd") or {}
    errors = {}
    for name, setter, available in (
        ("clockSource", "set_clock_source", "get_clock_sources"),
        ("timeSource", "set_time_source", "get_time_sources"),
    ):
        value = sources.get(name)
        if value is None or value == previous_sources.get(name):
            continue
        try:
            if value not in getattr(usrp, available)(0):
                raise ValueError(f"Unsupported {name}: {value}")
            getattr(usrp, setter)(value, 0)
        except Exception as exc:
            errors[name] = str(exc)
    return errors
