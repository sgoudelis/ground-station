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

import {
    getBandwidthType,
    shouldShowBothEdges,
    formatBandwidthLabel,
    shouldShowDecoderStatus,
    shouldShowDecoderProgress,
    shouldShowDecoderMode,
    getTextDisplayConfig,
    getDemodulatorConfig,
    getDecoderConfig
} from './vfo-config.js';
import { resolveVfoAudioStatus, VFO_AUDIO_STATUS, VFO_AUDIO_STATUS_COLORS } from '../vfo-audio-status.js';

const GNSS_CONSTELLATION_CODES = {
    gps: 'GPS',
    galileo: 'GAL',
    glonass: 'GLO',
    beidou: 'BDS',
    qzss: 'QZS',
};

export const formatGnssMarkerLabel = (decoderInfo, verifiedSatCount) => {
    const status = decoderInfo?.status || 'listening';
    const satCount = Number.isFinite(verifiedSatCount) ? verifiedSatCount : 0;
    const enabled = Array.isArray(decoderInfo?.info?.constellations)
        ? decoderInfo.info.constellations.map((name) => {
            const normalized = String(name).trim().toLowerCase();
            return GNSS_CONSTELLATION_CODES[normalized] || normalized.slice(0, 3).toUpperCase();
        }).filter(Boolean)
        : [];

    // Status metadata reflects the active GNSS-SDR instance, including overrides.
    return `${status.toUpperCase()} | SAT ${satCount}${enabled.length ? ` | ${enabled.join(' ')}` : ''}`;
};

/**
 * Drawing utilities for VFO markers on the waterfall canvas
 */

