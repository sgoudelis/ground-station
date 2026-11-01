import {describe, expect, it} from 'vitest';
import {createRadiosondeIcon, getFlightPhase, markerLift} from '../radiosonde-marker.js';

const fix = (second, altitude) => ({captured_at: `2026-11-01T00:00:0${second}Z`, altitude});

describe('Radiosonde flight direction', () => {
    it('prefers the reported vertical speed over reception-time estimates', () => {
        const points = [fix(0, 100), fix(1, 120)];
        expect(getFlightPhase(points, -5)).toBe('descending');
        expect(getFlightPhase(points, 5)).toBe('ascending');
    });

    it('uses altitude history and retains the last direction through small fluctuations', () => {
        expect(getFlightPhase([fix(0, 100), fix(1, 120), fix(2, 120.05)], 0.05)).toBe('ascending');
        expect(getFlightPhase([fix(0, 120), fix(1, 100), fix(2, 100.05)])).toBe('descending');
        expect(getFlightPhase([fix(0, 100), fix(1, null), fix(2, 120)])).toBe('ascending');
        expect(getFlightPhase([fix(0, 100), fix(1, 0), fix(1, 120)])).toBe('ascending');
    });

    it('does not infer a flight direction from missing altitude or invalid time differences', () => {
        expect(getFlightPhase([fix(0, null), fix(1, 100)])).toBe('unknown');
        expect(getFlightPhase([fix(0, 100), fix(0, 120)])).toBe('unknown');
        expect(getFlightPhase([{altitude: 100}, fix(1, 120)])).toBe('unknown');
        expect(getFlightPhase([])).toBe('unknown');
    });
});

describe('Radiosonde shadow anchoring', () => {
    it('increases the lift with altitude and caps it, including missing and negative altitudes', () => {
        expect(markerLift(null)).toBe(markerLift(0));
        expect(markerLift(-10)).toBe(markerLift(0));
        expect(markerLift(5000)).toBeGreaterThan(markerLift(0));
        expect(markerLift(25000)).toBeGreaterThan(markerLift(5000));
        expect(markerLift(100000)).toBe(markerLift(35000));
    });

    it('anchors both flight symbols at the shadow and opens popups above the raised icon', () => {
        const ascending = createRadiosondeIcon({phase: 'ascending', altitude: 0, name: 'S'});
        const descending = createRadiosondeIcon({phase: 'descending', altitude: 35000, name: 'S'});
        expect(ascending.options.iconAnchor).toEqual([32.4, 32.4]);
        expect(descending.options.iconAnchor).toEqual(ascending.options.iconAnchor);
        expect(descending.options.popupAnchor[1]).toBeLessThan(ascending.options.popupAnchor[1]);
        expect(descending.options.html).not.toBe(ascending.options.html);
        expect(descending.options.shadowAnchor).toEqual(descending.options.iconAnchor);
        expect(descending.createIcon().querySelector('.packet-radiosonde-shadow')).toBeNull();
        expect(descending.createShadow().querySelector('.packet-radiosonde-shadow')).not.toBeNull();
    });
});
