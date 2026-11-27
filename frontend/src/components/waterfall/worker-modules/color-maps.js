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
 * Developed with the assistance of Claude (Anthropic AI Assistant)
 */

import paletteData from './palettes.json' with { type: 'json' };

/**
 * Color map implementations for waterfall display
 */

// Decode once: this module also runs in the FFT worker's rendering hot path.
// Sources are documented in themes/README.md. Keep the backend JSON copy identical.
const sdrPaletteStops = Object.fromEntries(Object.entries(paletteData).map(([name, colors]) => [
    name,
    colors.map((hex) => [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16))),
]));

/**
 * Cache for color values to avoid recalculation
 */
const colorCache = new Map();

// Keep these stops and the curve in sync with backend/fft/waterfallgenerator.py
// so generated images match the live waterfall. Bright accents follow dark noise.
const cyberpunkStops = [
    [9, 6, 19],      // #090613 — near-black violet
    [29, 15, 51],    // #1d0f33
    [67, 28, 112],   // #431c70
    [129, 42, 166],  // #812aa6
    [230, 76, 191],  // #e64cbf — magenta
    [255, 126, 219], // #ff7edb — SynthWave '84 pink
    [134, 243, 255], // #86f3ff — pale cyan
    [255, 247, 205], // #fff7cd — warm peak highlight
];

/**
 * Get list of available color maps
 * @returns {Array<{id: string, name: string}>} Array of color map objects with id and display name
 */
export const getAvailableColorMaps = () => {
    return [
        { id: 'iceberg', name: 'Iceberg' },
        { id: 'heat', name: 'Heat' },
        { id: 'cosmic', name: 'Cosmic' },
        { id: 'cyberpunk', name: 'Cyberpunk' },
        { id: 'midnight-rx', name: 'Midnight RX' },
        { id: 'classic-rf', name: 'Classic RF' },
        { id: 'phosphor', name: 'Phosphor' },
        { id: 'viridis', name: 'Viridis' },
        { id: 'greyscale', name: 'Greyscale' },
        { id: 'light', name: 'Light' },
    ];
};

/**
 * Get color for power value using specified color map
 * @param {number} powerDb - Power in dB
 * @param {string} mapName - Color map name
 * @param {Array<number>} dbRange - [minDb, maxDb]
 * @returns {Object} RGB color {r, g, b}
 */
export const getColorForPower = (powerDb, mapName, [minDb, maxDb]) => {
    // Round the power value to reduce cache size (e.g., to the nearest 0.5 dB)
    const roundedPower = Math.round(powerDb * 2) / 2;

    // Create a cache key
    const cacheKey = `${roundedPower}-${mapName}-${minDb}-${maxDb}`;

    // Check if this color is already cached
    if (colorCache.has(cacheKey)) {
        return colorCache.get(cacheKey);
    }

    // If not in the cache, calculate the color
    const normalizedValue = Math.max(0, Math.min(1, (roundedPower - minDb) / (maxDb - minDb)));

    let color;

    // Apply the selected color map
    switch (mapName) {
        case 'cosmic':
            color = cosmicColorMap(normalizedValue);
            break;
        case 'greyscale':
            color = greyscaleColorMap(normalizedValue);
            break;
        case 'light':
            color = greyscaleInvertedColorMap(normalizedValue);
            break;
        case 'iceberg':
            color = icebergColorMap(normalizedValue);
            break;
        case 'heat':
            color = heatColorMap(normalizedValue);
            break;
        case 'cyberpunk':
            color = cyberpunkColorMap(normalizedValue);
            break;
        case 'midnight-rx':
        case 'classic-rf':
        case 'phosphor':
        case 'viridis':
            color = interpolatePalette(normalizedValue, sdrPaletteStops[mapName]);
            break;
        default:
            color = cosmicColorMap(normalizedValue);
    }

    colorCache.set(cacheKey, color);
    return color;
};

