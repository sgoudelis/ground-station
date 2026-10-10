/**
 * @license
 * Copyright (c) 2025 Efstratios Goudelis
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 *
 */

/**
 * Decoder Parameter Definitions
 *
 * Defines all configurable parameters for each decoder type.
 * These parameters map to DecoderConfig fields in the backend and flow through:
 * Frontend VFO state → Socket → Backend VFOStateManager → DecoderConfigService → Decoder
 *
 * Parameter naming convention: {decoder}_{parameter_name}
 * E.g., lora_sf, fsk_baudrate, bpsk_differential
 *
 * Structure:
 * - label: Display name for UI
 * - description: Optional help text
 * - type: 'select' or 'switch'
 * - default: Default value
 * - options: Array of {value, label, tooltip?} for select type
 *
 * All parameter sets are built through factory functions that receive the
 * caller's translator `t`. Module scope has no translator available, so a
 * module-level constant could not use `t(...)` for labels/tooltips. Callers
 * (React components) pass the `t` they get from `useTranslation(...)`, which
 * also keeps the labels in sync when the language changes.
 */

/**
 * Translator used when a consumer calls these helpers without supplying `t`
 * (for example plain helper modules or unit tests). It resolves to the English
 * `defaultValue`, i.e. exactly the strings that were hardcoded before the i18n
 * conversion.
 */
const englishFallback = (_key, options) => options?.defaultValue ?? _key;

/**
 * LoRa Decoder Parameters
 * LoRa uses chirp spread spectrum modulation with configurable spreading factor,
 * bandwidth, and error correction parameters.
 */
export const getLoraParameters = (t = englishFallback) => ({
    lora_sf: {
        label: t('decoder_parameters.spreading_factor', { defaultValue: 'Spreading Factor' }),
        description: t('decoder_parameters.higher_sf_longer_range_but_slower_data_rate', { defaultValue: 'Higher SF = longer range but slower data rate' }),
        type: 'select',
        default: 7,
        options: [
            { value: 7, label: 'SF7', tooltip: t('decoder_parameters.fastest_shortest_range', { defaultValue: 'Fastest, shortest range' }) },
            { value: 8, label: 'SF8' },
            { value: 9, label: 'SF9' },
            { value: 10, label: 'SF10' },
            { value: 11, label: 'SF11' },
            { value: 12, label: 'SF12', tooltip: t('decoder_parameters.slowest_longest_range', { defaultValue: 'Slowest, longest range' }) }
        ]
    },
    lora_bw: {
        label: 'Bandwidth',
        description: t('decoder_parameters.signal_bandwidth_in_hz', { defaultValue: 'Signal bandwidth in Hz' }),
        type: 'select',
        default: 125000,
        options: [
            { value: 62500, label: '62.5 kHz' },
            { value: 125000, label: '125 kHz' },
            { value: 250000, label: '250 kHz' },
            { value: 500000, label: '500 kHz' }
        ]
    },
    lora_cr: {
        label: t('decoder_parameters.coding_rate', { defaultValue: 'Coding Rate' }),
        description: t('decoder_parameters.forward_error_correction_ratio', { defaultValue: 'Forward error correction ratio' }),
        type: 'select',
        default: 1,
        options: [
            { value: 1, label: '4/5', tooltip: t('decoder_parameters.least_overhead_fastest', { defaultValue: 'Least overhead, fastest' }) },
            { value: 2, label: '4/6' },
            { value: 3, label: '4/7' },
            { value: 4, label: '4/8', tooltip: t('decoder_parameters.most_overhead_most_robust', { defaultValue: 'Most overhead, most robust' }) }
        ]
    },
    lora_sync_word: {
        label: t('decoder_parameters.sync_word', { defaultValue: 'Sync Word' }),
        description: t('decoder_parameters.network_identifier_for_packet_filtering', { defaultValue: 'Network identifier for packet filtering' }),
        type: 'select',
        default: [0x08, 0x10],
        options: [
            { value: [0x12], label: '0x12 (18) - LoRaWAN Private Networks (also for Meshtastic)' },
            { value: [0x34], label: '0x34 (52) - LoRaWAN Public Networks' },
            { value: [0x08, 0x10], label: '0x08 0x10 (8, 16) - TinyGS Satellite Network' },
            { value: [], label: t('decoder_parameters.auto_detect_accept_all_sync_words', { defaultValue: 'Auto-detect (accept all sync words)' }) }
        ],
        // Custom comparator for array values
        compare: (a, b) => JSON.stringify(a) === JSON.stringify(b)
    },
    lora_preamble_len: {
        label: t('decoder_parameters.preamble_length', { defaultValue: 'Preamble Length' }),
        description: t('decoder_parameters.number_of_preamble_symbols', { defaultValue: 'Number of preamble symbols' }),
        type: 'select',
        default: 8,
        options: [
            { value: 6, label: '6' },
            { value: 8, label: '8' },
            { value: 12, label: '12' },
            { value: 16, label: '16' }
        ]
    },
    lora_fldro: {
        label: t('decoder_parameters.low_data_rate_optimization', { defaultValue: 'Low Data Rate Optimization' }),
        description: t('decoder_parameters.enable_for_sf11_sf12_with_bw_500khz', { defaultValue: 'Enable for SF11/SF12 with BW < 500kHz' }),
        type: 'switch',
        default: false
    }
});

