/** Copyright (c) 2026 Efstratios Goudelis — GPL-3.0-or-later */

import {trackPositionAt} from './playback.js';

const finite = (value) => Number.isFinite(value) ? value : null;

export const FLIGHT_TELEMETRY_FIELDS = new Set([
    'groundspeed_mps', 'vertical_rate_mps', 'track_deg', 'altitude_baro_m', 'altitude_geom_m', 'on_ground', 'squawk',
]);

export function aircraftFlightAt(transmitter, track, time, isLive = false) {
    const historical = !isLive && Number.isFinite(time);
    const cursor = Number.isFinite(time) ? time : Date.now();
    const current = track ? trackPositionAt(track, cursor) : null;
    const sample = track?.points.findLast((point) => Date.parse(point.captured_at) <= cursor);
    // Never backfill a historical sample with the aircraft's latest telemetry.
    // Legacy captures without flight fields must show missing measurements.
    const report = historical
        ? {...sample?._details?.telemetry, ...sample}
        : {...transmitter, ...transmitter?.details?.telemetry};
    const position = historical ? current?.point : current?.point ?? transmitter;
    const barometric = finite(report.altitude_baro_m);
    const geometric = finite(report.altitude_geom_m);
    const altitude = barometric ?? geometric ?? finite(report.altitude);
    const rawTrack = finite(report.track_deg);
    const receivedAt = historical ? Date.parse(sample?.captured_at)
        : Number.isFinite(report.timestamp) ? report.timestamp * 1000 : Date.parse(report.captured_at);
    const age = Number.isFinite(receivedAt) ? Math.max(0, Math.floor((cursor - receivedAt) / 1000)) : null;
    const verticalSpeed = finite(report.vertical_rate_mps);
    const groundSpeed = finite(report.groundspeed_mps);
    const onGround = report.on_ground === true;
    // Small reported variations around zero do not warrant a climb/descent label.
    const phase = onGround ? 'ground' : verticalSpeed === null ? 'unknown'
        : verticalSpeed > 0.5 ? 'climb' : verticalSpeed < -0.5 ? 'descent' : 'level';
    const code = typeof report.squawk === 'string' ? report.squawk.trim()
        : Number.isInteger(report.squawk) ? String(report.squawk) : '';
    return {
        altitude, altitudeSource: barometric !== null ? 'barometric' : geometric !== null ? 'geometric' : 'unknown',
        geometric, groundSpeed: groundSpeed !== null && groundSpeed >= 0 ? groundSpeed : null, verticalSpeed,
        track: rawTrack === null ? null : ((rawTrack % 360) + 360) % 360,
        onGround, phase, age, stale: age !== null && age > 60, receivedAt, historical,
        position, report, squawk: /^[0-7]{1,4}$/.test(code) ? code.padStart(4, '0') : null,
    };
}
