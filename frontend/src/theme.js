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

import { alpha, createTheme } from "@mui/material/styles";
import { getThemeConfig } from './themes/theme-configs.js';

function buildSemanticPalette(config) {
    const isDark = config.mode === 'dark';

    return {
        surface: {
            sunken: isDark ? '#0c0d0e' : '#e9edf3',
            default: config.background.paper,
            raised: config.background.elevated,
            titleBar: config.background.titleBar || config.background.elevated,
            appBar: config.background.appBar || config.background.titleBar || config.background.elevated,
            scrim: isDark ? 'rgba(0, 0, 0, 0.55)' : 'rgba(17, 24, 39, 0.36)',
        },
        state: {
            hover: isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(17, 24, 39, 0.06)',
            selected: isDark
                ? alpha(config.primary.main, 0.22)
                : alpha(config.primary.main, 0.14),
            selectedStrong: isDark
                ? alpha(config.primary.main, 0.32)
                : alpha(config.primary.main, 0.2),
            disabled: isDark ? 'rgba(255, 255, 255, 0.3)' : 'rgba(17, 24, 39, 0.34)',
            disabledBg: isDark ? 'rgba(255, 255, 255, 0.07)' : 'rgba(17, 24, 39, 0.05)',
        },
        statusSurface: {
            success: isDark ? alpha(config.success.main, 0.2) : alpha(config.success.main, 0.12),
            info: isDark ? alpha(config.info.main, 0.2) : alpha(config.info.main, 0.12),
            warning: isDark ? alpha(config.warning.main, 0.2) : alpha(config.warning.main, 0.12),
            error: isDark ? alpha(config.error.main, 0.2) : alpha(config.error.main, 0.12),
        },
        // Shared badge semantics used by target-slot markers (T1/T2/...) across views.
        badge: {
            targetSlot: {
                background: isDark ? '#ffcc66' : '#f2b84b',
                text: isDark ? '#111213' : '#111213',
                outlined: isDark ? '#ffd98a' : '#8a5200',
                shadow: alpha('#000000', 0.2),
            },
        },
    };
}

