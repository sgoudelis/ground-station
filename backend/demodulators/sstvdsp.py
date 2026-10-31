"""Signal processing for SSTV audio and continuous SDR sample streams."""

import numpy as np
from scipy import signal
from scipy.ndimage import gaussian_filter1d

from common.resampler import StreamResampler as AudioResampler

__all__ = ["AudioResampler", "ToneData"]


class ToneData:
    """Recover the SSTV tone frequency without a wide FFT window per pixel."""

    def __init__(self, audio, sample_rate):
        self.sample_rate = sample_rate
        samples = np.asarray(audio, dtype=np.float64)
        self.audio = samples
        taps = signal.firwin(
            round(0.003 * sample_rate) | 1, 1000, fs=sample_rate, window=("kaiser", 5.0)
        )
        self.taps = taps
        oscillator = np.exp(-2j * np.pi * 1900 * np.arange(len(samples)) / sample_rate)
        # Centred convolution compensates the FIR delay before extracting line timing.
        analytic = signal.fftconvolve(samples * oscillator, taps, mode="same")
        amplitude = np.abs(analytic)
        self.valid = amplitude > max(1e-9, float(np.percentile(amplitude, 75)) * 0.03)
        frequency = np.empty(len(samples))
        frequency[1:] = 1900 + np.angle(analytic[1:] * analytic[:-1].conj()) * (
            sample_rate / (2 * np.pi)
        )
        frequency[0] = frequency[1] if len(frequency) > 1 else 1900
        self.frequency = signal.convolve(frequency, np.ones(3) / 3, mode="same")
        self.sync_frequency = gaussian_filter1d(self.frequency, max(1, sample_rate * 0.00025))
        self._pulses = {}

    def sync_pulses(self, duration, offset=0.0):
        """Return low-tone intervals; callers validate width and predicted timing."""
        key = duration, offset
        if key in self._pulses:
            return self._pulses[key]
        low = (
            (self.sync_frequency > 1050 + offset)
            & (self.sync_frequency < 1350 + offset)
            & self.valid
        )
        edges = np.diff(np.r_[False, low, False].astype(np.int8))
        starts = np.flatnonzero(edges == 1)
        ends = np.flatnonzero(edges == -1)
        keep = ends - starts >= duration * self.sample_rate * 0.6
        pulses = starts[keep], ends[keep]
        self._pulses[key] = pulses
        return pulses

    def level(self, start, end, width, offset=0.0, default=128):
        """Sample one scan, smoothing inside its bounds to protect adjacent segments."""
        first, stop = max(0, int(np.ceil(start))), min(len(self.frequency), int(np.ceil(end)))
        if stop - first < 2:
            return np.full(width, default, dtype=np.float64)
        frequency = self._scan_frequency(first, stop)
        good = self.valid[first:stop]
        if not np.any(good):
            return np.full(width, default, dtype=np.float64)
        # A fade should not turn a phase-discriminator spike into saturated colour.
        grid = np.arange(len(frequency))
        frequency[~good] = np.interp(grid[~good], grid[good], frequency[good])
        frequency = gaussian_filter1d(
            frequency, max(0.5, (end - start) / width * 0.25), mode="nearest"
        )
        positions = start + (np.arange(width) + 0.5) * (end - start) / width
        values = np.interp(positions - first, grid, frequency)
        return np.clip((values - offset - 1500) * 255 / 800, 0, 255)

    def _scan_frequency(self, first, stop):
        """Continue scan-edge tones so the FIR never mixes in a porch or the next sync."""
        samples = self.audio[first:stop]
        padding = len(self.taps)
        extended = np.pad(samples, padding, mode="edge")
        count = min(len(samples), max(6, round(self.sample_rate * 0.001)))
        for left in (True, False):
            begin = 0 if left else len(samples) - count
            edge = samples[begin : begin + count]
            # A sinusoid obeys x[n-1]+x[n+1] = 2*cos(w)*x[n], including a DC term.
            design = np.column_stack((2 * edge[1:-1], np.ones(count - 2)))
            cosine = np.linalg.lstsq(design, edge[:-2] + edge[2:], rcond=None)[0][0]
            frequency = np.arccos(np.clip(cosine, -1, 1)) * self.sample_rate / (2 * np.pi)
            if not 850 < frequency < 3000:
                frequency = float(np.median(self.frequency[first:stop]))
            omega = 2 * np.pi * frequency / self.sample_rate
            positions = np.arange(begin, begin + count)
            basis = np.column_stack(
                (np.cos(omega * positions), np.sin(omega * positions), np.ones(count))
            )
            coefficients = np.linalg.lstsq(basis, edge, rcond=None)[0]
            positions = (
                np.arange(-padding, 0) if left else np.arange(len(samples), len(samples) + padding)
            )
            continuation = (
                coefficients[0] * np.cos(omega * positions)
                + coefficients[1] * np.sin(omega * positions)
                + coefficients[2]
            )
            if left:
                extended[:padding] = continuation
            else:
                extended[-padding:] = continuation
        positions = np.arange(-padding, len(samples) + padding)
        mixed = extended * np.exp(-2j * np.pi * 1900 * positions / self.sample_rate)
        analytic = signal.fftconvolve(mixed, self.taps, mode="same")
        phase = analytic[padding : padding + len(samples)]
        frequency = np.empty(len(samples))
        frequency[1:] = 1900 + np.angle(phase[1:] * phase[:-1].conj()) * self.sample_rate / (
            2 * np.pi
        )
        frequency[0] = frequency[1]
        return frequency
