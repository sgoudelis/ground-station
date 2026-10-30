import {describe, expect, it} from 'vitest';
import {getAprsData, getAprsDataTypeLabel} from '../aprs-utils.js';
import fixtures from '../../../../../backend/tests/fixtures/viewer.json';

describe('APRS viewer contract', () => {
    it('uses backend-normalized position and Base91 telemetry', () => {
        const metadata = fixtures.legacy.aprs;
        const aprs = getAprsData(metadata);
        expect(aprs).toBe(metadata.telemetry.payload.aprs);
        expect(aprs.position.latitude).toBeCloseTo(40.601269);
        expect(aprs.telemetry.channels).toEqual([419]);
        expect(getAprsDataTypeLabel(aprs)).toBe('Position without timestamp');
    });

    it('leaves unprepared historical APRS text to the backend', () => {
        expect(getAprsData({telemetry: {telemetry: {format: 'raw', ascii: '!example'}}})).toBeNull();
    });
});