export const canvasDrawingUtils = {
    drawVFOArea: (ctx, leftEdgeX, rightEdgeX, height, color, opacity) => {
        ctx.fillStyle = `${color}${opacity}`;
        ctx.fillRect(leftEdgeX, 0, rightEdgeX - leftEdgeX, height);
    },

    drawVFOLine: (ctx, x, height, color, opacity, lineWidth) => {
        ctx.beginPath();
        ctx.strokeStyle = `${color}${opacity}`;
        ctx.lineWidth = lineWidth;
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
    },

    drawVFOEdges: (ctx, mode, leftEdgeX, rightEdgeX, height, color, opacity, lineWidth, decoder = 'none') => {
        ctx.beginPath();
        ctx.strokeStyle = `${color}${opacity}`;
        ctx.lineWidth = lineWidth;
        ctx.setLineDash([4, 4]);

        const bandwidthType = getBandwidthType(mode, decoder);

        if (bandwidthType === 'single-sided-upper') {
            // USB, CW - only right edge
            ctx.moveTo(rightEdgeX, 0);
            ctx.lineTo(rightEdgeX, height);
        } else if (bandwidthType === 'single-sided-lower') {
            // LSB - only left edge
            ctx.moveTo(leftEdgeX, 0);
            ctx.lineTo(leftEdgeX, height);
        } else {
            // Double-sided (AM, FM, etc.) - both edges
            ctx.moveTo(leftEdgeX, 0);
            ctx.lineTo(leftEdgeX, height);
            ctx.moveTo(rightEdgeX, 0);
            ctx.lineTo(rightEdgeX, height);
        }

        ctx.stroke();
        ctx.setLineDash([]);
    },

    drawVFOHandle: (ctx, x, y, width, height, color, opacity) => {
        ctx.fillStyle = `${color}${opacity}`;
        ctx.beginPath();
        ctx.roundRect(x - width / 2, y - height / 2, width, height, 2);
        ctx.fill();
    },

    drawVFOLabel: (
        ctx,
        centerX,
        labelText,
        color,
        opacity,
        isSelected,
        locked = false,
        decoderInfo = null,
        morseText = null,
        isStreaming = false,
        bpskOutputs = null,
        gnssVerifiedSatCount = null,
        isMuted = false,
        audioStatus = null
    ) => {
        ctx.font = 'bold 12px Monospace';
        const textMetrics = ctx.measureText(labelText);

        // Add extra width for speaker icon (16px icon + 10px left padding + 8px right padding)
        const speakerIconWidth = 34;
        // Add extra width for lock icon if locked (reduced gap between lock and text)
        const lockIconWidth = locked ? 5 : 0;
        const labelWidth = textMetrics.width + 10 + speakerIconWidth + lockIconWidth;
        const labelHeight = 20; // Always use taller height
        const labelTop = 3; // Always start at same position

        // Draw background
        ctx.fillStyle = `${color}${opacity}`;
        ctx.beginPath();
        ctx.roundRect(centerX - labelWidth / 2, labelTop, labelWidth, labelHeight, 2);
        ctx.fill();

        // Draw lock icon on the left if locked
        if (locked) {
            const lockIconX = centerX - (labelWidth / 2) + 6;
            const lockIconY = 11;

            // Draw lock shackle (arc) - rotated 180 degrees (downward)
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.arc(lockIconX + 4, lockIconY, 3.5, 0, Math.PI, true);
            ctx.stroke();

            // Draw lock body (rectangle) - 1px taller, added to top
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.roundRect(lockIconX - 0.5, lockIconY + 1, 9, 7, 1);
            ctx.fill();
        }

        // Draw text (shifted to maintain consistent spacing with speaker icon)
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        // When not locked, shift text left to compensate for missing lock icon
        const textOffset = locked ? 0 : -10;
        const textY = 17; // Always use same text position
        ctx.fillText(labelText, centerX + textOffset, textY);

        // Draw speaker icon with shared audio status logic.
        const iconX = centerX + (labelWidth / 2) - 20;
        const iconY = 7;

        const resolvedAudioStatus = audioStatus || resolveVfoAudioStatus({
            isStreaming,
            isMuted,
            isSquelchOpen: null,
        });
        const iconColor = VFO_AUDIO_STATUS_COLORS[resolvedAudioStatus] || VFO_AUDIO_STATUS_COLORS[VFO_AUDIO_STATUS.NO_AUDIO];

        // Draw speaker body (same for all states)
        ctx.fillStyle = iconColor;
        ctx.beginPath();
        // Speaker body (trapezoid shape)
        ctx.moveTo(iconX, iconY + 3);
        ctx.lineTo(iconX + 4.5, iconY + 3);
        ctx.lineTo(iconX + 7.5, iconY);
        ctx.lineTo(iconX + 7.5, iconY + 12);
        ctx.lineTo(iconX + 4.5, iconY + 9);
        ctx.lineTo(iconX, iconY + 9);
        ctx.closePath();
        ctx.fill();

        // Draw sound waves for playing and squelched states
        if (
            resolvedAudioStatus === VFO_AUDIO_STATUS.PLAYING
            || resolvedAudioStatus === VFO_AUDIO_STATUS.SQUELCHED
        ) {
            ctx.strokeStyle = iconColor;
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            ctx.arc(iconX + 9, iconY + 6, 3, -Math.PI/4, Math.PI/4);
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(iconX + 9, iconY + 6, 6, -Math.PI/4, Math.PI/4);
            ctx.stroke();
        }

        // For squelched state, overlay a diagonal slash to match UI icon semantics.
        if (resolvedAudioStatus === VFO_AUDIO_STATUS.SQUELCHED) {
            ctx.strokeStyle = iconColor;
            ctx.lineWidth = 1.8;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(iconX - 1, iconY - 1);
            ctx.lineTo(iconX + 15, iconY + 13);
            ctx.stroke();
        }

        // Draw secondary decoder label if decoder is active
        if (decoderInfo) {
            const secondaryLabelTop = labelTop + labelHeight + 2; // 2px gap below primary label
            const decoderType = decoderInfo.decoder_type;

            // Packet decoders share the same compact status/output label.
            if (decoderType === 'bpsk' || decoderType === 'fsk' || decoderType === 'gmsk' || decoderType === 'gfsk' || decoderType === 'aprs') {
                const status = decoderInfo.status || 'processing';
                const outputCount = bpskOutputs?.count || 0;
                const baudrate = decoderInfo.info?.baudrate || 0;
                const framing = decoderInfo.info?.framing || 'unknown';

                // Format baudrate for compact display
                const formattedBaudrate = formatBaudrate(baudrate);

                // Template-based label: STATUS | DECODER BAUDRATE | FRAMING | PACKET_COUNT
                const fullText = `${status.toUpperCase()} | ${decoderType.toUpperCase()} ${formattedBaudrate} | ${framing.toUpperCase()}`;

                ctx.font = '10px Monospace';
                const fullTextMetrics = ctx.measureText(fullText);
                const decoderLabelWidth = fullTextMetrics.width + 8;
                const decoderLabelHeight = 16;

                // Draw background
                ctx.fillStyle = `${color}${opacity}`;
                ctx.beginPath();
                ctx.roundRect(centerX - decoderLabelWidth / 2, secondaryLabelTop, decoderLabelWidth, decoderLabelHeight, 2);
                ctx.fill();

                // Draw text
                ctx.fillStyle = '#ffffff';
                ctx.textAlign = 'center';
                ctx.fillText(fullText, centerX, secondaryLabelTop + 12);
            } else {
                // Check if this decoder has text output (like morse)
                const textDisplayConfig = getTextDisplayConfig(decoderType);

                if (textDisplayConfig) {
                    // Text-based decoder display (e.g., morse)
                    let staticPart = `${decoderType.toUpperCase()}`;

                    // Add WPM for morse decoder if available
                    if (decoderType === 'morse' && decoderInfo.info?.wpm !== null && decoderInfo.info?.wpm !== undefined) {
                        staticPart += ` ${decoderInfo.info.wpm} WPM`;
                    }

                    staticPart += ' | ';
                    const displayText = morseText || textDisplayConfig.placeholder;
                    const fullText = staticPart + displayText;

                    ctx.font = '10px Monospace';
                    const fullTextMetrics = ctx.measureText(fullText);
                    const decoderLabelWidth = fullTextMetrics.width + 8;
                    const decoderLabelHeight = 16;

                    // Draw background
                    ctx.fillStyle = `${color}${opacity}`;
                    ctx.beginPath();
                    ctx.roundRect(centerX - decoderLabelWidth / 2, secondaryLabelTop, decoderLabelWidth, decoderLabelHeight, 2);
                    ctx.fill();

                    // Draw text
                    ctx.fillStyle = '#ffffff';
                    ctx.textAlign = 'center';
                    ctx.fillText(fullText, centerX, secondaryLabelTop + 12);
                } else if (decoderType === 'lora') {
                    // LoRa-specific label format
                    const status = decoderInfo.status || 'listening';
                    const sf = decoderInfo.info?.spreading_factor;
                    const bw = decoderInfo.info?.bandwidth_khz;
                    const cr = decoderInfo.info?.coding_rate;

                    // Build LoRa parameters part
                    let loraParams;
                    if (sf !== null && bw !== null && cr !== null) {
                        loraParams = `SF${sf} BW${bw} CR${cr}`;
                    } else {
                        loraParams = 'DETECTING';
                    }

                    const decoderText = `${status.toUpperCase()} | ${loraParams}`;

                    ctx.font = '10px Monospace';
                    const decoderTextMetrics = ctx.measureText(decoderText);
                    const decoderLabelWidth = decoderTextMetrics.width + 8;
                    const decoderLabelHeight = 16;

                    // Draw background
                    ctx.fillStyle = `${color}${opacity}`;
                    ctx.beginPath();
                    ctx.roundRect(centerX - decoderLabelWidth / 2, secondaryLabelTop, decoderLabelWidth, decoderLabelHeight, 2);
                    ctx.fill();

                    // Draw text
                    ctx.fillStyle = '#ffffff';
                    ctx.textAlign = 'center';
                    ctx.fillText(decoderText, centerX, secondaryLabelTop + 12);
                } else if (decoderType === 'gnss') {
                    const decoderText = formatGnssMarkerLabel(decoderInfo, gnssVerifiedSatCount);

                    ctx.font = '10px Monospace';
                    const decoderTextMetrics = ctx.measureText(decoderText);
                    const decoderLabelWidth = decoderTextMetrics.width + 8;
                    const decoderLabelHeight = 16;

                    // Draw background
                    ctx.fillStyle = `${color}${opacity}`;
                    ctx.beginPath();
                    ctx.roundRect(centerX - decoderLabelWidth / 2, secondaryLabelTop, decoderLabelWidth, decoderLabelHeight, 2);
                    ctx.fill();

                    // Draw text
                    ctx.fillStyle = '#ffffff';
                    ctx.textAlign = 'center';
                    ctx.fillText(decoderText, centerX, secondaryLabelTop + 12);
                } else if (decoderType === 'transcription') {
                    // Transcription decoder-specific label format
                    const status = decoderInfo.status || 'idle';
                    const language = decoderInfo.info?.language || 'auto';
                    const translateTo = decoderInfo.info?.translate_to || 'none';
                    const provider = (decoderInfo.info?.provider || '').toLowerCase();

                    // Show translation indicator if enabled
                    const translationIndicator = (translateTo !== 'none') ? ` → ${translateTo.toUpperCase()}` : '';
                    const decoderText = `${status.toUpperCase()} | ${language.toUpperCase()}${translationIndicator}`;

                    ctx.font = '10px Monospace';
                    const decoderTextMetrics = ctx.measureText(decoderText);
                    const decoderLabelWidth = decoderTextMetrics.width + 8;
                    const decoderLabelHeight = 16;

                    // Draw background
                    ctx.fillStyle = `${color}${opacity}`;
                    ctx.beginPath();
                    ctx.roundRect(centerX - decoderLabelWidth / 2, secondaryLabelTop, decoderLabelWidth, decoderLabelHeight, 2);
                    ctx.fill();

                    // Draw text
                    ctx.fillStyle = '#ffffff';
                    ctx.textAlign = 'center';
                    ctx.fillText(decoderText, centerX, secondaryLabelTop + 12);
                } else {
                    // Standard decoder label (status/progress/mode)
                    const parts = [];
                    if (decoderType) parts.push(decoderType.toUpperCase());

                    if (shouldShowDecoderStatus(decoderType) && decoderInfo.status) {
                        parts.push(decoderInfo.status);
                    }
                    // Mode can be in top-level (legacy) or info field (standardized)
                    const mode = decoderInfo.info?.mode || decoderInfo.mode;
                    if (shouldShowDecoderMode(decoderType) && mode) {
                        parts.push(mode);
                    }
                    if (shouldShowDecoderProgress(decoderType) &&
                        decoderInfo.progress !== null &&
                        decoderInfo.progress !== undefined) {
                        parts.push(`${Math.round(decoderInfo.progress)}%`);
                    }

                    const decoderText = parts.join(' | ');

                    if (decoderText) {
                        ctx.font = '10px Monospace';
                        const decoderTextMetrics = ctx.measureText(decoderText);
                        const decoderLabelWidth = decoderTextMetrics.width + 8;
                        const decoderLabelHeight = 16;

                        // Draw background with same color scheme as primary label
                        ctx.fillStyle = `${color}${opacity}`;
                        ctx.beginPath();
                        ctx.roundRect(centerX - decoderLabelWidth / 2, secondaryLabelTop, decoderLabelWidth, decoderLabelHeight, 2);
                        ctx.fill();

                        // Draw text
                        ctx.fillStyle = '#ffffff';
                        ctx.textAlign = 'center';
                        ctx.fillText(decoderText, centerX, secondaryLabelTop + 12);
                    }
                }
            }
        }
    }
};

