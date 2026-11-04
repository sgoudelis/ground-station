// Copyright (c) 2026 Efstratios Goudelis
// SPDX-License-Identifier: GPL-3.0-only

import { getDecoderDefaultParameters } from './decoder-parameters.js';

const defaults = getDecoderDefaultParameters('lora');

const profile = (id, label, values, details = {}) => ({
    id,
    label,
    ...details,
    // Include hidden implicit-mode fields so switching profiles clears old overrides.
    parameters: {
        ...defaults,
        ...Object.fromEntries(Object.entries(values).map(([key, value]) => [`lora_${key}`, value])),
    },
});

// Published community presets: https://api.meshcore.nz/api/v1/config
// Current firmware uses 32 preamble symbols at SF7/8 and 16 above SF8:
// https://github.com/meshcore-dev/MeshCore/blob/main/src/helpers/radiolib/RadioLibWrappers.h
const meshcore = [
    ['eu-uk-narrow', 'EU/UK Narrow', 8, 62500, 4, 869.618],
    ['eu-uk-legacy', 'EU/UK Legacy (deprecated)', 11, 250000, 1, 869.525],
    ['usa', 'USA', 7, 62500, 1, 910.525],
    ['australia-narrow', 'Australia Narrow', 7, 62500, 3, 916.575],
].map(([id, label, sf, bw, cr, frequencyMHz]) => profile(
    `meshcore-${id}`, `MeshCore — ${label}`,
    { sf, bw, cr, sync_word: [0x12], preamble_len: sf <= 8 ? 32 : 16 },
    { family: 'meshcore', frequencyMHz },
));

// https://meshtastic.org/docs/overview/radio-settings/
// RadioLibInterface.h and RadioInterface.h define sync 0x2B and preamble 16.
const meshtastic = [
    ['short-fast', 'Short Fast', 7, 250000, 1],
    ['short-slow', 'Short Slow', 8, 250000, 1],
    ['medium-fast', 'Medium Fast', 9, 250000, 1],
    ['medium-slow', 'Medium Slow', 10, 250000, 1],
    ['long-fast', 'Long Fast', 11, 250000, 1],
    ['long-moderate', 'Long Moderate', 11, 125000, 4],
].map(([id, label, sf, bw, cr]) => profile(
    `meshtastic-${id}`, `Meshtastic — ${label}`,
    { sf, bw, cr, sync_word: [0x2B], preamble_len: 16 },
    { family: 'meshtastic' },
));

// LoRaWAN data-rate numbers depend on the region and direction. Only the LoRa
// entries are listed; FSK and LR-FHSS use different receivers.
// https://www.thethingsnetwork.org/docs/lorawan/regional-parameters/eu868/
// https://www.thethingsnetwork.org/docs/lorawan/regional-parameters/us915/
const lorawan = (region, direction, rates) => ({
    label: `LoRaWAN ${region} — ${direction}`,
    profiles: rates.map(([dr, sf, bw]) => profile(
        `lorawan-${region.toLowerCase()}-${direction.toLowerCase()}-dr${dr}`,
        `LoRaWAN ${region} DR${dr} — ${direction}`,
        {
            sf, bw, cr: 1, sync_word: [0x34], preamble_len: 8,
            // Downlinks invert IQ and omit the payload CRC. Explicit headers
            // announce CRC presence; has_crc is retained for a complete draft.
            invert_iq: direction === 'Downlink',
            has_crc: direction === 'Uplink',
        },
        { family: 'lorawan' },
    )),
});

const eu868Rates = [
    [0, 12, 125000], [1, 11, 125000], [2, 10, 125000], [3, 9, 125000],
    [4, 8, 125000], [5, 7, 125000], [6, 7, 250000],
];

export const LORA_PROFILE_GROUPS = [
    { label: 'Generic LoRa', profiles: [profile('generic', 'Generic LoRa (defaults)', {})] },
    { label: 'MeshCore', profiles: meshcore },
    { label: 'Meshtastic', profiles: meshtastic },
    lorawan('EU868', 'Uplink', eu868Rates),
    lorawan('EU868', 'Downlink', eu868Rates),
    lorawan('US915', 'Uplink', [
        [0, 10, 125000], [1, 9, 125000], [2, 8, 125000], [3, 7, 125000], [4, 8, 500000],
    ]),
    lorawan('US915', 'Downlink', [
        [8, 12, 500000], [9, 11, 500000], [10, 10, 500000],
        [11, 9, 500000], [12, 8, 500000], [13, 7, 500000],
    ]),
    {
        label: 'Reticulum / RNode',
        profiles: [profile('reticulum-rnode', 'Reticulum / RNode (example)', {
            // Reticulum defines configurable interfaces, not a universal modem
            // preset. Use its documented SF8/BW125 example and the SX126x
            // RNode's minimum preamble; users must match their local interface.
            // https://reticulum.network/manual/interfaces.html#rnode-lora-interface
            sf: 8, bw: 125000, cr: 1, sync_word: [0x12], preamble_len: 18,
        }, { family: 'reticulum' })],
    },
];

export const LORA_PROFILES = LORA_PROFILE_GROUPS.flatMap(group => group.profiles);

export const findLoraProfile = (parameters = {}, preferredId) => {
    const matches = LORA_PROFILES.filter(candidate => (
        Object.entries(candidate.parameters).every(([key, value]) => (
            JSON.stringify(parameters[key] ?? defaults[key]) === JSON.stringify(value)
        ))
    ));
    // Some EU868 and US915 rates have identical PHY settings. Preserve an
    // explicit selection; without one, do not infer a region from those values.
    if (preferredId) return matches.find(candidate => candidate.id === preferredId);
    return matches.length === 1 ? matches[0] : undefined;
};