/**
 * FSK/GMSK/GFSK Decoder Parameters
 * FSK family decoders (Frequency Shift Keying) use the same underlying demodulator
 * with different pulse shaping. All three share the same parameter set.
 */
export const getFskParameters = (t = englishFallback) => ({
    fsk_baudrate: {
        label: t('decoder_parameters.baud_rate', { defaultValue: 'Baud Rate' }),
        description: t('decoder_parameters.symbol_rate_in_symbols_second', { defaultValue: 'Symbol rate in symbols/second' }),
        type: 'select',
        default: 9600,
        options: [
            { value: 50, label: '50 baud', tooltip: 'RTTY' },
            { value: 75, label: '75 baud', tooltip: 'RTTY' },
            { value: 110, label: '110 baud', tooltip: t('decoder_parameters.old_rtty_standard', { defaultValue: 'Old RTTY standard' }) },
            { value: 150, label: '150 baud', tooltip: 'RTTY' },
            { value: 200, label: '200 baud', tooltip: t('decoder_parameters.legacy_satellites', { defaultValue: 'Legacy satellites' }) },
            { value: 300, label: '300 baud', tooltip: t('decoder_parameters.low_speed_satellite_links', { defaultValue: 'Low-speed satellite links' }) },
            { value: 600, label: '600 baud', tooltip: t('decoder_parameters.low_speed_satellite_links', { defaultValue: 'Low-speed satellite links' }) },
            { value: 1200, label: '1200 baud' },
            { value: 1250, label: '1250 baud' },
            { value: 2400, label: '2400 baud' },
            { value: 2500, label: '2500 baud' },
            { value: 4800, label: '4800 baud' },
            { value: 5000, label: '5000 baud' },
            { value: 9600, label: '9600 baud' },
            { value: 12500, label: '12500 baud' },
            { value: 19200, label: '19200 baud' },
            { value: 38400, label: '38400 baud', tooltip: t('decoder_parameters.high_speed_uhf_links', { defaultValue: 'High-speed UHF links' }) },
            { value: 57600, label: '57600 baud', tooltip: t('decoder_parameters.very_high_speed_links', { defaultValue: 'Very high-speed links' }) },
            { value: 115200, label: '115200 baud', tooltip: t('decoder_parameters.extremely_high_speed_links', { defaultValue: 'Extremely high-speed links' }) }
        ]
    },
    fsk_framing: {
        label: t('decoder_parameters.framing_protocol', { defaultValue: 'Framing Protocol' }),
        description: t('decoder_parameters.data_framing_and_error_correction_protocol', { defaultValue: 'Data framing and error correction protocol' }),
        type: 'select',
        default: 'ax25',
        options: [
            { value: 'ax25', label: t('decoder_parameters.ax_25_g3ruh', { defaultValue: 'AX.25 (G3RUH)' }), tooltip: t('decoder_parameters.amateur_packet_radio_standard_with_g3ruh_scrambl', { defaultValue: 'Amateur packet radio standard with G3RUH scrambler' }) },
            { value: 'usp', label: t('decoder_parameters.usp_fec', { defaultValue: 'USP (FEC)' }), tooltip: t('decoder_parameters.unified_space_protocol_with_viterbi_reed_solomon', { defaultValue: 'Unified Space Protocol with Viterbi + Reed-Solomon FEC' }) },
            { value: 'geoscan', label: 'GEOSCAN', tooltip: t('decoder_parameters.geoscan_protocol_with_pn9_scrambling_and_cc11xx_', { defaultValue: 'GEOSCAN protocol with PN9 scrambling and CC11xx CRC' }) },
            { value: 'doka', label: t('decoder_parameters.doka_ccsds', { defaultValue: 'DOKA (CCSDS)' }), tooltip: t('decoder_parameters.ccsds_concatenated_frames_russian_satellites', { defaultValue: 'CCSDS concatenated frames (Russian satellites)' }) },
            { value: 'ax100_asm', label: t('decoder_parameters.ax100_asm_golay', { defaultValue: 'AX100 (ASM+Golay)' }), tooltip: t('decoder_parameters.gomspace_ax100_with_asm_sync_and_golay_fec', { defaultValue: 'GomSpace AX100 with ASM sync and Golay FEC' }) },
            { value: 'ax100_rs', label: t('decoder_parameters.ax100_reed_solomon', { defaultValue: 'AX100 (Reed-Solomon)' }), tooltip: t('decoder_parameters.gomspace_ax100_with_reed_solomon_fec', { defaultValue: 'GomSpace AX100 with Reed-Solomon FEC' }) }
        ]
    },
    fsk_deviation: {
        label: t('decoder_parameters.frequency_deviation', { defaultValue: 'Frequency Deviation' }),
        description: t('decoder_parameters.auto_calculated_based_on_baud_rate_if_not_specif', { defaultValue: 'Auto-calculated based on baud rate if not specified' }),
        type: 'select',
        default: null,
        options: [
            { value: null, label: t('decoder_parameters.auto_recommended', { defaultValue: 'Auto (recommended)' }), tooltip: t('decoder_parameters.automatically_calculated', { defaultValue: 'Automatically calculated: ~50% of baud rate' }) },
            { value: 125, label: '125 Hz' },
            { value: 300, label: '300 Hz' },
            { value: 312.5, label: '312.5 Hz' },
            { value: 500, label: '500 Hz' },
            { value: 560, label: '560 Hz' },
            { value: 562.5, label: '562.5 Hz' },
            { value: 565, label: '565 Hz' },
            { value: 575, label: '575 Hz' },
            { value: 600, label: '600 Hz' },
            { value: 625, label: '625 Hz' },
            { value: 750, label: '750 Hz' },
            { value: 800, label: '800 Hz' },
            { value: 1200, label: '1.2 kHz' },
            { value: 1250, label: '1.2 kHz' },
            { value: 1600, label: '1.6 kHz' },
            { value: 1800, label: '1.8 kHz' },
            { value: 2000, label: '2 kHz' },
            { value: 2400, label: '2.4 kHz' },
            { value: 2600, label: '2.6 kHz' },
            { value: 2700, label: '2.7 kHz' },
            { value: 3000, label: '3 kHz' },
            { value: 3125, label: '3.1 kHz' },
            { value: 3200, label: '3.2 kHz' },
            { value: 3500, label: '3.5 kHz' },
            { value: 4000, label: '4 kHz' },
            { value: 4800, label: '4.8 kHz' },
            { value: 5000, label: '5 kHz' },
            { value: 5400, label: '5.4 kHz' },
            { value: 7500, label: '7.5 kHz' },
            { value: 10000, label: '10 kHz' },
            { value: 15000, label: '15 kHz' },
            { value: 19200, label: '19.2 kHz' }
        ]
    },
    // GEOSCAN-specific parameters (conditionally shown)
    fsk_geoscan_frame_size: {
        label: t('decoder_parameters.geoscan_frame_size', { defaultValue: 'GEOSCAN Frame Size' }),
        description: t('decoder_parameters.frame_size_in_bytes_satellite_specific', { defaultValue: 'Frame size in bytes (satellite-specific)' }),
        type: 'select',
        default: 66,
        options: [
            { value: 66, label: '66 bytes', tooltip: t('decoder_parameters.most_common_e_g_geoscan_edelveis', { defaultValue: 'Most common (e.g., GEOSCAN-Edelveis)' }) },
            { value: 74, label: '74 bytes', tooltip: t('decoder_parameters.alternative_frame_size', { defaultValue: 'Alternative frame size' }) }
        ],
        visibleWhen: (params) => params.fsk_framing === 'geoscan'
    }
});

