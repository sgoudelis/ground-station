import { describe, expect, it } from 'vitest';
import { getLoraParameters, mapParametersToBackend } from '../decoder-parameters.js';
import { findLoraProfile, LORA_PROFILES } from '../lora-profiles.js';

describe('LoRa receiver profile contracts', () => {
    it('provides complete profiles supported by the parameter controls and backend mapping', () => {
        const definitions = getLoraParameters();
        expect(new Set(LORA_PROFILES.map(profile => profile.id)).size).toBe(LORA_PROFILES.length);
        for (const profile of LORA_PROFILES) {
            expect(Object.keys(profile.parameters).sort()).toEqual(Object.keys(definitions).sort());
            for (const [key, definition] of Object.entries(definitions)) {
                const value = profile.parameters[key];
                if (definition.type === 'select') {
                    expect(definition.options.some(option => JSON.stringify(option.value) === JSON.stringify(value)), key).toBe(true);
                } else if (definition.type === 'number') {
                    expect(Number.isInteger(value)).toBe(true);
                    expect(value).toBeGreaterThanOrEqual(definition.min);
                    expect(value).toBeLessThanOrEqual(definition.max);
                } else {
                    expect(typeof value).toBe('boolean');
                }
            }
            expect(findLoraProfile(profile.parameters, profile.id)?.id).toBe(profile.id);
            expect(mapParametersToBackend('lora', profile.parameters)).toEqual(expect.objectContaining({
                implicit_header: false, ldro_mode: 2, payload_length: 255,
            }));
        }
        // A sparse VFO still displays the generic profile; an edited network
        // byte must never continue displaying a preset that cannot receive it.
        expect(findLoraProfile({})?.id).toBe('generic');
        expect(findLoraProfile({ lora_sync_word: [0x55] })).toBeUndefined();
        const regional = LORA_PROFILES.find(profile => profile.id === 'lorawan-us915-uplink-dr0');
        expect(findLoraProfile(regional.parameters)).toBeUndefined();
        expect(findLoraProfile({ ...regional.parameters, lora_preamble_len: 12 }, regional.id)).toBeUndefined();
    });

    it('uses regional LoRaWAN data-rate tables and direction-specific packet settings', () => {
        const euUplink = LORA_PROFILES.filter(profile => profile.id.startsWith('lorawan-eu868-uplink'));
        expect(euUplink.map(profile => [profile.parameters.lora_sf, profile.parameters.lora_bw])).toEqual([
            [12, 125000], [11, 125000], [10, 125000], [9, 125000],
            [8, 125000], [7, 125000], [7, 250000],
        ]);
        const usUplink = LORA_PROFILES.filter(profile => profile.id.startsWith('lorawan-us915-uplink'));
        expect(usUplink.map(profile => [profile.parameters.lora_sf, profile.parameters.lora_bw])).toEqual([
            [10, 125000], [9, 125000], [8, 125000], [7, 125000], [8, 500000],
        ]);
        const usDownlink = LORA_PROFILES.filter(profile => profile.id.startsWith('lorawan-us915-downlink'));
        expect(usDownlink.map(profile => [profile.parameters.lora_sf, profile.parameters.lora_bw])).toEqual([
            [12, 500000], [11, 500000], [10, 500000], [9, 500000], [8, 500000], [7, 500000],
        ]);
        for (const profile of LORA_PROFILES.filter(profile => profile.family === 'lorawan')) {
            const downlink = profile.id.includes('-downlink-');
            expect(mapParametersToBackend('lora', profile.parameters)).toEqual(expect.objectContaining({
                sync_word: [0x34], preamble_len: 8, cr: 1,
                invert_iq: downlink, has_crc: !downlink,
            }));
        }
    });
});
