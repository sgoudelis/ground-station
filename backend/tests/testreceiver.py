import logging
from types import SimpleNamespace

import pytest

from hardware.receiver import read_soapy_receiver, read_uhd_receiver
from hardware.uhdsettings import apply_uhd_sources

pytestmark = pytest.mark.unit


def test_native_sources_require_explicit_new_settings_and_validate_supported_values():
    changed = []
    usrp = SimpleNamespace(
        get_clock_sources=lambda _board: ["internal", "external"],
        get_time_sources=lambda _board: ["internal"],
        set_clock_source=lambda value, board: changed.append(("clock", value, board)),
        set_time_source=lambda value, board: changed.append(("time", value, board)),
    )
    legacy = {"clockSource": "external", "timeSource": "external", "gains": {"PGA": 0}}
    assert apply_uhd_sources(usrp, legacy) == {}
    assert changed == []
    explicit = {**legacy, "uhd": {"clockSource": "external", "timeSource": "external"}}
    errors = apply_uhd_sources(usrp, explicit)
    assert changed == [("clock", "external", 0)]
    assert errors == {"timeSource": "Unsupported timeSource: external"}
    # Unrelated edits do not repeatedly switch the hardware's reference.
    assert apply_uhd_sources(usrp, explicit, explicit) == {}
    assert changed == [("clock", "external", 0)]


def test_uhd_readback_reports_actual_values_and_missing_agc_as_unknown():
    receiver = SimpleNamespace(
        get_rx_gain=lambda _ch: 41.5,
        get_rx_antenna=lambda _ch: "TX/RX",
        get_rx_bandwidth=lambda _ch: 4e6,
        get_rx_rate=lambda _ch: 4e6,
        get_rx_freq=lambda _ch: 404e6,
        get_clock_source=lambda _board: "internal",
        get_time_source=lambda _board: "internal",
    )
    status = read_uhd_receiver(receiver, 0, logging.getLogger(__name__))
    assert status["gain_db"] == 41.5
    assert status["antenna"] == "TX/RX"
    assert status["bandwidth_hz"] == 4e6
    assert status["agc"] is None
    assert "agc" in status["errors"]


def test_soapy_readback_continues_when_one_getter_fails():
    def fail_gain(*_args):
        raise RuntimeError("Gain read failed")

    receiver = SimpleNamespace(
        getGain=fail_gain,
        getAntenna=lambda *_args: "RX2",
        getBandwidth=lambda *_args: 200_000,
        getSampleRate=lambda *_args: 4e6,
        getFrequency=lambda *_args: 404e6,
        hasGainMode=lambda *_args: True,
        getGainMode=lambda *_args: False,
    )
    status = read_soapy_receiver(receiver, 0, 0, logging.getLogger(__name__))
    assert status["gain_db"] is None
    assert status["errors"]["gain_db"] == "Gain read failed"
    assert status["antenna"] == "RX2"
    assert status["agc"] is False