/**
 * GMSK uses the same parameters as FSK
 * GMSK (Gaussian Minimum Shift Keying) is FSK with Gaussian pulse shaping and h=0.5
 *
 * Create GMSK-prefixed copies of FSK parameters
 */
export const getGmskParameters = (t = englishFallback) => Object.entries(getFskParameters(t)).reduce((acc, [key, value]) => {
    const gmskKey = key.replace('fsk_', 'gmsk_');
    acc[gmskKey] = {
        ...value,
        // Update visibleWhen to use gmsk_ prefix
        visibleWhen: value.visibleWhen
            ? (params) => value.visibleWhen(
                Object.entries(params).reduce((p, [k, v]) => {
                    p[k.replace('gmsk_', 'fsk_')] = v;
                    return p;
                }, {})
            )
            : undefined
    };
    return acc;
}, {});

/**
 * GFSK uses the same parameters as FSK
 * GFSK (Gaussian Frequency Shift Keying) is FSK with Gaussian pulse shaping and h>0.5
 *
 * Create GFSK-prefixed copies of FSK parameters
 */
export const getGfskParameters = (t = englishFallback) => Object.entries(getFskParameters(t)).reduce((acc, [key, value]) => {
    const gfskKey = key.replace('fsk_', 'gfsk_');
    acc[gfskKey] = {
        ...value,
        // Update visibleWhen to use gfsk_ prefix
        visibleWhen: value.visibleWhen
            ? (params) => value.visibleWhen(
                Object.entries(params).reduce((p, [k, v]) => {
                    p[k.replace('gfsk_', 'fsk_')] = v;
                    return p;
                }, {})
            )
            : undefined
    };
    return acc;
}, {});

