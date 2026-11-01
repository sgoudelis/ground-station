/** Copyright (c) 2026 Efstratios Goudelis — GPL-3.0-or-later */

import {ICAO_RANGES} from './icao-ranges.js';

// Build shared display values once. Narrow territory allocations must win over
// their enclosing country ranges, regardless of the order of the source table.
const allocations = ICAO_RANGES.map(([start, end, code, name]) => ({
    start, end,
    country: code ? Object.freeze({
        code, name,
        flag: String.fromCodePoint(...[...code].map((letter) => 0x1f1e6 + letter.charCodeAt(0) - 65)),
    }) : null,
})).sort((a, b) => (a.end - a.start) - (b.end - b.start));

/** Registration allocation only; non-ICAO, special-use and unknown addresses have no country. */
export function aircraftCountry(icao) {
    if (typeof icao !== 'string' || icao.length !== 6 || !/^[0-9a-f]{6}$/i.test(icao)) return null;
    const address = Number.parseInt(icao, 16);
    return allocations.find(({start, end}) => address >= start && address <= end)?.country ?? null;
}
