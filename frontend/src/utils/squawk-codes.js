/** Common special-purpose Mode A codes; regional allocations are not universal. */

const faa = {label: 'FAA AIM 4-1-20', url: 'https://www.faa.gov/air_traffic/publications/atpubs/aim_html/chap4_section_1.html#4-1-20'};
// UK AIP reference edition: 29 October 2026, ENR 1.6 (SSR procedures).
const uk = {label: 'UK AIP ENR 1.6', url: 'https://www.aurora.nats.co.uk/htmlAIP/Publications/2026-10-29-AIRAC/html/eAIP/EG-ENR-1.6-en-GB.html#ENR-1.6.2'};

export const squawkCodeListing = 'https://en.wikipedia.org/wiki/List_of_transponder_codes';

const codes = {
    '0000': {
        title: 'Transponder malfunction', scope: 'United Kingdom', source: uk,
        description: 'May be assigned when reported altitude is incorrect and altitude reporting cannot be switched off independently.',
    },
    '1000': {
        title: 'Mode S aircraft identification', scope: 'Mode S airspace, including the UK', source: uk,
        description: 'Used for instrument flight rules (IFR) flights identified by their downlinked aircraft ID, matched to the flight plan, rather than a unique Mode A code.',
    },
    '1200': {
        title: 'Visual flight rules (VFR)', scope: 'United States', source: faa,
        description: 'The standard VFR code when air traffic control has not assigned another code and no other special code applies.',
    },
    '1202': {
        title: 'VFR glider', scope: 'United States', source: faa,
        description: 'Used by gliders flying under visual flight rules instead of the standard VFR code 1200.',
    },
    '1203': {
        title: 'VFR formation flight', scope: 'United States', source: faa,
        description: 'Used by the lead aircraft of a standard VFR formation that is not receiving air traffic control services.',
    },
    '1255': {
        title: 'Firefighting', scope: 'United States', source: faa,
        description: 'Used by firefighting aircraft not in contact with air traffic control while travelling to, from, or within a designated firefighting area.',
    },
    '1277': {
        title: 'Search and rescue', scope: 'United States', source: faa,
        description: 'May be assigned to VFR aircraft on authorized USAF or US Coast Guard search-and-rescue missions travelling to, from, or within the search area.',
    },
    '2000': {
        title: 'IFR conspicuity / no assigned code', scope: 'United Kingdom', source: uk,
        description: 'Used for instrument flight rules (IFR) flights without an assigned code, or on entering UK airspace from an area where transponders were not required. It also has specified uses on the ground.',
    },
    '4000': {
        title: 'Military restricted-area operations', scope: 'United States', source: faa,
        description: 'Used by military aircraft in restricted or warning areas when air traffic control has not assigned another code.',
    },
    '7000': {
        title: 'Visual flight rules (VFR) conspicuity', scope: 'Europe, including the United Kingdom', source: uk,
        description: 'A common VFR code in European airspace. In the UK, it is used for VFR flights without a specific transponder code instruction from air traffic services.',
    },
    '7500': {
        title: 'Unlawful interference', scope: 'International', source: uk,
        description: 'Signals unlawful interference with the flight, such as a hijacking.',
    },
    '7600': {
        title: 'Radio communication failure', scope: 'International', source: uk,
        description: 'Signals a failure of radio communications.',
    },
    '7700': {
        title: 'General emergency', scope: 'International', source: uk,
        description: 'Signals an emergency condition. The code alone does not identify the nature of the emergency.',
    },
    '7777': {
        title: 'Military interceptor operations', scope: 'United States', source: faa,
        description: 'Reserved by the FAA for military interceptor operations. Other regions also use this code for radar test transponders.',
    },
};

const unlisted = {
    title: 'ATC-assigned or local code',
    description: 'No special-purpose meaning is included for this code in this reference. Many codes are assigned by air traffic control to identify individual flights; local allocations may also apply.',
};

export function squawkInfo(value) {
    const raw = typeof value === 'string' ? value.trim() : Number.isInteger(value) ? String(value) : '';
    if (!/^[0-7]{1,4}$/.test(raw)) return null;
    const code = raw.padStart(4, '0');
    // Unknown codes have no inferred flight type, emergency status, or region.
    return {code, ...(codes[code] ?? unlisted), known: Object.hasOwn(codes, code)};
}