/**
 * BPSK Decoder Parameters
 * BPSK (Binary Phase Shift Keying) modulates data by shifting carrier phase.
 * Supports coherent BPSK and non-coherent DBPSK (differential) modes.
 */
export const getBpskParameters = (t = englishFallback) => ({
    bpsk_baudrate: {
        label: t('decoder_parameters.baud_rate', { defaultValue: 'Baud Rate' }),
        description: t('decoder_parameters.symbol_rate_in_symbols_second', { defaultValue: 'Symbol rate in symbols/second' }),
        type: 'select',
        default: 9600,
        options: [
            { value: 50, label: '50 baud', tooltip: 'RTTY' },
            { value: 75, label: '75 baud', tooltip: 'RTTY' },
            { value: 110, label: '110 baud', tooltip: t('decoder_parameters.old_rtty_standard', { defaultValue: 'Old RTTY standard' }) },
            { value: 150, label: '150 baud', tooltip: 'RTTY' },
            { value: 200, label: '200 baud', tooltip: t('decoder_parameters.legacy_satellites', { defaultValue: 'Legacy satellites' }) },
            { value: 300, label: '300 baud', tooltip: t('decoder_parameters.low_speed_satellite_links', { defaultValue: 'Low-speed satellite links' }) },
            { value: 600, label: '600 baud', tooltip: t('decoder_parameters.low_speed_satellite_links', { defaultValue: 'Low-speed satellite links' }) },
            { value: 1200, label: '1200 baud' },
            { value: 1250, label: '1250 baud' },
            { value: 2400, label: '2400 baud' },
            { value: 2500, label: '2500 baud' },
            { value: 4800, label: '4800 baud' },
            { value: 5000, label: '5000 baud' },
            { value: 9600, label: '9600 baud' },
            { value: 12500, label: '12500 baud' },
            { value: 19200, label: '19200 baud' },
            { value: 38400, label: '38400 baud', tooltip: t('decoder_parameters.high_speed_uhf_links', { defaultValue: 'High-speed UHF links' }) },
            { value: 57600, label: '57600 baud', tooltip: t('decoder_parameters.very_high_speed_links', { defaultValue: 'Very high-speed links' }) },
            { value: 115200, label: '115200 baud', tooltip: t('decoder_parameters.extremely_high_speed_links', { defaultValue: 'Extremely high-speed links' }) }
        ]
    },
    bpsk_framing: {
        label: t('decoder_parameters.framing_protocol', { defaultValue: 'Framing Protocol' }),
        description: t('decoder_parameters.data_framing_and_error_correction_protocol', { defaultValue: 'Data framing and error correction protocol' }),
        type: 'select',
        default: 'ax25',
        options: [
            { value: 'ax25', label: t('decoder_parameters.ax_25_g3ruh', { defaultValue: 'AX.25 (G3RUH)' }), tooltip: t('decoder_parameters.amateur_packet_radio_standard_with_g3ruh_scrambl', { defaultValue: 'Amateur packet radio standard with G3RUH scrambler' }) },
            { value: 'doka', label: t('decoder_parameters.doka_ccsds', { defaultValue: 'DOKA (CCSDS)' }), tooltip: t('decoder_parameters.ccsds_reed_solomon_frames_e_g_chomptt', { defaultValue: 'CCSDS Reed-Solomon frames (e.g., Chomptt)' }) }
        ]
    },
    bpsk_differential: {
        label: t('decoder_parameters.differential_mode_dbpsk', { defaultValue: 'Differential Mode (DBPSK)' }),
        description: t('decoder_parameters.enable_for_non_coherent_differential_bpsk_decodi', { defaultValue: 'Enable for non-coherent differential BPSK decoding' }),
        type: 'switch',
        default: false
    }
});

/**
 * Geoscan/Alferov images use FSK plus a Geoscan packet layer.
 * Keep every receiver choice explicit; future satellite profiles may populate
 * these fields as UI presets but must not change the decoder implementation.
 */