/**
 * Format baudrate for compact display
 * @param {number} baudrate - Baudrate in baud (e.g., 9600, 1200)
 * @returns {string} - Formatted string (e.g., "9k6", "1k2")
 */
export const formatBaudrate = (baudrate) => {
    if (!baudrate || baudrate === 0) return '0';

    if (baudrate >= 1000) {
        const kilobaud = baudrate / 1000;
        // Format as "Xk" with one decimal if needed, removing trailing .0
        const formatted = kilobaud.toFixed(1).replace('.0', '');
        return `${formatted}`.replace('.', 'k');
    }

    return `${baudrate}`;
};

/**
 * Get the icon width constant used in label calculations
 * @param {boolean} locked - Whether the VFO is locked (adds lock icon width)
 */
export const getVFOLabelIconWidth = (locked = false) => {
    const speakerIconWidth = 34;
    const lockIconWidth = locked ? 5 : 0;
    return speakerIconWidth + lockIconWidth;
};

/**
 * Calculate bandwidth change based on drag mode and frequency delta
 * @param {number} currentBandwidth - Current bandwidth in Hz
 * @param {number} freqDelta - Frequency change in Hz
 * @param {string} dragMode - 'leftEdge' or 'rightEdge'
 * @param {number} minBandwidth - Minimum allowed bandwidth
 * @param {number} maxBandwidth - Maximum allowed bandwidth
 * @returns {number} New bandwidth value
 */
