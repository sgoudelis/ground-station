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

/**
 * Color map implementations for waterfall display
 */

/**
 * Cache for color values to avoid recalculation
 */
const colorCache = new Map();

/**
 * Get list of available color maps
 * @returns {Array<{id: string, name: string}>} Array of color map objects with id and display name
 */
export const getAvailableColorMaps = () => {
    return [
        { id: 'iceberg', name: 'Iceberg' },
        { id: 'heat', name: 'Heat' },
        { id: 'cosmic', name: 'Cosmic' },
        { id: 'greyscale', name: 'Greyscale' },
        { id: 'light', name: 'Light' },
        { id: 'sonar', name: 'Sonar' },
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
        case 'sonar':
            color = sonarColorMap(normalizedValue);
            break;
        default:
            color = cosmicColorMap(normalizedValue);
    }

    colorCache.set(cacheKey, color);
    return color;
};

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

/**
 * Sonar color map - deep ocean black to tactical amber
 * Inspired by naval sonar displays: deep ocean darkness, phosphor CRT amber glow, tactical readouts
 * Classic submarine warfare aesthetic with amber monochrome tactical displays
 * @param {number} normalizedValue - Value between 0 and 1
 * @returns {Object} RGB color {r, g, b}
 */
function sonarColorMap(normalizedValue) {
    let sonarRGB;
    const sonarCurvedValue = Math.pow(normalizedValue, 1.7);

    if (sonarCurvedValue < 0.15) {
        // Deep ocean void - pure black to faint dark blue-black
        const factor = sonarCurvedValue / 0.15;
        sonarRGB = {
            r: Math.floor(0 + factor * 8),    // 0 -> 8
            g: Math.floor(0 + factor * 10),   // 0 -> 10
            b: Math.floor(0 + factor * 15)    // 0 -> 15
        };
    } else if (sonarCurvedValue < 0.3) {
        // Pressure darkness to dim amber glow - #080a0f to #1a1200
        const factor = (sonarCurvedValue - 0.15) / 0.15;
        sonarRGB = {
            r: Math.floor(8 + factor * 18),   // 8 -> 26
            g: Math.floor(10 + factor * 8),   // 10 -> 18
            b: Math.floor(15 - factor * 15)   // 15 -> 0
        };
    } else if (sonarCurvedValue < 0.5) {
        // Dim amber to phosphor warm - #1a1200 to #4d3300
        const factor = (sonarCurvedValue - 0.3) / 0.2;
        sonarRGB = {
            r: Math.floor(26 + factor * 51),  // 26 -> 77
            g: Math.floor(18 + factor * 33),  // 18 -> 51
            b: Math.floor(0)                  // 0 -> 0
        };
    } else if (sonarCurvedValue < 0.7) {
        // Phosphor warm to tactical amber - #4d3300 to #aa7700
        const factor = (sonarCurvedValue - 0.5) / 0.2;
        sonarRGB = {
            r: Math.floor(77 + factor * 93),  // 77 -> 170
            g: Math.floor(51 + factor * 68),  // 51 -> 119
            b: Math.floor(0)                  // 0 -> 0
        };
    } else if (sonarCurvedValue < 0.85) {
        // Tactical amber to bright sonar - #aa7700 to #ffb000
        const factor = (sonarCurvedValue - 0.7) / 0.15;
        sonarRGB = {
            r: Math.floor(170 + factor * 85), // 170 -> 255
            g: Math.floor(119 + factor * 57), // 119 -> 176
            b: Math.floor(0)                  // 0 -> 0
        };
    } else {
        // Bright contact - #ffb000 to #ffdd88 (hot amber-white)
        const factor = (sonarCurvedValue - 0.85) / 0.15;
        sonarRGB = {
            r: Math.floor(255),               // 255 -> 255
            g: Math.floor(176 + factor * 45), // 176 -> 221
            b: Math.floor(0 + factor * 136)   // 0 -> 136 (adds slight warmth at peaks)
        };
    }
    return sonarRGB;
}