export const getGeoscanImageParameters = (t = englishFallback) => ({
    geoscanimage_baudrate: {
        label: t('decoder_parameters.baud_rate', { defaultValue: 'Baud Rate' }),
        description: t('decoder_parameters.fsk_symbol_rate', { defaultValue: 'FSK symbol rate' }),
        type: 'select',
        default: 9600,
        options: [
            { value: 4800, label: '4800 baud' },
            { value: 9600, label: '9600 baud' },
            { value: 19200, label: '19200 baud' }
        ]
    },
    geoscanimage_deviation: {
        label: t('decoder_parameters.frequency_deviation', { defaultValue: 'Frequency Deviation' }),
        description: t('decoder_parameters.fsk_deviation_in_hz', { defaultValue: 'FSK deviation in Hz' }),
        type: 'select',
        default: 5000,
        options: [
            { value: 2400, label: '2.4 kHz' },
            { value: 4800, label: '4.8 kHz' },
            { value: 5000, label: '5 kHz' },
            { value: 7500, label: '7.5 kHz' },
            { value: 10000, label: '10 kHz' }
        ]
    },
    geoscanimage_frame_size: {
        label: t('decoder_parameters.geoscan_frame_size_2', { defaultValue: 'Geoscan Frame Size' }),
        description: t('decoder_parameters.on_air_frame_length_including_the_cc11xx_crc', { defaultValue: 'On-air frame length, including the CC11xx CRC' }),
        type: 'select',
        default: 74,
        options: [
            { value: 66, label: '66 bytes' },
            { value: 74, label: '74 bytes (Alferov)' }
        ]
    },
    geoscanimage_syncword_threshold: {
        label: t('decoder_parameters.sync_word_errors', { defaultValue: 'Sync Word Errors' }),
        description: t('decoder_parameters.maximum_bit_errors_accepted_in_the_32_bit_geosca', { defaultValue: 'Maximum bit errors accepted in the 32-bit Geoscan sync word' }),
        type: 'select',
        default: 4,
        options: [
            { value: 0, label: '0 (exact)' },
            { value: 2, label: '2' },
            { value: 4, label: '4 (default)' },
            { value: 6, label: '6' }
        ]
    },
    geoscanimage_satellite_id: {
        label: t('decoder_parameters.satellite_id', { defaultValue: 'Satellite ID' }),
        description: t('decoder_parameters.geoscan_satellite_byte_9_is_239_alferov', { defaultValue: 'Geoscan satellite byte; 9 is 239 Alferov' }),
        type: 'select',
        default: 9,
        options: [
            { value: 9, label: '9 (239 Alferov)' },
            { value: 10, label: '10' },
            { value: 12, label: '12' }
        ]
    }
});

/**
 * APRS Decoder Parameters
 * The decoder consumes raw IQ and performs NBFM and Bell 202 demodulation internally.
 */
export const getAprsParameters = (t = englishFallback) => ({
    aprs_baudrate: {
        label: t('decoder_parameters.baud_rate', { defaultValue: 'Baud Rate' }),
        description: t('decoder_parameters.symbol_rate_in_symbols_second', { defaultValue: 'Symbol rate in symbols/second' }),
        type: 'select',
        default: 1200,
        options: [
            { value: 1143, label: '1143 baud', tooltip: t('decoder_parameters.some_satellites', { defaultValue: 'Some satellites' }) },
            { value: 1200, label: '1200 baud', tooltip: t('decoder_parameters.bell_202_aprs_vhf_packet_radio', { defaultValue: 'Bell 202 (APRS, VHF packet radio)' }) },
            { value: 1240, label: '1240 baud', tooltip: t('decoder_parameters.some_satellite_aprs_variants', { defaultValue: 'Some satellite APRS variants' }) }
        ]
    },
    aprs_af_carrier: {
        label: t('decoder_parameters.audio_carrier_frequency', { defaultValue: 'Audio Carrier Frequency' }),
        description: t('decoder_parameters.center_frequency_of_the_audio_fsk_tones', { defaultValue: 'Center frequency of the audio FSK tones' }),
        type: 'select',
        default: 1700,
        options: [
            { value: 1700, label: '1700 Hz', tooltip: t('decoder_parameters.bell_202_aprs_standard', { defaultValue: 'Bell 202 APRS standard' }) },
            { value: 1810, label: '1810 Hz', tooltip: t('decoder_parameters.some_satellite_aprs_variants', { defaultValue: 'Some satellite APRS variants' }) }
        ]
    },
    aprs_deviation: {
        label: t('decoder_parameters.frequency_deviation', { defaultValue: 'Frequency Deviation' }),
        description: t('decoder_parameters.audio_frequency_shift_from_carrier', { defaultValue: 'Audio frequency shift from carrier' }),
        type: 'select',
        default: 500,
        options: [
            { value: 500, label: '500 Hz', tooltip: t('decoder_parameters.standard_for_1200_baud_bell_202', { defaultValue: 'Standard for 1200 baud (Bell 202)' }) },
            { value: 565, label: '565 Hz', tooltip: t('decoder_parameters.some_satellites', { defaultValue: 'Some satellites' }) },
            { value: 600, label: '600 Hz', tooltip: t('decoder_parameters.some_satellite_aprs_variants', { defaultValue: 'Some satellite APRS variants' }) }
        ]
    }
});

