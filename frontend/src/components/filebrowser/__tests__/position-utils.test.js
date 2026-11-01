import {describe, expect, it} from 'vitest';
import {getReceiverDistances, toLocationNumber} from '../position-utils.js';

describe('Receiver distances', () => {
    it('calculates surface distance for one equatorial degree', () => {
        const result = getReceiverDistances({latitude: 0, longitude: 1}, {lat: '0', lon: '0'});
        expect(result.groundKm).toBeCloseTo(111.195080, 5);
        expect(result.slantKm).toBeNull();
    });

    it('uses the short path across the date line', () => {
        const result = getReceiverDistances({latitude: 0, longitude: -179}, {lat: 0, lon: 179});
        expect(result.groundKm).toBeCloseTo(222.390160, 5);
    });

    it('handles antipodal positions without a nonfinite distance', () => {
        const result = getReceiverDistances({latitude: -40.6, longitude: -157.1}, {lat: 40.6, lon: 22.9});
        expect(result.groundKm).toBeCloseTo(20015.114442, 3);
    });

    it('includes receiver altitude for a balloon directly overhead', () => {
        const result = getReceiverDistances({latitude: 40.6, longitude: 22.9, altitude: 14158.75},
            {lat: '40.6', lon: '22.9', alt: '158.75'});
        expect(result.groundKm).toBe(0);
        expect(result.slantKm).toBeCloseTo(14, 8);
    });

    it('accounts for Earth curvature in the straight-line distance', () => {
        const result = getReceiverDistances({latitude: 0, longitude: 60, altitude: 0},
            {lat: 0, lon: 0, alt: 0});
        // The chord of a 60-degree arc is one radius, while the arc is longer.
        expect(result.groundKm).toBeCloseTo(6671.704814, 5);
        expect(result.slantKm).toBeCloseTo(6371.0088, 8);
    });

    it.each([undefined, null, '', ' ', 'unknown', false, NaN, Infinity])(
        'retains ground distance without assuming a missing receiver altitude is zero: %s', (alt) => {
            const result = getReceiverDistances({latitude: 0, longitude: 1, altitude: 14000},
                {lat: 0, lon: 0, alt});
            expect(result.groundKm).toBeCloseTo(111.195080, 5);
            expect(result.slantKm).toBeNull();
        },
    );

    it('retains ground distance when the packet has no altitude', () => {
        const result = getReceiverDistances({latitude: 0, longitude: 1, altitude: null},
            {lat: 0, lon: 0, alt: 0});
        expect(result.groundKm).toBeCloseTo(111.195080, 5);
        expect(result.slantKm).toBeNull();
    });

    it.each([null, {}, {lat: null, lon: null}, {lat: '', lon: '0'}, {lat: ' ', lon: 0},
        {lat: 0, lon: true}, {lat: 91, lon: 0}, {lat: 0, lon: -181}])(
        'does not invent a receiver position: %j', (receiver) => {
            expect(getReceiverDistances({latitude: 0, longitude: 0}, receiver)).toBeNull();
        },
    );

    it.each([{latitude: null, longitude: 0}, {latitude: 0, longitude: Infinity},
        {latitude: -91, longitude: 0}, {latitude: 0, longitude: 181}])(
        'rejects invalid packet coordinates: %j', (position) => {
            expect(getReceiverDistances(position, {lat: 0, lon: 0})).toBeNull();
        },
    );

    it('normalizes numeric settings while preserving zero and negative altitude', () => {
        expect(toLocationNumber('0')).toBe(0);
        expect(toLocationNumber(' -50 ')).toBe(-50);
        expect(toLocationNumber(false)).toBeNull();
        const result = getReceiverDistances({latitude: 0, longitude: 0, altitude: 50},
            {lat: 0, lon: 0, alt: -50});
        expect(result.slantKm).toBeCloseTo(0.1, 8);
    });
});
