/** Copyright (c) 2026 Efstratios Goudelis — GPL-3.0-or-later */

export const TRANSMITTER_TYPES = {
    adsb: {label: 'ADS-B', color: '#66bb6a'},
    aprs: {label: 'APRS', color: '#29b6f6'},
    radiosonde: {label: 'Radiosonde', color: '#ff9800'},
};

export const typeLabel = (kind) => TRANSMITTER_TYPES[kind]?.label || kind;
export const typeColor = (kind) => TRANSMITTER_TYPES[kind]?.color || '#ab47bc';

export function transmitterRows(positions, transmitters) {
    if (Array.isArray(transmitters)) return transmitters;
    // Older running servers may still return positions only until restarted.
    const rows = new Map();
    for (const point of [...positions].sort((a, b) => a.captured_at.localeCompare(b.captured_at))) {
        const previous = rows.get(point.transmitter_id);
        rows.set(point.transmitter_id, {
            ...point,
            id: point.transmitter_id,
            first_seen: previous?.first_seen || point.captured_at,
            last_seen: point.captured_at,
            packet_count: (previous?.packet_count || 0) + 1,
            details: {},
        });
    }
    return [...rows.values()];
}

export function flattenDetails(details, prefix = '') {
    const fields = {};
    for (const [key, value] of Object.entries(details || {})) {
        if (value === null || value === undefined || value === '') continue;
        const path = prefix ? `${prefix}.${key}` : key;
        if (typeof value === 'object' && !Array.isArray(value)) {
            Object.assign(fields, flattenDetails(value, path));
        } else {
            fields[path] = Array.isArray(value) ? JSON.stringify(value) : value;
        }
    }
    return fields;
}

export function detailLabel(path, fieldInfo = {}) {
    const key = path.startsWith('telemetry.') ? path.slice('telemetry.'.length) : null;
    const info = key ? fieldInfo[key] : null;
    if (info?.label) return `${info.label}${info.unit ? ` (${info.unit})` : ''}`;
    return path.split('.').map((part) => part.replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase())).join(' · ');
}