/**
 * SSTV Decoder Parameters
 * SSTV (Slow Scan Television) supports multiple transmission modes.
 * Mode can be auto-detected via VIS code or explicitly forced.
 */
export const getSstvParameters = (t = englishFallback) => ({
    sstv_mode: {
        label: t('decoder_parameters.sstv_mode', { defaultValue: 'SSTV Mode' }),
        description: t('decoder_parameters.use_the_received_vis_code_or_force_a_specific_ss', { defaultValue: 'Use the received VIS code or force a specific SSTV mode' }),
        type: 'select',
        default: 'auto',
        options: [
            { value: 'auto', label: t('decoder_parameters.auto_detect_vis_code', { defaultValue: 'Auto-detect (VIS code)' }), tooltip: t('decoder_parameters.automatically_detect_mode_from_vis_signal', { defaultValue: 'Automatically detect mode from VIS signal' }) },
            { value: 'robot36', label: t('decoder_parameters.force', { defaultValue: 'Force: Robot 36' }), tooltip: t('decoder_parameters.ignore_vis_and_decode_as_robot_36', { defaultValue: 'Ignore VIS and decode as Robot 36' }) },
            { value: 'martin_m1', label: t('decoder_parameters.force_2', { defaultValue: 'Force: Martin M1' }), tooltip: t('decoder_parameters.ignore_vis_and_decode_as_martin_m1', { defaultValue: 'Ignore VIS and decode as Martin M1' }) },
            { value: 'martin_m2', label: t('decoder_parameters.force_3', { defaultValue: 'Force: Martin M2' }), tooltip: t('decoder_parameters.ignore_vis_and_decode_as_martin_m2', { defaultValue: 'Ignore VIS and decode as Martin M2' }) },
            { value: 'scottie_s1', label: t('decoder_parameters.force_4', { defaultValue: 'Force: Scottie S1' }), tooltip: t('decoder_parameters.ignore_vis_and_decode_as_scottie_s1', { defaultValue: 'Ignore VIS and decode as Scottie S1' }) },
            { value: 'scottie_s2', label: t('decoder_parameters.force_5', { defaultValue: 'Force: Scottie S2' }), tooltip: t('decoder_parameters.ignore_vis_and_decode_as_scottie_s2', { defaultValue: 'Ignore VIS and decode as Scottie S2' }) },
            { value: 'scottie_dx', label: t('decoder_parameters.force_6', { defaultValue: 'Force: Scottie DX' }), tooltip: t('decoder_parameters.ignore_vis_and_decode_as_scottie_dx', { defaultValue: 'Ignore VIS and decode as Scottie DX' }) },
            { value: 'wraase_sc2_180', label: t('decoder_parameters.force_7', { defaultValue: 'Force: Wraase SC2-180' }), tooltip: t('decoder_parameters.ignore_vis_and_decode_as_wraase_sc2_180', { defaultValue: 'Ignore VIS and decode as Wraase SC2-180' }) }
        ]
    }
});

/**
 * GNSS-SDR Decoder Parameters
 * GNSS decoder streams wideband L1 IQ into GNSS-SDR for multi-constellation processing.
 */