function interpolatePalette(normalizedValue, stops) {
    // Keep a linear scale for the SDR palettes, including canonical Viridis.
    const position = normalizedValue * (stops.length - 1);
    const index = Math.min(Math.floor(position), stops.length - 2);
    const factor = position - index;
    const start = stops[index];
    const end = stops[index + 1];

    return {
        r: Math.round(start[0] + (end[0] - start[0]) * factor),
        g: Math.round(start[1] + (end[1] - start[1]) * factor),
        b: Math.round(start[2] + (end[2] - start[2]) * factor),
    };
}

/**
 * Dark violet through neon pink and cyan to warm white.
 * Inspired by https://github.com/robb0wen/synthwave-vscode
 */
function cyberpunkColorMap(normalizedValue) {
    // Suppress noise-floor brightness; reserve the neon stops for strong signals.
    const position = Math.pow(normalizedValue, 1.6) * (cyberpunkStops.length - 1);
    const index = Math.min(Math.floor(position), cyberpunkStops.length - 2);
    const factor = position - index;
    const start = cyberpunkStops[index];
    const end = cyberpunkStops[index + 1];

    return {
        r: Math.floor(start[0] + (end[0] - start[0]) * factor),
        g: Math.floor(start[1] + (end[1] - start[1]) * factor),
        b: Math.floor(start[2] + (end[2] - start[2]) * factor),
    };
}

/**
 * Cosmic color map - purple/blue to bright colors
 * @param {number} normalizedValue - Value between 0 and 1
 * @returns {Object} RGB color {r, g, b}
 */
function cosmicColorMap(normalizedValue) {
    let cosmicRGB;
    if (normalizedValue < 0.2) {
        // #070208 to #100b56
        const factor = normalizedValue / 0.2;
        cosmicRGB = {
            r: 7 + Math.floor(factor * 9),
            g: 2 + Math.floor(factor * 9),
            b: 8 + Math.floor(factor * 78)
        };
    } else if (normalizedValue < 0.4) {
        // #100b56 to #170d87
        const factor = (normalizedValue - 0.2) / 0.2;
        cosmicRGB = {
            r: 16 + Math.floor(factor * 7),
            g: 11 + Math.floor(factor * 2),
            b: 86 + Math.floor(factor * 49)
        };
    } else if (normalizedValue < 0.6) {
        // #170d87 to #7400cd
        const factor = (normalizedValue - 0.4) / 0.2;
        cosmicRGB = {
            r: 23 + Math.floor(factor * 93),
            g: 13 + Math.floor(factor * 0),
            b: 135 + Math.floor(factor * 70)
        };
    } else if (normalizedValue < 0.8) {
        // #7400cd to #cb5cff
        const factor = (normalizedValue - 0.6) / 0.2;
        cosmicRGB = {
            r: 116 + Math.floor(factor * 87),
            g: 0 + Math.floor(factor * 92),
            b: 205 + Math.floor(factor * 50)
        };
    } else {
        // #cb5cff to #f9f9ae
        const factor = (normalizedValue - 0.8) / 0.2;
        cosmicRGB = {
            r: 203 + Math.floor(factor * 46),
            g: 92 + Math.floor(factor * 167),
            b: 255 - Math.floor(factor * 81)
        };
    }
    return cosmicRGB;
}

/**
 * Greyscale color map
 * @param {number} normalizedValue - Value between 0 and 1
 * @returns {Object} RGB color {r, g, b}
 */
function greyscaleColorMap(normalizedValue) {
    const curvedValue = Math.pow(normalizedValue, 2.0);
    const intensity = Math.floor(curvedValue * 255);
    return { r: intensity, g: intensity, b: intensity };
}

/**
 * Light color map - white to black (inverted greyscale)
 * @param {number} normalizedValue - Value between 0 and 1
 * @returns {Object} RGB color {r, g, b}
 */
