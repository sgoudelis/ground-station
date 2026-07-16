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
 * Theme configuration presets
 * Each theme defines a complete set of colors and styles
 */

export const themeConfigs = {
    dark: {
        mode: 'dark',
        primary: { main: '#8fa8c4' },
        secondary: { main: '#d6926b' },
        success: { main: '#59d98b' },
        warning: { main: '#ffcc66' },
        error: { main: '#ff5d6c' },
        info: { main: '#8f969e' },
        background: {
            default: '#111213',
            paper: '#1a1c1e',
            elevated: '#242526',
            titleBar: '#171a1d',
            appBar: '#272b30',
        },
        border: {
            main: '#383c42',
            light: '#454a51',
            dark: '#2b2f35',
        },
        overlay: {
            light: 'rgba(154, 159, 166, 0.06)',
            medium: 'rgba(154, 159, 166, 0.12)',
            dark: 'rgba(0, 0, 0, 0.6)',
        },
        status: {
            connected: '#59d98b',
            connecting: '#ffcc66',
            disconnected: '#ff5d6c',
            polling: '#ff8f5a',
        },
        action: {
            play: '#59d98b',
            stop: '#ff5d6c',
        },
        settingsTabs: {
            border: '#515861',
            mainRow: {
                background: '#2c3137',
                selected: '#3a414a',
            },
            subRow: {
                background: '#282d33',
                selected: '#363d46',
            },
            detailRow: {
                background: '#252a30',
                selected: '#333a43',
            },
        },
    },

    'slate-blue': {
        mode: 'dark',
        primary: { main: '#4f9dff' },
        secondary: { main: '#7bd3b0' },
        success: { main: '#3ecf8e' },
        warning: { main: '#f2b84b' },
        error: { main: '#ff6b6b' },
        info: { main: '#66b8ff' },
        background: {
            default: '#111315',
            paper: '#181b1e',
            elevated: '#20252a',
            titleBar: '#14181c',
            appBar: '#242d36',
        },
        border: {
            main: '#2a2f35',
            light: '#343b43',
            dark: '#1f242a',
        },
        overlay: {
            light: 'rgba(79, 157, 255, 0.08)',
            medium: 'rgba(79, 157, 255, 0.14)',
            dark: 'rgba(0, 0, 0, 0.6)',
        },
        status: {
            connected: '#3ecf8e',
            connecting: '#f2b84b',
            disconnected: '#ff6b6b',
            polling: '#e3a64b',
        },
        action: {
            play: '#3ecf8e',
            stop: '#ff6b6b',
        },
        settingsTabs: {
            border: '#49515b',
            mainRow: {
                background: '#2a3139',
                selected: '#39414b',
            },
            subRow: {
                background: '#252c34',
                selected: '#343c46',
            },
            detailRow: {
                background: '#232931',
                selected: '#313944',
            },
        },
    },

    light: {
        mode: 'light',
        primary: { main: '#1f6feb' },
        secondary: { main: '#c43d82' },
        success: { main: '#2e7d32' },
        warning: { main: '#ed6c02' },
        error: { main: '#c62828' },
        info: { main: '#0b74c8' },
        background: {
            default: '#f3f5f8',
            paper: '#ffffff',
            elevated: '#eef2f7',
            titleBar: '#e8edf4',
            appBar: '#dbe8fb',
        },
        border: {
            main: '#c4ccd8',
            light: '#d3d9e3',
            dark: '#aeb8c6',
        },
        overlay: {
            light: 'rgba(15, 23, 42, 0.06)',
            medium: 'rgba(15, 23, 42, 0.12)',
            dark: 'rgba(15, 23, 42, 0.35)',
        },
        status: {
            connected: '#2e7d32',
            connecting: '#ed6c02',
            disconnected: '#c62828',
            polling: '#ef6c00',
        },
        action: {
            play: '#2e7d32',
            stop: '#c62828',
        },
        settingsTabs: {
            border: '#c5cfdd',
            mainRow: {
                background: '#e6ebf3',
                selected: '#f4f7fb',
            },
            subRow: {
                background: '#eaf0f7',
                selected: '#f7f9fc',
            },
            detailRow: {
                background: '#edf2f8',
                selected: '#ffffff',
            },
        },
    },
    night: {
        mode: 'dark',
        primary: { main: '#7f77c3' }, // Soft purple
        secondary: { main: '#03dac6' }, // Teal
        success: { main: '#4caf50' },
        warning: { main: '#fb8c00' },
        error: { main: '#cf6679' },
        info: { main: '#64b5f6' },
        background: {
            default: '#000000', // Pure black for OLED screens
            paper: '#121212', // Very dark gray
            elevated: '#1e1e1e', // Slightly elevated
            titleBar: '#161316',
            appBar: '#2a272c',
        },
        border: {
            main: '#2d2d2d',
            light: '#383838',
            dark: '#1a1a1a',
        },
        overlay: {
            light: 'rgba(187, 134, 252, 0.05)', // Purple tint
            medium: 'rgba(187, 134, 252, 0.10)',
            dark: 'rgba(0, 0, 0, 0.8)',
        },
        status: {
            connected: '#4caf50',
            connecting: '#fb8c00',
            disconnected: '#cf6679',
            polling: '#ff9800',
        },
        action: {
            play: '#4caf50',
            stop: '#cf6679',
        },
        settingsTabs: {
            border: '#484848',
            mainRow: {
                background: '#2a2a2a',
                selected: '#3a3a3a',
            },
            subRow: {
                background: '#252525',
                selected: '#353535',
            },
            detailRow: {
                background: '#222222',
                selected: '#313131',
            },
        },
    },

    'sonar': {
        mode: 'dark',
        primary: { main: '#ffb000' }, // Amber sonar
        secondary: { main: '#ff6600' }, // Deep sea rust
        success: { main: '#88cc00' }, // Contact confirmed
        warning: { main: '#ffaa00' }, // Proximity alert
        error: { main: '#ff3300' }, // Critical depth
        info: { main: '#ffb000' }, // Bearing data
        background: {
            default: '#000000', // Deep ocean void
            paper: '#0a0f12', // Hull interior
            elevated: '#121a20', // Conning tower
            titleBar: '#1a2a18',
            appBar: '#263828',
        },
        border: {
            main: '#3a4520', // Phosphor grid
            light: '#4d5a2a',
            dark: '#2a3518',
        },
        overlay: {
            light: 'rgba(255, 176, 0, 0.06)', // Amber glow
            medium: 'rgba(255, 176, 0, 0.12)',
            dark: 'rgba(0, 0, 0, 0.85)', // Pressure darkness
        },
        status: {
            connected: '#ffb000', // Sonar lock
            connecting: '#ffaa00', // Pinging
            disconnected: '#664400', // Signal lost
            polling: '#ff8800', // Active sweep
        },
        // Submarine/naval themed custom properties
        sonar: {
            contact: '#ffb000',
            sweep: 'rgba(255, 176, 0, 0.3)',
            grid: '#3a4520',
            bearing: '#ff8800',
        },
        tactical: {
            friendly: '#88cc00',
            unknown: '#ffaa00',
            hostile: '#ff3300',
            neutral: '#7a8080',
        },
        depth: {
            safe: '#88cc00',
            warning: '#ffaa00',
            critical: '#ff3300',
        },
        action: {
            play: '#88cc00',
            stop: '#ff3300',
        },
        settingsTabs: {
            border: '#52584a',
            mainRow: {
                background: '#30352f',
                selected: '#3f463d',
            },
            subRow: {
                background: '#2b312b',
                selected: '#3a4138',
            },
            detailRow: {
                background: '#262c26',
                selected: '#353d33',
            },
        },
    },
};

