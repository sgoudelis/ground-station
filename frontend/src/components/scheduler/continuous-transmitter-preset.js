// Copyright (c) 2026 Efstratios Goudelis
// SPDX-License-Identifier: GPL-3.0-or-later

import { normalizeContinuousVfo, setContinuousModulation } from './continuous-observation-utils.js';
import { getDecoderConfig } from '../waterfall/vfo-marker/vfo-config.js';
import { getDecoderDefaultParameters, getDecoderParameters, isDecoderParameterValid } from '../waterfall/decoder-parameters.js';

const positive = (value) => Number.isFinite(value) && value > 0;
const PACKET_DECODERS = ['fsk', 'gfsk', 'gmsk', 'bpsk'];
const MODES = { FSK: 'fsk', GFSK: 'gfsk', GMSK: 'gmsk', BPSK: 'bpsk', DBPSK: 'bpsk',
    LORA: 'lora', SSTV: 'sstv', APT: 'apt' };

export const getTransmitterDownlink = (transmitter) =>
    [transmitter?.downlink_low, transmitter?.downlink_high].find(positive);

const resolveDecoder = (transmitter, mode) => {
    if (Object.hasOwn(MODES, mode)) return MODES[mode];
    const aprs = mode === 'APRS' || (['FM', 'AFSK', ''].includes(mode)
        && /\bAPRS\b/i.test(transmitter.description || ''));
    // This project's APRS decoder implements Bell 202, not 9600-baud FSK APRS.
    const aprsRates = getDecoderParameters('aprs').aprs_baudrate.options;
    if (aprs && (transmitter.baud == null || aprsRates.some(({ value }) => value === transmitter.baud))) return 'aprs';
    return null;
};

export const applyContinuousTransmitter = (vfo, transmitter) => {
    const frequency = getTransmitterDownlink(transmitter);
    if (!frequency) return vfo;
    const result = { ...normalizeContinuousVfo(vfo), frequency };
    const mode = String(transmitter.mode || '').trim().toUpperCase();
    const decoder = resolveDecoder(transmitter, mode);
    if (!decoder) {
        // A recognized audio preset replaces data decoding; unknown modes only
        // supply a frequency and leave the current processing choice in place.
        return ['FM', 'AM', 'USB', 'LSB', 'CW'].includes(mode)
            ? setContinuousModulation(result, mode.toLowerCase()) : result;
    }

    result.decoder = decoder;
    result.modulation = 'none';
    // Start new decoder types with their defaults; retain manual settings for
    // the same decoder unless the selected record supplies an explicit value.
    const parameters = { ...structuredClone(getDecoderDefaultParameters(decoder)),
        ...(decoder === vfo.decoder ? structuredClone(vfo.decoder_parameters) : {}) };
    const definitions = getDecoderParameters(decoder);
    const supplied = {};
    const applied = new Set();
    if (PACKET_DECODERS.includes(decoder) || decoder === 'aprs') {
        if (Number.isInteger(transmitter.baud) && positive(transmitter.baud)) supplied[`${decoder}_baudrate`] = transmitter.baud;
    }
    if (PACKET_DECODERS.includes(decoder)) {
        supplied[`${decoder}_framing`] = String(transmitter.framing || '').trim().toLowerCase();
        if (Number.isFinite(transmitter.deviation) && transmitter.deviation !== 0 && decoder !== 'bpsk') {
            supplied[`${decoder}_deviation`] = transmitter.deviation;
        }
        if (mode === 'DBPSK') supplied.bpsk_differential = true;
    }
    if (decoder === 'lora' && transmitter.lora_config && typeof transmitter.lora_config === 'object') {
        for (const [key, value] of Object.entries(transmitter.lora_config)) supplied[`lora_${key}`] = value;
    }
    for (const [key, value] of Object.entries(supplied)) {
        const definition = definitions[key];
        if (!definition) continue;
        // Packet rates and deviations can be valid catalog values outside the
        // usual dropdown choices; the form adds them as selectable custom values.
        const customNumber = key.endsWith('_baudrate') || key.endsWith('_deviation');
        const valid = definition.type === 'switch' ? typeof value === 'boolean'
            : definition.type === 'select' ? customNumber || definition.options.some((option) => (
                definition.compare ? definition.compare(option.value, value) : option.value === value
            )) : isDecoderParameterValid(definition, value);
        if (valid) {
            parameters[key] = structuredClone(value);
            applied.add(key);
        }
    }
    result.decoder_parameters = parameters;
    const config = getDecoderConfig(decoder);
    // These are starting receiver widths, not a transmitter lock. Never infer
    // signal bandwidth from downlink_high-low: that can describe a tuning range.
    result.bandwidth = decoder === vfo.decoder ? vfo.bandwidth : config.defaultBandwidth;
    if (decoder === 'lora' && (decoder !== vfo.decoder || applied.has('lora_bw'))) result.bandwidth = parameters.lora_bw;
    if (PACKET_DECODERS.includes(decoder)
        && (applied.has(`${decoder}_baudrate`) || applied.has(`${decoder}_deviation`))) {
        const baud = parameters[`${decoder}_baudrate`];
        result.bandwidth = Math.max(config.calculateBandwidth({ baud }),
            // A stored deviation can need more RF bandwidth than the usual
            // baud-based estimate, especially for low-rate FSK beacons.
            2 * Math.abs(parameters[`${decoder}_deviation`] || 0) + baud);
    }
    return result;
};
