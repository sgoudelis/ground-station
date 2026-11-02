/** Copyright (c) 2026 Efstratios Goudelis — GPL-3.0-or-later */

import {trackPositionAt} from './playback.js';
import {getFlightPhase} from './radiosonde-marker.js';

const finite = (value) => Number.isFinite(value) ? value : null;

export const SONDE_FLIGHT_TELEMETRY_FIELDS = new Set(['alt', 'vel_h', 'vel_v', 'heading']);

export function radiosondeFlightAt(transmitter, track, time, isLive = false) {
    const historical = !isLive && Number.isFinite(time);
    const cursor = Number.isFinite(time) ? time : Date.now();
    const sample = track?.points.findLast((point) => Date.parse(point.captured_at) <= cursor);
    // The sonde's own clock is not the capture clock. Use received samples and
    // never borrow the latest telemetry to fill missing historical readings.
    const report = historical ? {...sample?._details?.telemetry, ...sample}
        : {...transmitter, ...transmitter?.details?.telemetry};
    const verticalSpeed = finite(report.vertical_rate_mps) ?? finite(report.vel_v);
    const groundSpeed = finite(report.groundspeed_mps) ?? finite(report.vel_h);
    const heading = finite(report.track_deg) ?? finite(report.heading);
    const current = track ? trackPositionAt(track, cursor, verticalSpeed) : null;
    const position = historical ? current?.point : transmitter;
    const receivedAt = Date.parse(historical ? sample?.captured_at : transmitter?.captured_at);
    const age = Number.isFinite(receivedAt) ? Math.max(0, Math.floor((cursor - receivedAt) / 1000)) : null;
    const symbolPhase = current?.phase ?? getFlightPhase([], verticalSpeed);
    // Keep the status consistent with the reported rate. The map symbol can
    // retain the last known ascent/descent direction through level fixes.
    const measuredPhase = verticalSpeed === null ? symbolPhase : getFlightPhase([], verticalSpeed);
    const phase = measuredPhase === 'ascending' ? 'climb' : measuredPhase === 'descending' ? 'descent'
        : verticalSpeed !== null ? 'level' : 'unknown';
    return {
        kind: 'radiosonde', altitude: finite(position?.altitude) ?? (!historical ? finite(report.alt) : null),
        altitudeSource: 'reported', groundSpeed: groundSpeed !== null && groundSpeed >= 0 ? groundSpeed : null,
        verticalSpeed, track: heading === null ? null : ((heading % 360) + 360) % 360,
        phase, symbolPhase, position, report, receivedAt, age, historical,
        // Match the radiosonde map marker's one-hour timeout, rather than ADS-B's minute.
        stale: age !== null && age > 3600, onGround: false, geometric: null, squawk: null,
    };
}