/**
 * Detect system theme preference
 * @returns {string} 'dark' or 'light' based on system preference
 */
export function getSystemThemePreference() {
    if (typeof window !== 'undefined' && window.matchMedia) {
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return 'dark'; // Default fallback
}

/**
 * Get theme configuration by name
 * @param {string} themeName - Name of the theme (dark, light, cyberpunk, etc., or 'auto' for system preference)
 * @returns {object} Theme configuration object
 */
export function getThemeConfig(themeName) {
    if (themeName === 'dark-neutral') {
        themeName = 'slate-blue';
    }

    // Handle 'auto' theme by detecting system preference
    if (themeName === 'auto') {
        const systemTheme = getSystemThemePreference();
        return themeConfigs[systemTheme];
    }
    return themeConfigs[themeName] || themeConfigs.dark;
}

/**
 * Get list of available themes with metadata
 * @returns {Array<{id: string, name: string}>} Array of theme objects with id and display name
 */
export function getAvailableThemesWithMetadata() {
    return [
        { id: 'auto', name: 'Auto (System)' },
        { id: 'dark', name: 'Dark' },
        { id: 'slate-blue', name: 'Slate Blue' },
        { id: 'light', name: 'Light' },
        { id: 'night', name: 'Night (OLED)' },
        { id: 'sonar', name: 'Sonar' },
    ];
}

/**
 * Get list of available theme names
 * @returns {string[]} Array of theme names including 'auto'
 */
export function getAvailableThemes() {
    return getAvailableThemesWithMetadata().map(theme => theme.id);
}
