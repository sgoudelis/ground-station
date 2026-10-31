"""Stateful polyphase resampling for real or complex sample streams."""

from fractions import Fraction

import numpy as np
from scipy import signal


class StreamResampler:
    """Causal polyphase resampling with a shared clock across input chunks."""

    def __init__(self, input_rate, output_rate):
        ratio = (Fraction(str(output_rate)) / Fraction(str(input_rate))).limit_denominator(100000)
        self.up, self.down = ratio.numerator, ratio.denominator
        scale = max(self.up, self.down)
        self.taps = (
            signal.firwin(20 * scale + 1, 1.0 / scale, window=("kaiser", 5.0)) * self.up
            if scale > 1
            else np.ones(1)
        )
        self.history = np.empty(0)
        self.base = 0
        self.received = 0
        self.emitted = 0

    def process(self, samples):
        if not len(samples):
            return np.empty(0)
        data = np.concatenate((self.history, samples))
        filtered = signal.upfirdn(self.taps, data, up=self.up, down=self.down)
        self.received += len(samples)
        available = (self.received * self.up + self.down - 1) // self.down
        # History starts on a down-factor boundary, keeping the polyphase grid fixed.
        origin = self.base * self.up // self.down
        result = filtered[self.emitted - origin : available - origin]
        self.emitted = available
        memory = (len(self.taps) + self.up - 1) // self.up
        base = max(0, (self.received - memory) // self.down * self.down)
        self.history = data[base - self.base :].copy()
        self.base = base
        return result
