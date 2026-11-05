"""Build the gr-satellites BPSK receiver with GNU Radio's improved FLL."""

from copy import copy
from math import pi, sqrt

from gnuradio import digital
from satellites.components.demodulators.bpsk_demodulator import bpsk_demodulator


def create_bpsk_demodulator(*, baudrate, samp_rate, differential, options):
    """Preserve the tuned FLL tracking gain across old and new GNU Radio APIs."""
    # gr-satellites still constructs a legacy FLL. Build its remaining receiver
    # first so newer GNU Radio never constructs (and warns about) that filter.
    demod_options = copy(options)
    demod_options.disable_fll = True
    demod = bpsk_demodulator(
        baudrate=baudrate,
        samp_rate=samp_rate,
        iq=True,
        f_offset=0,
        differential=differential,
        manchester=False,
        options=demod_options,
    )
    demod_options.disable_fll = options.disable_fll
    if options.disable_fll:
        return demod

    # Read the actual rate after gr-satellites' internal decimation and baudrate
    # limiting instead of duplicating its sample-rate selection rules.
    sps = demod.clock_recovery.sps()
    legacy_bw = 2 * pi * demod.xlating.decimation() / samp_rate * options.fll_bw

    # The new bandwidth uses BL*T rather than the old loop's radians/sample.
    # Match the frequency update gain (beta), as recommended in GNU Radio #7890,
    # to retain similar acquisition time without the legacy phase-update noise.
    improved_bw = legacy_bw**2 * sps / ((1 + sqrt(2) * legacy_bw + legacy_bw**2) * 2 * pi)
    try:
        demod.fll = digital.fll_band_edge_cc(
            sps, options.rrc_alpha, 100, improved_bw, improved_loop_filter=True
        )
    except TypeError:
        # Older GNU Radio has only the four-argument API and needs the original
        # bandwidth. It also predates the repeated legacy-filter warning.
        demod.fll = digital.fll_band_edge_cc(sps, options.rrc_alpha, 100, legacy_bw)

    # Put the FLL after AGC, exactly where gr-satellites normally connects it.
    demod.disconnect(demod.agc, demod.clock_recovery)
    demod.connect(demod.agc, demod.fll, demod.clock_recovery)
    return demod