export const getGnssParameters = (t = englishFallback) => ({
    gnss_sample_rate: {
        label: t('decoder_parameters.gnss_processing_rate', { defaultValue: 'GNSS Processing Rate' }),
        description: t('decoder_parameters.target_rate_fed_to_gnss_sdr_if_sdr_rate_is_highe', { defaultValue: 'Target rate fed to GNSS-SDR. If SDR rate is higher, IQ is integer-downsampled after filtering (e.g., 4.0 -> 2.0 MS/s = /2). If SDR rate is lower, no upsampling is applied.' }),
        type: 'select',
        default: 4000000,
        options: [
            { value: 2000000, label: '2.0 MS/s' },
            { value: 2500000, label: '2.5 MS/s' },
            { value: 4000000, label: '4.0 MS/s' },
            { value: 5000000, label: '5.0 MS/s' }
        ]
    },
    gnss_total_channels: {
        label: t('decoder_parameters.total_channels', { defaultValue: 'Total Channels' }),
        description: t('decoder_parameters.total_acquisition_tracking_channels_shared_acros', { defaultValue: 'Total acquisition/tracking channels shared across enabled constellations' }),
        type: 'select',
        default: 24,
        options: [
            { value: 8, label: '8' },
            { value: 12, label: '12' },
            { value: 16, label: '16' },
            { value: 24, label: '24' },
            { value: 32, label: '32' },
            { value: 48, label: '48' }
        ]
    },
    gnss_output_rate_ms: {
        label: t('decoder_parameters.pvt_update_rate', { defaultValue: 'PVT Update Rate' }),
        description: t('decoder_parameters.navigation_pvt_output_interval', { defaultValue: 'Navigation/PVT output interval' }),
        type: 'select',
        default: 500,
        options: [
            { value: 100, label: '100 ms' },
            { value: 200, label: '200 ms' },
            { value: 500, label: '500 ms' },
            { value: 1000, label: '1000 ms' }
        ]
    },
    gnss_doppler_max: {
        label: t('decoder_parameters.max_doppler_search', { defaultValue: 'Max Doppler Search' }),
        description: t('decoder_parameters.acquisition_doppler_search_window_in_hz', { defaultValue: 'Acquisition Doppler search window in Hz' }),
        type: 'select',
        default: 6000,
        options: [
            { value: 3000, label: '3 kHz' },
            { value: 4000, label: '4 kHz' },
            { value: 6000, label: '6 kHz' },
            { value: 8000, label: '8 kHz' },
            { value: 10000, label: '10 kHz' }
        ]
    },
    gnss_enable_gps: {
        label: t('decoder_parameters.gps_l1_c_a', { defaultValue: 'GPS (L1 C/A)' }),
        type: 'switch',
        default: true
    },
    gnss_enable_galileo: {
        label: t('decoder_parameters.galileo_e1b', { defaultValue: 'Galileo (E1B)' }),
        type: 'switch',
        default: true
    },
    gnss_enable_glonass: {
        label: t('decoder_parameters.glonass_l1_c_a', { defaultValue: 'GLONASS (L1 C/A)' }),
        type: 'switch',
        default: true
    },
    gnss_enable_beidou: {
        label: t('decoder_parameters.beidou_b1i', { defaultValue: 'BeiDou (B1I)' }),
        type: 'switch',
        default: true
    },
    gnss_enable_qzss: {
        label: t('decoder_parameters.qzss_l1_c_a', { defaultValue: 'QZSS (L1 C/A)' }),
        type: 'switch',
        default: true
    }
});

/**
 * Decoder support flags
 * Use this map to disable unsupported decoders in the UI.
 */
export const DECODER_SUPPORT = {
    sstv: true,
    geoscanimage: true,
    fsk: true,
    gmsk: true,
    gfsk: true,
    bpsk: true,
    apt: true,
    lora: false,
    morse: false,
    afsk: false,
    aprs: true,
    gnss: true
};

/**
 * SatDump Pipeline Definitions
 * Defines supported SatDump pipelines by satellite family.
 */
export const getSatdumpPipelines = (t = englishFallback) => ({
    meteor: {
        label: 'METEOR',
        description: t('decoder_parameters.satdump_pipelines_for_meteor_satellites', { defaultValue: 'SatDump pipelines for METEOR satellites' }),
        pipelines: [
            { value: 'meteor_m2-x_lrpt', label: t('decoder_parameters.meteor_m2_lrpt', { defaultValue: 'METEOR-M2 LRPT' }) },
            { value: 'meteor_m2-x_lrpt_80k', label: t('decoder_parameters.meteor_m2_lrpt_80k', { defaultValue: 'METEOR-M2 LRPT (80k)' }) },
            { value: 'meteor_hrpt', label: t('decoder_parameters.meteor_hrpt', { defaultValue: 'METEOR HRPT' }) }
        ]
    },
    elektro: {
        label: 'ELEKTRO',
        description: t('decoder_parameters.satdump_pipelines_for_elektro_l', { defaultValue: 'SatDump pipelines for ELEKTRO-L' }),
        pipelines: [
            { value: 'elektro_lrit', label: t('decoder_parameters.elektro_l_lrit', { defaultValue: 'ELEKTRO-L LRIT' }) },
            { value: 'elektro_hrit', label: t('decoder_parameters.elektro_l_hrit', { defaultValue: 'ELEKTRO-L HRIT' }) }
        ]
    }
});

/**
 * Combined parameter definitions for all decoders
 */
export const getDecoderParameterDefinitions = (t = englishFallback) => ({
    ...getLoraParameters(t),
    ...getFskParameters(t),
    ...getGmskParameters(t),
    ...getGfskParameters(t),
    ...getBpskParameters(t),
    ...getGeoscanImageParameters(t),
    ...getAprsParameters(t),
    ...getGnssParameters(t),
    ...getSstvParameters(t)
});

/**
 * Cached copy of the combined definitions, keyed by translator identity.
 * The definitions are rebuilt whenever the language (and therefore `t`)
 * changes, while repeated calls during a render stay cheap.
 */
const definitionsCache = new WeakMap();

