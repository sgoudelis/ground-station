/** Copyright (c) 2026 Efstratios Goudelis — GPL-3.0-or-later */

import {getReceiverDistances} from '../filebrowser/position-utils.js';

export const transmitterSorts = ['first_seen', 'last_seen', 'name', 'distance'];
const finite = (value) => Number.isFinite(value) ? value : null;
const text = (value) => typeof value === 'string' ? value : '';
const same = (left, right) => {
    for (const key in right) if (!Object.is(left[key], right[key])) return false;
    return true;
};

function snapshot(row) {
    const telemetry = row.details?.telemetry ?? {};
    const position = telemetry.position ?? {};
    const aircraft = telemetry.aircraft ?? row.aircraft ?? {};
    const frame = row.details?.frame ?? {};
    const signal = row.details?.signal ?? {};
    const readsb = row.details?.readsb ?? {};
    const weather = telemetry.weather ?? {};
    const vfo = row.details?.vfo;
    const kind = row.kind;
    return {
        id: row.id, kind, name: text(row.name) || text(row.source) || row.id, source: text(row.source),
        first_seen: row.first_seen ?? row.captured_at, last_seen: row.last_seen ?? row.captured_at,
        captured_at: row.captured_at, packet_count: finite(row.packet_count),
        latitude: finite(row.latitude), longitude: finite(row.longitude), altitude: finite(row.altitude),
        registration: text(aircraft.registration), model: text(aircraft.type_code), operator: text(aircraft.operator_name),
        operatorCallsign: text(aircraft.operator_callsign), operatorCountry: text(aircraft.operator_country),
        fullModel: text(aircraft.model), owner: text(aircraft.owner), year: text(aircraft.year),
        military_status: text(aircraft.military_status), interesting: aircraft.interesting === true,
        type_description: text(aircraft.type_description), aircraft_class: text(aircraft.aircraft_class),
        engine_count: aircraft.engine_count, engine_type: text(aircraft.engine_type),
        category: text(aircraft.category), wake_category: text(aircraft.wake_category),
        // Explicit null telemetry clears older transponder state even without a new fix.
        squawk: kind === 'adsb' ? (Object.hasOwn(telemetry, 'squawk') ? telemetry.squawk : row.squawk) ?? null : null,
        emergency: kind === 'adsb' ? (Object.hasOwn(telemetry, 'emergency') ? telemetry.emergency : row.emergency) ?? null : null,
        speed: finite(kind === 'adsb' ? telemetry.groundspeed_mps ?? row.groundspeed_mps
            : kind === 'radiosonde' ? telemetry.vel_h ?? row.groundspeed_mps
                : kind === 'aprs' ? position.speed_knots : telemetry.ground_speed),
        vertical: finite(kind === 'adsb' ? telemetry.vertical_rate_mps ?? row.vertical_rate_mps
            : telemetry.vel_v ?? row.vertical_rate_mps),
        heading: finite(kind === 'adsb' ? telemetry.track_deg ?? row.track_deg
            : kind === 'aprs' ? position.course_degrees : telemetry.heading ?? telemetry.ground_track ?? row.track_deg),
        on_ground: (telemetry.on_ground ?? row.on_ground) === true,
        barometric: finite(telemetry.altitude_baro_m ?? row.altitude_baro_m),
        geometric: finite(telemetry.altitude_geom_m ?? row.altitude_geom_m),
        airspeed: finite(readsb.tas), indicatedSpeed: finite(readsb.ias), mach: finite(readsb.mach),
        magneticHeading: finite(readsb.mag_heading), trueHeading: finite(readsb.true_heading),
        // Keep readsb's optional navigation fields in their reported units (feet, knots, degrees).
        targetAltitude: finite(readsb.nav_altitude_mcp ?? readsb.nav_altitude_fms),
        selectedHeading: finite(readsb.nav_heading), qnh: finite(readsb.nav_qnh),
        roll: finite(readsb.roll), trackRate: finite(readsb.track_rate),
        windSpeed: finite(readsb.ws), windHeading: finite(readsb.wd), outsideTemperature: finite(readsb.oat),
        totalTemperature: finite(readsb.tat), geometricVertical: Number.isFinite(readsb.geom_rate) ? readsb.geom_rate * 0.00508 : null,
        // Flatten only the reported mode list so equal live snapshots still reuse their models.
        navigationModes: Array.isArray(readsb.nav_modes) ? readsb.nav_modes.filter((mode) => typeof mode === 'string').join(' · ').toUpperCase() : '',
        sondeModel: text(telemetry.subtype) || text(telemetry.type), sondeType: text(telemetry.type),
        sondeTime: text(telemetry.datetime), altitudeReference: text(telemetry.ref_position),
        sondeAprsId: text(telemetry.aprsid), rawSerial: text(telemetry.rawid),
        // Sonde RF is reported in kHz. Keep it separate from the receiver's tuned frequency.
        transmitFrequency: kind === 'radiosonde' ? finite(telemetry.tx_frequency ?? telemetry.freq) : null,
        gpsMslDifference: finite(telemetry.diff_GPS_MSL),
        temperature: finite(telemetry.temp ?? telemetry.temperature
            ?? (Number.isFinite(weather.temperature_fahrenheit) ? (weather.temperature_fahrenheit - 32) * 5 / 9 : null)),
        humidity: finite(telemetry.humidity ?? telemetry.relative_humidity ?? weather.humidity_percent),
        pressure: finite(telemetry.pressure ?? weather.pressure_mbar), battery: finite(telemetry.batt ?? telemetry.voltage),
        batteryLevel: finite(telemetry.battery_level), burstTimer: finite(telemetry.bt), frameNumber: finite(telemetry.frame),
        wind: finite(weather.wind_speed_mph), windGust: finite(weather.wind_gust_mph), windDirection: finite(weather.wind_direction_degrees),
        satellites: finite(telemetry.sats ?? telemetry.sats_in_view),
        destination: text(telemetry.destination ?? frame.destination), channel: text(telemetry.channel_hash ?? frame.channel_hash),
        nodeName: text(telemetry.long_name), hop_limit: finite(telemetry.hop_limit ?? frame.hop_limit),
        hop_start: finite(telemetry.hop_start ?? frame.hop_start), nextHop: text(telemetry.next_hop ?? frame.next_hop),
        relay: text(telemetry.relay_node ?? frame.relay_node), encryption: text(telemetry.encryption ?? frame.encryption),
        viaMqtt: (telemetry.via_mqtt ?? frame.via_mqtt) === true, packetId: text(telemetry.packet_id ?? frame.packet_id),
        hdop: finite(telemetry.HDOP), precision: finite(telemetry.precision_bits),
        // AX.25 paths are already a short, flat callsign list, not arbitrary decoded details.
        path: Array.isArray(frame.path) ? frame.path.filter((value) => typeof value === 'string').join(' → ') : '',
        symbol_table: text(row.symbol_table ?? position.symbol_table), symbol_code: text(row.symbol_code ?? position.symbol_code),
        comment: text(telemetry.comment),
        frequency: finite(signal.frequency_hz ?? telemetry.signal?.frequency_hz ?? vfo?.center_freq_hz ?? vfo?.center_freq),
        decoder: text(row.details?.decoder?.type), vfo: finite(vfo?.id ?? telemetry.vfo),
        bandwidth: finite(vfo?.bandwidth_hz), satellite: text(row.details?.satellite?.name),
        // readsb reports receiver-relative signal power in dBFS, not calibrated dBm.
        power: finite(signal.signal_power_dbfs ?? (kind === 'adsb' ? readsb.rssi : null)),
        rssi: finite(signal.rssi_dbm), snr: finite(signal.snr_db),
    };
}

