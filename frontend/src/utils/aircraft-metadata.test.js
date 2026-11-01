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