const getCachedDecoderParameterDefinitions = (t) => {
    // WeakMap keys must be objects; fall back to a direct build otherwise.
    if (!t || (typeof t !== 'function' && typeof t !== 'object')) {
        return getDecoderParameterDefinitions(t);
    }
    let definitions = definitionsCache.get(t);
    if (!definitions) {
        definitions = getDecoderParameterDefinitions(t);
        definitionsCache.set(t, definitions);
    }
    return definitions;
};

/**
 * Get parameter definitions for a specific decoder
 * @param {string} decoder - Decoder name (e.g., 'lora', 'fsk', 'gmsk', 'gfsk', 'bpsk', 'geoscanimage', 'sstv')
 * @param {Function} [t] - Translator from useTranslation(); falls back to the English defaultValue
 * @returns {Object} Parameter definitions for this decoder
 */
export function getDecoderParameters(decoder, t = englishFallback) {
    const prefix = `${decoder}_`;
    return Object.entries(getCachedDecoderParameterDefinitions(t))
        .filter(([key]) => key.startsWith(prefix))
        .reduce((acc, [key, value]) => {
            acc[key] = value;
            return acc;
        }, {});
}

/**
 * Get default parameters for a specific decoder
 * @param {string} decoder - Decoder name
 * @param {Function} [t] - Translator from useTranslation(); falls back to the English defaultValue
 * @returns {Object} Default parameter values
 */
export function getDecoderDefaultParameters(decoder, t = englishFallback) {
    const params = getDecoderParameters(decoder, t);
    return Object.entries(params).reduce((acc, [key, param]) => {
        acc[key] = param.default;
        return acc;
    }, {});
}

/**
 * Map frontend parameter names to backend names
 * Frontend uses prefixed flat keys (lora_sf), backend uses unprefixed names (sf)
 *
 * @param {string} decoder - Decoder name (e.g., 'lora', 'fsk', 'gmsk', 'gfsk', 'bpsk')
 * @param {Object} parameters - Frontend parameters object
 * @returns {Object} Backend-compatible parameters (for DecoderConfigService overrides)
 */
export function mapParametersToBackend(decoder, parameters) {
    if (decoder === 'lora') {
        return {
            sf: parameters.lora_sf,
            bw: parameters.lora_bw,
            cr: parameters.lora_cr,
            sync_word: parameters.lora_sync_word,
            preamble_len: parameters.lora_preamble_len,
            fldro: parameters.lora_fldro
        };
    }

    // FSK-family decoders (FSK, GMSK, GFSK) share the same parameter structure
    if (decoder === 'fsk' || decoder === 'gmsk' || decoder === 'gfsk') {
        const prefix = `${decoder}_`;
        const backendParams = {
            baudrate: parameters[`${prefix}baudrate`],
            framing: parameters[`${prefix}framing`],
            deviation: parameters[`${prefix}deviation`]
        };

        // Add framing-specific parameters
        const framing = parameters[`${prefix}framing`];
        if (framing === 'geoscan') {
            backendParams.framing_params = {
                frame_size: parameters[`${prefix}geoscan_frame_size`] || 66
            };
        }

        return backendParams;
    }

    if (decoder === 'bpsk') {
        return {
            baudrate: parameters.bpsk_baudrate,
            framing: parameters.bpsk_framing,
            differential: parameters.bpsk_differential
        };
    }

    if (decoder === 'geoscanimage') {
        return {
            baudrate: parameters.geoscanimage_baudrate,
            deviation: parameters.geoscanimage_deviation,
            framing_params: {
                frame_size: parameters.geoscanimage_frame_size,
                syncword_threshold: parameters.geoscanimage_syncword_threshold,
                satellite_id: parameters.geoscanimage_satellite_id
            }
        };
    }

    if (decoder === 'aprs') {
        return {
            baudrate: parameters.aprs_baudrate,
            af_carrier: parameters.aprs_af_carrier,
            deviation: parameters.aprs_deviation,
            framing: 'aprs'
        };
    }

    if (decoder === 'sstv') {
        return {
            sstv_mode: parameters.sstv_mode ?? 'auto'
        };
    }

    if (decoder === 'gnss') {
        return {
            gnss_sample_rate: parameters.gnss_sample_rate ?? 4000000,
            gnss_total_channels: parameters.gnss_total_channels ?? 24,
            gnss_output_rate_ms: parameters.gnss_output_rate_ms ?? 500,
            gnss_doppler_max: parameters.gnss_doppler_max ?? 6000,
            gnss_enable_gps: parameters.gnss_enable_gps ?? true,
            gnss_enable_galileo: parameters.gnss_enable_galileo ?? true,
            gnss_enable_glonass: parameters.gnss_enable_glonass ?? true,
            gnss_enable_beidou: parameters.gnss_enable_beidou ?? true,
            gnss_enable_qzss: parameters.gnss_enable_qzss ?? true
        };
    }

    // Other decoders have no parameters
    return {};
}
