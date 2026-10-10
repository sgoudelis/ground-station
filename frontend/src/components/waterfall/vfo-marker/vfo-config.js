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

import i18n from '../../../i18n/config.js';

/**
 * Module-level translator.
 *
 * The DEMODULATORS/DECODERS objects below are module-level constants that are also
 * consumed by non-React modules (the VFO redux slice, canvas/drawing utilities), where
 * the `useTranslation` hook is unavailable. Bind a fixed-namespace translator to the
 * shared i18n instance instead (same approach as src/config/navigation.jsx).
 *
 * The translated `description` fields are exposed as getters so they are resolved on
 * every access: module constants are evaluated only once, so a plain `t(...)` value
 * would freeze the language that was active when this module first loaded.
 */
const t = i18n.getFixedT(null, 'waterfall');

/**
 * Global VFO Configuration Object
 *
 * This centralized configuration defines all demodulators, decoders, their modes,
 * parameters, defaults, and behavior. This eliminates scattered conditional logic
 * throughout the UI codebase.
 */

/**
 * Demodulator configurations
 * These handle the RF-to-audio conversion
 */
export const DEMODULATORS = {
    NONE: {
        internalName: 'none',
        displayName: 'none',
        get description() { return t('vfo_config.no_demodulation_center_line_only', { defaultValue: 'No demodulation - center line only' }); },
        defaultBandwidth: 1000, // 1 kHz minimal
        minBandwidth: 100,
        maxBandwidth: 10000,
        bandwidthType: 'center-only', // no sidebands, just center line
        showBothEdges: false,
        allowLeftEdgeDrag: false,
        allowRightEdgeDrag: false,
        bandwidthLabel: (bw) => '', // no bandwidth label for center-only
        lockedBandwidth: true, // bandwidth cannot be changed by user
    },
    FM: {
        internalName: 'FM',
        displayName: 'FM',
        get description() { return t('vfo_config.frequency_modulation_double_sideband', { defaultValue: 'Frequency Modulation - Double Sideband' }); },
        defaultBandwidth: 10000, // 10 kHz
        minBandwidth: 1000,
        maxBandwidth: 100000,
        bandwidthType: 'double-sided', // bandwidth is divided equally on both sides of center
        showBothEdges: true, // show both left and right edges on waterfall
        allowLeftEdgeDrag: true,
        allowRightEdgeDrag: true,
        bandwidthLabel: (bw) => `±${(bw / 2000).toFixed(1)}kHz`, // show as ±5kHz
        lockedBandwidth: false, // bandwidth can be changed by user
    },
    FM_STEREO: {
        internalName: 'FM_STEREO',
        displayName: 'FMS',
        get description() { return t('vfo_config.stereo_frequency_modulation', { defaultValue: 'Stereo Frequency Modulation' }); },
        defaultBandwidth: 150000, // 150 kHz for broadcast FM
        minBandwidth: 1000, // allow narrowing below broadcast width (same floor as FM)
        maxBandwidth: 200000,
        bandwidthType: 'double-sided',
        showBothEdges: true,
        allowLeftEdgeDrag: true,
        allowRightEdgeDrag: true,
        bandwidthLabel: (bw) => `±${(bw / 2000).toFixed(1)}kHz`,
        lockedBandwidth: false, // bandwidth can be changed by user
    },
    AM: {
        internalName: 'AM',
        displayName: 'AM',
        get description() { return t('vfo_config.amplitude_modulation_double_sideband', { defaultValue: 'Amplitude Modulation - Double Sideband' }); },
        defaultBandwidth: 10000, // 10 kHz
        minBandwidth: 1000,
        maxBandwidth: 20000,
        bandwidthType: 'double-sided',
        showBothEdges: true,
        allowLeftEdgeDrag: true,
        allowRightEdgeDrag: true,
        bandwidthLabel: (bw) => `±${(bw / 2000).toFixed(1)}kHz`,
        lockedBandwidth: false, // bandwidth can be changed by user
    },
    USB: {
        internalName: 'USB',
        displayName: 'USB',
        get description() { return t('vfo_config.upper_sideband_single_sideband', { defaultValue: 'Upper Sideband - Single Sideband' }); },
        defaultBandwidth: 3000, // 3 kHz
        minBandwidth: 500,
        maxBandwidth: 10000,
        bandwidthType: 'single-sided-upper', // bandwidth extends above center frequency
        showBothEdges: false,
        allowLeftEdgeDrag: false,
        allowRightEdgeDrag: true,
        bandwidthLabel: (bw) => `${(bw / 1000).toFixed(1)}kHz`,
        lockedBandwidth: false, // bandwidth can be changed by user
    },
    LSB: {
        internalName: 'LSB',
        displayName: 'LSB',
        get description() { return t('vfo_config.lower_sideband_single_sideband', { defaultValue: 'Lower Sideband - Single Sideband' }); },
        defaultBandwidth: 3000, // 3 kHz
        minBandwidth: 500,
        maxBandwidth: 10000,
        bandwidthType: 'single-sided-lower', // bandwidth extends below center frequency
        showBothEdges: false,
        allowLeftEdgeDrag: true,
        allowRightEdgeDrag: false,
        bandwidthLabel: (bw) => `${(bw / 1000).toFixed(1)}kHz`,
        lockedBandwidth: false, // bandwidth can be changed by user
    },
    CW: {
        internalName: 'CW',
        displayName: 'CW',
        get description() { return t('vfo_config.continuous_wave_morse_single_sideband', { defaultValue: 'Continuous Wave (Morse) - Single Sideband' }); },
        defaultBandwidth: 1000, // 1 kHz narrow filter
        minBandwidth: 200,
        maxBandwidth: 3000,
        bandwidthType: 'single-sided-upper',
        showBothEdges: false,
        allowLeftEdgeDrag: false,
        allowRightEdgeDrag: true,
        bandwidthLabel: (bw) => `${(bw / 1000).toFixed(1)}kHz`,
        lockedBandwidth: false, // bandwidth can be changed by user
    },
};

