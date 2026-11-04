/** Copyright (c) 2026 Efstratios Goudelis — GPL-3.0-or-later */

import {AIRCRAFT_EXPIRY_MS, AIRCRAFT_STALE_MS} from './live.js';

// Times are sorted once when positions change, so visible table rows can age
// with the cursor without rebuilding their telemetry models or sorting fixes.
export function aircraftReceptionIndex(positions) {
    const result = new Map();
    for (const point of positions) {
        const time = Date.parse(point.captured_at);
        if (point.kind !== 'adsb' || !Number.isFinite(time)) continue;
        if (!result.has(point.transmitter_id)) result.set(point.transmitter_id, []);
        result.get(point.transmitter_id).push(time);
    }
    for (const times of result.values()) times.sort((left, right) => left - right);
    return result;
}

export function aircraftReceptionAt(times, cursor) {
    if (!times.length || !Number.isFinite(cursor)) return {status: 'unknown', age: null, jumpTime: null};
    let low = 0;
    let high = times.length;
    while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if (times[middle] <= cursor) low = middle + 1;
        else high = middle;
    }
    if (!low) return {status: 'upcoming', age: null, jumpTime: times[0]};
    const receivedAt = times[low - 1];
    const age = Math.max(0, cursor - receivedAt);
    return {status: age > AIRCRAFT_EXPIRY_MS ? 'expired' : age > AIRCRAFT_STALE_MS ? 'lost' : 'receiving',
        age, jumpTime: receivedAt};
}

export function aircraftReceptionLabel(reception, t) {
    const minutes = Math.floor(reception.age / 60000);
    if (reception.status === 'upcoming') return t('packet_map.reception.upcoming', 'Not yet seen');
    if (reception.status === 'receiving') return t('packet_map.reception.receiving', 'Receiving');
    if (reception.status === 'lost') return t('packet_map.reception.lost', {
        defaultValue: 'Signal lost · {{minutes}}m ago', minutes,
    });
    if (reception.status === 'expired') return t('packet_map.reception.expired', {
        defaultValue: 'Last seen · {{minutes}}m ago', minutes,
    });
    return t('packet_map.reception.unknown', 'No position');
}
