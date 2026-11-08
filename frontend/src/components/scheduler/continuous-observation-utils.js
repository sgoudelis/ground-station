// Copyright (c) 2026 Efstratios Goudelis
// SPDX-License-Identifier: GPL-3.0-or-later

import { v4 as uuidv4 } from 'uuid';
import { calculateChannelCenterFrequency, createEmptySdrSession, getFrequencySpan } from './session-utils.js';
import { getSdrCaptureBandwidth, getSdrTuningRangeHz, isSdrBandwidthUnavailable } from '../common/sdr-parameters.js';
import { areDecoderParametersValid, DECODER_SUPPORT, getDecoderDefaultParameters } from '../waterfall/decoder-parameters.js';

// Continuous observations use backend-owned sessions, which allow ten VFOs.
export const CONTINUOUS_VFO_LIMIT = 10;
export const CONTINUOUS_MODULATIONS = ['none', 'fm', 'am', 'usb', 'lsb', 'cw'];
export const CONTINUOUS_DECODERS = [
    ['none', 'None'], ['fsk', 'FSK'], ['gmsk', 'GMSK'], ['gfsk', 'GFSK'],
    ['bpsk', 'BPSK'], ['aprs', 'APRS'], ['sstv', 'SSTV'], ['apt', 'APT'],
    ['geoscanimage', 'Geoscan image'], ['radiosonde', 'Radiosonde'],
    ['lora', 'LoRa'], ['adsb', 'ADS-B'], ['gnss', 'GNSS'],
].filter(([value]) => value === 'none' || DECODER_SUPPORT[value]);

export const createContinuousVfo = (frequency) => ({
    id: uuidv4(),
    frequency,
    bandwidth: 12500,
    modulation: 'fm',
    decoder: 'none',
    decoder_parameters: {},
});

export const createContinuousObservation = () => ({
    id: uuidv4(),
    name: '',
    auto_start: true,
    config_version: 1,
    sdr: { ...createEmptySdrSession().sdr, center_frequency: 145800000 },
    vfos: [createContinuousVfo(145800000)],
});

// Older definitions kept an audio mode beside their decoder. The decoder has
// always taken precedence in the waterfall, so show and save that effective mode.
export const normalizeContinuousVfo = (vfo) => vfo.decoder !== 'none'
    ? { ...vfo, modulation: 'none' } : vfo;

export const setContinuousModulation = (vfo, modulation) => ({
    ...vfo, modulation, decoder: 'none', decoder_parameters: {},
});

export const setContinuousDecoder = (vfo, decoder) => ({
    ...vfo,
    decoder,
    modulation: decoder === 'none' ? vfo.modulation : 'none',
    bandwidth: ({ sstv: 12500, geoscanimage: 20000, apt: 40000, lora: 500000,
        gnss: 2000000, aprs: 12500, radiosonde: 20000, adsb: 2000000 })[decoder] ?? vfo.bandwidth,
    decoder_parameters: getDecoderDefaultParameters(decoder),
});

export const getContinuousCapture = (observation, device, parameters) => {
    const bandwidth = getSdrCaptureBandwidth(observation.sdr, device, parameters);
    const center = Number(observation.sdr.center_frequency);
    return { bandwidth, min: center - bandwidth / 2, max: center + bandwidth / 2 };
};

const positive = (value) => typeof value === 'number' && Number.isFinite(value) && value > 0;
const getContinuousFrequencyDetails = (observation) => observation.vfos
    // Incomplete inputs must not pull the receiver toward zero while typing.
    // They remain invalid for saving even if other VFOs can still be centered.
    .filter((vfo) => positive(vfo.frequency) && positive(vfo.bandwidth))
    .map((vfo) => ({ freq: vfo.frequency, bandwidth: vfo.bandwidth }));

export const getContinuousFrequencySpan = (observation) => getFrequencySpan(getContinuousFrequencyDetails(observation));

export const calculateContinuousCenterFrequency = (observation, device, parameters) => {
    const bandwidth = getSdrCaptureBandwidth(observation.sdr, device, parameters);
    if (!positive(bandwidth)) return 0;
    return calculateChannelCenterFrequency(getContinuousFrequencyDetails(observation), bandwidth, getSdrTuningRangeHz(device));
};

export const validateContinuousObservation = (observation, devices, parameters) => {
    const device = devices.find((entry) => String(entry.id) === String(observation.sdr.id));
    const capture = getContinuousCapture(observation, device, parameters);
    const center = observation.sdr.center_frequency;
    const tuningRange = getSdrTuningRangeHz(device);
    return {
        name: !observation.name.trim(),
        sdr: !device || device.type === 'sigmfplayback' || device.id === 'sigmf-playback',
        center: !positive(center) || center < tuningRange.min || center > tuningRange.max,
        sampleRate: !positive(observation.sdr.sample_rate),
        gain: observation.sdr.gain === '' || observation.sdr.gain == null,
        antenna: !observation.sdr.antenna_port,
        bandwidth: isSdrBandwidthUnavailable(observation.sdr, device, parameters),
        vfoCount: !observation.vfos.length || observation.vfos.length > CONTINUOUS_VFO_LIMIT,
        vfoSpan: getContinuousFrequencySpan(observation).requiredBandwidth > capture.bandwidth,
        vfos: observation.vfos.map((vfo) => ({
            frequency: !positive(vfo.frequency),
            bandwidth: !positive(vfo.bandwidth),
            // Validate the entire channel, rather than only its center point.
            outsideCapture: positive(vfo.frequency) && positive(vfo.bandwidth)
                && (vfo.frequency - vfo.bandwidth / 2 < capture.min
                    || vfo.frequency + vfo.bandwidth / 2 > capture.max),
            decoder: !CONTINUOUS_MODULATIONS.includes(vfo.modulation)
                || (vfo.decoder !== 'none' && vfo.modulation !== 'none')
                || !CONTINUOUS_DECODERS.some(([value]) => value === vfo.decoder)
                || !areDecoderParametersValid(vfo.decoder, vfo.decoder_parameters),
        })),
    };
};

export const hasContinuousErrors = ({ vfos, ...fields }) =>
    Object.values(fields).some(Boolean) || vfos.some((entry) => Object.values(entry).some(Boolean));
