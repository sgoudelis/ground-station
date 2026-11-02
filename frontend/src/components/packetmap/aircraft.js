/** Merge bounded live trails without reloading the library's history snapshot. */
export function mergeAircraftHistory(positions, transmitters, live, range) {
    if (range.end !== null || !live.aircraft.length) return {positions, transmitters};
    const start = Date.parse(range.start);
    const points = new Map();
    for (const point of positions) {
        if (point.kind === 'adsb') points.set(`${point.transmitter_id}:${Date.parse(point.captured_at)}`, point);
    }
    for (const record of live.positions) {
        const stamp = record.position_timestamp * 1000;
        if (!Number.isFinite(stamp) || stamp < start) continue;
        const transmitterId = `adsb:${record.icao}`;
        const point = {
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
        points.set(`${transmitterId}:${stamp}`, point);
    }
    const bounded = [...points.values()].sort((a, b) => Date.parse(a.captured_at) - Date.parse(b.captured_at)).slice(-5000);
    const latestPoints = new Map(bounded.map((point) => [point.transmitter_id, point]));
    const rows = new Map((transmitters || []).map((row) => [row.id, row]));
    for (const record of live.aircraft) {
        const id = `adsb:${record.icao}`;
        const latest = latestPoints.get(id);
        if (!latest) continue;
        const previous = rows.get(id);
        rows.set(id, {...previous, ...latest, id,
            first_seen: previous?.first_seen || latest.captured_at,
            last_seen: latest.captured_at, packet_count: previous?.packet_count || 1,
            details: {telemetry: {...record, readsb: undefined}, readsb: record.readsb},
        });
    }
    return {positions: [...positions.filter((point) => point.kind !== 'adsb'), ...bounded], transmitters: [...rows.values()]};
}
