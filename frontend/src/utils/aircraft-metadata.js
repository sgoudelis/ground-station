/** Copyright (c) 2026 Efstratios Goudelis — GPL-3.0-or-later */

export const AIRCRAFT_FIELDS = {
    registration: 'Registration', type_code: 'Aircraft type', model: 'Model',
    military_status: 'Military status', category: 'Broadcast category', aircraft_class: 'Aircraft class',
    engine_count: 'Engines', engine_type: 'Engine type', wake_category: 'Wake category',
    operator_name: 'Operator (inferred)', operator_code: 'Operator code', operator_country: 'Operator country',
    operator_callsign: 'Operator radio callsign', interesting: 'Marked interesting',
    type_description: 'Type specification', owner: 'Owner / operator', year: 'Manufacture year',
};

const CLASSES = {L: 'Landplane', S: 'Seaplane', A: 'Amphibian', H: 'Helicopter', G: 'Gyroplane',
    T: 'Tiltrotor', B: 'Balloon', D: 'Drone', P: 'Powered parachute', V: 'Powered lift'};
const ENGINES = {P: 'Piston', T: 'Turboprop / turboshaft', J: 'Jet', E: 'Electric', R: 'Rocket'};
const WAKE = {L: 'Light', M: 'Medium', H: 'Heavy', J: 'Super'};
const CATEGORIES = {
    A1: 'Light aircraft', A2: 'Small aircraft', A3: 'Large aircraft', A4: 'High-vortex aircraft',
    A5: 'Heavy aircraft', A6: 'High-performance aircraft', A7: 'Rotorcraft',
    B1: 'Glider / sailplane', B2: 'Lighter-than-air', B3: 'Ultralight / hang-glider / paraglider',
    B4: 'Parachutist / skydiver', B6: 'Unmanned aircraft', B7: 'Space vehicle',
    C1: 'Emergency surface vehicle', C2: 'Service surface vehicle', C3: 'Point obstacle',
    C4: 'Cluster obstacle', C5: 'Line obstacle',
};

export function aircraftLabel(key, t) {
    return t(`aircraft.fields.${key}`, AIRCRAFT_FIELDS[key] || key);
}

export function aircraftValue(aircraft, key, t) {
    const value = aircraft?.[key];
    if (key === 'military_status') return value === 'military'
        ? t('aircraft.military', 'Military') : t('aircraft.unclassified', 'Unclassified');
    if (value === null || value === undefined || value === '') return '—';
    if (key === 'interesting') return value ? t('yes', 'Yes') : t('no', 'No');
    const labels = {aircraft_class: CLASSES, engine_type: ENGINES, wake_category: WAKE, category: CATEGORIES}[key];
    if (labels) {
        const fallback = labels[value];
        return fallback ? t(`aircraft.${key}.${value}`, fallback)
            : key === 'category' ? t('unknown', 'Unknown') : String(value);
    }
    return String(value);
}