/**
 * Decoder configurations
 * These process demodulated audio to extract data
 */
export const DECODERS = {
    none: {
        internalName: 'none',
        displayName: 'none',
        get description() { return t('vfo_config.no_decoder', { defaultValue: 'No decoder' }); },
        hasStatusDisplay: false,
        hasProgressDisplay: false,
        hasTextOutput: false,
        lockedBandwidth: false, // allows demodulator's lock setting to apply
    },
    sstv: {
        internalName: 'sstv',
        displayName: 'SSTV',
        get description() { return t('vfo_config.slow_scan_television_decoder', { defaultValue: 'Slow Scan Television decoder' }); },
        hasStatusDisplay: true, // shows decoder status (e.g., "detecting", "decoding")
        hasProgressDisplay: true, // shows percentage progress
        hasTextOutput: false, // no text output, outputs images
        hasModeDisplay: true, // shows SSTV mode (e.g., "Martin M1", "Scottie S1")
        defaultBandwidth: 12500, // 12.5 kHz for SSTV (typical NFM channel bandwidth)
        bandwidthType: 'double-sided',
        showBothEdges: true,
        allowLeftEdgeDrag: true,
        allowRightEdgeDrag: true,
        bandwidthLabel: (bw) => `±${(bw / 2000).toFixed(1)}kHz`,
        lockedBandwidth: false, // allows demodulator's lock setting to apply
    },
    geoscanimage: {
        internalName: 'geoscanimage',
        displayName: 'Geoscan Image',
        get description() { return t('vfo_config.geoscan_alferov_packetised_jpeg_image_decoder_fs', { defaultValue: 'Geoscan/Alferov packetised JPEG image decoder (FSK)' }); },
        hasStatusDisplay: true,
        hasProgressDisplay: false,
        hasTextOutput: false,
        hasModeDisplay: true,
        defaultBandwidth: 20000,
        bandwidthType: 'double-sided',
        showBothEdges: true,
        allowLeftEdgeDrag: true,
        allowRightEdgeDrag: true,
        bandwidthLabel: (bw) => `±${(bw / 2000).toFixed(1)}kHz`,
        lockedBandwidth: false,
    },
    morse: {
        internalName: 'morse',
        displayName: 'Morse',
        get description() { return t('vfo_config.morse_code_cw_decoder', { defaultValue: 'Morse code (CW) decoder' }); },
        hasStatusDisplay: false, // no status, always listening
        hasProgressDisplay: false, // no progress bar
        hasTextOutput: true, // outputs decoded text
        hasModeDisplay: false,
        textDisplayLength: 30, // how many chars to show in VFO label
        textBufferLength: 300, // how many chars to keep in buffer
        textPlaceholder: 'listening', // what to show when no text yet
        defaultBandwidth: 2500, // 2.5 kHz for Morse decoder (narrowband)
        lockedBandwidth: false, // allows demodulator's lock setting to apply
        // Bandwidth display override - render like CW mode (single-sided-upper)
        bandwidthType: 'single-sided-upper',
        showBothEdges: false,
        allowLeftEdgeDrag: false,
        allowRightEdgeDrag: true,
        bandwidthLabel: (bw) => `${(bw / 1000).toFixed(1)}kHz`,
    },
    apt: {
        internalName: 'apt',
        displayName: 'APT',
        get description() { return t('vfo_config.automatic_picture_transmission_noaa_weather_sate', { defaultValue: 'Automatic Picture Transmission (NOAA weather satellites)' }); },
        hasStatusDisplay: true,
        hasProgressDisplay: true,
        hasTextOutput: false,
        hasModeDisplay: false,
        defaultBandwidth: 40000, // 40 kHz for APT (NOAA APT signal bandwidth)
        bandwidthType: 'double-sided',
        showBothEdges: true,
        allowLeftEdgeDrag: true,
        allowRightEdgeDrag: true,
        bandwidthLabel: (bw) => `±${(bw / 2000).toFixed(1)}kHz`,
        lockedBandwidth: false, // allows demodulator's lock setting to apply
    },
    lora: {
        internalName: 'lora',
        displayName: 'LoRa',
        get description() { return t('vfo_config.lora_decoder_processes_raw_iq_no_demodulator', { defaultValue: 'LoRa decoder (processes raw IQ, no demodulator)' }); },
        hasStatusDisplay: true,
        hasProgressDisplay: false,
        hasTextOutput: false,
        hasModeDisplay: true, // shows LoRa parameters (SF, BW, CR)
        defaultBandwidth: 500000, // 500 kHz for LoRa (auto-detects 125/250/500 kHz signals)
        bandwidthType: 'center-only', // only show center line for raw IQ
        showBothEdges: false,
        allowLeftEdgeDrag: false,
        allowRightEdgeDrag: false,
        bandwidthLabel: (bw) => '',
        lockedBandwidth: true, // bandwidth is determined by LoRa parameters, not user-adjustable
    },
    gnss: {
        internalName: 'gnss',
        displayName: 'GNSS',
        get description() { return t('vfo_config.gnss_sdr_decoder_wideband_raw_iq_no_demodulator', { defaultValue: 'GNSS-SDR decoder (wideband raw IQ, no demodulator)' }); },
        hasStatusDisplay: true,
        hasProgressDisplay: false,
        hasTextOutput: false,
        hasModeDisplay: false,
        defaultBandwidth: 2000000, // 2 MHz default for initial L1 acquisition window
        bandwidthType: 'double-sided',
        showBothEdges: true,
        allowLeftEdgeDrag: false,
        allowRightEdgeDrag: false,
        bandwidthLabel: (bw) => `±${(bw / 2000000).toFixed(2)}MHz`,
        lockedBandwidth: true, // keep wide marker stable for the GNSS path
    },
    gmsk: {
        internalName: 'gmsk',
        displayName: 'GMSK',
        get description() { return t('vfo_config.gmsk_decoder_gaussian_msk_processes_raw_iq_no_de', { defaultValue: 'GMSK decoder (Gaussian MSK, processes raw IQ, no demodulator)' }); },
        hasStatusDisplay: true,
        hasProgressDisplay: false,
        hasTextOutput: false,
        hasModeDisplay: false,
        defaultBandwidth: 25000, // 25 kHz default (suitable for 2400-4800 baud + Doppler)
        bandwidthType: 'double-sided', // bandwidth is divided equally on both sides of center
        showBothEdges: true, // show both edges
        allowLeftEdgeDrag: false, // edges not draggable (bandwidth locked)
        allowRightEdgeDrag: false, // edges not draggable (bandwidth locked)
        bandwidthLabel: (bw) => `±${(bw / 2000).toFixed(1)}kHz`, // show as ±12.5kHz
        lockedBandwidth: true, // bandwidth is determined by baud rate, not user-adjustable
        calculateBandwidth: (transmitter) => {
            // Calculate optimal bandwidth based on transmitter baud rate
            // Formula: 3x baud rate (for GMSK spectral width + Doppler margin)
            if (transmitter && transmitter.baud) {
                return transmitter.baud * 3;
            }
            return 25000; // fallback to default
        },
    },
    gfsk: {
        internalName: 'gfsk',
        displayName: 'GFSK',
        get description() { return t('vfo_config.gfsk_decoder_gaussian_fsk_processes_raw_iq_no_de', { defaultValue: 'GFSK decoder (Gaussian FSK, processes raw IQ, no demodulator)' }); },
        hasStatusDisplay: true,
        hasProgressDisplay: false,
        hasTextOutput: false,
        hasModeDisplay: false,
        defaultBandwidth: 30000, // 30 kHz default (suitable for ~9600-10000 baud + Doppler)
        bandwidthType: 'double-sided', // bandwidth is divided equally on both sides of center
        showBothEdges: true, // show both edges
        allowLeftEdgeDrag: false, // edges not draggable (bandwidth locked)
        allowRightEdgeDrag: false, // edges not draggable (bandwidth locked)
        bandwidthLabel: (bw) => `±${(bw / 2000).toFixed(1)}kHz`, // show as ±15kHz
        lockedBandwidth: true, // bandwidth is determined by baud rate, not user-adjustable
        calculateBandwidth: (transmitter) => {
            // Calculate optimal bandwidth based on transmitter baud rate
            // Formula: 3x baud rate (for GFSK spectral width + Doppler margin)
            if (transmitter && transmitter.baud) {
                return transmitter.baud * 3;
            }
            return 30000; // fallback to default
        },
    },
    fsk: {
        internalName: 'fsk',
        displayName: 'FSK',
        get description() { return t('vfo_config.fsk_decoder_frequency_shift_keying_processes_raw', { defaultValue: 'FSK decoder (Frequency Shift Keying, processes raw IQ, no demodulator)' }); },
        hasStatusDisplay: true,
        hasProgressDisplay: false,
        hasTextOutput: false,
        hasModeDisplay: false,
        defaultBandwidth: 25000, // 25 kHz default (suitable for 1200-9600 baud + Doppler)
        bandwidthType: 'double-sided', // bandwidth is divided equally on both sides of center
        showBothEdges: true, // show both edges
        allowLeftEdgeDrag: false, // edges not draggable (bandwidth locked)
        allowRightEdgeDrag: false, // edges not draggable (bandwidth locked)
        bandwidthLabel: (bw) => `±${(bw / 2000).toFixed(1)}kHz`, // show as ±12.5kHz
        lockedBandwidth: true, // bandwidth is determined by baud rate, not user-adjustable
        calculateBandwidth: (transmitter) => {
            // Calculate optimal bandwidth based on transmitter baud rate
            // Formula: 3x baud rate (for FSK spectral width + Doppler margin)
            if (transmitter && transmitter.baud) {
                return transmitter.baud * 3;
            }
            return 25000; // fallback to default
        },
    },
    bpsk: {
        internalName: 'bpsk',
        displayName: 'BPSK',
        get description() { return t('vfo_config.bpsk_decoder_with_ax_25_support_processes_raw_iq', { defaultValue: 'BPSK decoder with AX.25 support (processes raw IQ, no demodulator)' }); },
        hasStatusDisplay: true,
        hasProgressDisplay: false,
        hasTextOutput: false,
        hasModeDisplay: false,
        defaultBandwidth: 30000, // 30 kHz default (suitable for 9600 baud + Doppler)
        bandwidthType: 'double-sided', // bandwidth is divided equally on both sides of center
        showBothEdges: true, // show both edges
        allowLeftEdgeDrag: false, // edges not draggable (bandwidth locked)
        allowRightEdgeDrag: false, // edges not draggable (bandwidth locked)
        bandwidthLabel: (bw) => `±${(bw / 2000).toFixed(1)}kHz`, // show as ±15kHz
        lockedBandwidth: true, // bandwidth is determined by baud rate, not user-adjustable
        calculateBandwidth: (transmitter) => {
            // Calculate optimal bandwidth based on transmitter baud rate
            // Formula: 3x baud rate (for BPSK spectral width + Doppler margin)
            if (transmitter && transmitter.baud) {
                return transmitter.baud * 3;
            }
            return 30000; // fallback to default
        },
    },
    aprs: {
        internalName: 'aprs',
        displayName: 'APRS',
        get description() { return t('vfo_config.aprs_bell_202_decoder_processes_raw_iq_with_inte', { defaultValue: 'APRS Bell 202 decoder (processes raw IQ with integrated FM demodulation)' }); },
        hasStatusDisplay: true,
        hasProgressDisplay: false,
        hasTextOutput: false,
        hasModeDisplay: false,
        defaultBandwidth: 12500,
        bandwidthType: 'double-sided',
        showBothEdges: true,
        allowLeftEdgeDrag: false,
        allowRightEdgeDrag: false,
        bandwidthLabel: (bw) => `±${(bw / 2000).toFixed(1)}kHz`,
        lockedBandwidth: true,
    },
};

