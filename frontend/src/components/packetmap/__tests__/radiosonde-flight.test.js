import {describe, expect, it} from 'vitest';
import {radiosondeFlightAt} from '../radiosonde-flight.js';
import {buildPlaybackTrack} from '../playback.js';

const start = Date.parse('2026-11-01T12:00:00Z');
const fix = (seconds, values = {}) => ({transmitter_id: 'radiosonde:RS41:TEST', kind: 'radiosonde',
    latitude: 40 + seconds / 1000, longitude: 23, altitude: 20000,
    captured_at: new Date(start + seconds * 1000).toISOString(), ...values});
const latest = {id: 'radiosonde:RS41:TEST', kind: 'radiosonde', altitude: 18000,
    captured_at: new Date(start + 60000).toISOString(),
    details: {telemetry: {alt: 18000, vel_h: 25, vel_v: -10, heading: 100}}};

describe('Radiosonde flight samples', () => {
    it('holds recorded flight readings while interpolating altitude and position with the map', () => {
        const track = buildPlaybackTrack([
            fix(0, {groundspeed_mps: 12, vertical_rate_mps: 5, track_deg: 80}),
            fix(60, {altitude: 20300, groundspeed_mps: 25, vertical_rate_mps: -10, track_deg: 100}),
        ]);
        const flight = radiosondeFlightAt(latest, track, start + 30000);
        expect(flight).toMatchObject({groundSpeed: 12, verticalSpeed: 5, altitude: 20150,
            altitudeSource: 'reported', phase: 'climb', track: 80, age: 30, stale: false, historical: true});
        expect(flight.position.latitude).toBeGreaterThan(40);
        expect(flight.position.latitude).toBeLessThan(40.06);
        expect(flight.position.interpolated).toBe(true);
        expect(flight.receivedAt).toBe(start);
        expect(radiosondeFlightAt(latest, track, start + 60000)).toMatchObject({groundSpeed: 25,
            verticalSpeed: -10, phase: 'descent', symbolPhase: 'descending', track: 100});
    });

    it('never fills missing historical readings or a time before the first fix with latest telemetry', () => {
        const track = buildPlaybackTrack([fix(0)]);
        expect(radiosondeFlightAt(latest, track, start)).toMatchObject({groundSpeed: null,
            verticalSpeed: null, altitude: 20000, track: null, phase: 'unknown'});
        expect(radiosondeFlightAt(latest, track, start - 1000)).toMatchObject({groundSpeed: null,
            altitude: null, verticalSpeed: null, track: null, age: null});
        expect(radiosondeFlightAt(latest, null, start)).toMatchObject({groundSpeed: null, altitude: null});
    });

    it('reads live sonde telemetry, preserves zeros and uses capture time rather than the sonde clock', () => {
        const transmitter = {...latest, altitude: 0, details: {telemetry: {
            datetime: '2026-10-30T00:00:00Z', vel_h: 0, vel_v: 0, heading: -10,
        }}};
        expect(radiosondeFlightAt(transmitter, null, start + 62000, true)).toMatchObject({
            groundSpeed: 0, verticalSpeed: 0, altitude: 0, track: 350, phase: 'level', age: 2, stale: false,
        });
    });

    it('marks radiosondes stale after an hour using the original capture time even during interpolation', () => {
        const track = buildPlaybackTrack([fix(0), fix(7200)]);
        expect(radiosondeFlightAt(latest, track, start + 3600000).stale).toBe(false);
        expect(radiosondeFlightAt(latest, track, start + 3601000)).toMatchObject({
            age: 3601, stale: true, receivedAt: start, position: {interpolated: true},
        });
    });

    it('infers the symbol from altitude history without inventing a numerical rate', () => {
        const track = buildPlaybackTrack([fix(0), fix(60, {altitude: 19400})]);
        expect(radiosondeFlightAt(latest, track, start + 60000)).toMatchObject({
            phase: 'descent', symbolPhase: 'descending', verticalSpeed: null,
        });
        // A level reading does not reset a descending parachute symbol.
        expect(radiosondeFlightAt({...latest, details: {telemetry: {vel_v: 0}}}, track, start + 60000, true))
            .toMatchObject({phase: 'level', symbolPhase: 'descending', verticalSpeed: 0});
    });

    it('rejects non-finite readings and negative horizontal speed', () => {
        const transmitter = {...latest, altitude: NaN, details: {telemetry: {
            alt: Infinity, vel_h: -2, vel_v: Infinity, heading: NaN,
        }}};
        expect(radiosondeFlightAt(transmitter, null, start, true)).toMatchObject({
            groundSpeed: null, verticalSpeed: null, altitude: null, track: null, phase: 'unknown',
        });
    });
});
