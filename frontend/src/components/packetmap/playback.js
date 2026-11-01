/** Copyright (c) 2026 Efstratios Goudelis — GPL-3.0-or-later */

import {smoothTrackSegments} from './track-path.js';
import {getFlightPhase} from './radiosonde-marker.js';

// Use the same projection as Leaflet's paths so an interpolated marker stays
// on the drawn segment, including at high latitudes.
const mercatorY = (latitude) => Math.log(Math.tan(Math.PI / 4 + Math.max(-85.051129, Math.min(85.051129, latitude)) * Math.PI / 360));
const latitudeAtY = (y) => (2 * Math.atan(Math.exp(y)) - Math.PI / 2) * 180 / Math.PI;
const mix = (start, end, fraction) => start + (end - start) * fraction;

export function buildPlaybackTrack(fixes) {
    const points = fixes.filter((point) => Number.isFinite(Date.parse(point.captured_at)))
        .sort((left, right) => Date.parse(left.captured_at) - Date.parse(right.captured_at));
    const times = points.map((point) => Date.parse(point.captured_at));
    const coordinates = points.map((point) => [point.latitude, point.longitude]);
    const samples = points.length ? [{time: times[0], position: coordinates[0]}] : [];
    smoothTrackSegments(coordinates).forEach((segment, index) => {
        segment.slice(1).forEach((position, sample) => samples.push({
            time: mix(times[index], times[index + 1], (sample + 1) / (segment.length - 1)), position,
        }));
    });
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
    let point = previous;
    let verticalSpeed;
    if (next && Number.isFinite(previous.altitude) && Number.isFinite(next.altitude)) {
        verticalSpeed = (next.altitude - previous.altitude) / ((times[index + 1] - times[index]) / 1000);
    }
    if (next && cursor > times[index] && Math.abs(previous.longitude - next.longitude) <= 180) {
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
    const measuredPhase = getFlightPhase([], verticalSpeed);
    const phase = measuredPhase === 'unknown'
        ? getFlightPhase([...points.slice(0, index + 1), ...(point === previous ? [] : [point])]) : measuredPhase;
    return {point, phase};
}