// Live merges recreate aircraft objects. Compare only the small, scalar fields
// used by the list, retaining unchanged models and dropping expired IDs.
export function createTransmitterListRows() {
    let cache = new Map();
    let previousRows = [];
    return (rows, receiver) => {
        const nextCache = new Map();
        const receiverKey = `${receiver?.lat ?? ''}:${receiver?.lon ?? ''}`;
        const result = rows.map((row) => {
            const values = snapshot(row);
            const previous = cache.get(row.id);
            const distance = previous && previous.receiverKey === receiverKey
                && previous.model.latitude === values.latitude && previous.model.longitude === values.longitude
                ? previous.model.distance : getReceiverDistances(values, receiver)?.groundKm ?? null;
            values.distance = distance;
            const model = previous && same(previous.model, values) ? previous.model : {
                ...values,
                search: [values.name, values.source, values.id, values.registration, values.model, values.operator,
                    values.sondeModel, values.fullModel, values.nodeName, values.owner,
                    values.operatorCallsign, values.operatorCountry].join(' ').toLowerCase(),
            };
            nextCache.set(row.id, {model, receiverKey});
            return model;
        });
        cache = nextCache;
        // A clock tick or unrelated protocol update need not reset list processing.
        if (result.length === previousRows.length && result.every((row, index) => row === previousRows[index])) return previousRows;
        previousRows = result;
        return result;
    };
}

export function filterTransmitterList(rows, search, excludedTypes, sort) {
    const terms = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const matches = rows.filter((row) => !excludedTypes.includes(row.kind) && terms.every((term) => row.search.includes(term)));
    return sort ? sortTransmitterList(matches, sort) : matches;
}

export function sortTransmitterList(rows, sort) {
    return [...rows].sort((left, right) => {
            let order;
            if (sort === 'name') order = left.name.localeCompare(right.name);
            else if (sort === 'distance') order = (left.distance ?? Infinity) - (right.distance ?? Infinity);
            // Canonical reception timestamps sort without repeatedly parsing dates.
            else order = (right[sort] ?? '').localeCompare(left[sort] ?? '');
            return order || left.id.localeCompare(right.id);
    });
}
