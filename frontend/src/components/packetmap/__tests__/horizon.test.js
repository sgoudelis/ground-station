import {describe, expect, it} from 'vitest';
import {getCircleBounds, getHorizonRadii} from '../horizon.js';

describe('Radiosonde visibility radii', () => {
    it('gives the geometric horizon and 5° elevation footprint in meters', () => {
        const radii = getHorizonRadii(10000);
        expect(radii.horizon).toBeCloseTo(356726.164, 2);
        expect(radii.fiveDegrees).toBeCloseTo(104357.168, 2);
    });

    it('keeps the 5° footprint inside the horizon and expands both with altitude', () => {
        const low = getHorizonRadii(1000);
        const high = getHorizonRadii(30000);
        expect(low.fiveDegrees).toBeGreaterThan(0);
        expect(low.fiveDegrees).toBeLessThan(low.horizon);
        expect(high.fiveDegrees).toBeLessThan(high.horizon);
        expect(high.fiveDegrees).toBeGreaterThan(low.fiveDegrees);
        expect(high.horizon).toBeGreaterThan(low.horizon);
    });

    it.each([null, undefined, NaN, Infinity, -Infinity, -100, 0, '10000'])(
        'omits circles for an unknown or nonpositive altitude: %s', (altitude) => {
            expect(getHorizonRadii(altitude)).toBeNull();
        },
    );
});

describe('Visibility circle bounds', () => {
    it('accounts for the wider longitude span at higher latitudes', () => {
        const equator = getCircleBounds([0, 0], 100000);
        const northern = getCircleBounds([60, 10], 100000);
        expect(equator[0][0]).toBeCloseTo(-0.89932, 4);
        expect(equator[1][1]).toBeCloseTo(0.89932, 4);
        expect(northern[0][0]).toBeCloseTo(59.10068, 4);
        expect(northern[1][1] - 10).toBeGreaterThan(1.79);
        expect(northern[1][1] - 10).toBeLessThan(1.81);
    });

    it('keeps date-line bounds near the sonde and handles a circle covering a pole', () => {
        const crossing = getCircleBounds([0, 179.9], 100000);
        expect(crossing[1][1]).toBeGreaterThan(180);
        expect(crossing[1][1] - crossing[0][1]).toBeLessThan(2);
        const polar = getCircleBounds([89.9, 0], 100000);
        expect(polar[1]).toEqual([90, 180]);
        expect(polar[0][1]).toBe(-180);
    });
});