export const calculateBandwidthChange = (currentBandwidth, freqDelta, dragMode, minBandwidth, maxBandwidth) => {
    let newBandwidth;
    if (dragMode === 'leftEdge') {
        newBandwidth = currentBandwidth - (2 * freqDelta);
    } else if (dragMode === 'rightEdge') {
        newBandwidth = currentBandwidth + (2 * freqDelta);
    } else {
        return currentBandwidth;
    }

    return Math.round(Math.max(minBandwidth, Math.min(maxBandwidth, newBandwidth)));
};

/**
 * Calculate VFO frequency bounds and positions based on mode
 * @param {Object} marker - VFO marker object
 * @param {number} startFreq - Start frequency of visible range
 * @param {number} freqRange - Total frequency range
 * @param {number} actualWidth - Actual canvas width
 * @returns {Object} Bounds and positions
 */
export const getVFOBandwidth = (marker, decoderInfo = null) => {
    if (marker.decoder === 'lora') {
        // The VFO bandwidth field is only a default; LoRa's PHY bandwidth is
        // set by decoder parameters and may differ from the active profile.
        const override = marker.parametersEnabled ? Number(marker.parameters?.lora_bw) : NaN;
        if (Number.isFinite(override) && override > 0) return override;
        const reported = Number(decoderInfo?.info?.bw ?? decoderInfo?.info?.bandwidth_khz * 1000);
        if (Number.isFinite(reported) && reported > 0) return reported;
    }
    return marker.bandwidth || 3000;
};