export function setupTheme(themeName = 'dark') {
    const config = getThemeConfig(themeName);
    const isDark = config.mode === 'dark';
    const semanticPalette = buildSemanticPalette(config);

    const palette = {
        mode: config.mode,
        ...config,
        ...semanticPalette,
    };

    return createTheme({
        palette,
        cssVariables: {
            colorSchemeSelector: 'data-toolpad-color-scheme',
        },
        shape: {
            borderRadius: 6,
        },
        typography: {
            fontFamily: "Roboto, Arial, sans-serif",
        },
        components: {
            MuiCssBaseline: {
                styleOverrides: (theme) => {
                    const resizeHandleFill = theme.palette.mode === 'dark' ? '%23E6EDF5' : '%2330384A';
                    const resizeHandleShadow = theme.palette.mode === 'dark'
                        ? 'drop-shadow(0 0 1px rgba(0, 0, 0, 0.7))'
                        : 'drop-shadow(0 0 1px rgba(255, 255, 255, 0.7))';

                    return `
                    /* React Grid Layout styles */
                    .react-resizable-handle {
                        z-index: 1000;
                        opacity: 0.95;
                        filter: ${resizeHandleShadow};
                        background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 6 6'%3E%3Cg opacity='0.88'%3E%3Cpath d='M6 6L0 6L0 4.2L4 4.2L4.2 4.2L4.2 0L6 0L6 6Z' fill='${resizeHandleFill}'/%3E%3C/g%3E%3C/svg%3E");
                    }
                    .react-grid-item.react-draggable-dragging {
                        opacity: 0.9;
                        z-index: 1000;
                        box-shadow: 0 8px 24px ${theme.palette.mode === 'dark' ? 'rgba(0, 0, 0, 0.6)' : 'rgba(0, 0, 0, 0.3)'};
                        transition: box-shadow 0.2s ease;
                    }
                    .react-grid-draggable {
                        border-radius: 0;
                        cursor: grab;
                        user-select: none;
                        transition: background-color 0.15s ease, box-shadow 0.15s ease;
                        background-image:
                            repeating-linear-gradient(
                                90deg,
                                transparent,
                                transparent 3px,
                                ${theme.palette.mode === 'dark' ? 'rgba(255, 255, 255, 0.03)' : 'rgba(0, 0, 0, 0.02)'} 3px,
                                ${theme.palette.mode === 'dark' ? 'rgba(255, 255, 255, 0.03)' : 'rgba(0, 0, 0, 0.02)'} 4px
                            );
                    }
                    .react-grid-draggable:hover {
                        background-color: ${theme.palette.mode === 'dark' ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.03)'};
                        box-shadow: inset 0 1px 3px ${theme.palette.mode === 'dark' ? 'rgba(0, 0, 0, 0.3)' : 'rgba(0, 0, 0, 0.1)'};
                    }
                    .react-grid-draggable:active {
                        cursor: grabbing;
                        background-color: ${theme.palette.mode === 'dark' ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.05)'};
                        box-shadow: inset 0 2px 4px ${theme.palette.mode === 'dark' ? 'rgba(0, 0, 0, 0.4)' : 'rgba(0, 0, 0, 0.15)'};
                    }

                    /* Leaflet map styles */
                    .leaflet-tooltip-bottom::before {
                        border-bottom-color: ${theme.palette.background.default} !important;
                    }
                    .leaflet-tooltip {
                        opacity: 0.9 !important;
                    }
                    .leaflet-control-attribution {
                        display: none;
                        background-color: ${theme.palette.background.paper};
                        color: ${theme.palette.text.secondary};
                        z-index: 3001;
                    }
                    .leaflet-container {
                        background-color: ${theme.palette.background.default} !important;
                    }
                    .leaflet-container.earth-view-map,
                    .leaflet-container.target-map,
                    .leaflet-container.satellite-details-map,
                    .leaflet-container.earth-view-map .leaflet-pane,
                    .leaflet-container.earth-view-map .leaflet-pane *,
                    .leaflet-container.target-map .leaflet-pane,
                    .leaflet-container.target-map .leaflet-pane *,
                    .leaflet-container.satellite-details-map .leaflet-pane,
                    .leaflet-container.satellite-details-map .leaflet-pane * {
                        cursor: default !important;
                    }
                    .leaflet-container.earth-view-map .leaflet-marker-icon,
                    .leaflet-container.target-map .leaflet-marker-icon,
                    .leaflet-container.satellite-details-map .leaflet-marker-icon {
                        cursor: pointer !important;
                    }
                    .leaflet-container.earth-view-map .earth-view-satellite-test-icon,
                    .leaflet-container.earth-view-map .earth-view-satellite-test-icon *,
                    .leaflet-container.earth-view-map .earth-view-satellite-dim-icon,
                    .leaflet-container.earth-view-map .earth-view-satellite-dim-icon *,
                    .leaflet-container.target-map .earth-view-satellite-test-icon,
                    .leaflet-container.target-map .earth-view-satellite-test-icon *,
                    .leaflet-container.target-map .earth-view-satellite-dim-icon,
                    .leaflet-container.target-map .earth-view-satellite-dim-icon *,
                    .leaflet-container.satellite-details-map .earth-view-satellite-test-icon,
                    .leaflet-container.satellite-details-map .earth-view-satellite-test-icon *,
                    .leaflet-container.satellite-details-map .earth-view-satellite-dim-icon,
                    .leaflet-container.satellite-details-map .earth-view-satellite-dim-icon * {
                        cursor: pointer !important;
                    }
                    .leaflet-control-fullscreen {
                        display: none;
                    }
                    .leaflet-link {
                        right: 8px;
                        position: absolute;
                    }

                    /* Custom application styles */
                    .window-title-bar {
                        background-color: ${theme.palette.surface.titleBar};
                    }
                    .attribution {
                        color: ${theme.palette.text.secondary};
                        font-size: 12px;
                        line-height: 20px;
                    }
                    .truncate {
                        white-space: nowrap;
                        overflow: hidden;
                        text-overflow: ellipsis;
                        max-width: 1000px;
                        display: block;
                    }
                    .pointer-cursor {
                        cursor: pointer;
                    }

                    /* VSCode controller */
                    .vsc-controller {
                        display: none !important;
                    }

                    /* Tooltip satellite - interactive tooltips */
                    .tooltip-satellite {
                        pointer-events: auto !important;
                    }
                    .tooltip-satellite button {
                        pointer-events: auto !important;
                    }
                    .tooltip-satellite button.Mui-disabled {
                        pointer-events: none !important;
                    }
                `;
                },
            },
            MuiDrawer: {
                styleOverrides: {
                    paper: ({ theme }) => ({
                        backgroundColor: theme.palette.surface.raised,
                        borderRight: `1px solid ${theme.palette.border.main}`,
                        boxShadow: 'none',
                    }),
                },
            },
            MuiAppBar: {
                styleOverrides: {
                    colorPrimary: ({ theme }) => ({
                        backgroundColor: theme.palette.surface.appBar,
                    }),
                    root: ({ theme }) => ({
                        backgroundColor: theme.palette.surface.appBar,
                        color: theme.palette.text.primary,
                        borderBottom: `1px solid ${theme.palette.border.main}`,
                        boxShadow: isDark
                            ? '0 2px 4px rgba(0, 0, 0, 0.45)'
                            : '0 1px 3px rgba(0, 0, 0, 0.08)',
                        backdropFilter: 'blur(4px)',
                    }),
                },
            },
            MuiPaper: {
                styleOverrides: {
                    root: ({ theme }) => ({
                        backgroundImage: 'none',
                        borderColor: theme.palette.border.main,
                    }),
                },
            },
            MuiToolbar: {
                styleOverrides: {
                    root: {
                        minHeight: '52px',
                        '@media (min-width: 600px)': {
                            minHeight: '52px',
                        },
                    },
                },
            },
            MuiSelect: {
                styleOverrides: {
                    root: ({ theme }) => ({
                        backgroundColor: theme.palette.background.paper,
                    }),
                },
            },
            MuiAutocomplete: {
                styleOverrides: {
                    root: ({ theme }) => ({
                        backgroundColor: theme.palette.background.paper,
                    }),
                    paper: ({ theme }) => ({
                        border: `1px solid ${theme.palette.border.main}`,
                        boxShadow: theme.palette.mode === 'dark'
                            ? '0 12px 24px rgba(0, 0, 0, 0.35)'
                            : '0 10px 24px rgba(15, 23, 42, 0.12)',
                    }),
                },
            },
            MuiListSubheader: {
                styleOverrides: {
                    root: ({ theme }) => ({
                        backgroundColor: theme.palette.background.elevated,
                    }),
                },
            },
            MuiFilledInput: {
                styleOverrides: {
                    root: ({ theme }) => ({
                        backgroundColor: theme.palette.background.paper,
                    }),
                },
            },
            MuiTextField: {
                styleOverrides: {
                    root: ({ theme }) => ({
                        backgroundColor: 'transparent',
                        '& .MuiInputBase-root': {
                            backgroundColor: theme.palette.background.paper,
                        },
                    }),
                },
            },
            MuiDialog: {
                styleOverrides: {
                    paper: ({ theme }) => ({
                        border: `1px solid ${theme.palette.border.main}`,
                        boxShadow: theme.palette.mode === 'dark'
                            ? '0 24px 60px rgba(0, 0, 0, 0.55)'
                            : '0 20px 48px rgba(15, 23, 42, 0.18)',
                    }),
                },
            },
            MuiDialogContent: {
                styleOverrides: {
                    root: ({ theme }) => ({
                        backgroundColor: theme.palette.mode === 'dark'
                            ? theme.palette.background.elevated
                            : theme.palette.background.paper,
                    }),
                },
            },
            MuiPopover: {
                styleOverrides: {
                    paper: ({ theme }) => ({
                        border: `1px solid ${theme.palette.border.main}`,
                        boxShadow: theme.palette.mode === 'dark'
                            ? '0 14px 36px rgba(0, 0, 0, 0.45)'
                            : '0 10px 30px rgba(15, 23, 42, 0.14)',
                    }),
                },
            },
            MuiMenu: {
                styleOverrides: {
                    paper: ({ theme }) => ({
                        border: `1px solid ${theme.palette.border.main}`,
                        boxShadow: theme.palette.mode === 'dark'
                            ? '0 14px 36px rgba(0, 0, 0, 0.45)'
                            : '0 10px 30px rgba(15, 23, 42, 0.14)',
                    }),
                },
            },
            MuiListItemButton: {
                styleOverrides: {
                    root: ({ theme }) => ({
                        '&:hover': {
                            backgroundColor: theme.palette.state.hover,
                        },
                        '&.Mui-selected': {
                            backgroundColor: theme.palette.state.selected,
                        },
                        '&.Mui-selected:hover': {
                            backgroundColor: theme.palette.state.selectedStrong,
                        },
                    }),
                },
            },
            MuiLinearProgress: {
                styleOverrides: {
                    root: ({ theme }) => ({
                        backgroundColor: theme.palette.state.disabledBg,
                    }),
                },
            },
            MuiToggleButton: {
                styleOverrides: {
                    root: ({ theme }) => ({
                        borderColor: theme.palette.border.main,
                        '&:hover': {
                            backgroundColor: theme.palette.state.hover,
                        },
                        '&.Mui-selected': {
                            backgroundColor: theme.palette.state.selected,
                            color: theme.palette.text.primary,
                        },
                        '&.Mui-disabled': {
                            color: theme.palette.state.disabled,
                            borderColor: theme.palette.border.dark,
                            backgroundColor: theme.palette.state.disabledBg,
                        },
                    }),
                },
            },
            MuiDataGrid: {
                styleOverrides: {
                    root: ({ theme }) => ({
                        borderColor: theme.palette.border.main,
                        '--DataGrid-containerBackground': theme.palette.surface.raised,
                        '& .MuiDataGrid-columnHeaders': {
                            backgroundColor: alpha(
                                theme.palette.primary.main,
                                theme.palette.mode === 'dark' ? 0.14 : 0.08
                            ),
                            borderBottom: `1px solid ${theme.palette.border.main}`,
                        },
                        '& .MuiDataGrid-row:hover': {
                            backgroundColor: theme.palette.state.hover,
                        },
                        '& .MuiDataGrid-row.Mui-selected': {
                            backgroundColor: theme.palette.state.selected,
                        },
                        '& .MuiDataGrid-row.Mui-selected:hover': {
                            backgroundColor: theme.palette.state.selectedStrong,
                        },
                        '& .MuiDataGrid-footerContainer': {
                            borderTop: `1px solid ${theme.palette.border.main}`,
                        },
                    }),
                },
            },
            MuiFormHelperText: {
                styleOverrides: {
                    root: {
                        backgroundColor: 'transparent',
                        '&.MuiFormHelperText-contained': {
                            backgroundColor: 'transparent',
                        },
                        '&.MuiFormHelperText-sizeSmall': {
                            backgroundColor: 'transparent',
                        },
                    }
                },
            },
        },
    });
}