/**
 * Helper function to get demodulator configuration
 * @param {string} mode - Demodulator internal name (e.g., 'FM', 'USB', 'none')
 * @returns {Object|null} Demodulator config or null if not found
 */
export const getDemodulatorConfig = (mode) => {
    // Normalize 'none' to 'NONE' for lookup (frontend uses lowercase, config uses uppercase key)
    const modeKey = mode === 'none' ? 'NONE' : mode;
    return DEMODULATORS[modeKey] || null;
};

/**
 * Helper function to get decoder configuration
 * @param {string} decoder - Decoder internal name (e.g., 'sstv', 'morse', 'none')
 * @returns {Object} Decoder config (defaults to 'none' if not found)
 */
export const getDecoderConfig = (decoder) => {
    return DECODERS[decoder] || DECODERS.none;
};

/**
 * Get bandwidth configuration for a mode
 *
 * @param {string} mode - Demodulator mode
 * @returns {Object} Object with min, max, and default bandwidth
 */
export const getBandwidthConfig = (mode) => {
    const demodConfig = getDemodulatorConfig(mode);
    if (!demodConfig) {
        // Fallback defaults
        return {
            min: 500,
            max: 100000,
            default: 10000
        };
    }

    return {
        min: demodConfig.minBandwidth,
        max: demodConfig.maxBandwidth,
        default: demodConfig.defaultBandwidth
    };
};

