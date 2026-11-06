import { describe, expect, it } from 'vitest';
import { formatSdrRate, getSdrCaptureBandwidth } from '../common/sdr-parameters.js';
import { calculateSdrCenterFrequency, validateSdrTaskBandwidth } from './session-utils.js';

describe('shared SDR values', () => {
    it.each([
        [1024000, '1.024 MHz'], [1536000, '1.536 MHz'], [2048000, '2.048 MHz'],
        [2000000, '2 MHz'], [240000, '240 kHz'], [44100, '44.1 kHz'],
        [1024000 / 3, '341.333333333 kHz'],
    ])('formats %s without discarding rate precision', (value, label) => {
        expect(formatSdrRate(value)).toBe(label);
    });

    const device = { id: 'radio', type: 'soapysdrremote', driver: 'sdrplay' };
    const parameters = { capabilities: { bandwidths: { rx: [200000, 1536000, 5000000] } } };
    const sdr = { id: 'radio', sample_rate: 2000000, center_frequency: 145000000 };
    const transmitter = { id: 'tx', downlink_low: 145600000, downlink_high: 145620000 };
    const t = (key) => key;

    it('uses the widest compatible low-rate SDRplay filter in Auto mode', () => {
        expect(getSdrCaptureBandwidth({ ...sdr, sdr_settings: { bandwidth: 'auto' } }, device, parameters))
            .toBe(1536000);
    });

    it('rejects a task inside the sampled span but outside the hardware filter', () => {
        const session = {
            sdr: { ...sdr, sdr_settings: { bandwidth: 200000 } },
            tasks: [{ type: 'audio_recording', config: { transmitter_id: 'tx' } }],
        };
        const validation = validateSdrTaskBandwidth(session, [transmitter], [device], { radio: parameters }, t);
        expect(validation.valid).toBe(false);
        expect(validation.message).toBe('waterfall:sdr.if_bandwidth_tasks_outside');
        // Moving the center into the task's narrow filter makes the session usable.
        session.sdr.center_frequency = transmitter.downlink_low + 50000;
        expect(validateSdrTaskBandwidth(session, [transmitter], [device], { radio: parameters }, t).valid)
            .toBe(true);
    });

    it('rejects a saved SDRplay filter unavailable at the new rate even without tasks', () => {
        expect(validateSdrTaskBandwidth({
            sdr: { ...sdr, sdr_settings: { bandwidth: 5000000 } }, tasks: [],
        }, [], [device], { radio: parameters }, t).valid).toBe(false);
    });

    it('auto-centers a wide task span inside a narrow filter instead of shifting it past the edge', () => {
        const transmitters = [
            { id: 'low', downlink_low: 144500000, downlink_high: 144520000 },
            { id: 'high', downlink_low: 145500000, downlink_high: 145520000 },
        ];
        const session = {
            sdr: { ...sdr, sdr_settings: { bandwidth: 1536000 } },
            tasks: transmitters.map((transmitter) => ({ config: { transmitter_id: transmitter.id } })),
        };
        session.sdr.center_frequency = calculateSdrCenterFrequency(session, transmitters, device, parameters);
        expect(session.sdr.center_frequency).toBe(145258000);
        expect(validateSdrTaskBandwidth(session, transmitters, [device], { radio: parameters }, t).valid)
            .toBe(true);
    });
});
