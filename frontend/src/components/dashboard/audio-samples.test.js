import { describe, expect, it } from 'vitest';

import { clampAndMeasureRms, toFloat32Samples } from './audio-samples.js';

describe('toFloat32Samples', () => {
    it('wraps an ArrayBuffer without copying', () => {
        const source = new Float32Array([0.25, -0.5, 1]);
        const result = toFloat32Samples(source.buffer);
        expect(Array.from(result)).toEqual([0.25, -0.5, 1]);
        expect(result.buffer).toBe(source.buffer);
    });

    it('respects the offset of an aligned Uint8Array view', () => {
        const backing = new ArrayBuffer(16);
        new Float32Array(backing).set([9, 1, 2, 3]);
        const view = new Uint8Array(backing, 4, 12);
        expect(Array.from(toFloat32Samples(view))).toEqual([1, 2, 3]);
    });

    it('copies an unaligned view instead of throwing', () => {
        const backing = new ArrayBuffer(9);
        const bytes = new Uint8Array(backing);
        bytes.set(new Uint8Array(new Float32Array([0.5, -1]).buffer), 1);
        const view = new Uint8Array(backing, 1, 8);
        expect(Array.from(toFloat32Samples(view))).toEqual([0.5, -1]);
    });

    it('still accepts a legacy JSON number array', () => {
        expect(Array.from(toFloat32Samples([0, 0.5]))).toEqual([0, 0.5]);
    });

    it('rejects payloads that are not whole float32 samples', () => {
        expect(toFloat32Samples(new ArrayBuffer(6))).toBeNull();
        expect(toFloat32Samples(null)).toBeNull();
        expect(toFloat32Samples('nope')).toBeNull();
    });
});

describe('clampAndMeasureRms', () => {
    it('clamps out-of-range and NaN samples in place and returns RMS', () => {
        const samples = new Float32Array([2, -2, NaN, 0]);
        const rms = clampAndMeasureRms(samples);
        expect(Array.from(samples)).toEqual([1, -1, 0, 0]);
        expect(rms).toBeCloseTo(Math.sqrt(2 / 4));
    });

    it('returns 0 for empty input', () => {
        expect(clampAndMeasureRms(new Float32Array(0))).toBe(0);
    });
});