/**
 * Check if a mode should show both edges (left and right)
 * Considers decoder overrides
 *
 * @param {string} mode - Demodulator mode
 * @param {string} decoder - Decoder name (optional)
 * @returns {boolean} True if both edges should be shown
 */
export const shouldShowBothEdges = (mode, decoder = 'none') => {
    // Check decoder override first
    const decoderConfig = getDecoderConfig(decoder);
    if (decoderConfig && decoderConfig.showBothEdges !== undefined) {
        return decoderConfig.showBothEdges;
    }
    
    // Fall back to demodulator config
    const demodConfig = getDemodulatorConfig(mode);
    return demodConfig ? demodConfig.showBothEdges : false;
};

/**
 * Check if center line only mode is active (no sidebands)
 * Considers both demodulator and decoder configurations
 *
 * @param {string} mode - Demodulator mode
 * @param {string} decoder - Decoder name
 * @returns {boolean} True if only center line should be shown
 */
export const isCenterLineOnly = (mode, decoder) => {
    // If decoder is active (not 'none'), ONLY check decoder config
    if (decoder && decoder !== 'none') {
        const decoderConfig = getDecoderConfig(decoder);
        return decoderConfig && decoderConfig.bandwidthType === 'center-only';
    }

    // No decoder active - check demodulator bandwidthType
    const demodConfig = getDemodulatorConfig(mode);
    if (demodConfig && demodConfig.bandwidthType === 'center-only') {
        return true;
    }

    return false;
};