export const calculateVFOFrequencyBounds = (marker, startFreq, freqRange, actualWidth, decoderInfo = null) => {
    const bandwidth = getVFOBandwidth(marker, decoderInfo);
    const mode = marker.mode || 'FM';
    const decoder = marker.decoder || 'none';
    const bandwidthType = getBandwidthType(mode, decoder);

    let markerLowFreq, markerHighFreq, leftEdgeX, rightEdgeX;

    if (bandwidthType === 'single-sided-upper') {
        // USB, CW - bandwidth extends above center frequency
        markerLowFreq = marker.frequency;
        markerHighFreq = marker.frequency + bandwidth;
        leftEdgeX = ((marker.frequency - startFreq) / freqRange) * actualWidth;
        rightEdgeX = ((markerHighFreq - startFreq) / freqRange) * actualWidth;
    } else if (bandwidthType === 'single-sided-lower') {
        // LSB - bandwidth extends below center frequency
        markerLowFreq = marker.frequency - bandwidth;
        markerHighFreq = marker.frequency;
        leftEdgeX = ((markerLowFreq - startFreq) / freqRange) * actualWidth;
        rightEdgeX = ((marker.frequency - startFreq) / freqRange) * actualWidth;
    } else {
        // Double-sided (AM, FM, etc.) - bandwidth divided equally
        markerLowFreq = marker.frequency - bandwidth/2;
        markerHighFreq = marker.frequency + bandwidth/2;
        leftEdgeX = ((markerLowFreq - startFreq) / freqRange) * actualWidth;
        rightEdgeX = ((markerHighFreq - startFreq) / freqRange) * actualWidth;
    }

    // Let the canvas clip off-screen edges. Clamping their coordinates would
    // draw false bandwidth handles at the viewport boundary when zoomed in.

    return {
        markerLowFreq,
        markerHighFreq,
        leftEdgeX,
        rightEdgeX,
        centerX: ((marker.frequency - startFreq) / freqRange) * actualWidth,
        mode,
        bandwidth
    };
};

