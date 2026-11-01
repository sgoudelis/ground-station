import {expect, it} from 'vitest';
import {aircraftValue} from './aircraft-metadata.js';

const t = (_key, fallback) => fallback;

it('keeps military status independent of aircraft class and broadcast category', () => {
    const aircraft = {military_status: 'military', aircraft_class: 'L', category: 'B1', engine_count: 0};
    expect(aircraftValue(aircraft, 'military_status', t)).toBe('Military');
    expect(aircraftValue(aircraft, 'aircraft_class', t)).toBe('Landplane');
    expect(aircraftValue(aircraft, 'category', t)).toBe('Glider / sailplane');
    expect(aircraftValue(aircraft, 'engine_count', t)).toBe('0');
    expect(aircraftValue({military_status: 'unclassified'}, 'military_status', t)).toBe('Unclassified');
    expect(aircraftValue({category: 'A6'}, 'category', t)).toBe('High-performance aircraft');
});

it('shows absent and reserved categories as unknown without inventing ownership', () => {
    expect(aircraftValue({category: 'B5'}, 'category', t)).toBe('Unknown');
    expect(aircraftValue({category: 'A0'}, 'category', t)).toBe('Unknown');
    expect(aircraftValue({}, 'operator_name', t)).toBe('—');
    expect(aircraftValue({interesting: false}, 'interesting', t)).toBe('No');
    expect(aircraftValue({engine_type: 'J'}, 'engine_type', t)).toBe('Jet');
    expect(aircraftValue({wake_category: 'M'}, 'wake_category', t)).toBe('Medium');
});

it.each([
    [{military_status: 'military', category: 'A7'}, 'Military · Rotorcraft'],
    [{military_status: 'military', interesting: true, aircraft_class: 'H'}, 'Military · Interesting · Helicopter'],
    [{interesting: true}, 'Interesting'],
    [{category: 'B1'}, 'Glider / sailplane'],
    [{category: 'B3'}, 'Ultralight / hang-glider / paraglider'],
    [{category: 'B6'}, 'Unmanned aircraft'],
    [{category: 'A0', aircraft_class: 'D'}, 'Drone'],
    [{category: 'A7', aircraft_class: 'L'}, 'Rotorcraft'],
    [{category: 'B5', aircraft_class: '?'}, 'Unclassified'],
    [{military_status: 'unclassified', operator_name: 'Airline', model: 'Cessna 172'}, 'Unclassified'],
    [undefined, 'Unclassified'],
])('combines known classifications without guessing civilian or recreational use: %j', (aircraft, expected) => {
    expect(aircraftValue(aircraft, 'classification', t)).toBe(expected);
});
