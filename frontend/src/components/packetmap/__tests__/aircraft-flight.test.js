import {describe, expect, it} from 'vitest';
import {aircraftFlightAt} from '../aircraft-flight.js';
import {buildPlaybackTrack} from '../playback.js';

const start = Date.parse('2026-11-01T12:00:00Z');
const fix = (seconds, values = {}) => ({transmitter_id: 'adsb:4d2406', kind: 'adsb',
    latitude: 40 + seconds / 100, longitude: 23, altitude: 11000,
    captured_at: new Date(start + seconds * 1000).toISOString(), ...values});
const latest = {id: 'adsb:4d2406', kind: 'adsb', captured_at: new Date(start + 60000).toISOString(),
    details: {telemetry: {groundspeed_mps: 250, vertical_rate_mps: -10, altitude_baro_m: 10000,
        squawk: '7700', emergency: 'general', track_deg: 100}}};

describe('Aircraft flight samples', () => {
    it('uses the selected recorded sample for every instrument and emergency, with the map interpolated position', () => {
        const track = buildPlaybackTrack([
            fix(0, {groundspeed_mps: 200, vertical_rate_mps: 5, altitude_baro_m: 10500, track_deg: 326, squawk: '0042'}),
            fix(60, {groundspeed_mps: 250, vertical_rate_mps: -10, squawk: '7700'}),
        ]);
        const flight = aircraftFlightAt(latest, track, start + 30000);
        expect(flight).toMatchObject({groundSpeed: 200, verticalSpeed: 5, altitude: 10500,
            altitudeSource: 'barometric', phase: 'climb', track: 326, squawk: '0042', age: 30, stale: false});
        expect(flight.report.emergency).toBeUndefined();
        expect(flight.position.latitude).toBeGreaterThan(40);
        expect(flight.position.latitude).toBeLessThan(40.6);
        expect(flight.receivedAt).toBe(start);
        expect(aircraftFlightAt(latest, track, start + 60000)).toMatchObject({groundSpeed: 250, verticalSpeed: -10, squawk: '7700'});
    });

    it('never fills missing historical measurements or a time before the first fix with latest telemetry', () => {
        const track = buildPlaybackTrack([fix(0)]);
        expect(aircraftFlightAt(latest, track, start)).toMatchObject({groundSpeed: null, verticalSpeed: null,
            altitude: 11000, altitudeSource: 'unknown', squawk: null, track: null});
        expect(aircraftFlightAt(latest, track, start - 1000)).toMatchObject({groundSpeed: null, altitude: null, age: null});
        expect(aircraftFlightAt(latest, null, start)).toMatchObject({groundSpeed: null, altitude: null});
    });

    it('marks old fixes stale using their original reception time, even when position is interpolated', () => {
        const track = buildPlaybackTrack([fix(0), fix(120)]);
        const flight = aircraftFlightAt(latest, track, start + 90000);
        expect(flight.position.interpolated).toBe(true);
        expect(flight).toMatchObject({stale: true, age: 90, receivedAt: start});
    });

    it('uses fresh live telemetry, preserves zero and ground status, and normalizes track and squawk', () => {
        const transmitter = {...latest, details: {telemetry: {timestamp: start / 1000,
            groundspeed_mps: 0, vertical_rate_mps: 0, altitude_geom_m: 0, on_ground: true,
            track_deg: -10, squawk: 42}}};
        expect(aircraftFlightAt(transmitter, null, start + 2000, true)).toMatchObject({groundSpeed: 0,
            verticalSpeed: 0, altitude: 0, geometric: 0, altitudeSource: 'geometric', onGround: true,
            phase: 'ground', age: 2, stale: false, track: 350, squawk: '0042'});
    });

    it('rejects non-finite readings and negative ground speed instead of drawing fabricated values', () => {
        const transmitter = {...latest, details: {telemetry: {groundspeed_mps: -2, vertical_rate_mps: Infinity,
            altitude_baro_m: NaN, altitude_geom_m: null, track_deg: Infinity, squawk: '8888'}}};
        expect(aircraftFlightAt(transmitter, null, start, true)).toMatchObject({groundSpeed: null, verticalSpeed: null,
            altitude: null, track: null, squawk: null, phase: 'unknown'});
    });

    it('does not refresh position age when live telemetry arrives without a new position', () => {
        const transmitter = {...latest, details: {telemetry: {timestamp: (start + 90000) / 1000,
            position_timestamp: start / 1000, groundspeed_mps: 200}}};
        const track = buildPlaybackTrack([fix(0)]);
        expect(aircraftFlightAt(transmitter, track, start + 90000, true)).toMatchObject({
            age: 90, stale: true, receivedAt: start, groundSpeed: 200,
        });
    });
});