function greyscaleInvertedColorMap(normalizedValue) {
    const curvedValue = Math.pow(normalizedValue, 2.0);
    const intensity = Math.floor((1 - curvedValue) * 255);
    return { r: intensity, g: intensity, b: intensity };
}

/**
 * Iceberg color map - blue/cyan theme
 * @param {number} normalizedValue - Value between 0 and 1
 * @returns {Object} RGB color {r, g, b}
 */
function icebergColorMap(normalizedValue) {
    let icebergRGB;
    const iceCurvedValue = Math.pow(normalizedValue, 1.5);

    if (iceCurvedValue < 0.25) {
        // Very dark blue to dark blue
        const factor = iceCurvedValue / 0.25;
        icebergRGB = {
            r: Math.floor(0 + factor * 20),
            g: Math.floor(0 + factor * 30),
            b: Math.floor(10 + factor * 70)
        };
    } else if (iceCurvedValue < 0.5) {
        // Dark blue to medium blue
        const factor = (iceCurvedValue - 0.25) / 0.25;
        icebergRGB = {
            r: Math.floor(20 + factor * 30),
            g: Math.floor(30 + factor * 70),
            b: Math.floor(80 + factor * 100)
        };
    } else if (iceCurvedValue < 0.75) {
        // Medium blue to cyan
        const factor = (iceCurvedValue - 0.5) / 0.25;
        icebergRGB = {
            r: Math.floor(50 + factor * 100),
            g: Math.floor(100 + factor * 155),
            b: Math.floor(180 + factor * 75)
        };
    } else {
        // Cyan to white
        const factor = (iceCurvedValue - 0.75) / 0.25;
        icebergRGB = {
            r: Math.floor(150 + factor * 105),
            g: Math.floor(255),
            b: Math.floor(255)
        };
    }
    return icebergRGB;
}

/**
 * Heat color map - black to red to yellow to white
 * @param {number} normalizedValue - Value between 0 and 1
 * @returns {Object} RGB color {r, g, b}
 */
function heatColorMap(normalizedValue) {
    let heatRGB;
    const heatCurvedValue = Math.pow(normalizedValue, 1.5);

    if (heatCurvedValue < 0.15) {
        // True black to very deep red
        const factor = heatCurvedValue / 0.15;
        heatRGB = {
            r: Math.floor(0 + factor * 60),
            g: Math.floor(0),
            b: Math.floor(0)
        };
    } else if (heatCurvedValue < 0.35) {
        // Very deep red to deep red
        const factor = (heatCurvedValue - 0.15) / 0.2;
        heatRGB = {
            r: Math.floor(60 + factor * 100),
            g: Math.floor(0 + factor * 20),
            b: Math.floor(0)
        };
    } else if (heatCurvedValue < 0.55) {
        // Deep red to bright red
        const factor = (heatCurvedValue - 0.35) / 0.2;
        heatRGB = {
            r: Math.floor(160 + factor * 95),
            g: Math.floor(20 + factor * 70),
            b: Math.floor(0)
        };
    } else if (heatCurvedValue < 0.75) {
        // Bright red to orange
        const factor = (heatCurvedValue - 0.55) / 0.2;
        heatRGB = {
            r: Math.floor(255),
            g: Math.floor(90 + factor * 120),
            b: Math.floor(0 + factor * 50)
        };
    } else if (heatCurvedValue < 0.9) {
        // Orange to yellow
        const factor = (heatCurvedValue - 0.75) / 0.15;
        heatRGB = {
            r: Math.floor(255),
            g: Math.floor(210 + factor * 45),
            b: Math.floor(50 + factor * 100)
        };
    } else {
        // Yellow to white
        const factor = (heatCurvedValue - 0.9) / 0.1;
        heatRGB = {
            r: Math.floor(255),
            g: Math.floor(255),
            b: Math.floor(150 + factor * 105)
        };
    }
    return heatRGB;
}
