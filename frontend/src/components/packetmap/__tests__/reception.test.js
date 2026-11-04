import {expect, it} from 'vitest';
import {aircraftReceptionAt, aircraftReceptionIndex} from '../reception.js';

const start = Date.parse('2026-11-01T12:00:00Z');

it.each([
    [-1, 'upcoming'], [0, 'receiving'], [60000, 'receiving'], [60001, 'lost'],
    [1800000, 'lost'], [1800001, 'expired'], [7200000, 'receiving'],
])('uses observed fixes at cursor offset %i for aircraft status %s', (offset, status) => {
    expect(aircraftReceptionAt([start, start + 7200000], start + offset).status).toBe(status);
});

it('indexes fixes per aircraft without mutating positions or letting a future fix refresh a gap', () => {
    const point = (id, offset, kind = 'adsb') => ({transmitter_id: id, kind,
        captured_at: new Date(start + offset).toISOString()});
    const positions = [point('A', 7200000), point('B', 1000), point('A', 0), point('S', 0, 'radiosonde')];
    const original = [...positions];
    const index = aircraftReceptionIndex(positions);
    expect(index.size).toBe(2);
    expect(positions).toEqual(original);
    expect(aircraftReceptionAt(index.get('A'), start + 1800001)).toMatchObject({status: 'expired', jumpTime: start});
    expect(aircraftReceptionAt(index.get('B'), start)).toMatchObject({status: 'upcoming', jumpTime: start + 1000});
    expect(aircraftReceptionAt([], start).status).toBe('unknown');
});
