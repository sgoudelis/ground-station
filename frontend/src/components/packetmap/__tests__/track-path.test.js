import {describe, expect, it} from 'vitest';
import {smoothTrack} from '../track-path.js';

describe('Transmitter path smoothing', () => {
    it('rounds bends while passing through every recorded fix and preserving endpoints', () => {
        const fixes = [[0, 0], [1, 1], [0, 2]];
        const path = smoothTrack(fixes);
        expect(path[0]).toEqual(fixes[0]);
        expect(path.at(-1)).toEqual(fixes.at(-1));
        for (const fix of fixes) expect(path).toContainEqual(fix);
        expect(path.some(([lat, lon]) => lon > 0 && lon < 1 && Math.abs(lat - lon) > 1e-6)).toBe(true);
        expect(path.flat().every(Number.isFinite)).toBe(true);
        expect(fixes).toEqual([[0, 0], [1, 1], [0, 2]]);
    });

    it('handles empty, stationary, repeated and unevenly spaced fixes without invalid coordinates', () => {
        expect(smoothTrack([])).toEqual([]);
        expect(smoothTrack([[40, 23], [40, 23]])).toEqual([[40, 23]]);
        expect(smoothTrack([[40, 23], [41, 24]])).toEqual([[40, 23], [41, 24]]);
        const fixes = [[40, 23], [40, 23], [40.000001, 23.000001], [41, 24], [41, 24]];
        const path = smoothTrack(fixes);
        expect(path.flat().every(Number.isFinite)).toBe(true);
        expect(path[0]).toEqual(fixes[0]);
        expect(path.at(-1)).toEqual(fixes.at(-1));
    });

    it('leaves longitude discontinuities uninterpolated', () => {
        const fixes = [[40, 179], [41, -179], [42, -178]];
        expect(smoothTrack(fixes)).toEqual(fixes);
    });
});
