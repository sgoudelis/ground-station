# Copyright (c) 2026 Efstratios Goudelis

import importlib
import logging
import queue
import threading
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from hardware.soapybandwidth import apply_bandwidth

pytestmark = pytest.mark.unit


class Receiver:
    def __init__(self, bandwidths=None):
        self.bandwidths = bandwidths or [200_000, 300_000, 600_000, 1_536_000, 5e6, 6e6, 8e6]
        self.actual = 1_536_000
        self.applied = []

    def listBandwidths(self, *_args):
        return self.bandwidths

    def setBandwidth(self, _direction, _channel, value):
        self.applied.append(value)
        self.actual = value or 1_536_000

    def getBandwidth(self, *_args):
        return self.actual


def apply(receiver, selection, rate=4e6):
    return apply_bandwidth(
        receiver, 0, 0, rate, selection, "sdrplay", logging.getLogger(__name__), 1_536_000
    )


@pytest.mark.parametrize("rate,expected", [(3e6, 5e6), (4e6, 5e6), (5e6, 5e6), (6e6, 6e6)])
def test_auto_covers_sampled_span(rate, expected):
    receiver = Receiver()
    status = apply(receiver, "auto", rate)
    assert receiver.applied == [expected]
    assert status["actual_hz"] == expected
    assert status["error"] is None


def test_auto_reports_hardware_limit_and_respects_low_rate_modes():
    receiver = Receiver([200_000, 300_000, 600_000, 1_536_000])
    assert apply(receiver, "auto")["actual_hz"] == 1_536_000
    assert apply(Receiver(), "auto", 2e6)["actual_hz"] == 1_536_000
    assert apply(Receiver(), 5e6, 2e6)["error"] is not None


def test_existing_config_preserves_driver_and_explicit_driver_restores_it():
    receiver = Receiver()
    assert apply(receiver, None)["actual_hz"] == 1_536_000
    assert receiver.applied == []
    assert apply(receiver, 6e6)["actual_hz"] == 6e6
    assert apply(receiver, "driver")["actual_hz"] == 1_536_000
    assert receiver.applied == [6e6, 1_536_000]


@pytest.mark.parametrize("selection,expected", [("auto", 4e6), (4e6, 4e6), ("driver", 56e6)])
def test_uhd_uses_continuous_range_and_never_resets_bandwidth_to_zero(selection, expected):
    receiver = Receiver([200_000, 56e6])
    receiver.getBandwidthRange = lambda *_args: [
        SimpleNamespace(
            minimum=lambda: 200_000,
            maximum=lambda: 56e6,
            step=lambda: 0,
        )
    ]

    def set_bandwidth(_direction, _channel, value):
        receiver.applied.append(value)
        # Match the AD9361 behavior seen in production, including zero clamping.
        receiver.actual = max(200_000, min(56e6, value))

    receiver.setBandwidth = set_bandwidth
    status = apply_bandwidth(
        receiver, 0, 0, 4e6, selection, "uhd", logging.getLogger(__name__), 56e6
    )
    assert receiver.applied == [expected]
    assert status["actual_hz"] == expected
    assert status["error"] is None


def test_missing_default_is_reported_without_narrowing_the_receiver():
    receiver = Receiver([200_000, 56e6])
    status = apply_bandwidth(receiver, 0, 0, 4e6, "driver", "uhd", logging.getLogger(__name__))
    assert receiver.applied == []
    assert "Driver bandwidth is unavailable" in status["error"]


@pytest.mark.parametrize(
    "selection,expected", [("auto", 4_200_000), (4_200_000, 4_200_000), (4e6, None)]
)
def test_uhd_respects_bandwidth_range_increments(selection, expected):
    receiver = Receiver([200_000, 56_200_000])
    receiver.getBandwidthRange = lambda *_args: [
        SimpleNamespace(minimum=lambda: 200_000, maximum=lambda: 56_200_000, step=lambda: 1e6)
    ]
    status = apply_bandwidth(receiver, 0, 0, 4e6, selection, "uhd", logging.getLogger(__name__))
    assert receiver.applied == ([] if expected is None else [expected])
    assert bool(status["error"]) is (expected is None)


@pytest.mark.parametrize("selection", [float("nan"), float("inf"), -1, True, "bad", 4e6])
def test_invalid_or_unsupported_manual_bandwidth_does_not_reconfigure_receiver(selection):
    receiver = Receiver()
    status = apply(receiver, selection)
    assert status["error"]
    assert receiver.applied == []
    assert status["actual_hz"] == 1_536_000


def test_driver_rounding_and_failure_are_reported_with_readback():
    receiver = Receiver()
    receiver.setBandwidth = Mock()
    status = apply(receiver, 5e6)
    assert status["actual_hz"] == 1_536_000
    assert "instead of" in status["error"]
    receiver.setBandwidth.side_effect = RuntimeError("Device rejected the filter")
    assert apply(receiver, 5e6)["error"] == "Device rejected the filter"


@pytest.mark.parametrize("kind", ["local", "remote"])
@pytest.mark.parametrize("selection", ["auto", 6e6])
def test_worker_reapplies_bandwidth_after_sample_rate_reset(monkeypatch, kind, selection):
    pytest.importorskip("SoapySDR")
    worker = importlib.import_module(f"workers.soapysdr{kind}worker")
    stopped = threading.Event()
    receiver = Receiver()

    def set_rate(_direction, _channel, rate):
        receiver.rate = rate
        # Reproduce SDRplay resetting its filter inside setSampleRate().
        receiver.actual = 1_536_000

    def read(*args, **_kwargs):
        if configs.empty():
            stopped.set()
        return SimpleNamespace(ret=args[2])

    receiver.setSampleRate = set_rate
    receiver.getSampleRate = lambda *_args: receiver.rate
    receiver.getDriverKey = lambda: "sdrplay"
    receiver.getHardwareKey = lambda: "RSPduo"
    receiver.getSettingInfo = lambda: []
    receiver.getFrequency = lambda *_args: 1090e6
    receiver.getGain = lambda *_args: 48
    receiver.hasDCOffsetMode = lambda *_args: False
    receiver.setupStream = lambda *_args: object()
    receiver.readStream = read
    for method in (
        "setFrequency",
        "setGainMode",
        "setGain",
        "activateStream",
        "deactivateStream",
        "closeStream",
    ):
        setattr(receiver, method, Mock())
    monkeypatch.setattr(worker, "SoapySDR", SimpleNamespace(Device=lambda _args: receiver))
    monkeypatch.setattr(worker.time, "sleep", lambda _seconds: None)
    monkeypatch.setattr(worker, "get_supported_sample_rates", lambda *_args: [])

    config = {
        "sdr_id": "radio",
        "driver": "sdrplay",
        "sample_rate": 4e6,
        "sdr_settings": {"bandwidth": selection},
    }
    configs, messages = queue.Queue(), queue.Queue()
    configs.put(config)
    # Both updates omit settings; the frequency update must not erase the mode
    # needed when the following rate change resets the device's filter.
    configs.put({"center_freq": 1090e6})
    configs.put({"sample_rate": 6e6})
    getattr(worker, f"soapysdr_{kind}_worker_process")(configs, messages, stopped)

    updates = list(messages.queue)
    assert not [item for item in updates if item["type"] == "error"]
    bandwidth_updates = [item["status"] for item in updates if item["type"] == "bandwidth"]
    expected = 5e6 if selection == "auto" else selection
    assert [item["actual_hz"] for item in bandwidth_updates] == [expected, 6e6]
    assert [item["sample_rate"] for item in bandwidth_updates] == [4e6, 6e6]
