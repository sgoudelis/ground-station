import {describe, expect, it} from 'vitest';
import {packetActivityRanges} from '../timeline.js';

const start = Date.parse('2026-11-01T00:00:00Z');
const end = start + 320000;
const packet = (seconds, kind = 'aprs') => ({kind, captured_at: new Date(start + seconds * 1000).toISOString()});

describe('Packet timeline activity', () => {
    it('combines activity from all transmitters while preserving gaps in reception', () => {
        const positions = [packet(60, 'radiosonde'), packet(11), packet(10), packet(10.5), packet(61)];
        expect(packetActivityRanges(positions, start, end)).toEqual([
            {start: start + 10000, end: start + 12000},
            {start: start + 60000, end: start + 62000},
        ]);
        expect(positions[0].captured_at).toBe(packet(60).captured_at);
    });

    it('includes both query endpoints and ignores out-of-window or invalid timestamps', () => {
        expect(packetActivityRanges([
            packet(-1), packet(0), packet(320), packet(321), {captured_at: 'invalid'}, {},
        ], start, end)).toEqual([
            {start, end: start + 1000},
            {start: end - 1000, end},
        ]);
    });

    it('keeps large bursts bounded to their occupied timeline section', () => {
        const positions = Array.from({length: 10000}, () => packet(42.5));
        expect(packetActivityRanges(positions, start, end)).toEqual([
            {start: start + 42000, end: start + 43000},
        ]);
    });

    it('handles empty, invalid and instantaneous windows without inventing coverage', () => {
        expect(packetActivityRanges([], start, end)).toEqual([]);
        expect(packetActivityRanges([packet(0)], NaN, end)).toEqual([]);
        expect(packetActivityRanges([packet(0)], end, start)).toEqual([]);
        expect(packetActivityRanges([packet(0)], start, start)).toEqual([{start, end: start}]);
        expect(packetActivityRanges([packet(1)], start, start)).toEqual([]);
    });
});
