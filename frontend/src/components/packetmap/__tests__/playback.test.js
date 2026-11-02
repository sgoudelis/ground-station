import {describe, expect, it} from 'vitest';
import {CRS, latLng} from 'leaflet';
import {buildPlaybackTrack, trackPositionAt} from '../playback.js';
import {smoothTrack} from '../track-path.js';

const epoch = Date.parse('2026-11-01T00:00:00Z');
const fix = (seconds, latitude, longitude, altitude = null) => ({
    id: `${seconds}:${latitude}:${longitude}`, captured_at: new Date(epoch + seconds * 1000).toISOString(),
    latitude, longitude, altitude, kind: 'radiosonde',
});
const at = (track, seconds, speed) => trackPositionAt(track, epoch + seconds * 1000, speed);

describe('Transmitter playback', () => {
    it('marks a node stale only after an hour since the last received fix', () => {
        const track = buildPlaybackTrack([fix(0, 40, 20)]);
        expect(at(track, 3599).stale).toBe(false);
        expect(at(track, 3600).stale).toBe(false);
        expect(at(track, 3600.001).stale).toBe(true);
        expect(at(track, 1800).stale).toBe(false);
    });

    it('does not let interpolation or a future fix refresh an inactive node', () => {
        const track = buildPlaybackTrack([fix(0, 40, 20), fix(7200, 41, 21)]);
        const current = at(track, 3601);
        expect(current.point.interpolated).toBe(true);
        expect(Date.parse(current.point.captured_at)).toBe(epoch + 3601000);
        expect(current.stale).toBe(true);
        expect(at(track, 7200).stale).toBe(false);
        expect(at(track, 10800).stale).toBe(false);
        expect(at(track, 10801).stale).toBe(true);
    });

    it('moves on the displayed smooth path, preserves recorded fixes and interpolates altitude', () => {
        const points = [fix(0, 40, 20, 100), fix(10, 41, 21, 200), fix(30, 40, 22, 0)];
        const track = buildPlaybackTrack(points);
        expect(track.path).toEqual(smoothTrack(points.map((point) => [point.latitude, point.longitude])));
        const halfway = at(track, 5, -10);
        expect(track.path.some(([lat, lon]) => Math.abs(lat - halfway.point.latitude) < 1e-8
            && Math.abs(lon - halfway.point.longitude) < 1e-8)).toBe(true);
        expect(halfway.point.altitude).toBe(150);
        expect(halfway.phase).toBe('ascending');
        expect(halfway.point.interpolated).toBe(true);
        expect(at(track, 10).point).toBe(points[1]);
        expect(at(track, 20).point.altitude).toBe(100);
        expect(at(track, 20).phase).toBe('descending');
        expect(at(track, 30).point).toBe(points[2]);
        expect(at(track, 30, 5).phase).toBe('ascending');
    });

    it('stays on the map segment in Mercator projection between sampled curve vertices', () => {
        const track = buildPlaybackTrack([fix(0, 60, 20), fix(10, 80, 30)]);
        const current = at(track, 5).point;
        const projected = CRS.EPSG3857.latLngToPoint(latLng(current.latitude, current.longitude), 5);
        const from = CRS.EPSG3857.latLngToPoint(latLng(60, 20), 5);
        const to = CRS.EPSG3857.latLngToPoint(latLng(80, 30), 5);
        expect(projected.x).toBeCloseTo((from.x + to.x) / 2);
        expect(projected.y).toBeCloseTo((from.y + to.y) / 2);
        expect(current.altitude).toBeNull();
    });

    it('waits for a first fix and holds the last known location after the final capture', () => {
        const point = fix(10, 40, 20, 100);
        const track = buildPlaybackTrack([point]);
        expect(at(track, 9)).toBeNull();
        expect(at(track, 10).point).toBe(point);
        expect(at(track, 100).point).toBe(point);
        expect(trackPositionAt(track).point).toBe(point);
        expect(at(buildPlaybackTrack([]), 10)).toBeNull();
    });

    it('sorts captures, handles duplicate timestamps and pauses through stationary fixes', () => {
        const points = [fix(20, 41, 21, 200), fix(10, 40, 20, 100), fix(0, 40, 20, 0)];
        const track = buildPlaybackTrack(points);
        expect(at(track, 5).point.latitude).toBeCloseTo(40);
        expect(at(track, 5).point.longitude).toBeCloseTo(20);
        expect(at(track, 5).point.altitude).toBe(50);
        expect(at(track, 10).point).toBe(points[1]);
        expect(points[0].captured_at).toBe(fix(20, 41, 21).captured_at);
        const sameTime = buildPlaybackTrack([fix(0, 40, 20), fix(0, 41, 21), fix(10, 42, 22)]);
        expect(at(sameTime, 0).point.latitude).toBe(41);
        expect(Number.isFinite(at(sameTime, 5).point.latitude)).toBe(true);
    });

    it('does not interpolate across a longitude discontinuity or accept invalid dates', () => {
        const track = buildPlaybackTrack([fix(0, 40, 179), fix(10, 41, -179), {...fix(20, 42, -178), captured_at: 'invalid'}]);
        expect(at(track, 5).point.longitude).toBe(179);
        expect(at(track, 10).point.longitude).toBe(-179);
        expect(track.points).toHaveLength(2);
    });
});

it('expires aircraft relative to the playback cursor and restores them when scrubbing back', () => {
    const points = [fix(0, 40, 20), fix(7200, 42, 22)].map((point) => ({...point, kind: 'adsb'}));
    const track = buildPlaybackTrack(points);
    expect(at(track, 60).stale).toBe(false);
    expect(at(track, 61).stale).toBe(true);
    // Long reception gaps hold the observed position instead of inventing movement.
    expect(at(track, 900).point).toBe(points[0]);
    expect(at(track, 1800)).not.toBeNull();
    expect(at(track, 1800.001)).toBeNull();
    expect(at(track, 7200).point).toBe(points[1]);
    expect(at(track, 0).point).toBe(points[0]);
});

it('supports lightweight aircraft interpolation without generating smoothed geometry', () => {
    const points = [fix(0, 40, 20, 100), fix(10, 41, 21, 200), fix(20, 40, 22, 300)]
        .map((point) => ({...point, kind: 'adsb'}));
    const track = buildPlaybackTrack(points, {smooth: false});
    expect(track.path).toEqual([[40, 20], [41, 21], [40, 22]]);
    expect(at(track, 5).point.altitude).toBe(150);
    expect(at(track, 10).point).toBe(points[1]);
});
