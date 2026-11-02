import {describe, expect, it} from 'vitest';
import {aircraftEmergency, aircraftEmergencyLabel} from './aircraft-emergency.js';

describe('Reported aircraft emergency status', () => {
    it.each([
        ['7500', 'unlawful', 'error', 'Unlawful interference'],
        ['7600', 'nordo', 'warning', 'Radio communication failure'],
        ['7700', 'general', 'error', 'General emergency'],
    ])('recognizes squawk %s independently of the broadcast emergency field', (squawk, key, severity, label) => {
        const status = aircraftEmergency({squawk, emergency: 'none'});
        expect(status).toMatchObject({key, severity, squawk, emergencySquawk: true});
        expect(aircraftEmergencyLabel(status)).toBe(label);
        expect(aircraftEmergency({squawk: Number(squawk)})).toEqual(status);
    });

    it.each([
        ['general', 1, 'error'], ['lifeguard', 2, 'error'], ['minfuel', 3, 'warning'],
        ['nordo', 4, 'warning'], ['unlawful', 5, 'error'], ['downed', 6, 'error'],
    ])('recognizes the decoded %s state even with an ordinary squawk', (emergency, numeric, severity) => {
        const status = aircraftEmergency({emergency, squawk: '0042'});
        expect(status).toMatchObject({key: emergency, severity, squawk: '0042', emergencySquawk: false});
        expect(aircraftEmergency({emergency: numeric, squawk: 42})).toEqual(status);
    });

    it('preserves conflicting reports and uses the more urgent color', () => {
        const status = aircraftEmergency({squawk: '7600', emergency: 'unlawful'});
        expect(status).toMatchObject({key: 'unlawful', severity: 'error', conditions: ['unlawful', 'nordo']});
        expect(aircraftEmergencyLabel(status)).toBe('Unlawful interference · Radio communication failure');
        expect(aircraftEmergency({squawk: '7700', emergency: 'general'}).conditions).toEqual(['general']);
    });

    it.each([
        null, {}, {squawk: '7000', emergency: 'none'}, {squawk: '0077'}, {emergency: 0},
        {emergency: 7}, {emergency: 'reserved'}, {emergency: '__proto__'},
        {squawk: '17700'}, {squawk: '7708'}, {squawk: 7700.5}, {squawk: '<7700>'},
        {kind: 'aprs', squawk: '7700'}, {kind: 'radiosonde', emergency: 'general'},
    ])('does not alert for unrelated or malformed data: %j', (report) => {
        expect(aircraftEmergency(report)).toBeNull();
    });

    it('uses current telemetry including explicit clears instead of reviving older status', () => {
        const row = {kind: 'adsb', squawk: '7700', emergency: 'general'};
        expect(aircraftEmergency({...row, details: {telemetry: {squawk: null, emergency: 'none'}}})).toBeNull();
        expect(aircraftEmergency({...row, details: {telemetry: {squawk: '7000', emergency: null}}})).toBeNull();
        expect(aircraftEmergency({kind: 'adsb', details: {telemetry: {squawk: ' 7600 ', emergency: ' NORDO '}}}))
            .toMatchObject({key: 'nordo', severity: 'warning'});
    });
});
