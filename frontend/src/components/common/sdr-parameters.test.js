import { describe, expect, it } from 'vitest';
import {
    getSdrBandwidthOptions, getSdrCaptureBandwidth, getSdrSetting,
    isSdrBandwidthUnavailable, normalizeSdrGain, setSdrSetting,
} from './sdr-parameters.js';

const capabilities = {
    gain_elements: { rx: ['PGA'] }, gain_ranges: { rx: { PGA: { min: 0, max: 76, step: 1 } } },
    bandwidths: { rx: [200000, 56000000] },
    bandwidth_ranges: { rx: [{ min: 200000, max: 56000000, step: 0 }] },
};
const soapy = { type: 'soapysdrlocal', driver: 'uhd' };
const native = { type: 'uhd' };

describe('UHD receiver configuration', () => {
    it('offers useful widths within UHD ranges and validates saved intermediate widths', () => {
        expect(getSdrBandwidthOptions(soapy, capabilities, 4000000)).toContain(4000000);
        const sdr = { sample_rate: 4000000, sdr_settings: { bandwidth: 3750000 } };
        expect(isSdrBandwidthUnavailable(sdr, soapy, { capabilities })).toBe(false);
        expect(getSdrCaptureBandwidth({ ...sdr, sdr_settings: { bandwidth: 'auto' } }, soapy, { capabilities }))
            .toBe(4000000);
        expect(isSdrBandwidthUnavailable({ ...sdr, sdr_settings: { bandwidth: 100000 } }, soapy, { capabilities }))
            .toBe(true);
    });

    it('keeps formerly ignored native settings inactive until explicitly selected', () => {
        const settings = { clockSource: 'external', timeSource: 'external', bandwidth: 200000 };
        expect(getSdrSetting(native, settings, 'clockSource')).toBeUndefined();
        expect(getSdrCaptureBandwidth({ sample_rate: 4000000, sdr_settings: settings }, native, { capabilities }))
            .toBe(4000000);
        const edited = setSdrSetting(native, settings, 'clockSource', 'external');
        expect(edited.uhd).toEqual({ clockSource: 'external' });
        expect(getSdrSetting(native, edited, 'timeSource')).toBeUndefined();
        expect(getSdrSetting(soapy, settings, 'clockSource')).toBe('external');
    });

    it('preserves the effective old SoapyUHD PGA gain while consolidating the control', () => {
        const saved = { gain: 15, sdr_settings: { gains: { PGA: 45 }, clockSource: 'internal' } };
        const normalized = normalizeSdrGain(soapy, capabilities, saved);
        expect(normalized).toEqual({ gain: 45, sdr_settings: { gains: {}, clockSource: 'internal' } });
        expect(saved.sdr_settings.gains.PGA).toBe(45);
        expect(normalizeSdrGain(soapy, capabilities, normalized)).toBe(normalized);
        expect(normalizeSdrGain(soapy, capabilities, saved, false).gain).toBe(15);
        expect(normalizeSdrGain(native, capabilities, saved).gain).toBe(15);
    });

    it('preserves zero gain and leaves multi-stage SDRs unchanged', () => {
        const saved = { gain: 15, sdr_settings: { gains: { PGA: 0 } } };
        expect(normalizeSdrGain(soapy, capabilities, saved).gain).toBe(0);
        expect(normalizeSdrGain({ type: 'soapysdrlocal', driver: 'sdrplay' }, capabilities, saved)).toBe(saved);
    });
});
