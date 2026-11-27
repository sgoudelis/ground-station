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

    // Palette reference: https://github.com/robb0wen/synthwave-vscode
    // Neutral charcoal keeps large panels quiet; neon colors mark controls and selection.
    cyberpunk: {
        mode: 'dark',
        primary: { main: '#00f0ff', contrastText: '#0c0d0f' },
        secondary: { main: '#ff2e97', contrastText: '#0c0d0f' },
        success: { main: '#39ff88' },
        warning: { main: '#fcee0a' },
        error: { main: '#ff496c' },
        info: { main: '#00f0ff' },
        background: {
            default: '#0c0d0f',
            paper: '#15171a',
            elevated: '#202327',
            titleBar: '#101215',
            appBar: '#25282d',
        },
        text: {
            primary: '#f1f3f5',
            secondary: '#aeb5bf',
        },
        border: {
            main: '#343a42',
            light: '#4b5560',
            dark: '#24292f',
        },
        overlay: {
            light: 'rgba(0, 240, 255, 0.06)',
            medium: 'rgba(255, 46, 151, 0.12)',
            dark: 'rgba(0, 0, 0, 0.8)',
        },
        status: {
            connected: '#39ff88',
            connecting: '#fcee0a',
            disconnected: '#ff496c',
            polling: '#00f0ff',
        },
        action: {
            play: '#39ff88',
            stop: '#ff496c',
        },
        settingsTabs: {
            border: '#4b5560',
            mainRow: {
                background: '#202327',
                selected: '#164047',
            },
            subRow: {
                background: '#1a1d21',
                selected: '#163238',
            },
            detailRow: {
                background: '#16181c',
                selected: '#142c31',
            },
        },
    },
    // SDR++ Deep Blue-inspired surfaces and Electric waterfall accents.
    'midnight-rx': {
        mode: 'dark',
        primary: { main: '#6eafff', contrastText: '#0b111c' },
        secondary: { main: '#9ad9ef', contrastText: '#0b111c' },
        success: { main: '#72d9a1' },
        warning: { main: '#ffd166' },
        error: { main: '#ff788c' },
        info: { main: '#6eafff' },
        background: {
            default: '#0b111c',
            paper: '#142132',
            elevated: '#1b2c40',
            titleBar: '#101b2a',
            appBar: '#1b2c40',
        },
        text: { primary: '#edf4ff', secondary: '#aebed3' },
        border: { main: '#31445d', light: '#475f7d', dark: '#24344a' },
        overlay: {
            light: 'rgba(110, 175, 255, 0.06)',
            medium: 'rgba(110, 175, 255, 0.12)',
            dark: 'rgba(0, 0, 0, 0.8)',
        },
        status: {
            connected: '#72d9a1', connecting: '#ffd166',
            disconnected: '#ff788c', polling: '#6eafff',
        },
        action: { play: '#72d9a1', stop: '#ff788c' },
        settingsTabs: {
            border: '#475f7d',
            mainRow: { background: '#1b2c40', selected: '#284667' },
            subRow: { background: '#172638', selected: '#243e5c' },
            detailRow: { background: '#142132', selected: '#203650' },
        },
    },

    // Gqrx-inspired receiver chrome with a traditional multicolor waterfall.
    'classic-rf': {
        mode: 'dark',
        primary: { main: '#8fd98d', contrastText: '#111315' },
        secondary: { main: '#8bc5ef', contrastText: '#111315' },
        success: { main: '#8fd98d' },
        warning: { main: '#f2ce68' },
        error: { main: '#f47c7c' },
        info: { main: '#8bc5ef' },
        background: {
            default: '#111315',
            paper: '#1e2226',
            elevated: '#282e34',
            titleBar: '#171b1e',
            appBar: '#252b30',
        },
        text: { primary: '#edf0ed', secondary: '#b3bdb7' },
        border: { main: '#3e4843', light: '#55625a', dark: '#2c3430' },
        overlay: {
            light: 'rgba(143, 217, 141, 0.06)',
            medium: 'rgba(143, 217, 141, 0.12)',
            dark: 'rgba(0, 0, 0, 0.75)',
        },
        status: {
            connected: '#8fd98d', connecting: '#f2ce68',
            disconnected: '#f47c7c', polling: '#8bc5ef',
        },
        action: { play: '#8fd98d', stop: '#f47c7c' },
        settingsTabs: {
            border: '#55625a',
            mainRow: { background: '#282e34', selected: '#324b3a' },
            subRow: { background: '#23292e', selected: '#2c4233' },
            detailRow: { background: '#1e2428', selected: '#26392d' },
        },
    },

    // Green instrument panels echo SDR++'s Classic Green palette.
    phosphor: {
        mode: 'dark',
        primary: { main: '#80ff80', contrastText: '#0c100e' },
        secondary: { main: '#b7dca3', contrastText: '#0c100e' },
        success: { main: '#80ff80' },
        warning: { main: '#ffd166' },
        error: { main: '#ff7b78' },
        info: { main: '#80cce8' },
        background: {
            default: '#0c100e',
            paper: '#18231b',
            elevated: '#223027',
            titleBar: '#111b14',
            appBar: '#1e2c22',
        },
        text: { primary: '#e9f4e8', secondary: '#adbfac' },
        border: { main: '#354d3b', light: '#4d6951', dark: '#26392b' },
        overlay: {
            light: 'rgba(128, 255, 128, 0.05)',
            medium: 'rgba(128, 255, 128, 0.10)',
            dark: 'rgba(0, 0, 0, 0.8)',
        },
        status: {
            connected: '#80ff80', connecting: '#ffd166',
            disconnected: '#ff7b78', polling: '#80cce8',
        },
        action: { play: '#80ff80', stop: '#ff7b78' },
        settingsTabs: {
            border: '#4d6951',
            mainRow: { background: '#223027', selected: '#304c35' },
            subRow: { background: '#1c2921', selected: '#2a432f' },
            detailRow: { background: '#18231b', selected: '#243a29' },
        },
    },

    // Graphite and teal pair with the Viridis palette offered by SDRangel.
    'signal-lab': {
        mode: 'dark',
        primary: { main: '#5ed6b3', contrastText: '#101517' },
        secondary: { main: '#e5da69', contrastText: '#101517' },
        success: { main: '#8cdb92' },
        warning: { main: '#e5da69' },
        error: { main: '#f57f90' },
        info: { main: '#80c9df' },
        background: {
            default: '#101517',
            paper: '#1a2427',
            elevated: '#233034',
            titleBar: '#141d20',
            appBar: '#202e32',
        },
        text: { primary: '#eaf3f1', secondary: '#adbfbd' },
        border: { main: '#354e50', light: '#4c696a', dark: '#263b3d' },
        overlay: {
            light: 'rgba(94, 214, 179, 0.06)',
            medium: 'rgba(94, 214, 179, 0.12)',
            dark: 'rgba(0, 0, 0, 0.75)',
        },
        status: {
            connected: '#8cdb92', connecting: '#e5da69',
            disconnected: '#f57f90', polling: '#80c9df',
        },
        action: { play: '#8cdb92', stop: '#f57f90' },
        settingsTabs: {
            border: '#4c696a',
            mainRow: { background: '#233034', selected: '#245047' },
            subRow: { background: '#1e292d', selected: '#20463f' },
            detailRow: { background: '#1a2427', selected: '#1d3d37' },
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
        { id: 'cyberpunk', name: 'Cyberpunk' },
        { id: 'midnight-rx', name: 'Midnight RX' },
        { id: 'classic-rf', name: 'Classic RF' },
        { id: 'phosphor', name: 'Phosphor' },
        { id: 'signal-lab', name: 'Signal Lab' },
    ];
}

/**
 * Get list of available theme names
 * @returns {string[]} Array of theme names including 'auto'
 */
export function getAvailableThemes() {
    return getAvailableThemesWithMetadata().map(theme => theme.id);
}