/**
 * Check if left edge can be dragged for a mode
 * Considers decoder overrides
 *
 * @param {string} mode - Demodulator mode
 * @param {string} decoder - Decoder name (optional)
 * @returns {boolean} True if left edge is draggable
 */
export const canDragLeftEdge = (mode, decoder = 'none') => {
    // Check decoder override first
    const decoderConfig = getDecoderConfig(decoder);
    if (decoderConfig && decoderConfig.allowLeftEdgeDrag !== undefined) {
        return decoderConfig.allowLeftEdgeDrag;
    }
    
    // Fall back to demodulator config
    const demodConfig = getDemodulatorConfig(mode);
    return demodConfig ? demodConfig.allowLeftEdgeDrag : false;
};

/**
 * Check if right edge can be dragged for a mode
 * Considers decoder overrides
 *
 * @param {string} mode - Demodulator mode
 * @param {string} decoder - Decoder name (optional)
 * @returns {boolean} True if right edge is draggable
 */
export const canDragRightEdge = (mode, decoder = 'none') => {
    // Check decoder override first
    const decoderConfig = getDecoderConfig(decoder);
    if (decoderConfig && decoderConfig.allowRightEdgeDrag !== undefined) {
        return decoderConfig.allowRightEdgeDrag;
    }
    
    // Fall back to demodulator config
    const demodConfig = getDemodulatorConfig(mode);
    return demodConfig ? demodConfig.allowRightEdgeDrag : false;
};

