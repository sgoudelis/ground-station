/** Copyright (c) 2026 Efstratios Goudelis — GPL-3.0-or-later */

import {LIVE_WINDOW_MS} from './live.js';
import {transmitterRows} from './transmitters.js';

function aircraftPoint(record) {
    const stamp = record.position_timestamp * 1000;
    const transmitterId = `adsb:${record.icao}`;
    return {
        id: `${transmitterId}:${stamp}`, file_id: `decoded_folder:adsb_${record.icao}`,
        transmitter_id: transmitterId, kind: 'adsb', name: record.callsign || record.icao.toUpperCase(),
        source: record.icao.toUpperCase(), captured_at: new Date(stamp).toISOString(),
        latitude: record.latitude, longitude: record.longitude,
        altitude: record.altitude_geom_m ?? record.altitude_baro_m,
        track_deg: record.track_deg,
        altitude_baro_m: record.altitude_baro_m ?? null,
        altitude_geom_m: record.altitude_geom_m ?? null,
        groundspeed_mps: record.groundspeed_mps ?? null,
        vertical_rate_mps: record.vertical_rate_mps ?? null,
        on_ground: record.on_ground ?? null,
        squawk: record.squawk ?? null,
        emergency: record.emergency ?? null,
        aircraft: record.aircraft,
    };
}

export function mergeAircraftHistory(positions, transmitters, live, range,
    {now = Date.now(), selectedTransmitterId = null, previous} = {}) {
    if (range.end !== null) return {positions, transmitters};
    const cutoff = now - LIVE_WINDOW_MS;
    const latest = new Map();
    const trail = new Map();
    const add = (point) => {
        const stamp = Date.parse(point.captured_at);
        if (!Number.isFinite(stamp) || stamp < cutoff) return;
        const id = point.transmitter_id;
        if (!latest.has(id) || stamp >= latest.get(id).stamp) latest.set(id, {point, stamp});
        if (id === selectedTransmitterId) trail.set(stamp, point);
    };
    // Retain one fix per quiet aircraft after the shared one-minute live cache
    // expires it. Only the selected aircraft carries a trail through updates.
    for (const point of positions) if (point.kind === 'adsb') add(point);
    for (const point of previous?.positions || []) if (point.kind === 'adsb') add(point);
    // Avoid converting/sorting every aircraft's 120-point live buffer once per
    // second. Those points are useful only for the trail currently on screen.
    if (selectedTransmitterId) {
        for (const record of live.positions) {
            if (`adsb:${record.icao}` !== selectedTransmitterId) continue;
            const stamp = record.position_timestamp * 1000;
            if (Number.isFinite(stamp) && stamp >= cutoff
                && Number.isFinite(record.latitude) && Number.isFinite(record.longitude)) add(aircraftPoint(record));
        }
    }
    const records = new Map();
    // Telemetry may clear an emergency without a new position timestamp. Let
    // the latest report win over both saved fixes and the buffered trail.
    for (const record of live.aircraft) {
        const stamp = record.position_timestamp * 1000;
        if (!Number.isFinite(stamp) || stamp < cutoff || !Number.isFinite(record.latitude) || !Number.isFinite(record.longitude)) continue;
        records.set(`adsb:${record.icao}`, record);
        add(aircraftPoint(record));
    }
    const selectedTrail = [...trail.entries()].sort(([left], [right]) => left - right).slice(-5000).map(([, point]) => point);
    const aircraft = [...latest.entries()].filter(([id]) => id !== selectedTransmitterId || !selectedTrail.length)
        .map(([, {point}]) => point);
    const recent = positions.filter((point) => point.kind !== 'adsb' && Date.parse(point.captured_at) >= cutoff);
    const result = [...recent, ...aircraft, ...selectedTrail];
    const ids = new Set(result.map((point) => point.transmitter_id));
    const rows = new Map(transmitterRows(positions, transmitters).map((row) => [row.id, row]));
    for (const row of previous?.transmitters || []) if (row.kind === 'adsb') rows.set(row.id, row);
    for (const [id, {point}] of latest) {
        const old = rows.get(id);
        const record = records.get(id);
        rows.set(id, {...old, ...point, id,
            first_seen: old?.first_seen || point.captured_at,
            last_seen: point.captured_at, packet_count: old?.packet_count || 1,
            details: record ? {telemetry: {...record, readsb: undefined}, readsb: record.readsb} : old?.details || {},
        });
    }
    return {positions: result, transmitters: [...rows.values()].filter((row) => ids.has(row.id))};
}

export function createAircraftHistory() {
    let saved;
    let previous;
    return (positions, transmitters, live, range, options) => {
        // A replacement snapshot also reconciles deletions; never resurrect a
        // removed capture from this page's short-lived aircraft cache.
        if (saved !== positions) previous = undefined;
        saved = positions;
        previous = mergeAircraftHistory(positions, transmitters, live, range, {...options, previous});
        return previous;
    };
}
