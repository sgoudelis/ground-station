import { describe, expect, it } from 'vitest';
import { getSdrTuningRangeHz } from '../common/sdr-parameters.js';
import {
    calculateContinuousCenterFrequency, createContinuousObservation, createContinuousVfo,
    getContinuousFrequencySpan, hasContinuousErrors,
    normalizeContinuousVfo, setContinuousDecoder, setContinuousModulation, validateContinuousObservation,
} from './continuous-observation-utils.js';

const device = { id: 'radio', type: 'rtlsdr', frequency_min: 24, frequency_max: 1766 };
const parameters = { gain_values: [0], antennas: { rx: ['RX'] } };
const definition = () => {
    const draft = createContinuousObservation();
    return { ...draft, name: 'VHF monitoring', sdr: { ...draft.sdr, id: 'radio', gain: 0, antenna_port: 'RX' } };
};
const errors = (draft) => validateContinuousObservation(draft, [device], parameters);

describe('continuous observation configuration', () => {
    it('defaults to automatic receiver centering from VFOs', () => {
        expect(createContinuousObservation().sdr.auto_center_frequency).toBe(true);
    });

    it('converts real hardware MHz limits before calculating and validating the center in Hz', () => {
        const draft = definition();
        expect(getSdrTuningRangeHz(device)).toEqual({ min: 24000000, max: 1766000000 });
        expect(errors(draft).center).toBe(false);
        draft.sdr.center_frequency = calculateContinuousCenterFrequency(draft, device, parameters);
        expect(draft.sdr.center_frequency).toBe(146300000);
        expect(hasContinuousErrors(errors(draft))).toBe(false);
    });

    it.each([24000000, 1766000000])('accepts a receiver center exactly on the MHz tuning boundary: %s Hz', (center) => {
        const draft = definition();
        draft.sdr.center_frequency = center;
        expect(errors(draft).center).toBe(false);
    });

    it.each([23999999, 1766000001])('rejects a receiver center beyond the MHz tuning range: %s Hz', (center) => {
        const draft = definition();
        draft.sdr.center_frequency = center;
        expect(errors(draft).center).toBe(true);
    });

    it('converts fractional MHz limits and leaves unspecified bounds open', () => {
        expect(getSdrTuningRangeHz({ frequency_min: 0.009, frequency_max: 260 }))
            .toEqual({ min: 9000, max: 260000000 });
        expect(getSdrTuningRangeHz({ frequency_min: null, frequency_max: null }))
            .toEqual({ min: 1, max: Infinity });
    });

    it('switches processing modes exclusively without changing tuning or bandwidth on audio selection', () => {
        const original = createContinuousVfo(145800000);
        const decoded = setContinuousDecoder(original, 'aprs');
        expect(decoded).toMatchObject({ modulation: 'none', decoder: 'aprs' });
        const audio = setContinuousModulation(decoded, 'usb');
        expect(audio).toEqual({ ...decoded, modulation: 'usb', decoder: 'none', decoder_parameters: {} });
        const idle = setContinuousDecoder(decoded, 'none');
        expect(idle).toMatchObject({ modulation: 'none', decoder: 'none', decoder_parameters: {} });
        expect(original).toMatchObject({ modulation: 'fm', decoder: 'none' });
    });

    it('normalizes legacy decoder audio fallbacks without changing the saved input', () => {
        const legacy = { ...setContinuousDecoder(createContinuousVfo(145800000), 'aprs'), modulation: 'fm' };
        expect(normalizeContinuousVfo(legacy)).toEqual({ ...legacy, modulation: 'none' });
        expect(legacy.modulation).toBe('fm');
    });

    it('rejects simultaneous audio and data selections and invalid modulation values', () => {
        const draft = definition();
        draft.vfos[0] = { ...setContinuousDecoder(draft.vfos[0], 'aprs'), modulation: 'fm' };
        expect(errors(draft).vfos[0].decoder).toBe(true);
        draft.vfos[0] = setContinuousModulation(draft.vfos[0], 'unsupported');
        expect(errors(draft).vfos[0].decoder).toBe(true);
        draft.vfos[0] = setContinuousModulation(draft.vfos[0], 'none');
        expect(errors(draft).vfos[0].decoder).toBe(false);
    });

    it('centers unequal full channel widths without shifting a fitting span out of capture', () => {
        const draft = definition();
        draft.vfos = [
            { ...createContinuousVfo(145000000), bandwidth: 200000 },
            { ...createContinuousVfo(146000000), bandwidth: 1000000 },
        ];
        expect(getContinuousFrequencySpan(draft)).toEqual({
            minFreq: 144900000, maxFreq: 146500000, requiredBandwidth: 1600000,
        });
        draft.sdr.center_frequency = calculateContinuousCenterFrequency(draft, device, parameters);
        expect(draft.sdr.center_frequency).toBe(145900000);
        expect(hasContinuousErrors(errors(draft))).toBe(false);
    });

    it('uses the hardware filter width for auto centering and reports an oversized span', () => {
        const draft = definition();
        const filterDevice = { ...device, type: 'soapysdrremote' };
        const filterParameters = { ...parameters, capabilities: { bandwidths: { rx: [100000, 2000000] } } };
        const filterErrors = () => validateContinuousObservation(draft, [filterDevice], filterParameters);
        draft.sdr.sdr_settings = { bandwidth: 100000 };
        draft.vfos = [
            { ...createContinuousVfo(145800000), bandwidth: 10000 },
            { ...createContinuousVfo(145860000), bandwidth: 30000 },
        ];
        draft.sdr.center_frequency = calculateContinuousCenterFrequency(draft, filterDevice, filterParameters);
        expect(draft.sdr.center_frequency).toBe(145845000);
        expect(hasContinuousErrors(filterErrors())).toBe(false);
        draft.vfos[1].bandwidth = 100000;
        draft.sdr.center_frequency = calculateContinuousCenterFrequency(draft, filterDevice, filterParameters);
        expect(filterErrors().vfoSpan).toBe(true);
        expect(getContinuousFrequencySpan(draft).requiredBandwidth).toBe(115000);
        expect(hasContinuousErrors(filterErrors())).toBe(true);
        expect(draft.sdr.sample_rate).toBe(2000000);
    });

    it.each(['', NaN, -1, Infinity])('ignores incomplete channels for centering but prevents saving: %s', (value) => {
        const draft = definition();
        draft.vfos.push({ ...createContinuousVfo(value), bandwidth: 2000000 });
        expect(calculateContinuousCenterFrequency(draft, device, parameters)).toBe(146300000);
        expect(hasContinuousErrors(errors(draft))).toBe(true);
        draft.vfos[0].bandwidth = value;
        expect(calculateContinuousCenterFrequency(draft, device, parameters)).toBe(0);
    });

    it('keeps auto centering within receiver tuning limits when a fitting center exists', () => {
        const draft = definition();
        draft.vfos[0].frequency = device.frequency_max * 1e6 - 10000;
        draft.sdr.center_frequency = calculateContinuousCenterFrequency(draft, device, parameters);
        expect(draft.sdr.center_frequency).toBe(device.frequency_max * 1e6);
        expect(hasContinuousErrors(errors(draft))).toBe(false);
        draft.sdr.sample_rate = '';
        expect(calculateContinuousCenterFrequency(draft, device, parameters)).toBe(0);
    });

    it('accepts a zero gain and an entire VFO exactly within the sampled bandwidth', () => {
        const draft = definition();
        draft.vfos[0].frequency = draft.sdr.center_frequency + draft.sdr.sample_rate / 2 - draft.vfos[0].bandwidth / 2;
        expect(hasContinuousErrors(errors(draft))).toBe(false);
        draft.vfos[0].frequency += 1;
        expect(errors(draft).vfos[0].outsideCapture).toBe(true);
    });

    it('validates VFO edges against a narrower IF filter', () => {
        const draft = definition();
        draft.sdr.sdr_settings = { bandwidth: 100000 };
        draft.vfos[0].frequency += 49000;
        expect(errors(draft).vfos[0].outsideCapture).toBe(true);
    });

    it.each(['', NaN, -1, Infinity])('rejects invalid receiver and VFO frequencies: %s', (frequency) => {
        const draft = definition();
        draft.sdr.center_frequency = frequency;
        draft.vfos[0].frequency = frequency;
        expect(errors(draft).center).toBe(true);
        expect(errors(draft).vfos[0].frequency).toBe(true);
    });

    it('rejects missing hardware, out-of-range tuning, and empty or oversized channel sets', () => {
        const draft = definition();
        expect(validateContinuousObservation(draft, [], parameters).sdr).toBe(true);
        draft.sdr.center_frequency = 2000000000;
        expect(errors(draft).center).toBe(true);
        draft.vfos = [];
        expect(errors(draft).vfoCount).toBe(true);
        draft.vfos = Array.from({ length: 11 }, () => createContinuousVfo(145800000));
        expect(errors(draft).vfoCount).toBe(true);
    });

    it('initializes decoder parameters and rejects invalid numeric decoder settings', () => {
        const draft = definition();
        draft.vfos[0] = setContinuousDecoder(draft.vfos[0], 'adsb');
        expect(draft.vfos[0].bandwidth).toBe(2000000);
        expect(draft.vfos[0].decoder_parameters.adsb_save_interval).toBe(5);
        expect(errors(draft).vfos[0].decoder).toBe(false);
        draft.vfos[0].decoder_parameters.adsb_save_interval = '';
        expect(errors(draft).vfos[0].decoder).toBe(true);
    });
});