/**
 * Check if VFO bandwidth is locked (considering both demodulator and decoder)
 *
 * @param {string} mode - Demodulator mode
 * @param {string} decoder - Decoder name
 * @returns {boolean} True if bandwidth is locked (not user-adjustable)
 */
export const isLockedBandwidth = (mode, decoder) => {
    // Check decoder config first (decoder can override lock state)
    const decoderConfig = getDecoderConfig(decoder);
    if (decoderConfig && decoderConfig.lockedBandwidth === true) {
        return true;
    }

    // Check demodulator config
    const demodConfig = getDemodulatorConfig(mode);
    if (demodConfig && demodConfig.lockedBandwidth === true) {
        return true;
    }

    // Default to false (unlocked/resizable) if not explicitly set
    return false;
};

/**
 * Get the bandwidth type for a mode
 * Considers decoder overrides
 *
 * @param {string} mode - Demodulator mode
 * @param {string} decoder - Decoder name (optional)
 * @returns {string} 'double-sided', 'single-sided-upper', 'single-sided-lower', or 'center-only'
 */
export const getBandwidthType = (mode, decoder = 'none') => {
    // Check decoder override first
    const decoderConfig = getDecoderConfig(decoder);
    if (decoderConfig && decoderConfig.bandwidthType) {
        return decoderConfig.bandwidthType;
    }
    
    // Fall back to demodulator config
    const demodConfig = getDemodulatorConfig(mode);
    return demodConfig ? demodConfig.bandwidthType : 'double-sided';
};

/**
 * Format bandwidth label for display
 * Considers decoder overrides
 *
 * @param {string} mode - Demodulator mode
 * @param {number} bandwidth - Bandwidth in Hz
 * @param {string} decoder - Decoder name (optional)
 * @returns {string} Formatted bandwidth label
 */
export const formatBandwidthLabel = (mode, bandwidth, decoder = 'none') => {
    // Check decoder override first
    const decoderConfig = getDecoderConfig(decoder);
    if (decoderConfig && decoderConfig.bandwidthLabel) {
        return decoderConfig.bandwidthLabel(bandwidth);
    }
    
    // Fall back to demodulator config
    const demodConfig = getDemodulatorConfig(mode);
    if (!demodConfig || !demodConfig.bandwidthLabel) {
        // Fallback formatting
        return `${(bandwidth / 1000).toFixed(1)}kHz`;
    }

    return demodConfig.bandwidthLabel(bandwidth);
};

/**
 * Get list of available demodulator modes
 *
 * @returns {Array} Array of demodulator internal names
 */
export const getAvailableDemodulators = () => {
    return Object.keys(DEMODULATORS);
};

/**
 * Get list of available decoders
 *
 * @returns {Array} Array of decoder internal names
 */
export const getAvailableDecoders = () => {
    return Object.keys(DECODERS);
};

/**
 * Check if a decoder should show status in VFO label
 *
 * @param {string} decoder - Decoder internal name
 * @returns {boolean} True if status should be displayed
 */
export const shouldShowDecoderStatus = (decoder) => {
    const decoderConfig = getDecoderConfig(decoder);
    return decoderConfig.hasStatusDisplay;
};

/**
 * Check if a decoder should show progress in VFO label
 *
 * @param {string} decoder - Decoder internal name
 * @returns {boolean} True if progress should be displayed
 */
export const shouldShowDecoderProgress = (decoder) => {
    const decoderConfig = getDecoderConfig(decoder);
    return decoderConfig.hasProgressDisplay;
};

/**
 * Check if a decoder should show mode in VFO label
 *
 * @param {string} decoder - Decoder internal name
 * @returns {boolean} True if mode should be displayed
 */
export const shouldShowDecoderMode = (decoder) => {
    const decoderConfig = getDecoderConfig(decoder);
    return decoderConfig.hasModeDisplay;
};

