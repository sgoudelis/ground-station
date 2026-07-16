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


import React, {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {useSocket} from "../common/socket.jsx";
import { toast } from '../../utils/toast-with-timestamp.jsx';
import {calculateElevationCurvesForPasses} from '../../utils/elevation-curve-calculator.js';
import {
    formatWithZeros,
    getClassNamesBasedOnGridEditing,
    islandTitleBarCompactSx,
    getTimeFromISO,
    humanizeFutureDateInMinutes,
    TitleBar,
    getFrequencyBand,
} from "../common/common.jsx";
import RowContextMenu from "./rowcontextmenu.jsx";
import {DataGrid, gridClasses} from "@mui/x-data-grid";
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import ArrowUpwardRoundedIcon from '@mui/icons-material/ArrowUpwardRounded';
import ArrowDownwardRoundedIcon from '@mui/icons-material/ArrowDownwardRounded';
import RadioButtonCheckedIcon from '@mui/icons-material/RadioButtonChecked';
import AccessTimeFilledIcon from '@mui/icons-material/AccessTimeFilled';
import DoneAllIcon from '@mui/icons-material/DoneAll';
import BlockIcon from '@mui/icons-material/Block';
import TrackChangesIcon from '@mui/icons-material/TrackChanges';
import {useDispatch, useSelector} from "react-redux";
import {
    fetchNextPassesForGroup,
    fetchSatelliteGroups,
    fetchSatellitesByGroupId,
    setPasses,
    setSelectedSatelliteId,
    setPassesTablePageSize,
    setPassesTableSortModel,
    updatePassesWithElevationCurves,
    setPassesTableColumnVisibility,
    setOpenPassesTableSettingsDialog,
} from './earthview-slice.jsx';
import {Typography, Box, IconButton, Tooltip, Button, useMediaQuery, useTheme} from '@mui/material';
import {useGridApiRef, GridPagination} from '@mui/x-data-grid';
import {alpha, darken, lighten, styled} from '@mui/material/styles';
import {Chip} from "@mui/material";
import {useStore} from 'react-redux';
import {
    gridPageCountSelector,
    gridPageSelector,
    gridRowSelectionCountSelector,
    useGridApiContext,
    useGridSelector,
} from '@mui/x-data-grid';
import ProgressFormatter from "./progressbar-widget.jsx";
import { useTranslation } from 'react-i18next';
import { enUS, elGR } from '@mui/x-data-grid/locales';
import ElevationDisplay from "../common/elevation-display.jsx";
import RefreshIcon from '@mui/icons-material/Refresh';
import SettingsIcon from '@mui/icons-material/Settings';
import PassesTableSettingsDialog from './passes-table-settings-dialog.jsx';
import { useUserTimeSettings } from '../../hooks/useUserTimeSettings.jsx';
import TargetNumberIcon from '../common/target-number-icon.jsx';
import { setRotator, setTrackerId, setTrackingStateInBackend } from "../target/target-slice.jsx";
import { useTargetRotatorSelectionDialog } from "../target/use-target-rotator-selection-dialog.jsx";
import SatelliteEditDialog from "../satellites/satellite-edit-dialog.jsx";
import TransmittersDialog from "../satellites/transmitters-dialog.jsx";
import { fetchSatellite } from "../satellites/satellite-slice.jsx";
import {
    setDialogOpen,
    setMonitoredSatelliteDialogOpen,
    setSelectedMonitoredSatellite,
    setSelectedObservation
} from "../scheduler/scheduler-slice.jsx";


const getPassBackgroundColor = (color, theme, coefficient) => ({
    backgroundColor: darken(color, coefficient),
    ...theme.applyStyles('light', {
        backgroundColor: lighten(color, coefficient),
    }),
});

const getPassStatus = (row, now = new Date()) => {
    if (row?.status === 'dead') return 'dead';
    const eventStart = new Date(row?.event_start);
    const eventEnd = new Date(row?.event_end);
    if (eventStart <= now && eventEnd >= now) return 'live';
    if (eventEnd < now) return 'passed';
    return 'upcoming';
};

const getPassStatusPriority = (status) => {
    switch (status) {
        case 'live':
            return 0;
        case 'upcoming':
            return 1;
        case 'passed':
            return 2;
        case 'dead':
            return 3;
        default:
            return 4;
    }
};

const isPassTracked = (row, trackedSatelliteNoradIds = []) => {
    if (!row) return false;
    return (trackedSatelliteNoradIds || []).some(
        (noradId) => String(row.norad_id) === String(noradId)
    );
};

const StyledDataGrid = styled(DataGrid)(({theme}) => ({
    '& .MuiDataGrid-row': {
        borderLeft: '3px solid transparent',
    },
    '& .passes-row-tracked': {
        borderLeftColor: alpha(theme.palette.info.main, 0.95),
    },
    '& .passes-row-live': {
        backgroundColor: alpha(theme.palette.success.main, 0.2),
        borderLeftColor: alpha(theme.palette.success.main, 0.95),
        ...theme.applyStyles('light', {
            backgroundColor: alpha(theme.palette.success.main, 0.1),
            borderLeftColor: alpha(theme.palette.success.main, 0.65),
        }),
        '&:hover': {
            backgroundColor: alpha(theme.palette.success.main, 0.27),
            ...theme.applyStyles('light', {
                backgroundColor: alpha(theme.palette.success.main, 0.14),
            }),
        },
    },
    '& .passes-row-upcoming-soon': {
        backgroundColor: alpha(theme.palette.warning.main, 0.14),
        borderLeftColor: alpha(theme.palette.warning.main, 0.9),
        ...theme.applyStyles('light', {
            backgroundColor: alpha(theme.palette.warning.main, 0.08),
            borderLeftColor: alpha(theme.palette.warning.main, 0.6),
        }),
    },
    '& .passes-row-passed': {
        '& .MuiDataGrid-cell': {
            color: theme.palette.text.secondary,
        },
        '& .passes-time-absolute': {
            opacity: 0.8,
        },
    },
    '& .passes-row-dead': {
        backgroundColor: alpha(theme.palette.error.main, 0.24),
        borderLeftColor: alpha(theme.palette.error.main, 0.9),
        ...theme.applyStyles('light', {
            backgroundColor: alpha(theme.palette.error.main, 0.1),
            borderLeftColor: alpha(theme.palette.error.main, 0.65),
        }),
    },
    '& .passes-cell-passing': {
        ...getPassBackgroundColor(theme.palette.success.main, theme, 0.7),
        '&:hover': {
            ...getPassBackgroundColor(theme.palette.success.main, theme, 0.6),
        },
        '&.Mui-selected': {
            ...getPassBackgroundColor(theme.palette.success.main, theme, 0.5),
            '&:hover': {
                ...getPassBackgroundColor(theme.palette.success.main, theme, 0.4),
            },
        },
    },
    '& .passes-cell-passed': {
        backgroundColor: alpha(theme.palette.info.main, 0.28),
        borderLeft: `2px solid ${alpha(theme.palette.info.main, 0.85)}`,
        ...theme.applyStyles('light', {
            backgroundColor: alpha(theme.palette.info.main, 0.14),
            borderLeft: `2px solid ${alpha(theme.palette.info.main, 0.55)}`,
        }),
        '&:hover': {
            backgroundColor: alpha(theme.palette.info.main, 0.34),
            ...theme.applyStyles('light', {
                backgroundColor: alpha(theme.palette.info.main, 0.2),
            }),
        },
        '&.Mui-selected': {
            backgroundColor: alpha(theme.palette.info.main, 0.4),
            ...theme.applyStyles('light', {
                backgroundColor: alpha(theme.palette.info.main, 0.24),
            }),
            '&:hover': {
                backgroundColor: alpha(theme.palette.info.main, 0.46),
                ...theme.applyStyles('light', {
                    backgroundColor: alpha(theme.palette.info.main, 0.28),
                }),
            },
        },
        textDecoration: 'line-through',
    },
    '& .passes-cell-dead': {
        ...getPassBackgroundColor(theme.palette.error.main, theme, 0.7),
        '&:hover': {
            ...getPassBackgroundColor(theme.palette.error.main, theme, 0.6),
        },
        '&.Mui-selected': {
            ...getPassBackgroundColor(theme.palette.error.main, theme, 0.5),
            '&:hover': {
                ...getPassBackgroundColor(theme.palette.error.main, theme, 0.4),
            },
        },
        textDecoration: 'line-through',
    },
    '& .passes-cell-warning': {
        color: theme.palette.error.main,
        textDecoration: 'line-through',
    },
    '& .passes-cell-success': {
        color: theme.palette.success.main,
        fontWeight: 'bold',
        textDecoration: 'underline',
    },
    '& .passes-cell-active': {
        ...getPassBackgroundColor(theme.palette.secondary.dark, theme, 0.7),
        fontWeight: 'bold',
        '&:hover': {
            ...getPassBackgroundColor(theme.palette.secondary.main, theme, 0.6),
        },
        '&.Mui-selected': {
            ...getPassBackgroundColor(theme.palette.secondary.main, theme, 0.5),
            '&:hover': {
                ...getPassBackgroundColor(theme.palette.secondary.main, theme, 0.4),
            },
        },
    },
    '& .passes-cell-status': {
        alignItems: 'flex-start',
        paddingTop: theme.spacing(0.4),
    },
    '& .passes-cell-tags': {
        alignItems: 'center',
    }
}));

const CustomPagination = () => {
    const apiRef = useGridApiContext();
    const page = useGridSelector(apiRef, gridPageSelector);
    const pageCount = useGridSelector(apiRef, gridPageCountSelector);
    const selectedRowCount = useGridSelector(apiRef, gridRowSelectionCountSelector);
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
    const isTablet = useMediaQuery(theme.breakpoints.down('md'));
    const isMedium = useMediaQuery(theme.breakpoints.down('lg'));

    const handlePageChange = (newPage) => {
        apiRef.current.setPage(newPage);
    };

    // Calculate which page buttons to show
    const getPageNumbers = () => {
        const maxButtons = isMobile ? 5 : isTablet ? 8 : 12;
        const pages = [];

        if (pageCount <= maxButtons) {
            // Show all pages if they fit
            for (let i = 0; i < pageCount; i++) {
                pages.push(i);
            }
        } else {
            // Show pages around current page
            const halfWindow = Math.floor(maxButtons / 2);
            let start = Math.max(0, page - halfWindow);
            let end = Math.min(pageCount - 1, start + maxButtons - 1);

            // Adjust start if we're near the end
            if (end - start < maxButtons - 1) {
                start = Math.max(0, end - maxButtons + 1);
            }

            for (let i = start; i <= end; i++) {
                pages.push(i);
            }
        }

        return pages;
    };

    const pageNumbers = getPageNumbers();

    return (
        <Box sx={{
            display: 'flex',
            alignItems: 'center',
            width: '100%',
            p: 1,
            gap: 2,
            height: '52px',
            minHeight: '52px',
            maxHeight: '52px',
            position: 'relative',
            overflow: 'hidden',
        }}>
            <Box sx={{ flex: '1 1 0', display: 'flex', justifyContent: 'flex-start', minWidth: 0, alignItems: 'center', height: '100%' }}>
                {selectedRowCount > 0 && (
                    <Typography variant="body2" sx={{ whiteSpace: 'nowrap', lineHeight: 1 }}>
                        {selectedRowCount} pass{selectedRowCount !== 1 ? 'es' : ''} selected
                    </Typography>
                )}
            </Box>
            <Box sx={{
                position: 'absolute',
                left: '50%',
                transform: 'translateX(-50%)',
                display: 'flex',
                gap: 0.5,
                flexWrap: 'nowrap',
                justifyContent: 'center',
                overflow: 'hidden',
                alignItems: 'center',
                height: '100%',
            }}>
                {pageNumbers.map((pageNum) => (
                    <Button
                        key={pageNum}
                        size="small"
                        variant={page === pageNum ? 'contained' : 'outlined'}
                        onClick={() => handlePageChange(pageNum)}
                        sx={{
                            minWidth: isMobile ? '32px' : '40px',
                            px: isMobile ? 0.5 : 1,
                            py: 0.5,
                            height: '32px',
                        }}
                    >
                        {pageNum + 1}
                    </Button>
                ))}
            </Box>
            <Box sx={{ flex: '1 1 0', display: isMedium ? 'none' : 'flex', justifyContent: 'flex-end', minWidth: 0, alignItems: 'center', height: '100%', overflow: 'hidden' }}>
                <Box sx={{ transform: 'scale(0.9)', transformOrigin: 'right center' }}>
                    <GridPagination />
                </Box>
            </Box>
        </Box>
    );
};

const TimeFormatter = React.memo(function TimeFormatter({params, value, nowMs}) {
    const { timezone, locale } = useUserTimeSettings();
    const relativeTime = useMemo(() => humanizeFutureDateInMinutes(value), [value, nowMs]);

    if (params.row.is_geostationary || params.row.is_geosynchronous) {
        return "∞";
    }

    return (
        <Box sx={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            <Typography component="span" variant="caption" sx={{ fontWeight: 700, color: 'text.primary' }}>
                {relativeTime}
            </Typography>
            <Typography component="span" className="passes-time-absolute" variant="caption" sx={{ color: 'text.secondary', ml: 0.5 }}>
                · {getTimeFromISO(value, timezone, locale)}
            </Typography>
        </Box>
    );
});


const DurationFormatter = React.memo(function DurationFormatter({params, event_start, event_end, nowMs}) {
    const { t } = useTranslation('earthview');
    const now = new Date(nowMs);
    const startDate = new Date(event_start);
    const endDate = new Date(event_end);

    if (params.row.is_geostationary || params.row.is_geosynchronous) {
        return "∞";
    }

    if (startDate > now) {
        // Pass is in the future
        const diffInSeconds = Math.floor((endDate - startDate) / 1000);
        const minutes = Math.floor(diffInSeconds / 60);
        const seconds = diffInSeconds % 60;
        return `${minutes}m ${seconds.toString().padStart(2, '0')}s`;

    } else if (endDate < now) {
        // Pass ended
        const diffInSeconds = Math.floor((endDate - startDate) / 1000);
        const minutes = Math.floor(diffInSeconds / 60);
        const seconds = diffInSeconds % 60;
        return `${minutes}m ${seconds.toString().padStart(2, '0')}s`;

    } else if (startDate < now && now < endDate) {
        // Passing now
        const diffInSeconds = Math.floor((endDate - now) / 1000);
        const minutes = Math.floor(diffInSeconds / 60);
        const seconds = diffInSeconds % 60;
        return `${minutes}m ${seconds.toString().padStart(2, '0')}s`;

    } else {
        return t('passes_table.no_value');
    }
});

const PassStatusCell = React.memo(function PassStatusCell({status, isTracked = false, targetNumber = null}) {
    const { t } = useTranslation('earthview');
    const markerSize = 17;
    const statusConfig = {
        live: {
            label: t('passes_table.status_visible'),
            color: 'success',
            icon: <RadioButtonCheckedIcon sx={{ fontSize: '0.85rem' }} />,
        },
        upcoming: {
            label: t('passes_table.status_upcoming'),
            color: 'warning',
            icon: <AccessTimeFilledIcon sx={{ fontSize: '0.85rem' }} />,
        },
        passed: {
            label: t('passes_table.status_passed'),
            color: 'info',
            icon: <DoneAllIcon sx={{ fontSize: '0.85rem' }} />,
        },
        dead: {
            label: t('passes_table.status_dead'),
            color: 'error',
            icon: <BlockIcon sx={{ fontSize: '0.85rem' }} />,
        },
    };
    const config = statusConfig[status] || statusConfig.upcoming;
    const markerOpacity = (status === 'passed' || status === 'dead') ? 0.45 : 1;

    return (
        <Box sx={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 0.6, width: '100%' }}>
            <Chip
                icon={config.icon}
                size="small"
                label={config.label}
                color={config.color}
                variant={status === 'upcoming' ? 'outlined' : 'filled'}
                sx={{ fontWeight: 700, minWidth: 85 }}
            />
            <Box sx={{ minWidth: markerSize + 6, display: 'inline-flex', justifyContent: 'center', alignItems: 'center', flexShrink: 0 }}>
                {isTracked && (
                    <Tooltip title={t('passes_table.tracked_tooltip', { defaultValue: 'Current target satellite' })}>
                        <TargetNumberIcon
                            targetNumber={targetNumber}
                            prefix="T"
                            sx={{
                                filter: 'brightness(1.15)',
                                opacity: markerOpacity,
                            }}
                            size={markerSize}
                            iconColor="info.light"
                        />
                    </Tooltip>
                )}
            </Box>
        </Box>
    );
});

const getPassTagLabel = (tag, t) => {
    const labels = {
        north_crossing: t('passes_table.pass_tag_labels.north_crossing', { defaultValue: 'North crossing' }),
        south_crossing: t('passes_table.pass_tag_labels.south_crossing', { defaultValue: 'South crossing' }),
        direction_cw: t('passes_table.pass_tag_labels.direction_cw', { defaultValue: 'CW' }),
        direction_ccw: t('passes_table.pass_tag_labels.direction_ccw', { defaultValue: 'CCW' }),
        direction_mixed: t('passes_table.pass_tag_labels.direction_mixed', { defaultValue: 'Mixed' }),
        elevation_low: t('passes_table.pass_tag_labels.elevation_low', { defaultValue: 'Low elevation' }),
        elevation_medium: t('passes_table.pass_tag_labels.elevation_medium', { defaultValue: 'Medium elevation' }),
        elevation_high: t('passes_table.pass_tag_labels.elevation_high', { defaultValue: 'High elevation' }),
        elevation_overhead: t('passes_table.pass_tag_labels.elevation_overhead', { defaultValue: 'Overhead' }),
    };
    return labels[tag] || tag;
};

const PassTypesCell = React.memo(function PassTypesCell({tags, t}) {
    const tagList = Array.isArray(tags) ? tags.filter(Boolean) : [];
    if (tagList.length === 0) {
        return (
            <Typography variant="caption" color="text.secondary">
                -
            </Typography>
        );
    }
    return (
        <Box
            sx={{
                display: 'flex',
                alignItems: 'center',
                alignContent: 'center',
                gap: 0.5,
                flexWrap: 'wrap',
                width: '100%',
                minHeight: '100%',
                py: 0,
            }}
        >
            {tagList.map((tag) => (
                <Chip
                    key={tag}
                    label={getPassTagLabel(tag, t)}
                    size="small"
                    variant="outlined"
                    sx={{
                        fontSize: '0.64rem',
                        height: 20,
                        '& .MuiChip-label': {
                            px: 0.7,
                        },
                    }}
                />
            ))}
        </Box>
    );
});

const PassTransmitterLinksCell = React.memo(function PassTransmitterLinksCell({transmitters, noDataText}) {
    if (!Array.isArray(transmitters) || transmitters.length === 0) {
        return noDataText;
    }

    const transmitterLinks = Object.entries(
        transmitters.reduce((acc, transmitter) => {
            const upBand = transmitter['uplink_low'] != null
                ? getFrequencyBand(transmitter['uplink_low'])
                : null;
            const downBand = transmitter['downlink_low'] != null
                ? getFrequencyBand(transmitter['downlink_low'])
                : null;

            let signature = noDataText;
            if (upBand && downBand) {
                signature = upBand === downBand ? `${upBand}↕` : `${upBand}↑/${downBand}↓`;
            } else if (upBand) {
                signature = `${upBand}↑`;
            } else if (downBand) {
                signature = `${downBand}↓`;
            }

            if (!acc[signature]) {
                acc[signature] = {
                    count: 0,
                    isSplitBand: Boolean(upBand && downBand && upBand !== downBand),
                    descriptions: new Set(),
                    upBand,
                    downBand,
                };
            }

            acc[signature].count += 1;
            if (transmitter?.description) {
                acc[signature].descriptions.add(transmitter.description.trim());
            }
            return acc;
        }, {})
    )
        .map(([signature, details]) => ({
            signature,
            count: details.count,
            isSplitBand: details.isSplitBand,
            tooltip: Array.from(details.descriptions).join(', '),
            upBand: details.upBand,
            downBand: details.downBand,
        }))
        .sort((a, b) => {
            if (a.isSplitBand !== b.isSplitBand) {
                return a.isSplitBand ? -1 : 1;
            }
            return a.signature.localeCompare(b.signature);
        });

    const txLinkPalette = ['#0B7285', '#2B8A3E', '#1C7ED6', '#5F3DC4', '#087F5B', '#364FC7'];
    const getPaletteColor = (signature) => {
        let hash = 0;
        for (let i = 0; i < signature.length; i += 1) {
            hash = ((hash << 5) - hash) + signature.charCodeAt(i);
            hash |= 0;
        }
        return txLinkPalette[Math.abs(hash) % txLinkPalette.length];
    };

    return (
        <Box sx={{display: 'flex', width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center'}}>
            <Box
                sx={{
                    display: 'flex',
                    width: '100%',
                    minWidth: 0,
                    gap: 0.5,
                    flexWrap: 'nowrap',
                    justifyContent: 'flex-start',
                    overflow: 'hidden',
                    WebkitMaskImage: 'linear-gradient(to right, black 0%, black 88%, transparent 100%)',
                    maskImage: 'linear-gradient(to right, black 0%, black 88%, transparent 100%)',
                }}
            >
            {transmitterLinks.map((link) => {
                const paletteColor = getPaletteColor(link.signature);
                const chip = (
                    <Chip
                        key={`tx-link-${link.signature}`}
                        label={
                            <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.35 }}>
                                {link.count > 1 && <Box component="span">{link.count} ×</Box>}
                                {link.upBand && (
                                    <>
                                        <Box component="span">{link.upBand}</Box>
                                        <ArrowUpwardRoundedIcon sx={{ fontSize: '0.85rem' }} />
                                    </>
                                )}
                                {link.upBand && link.downBand && link.upBand !== link.downBand && (
                                    <Box component="span">/</Box>
                                )}
                                {link.downBand && (
                                    <>
                                        <Box component="span">{link.downBand}</Box>
                                        <ArrowDownwardRoundedIcon sx={{ fontSize: '0.85rem' }} />
                                    </>
                                )}
                                {!link.upBand && !link.downBand && (
                                    <Box component="span">{link.signature}</Box>
                                )}
                            </Box>
                        }
                        size="small"
                        variant="filled"
                        sx={{
                            height: '18px',
                            maxWidth: '100%',
                            flexShrink: 0,
                            fontSize: '0.65rem',
                            fontWeight: 700,
                            backgroundColor: link.isSplitBand ? '#E67700' : `${paletteColor}CC`,
                            color: 'common.white',
                            border: '1px solid',
                            borderColor: link.isSplitBand ? '#D9480F' : `${paletteColor}B3`,
                            '& .MuiChip-label': {
                                px: 0.75
                            }
                        }}
                    />
                );

                if (!link.tooltip) {
                    return chip;
                }

                return (
                    <Tooltip key={`tx-link-tooltip-${link.signature}`} title={link.tooltip}>
                        <span>{chip}</span>
                    </Tooltip>
                );
            })}
            </Box>
        </Box>
    );
});

const PassProgressCell = React.memo(function PassProgressCell({row, nowMs}) {
    return <ProgressFormatter row={row} nowMs={nowMs} />;
}, (prevProps, nextProps) => (
    prevProps.nowMs === nextProps.nowMs &&
    prevProps.row?.id === nextProps.row?.id &&
    prevProps.row?.event_start === nextProps.row?.event_start &&
    prevProps.row?.event_end === nextProps.row?.event_end &&
    prevProps.row?.peak_time === nextProps.row?.peak_time &&
    prevProps.row?.is_geostationary === nextProps.row?.is_geostationary &&
    prevProps.row?.is_geosynchronous === nextProps.row?.is_geosynchronous
));

const MemoizedStyledDataGrid = React.memo(function MemoizedStyledDataGrid({
    passes,
    passesLoading,
    quickFilterPreset,
    trackedSatelliteNoradIds,
    targetNumberByNorad,
    onRowClick,
    onRowDoubleClick,
    onRowContextMenu,
    passesAreCached = false,
    orbitProjectionDuration = 240,
    pageSize = 10,
    onPageSizeChange,
    sortModel,
    onSortModelChange,
    columnVisibility,
    onColumnVisibilityChange
}) {
    const apiRef = useGridApiRef();
    const store = useStore();
    const { t, i18n } = useTranslation('earthview');
    const theme = useTheme();
    const isCompactView = useMediaQuery(theme.breakpoints.down('md'));
    const currentLanguage = i18n.language;
    const dataGridLocale = currentLanguage === 'el' ? elGR : enUS;
    const [page, setPage] = useState(0);
    const [nowMs, setNowMs] = useState(() => Date.now());
    const [relativeNowMs, setRelativeNowMs] = useState(() => Date.now());
    const nowMsRef = useRef(nowMs);
    nowMsRef.current = nowMs;
    const relativeNowMsRef = useRef(relativeNowMs);
    relativeNowMsRef.current = relativeNowMs;

    // Convert minutes to hours for display
    const projectionHours = Math.round(orbitProjectionDuration / 60);

    const selectedSatellitePositionsRef = useRef(() => {
        const state = store.getState();
        return state.earthViewTrack.selectedSatellitePositions;
    });

    useEffect(() => {
        const intervalId = setInterval(() => {
            setNowMs(Date.now());
        }, 1000);
        return () => clearInterval(intervalId);
    }, []);

    useEffect(() => {
        const intervalId = setInterval(() => {
            setRelativeNowMs(Date.now());
        }, 5000);
        return () => clearInterval(intervalId);
    }, []);

    const localeText = useMemo(() => ({
        ...dataGridLocale.components.MuiDataGrid.defaultProps.localeText,
        noRowsLabel: t('passes_table.no_passes', { hours: projectionHours })
    }), [dataGridLocale.components.MuiDataGrid.defaultProps.localeText, projectionHours, t]);

    const filteredPasses = useMemo(() => {
        const now = new Date(nowMs);
        if (quickFilterPreset === 'tracked') {
            return passes.filter((pass) => isPassTracked(pass, trackedSatelliteNoradIds));
        }
        if (quickFilterPreset === 'live') {
            return passes.filter((pass) => getPassStatus(pass, now) === 'live');
        }
        if (quickFilterPreset === 'next30') {
            return passes.filter((pass) => {
                const status = getPassStatus(pass, now);
                if (status === 'live') return true;
                if (status !== 'upcoming') return false;
                const start = new Date(pass.event_start);
                return (start - now) <= 30 * 60 * 1000;
            });
        }
        return passes;
    }, [passes, quickFilterPreset, nowMs, trackedSatelliteNoradIds]);

    const columns = useMemo(() => [
        {
            field: 'status',
            minWidth: 145,
            headerName: 'Status',
            flex: 1,
            align: 'center',
            headerAlign: 'center',
            cellClassName: 'passes-cell-status',
            valueGetter: (_value, row) => getPassStatus(row, new Date(nowMsRef.current)),
            sortComparator: (v1, v2) => getPassStatusPriority(v1) - getPassStatusPriority(v2),
            renderCell: (params) => (
                <PassStatusCell
                    status={params.value}
                    isTracked={isPassTracked(params.row, trackedSatelliteNoradIds)}
                    targetNumber={targetNumberByNorad?.[String(params.row.norad_id)] ?? null}
                />
            )
        },
        {
            field: 'name',
            minWidth: 120,
            headerName: t('passes_table.name'),
            flex: 2,
            renderCell: (params) => params.value
        },
        {
            field: 'alternative_name',
            minWidth: 120,
            headerName: t('passes_table.alternative_name'),
            flex: 2,
            valueGetter: (value, row) => {
                return row.alternative_name || '-';
            }
        },
        {
            field: 'name_other',
            minWidth: 120,
            headerName: t('passes_table.name_other'),
            flex: 2,
            valueGetter: (value, row) => {
                return row.name_other || '-';
            }
        },
        {
            field: 'peak_altitude',
            minWidth: 80,
            headerName: t('passes_table.peak_elevation'),
            align: 'center',
            headerAlign: 'center',
            flex: 1,
            valueFormatter: (value) => {
                return `${parseFloat(value).toFixed(2)}°`;
            },
            cellClassName: (params) => {
                if (params.value < 10.0) {
                    return "passes-cell-warning";
                } else if (params.value > 45.0) {
                    return "passes-cell-success";
                } else {
                    return '';
                }
            }
        },
        {
            field: 'elevation',
            minWidth: 90,
            headerName: t('passes_table.current_elevation'),
            align: 'center',
            headerAlign: 'center',
            flex: 1,
            sortable: false,
            renderCell: (params) => {
                const now = new Date(nowMsRef.current);
                const isActive = new Date(params.row.event_start) < now && new Date(params.row.event_end) > now;

                if (!isActive) {
                    return <span>-</span>;
                }

                const selectedSatellitePositions = selectedSatellitePositionsRef.current();
                const noradId = params.row.id.split("_")[1];
                const position = selectedSatellitePositions?.[noradId];

                return (
                    <ElevationDisplay
                        elevation={position?.el}
                        trend={position?.trend}
                        timeToMaxEl={position?.timeToMaxEl}
                        elRate={position?.elRate}
                    />
                );
            }
        },
        {
            field: 'progress',
            minWidth: 100,
            headerName: t('passes_table.progress'),
            align: 'center',
            headerAlign: 'center',
            flex: 1,
            renderCell: (params) => <PassProgressCell row={params.row} nowMs={nowMsRef.current} />
        },
        {
            field: 'duration',
            minWidth: 100,
            headerName: t('passes_table.duration'),
            align: 'center',
            headerAlign: 'center',
            flex: 1,
            sortable: false,
            renderCell: (params) => (
                <div>
                    <DurationFormatter params={params} event_start={params.row.event_start}
                                       event_end={params.row.event_end} nowMs={nowMsRef.current}/>
                </div>
            )
        },
        {
            field: 'pass_tags',
            minWidth: 220,
            headerName: t('passes_table.pass_types', { defaultValue: 'Pass Types' }),
            flex: 2,
            sortable: false,
            cellClassName: 'passes-cell-tags',
            renderCell: (params) => <PassTypesCell tags={params.value} t={t} />,
        },
        {
            field: 'transmitter_links',
            minWidth: 170,
            align: 'center',
            headerAlign: 'center',
            headerName: t('passes_table.transmitter_links', { defaultValue: 'Links' }),
            flex: 2,
            sortable: false,
            valueGetter: (_value, row) => row.transmitters,
            renderCell: (params) => <PassTransmitterLinksCell transmitters={params.value} noDataText={t('passes_table.no_data')} />
        },
        {
            field: 'event_start',
            minWidth: 170,
            headerName: t('passes_table.start'),
            flex: 2,
            renderCell: (params) => {
                const status = getPassStatus(params.row, new Date(nowMsRef.current));
                const timeTickMs = status === 'live' ? nowMsRef.current : relativeNowMsRef.current;
                return <TimeFormatter params={params} value={params.value} nowMs={timeTickMs}/>;
            }
        },
        {
            field: 'event_end',
            minWidth: 170,
            headerName: t('passes_table.end'),
            flex: 2,
            renderCell: (params) => {
                const status = getPassStatus(params.row, new Date(nowMsRef.current));
                const timeTickMs = status === 'live' ? nowMsRef.current : relativeNowMsRef.current;
                return <TimeFormatter params={params} value={params.value} nowMs={timeTickMs}/>;
            }
        },
        {
            field: 'distance_at_start',
            minWidth: 100,
            headerName: t('passes_table.distance_aos'),
            align: 'center',
            headerAlign: 'center',
            flex: 1,
            valueFormatter: (value) => {
                return `${parseFloat(value).toFixed(2)} km`
            }
        },
        {
            field: 'distance_at_end',
            minWidth: 100,
            headerName: t('passes_table.distance_los'),
            align: 'center',
            headerAlign: 'center',
            flex: 1,
            valueFormatter: (value) => {
                return `${parseFloat(value).toFixed(2)} km`
            }
        },
        {
            field: 'distance_at_peak',
            minWidth: 100,
            headerName: t('passes_table.distance_peak'),
            align: 'center',
            headerAlign: 'center',
            flex: 1,
            valueFormatter: (value) => {
                return `${parseFloat(value).toFixed(2)} km`
            }
        },
        {
            field: 'is_geostationary',
            minWidth: 70,
            headerName: t('passes_table.geo_stat'),
            align: 'center',
            headerAlign: 'center',
            flex: 1,
            valueFormatter: (value) => {
                return value ? 'Yes' : 'No';
            },
            hide: true,
        },
        {
            field: 'is_geosynchronous',
            minWidth: 70,
            headerName: t('passes_table.geo_sync'),
            align: 'center',
            headerAlign: 'center',
            flex: 1,
            valueFormatter: (value) => {
                return value ? 'Yes' : 'No';
            },
            hide: true,
        },
    ], [t, selectedSatellitePositionsRef, trackedSatelliteNoradIds, targetNumberByNorad]);

    const effectiveColumnVisibility = useMemo(() => {
        const base = {
            status: true,
            ...columnVisibility,
        };
        if (!isCompactView) {
            return base;
        }
        return {
            ...base,
            alternative_name: false,
            name_other: false,
            elevation: false,
            pass_tags: false,
            duration: false,
            transmitters: false,
            transmitter_links: false,
            event_end: false,
            distance_at_start: false,
            distance_at_end: false,
            distance_at_peak: false,
            is_geostationary: false,
            is_geosynchronous: false,
        };
    }, [columnVisibility, isCompactView]);

    const getPassesRowStyles = useCallback((param) => {
        if (param.row) {
            const now = new Date(nowMsRef.current);
            const eventStart = new Date(param.row.event_start);
            const status = getPassStatus(param.row, now);
            const classes = ['pointer-cursor'];
            if (isPassTracked(param.row, trackedSatelliteNoradIds)) {
                classes.push('passes-row-tracked');
            }
            if (status === 'dead') classes.push('passes-row-dead');
            else if (status === 'passed') classes.push('passes-row-passed');
            else if (status === 'live') classes.push('passes-row-live');
            else if ((eventStart - now) <= 30 * 60 * 1000) classes.push('passes-row-upcoming-soon');
            return classes.join(' ');
        }
        return "pointer-cursor";
    }, [trackedSatelliteNoradIds]);

    const getRowId = useCallback((params) => params.id, []);

    const handlePaginationModelChange = useCallback((model) => {
        setPage(model.page);
        if (onPageSizeChange && model.pageSize !== pageSize) {
            onPageSizeChange(model.pageSize);
        }
    }, [onPageSizeChange, pageSize]);

    // Bind context-menu directly on each row through slot props for consistent
    // behavior across browsers (including Firefox).
    const handleRowContextMenu = useCallback((event) => {
        if (typeof onRowContextMenu !== 'function') {
            return;
        }

        const rowId = event.currentTarget?.getAttribute?.('data-id');
        if (!rowId) return;
        const row = apiRef?.current?.getRow?.(rowId);
        if (!row) return;

        // Keep DataGrid's row selection in sync with right-click context actions.
        // This ensures visual selection updates even when no left-click occurred.
        if (typeof apiRef?.current?.selectRow === 'function') {
            apiRef.current.selectRow(row.id, true, true);
        } else if (typeof apiRef?.current?.setRowSelectionModel === 'function') {
            apiRef.current.setRowSelectionModel({ type: 'include', ids: new Set([row.id]) });
        }

        onRowContextMenu({ id: rowId, row }, event);
    }, [apiRef, onRowContextMenu]);

    return (
        <StyledDataGrid
            apiRef={apiRef}
            pageSizeOptions={[5, 10, 15, 20]}
            fullWidth={true}
            loading={passesLoading}
            slotProps={{
                loadingOverlay: {
                    variant: 'linear-progress',
                    noRowsVariant: 'linear-progress',
                },
                row: {
                    onContextMenu: handleRowContextMenu,
                },
            }}
            getRowClassName={getPassesRowStyles}
            onRowClick={onRowClick}
            onRowDoubleClick={onRowDoubleClick}
            getRowId={getRowId}
            localeText={localeText}
            sx={{
                border: 0,
                marginTop: 0,
                [`& .${gridClasses.cell}:focus, & .${gridClasses.cell}:focus-within`]: {
                    outline: 'none',
                },
                [`& .${gridClasses.columnHeader}:focus, & .${gridClasses.columnHeader}:focus-within`]:
                    {
                        outline: 'none',
                    },
                '& .MuiDataGrid-overlay': {
                    fontSize: '0.875rem',
                    fontStyle: 'italic',
                    color: 'text.secondary',
                },
                '& .MuiDataGrid-selectedRowCount': {
                    visibility: 'hidden',
                    position: 'absolute',
                },
            }}
            density={"compact"}
            rows={filteredPasses}
            paginationModel={{
                pageSize: pageSize,
                page: page,
            }}
            onPaginationModelChange={handlePaginationModelChange}
            sortModel={sortModel}
            onSortModelChange={onSortModelChange}
            columnVisibilityModel={effectiveColumnVisibility}
            onColumnVisibilityModelChange={onColumnVisibilityChange}
            columns={columns}
            pinnedColumns={isCompactView ? { left: ['name'], right: [] } : { left: ['name', 'status'], right: ['progress'] }}
            slots={{
                pagination: CustomPagination,
            }}
        />
    );
}, (prevProps, nextProps) => {
    // Custom comparison function - return true if props haven't changed in ways that matter
    return (
        prevProps.passes === nextProps.passes &&
        prevProps.quickFilterPreset === nextProps.quickFilterPreset &&
        prevProps.trackedSatelliteNoradIds === nextProps.trackedSatelliteNoradIds &&
        prevProps.targetNumberByNorad === nextProps.targetNumberByNorad &&
        prevProps.passesLoading === nextProps.passesLoading &&
        prevProps.orbitProjectionDuration === nextProps.orbitProjectionDuration &&
        prevProps.pageSize === nextProps.pageSize &&
        prevProps.sortModel === nextProps.sortModel &&
        prevProps.columnVisibility === nextProps.columnVisibility
    );
});


const NextPassesGroupIsland = React.memo(function NextPassesGroupIsland() {
    const {socket} = useSocket();
    const dispatch = useDispatch();
    const { t } = useTranslation('earthview');
    const theme = useTheme();
    const isCompactHeader = useMediaQuery(theme.breakpoints.down('lg'));
    const isTightHeader = useMediaQuery(theme.breakpoints.down('md'));
    const containerRef = useRef(null);
    const hasFetchedRef = useRef(false);
    const lastFetchParamsRef = useRef(null);
    const lastSatelliteFetchGroupRef = useRef(null);
    const [containerHeight, setContainerHeight] = useState(0);
    const {
        selectedSatGroupId,
        passes,
        passesAreCached,
        passesLoading,
        loadingSatellites,
        passesRangeStart,
        passesRangeEnd,
        passesCachedGroupId,
        nextPassesHours,
        orbitProjectionDuration,
        gridEditable,
        passesTablePageSize,
        passesTableSortModel,
        passesTableColumnVisibility,
        openPassesTableSettingsDialog,
        selectedSatellites
    } = useSelector(state => state.earthViewTrack);
    const trackerInstances = useSelector((state) => state.trackerInstances?.instances || []);
    const trackingState = useSelector((state) => state.targetSatTrack?.trackingState || {});
    const trackerViews = useSelector((state) => state.targetSatTrack?.trackerViews || {});
    const { requestRotatorForTarget, dialog: rotatorSelectionDialog } = useTargetRotatorSelectionDialog();
    const { location } = useSelector(state => state.location);

    const minHeight = 200;
    const maxHeight = 400;
    const [columnUpdateKey, setColumnUpdateKey] = useState(0);
    const hasLoadedFromStorageRef = useRef(false);
    const isLoadingRef = useRef(false);
    const [quickFilterPreset, setQuickFilterPreset] = useState('all');
    // Keep row context menu coordinates + row payload together to avoid stale selections.
    const [passContextMenu, setPassContextMenu] = useState(null);
    const [satelliteEditDialogOpen, setSatelliteEditDialogOpen] = useState(false);
    const [transmittersDialogOpen, setTransmittersDialogOpen] = useState(false);
    const [contextSatelliteForDialogs, setContextSatelliteForDialogs] = useState(null);
    const latestDialogSatelliteRequestRef = useRef(0);
    const trackedSatelliteNoradIds = useMemo(() => {
        return trackerInstances
            .filter((instance) => {
                const groupId = instance?.tracking_state?.group_id;
                if (!selectedSatGroupId || !groupId) return true;
                return String(groupId) === String(selectedSatGroupId);
            })
            .map((instance) => instance?.tracking_state?.norad_id)
            .filter((noradId) => noradId != null);
    }, [trackerInstances, selectedSatGroupId]);
    const targetNumberByNorad = useMemo(() => {
        const mapping = {};
        trackerInstances.forEach((instance, index) => {
            const groupId = instance?.tracking_state?.group_id;
            if (selectedSatGroupId && groupId && String(groupId) !== String(selectedSatGroupId)) {
                return;
            }
            const noradId = instance?.tracking_state?.norad_id;
            if (noradId == null) {
                return;
            }
            const key = String(noradId);
            const targetNumber = Number(instance?.target_number || (index + 1));
            if (mapping[key] == null || targetNumber < mapping[key]) {
                mapping[key] = targetNumber;
            }
        });
        return mapping;
    }, [trackerInstances, selectedSatGroupId]);

    // Load column visibility from localStorage on mount
    useEffect(() => {
        // Prevent double loading (React StrictMode or component remounting)
        if (isLoadingRef.current || hasLoadedFromStorageRef.current) {
            return;
        }

        isLoadingRef.current = true;

        const loadColumnVisibility = () => {
            try {
                const stored = localStorage.getItem('passes-table-column-visibility');
                if (stored) {
                    const parsedVisibility = JSON.parse(stored);
                    dispatch(setPassesTableColumnVisibility(parsedVisibility));
                }
            } catch (e) {
                console.error('Failed to load passes table column visibility:', e);
            } finally {
                hasLoadedFromStorageRef.current = true;
                isLoadingRef.current = false;
            }
        };
        loadColumnVisibility();
    }, []); // Empty deps - only run once on mount

    // Persist column visibility to localStorage whenever it changes (but not on initial load)
    useEffect(() => {
        if (passesTableColumnVisibility && hasLoadedFromStorageRef.current) {
            try {
                localStorage.setItem('passes-table-column-visibility', JSON.stringify(passesTableColumnVisibility));
            } catch (e) {
                console.error('Failed to save passes table column visibility:', e);
            }
        }
    }, [passesTableColumnVisibility]);

    const handleRefreshPasses = () => {
        if (selectedSatGroupId) {
            dispatch(fetchNextPassesForGroup({
                socket,
                selectedSatGroupId,
                hours: nextPassesHours,
                forceRecalculate: true
            }));
        }
    };

    useEffect(() => {
        if (selectedSatGroupId) {
            const currentParams = `${selectedSatGroupId}-${nextPassesHours}`;

            // Only fetch if parameters have changed
            if (lastFetchParamsRef.current !== currentParams) {
                lastFetchParamsRef.current = currentParams;
                hasFetchedRef.current = false; // Reset for new parameters

                // Immediately fetch when group changes - don't rely on cache from different group
                hasFetchedRef.current = true;
                dispatch(fetchNextPassesForGroup({socket, selectedSatGroupId, hours: nextPassesHours}));
                return; // Exit early to prevent cache check logic
            }

            // Check if we have valid cached data covering the requested time window
            const hasValidTimeWindow = () => {
                if (!passes || passes.length === 0) return false;
                if (!passesRangeStart || !passesRangeEnd) return false;

                // Check if cached data is for the currently selected group
                if (passesCachedGroupId !== selectedSatGroupId) return false;

                // Calculate expected time window
                const now = new Date();

                // Parse cached time window
                const cachedStart = new Date(passesRangeStart);
                const cachedEnd = new Date(passesRangeEnd);

                // Check if cached window still covers most of the requested window
                // Allow some tolerance since time passes between visits
                // If cached data covers at least 90% of the requested window, consider it valid
                const tolerance = 0.9; // 90% coverage required
                const requestedWindowDuration = nextPassesHours * 60 * 60 * 1000; // in milliseconds
                const minAcceptableEnd = new Date(now.getTime() + (requestedWindowDuration * tolerance));

                // Check if cached window covers the requested window (with tolerance)
                const cachedStartValid = cachedStart <= now;
                const cachedEndValid = cachedEnd >= minAcceptableEnd;

                return cachedStartValid && cachedEndValid;
            };

            if (!hasFetchedRef.current && !hasValidTimeWindow()) {
                hasFetchedRef.current = true;
                dispatch(fetchNextPassesForGroup({socket, selectedSatGroupId, hours: nextPassesHours}));
            } else if (hasValidTimeWindow()) {
                // Mark as fetched to prevent refetch - we have valid data in Redux
                hasFetchedRef.current = true;
            }
        }

        // Don't reset hasFetchedRef in cleanup - that's what causes the double call in StrictMode
        // return () => {
        //     hasFetchedRef.current = false;
        // };
    }, [selectedSatGroupId, dispatch, socket, nextPassesHours, passes, passesRangeStart, passesRangeEnd, passesCachedGroupId]);

    // Track which passes we've calculated curves for by creating a hash
    const calculatedPassesHashRef = useRef(null);
    const calculatingRef = useRef(false);

    // Fetch satellites if we have a selected group but no satellites loaded yet
    // This handles the case where page loads with a group already selected (from localStorage)
    useEffect(() => {
        if (!selectedSatGroupId) {
            lastSatelliteFetchGroupRef.current = null;
            return;
        }

        const selectedSatellitesCount = selectedSatellites?.length ?? 0;

        // If satellites are already available for this group, no fallback fetch is needed here.
        if (selectedSatellitesCount > 0) {
            lastSatelliteFetchGroupRef.current = selectedSatGroupId;
            return;
        }

        if (passesLoading || loadingSatellites) {
            return;
        }

        // Prevent repeated fetches when a group currently resolves to an empty satellite set.
        if (lastSatelliteFetchGroupRef.current === selectedSatGroupId) {
            return;
        }

        lastSatelliteFetchGroupRef.current = selectedSatGroupId;
        if (selectedSatGroupId) {
            dispatch(fetchSatellitesByGroupId({ socket, satGroupId: selectedSatGroupId }));
        }
    }, [selectedSatGroupId, selectedSatellites, dispatch, socket, passesLoading, loadingSatellites]);

    // If the selected group currently has no satellites, clear stale pass timeline/table data.
    useEffect(() => {
        if (!selectedSatGroupId || loadingSatellites) {
            return;
        }

        if ((selectedSatellites?.length ?? 0) === 0) {
            dispatch(setPasses([]));
        }
    }, [selectedSatGroupId, selectedSatellites, loadingSatellites, dispatch]);

    // Calculate elevation curves when passes are received
    useEffect(() => {
        // If we're currently calculating, skip
        if (calculatingRef.current) {
            return;
        }

        // Check if location is valid (not null)
        const isLocationValid = location && location.lat != null && location.lon != null;

        if (passes && passes.length > 0 && isLocationValid && selectedSatellites && selectedSatellites.length > 0) {
            // Create hash of pass IDs to detect if these are actually NEW passes
            const currentPassesHash = passes?.map(p => `${p.norad_id}-${p.event_start}`).sort().join('|') || '';

            // If we already attempted calculation for this hash, skip
            // (even if some passes still have empty curves - those are likely defensive BSTAR rejections)
            if (calculatedPassesHashRef.current === currentPassesHash && currentPassesHash !== '') {
                return;
            }

            // If hash changed (new passes), calculate
            if (calculatedPassesHashRef.current !== currentPassesHash) {
                calculatingRef.current = true;
                calculatedPassesHashRef.current = currentPassesHash;

                // Create satellite lookup from selectedSatellites
                const satelliteLookup = {};
                selectedSatellites.forEach(sat => {
                    satelliteLookup[sat.norad_id] = {
                        norad_id: sat.norad_id,
                        tle1: sat.tle1,
                        tle2: sat.tle2
                    };
                });

                // Verify all passes have corresponding satellites in the lookup
                const allPassesHaveSatellites = passes.every(pass => satelliteLookup[pass.norad_id]);

                if (!allPassesHaveSatellites) {
                    // Passes belong to a different satellite group, skip calculation
                    calculatingRef.current = false;
                    calculatedPassesHashRef.current = null;
                    return;
                }

                // Calculate elevation curves in the background
                setTimeout(() => {
                    const passesWithCurves = calculateElevationCurvesForPasses(
                        passes,
                        { lat: location.lat, lon: location.lon },
                        satelliteLookup
                    );
                    dispatch(updatePassesWithElevationCurves(passesWithCurves));
                    calculatingRef.current = false;
                }, 0);
            }
        }
    }, [passes, location, dispatch, selectedSatellites]);

    useEffect(() => {
        // Update the passes every two hours plus 5 mins to wait until the cache is invalidated
        const interval = setInterval(() => {
            if (selectedSatGroupId) {
                dispatch(fetchNextPassesForGroup({socket, selectedSatGroupId, hours: nextPassesHours}));
            }
        }, 7200000 + (60000 * 5));

        return () => {
            clearInterval(interval);
        }
    }, [selectedSatGroupId, socket, nextPassesHours, dispatch]);

    useEffect(() => {
        const target = containerRef.current;
        const observer = new ResizeObserver((entries) => {
            setContainerHeight(entries[0].contentRect.height);
        });
        if (target) {
            observer.observe(target);
        }
        return () => {
            observer.disconnect();
        };
    }, [containerRef]);

    const handleOnRowClick = (params) => {
        const noradId = params.row.id.split("_")[1];
        dispatch(setSelectedSatelliteId(parseInt(noradId)));
    };

    const handleOnRowDoubleClick = (params) => {
        handleOnRowClick(params);
    };

    const handlePageSizeChange = (newPageSize) => {
        dispatch(setPassesTablePageSize(newPageSize));
    };

    const handleSortModelChange = (newSortModel) => {
        dispatch(setPassesTableSortModel(newSortModel));
    };

    const handleColumnVisibilityChange = (newModel) => {
        dispatch(setPassesTableColumnVisibility(newModel));
    };

    const handleOpenSettings = () => {
        dispatch(setOpenPassesTableSettingsDialog(true));
    };

    const handleCloseSettings = () => {
        dispatch(setOpenPassesTableSettingsDialog(false));
    };

    const applyDefaultSort = useCallback(() => {
        dispatch(setPassesTableSortModel([
            { field: 'status', sort: 'asc' },
            { field: 'event_start', sort: 'asc' },
        ]));
    }, [dispatch]);

    const handleQuickPreset = useCallback((preset) => {
        setQuickFilterPreset(preset);
        if (preset === 'highEl') {
            dispatch(setPassesTableSortModel([
                { field: 'peak_altitude', sort: 'desc' },
                { field: 'event_start', sort: 'asc' },
            ]));
            return;
        }
        applyDefaultSort();
    }, [dispatch, applyDefaultSort]);

    const copyTextToClipboard = useCallback(async (text) => {
        if (navigator?.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
            return;
        }

        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.setAttribute('readonly', '');
        textArea.style.position = 'absolute';
        textArea.style.left = '-9999px';
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
    }, []);

    const handleClosePassContextMenu = useCallback(() => {
        setPassContextMenu(null);
    }, []);

    const handleSuppressNativeContextMenu = useCallback((event) => {
        event.preventDefault();
        if (typeof event.stopPropagation === 'function') {
            event.stopPropagation();
        }
        setPassContextMenu(null);
    }, []);

    const handlePassRowContextMenu = useCallback((params, event) => {
        if (!params?.row) {
            return;
        }
        event.preventDefault();
        if (typeof event.stopPropagation === 'function') {
            event.stopPropagation();
        }
        // UX preference: the next right click closes the currently open menu.
        if (passContextMenu) {
            setPassContextMenu(null);
            return;
        }
        const rowNorad = Number(params.row.norad_id);
        if (!Number.isNaN(rowNorad)) {
            dispatch(setSelectedSatelliteId(rowNorad));
        } else if (params.row.norad_id != null) {
            dispatch(setSelectedSatelliteId(params.row.norad_id));
        }
        setPassContextMenu({
            mouseX: event.clientX + 2,
            mouseY: event.clientY - 6,
            row: params.row,
        });
    }, [dispatch, passContextMenu]);

    const hydrateSatelliteForDialogs = useCallback((row) => {
        if (!row) {
            return;
        }

        setContextSatelliteForDialogs(row);
        const parsedNoradId = Number(row.norad_id);
        if (Number.isNaN(parsedNoradId) || !socket) {
            return;
        }

        const requestId = latestDialogSatelliteRequestRef.current + 1;
        latestDialogSatelliteRequestRef.current = requestId;
        dispatch(fetchSatellite({ socket, noradId: parsedNoradId }))
            .unwrap()
            .then((response) => {
                if (latestDialogSatelliteRequestRef.current !== requestId) {
                    return;
                }
                const details = response?.details || {};
                const transmitters = Array.isArray(response?.transmitters)
                    ? response.transmitters
                    : (row?.transmitters || []);
                setContextSatelliteForDialogs({
                    ...row,
                    ...details,
                    transmitters,
                });
            })
            .catch(() => {
                // Keep using pass row payload when details fetch fails.
            });
    }, [dispatch, socket]);

    const buildSchedulerSatellitePayload = useCallback((row) => {
        return {
            norad_id: row?.norad_id ?? '',
            name: row?.name || `NORAD ${row?.norad_id ?? ''}`,
            group_id: row?.group_id || selectedSatGroupId || '',
        };
    }, [selectedSatGroupId]);

    const handleSetTrackingOnBackend = useCallback(async (row) => {
        if (!row?.norad_id) {
            return;
        }

        const rowNorad = Number(row.norad_id);
        if (!Number.isNaN(rowNorad)) {
            dispatch(setSelectedSatelliteId(rowNorad));
        } else {
            dispatch(setSelectedSatelliteId(row.norad_id));
        }

        const selectedAssignment = await requestRotatorForTarget(row?.name || String(row.norad_id));
        if (!selectedAssignment) {
            return;
        }

        const assignmentAction = String(selectedAssignment?.action || 'retarget_current_slot');
        const isCreateNewSlot = assignmentAction === 'create_new_slot';
        const trackerId = String(selectedAssignment?.trackerId || '');
        const rotatorId = String(selectedAssignment?.rotatorId || 'none');
        const assignmentRigId = String(selectedAssignment?.rigId || 'none');
        if (!trackerId) {
            return;
        }

        const selectedTrackerInstance = trackerInstances.find(
            (instance) => String(instance?.tracker_id || '') === trackerId
        );
        const selectedTrackerView = trackerViews?.[trackerId] || {};
        const selectedTrackerState = selectedTrackerView?.trackingState || selectedTrackerInstance?.tracking_state || {};
        const nextRigId = isCreateNewSlot
            ? assignmentRigId
            : String(
                selectedTrackerView?.selectedRadioRig
                ?? selectedTrackerState?.rig_id
                ?? assignmentRigId
                ?? 'none'
            );
        const nextRotatorId = isCreateNewSlot ? 'none' : rotatorId;
        const nextTransmitterId = isCreateNewSlot
            ? 'none'
            : String(selectedTrackerState?.transmitter_id || 'none');
        const nextGroupId = selectedSatGroupId || selectedTrackerState?.group_id || trackingState?.group_id || '';

        dispatch(setTrackerId(trackerId));
        dispatch(setRotator({ value: nextRotatorId, trackerId }));

        const normalizedTargetName = String(row?.name || row?.norad_id || '').trim();
        const satelliteTargetPatch = {
            target_type: 'satellite',
            target_name: normalizedTargetName || String(row?.norad_id || '').trim(),
            command: null,
            body_id: null,
        };

        const newTrackingState = isCreateNewSlot
            ? {
                tracker_id: trackerId,
                norad_id: row.norad_id,
                group_id: nextGroupId,
                ...satelliteTargetPatch,
                rig_id: nextRigId,
                rotator_id: nextRotatorId,
                transmitter_id: 'none',
                rig_state: 'disconnected',
                rotator_state: 'disconnected',
                rig_vfo: 'none',
                vfo1: 'uplink',
                vfo2: 'downlink',
            }
            : {
                ...selectedTrackerState,
                tracker_id: trackerId,
                norad_id: row.norad_id,
                group_id: nextGroupId,
                ...satelliteTargetPatch,
                rig_id: nextRigId,
                rotator_id: nextRotatorId,
                transmitter_id: nextTransmitterId,
            };

        await dispatch(setTrackingStateInBackend({ socket, data: newTrackingState })).unwrap();
    }, [
        dispatch,
        requestRotatorForTarget,
        selectedSatGroupId,
        socket,
        trackerInstances,
        trackerViews,
        trackingState?.group_id,
    ]);

    const handleOpenSatelliteEditDialog = useCallback((row) => {
        if (!row) return;
        setSatelliteEditDialogOpen(true);
        hydrateSatelliteForDialogs(row);
    }, [hydrateSatelliteForDialogs]);

    const handleOpenTransmittersDialog = useCallback((row) => {
        if (!row) return;
        setTransmittersDialogOpen(true);
        hydrateSatelliteForDialogs(row);
    }, [hydrateSatelliteForDialogs]);

    const handleScheduleObservation = useCallback((row) => {
        const satellite = buildSchedulerSatellitePayload(row);
        dispatch(setSelectedMonitoredSatellite(null));
        dispatch(setMonitoredSatelliteDialogOpen(false));
        dispatch(setSelectedObservation({
            name: `${satellite.name} observation`,
            enabled: true,
            satellite,
            pass: null,
            sessions: [],
            rotator: {
                id: null,
                tracking_enabled: false,
                unpark_before_tracking: false,
                park_after_observation: false,
            },
            rig: { id: null, doppler_correction: false, vfo: 'VFO_A' },
        }));
        dispatch(setDialogOpen(true));
    }, [buildSchedulerSatellitePayload, dispatch]);

    const handleMonitorSatellite = useCallback((row) => {
        const satellite = buildSchedulerSatellitePayload(row);
        dispatch(setSelectedObservation(null));
        dispatch(setDialogOpen(false));
        dispatch(setSelectedMonitoredSatellite({
            enabled: true,
            satellite,
            sessions: [],
            rotator: {
                id: null,
                tracking_enabled: false,
                unpark_before_tracking: false,
                park_after_observation: false,
            },
            rig: { id: null, doppler_correction: false, vfo: 'VFO_A' },
            min_elevation: 20,
            task_start_elevation: 10,
            lookahead_hours: 24,
        }));
        dispatch(setMonitoredSatelliteDialogOpen(true));
    }, [buildSchedulerSatellitePayload, dispatch]);

    const handlePassSatelliteSaved = useCallback(() => {
        if (!selectedSatGroupId || selectedSatGroupId === 'none' || !socket) {
            return;
        }
        dispatch(fetchSatellitesByGroupId({ socket, satGroupId: selectedSatGroupId }));
    }, [dispatch, selectedSatGroupId, socket]);

    const handlePassMenuAction = useCallback(async (action) => {
        const row = passContextMenu?.row;
        if (!row) {
            return;
        }

        try {
            if (action === 'set-target') {
                await handleSetTrackingOnBackend(row);
                return;
            }

            if (action === 'edit-properties') {
                handleOpenSatelliteEditDialog(row);
                return;
            }

            if (action === 'edit-transmitters') {
                handleOpenTransmittersDialog(row);
                return;
            }

            if (action === 'schedule-observation') {
                handleScheduleObservation(row);
                return;
            }

            if (action === 'monitor-satellite') {
                handleMonitorSatellite(row);
                return;
            }

            if (action === 'copy-norad') {
                await copyTextToClipboard(String(row.norad_id ?? ''));
                toast.success('NORAD ID copied to clipboard');
                return;
            }

            if (action === 'copy-window') {
                await copyTextToClipboard(`${row.event_start || '-'} -> ${row.event_end || '-'}`);
                toast.success('Pass window copied to clipboard');
                return;
            }

            if (action === 'copy-summary') {
                const summary = `${row.name || '-'} | NORAD ${row.norad_id ?? '-'} | AOS ${row.event_start || '-'} | LOS ${row.event_end || '-'} | Peak ${row.peak_altitude ?? '-'}°`;
                await copyTextToClipboard(summary);
                toast.success('Pass summary copied to clipboard');
                return;
            }
        } catch (error) {
            toast.error(`Failed to process menu action: ${error?.message || 'Unknown error'}`);
        } finally {
            setPassContextMenu(null);
        }
    }, [
        copyTextToClipboard,
        handleMonitorSatellite,
        handleOpenSatelliteEditDialog,
        handleOpenTransmittersDialog,
        handleScheduleObservation,
        handleSetTrackingOnBackend,
        passContextMenu,
    ]);

    useEffect(() => {
        const handleKeyboardShortcuts = (event) => {
            if (!event.altKey) return;
            if (event.key === '1') {
                handleQuickPreset('all');
            } else if (event.key === '2') {
                handleQuickPreset('live');
            } else if (event.key === '3') {
                handleQuickPreset('next30');
            } else if (event.key === '4') {
                handleQuickPreset('highEl');
            } else if (event.key === '5') {
                handleQuickPreset('tracked');
            } else {
                return;
            }
            event.preventDefault();
        };

        window.addEventListener('keydown', handleKeyboardShortcuts);
        return () => window.removeEventListener('keydown', handleKeyboardShortcuts);
    }, [handleQuickPreset]);

    const quickFilterButtonSx = useMemo(() => ({
        minHeight: isTightHeader ? 20 : (isCompactHeader ? 22 : 24),
        height: isTightHeader ? 20 : (isCompactHeader ? 22 : 24),
        py: 0,
        px: isTightHeader ? 0.7 : (isCompactHeader ? 0.85 : 1),
        lineHeight: 1.05,
        fontSize: isTightHeader ? '0.64rem' : (isCompactHeader ? '0.68rem' : '0.72rem'),
        minWidth: isTightHeader ? 30 : 'auto',
    }), [isCompactHeader, isTightHeader]);
    const titleIconButtonSx = useMemo(
        () => ({ padding: isTightHeader ? '1px' : '2px' }),
        [isTightHeader]
    );
    const passContextMenuItems = useMemo(() => ([
        { key: 'set-target', label: t('satellites_table.context_menu.set_as_target'), onClick: () => handlePassMenuAction('set-target') },
        { key: 'edit-properties', label: t('satellites_table.context_menu.edit_properties'), onClick: () => handlePassMenuAction('edit-properties') },
        { key: 'edit-transmitters', label: t('satellites_table.context_menu.edit_transmitters'), onClick: () => handlePassMenuAction('edit-transmitters') },
        { key: 'schedule-observation', label: t('satellites_table.context_menu.schedule_observation'), onClick: () => handlePassMenuAction('schedule-observation') },
        { key: 'monitor-satellite', label: t('satellites_table.context_menu.monitor_satellite'), onClick: () => handlePassMenuAction('monitor-satellite') },
        { type: 'divider', key: 'divider-copy' },
        { key: 'copy-norad', label: t('satellites_table.context_menu.copy_norad'), onClick: () => handlePassMenuAction('copy-norad') },
        {
            key: 'copy-window',
            label: t('passes_table.context_menu.copy_pass_window'),
            onClick: () => handlePassMenuAction('copy-window'),
        },
        {
            key: 'copy-summary',
            label: t('passes_table.context_menu.copy_pass_summary'),
            onClick: () => handlePassMenuAction('copy-summary'),
        },
    ]), [handlePassMenuAction, t]);

    return (
        <>
            <TitleBar
                className={getClassNamesBasedOnGridEditing(gridEditable, ["window-title-bar"])}
                sx={islandTitleBarCompactSx}
            >
                <Box sx={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', height: '100%'}}>
                    <Box sx={{display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, flex: 1}}>
                        <Typography variant="subtitle2" sx={{
                            fontWeight: 'bold',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            minWidth: 0
                        }}>
                            {t('passes_table.title', { hours: nextPassesHours })}
                        </Typography>
                        <Typography variant="caption" sx={{
                            fontStyle: 'italic',
                            color: 'text.secondary',
                            opacity: 0.7,
                            whiteSpace: 'nowrap',
                            flexShrink: 0
                        }}>
                            ({passes.length} {passes.length === 1 ? 'pass' : 'passes'}{passesAreCached ? `, ${t('passes_table.cached')}` : ''})
                        </Typography>
                    </Box>
                    <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
                        <Tooltip title="All passes (Alt+1)">
                            <span>
                                <Button
                                    size="small"
                                    variant={quickFilterPreset === 'all' ? 'contained' : 'outlined'}
                                    onClick={() => handleQuickPreset('all')}
                                    sx={quickFilterButtonSx}
                                    aria-label="All passes"
                                >
                                    {isTightHeader ? <DoneAllIcon sx={{ fontSize: '0.82rem' }} /> : 'All'}
                                </Button>
                            </span>
                        </Tooltip>
                        <Tooltip title="Live passes (Alt+2)">
                            <span>
                                <Button
                                    size="small"
                                    variant={quickFilterPreset === 'live' ? 'contained' : 'outlined'}
                                    onClick={() => handleQuickPreset('live')}
                                    sx={quickFilterButtonSx}
                                    aria-label="Live passes"
                                >
                                    {isTightHeader ? <RadioButtonCheckedIcon sx={{ fontSize: '0.82rem' }} /> : 'Live'}
                                </Button>
                            </span>
                        </Tooltip>
                        <Tooltip title="Live or next 30 minutes (Alt+3)">
                            <span>
                                <Button
                                    size="small"
                                    variant={quickFilterPreset === 'next30' ? 'contained' : 'outlined'}
                                    onClick={() => handleQuickPreset('next30')}
                                    sx={quickFilterButtonSx}
                                    aria-label="Next 30 minutes"
                                >
                                    {isTightHeader ? <AccessTimeFilledIcon sx={{ fontSize: '0.82rem' }} /> : 'Next 30m'}
                                </Button>
                            </span>
                        </Tooltip>
                        <Tooltip title="Highest elevation first (Alt+4)">
                            <span>
                                <Button
                                    size="small"
                                    variant={quickFilterPreset === 'highEl' ? 'contained' : 'outlined'}
                                    onClick={() => handleQuickPreset('highEl')}
                                    sx={quickFilterButtonSx}
                                    aria-label="Highest elevation first"
                                >
                                    {isTightHeader ? <ArrowUpwardRoundedIcon sx={{ fontSize: '0.82rem' }} /> : 'High El'}
                                </Button>
                            </span>
                        </Tooltip>
                        <Tooltip title="Tracked satellites only (Alt+5)">
                            <span>
                                <Button
                                    size="small"
                                    variant={quickFilterPreset === 'tracked' ? 'contained' : 'outlined'}
                                    onClick={() => handleQuickPreset('tracked')}
                                    sx={quickFilterButtonSx}
                                    aria-label="Tracked satellites only"
                                >
                                    {isTightHeader ? <TrackChangesIcon sx={{ fontSize: '0.82rem' }} /> : 'Tracked'}
                                </Button>
                            </span>
                        </Tooltip>
                        <Tooltip title={t('passes_table_settings.title')}>
                            <span>
                                <IconButton
                                    size="small"
                                    onClick={handleOpenSettings}
                                    sx={titleIconButtonSx}
                                >
                                    <SettingsIcon fontSize="small" />
                                </IconButton>
                            </span>
                        </Tooltip>
                        <Tooltip title="Refresh passes (force recalculate)">
                            <span>
                                <IconButton
                                    size="small"
                                    onClick={handleRefreshPasses}
                                    disabled={passesLoading || !selectedSatGroupId}
                                    sx={titleIconButtonSx}
                                >
                                    <RefreshIcon fontSize="small" />
                                </IconButton>
                            </span>
                        </Tooltip>
                    </Box>
                </Box>
            </TitleBar>
            <div style={{position: 'relative', display: 'block', height: '100%'}} ref={containerRef}>
                <div style={{
                    padding: '0rem 0rem 0rem 0rem',
                    display: 'flex',
                    flexDirection: 'column',
                    height: containerHeight - 25,
                    minHeight,
                }}>
                    <MemoizedStyledDataGrid
                        passes={passes}
                        passesLoading={Boolean(selectedSatGroupId) && (passesLoading || loadingSatellites)}
                        quickFilterPreset={quickFilterPreset}
                        trackedSatelliteNoradIds={trackedSatelliteNoradIds}
                        targetNumberByNorad={targetNumberByNorad}
                        onRowClick={handleOnRowClick}
                        onRowDoubleClick={handleOnRowDoubleClick}
                        onRowContextMenu={handlePassRowContextMenu}
                        orbitProjectionDuration={orbitProjectionDuration}
                        pageSize={passesTablePageSize}
                        onPageSizeChange={handlePageSizeChange}
                        sortModel={passesTableSortModel}
                        onSortModelChange={handleSortModelChange}
                        columnVisibility={passesTableColumnVisibility}
                        onColumnVisibilityChange={handleColumnVisibilityChange}
                    />
                </div>
            </div>
            <RowContextMenu
                open={Boolean(passContextMenu)}
                onClose={handleClosePassContextMenu}
                onSuppressNativeContextMenu={handleSuppressNativeContextMenu}
                anchorPosition={
                    passContextMenu
                        ? { top: passContextMenu.mouseY, left: passContextMenu.mouseX }
                        : undefined
                }
                title={passContextMenu?.row?.name || `NORAD ${passContextMenu?.row?.norad_id ?? '-'}`}
                noradId={passContextMenu?.row?.norad_id}
                items={passContextMenuItems}
            />
            <PassesTableSettingsDialog
                open={openPassesTableSettingsDialog}
                onClose={handleCloseSettings}
            />
            {rotatorSelectionDialog}
            <SatelliteEditDialog
                open={satelliteEditDialogOpen}
                onClose={() => setSatelliteEditDialogOpen(false)}
                satelliteData={contextSatelliteForDialogs}
                onSaved={handlePassSatelliteSaved}
            />
            <TransmittersDialog
                open={transmittersDialogOpen}
                onClose={() => setTransmittersDialogOpen(false)}
                title={t('satellites_table.context_menu.edit_transmitters_title', {
                    name: contextSatelliteForDialogs?.name || contextSatelliteForDialogs?.norad_id || '',
                })}
                satelliteData={contextSatelliteForDialogs}
                variant="paper"
                widthOffsetPx={20}
            />
        </>
    );
});

export default NextPassesGroupIsland;
