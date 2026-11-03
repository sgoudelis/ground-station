import {expect, it} from 'vitest';
import {createTransmitterListRows, filterTransmitterList} from '../transmitter-list-data.js';

it('reuses unchanged models across snapshot replacements without traversing unrelated decoder data', () => {
    const prepare = createTransmitterListRows();
    const receiver = {lat: 40, lon: 23};
    const unrelated = {};
    Object.defineProperty(unrelated, 'expensive', {enumerable: true, get: () => {throw new Error('Unrelated details read');}});
    const rows = [{id: 'mesh', name: 'NODE', kind: 'meshtastic', latitude: 40, longitude: 23,
        details: {telemetry: {sats_in_view: 0}, additional: unrelated}}];
    const first = prepare(rows, receiver);
    expect(first[0].distance).toBe(0);
    expect(prepare(rows.map((row) => ({...row, details: {...row.details}})), {...receiver})).toBe(first);
    const changed = prepare([{...rows[0], details: {telemetry: {sats_in_view: 9}}}], receiver);
    expect(changed[0]).not.toBe(first[0]);
    expect(changed[0].satellites).toBe(9);
    expect(prepare(rows, {lat: 41, lon: 23})[0].distance).toBeGreaterThan(100);
    prepare([], receiver);
    expect(prepare(rows, receiver)[0]).not.toBe(first[0]);
});

it('uses deterministic numeric distance sorting with missing coordinates last and stable discovery order', () => {
    const prepare = createTransmitterListRows();
    const rows = prepare([
        {id: 'far', name: 'Far', kind: 'aprs', latitude: 42, longitude: 23, first_seen: '2026-11-02T12:00:00Z'},
        {id: 'unknown', name: 'Unknown', kind: 'aprs', first_seen: '2026-11-02T11:00:00Z'},
        {id: 'near', name: 'Near', kind: 'meshtastic', latitude: 40, longitude: 23, first_seen: '2026-11-02T10:00:00Z'},
    ], {lat: 40, lon: 23});
    expect(filterTransmitterList(rows, '', [], 'distance').map(({id}) => id)).toEqual(['near', 'far', 'unknown']);
    expect(filterTransmitterList(rows, '', [], 'first_seen').map(({id}) => id)).toEqual(['far', 'unknown', 'near']);
    expect(filterTransmitterList(rows, '', ['aprs'], 'name').map(({id}) => id)).toEqual(['near']);
});

it('keeps new aircraft and sonde fields cached while reacting to optional telemetry changes', () => {
    const prepare = createTransmitterListRows();
    const plane = {id: 'plane', kind: 'adsb', aircraft: {operator_callsign: 'AEGEAN', operator_country: 'Greece'},
        details: {readsb: {nav_altitude_fms: 30000, nav_heading: 0, geom_rate: 0, tat: -12.5, nav_modes: ['autopilot', 'lnav']}}};
    const sonde = {id: 'sonde', kind: 'radiosonde', details: {
        telemetry: {freq: 403500}, vfo: {center_freq_hz: 403600000},
    }};
    const first = prepare([plane, sonde]);
    expect(first[0].targetAltitude).toBe(30000);
    expect(first[0].selectedHeading).toBe(0);
    expect(first[0].geometricVertical).toBe(0);
    expect(first[0].totalTemperature).toBe(-12.5);
    expect(first[0].navigationModes).toBe('AUTOPILOT · LNAV');
    expect(filterTransmitterList(first, 'aegean greece', [], 'name').map((row) => row.id)).toEqual(['plane']);
    expect(first[1].transmitFrequency).toBe(403500);
    expect(first[1].frequency).toBe(403600000);
    expect(prepare([structuredClone(plane), structuredClone(sonde)])).toBe(first);
    const changed = prepare([{...plane, details: {readsb: {nav_altitude_mcp: 0, nav_altitude_fms: 30000, geom_rate: 1000}}}, sonde]);
    expect(changed[0].targetAltitude).toBe(0);
    expect(changed[0].geometricVertical).toBeCloseTo(5.08);
    expect(changed[0].navigationModes).toBe('');
    expect(changed[0]).not.toBe(first[0]);
    expect(changed[1]).toBe(first[1]);
    const cleared = prepare([{...plane, details: {}}, {...sonde, details: {telemetry: {tx_frequency: 404000}}}]);
    expect(cleared[0].targetAltitude).toBeNull();
    expect(cleared[1].transmitFrequency).toBe(404000);
});
