/** Reported ADS-B emergency/priority states, shared by the map and its table. */
const states = {
    unlawful: {label: 'Unlawful interference', severity: 'error', priority: 6},
    downed: {label: 'Downed aircraft', severity: 'error', priority: 5},
    general: {label: 'General emergency', severity: 'error', priority: 4},
    lifeguard: {label: 'Medical / lifesaving priority', severity: 'error', priority: 3},
    nordo: {label: 'Radio communication failure', severity: 'warning', priority: 2},
    minfuel: {label: 'Minimum fuel', severity: 'warning', priority: 1},
};
const squawkStates = {'7500': 'unlawful', '7600': 'nordo', '7700': 'general'};
const enumStates = ['none', 'general', 'lifeguard', 'minfuel', 'nordo', 'unlawful', 'downed'];
const colors = {error: '#ef5350', warning: '#ffb300'};

// Silent aircraft use gray even when their last report carried an emergency.
export function aircraftColor(status, stale = false) {
    return stale ? '#9e9e9e' : status?.color ?? '#66bb6a';
}

export function aircraftEmergency(report) {
    if (!report || (report.kind && report.kind !== 'adsb')) return null;
    // Current telemetry can explicitly clear an earlier report with null/none.
    const {squawk, emergency} = {...report, ...report.details?.telemetry};
    const code = typeof squawk === 'string' ? squawk.trim() : Number.isInteger(squawk) ? String(squawk) : '';
    const normalizedCode = /^[0-7]{1,4}$/.test(code) ? code.padStart(4, '0') : '';
    const broadcast = typeof emergency === 'string' ? emergency.trim().toLowerCase()
        : Number.isInteger(emergency) ? enumStates[emergency] : null;
    const keys = [...new Set([squawkStates[normalizedCode], broadcast])].filter((key) => Object.hasOwn(states, key));
    if (!keys.length) return null;
    // Preserve both meanings if the code and ADS-B priority disagree, and use
    // the more urgent color instead of downgrading a reported emergency.
    keys.sort((left, right) => states[right].priority - states[left].priority);
    const primary = states[keys[0]];
    return {...primary, key: keys[0], color: colors[primary.severity], conditions: keys,
        squawk: normalizedCode, emergencySquawk: Object.hasOwn(squawkStates, normalizedCode)};
}

export function aircraftEmergencyLabel(status, t) {
    return status.conditions.map((key) => t ? t(`aircraft.emergency.states.${key}`, states[key].label) : states[key].label).join(' · ');
}
