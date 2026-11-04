/** Copyright (c) 2026 Efstratios Goudelis — GPL-3.0-or-later */

import {smoothTrackSegments} from './track-path.js';
import {getFlightPhase} from './radiosonde-marker.js';
import {AIRCRAFT_EXPIRY_MS} from './live.js';
import {aircraftReceptionAt} from './reception.js';

const staleAfter = 60 * 60 * 1000;

// Use the same projection as Leaflet's paths so an interpolated marker stays
// on the drawn segment, including at high latitudes.
const mercatorY = (latitude) => Math.log(Math.tan(Math.PI / 4 + Math.max(-85.051129, Math.min(85.051129, latitude)) * Math.PI / 360));
const latitudeAtY = (y) => (2 * Math.atan(Math.exp(y)) - Math.PI / 2) * 180 / Math.PI;
const mix = (start, end, fraction) => start + (end - start) * fraction;

export function buildPlaybackTrack(fixes, {smooth = true} = {}) {
    const points = fixes.filter((point) => Number.isFinite(Date.parse(point.captured_at)))
        .sort((left, right) => Date.parse(left.captured_at) - Date.parse(right.captured_at));
    const times = points.map((point) => Date.parse(point.captured_at));
    const coordinates = points.map((point) => [point.latitude, point.longitude]);
    // Unselected aircraft need a timestamp index, not thousands of curve vertices.
    if (!smooth) {
        return {points, times, samples: coordinates.map((position, index) => ({time: times[index], position,
            breakBefore: index > 0 && points[index].kind === 'adsb'
                && (times[index] - times[index - 1] > AIRCRAFT_EXPIRY_MS
                    || Math.abs(points[index].longitude - points[index - 1].longitude) > 180),
        })), path: coordinates};
    }
    const samples = [];
    let start = 0;
    for (let end = 1; end <= points.length; end++) {
        // Smooth separate observed flights independently. A later reception
        // must never draw an invented segment across an expired aircraft gap.
        const boundary = end === points.length || points[end - 1].kind === 'adsb'
            && (times[end] - times[end - 1] > AIRCRAFT_EXPIRY_MS
                || Math.abs(points[end].longitude - points[end - 1].longitude) > 180);
        if (!boundary) continue;
        samples.push({time: times[start], position: coordinates[start], breakBefore: start > 0});
        smoothTrackSegments(coordinates.slice(start, end)).forEach((segment, index) => {
            segment.slice(1).forEach((position, sample) => samples.push({
                time: mix(times[start + index], times[start + index + 1], (sample + 1) / (segment.length - 1)), position,
            }));
        });
        start = end;
    }
    const path = samples.map((sample) => sample.position).filter((point, index, all) => index === 0
        || point[0] !== all[index - 1][0] || point[1] !== all[index - 1][1]);
    return {points, times, samples, path};
}

// Return the last sample at or before the cursor. Equal timestamps choose the
// final fix deterministically and never cause a zero-duration interpolation.
function atOrBefore(values, time, getTime = (value) => value) {
    let low = 0;
    let high = values.length;
    while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if (getTime(values[middle]) <= time) low = middle + 1;
        else high = middle;
    }
    return low - 1;
}

export function trackPositionAt(track, time, latestVerticalSpeed) {
    const {points, times, samples} = track;
    if (!points.length) return null;
    const cursor = Number.isFinite(time) ? time : times.at(-1);
    const index = atOrBefore(times, cursor);
    // There is no known position before this transmitter's first capture.
    if (index < 0) return null;
    const previous = points[index];
    const next = points[index + 1];
    const aircraft = previous.kind === 'adsb';
    const reception = aircraft ? aircraftReceptionAt(times, cursor) : null;
    // Expiry follows the cursor, so old recordings reappear when replayed.
    if (reception?.status === 'expired') return null;
    // A long reception gap is not evidence that the aircraft flew this segment.
    const interpolate = next && (!aircraft || times[index + 1] - times[index] <= AIRCRAFT_EXPIRY_MS);
    let point = previous;
    let verticalSpeed;
    if (interpolate && Number.isFinite(previous.altitude) && Number.isFinite(next.altitude)) {
        verticalSpeed = (next.altitude - previous.altitude) / ((times[index + 1] - times[index]) / 1000);
    }
    if (interpolate && cursor > times[index] && Math.abs(previous.longitude - next.longitude) <= 180) {
        const fraction = (cursor - times[index]) / (times[index + 1] - times[index]);
        const sampleIndex = atOrBefore(samples, cursor, (sample) => sample.time);
        const left = samples[sampleIndex];
        const right = samples[sampleIndex + 1];
        const progress = (cursor - left.time) / (right.time - left.time);
        const altitude = Number.isFinite(previous.altitude) && Number.isFinite(next.altitude)
            ? mix(previous.altitude, next.altitude, fraction) : null;
        point = {...previous, latitude: latitudeAtY(mix(mercatorY(left.position[0]), mercatorY(right.position[0]), progress)),
            longitude: mix(left.position[1], right.position[1], progress), altitude,
            captured_at: new Date(cursor).toISOString(), interpolated: true};
    }
    // Latest telemetry belongs only to the endpoint. Replaying the ascent must
    // not inherit a parachute from the most recent descent packet.
    if (!next) verticalSpeed = latestVerticalSpeed;
    const measuredPhase = aircraft ? 'unknown' : getFlightPhase([], verticalSpeed);
    const phase = measuredPhase === 'unknown'
        && !aircraft ? getFlightPhase([...points.slice(0, index + 1), ...(point === previous ? [] : [point])]) : measuredPhase;
    // Interpolation changes captured_at for display, but cannot refresh a node.
    // Aircraft update much faster than sondes. Match their live cache's
    // one-minute timeout without removing the recorded path from playback.
    const stale = aircraft ? reception.status === 'lost' : cursor - times[index] > staleAfter;
    return {point, phase, stale};
}

export function aircraftPathsAt(track, time, current = trackPositionAt(track, time)) {
    if (!current) return [];
    const cursor = Number.isFinite(time) ? time : track.times.at(-1);
    const paths = [];
    let path;
    for (const sample of track.samples) {
        if (sample.time > cursor) break;
        if (!path || sample.breakBefore) paths.push(path = []);
        const previous = path.at(-1);
        if (!previous || previous[0] !== sample.position[0] || previous[1] !== sample.position[1]) path.push(sample.position);
    }
    // Include the interpolated endpoint so the line ends exactly at the icon,
    // including between the curve's sampled vertices.
    const endpoint = [current.point.latitude, current.point.longitude];
    const last = path?.at(-1);
    if (last && (last[0] !== endpoint[0] || last[1] !== endpoint[1])) path.push(endpoint);
    return paths;
}
