import { describe, expect, it } from 'vitest';

import {
    DECODER_SUPPORT,
    areDecoderParametersValid,
    getDecoderDefaultParameters,
    getDecoderParameters,
    mapParametersToBackend,
} from '../decoder-parameters.js';

describe('APRS decoder parameters', () => {
    it('offers APRS and keeps the legacy AFSK decoder disabled', () => {
        expect(DECODER_SUPPORT.aprs).toBe(true);
        expect(DECODER_SUPPORT.afsk).toBe(false);
        expect(Object.keys(getDecoderParameters('afsk'))).toHaveLength(0);
    });

    it('uses Bell 202 defaults and maps them to the raw-IQ backend decoder', () => {
        const defaults = getDecoderDefaultParameters('aprs');

        expect(defaults).toEqual({
            aprs_baudrate: 1200,
            aprs_af_carrier: 1700,
            aprs_deviation: 500,
        });
        expect(mapParametersToBackend('aprs', defaults)).toEqual({
            baudrate: 1200,
            af_carrier: 1700,
            deviation: 500,
            framing: 'aprs',
        });
    });
});

describe('Geoscan image decoder parameters', () => {
    it('keeps the receiver profile explicit and maps its Geoscan framing values', () => {
        const defaults = getDecoderDefaultParameters('geoscanimage');

        expect(defaults).toEqual({
            geoscanimage_baudrate: 9600,
            geoscanimage_deviation: 5000,
            geoscanimage_frame_size: 74,
            geoscanimage_syncword_threshold: 4,
            geoscanimage_satellite_id: 9,
        });
        expect(mapParametersToBackend('geoscanimage', defaults)).toEqual({
            baudrate: 9600,
            deviation: 5000,
            framing_params: {
                frame_size: 74,
                syncword_threshold: 4,
                satellite_id: 9,
            },
        });
    });
});

describe('SSTV decoder parameters', () => {
    it('offers only implemented modes and maps a forced mode to the backend', () => {
        const mode = getDecoderParameters('sstv').sstv_mode;

        expect(mode.options.map((option) => option.value)).toEqual([
            'auto',
            'robot36',
            'martin_m1',
            'martin_m2',
            'scottie_s1',
            'scottie_s2',
            'scottie_dx',
            'wraase_sc2_180',
        ]);
        expect(mapParametersToBackend('sstv', { sstv_mode: 'scottie_s2' })).toEqual({
            sstv_mode: 'scottie_s2',
        });
    });
});

describe('GNSS decoder parameters', () => {
    it('defaults to GPS L1 only and keeps other constellations selectable', () => {
        const defaults = getDecoderDefaultParameters('gnss');

        expect(defaults).toMatchObject({
            gnss_enable_gps: true,
            gnss_enable_galileo: false,
            gnss_enable_glonass: false,
            gnss_enable_beidou: false,
            gnss_enable_qzss: false,
        });
        expect(mapParametersToBackend('gnss', defaults)).toMatchObject(defaults);
    });
});

describe('LoRa decoder parameters', () => {
    it('enables LoRa and maps complete PHY controls, preserving false and zero', () => {
        expect(DECODER_SUPPORT.lora).toBe(true);
        const defaults = getDecoderDefaultParameters('lora');
        expect(mapParametersToBackend('lora', {
            ...defaults, lora_sf: 8, lora_sync_word: [52], lora_ldro_mode: 0,
            lora_implicit_header: true, lora_payload_length: 107, lora_has_crc: false,
        })).toEqual({
            sf: 8, bw: 125000, cr: 1, sync_word: [52], preamble_len: 8,
            ldro_mode: 0, implicit_header: true, payload_length: 107, has_crc: false,
            invert_iq: false,
        });
        expect(mapParametersToBackend('lora', { lora_fldro: true }).ldro_mode).toBe(1);
        expect(mapParametersToBackend('lora', { lora_fldro: false }).ldro_mode).toBe(2);
        const preamble = getDecoderParameters('lora').lora_preamble_len;
        expect(preamble.type).toBe('number');
        expect(mapParametersToBackend('lora', { lora_preamble_len: 9 }).preamble_len).toBe(9);
        const sync = getDecoderParameters('lora').lora_sync_word.options;
        expect(sync.some(option => JSON.stringify(option.value) === '[52]')).toBe(true);
        expect(sync.some(option => JSON.stringify(option.value) === '[0,0]')).toBe(true);
    });

    it('accepts custom integer preambles and rejects invalid drafts before saving', () => {
        for (const value of [5, 9, 15, 17, 18, 65535]) {
            expect(areDecoderParametersValid('lora', { lora_preamble_len: value })).toBe(true);
            expect(mapParametersToBackend('lora', { lora_preamble_len: value }).preamble_len).toBe(value);
        }
        for (const value of ['', 4, 15.5, 65536, NaN, Infinity]) {
            expect(areDecoderParametersValid('lora', { lora_preamble_len: value })).toBe(false);
        }
        expect(areDecoderParametersValid('lora')).toBe(true);
    });
});