/**
 * Check if a decoder has text output
 *
 * @param {string} decoder - Decoder internal name
 * @returns {boolean} True if decoder outputs text
 */
export const hasTextOutput = (decoder) => {
    const decoderConfig = getDecoderConfig(decoder);
    return decoderConfig.hasTextOutput;
};

/**
 * Get text display configuration for a decoder
 *
 * @param {string} decoder - Decoder internal name
 * @returns {Object|null} Object with display length, buffer length, and placeholder, or null
 */
export const getTextDisplayConfig = (decoder) => {
    const decoderConfig = getDecoderConfig(decoder);
    if (!decoderConfig.hasTextOutput) {
        return null;
    }

    return {
        displayLength: decoderConfig.textDisplayLength || 30,
        bufferLength: decoderConfig.textBufferLength || 300,
        placeholder: decoderConfig.textPlaceholder || 'listening'
    };
};

/**
 * Normalize transmitter mode string to internal demodulator name
 * Used when locking VFOs to satellite transmitters
 *
 * @param {string} mode - Raw mode string from transmitter data
 * @returns {string|null} Normalized demodulator internal name
 */
export const normalizeTransmitterMode = (mode) => {
    if (!mode) return null;

    const modeNormalized = mode.toLowerCase();

    // Digital modes (FSK/AFSK/PSK/BPSK/QPSK/GMSK/GFSK) are transmitted over FM carriers
    if (['fsk', 'afsk', 'psk', 'bpsk', 'qpsk', 'gmsk', 'gfsk', 'gmsk usp', 'fmn'].includes(modeNormalized)) {
        return 'FM';
    }

    // Keep FM_STEREO as-is if explicitly specified
    if (modeNormalized === 'fm_stereo') {
        return 'FM_STEREO';
    }

    // Return uppercase version (should match DEMODULATORS keys)
    const upperMode = mode.toUpperCase();

    // Validate it exists in our config
    if (DEMODULATORS[upperMode]) {
        return upperMode;
    }

    // Fallback to FM if unrecognized
    console.warn(`Unknown transmitter mode "${mode}", defaulting to FM`);
    return 'FM';
};

/**
 * Decoder parameter definitions are now in decoder-parameters.js
 * Import them here for backwards compatibility
 */
export {
    getDecoderParameterDefinitions,
    getDecoderParameters,
    getDecoderDefaultParameters,
    mapParametersToBackend
} from '../decoder-parameters.js';

/**
 * Get default VFO configuration object
 * Use this when initializing new VFOs
 *
 * @returns {Object} Default VFO configuration
 */
export const getDefaultVFOConfig = () => {
    return {
        mode: 'FM',
        bandwidth: DEMODULATORS.FM.defaultBandwidth,
        decoder: 'none',
        volume: 50,
        squelch: -150,
        squelchMode: 'carrier',
        vadSensitivity: 'medium',
        vadCloseDelayMs: 300,
        stepSize: 1000,
        transcriptionEnabled: false,
        transcriptionLanguage: 'auto',

        // Decoder-specific parameters (flat object, prefixed by decoder type)
        parameters: {
            // LoRa parameters (defaults from TinyGS)
            lora_sf: 7,                    // Spreading Factor (7-12)
            lora_bw: 125000,               // Bandwidth in Hz
            lora_cr: 1,                    // Coding Rate (1=4/5, 2=4/6, 3=4/7, 4=4/8)
            lora_sync_word: [0x08, 0x10],  // Sync word (TinyGS default)
            lora_preamble_len: 8,          // Preamble length
            lora_fldro: false,             // Low Data Rate Optimization

            // FSK/GMSK/GFSK parameters (future - TODO)
            // fsk_baudrate: 9600,
            // fsk_deviation: 5000,
            // fsk_framing: 'ax25',

            // BPSK parameters (future - TODO)
            // bpsk_baudrate: 9600,
            // bpsk_differential: false,
            // bpsk_framing: 'ax25',

            // GNSS-SDR parameters
            gnss_sample_rate: 4000000,
            gnss_total_channels: 24,
            gnss_output_rate_ms: 500,
            gnss_doppler_max: 6000,
            gnss_enable_gps: true,
            gnss_enable_galileo: true,
            gnss_enable_glonass: true,
            gnss_enable_beidou: true,
            gnss_enable_qzss: true,
        }
    };
};