/**
 * Generate label text for VFO marker
 * @param {Object} marker - VFO marker object
 * @param {string} mode - VFO mode
 * @param {number} bandwidth - VFO bandwidth
 * @param {Function} formatFrequency - Function to format frequency
 * @returns {string} Label text
 */
export const generateVFOLabelText = (marker, mode, bandwidth, formatFrequency) => {
    // Show decoder mode if active, otherwise show audio demodulation mode
    let displayMode;
    if (marker.decoder && marker.decoder !== 'none') {
        const decoderConfig = getDecoderConfig(marker.decoder);
        displayMode = decoderConfig.displayName;
    } else {
        const demodConfig = getDemodulatorConfig(mode);
        displayMode = demodConfig ? demodConfig.displayName : mode;
    }
    const modeText = ` [${displayMode}]`;
    const decoder = marker.decoder || 'none';
    const bwText = formatBandwidthLabel(mode, bandwidth, decoder);
    return `${marker.name}: ${formatFrequency(marker.frequency)} MHz${modeText} ${bwText}`;
};

/**
 * Calculate visible frequency range considering zoom and pan
 * @param {number} centerFrequency - Center frequency
 * @param {number} sampleRate - Sample rate
 * @param {number} actualWidth - Actual canvas width
 * @param {number} containerWidth - Container width
 * @param {number} currentPositionX - Current pan position
 * @returns {Object} Visible frequency range
 */
export const getVisibleFrequencyRange = (centerFrequency, sampleRate, actualWidth, containerWidth, currentPositionX) => {
    // Use the global waterfall transform function if available for accurate zoom/pan calculation
    if (typeof window !== 'undefined' && window.getWaterfallTransform) {
        const transform = window.getWaterfallTransform();
        return {
            startFrequency: transform.startFreq,
            endFrequency: transform.endFreq,
            centerFrequency: (transform.startFreq + transform.endFreq) / 2,
            bandwidth: transform.visibleBandwidth
        };
    }

    // Fallback to basic calculation (when waterfall transform not available yet)
    return {
        startFrequency: centerFrequency - sampleRate / 2,
        endFrequency: centerFrequency + sampleRate / 2,
        centerFrequency: centerFrequency,
        bandwidth: sampleRate
    };
};

/**
 * Format frequency to MHz with 6 decimal places, grouped by 3 digits
 * @param {number} freq - Frequency in Hz
 * @returns {string} Formatted frequency (e.g., "433.500.000")
 */
export const formatFrequency = (freq) => {
    const mhz = (freq / 1e6).toFixed(6);
    const [integer, decimal] = mhz.split('.');
    // Group decimal part by 3 digits
    const grouped = decimal.match(/.{1,3}/g).join('.');
    return `${integer}.${grouped}`;
};
