"""Exercise FLL compatibility and carrier recovery with native GNU Radio blocks."""

import argparse
from math import ceil, pi
from types import SimpleNamespace

import numpy as np
import pytest
from gnuradio import blocks, digital, gr
from gnuradio.filter import firdes
from scipy.signal import correlate, upfirdn

from demodulators import bpskdemodulator


def _options(disable_fll=False):
    return argparse.Namespace(
        rrc_alpha=0.35,
        fll_bw=200,
        clk_bw=0.08,
        clk_limit=0.005,
        costas_bw=80,
        f_offset=0,
        disable_fll=disable_fll,
        manchester_block_size=32,
    )


@pytest.mark.integration
@pytest.mark.parametrize("sample_rate", [38_400, 76_800, 230_400])
@pytest.mark.parametrize("differential", [False, True])
@pytest.mark.parametrize("improved_api", [False, True])
def test_fll_preserves_tracking_gain_and_recovers_offset_bpsk(
    monkeypatch, sample_rate, differential, improved_api
):
    native_fll = digital.fll_band_edge_cc
    constructor_modes = []

    def legacy_fll(sps, rolloff, filter_size, bandwidth):
        constructor_modes.append(False)
        return native_fll(sps, rolloff, filter_size, bandwidth)

    def improved_fll(sps, rolloff, filter_size, bandwidth, *, improved_loop_filter):
        constructor_modes.append(improved_loop_filter)
        try:
            return native_fll(
                sps, rolloff, filter_size, bandwidth, improved_loop_filter=improved_loop_filter
            )
        except TypeError:
            # Exercise the new gain semantics even on pre-#7890 installations.
            fll = native_fll(sps, rolloff, filter_size, bandwidth)
            fll.set_alpha(0)
            fll.set_beta(8 * pi * bandwidth / sps)
            return fll

    monkeypatch.setattr(
        bpskdemodulator,
        "digital",
        SimpleNamespace(fll_band_edge_cc=improved_fll if improved_api else legacy_fll),
    )
    options = _options()
    demod = bpskdemodulator.create_bpsk_demodulator(
        baudrate=9600, samp_rate=sample_rate, differential=differential, options=options
    )

    # Compare against GNU Radio's original control-loop gain, independently of
    # the conversion formula used by the receiver.
    decimation = max(1, ceil(sample_rate / 9600 / 10))
    legacy_bw = 2 * pi * decimation / sample_rate * options.fll_bw
    original_loop = blocks.control_loop(legacy_bw, 1, -1)
    assert demod.fll.get_beta() == pytest.approx(original_loop.get_beta(), rel=1e-6)
    assert (demod.fll.get_alpha() == 0) is improved_api
    assert constructor_modes == [improved_api]
    assert options.disable_fll is False
    assert demod.options.disable_fll is False

    # Pulse-shaped BPSK with a residual carrier offset exercises the complete
    # rewired receiver, including internal decimation and differential mode.
    symbols = np.random.default_rng(42).choice([-1.0, 1.0], 12_000)
    sps = sample_rate // 9600
    taps = firdes.root_raised_cosine(sps, sample_rate, 9600, 0.35, 11 * sps)
    waveform = upfirdn(taps, symbols, sps)
    iq = waveform * np.exp(2j * pi * 100 * np.arange(len(waveform)) / sample_rate)
    source = blocks.vector_source_c(iq.astype(np.complex64), False)
    sink = blocks.vector_sink_f()
    graph = gr.top_block()
    graph.connect(source, demod, sink)
    graph.run()

    # Allow acquisition, then resolve the receiver's delay and phase ambiguity.
    recovered = np.sign(np.asarray(sink.data()))[3000:-100]
    assert len(recovered) > 8000
    expected = symbols[1:] * symbols[:-1] if differential else symbols
    correlation = correlate(expected, recovered, mode="valid", method="fft")
    bit_error_rate = (1 - np.max(np.abs(correlation)) / len(recovered)) / 2
    assert bit_error_rate < 0.005


@pytest.mark.integration
def test_disabled_fll_keeps_receiver_bypass_and_options():
    options = _options(disable_fll=True)
    demod = bpskdemodulator.create_bpsk_demodulator(
        baudrate=9600, samp_rate=76_800, differential=False, options=options
    )
    assert not hasattr(demod, "fll")
    assert options.disable_fll is True
    assert demod.options.disable_fll is True
