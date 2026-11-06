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
        expect(ascending.options.iconSize).toEqual([52.488, 52.488]);
        expect(ascending.options.iconSize[0]).toBeCloseTo(descending.options.iconSize[0] * 0.9);
        expect(ascending.options.iconAnchor).toEqual([26.244, 26.244]);
        expect(descending.options.iconSize).toEqual([58.32, 58.32]);
        expect(descending.options.iconAnchor).toEqual([29.16, 29.16]);
        expect(ascending.options.shadowAnchor).toEqual(ascending.options.iconAnchor);
        expect(descending.options.popupAnchor[1]).toBeLessThan(ascending.options.popupAnchor[1]);
        expect(descending.options.html).not.toBe(ascending.options.html);
        expect(descending.options.shadowAnchor).toEqual(descending.options.iconAnchor);
        expect(descending.createIcon().querySelector('.packet-radiosonde-shadow')).toBeNull();
        expect(descending.createShadow().querySelector('.packet-radiosonde-shadow')).not.toBeNull();
    });

    it('keeps selection around the flight symbol through descent, staleness and deselection without marking its shadow', () => {
        const options = {phase: 'ascending', altitude: 12000, name: 'BALLOON'};
        const initial = createRadiosondeIcon(options).createIcon();
        expect(initial.querySelector('.packet-radiosonde-crosshair')).toBeNull();
        const ascending = createRadiosondeIcon({...options, selected: true});
        const marker = ascending.createIcon(initial);
        expect(marker).toBe(initial);
        expect(marker.querySelector('.packet-radiosonde-crosshair')).toHaveAttribute('viewBox', '0 0 76.488 76.488');
        expect(marker.querySelector('.packet-radiosonde-selected')).not.toBeNull();
        // The frame must not inherit the image's stale filters or ground-shadow styling.
        expect(marker.querySelector('.packet-radiosonde-symbol svg')).toBeNull();
        expect(ascending.createShadow().querySelector('.packet-radiosonde-crosshair')).toBeNull();
        const descending = createRadiosondeIcon({...options, phase: 'descending', selected: true, stale: true});
        descending.createIcon(marker);
        expect(marker).toHaveClass('packet-marker-stale');
        expect(marker.querySelectorAll('.packet-radiosonde-crosshair')).toHaveLength(1);
        expect(marker.querySelector('.packet-radiosonde-crosshair')).toHaveAttribute('viewBox', '0 0 82.32 82.32');
        expect(marker.querySelector('img').src).toContain('parachute.png');
        createRadiosondeIcon(options).createIcon(marker);
        expect(marker.querySelector('.packet-radiosonde-crosshair')).toBeNull();
        expect(marker.querySelector('.packet-radiosonde-selected')).toBeNull();
    });
});
