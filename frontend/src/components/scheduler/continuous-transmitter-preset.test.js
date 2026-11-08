import { describe, expect, it } from 'vitest';
import { applyContinuousTransmitter } from './continuous-transmitter-preset.js';
import { createContinuousVfo, setContinuousDecoder } from './continuous-observation-utils.js';

const vfo = () => createContinuousVfo(145800000);

describe('continuous observation transmitter presets', () => {
    it('prefills Bell 202 APRS without retaining the source identity', () => {
        const original = vfo();
        const result = applyContinuousTransmitter(original, {
            id: 'tx', norad_cat_id: 25544, mode: 'FM', description: 'ISS APRS',
            downlink_low: 145825000, baud: 1240,
        });
        expect(result).toEqual({ ...original, frequency: 145825000, bandwidth: 12500,
            decoder: 'aprs', modulation: 'none', decoder_parameters: { aprs_baudrate: 1240, aprs_af_carrier: 1700, aprs_deviation: 500 } });
        expect(original.frequency).toBe(145800000);
    });

    it('uses explicit FSK metadata and enough width for deviation, including custom dropdown values', () => {
        const result = applyContinuousTransmitter(vfo(), {
            mode: 'FSK', downlink_low: 437800000, baud: 200, deviation: 563.5, framing: 'GEOSCAN',
        });
        expect(result).toMatchObject({ frequency: 437800000, decoder: 'fsk', modulation: 'none', bandwidth: 1327,
            decoder_parameters: { fsk_baudrate: 200, fsk_deviation: 563.5, fsk_framing: 'geoscan' } });
        expect(applyContinuousTransmitter(vfo(), { mode: 'GMSK', downlink_low: 437800000, baud: 1234 }))
            .toMatchObject({ decoder: 'gmsk', bandwidth: 3702, decoder_parameters: { gmsk_baudrate: 1234 } });
    });

    it('prefills LoRa values with their real types and copies profile arrays', () => {
        const transmitter = { mode: 'LoRa', downlink_low: 436000000,
            lora_config: { sf: 10, bw: 250000, cr: 2, sync_word: [18], preamble_len: 12,
                invert_iq: true, implicit_header: true, payload_length: 42, has_crc: false } };
        const result = applyContinuousTransmitter(vfo(), transmitter);
        expect(result).toMatchObject({ decoder: 'lora', modulation: 'none', bandwidth: 250000,
            decoder_parameters: { lora_sf: 10, lora_bw: 250000, lora_cr: 2, lora_sync_word: [18],
                lora_preamble_len: 12, lora_invert_iq: true, lora_implicit_header: true,
                lora_payload_length: 42, lora_has_crc: false } });
        result.decoder_parameters.lora_sync_word[0] = 0;
        expect(transmitter.lora_config.sync_word).toEqual([18]);
    });

    it('preserves same-decoder manual settings when metadata is missing or unsupported', () => {
        const original = { ...setContinuousDecoder(vfo(), 'lora'), bandwidth: 250000 };
        original.decoder_parameters = { ...original.decoder_parameters, lora_sf: 9, lora_bw: 250000, lora_has_crc: false };
        expect(applyContinuousTransmitter(original, { mode: 'LoRa', downlink_low: 436000000,
            lora_config: { sf: 99, bw: '125000', preamble_len: -1, has_crc: 'true', bad_field: 123 } }))
            .toEqual({ ...original, frequency: 436000000 });
    });

    it.each(['QPSK', 'AFSK', ''])('does not guess a decoder for %s', (mode) => {
        const original = { ...setContinuousDecoder(vfo(), 'fsk'), bandwidth: 33333 };
        const result = applyContinuousTransmitter(original, { mode, description: 'Telemetry', baud: 1200, downlink_low: 437800000 });
        expect(result).toEqual({ ...original, frequency: 437800000 });
    });

    it.each(['FM', 'AM', 'USB', 'LSB', 'CW'])('clears decoding when applying a recognized %s audio preset', (mode) => {
        const original = setContinuousDecoder(vfo(), 'aprs');
        const result = applyContinuousTransmitter(original, { mode, description: 'Voice', downlink_low: 145800000 });
        expect(result).toMatchObject({ modulation: mode.toLowerCase(), decoder: 'none', decoder_parameters: {} });
        expect(original.decoder).toBe('aprs');
    });

    it('does not select the Bell 202 decoder for 9600-baud APRS', () => {
        expect(applyContinuousTransmitter(vfo(), { mode: 'FM', description: 'APRS', baud: 9600, downlink_low: 145825000 }).decoder).toBe('none');
    });

    it('sets differential BPSK only when specified and drops parameters from the old decoder', () => {
        const original = setContinuousDecoder(vfo(), 'lora');
        const result = applyContinuousTransmitter(original, { mode: 'DBPSK', downlink_low: 437000000, baud: 9600, framing: 'doka' });
        expect(result).toMatchObject({ decoder: 'bpsk', bandwidth: 28800,
            decoder_parameters: { bpsk_baudrate: 9600, bpsk_framing: 'doka', bpsk_differential: true } });
        expect(Object.keys(result.decoder_parameters).some((key) => key.startsWith('lora_'))).toBe(false);
    });

    it('does not use a transmitter tuning range as signal bandwidth', () => {
        const original = vfo();
        expect(applyContinuousTransmitter(original, { mode: 'USB', downlink_low: 145000000, downlink_high: 146000000 }))
            .toEqual({ ...original, frequency: 145000000, modulation: 'usb' });
    });

    it.each([null, 0, -1, NaN, Infinity])('preserves the VFO when a record has no usable downlink: %s', (downlink_low) => {
        const original = vfo();
        expect(applyContinuousTransmitter(original, { mode: 'FSK', downlink_low })).toBe(original);
        expect(applyContinuousTransmitter(original, { mode: 'FSK', downlink_low, downlink_high: 437000000 }).frequency).toBe(437000000);
    });
});
