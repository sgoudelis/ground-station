import {describe, expect, it} from 'vitest';
import {aircraftCountry} from './aircraft-country.js';

describe('ICAO registration country lookup', () => {
    it.each([
        ['4D2406', 'MT', 'Malta', '🇲🇹'],
        ['4bcdf2', 'TR', 'Turkey', '🇹🇷'],
        ['46B825', 'GR', 'Greece', '🇬🇷'],
        ['4081AA', 'GB', 'United Kingdom', '🇬🇧'],
        ['3C66B4', 'DE', 'Germany', '🇩🇪'],
        ['A00001', 'US', 'United States', '🇺🇸'],
        ['901001', 'CK', 'Cook Islands', '🇨🇰'],
    ])('derives %s from its allocation, independently of callsign or location', (icao, code, name, flag) => {
        expect(aircraftCountry(icao)).toEqual({code, name, flag});
    });

    it('includes both ends of allocations and leaves unassigned gaps unknown', () => {
        expect(aircraftCountry('4d1fff')).toBeNull();
        expect(aircraftCountry('4d2000')?.code).toBe('MT');
        expect(aircraftCountry('4d27ff')?.code).toBe('MT');
        expect(aircraftCountry('4d2800')).toBeNull();
        expect(aircraftCountry('467fff')?.code).toBe('FI');
        expect(aircraftCountry('468000')?.code).toBe('GR');
        expect(aircraftCountry('46ffff')?.code).toBe('GR');
        expect(aircraftCountry('470000')?.code).toBe('HU');
    });

    it.each([
        ['400000', 'BM'], ['4001bf', 'BM'], ['4001c0', 'KY'], ['4001ff', 'KY'],
        ['400200', 'GB'], ['424b00', 'IM'], ['43eafd', 'IM'], ['43eafe', 'GG'],
        ['43eeff', 'GG'], ['43ef00', 'GB'], ['789000', 'HK'], ['789fff', 'HK'], ['78a000', 'CN'],
    ])('prefers specific territory ranges at %s over enclosing country ranges', (icao, code) => {
        expect(aircraftCountry(icao)?.code).toBe(code);
    });

    it.each([
        null, undefined, 0x4d2406, {}, '', '4d240', '04d2406', '0x4d2406', '~4d2406',
        '4d240g', ' 4d2406', '4d2406\n', '000000', 'ffffff', 'f00000', 'f09000',
    ])('does not invent a flag for invalid, non-ICAO or unallocated address %j', (icao) => {
        expect(aircraftCountry(icao)).toBeNull();
    });

    it('reuses immutable display values for an allocation across updates', () => {
        expect(aircraftCountry('4d2406')).toBe(aircraftCountry('4D2000'));
        expect(Object.isFrozen(aircraftCountry('4d2406'))).toBe(true);
    });
});
