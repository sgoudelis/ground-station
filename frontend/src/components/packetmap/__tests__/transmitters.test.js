import {beforeEach, describe, expect, it} from 'vitest';
import {detailLabel, flattenDetails, transmitterRows} from '../transmitters.js';
import {columns, defaultLayouts, LAYOUT_SCHEMA_VERSION, loadLayouts} from '../layouts.js';
import {gridLayoutStoreName, mapViewStoreName} from '../storage.js';

beforeEach(() => localStorage.clear());

describe('Transmitter summaries', () => {
    it('groups an older server response by identity and reception time', () => {
        const points = [
            {id: 'last', transmitter_id: 'aprs:A', captured_at: '2026-11-01T02:00:00Z', latitude: 41},
            {id: 'other', transmitter_id: 'radiosonde:A', captured_at: '2026-11-01T01:00:00Z'},
            {id: 'first', transmitter_id: 'aprs:A', captured_at: '2026-11-01T00:00:00Z', latitude: 40},
        ];
        const rows = transmitterRows(points);
        expect(rows).toHaveLength(2);
        expect(rows.find((row) => row.id === 'aprs:A')).toMatchObject({
            latitude: 41, packet_count: 2, first_seen: points[2].captured_at, last_seen: points[0].captured_at,
        });
        expect(transmitterRows(points, [{id: 'server', details: {telemetry: {temp: -20}}}])[0].details.telemetry.temp).toBe(-20);
    });

    it('retains zero and false measurements and uses parser labels and units', () => {
        expect(flattenDetails({telemetry: {temp: 0, encrypted: false, absent: null}, frame: {path: ['A', 'B']}})).toEqual({
            'telemetry.temp': 0, 'telemetry.encrypted': false, 'frame.path': '["A","B"]',
        });
        expect(detailLabel('telemetry.temp', {temp: {label: 'Temperature', unit: '°C'}})).toBe('Temperature (°C)');
    });
});

describe('Three-window layouts', () => {
    it('puts transmitter info beside the map and the table below, stacking on phones', () => {
        for (const [breakpoint, layout] of Object.entries(defaultLayouts())) {
            const [map, info, table] = layout;
            expect(info.i).toBe('transmitter-info');
            expect(table.w).toBe(columns[breakpoint]);
            expect(table.y).toBeGreaterThanOrEqual(map.h);
            if (map.w === columns[breakpoint]) expect(info.y).toBe(map.h);
            else expect(info.x).toBe(map.w);
        }
    });

    it.each([undefined, 1, 2, LAYOUT_SCHEMA_VERSION + 1])('resets layouts with schema version %s without losing map navigation', (version) => {
        localStorage.setItem(mapViewStoreName, JSON.stringify({center: [40, 23], zoom: 8}));
        const layouts = defaultLayouts();
        layouts.lg[1] = {...layouts.lg[1], x: 32, y: 4, w: 16, h: 42};
        localStorage.setItem(gridLayoutStoreName, JSON.stringify({version, layouts}));
        expect(loadLayouts()).toEqual(defaultLayouts());
        expect(JSON.parse(localStorage.getItem(mapViewStoreName))).toEqual({center: [40, 23], zoom: 8});
    });

    it('preserves current-version custom geometry and rejects corrupt layouts', () => {
        const layouts = defaultLayouts();
        layouts.lg[2].h = 30;
        localStorage.setItem(gridLayoutStoreName, JSON.stringify({version: LAYOUT_SCHEMA_VERSION, layouts}));
        expect(loadLayouts().lg[2].h).toBe(30);
        layouts.md[1] = null;
        localStorage.setItem(gridLayoutStoreName, JSON.stringify({version: LAYOUT_SCHEMA_VERSION, layouts}));
        expect(loadLayouts()).toEqual(defaultLayouts());
    });
});
