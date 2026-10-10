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
import {
    getClassNamesBasedOnGridEditing,
    getTimeFromISO,
    humanizeFutureDateInMinutes,
    islandTitleBarCompactSx,
    TitleBar,
} from "../common/common.jsx";
import {DataGrid, gridClasses, useGridApiRef} from "@mui/x-data-grid";
import { useDispatch, useSelector } from 'react-redux';
import {alpha, darken, lighten, styled} from "@mui/material/styles";
import {Box, Typography, IconButton, Tooltip, Button, Chip, useMediaQuery, useTheme} from '@mui/material';
import ProgressFormatter from "../earthview/progressbar-widget.jsx";
import RowContextMenu from "../earthview/rowcontextmenu.jsx";
import { useTranslation } from 'react-i18next';
import { enUS, elGR } from '@mui/x-data-grid/locales';
import RefreshIcon from '@mui/icons-material/Refresh';
import SettingsIcon from '@mui/icons-material/Settings';
import RadioButtonCheckedIcon from '@mui/icons-material/RadioButtonChecked';
import AccessTimeFilledIcon from '@mui/icons-material/AccessTimeFilled';
import DoneAllIcon from '@mui/icons-material/DoneAll';
import ArrowUpwardRoundedIcon from '@mui/icons-material/ArrowUpwardRounded';
import AutoModeIcon from '@mui/icons-material/AutoMode';
import {
    fetchNextPasses,
    fetchSatellite,
    updateSatellitePassesWithElevationCurves,
    setPassesTableColumnVisibility,
    setPassesTablePageSize,
    setPassesTableSortModel,
    setOpenPassesTableSettingsDialog
} from './target-slice.jsx';
import {calculateElevationCurvesForPasses} from '../../utils/elevation-curve-calculator.js';
import TargetPassesTableSettingsDialog from './target-passes-table-settings-dialog.jsx';
import { useUserTimeSettings } from '../../hooks/useUserTimeSettings.jsx';
import CelestialPasses from '../celestial/celestial-passes.jsx';
import { fetchTargetCelestialScene } from '../celestial/celestial-slice.jsx';
import {
    buildTargetCelestialPayload,
    buildTargetKeyFromTrackingState,
    buildTargetSceneRequestKey,
    filterPassesForTargetWindow,
    normalizeTargetType,
    resolveTargetDisplayName,
} from './celestial-target-utils.js';
import {isPassScheduledForAutomaticObservation} from '../common/passobservationutils.js';
import SatelliteEditDialog from '../satellites/satellite-edit-dialog.jsx';
import TransmittersDialog from '../satellites/transmitters-dialog.jsx';
import {
    setDialogOpen,
    setMonitoredSatelliteDialogOpen,
    setSelectedMonitoredSatellite,
    setSelectedObservation,
} from '../scheduler/scheduler-slice.jsx';
import { useSatelliteTargetAction } from './use-satellite-target-action.jsx';

const getPassStatus = (row, now = new Date()) => {
    const startDate = new Date(row?.event_start);
    const endDate = new Date(row?.event_end);
    if (startDate <= now && endDate >= now) return 'live';
    if (endDate < now) return 'passed';
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
        default:
            return 3;
    }
};

const getPassCurveKey = (pass) => {
    const explicitId = String(pass?.id || '').trim();
    if (explicitId) {
        return explicitId;
    }
    const noradId = String(pass?.norad_id ?? '').trim();
    const start = String(pass?.event_start ?? '').trim();
    const end = String(pass?.event_end ?? '').trim();
    return `${noradId}|${start}|${end}`;
};

const getPassBackgroundColor = (color, theme, coefficient) => ({
    backgroundColor: darken(color, coefficient),
    ...theme.applyStyles('light', {
        backgroundColor: lighten(color, coefficient),
    }),
});

const StyledDataGrid = styled(DataGrid)(({ theme }) => ({
    '& .MuiDataGrid-row': {
        borderLeft: '3px solid transparent',
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
    '& .passes-row-upcoming': {
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
    '& .passes-cell-warning': {
        color: theme.palette.error.main,
        textDecoration: 'line-through',
    },
    '& .passes-cell-success': {
        color: theme.palette.success.main,
        fontWeight: 'bold',
        textDecoration: 'underline',
    },
    '& .passes-cell-tags': {
        alignItems: 'center',
    },
    '& .passes-cell-status': {
        alignItems: 'center',
    }
}));


const TimeFormatter = React.memo(function TimeFormatter({ value, nowMs }) {
    const { timezone, locale } = useUserTimeSettings();
    const relativeTime = useMemo(() => humanizeFutureDateInMinutes(value), [value, nowMs]);

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
        return `${minutes}:${seconds.toString().padStart(2, '0')}`;

    } else if(endDate < now) {
        // Pass ended
        const diffInSeconds = Math.floor((endDate - startDate) / 1000);
        const minutes = Math.floor(diffInSeconds / 60);
        const seconds = diffInSeconds % 60;
        return `${minutes}:${seconds.toString().padStart(2, '0')}`;

    } else if (startDate < now && now < endDate) {
        // Passing now
        const diffInSeconds = Math.floor((endDate - now) / 1000);
        const minutes = Math.floor(diffInSeconds / 60);
        const seconds = diffInSeconds % 60;
        return `${minutes}:${seconds.toString().padStart(2, '0')}`;

    } else {
        return `no value`;
    }
});

const PassStatusCell = React.memo(function PassStatusCell({status, isScheduledForAutomaticObservation}) {
    const { t } = useTranslation('earthview');
    const { t: targetT } = useTranslation('target');
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
    };
    const config = statusConfig[status] || statusConfig.upcoming;
    return (
        <Box sx={{display: 'inline-flex', alignItems: 'center', gap: 0.5}}>
            <Chip
                icon={config.icon}
                size="small"
                label={config.label}
                color={config.color}
                variant={status === 'upcoming' ? 'outlined' : 'filled'}
                sx={{fontWeight: 700, minWidth: 85}}
            />
            {isScheduledForAutomaticObservation && (
                <Tooltip title={targetT('next_passes.automatic_observation_tooltip')}>
                    <Box
                        component="span"
                        aria-label={targetT('next_passes.automatic_observation_tooltip')}
                        sx={{display: 'inline-flex', alignItems: 'center', lineHeight: 0}}
                    >
                        <AutoModeIcon sx={{fontSize: '1rem', color: 'text.secondary'}}/>
                    </Box>
                </Tooltip>
            )}
        </Box>
    );
});

const getPassTagLabel = (tag, t) => {
    const labels = {
        north_crossing: t('next_passes.pass_tag_labels.north_crossing', { defaultValue: 'North crossing' }),
        south_crossing: t('next_passes.pass_tag_labels.south_crossing', { defaultValue: 'South crossing' }),
        direction_cw: t('next_passes.pass_tag_labels.direction_cw', { defaultValue: 'CW' }),
        direction_ccw: t('next_passes.pass_tag_labels.direction_ccw', { defaultValue: 'CCW' }),
        direction_mixed: t('next_passes.pass_tag_labels.direction_mixed', { defaultValue: 'Mixed' }),
        direction_e_to_w: t('next_passes.pass_tag_labels.direction_e_to_w', { defaultValue: 'E>W' }),
        direction_w_to_e: t('next_passes.pass_tag_labels.direction_w_to_e', { defaultValue: 'W>E' }),
        elevation_low: t('next_passes.pass_tag_labels.elevation_low', { defaultValue: 'Low EL' }),
        elevation_medium: t('next_passes.pass_tag_labels.elevation_medium', { defaultValue: 'Medium EL' }),
        elevation_high: t('next_passes.pass_tag_labels.elevation_high', { defaultValue: 'High EL' }),
        elevation_overhead: t('next_passes.pass_tag_labels.elevation_overhead', { defaultValue: 'Overhead' }),
    };
    return labels[tag] || tag;
};

const getPassTagTooltip = (tag, t) => t(`next_passes.pass_tag_tooltips.${tag}`, {
    defaultValue: {
        north_crossing: 'The pass crosses north (0° azimuth).',
        south_crossing: 'The pass crosses south (180° azimuth).',
        direction_cw: 'The satellite moves clockwise across the sky.',
        direction_ccw: 'The satellite moves counterclockwise across the sky.',
        direction_mixed: 'The satellite changes direction during the pass.',
        direction_e_to_w: 'The satellite travels from east to west.',
        direction_w_to_e: 'The satellite travels from west to east.',
        elevation_low: 'Maximum elevation is below 30°.',
        elevation_medium: 'Maximum elevation is from 30° to below 60°.',
        elevation_high: 'Maximum elevation is from 60° to below 80°.',
        elevation_overhead: 'Maximum elevation is 80° or higher.',
    }[tag] || tag,
});

// Keep pass-type colors consistent with the Earth View passes table.
const getPassTagColor = (tag) => ({
    north_crossing: '#1971C2',
    south_crossing: '#C2255C',
    direction_cw: '#5F3DC4',
    direction_ccw: '#0B7285',
    direction_mixed: '#E67700',
    direction_e_to_w: '#1C7ED6',
    direction_w_to_e: '#2B8A3E',
    elevation_low: '#C92A2A',
    elevation_medium: '#E67700',
    elevation_high: '#2B8A3E',
    elevation_overhead: '#5F3DC4',
}[tag] || '#495057');

const PassTypesCell = React.memo(function PassTypesCell({tags, t}) {
    const tagList = Array.isArray(tags)
        ? tags.filter(Boolean).filter((tag) => tag !== 'elevation_medium')
        : [];
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
                width: '100%',
                height: '100%',
                alignItems: 'center',
                justifyContent: 'center',
            }}
        >
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
                {tagList.map((tag) => (
                    <Tooltip key={tag} title={getPassTagTooltip(tag, t)}>
                        <Chip
                            label={getPassTagLabel(tag, t)}
                            size="small"
                            variant="filled"
                            sx={{
                                fontSize: '0.64rem',
                                height: 20,
                                flexShrink: 0,
                                fontWeight: 700,
                                backgroundColor: getPassTagColor(tag),
                                color: 'common.white',
                                border: '1px solid',
                                borderColor: getPassTagColor(tag),
                                '& .MuiChip-label': {px: 0.7},
                            }}
                        />
                    </Tooltip>
                ))}
            </Box>
        </Box>
    );
});


const MemoizedStyledDataGrid = React.memo(function MemoizedStyledDataGrid({
    satellitePasses,
    passesLoading,
    columnVisibility,
    onColumnVisibilityChange,
    pageSize = 15,
    onPageSizeChange,
    sortModel,
    onSortModelChange,
    scheduledObservations,
    satelliteId,
    onRowContextMenu,
}) {
    const apiRef = useGridApiRef();
    const { t, i18n } = useTranslation('target');
    const theme = useTheme();
    const isCompactView = useMediaQuery(theme.breakpoints.down('md'));
    const currentLanguage = i18n.language;
    const dataGridLocale = currentLanguage === 'el' ? elGR : enUS;
    const [page, setPage] = useState(0);
    const [nowMs, setNowMs] = useState(() => Date.now());
    const nowMsRef = useRef(nowMs);
    nowMsRef.current = nowMs;
    const automaticallyObservedPassKeys = useMemo(() => new Set(
        satellitePasses
            .filter((pass) => isPassScheduledForAutomaticObservation(pass, scheduledObservations, satelliteId))
            .map(getPassCurveKey),
    ), [satelliteId, satellitePasses, scheduledObservations]);

    useEffect(() => {
        const intervalId = setInterval(() => {
            setNowMs(Date.now());
        }, 1000);

        return () => clearInterval(intervalId);
    }, []);


    const columns = [
        {
            field: 'status',
            minWidth: 110,
            headerName: 'Status',
            align: 'center',
            headerAlign: 'center',
            flex: 1,
            cellClassName: 'passes-cell-status',
            valueGetter: (_value, row) => getPassStatus(row, new Date(nowMsRef.current)),
            sortComparator: (v1, v2) => getPassStatusPriority(v1) - getPassStatusPriority(v2),
            renderCell: (params) => (
                <Box
                    sx={{
                        width: '100%',
                        height: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                    }}
                >
                    <PassStatusCell
                        status={params.value}
                        isScheduledForAutomaticObservation={automaticallyObservedPassKeys.has(getPassCurveKey(params.row))}
                    />
                </Box>
            )
        },
        {
            field: 'event_start',
            minWidth: 160,
            headerName: t('next_passes.start'),
            flex: 1,
            renderCell: (params) => <TimeFormatter value={params.value} nowMs={nowMs} />
        },
        {
            field: 'pass_tags',
            minWidth: 170,
            headerName: t('next_passes.pass_types', { defaultValue: 'Pass Types' }),
            flex: 1.5,
            sortable: false,
            cellClassName: 'passes-cell-tags',
            renderCell: (params) => <PassTypesCell tags={params.value} t={t} />,
        },
        {
            field: 'event_end',
            minWidth: 160,
            headerName: t('next_passes.end'),
            flex: 1,
            renderCell: (params) => <TimeFormatter value={params.value} nowMs={nowMs} />
        },
        {
            field: 'duration',
            minWidth: 100,
            headerName: t('next_passes.duration'),
            align: 'center',
            headerAlign: 'center',
            flex: 1,
            sortable: false,
            renderCell: (params) => (
                <div>
                    <DurationFormatter params={params} event_start={params.row.event_start} event_end={params.row.event_end} nowMs={nowMs}/>
                </div>
            ),
        },
        {
            field: 'progress',
            minWidth: 120,
            headerName: t('next_passes.progress'),
            align: 'center',
            headerAlign: 'center',
            flex: 1.5,
            renderCell: (params) => <ProgressFormatter params={params} />
        },
        {
            field: 'distance_at_start',
            minWidth: 100,
            headerName: t('next_passes.distance_aos'),
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
            headerName: t('next_passes.distance_los'),
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
            headerName: t('next_passes.distance_peak'),
            align: 'center',
            headerAlign: 'center',
            flex: 1,
            valueFormatter: (value) => {
                return `${parseFloat(value).toFixed(2)} km`
            }
        },
        {
            field: 'peak_altitude',
            minWidth: 100,
            headerName: t('next_passes.max_el'),
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
                }
            }
        },
        {
            field: 'is_geostationary',
            minWidth: 70,
            headerName: t('next_passes.geo_stat'),
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
            headerName: t('next_passes.geo_sync'),
            align: 'center',
            headerAlign: 'center',
            flex: 1,
            valueFormatter: (value) => {
                return value ? 'Yes' : 'No';
            },
            hide: true,
        },
    ];

    const effectiveColumnVisibility = useMemo(() => {
        const base = {
            status: true,
            ...columnVisibility,
        };
        if (!isCompactView) return base;
        return {
            ...base,
            pass_tags: false,
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
            const status = getPassStatus(param.row, now);
            if (status === 'dead') return 'passes-row-dead pointer-cursor';
            if (status === 'passed') return 'passes-row-passed pointer-cursor';
            if (status === 'live') return 'passes-row-live pointer-cursor';
            if (status === 'upcoming') {
                return 'passes-row-upcoming pointer-cursor';
            }
            return "pointer-cursor";
        }
        return "pointer-cursor";
    }, []);

    // Attach the native context-menu event to DataGrid rows so right-clicking
    // works consistently in every browser supported by the Earth View table.
    const handleRowContextMenu = useCallback((event) => {
        if (typeof onRowContextMenu !== 'function') {
            return;
        }

        const rowId = event.currentTarget?.getAttribute?.('data-id');
        if (rowId == null) return;
        const row = apiRef.current?.getRow?.(rowId);
        if (!row) return;

        if (typeof apiRef.current?.selectRow === 'function') {
            apiRef.current.selectRow(row.id, true, true);
        } else if (typeof apiRef.current?.setRowSelectionModel === 'function') {
            apiRef.current.setRowSelectionModel({ type: 'include', ids: new Set([row.id]) });
        }

        onRowContextMenu({ id: rowId, row }, event);
    }, [apiRef, onRowContextMenu]);

    return (
        <StyledDataGrid
            apiRef={apiRef}
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
            localeText={{
                ...dataGridLocale.components.MuiDataGrid.defaultProps.localeText,
                noRowsLabel: t('next_passes.no_satellite_selected')
            }}
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
            }}
            getRowClassName={getPassesRowStyles}
            density={"compact"}
            rows={satellitePasses}
            pageSizeOptions={[5, 10, 15, 20]}
            columnVisibilityModel={effectiveColumnVisibility}
            onColumnVisibilityModelChange={onColumnVisibilityChange}
            sortModel={sortModel}
            onSortModelChange={onSortModelChange}
            paginationModel={{
                pageSize: pageSize,
                page: page,
            }}
            onPaginationModelChange={(model) => {
                setPage(model.page);
                if (onPageSizeChange && model.pageSize !== pageSize) {
                    onPageSizeChange(model.pageSize);
                }
            }}
            columns={columns}
            pinnedColumns={isCompactView ? { left: ['event_start'], right: ['progress'] } : { left: ['status', 'event_start'], right: ['progress'] }}
            disableRowSelectionOnClick
        />
    );
}, (prevProps, nextProps) => {
    return (
        prevProps.satellitePasses === nextProps.satellitePasses &&
        prevProps.passesLoading === nextProps.passesLoading &&
        prevProps.columnVisibility === nextProps.columnVisibility &&
        prevProps.pageSize === nextProps.pageSize &&
        prevProps.sortModel === nextProps.sortModel &&
        prevProps.scheduledObservations === nextProps.scheduledObservations &&
        prevProps.satelliteId === nextProps.satelliteId &&
        prevProps.onRowContextMenu === nextProps.onRowContextMenu
    );
});


const NextPassesIsland = React.memo(function NextPassesIsland() {
    const {socket} = useSocket();
    const dispatch = useDispatch();
    const { t } = useTranslation('target');
    const { t: earthViewT } = useTranslation('earthview');
    const theme = useTheme();
    const isCompactHeader = useMediaQuery(theme.breakpoints.down('lg'));
    const isTightHeader = useMediaQuery(theme.breakpoints.down('md'));
    const trackerInstances = useSelector((state) => state.trackerInstances?.instances || []);
    const scheduledObservations = useSelector((state) => state.scheduler?.observations || []);
    const trackingState = useSelector((state) => state.targetSatTrack?.trackingState || {});
    const satelliteDetails = useSelector((state) => state.targetSatTrack?.satelliteData?.details || {});
    const monitoredRows = useSelector((state) => state.celestialMonitored?.monitored || []);
    const [containerHeight, setContainerHeight] = useState(0);
    const containerRef = useRef(null);
    const {
        passesLoading,
        satellitePasses,
        satelliteData,
        nextPassesHours,
        satelliteId,
        gridEditable,
        passesTableColumnVisibility,
        passesTablePageSize,
        passesTableSortModel,
        openPassesTableSettingsDialog
    } = useSelector(state => state.targetSatTrack);
    const hasTargets = trackerInstances.length > 0;
    const { location } = useSelector(state => state.location);
    const targetType = normalizeTargetType(trackingState);
    const isSatelliteTarget = targetType === 'satellite';
    const targetKey = useMemo(
        () => buildTargetKeyFromTrackingState(trackingState),
        [trackingState],
    );
    const nonSatelliteSceneRequestKey = useMemo(
        () => buildTargetSceneRequestKey({ trackingState, nextPassesHours }),
        [nextPassesHours, trackingState],
    );
    const targetScene = useSelector((state) => (
        state.celestial?.targetScenesByKey?.[nonSatelliteSceneRequestKey] || null
    ));
    const nonSatelliteTargetName = useMemo(() => {
        return resolveTargetDisplayName({
            trackingState,
            satelliteDetails,
            monitoredRows,
            celestialRows: targetScene?.celestialTracks?.celestial || [],
        });
    }, [monitoredRows, satelliteDetails, targetScene?.celestialTracks?.celestial, trackingState]);
    const minHeight = 200;
    const maxHeight = 400;
    const hasLoadedFromStorageRef = useRef(false);
    const isLoadingRef = useRef(false);
    const curveCalcInFlightRef = useRef(false);
    const curveCalcTimeoutRef = useRef(null);
    const attemptedCurvePassKeysRef = useRef(new Set());
    const [quickFilterPreset, setQuickFilterPreset] = useState('all');
    const [filterNowMs, setFilterNowMs] = useState(() => Date.now());
    // Store the pass and pointer position together so actions always target the
    // row that opened the menu, even while live pass data continues updating.
    const [passContextMenu, setPassContextMenu] = useState(null);
    const [satelliteEditDialogOpen, setSatelliteEditDialogOpen] = useState(false);
    const [transmittersDialogOpen, setTransmittersDialogOpen] = useState(false);
    const [contextSatelliteForDialogs, setContextSatelliteForDialogs] = useState(null);
    const activeSatellite = useMemo(() => {
        const details = satelliteData?.details || {};
        const noradId = details.norad_id ?? satelliteId ?? trackingState?.norad_id ?? null;
        return {
            ...details,
            norad_id: noradId,
            name: details.name || trackingState?.target_name || (noradId != null ? `NORAD ${noradId}` : ''),
            group_id: details.group_id || trackingState?.group_id || '',
            transmitters: satelliteData?.transmitters || [],
        };
    }, [satelliteData?.details, satelliteData?.transmitters, satelliteId, trackingState?.group_id, trackingState?.norad_id, trackingState?.target_name]);
    const {
        setAsTarget,
        dialog: rotatorSelectionDialog,
    } = useSatelliteTargetAction({
        satellite: contextSatelliteForDialogs || activeSatellite,
        groupId: trackingState?.group_id || null,
    });
    const nonSatellitePayload = useMemo(
        () => buildTargetCelestialPayload({
            trackingState,
            targetName: nonSatelliteTargetName,
            nextPassesHours,
        }),
        [nextPassesHours, nonSatelliteTargetName, trackingState],
    );
    const nonSatellitePasses = useMemo(
        () => filterPassesForTargetWindow({
            passes: targetScene?.celestialTracks?.celestial_passes || [],
            targetKey,
            nextPassesHours,
            nowMs: filterNowMs,
        }),
        [filterNowMs, nextPassesHours, targetKey, targetScene?.celestialTracks?.celestial_passes],
    );
    const nonSatelliteTracks = useMemo(() => {
        const rows = Array.isArray(targetScene?.celestialTracks?.celestial)
            ? targetScene.celestialTracks.celestial
            : [];
        if (!targetKey) return [];
        return rows.filter((row) => String(row?.target_key || '').trim() === targetKey);
    }, [targetKey, targetScene?.celestialTracks?.celestial]);

    // Load column visibility from localStorage on mount
    useEffect(() => {
        if (!isSatelliteTarget) return;
        // Prevent double loading (React StrictMode or component remounting)
        if (isLoadingRef.current || hasLoadedFromStorageRef.current) {
            return;
        }

        isLoadingRef.current = true;

        const loadColumnVisibility = () => {
            try {
                const stored = localStorage.getItem('target-passes-table-column-visibility');
                if (stored) {
                    const parsedVisibility = JSON.parse(stored);
                    if (parsedVisibility && typeof parsedVisibility === 'object' && !Array.isArray(parsedVisibility)) {
                        // Remove the retired column from existing browser preferences.
                        delete parsedVisibility.transmitter_links;
                        dispatch(setPassesTableColumnVisibility(parsedVisibility));
                    }
                }
            } catch (e) {
                console.error('Failed to load target passes table column visibility:', e);
            } finally {
                hasLoadedFromStorageRef.current = true;
                isLoadingRef.current = false;
            }
        };
        loadColumnVisibility();
    }, [dispatch, isSatelliteTarget]);

    // Persist column visibility to localStorage whenever it changes (but not on initial load)
    useEffect(() => {
        if (!isSatelliteTarget) return;
        if (passesTableColumnVisibility && hasLoadedFromStorageRef.current) {
            try {
                localStorage.setItem('target-passes-table-column-visibility', JSON.stringify(passesTableColumnVisibility));
            } catch (e) {
                console.error('Failed to save target passes table column visibility:', e);
            }
        }
    }, [passesTableColumnVisibility, isSatelliteTarget]);

    useEffect(() => {
        const intervalId = setInterval(() => {
            setFilterNowMs(Date.now());
        }, 1000);
        return () => clearInterval(intervalId);
    }, []);

    useEffect(() => {
        attemptedCurvePassKeysRef.current.clear();
        curveCalcInFlightRef.current = false;
        if (curveCalcTimeoutRef.current != null) {
            clearTimeout(curveCalcTimeoutRef.current);
            curveCalcTimeoutRef.current = null;
        }
    }, [satelliteId, isSatelliteTarget]);

    const handleRefreshPasses = () => {
        if (isSatelliteTarget && satelliteId) {
            dispatch(fetchNextPasses({
                socket,
                noradId: satelliteId,
                hours: nextPassesHours,
                forceRecalculate: true
            }));
            return;
        }
        if (!isSatelliteTarget && nonSatellitePayload) {
            dispatch(fetchTargetCelestialScene({
                socket,
                payload: nonSatellitePayload,
                requestKey: nonSatelliteSceneRequestKey,
            }));
        }
    };

    // Keep client-side curve calculation as a guarded fallback.
    // Backend now provides curves, but this protects against empty legacy payloads.
    useEffect(() => {
        if (!isSatelliteTarget) {
            return undefined;
        }
        if (curveCalcInFlightRef.current) {
            return undefined;
        }
        const isLocationValid = location && location.lat != null && location.lon != null;
        if (!isLocationValid) {
            return undefined;
        }
        if (!satelliteData?.details?.norad_id || !satelliteData?.details?.tle1 || !satelliteData?.details?.tle2) {
            return undefined;
        }
        if (!Array.isArray(satellitePasses) || satellitePasses.length === 0) {
            return undefined;
        }

        const pendingPasses = satellitePasses.filter((pass) => {
            const existingCurve = pass?.elevation_curve;
            if (Array.isArray(existingCurve) && existingCurve.length > 0) {
                return false;
            }
            const curveKey = getPassCurveKey(pass);
            if (!curveKey) {
                return false;
            }
            return !attemptedCurvePassKeysRef.current.has(curveKey);
        });

        if (pendingPasses.length === 0) {
            return undefined;
        }

        const pendingPassKeys = pendingPasses.map((pass) => getPassCurveKey(pass)).filter(Boolean);
        const satelliteLookup = {
            [satelliteData.details.norad_id]: {
                norad_id: satelliteData.details.norad_id,
                tle1: satelliteData.details.tle1,
                tle2: satelliteData.details.tle2,
            },
        };
        let cancelled = false;

        curveCalcTimeoutRef.current = setTimeout(() => {
            curveCalcTimeoutRef.current = null;
            if (cancelled || curveCalcInFlightRef.current) {
                return;
            }
            curveCalcInFlightRef.current = true;
            for (const curveKey of pendingPassKeys) {
                attemptedCurvePassKeysRef.current.add(curveKey);
            }

            try {
                const recalculatedPendingPasses = calculateElevationCurvesForPasses(
                    pendingPasses,
                    { lat: location.lat, lon: location.lon },
                    satelliteLookup
                );
                const updatedCurvesByPassKey = new Map();
                for (const pass of recalculatedPendingPasses) {
                    const curveKey = getPassCurveKey(pass);
                    const nextCurve = pass?.elevation_curve;
                    if (!curveKey || !Array.isArray(nextCurve) || nextCurve.length === 0) {
                        continue;
                    }
                    updatedCurvesByPassKey.set(curveKey, nextCurve);
                }
                if (updatedCurvesByPassKey.size === 0 || cancelled) {
                    return;
                }

                let hasUpdates = false;
                const mergedPasses = satellitePasses.map((pass) => {
                    const curveKey = getPassCurveKey(pass);
                    const nextCurve = updatedCurvesByPassKey.get(curveKey);
                    if (!nextCurve) {
                        return pass;
                    }
                    const existingCurve = Array.isArray(pass?.elevation_curve) ? pass.elevation_curve : [];
                    if (existingCurve.length === nextCurve.length && existingCurve.length > 0) {
                        return pass;
                    }
                    hasUpdates = true;
                    return {
                        ...pass,
                        elevation_curve: nextCurve,
                    };
                });

                if (hasUpdates && !cancelled) {
                    dispatch(updateSatellitePassesWithElevationCurves(mergedPasses));
                }
            } finally {
                curveCalcInFlightRef.current = false;
            }
        }, 0);

        return () => {
            cancelled = true;
            if (curveCalcTimeoutRef.current != null) {
                clearTimeout(curveCalcTimeoutRef.current);
                curveCalcTimeoutRef.current = null;
            }
        };
    }, [
        dispatch,
        isSatelliteTarget,
        location?.lat,
        location?.lon,
        satelliteData?.details?.norad_id,
        satelliteData?.details?.tle1,
        satelliteData?.details?.tle2,
        satellitePasses,
    ]);

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

    const handleColumnVisibilityChange = (newModel) => {
        dispatch(setPassesTableColumnVisibility(newModel));
    };

    const handlePageSizeChange = (newPageSize) => {
        dispatch(setPassesTablePageSize(newPageSize));
    };

    const handleSortModelChange = useCallback((newSortModel) => {
        dispatch(setPassesTableSortModel(newSortModel));
    }, [dispatch]);

    const handleOpenSettings = () => {
        dispatch(setOpenPassesTableSettingsDialog(true));
    };

    const handleCloseSettings = () => {
        dispatch(setOpenPassesTableSettingsDialog(false));
    };

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

        // Target-page pass rows do not always repeat satellite metadata. Merge
        // the active satellite into the clicked pass before exposing actions.
        const contextRow = {
            ...params.row,
            ...activeSatellite,
            event_start: params.row.event_start,
            event_end: params.row.event_end,
            peak_altitude: params.row.peak_altitude,
        };
        setContextSatelliteForDialogs(contextRow);
        setPassContextMenu({
            mouseX: event.clientX + 2,
            mouseY: event.clientY - 6,
            row: contextRow,
        });
    }, [activeSatellite]);

    const buildSchedulerSatellitePayload = useCallback((row) => ({
        norad_id: row?.norad_id ?? '',
        name: row?.name || `NORAD ${row?.norad_id ?? ''}`,
        group_id: row?.group_id || trackingState?.group_id || '',
    }), [trackingState?.group_id]);

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

    const handleSatelliteSaved = useCallback(() => {
        const noradId = contextSatelliteForDialogs?.norad_id;
        if (noradId == null || !socket) {
            return;
        }
        dispatch(fetchSatellite({ socket, noradId }));
    }, [contextSatelliteForDialogs?.norad_id, dispatch, socket]);

    const handlePassMenuAction = useCallback(async (action) => {
        const row = passContextMenu?.row;
        if (!row) {
            return;
        }

        try {
            if (action === 'set-target') {
                await setAsTarget();
                return;
            }
            if (action === 'edit-properties') {
                setSatelliteEditDialogOpen(true);
                return;
            }
            if (action === 'edit-transmitters') {
                setTransmittersDialogOpen(true);
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
            }
        } catch (error) {
            toast.error(`Failed to process menu action: ${error?.message || 'Unknown error'}`);
        } finally {
            setPassContextMenu(null);
        }
    }, [
        copyTextToClipboard,
        handleMonitorSatellite,
        handleScheduleObservation,
        passContextMenu,
        setAsTarget,
    ]);

    const passContextMenuItems = useMemo(() => ([
        { key: 'set-target', label: earthViewT('satellites_table.context_menu.set_as_target'), opensDialog: true, onClick: () => handlePassMenuAction('set-target') },
        { key: 'edit-properties', label: earthViewT('satellites_table.context_menu.edit_properties'), opensDialog: true, onClick: () => handlePassMenuAction('edit-properties') },
        { key: 'edit-transmitters', label: earthViewT('satellites_table.context_menu.edit_transmitters'), opensDialog: true, onClick: () => handlePassMenuAction('edit-transmitters') },
        { key: 'schedule-observation', label: earthViewT('satellites_table.context_menu.schedule_observation'), opensDialog: true, onClick: () => handlePassMenuAction('schedule-observation') },
        { key: 'monitor-satellite', label: earthViewT('satellites_table.context_menu.monitor_satellite'), opensDialog: true, onClick: () => handlePassMenuAction('monitor-satellite') },
        { type: 'divider', key: 'divider-copy' },
        { key: 'copy-norad', label: earthViewT('satellites_table.context_menu.copy_norad'), onClick: () => handlePassMenuAction('copy-norad') },
        { key: 'copy-window', label: earthViewT('passes_table.context_menu.copy_pass_window'), onClick: () => handlePassMenuAction('copy-window') },
        { key: 'copy-summary', label: earthViewT('passes_table.context_menu.copy_pass_summary'), onClick: () => handlePassMenuAction('copy-summary') },
    ]), [earthViewT, handlePassMenuAction]);

    const applyDefaultSort = useCallback(() => {
        dispatch(setPassesTableSortModel([
            { field: 'status', sort: 'asc' },
            { field: 'event_start', sort: 'asc' },
        ]));
    }, [dispatch]);

    const filteredPasses = useMemo(() => {
        const now = new Date(filterNowMs);
        if (quickFilterPreset === 'live') {
            return satellitePasses.filter((pass) => getPassStatus(pass, now) === 'live');
        }
        if (quickFilterPreset === 'next30') {
            return satellitePasses.filter((pass) => {
                const status = getPassStatus(pass, now);
                if (status === 'live') return true;
                if (status !== 'upcoming') return false;
                return (new Date(pass.event_start) - now) <= 30 * 60 * 1000;
            });
        }
        return satellitePasses;
    }, [satellitePasses, quickFilterPreset, filterNowMs]);

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

    useEffect(() => {
        if (!isSatelliteTarget) return undefined;
        const handleKeyboardShortcuts = (event) => {
            if (!event.altKey) return;
            if (event.key === '1') handleQuickPreset('all');
            else if (event.key === '2') handleQuickPreset('live');
            else if (event.key === '3') handleQuickPreset('next30');
            else if (event.key === '4') handleQuickPreset('highEl');
            else return;
            event.preventDefault();
        };
        window.addEventListener('keydown', handleKeyboardShortcuts);
        return () => window.removeEventListener('keydown', handleKeyboardShortcuts);
    }, [handleQuickPreset, isSatelliteTarget]);

    const useIconQuickFilters = isCompactHeader;
    const quickFilterButtonSx = useMemo(() => ({
        minHeight: isTightHeader ? 20 : (isCompactHeader ? 22 : 24),
        height: isTightHeader ? 20 : (isCompactHeader ? 22 : 24),
        py: 0,
        px: isTightHeader ? 0.7 : (isCompactHeader ? 0.85 : 1),
        lineHeight: 1.05,
        fontSize: isTightHeader ? '0.64rem' : (isCompactHeader ? '0.68rem' : '0.72rem'),
        minWidth: useIconQuickFilters ? 30 : 'auto',
    }), [isCompactHeader, isTightHeader, useIconQuickFilters]);
    const titleIconButtonSx = useMemo(
        () => ({ padding: isTightHeader ? '1px' : '2px' }),
        [isTightHeader]
    );

    if (!isSatelliteTarget) {
        return (
            <CelestialPasses
                passes={nonSatellitePasses}
                tracks={nonSatelliteTracks}
                monitoredRows={monitoredRows}
                loading={Boolean(targetScene?.loading)}
                gridEditable={gridEditable}
                onRefresh={handleRefreshPasses}
                refreshDisabled={!socket || !nonSatellitePayload || Boolean(targetScene?.loading)}
            />
        );
    }

    return (
        <>
            <TitleBar
                className={getClassNamesBasedOnGridEditing(gridEditable, ["window-title-bar"])}
                sx={islandTitleBarCompactSx}
            >
                <Box sx={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', height: '100%'}}>
                    <Box sx={{display: 'flex', alignItems: 'center', flex: 1, minWidth: 0, pr: 1}}>
                        <Typography
                            variant="subtitle2"
                            sx={{
                                fontWeight: 'bold',
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                            }}
                        >
                            {hasTargets
                                ? t('next_passes.title', { name: satelliteData['details']['name'], hours: nextPassesHours })
                                : 'Next Passes'}
                        </Typography>
                    </Box>
                    {hasTargets && (
                    <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
                        <Tooltip title={t('next_passes.all_passes_alt_1', { defaultValue: 'All passes (Alt+1)' })}>
                            <span>
                                <Button
                                    size="small"
                                    variant={quickFilterPreset === 'all' ? 'contained' : 'outlined'}
                                    onClick={() => handleQuickPreset('all')}
                                    sx={quickFilterButtonSx}
                                    aria-label={t('next_passes.all_passes', { defaultValue: 'All passes' })}
                                >
                                    {useIconQuickFilters ? <DoneAllIcon sx={{ fontSize: isTightHeader ? '0.82rem' : '0.9rem' }} /> : 'All'}
                                </Button>
                            </span>
                        </Tooltip>
                        <Tooltip title={t('next_passes.live_passes_alt_2', { defaultValue: 'Live passes (Alt+2)' })}>
                            <span>
                                <Button
                                    size="small"
                                    variant={quickFilterPreset === 'live' ? 'contained' : 'outlined'}
                                    onClick={() => handleQuickPreset('live')}
                                    sx={quickFilterButtonSx}
                                    aria-label={t('next_passes.live_passes', { defaultValue: 'Live passes' })}
                                >
                                    {useIconQuickFilters ? <RadioButtonCheckedIcon sx={{ fontSize: isTightHeader ? '0.82rem' : '0.9rem' }} /> : 'Live'}
                                </Button>
                            </span>
                        </Tooltip>
                        <Tooltip title={t('next_passes.live_or_next_30_minutes_alt_3', { defaultValue: 'Live or next 30 minutes (Alt+3)' })}>
                            <span>
                                <Button
                                    size="small"
                                    variant={quickFilterPreset === 'next30' ? 'contained' : 'outlined'}
                                    onClick={() => handleQuickPreset('next30')}
                                    sx={quickFilterButtonSx}
                                    aria-label={t('next_passes.next_30_minutes', { defaultValue: 'Next 30 minutes' })}
                                >
                                    {useIconQuickFilters ? <AccessTimeFilledIcon sx={{ fontSize: isTightHeader ? '0.82rem' : '0.9rem' }} /> : 'Next 30m'}
                                </Button>
                            </span>
                        </Tooltip>
                        <Tooltip title={t('next_passes.highest_elevation_first_alt_4', { defaultValue: 'Highest elevation first (Alt+4)' })}>
                            <span>
                                <Button
                                    size="small"
                                    variant={quickFilterPreset === 'highEl' ? 'contained' : 'outlined'}
                                    onClick={() => handleQuickPreset('highEl')}
                                    sx={quickFilterButtonSx}
                                    aria-label={t('next_passes.highest_elevation_first', { defaultValue: 'Highest elevation first' })}
                                >
                                    {useIconQuickFilters ? <ArrowUpwardRoundedIcon sx={{ fontSize: isTightHeader ? '0.82rem' : '0.9rem' }} /> : 'High El'}
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
                        <Tooltip title={t('next_passes.refresh_passes_force_recalculate', { defaultValue: 'Refresh passes (force recalculate)' })}>
                            <span>
                                <IconButton
                                    size="small"
                                    onClick={handleRefreshPasses}
                                    disabled={passesLoading || !satelliteId}
                                    sx={titleIconButtonSx}
                                >
                                    <RefreshIcon fontSize="small" />
                                </IconButton>
                            </span>
                        </Tooltip>
                    </Box>
                    )}
                </Box>
            </TitleBar>
            <div style={{ position: 'relative', display: 'block', height: '100%' }} ref={containerRef}>
                <div style={{
                    padding:'0rem 0rem 0rem 0rem',
                    display: 'flex',
                    flexDirection: 'column',
                    height: containerHeight - 25,
                    minHeight,
                }}>
                    {!hasTargets && (
                        <Box
                            sx={{
                                flex: 1,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                px: 2,
                            }}
                        >
                            <Box
                                sx={{
                                    width: '100%',
                                    maxWidth: 420,
                                    textAlign: 'center',
                                    p: 2.5,
                                    borderRadius: 1.25,
                                    border: '1px dashed',
                                    borderColor: 'border.main',
                                    backgroundColor: 'overlay.light',
                                }}
                            >
                                <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                                    {t('next_passes.no_targets_configured', { defaultValue: 'No targets configured' })}
                                </Typography>
                                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                                    {t('next_passes.add_a_target_to_load_upcoming_passes_and_visibility_wind', { defaultValue: 'Add a target to load upcoming passes and visibility windows.' })}
                                </Typography>
                            </Box>
                        </Box>
                    )}
                    {hasTargets && (
                        <MemoizedStyledDataGrid
                            satellitePasses={filteredPasses}
                            passesLoading={passesLoading}
                            columnVisibility={passesTableColumnVisibility}
                            onColumnVisibilityChange={handleColumnVisibilityChange}
                            pageSize={passesTablePageSize}
                            onPageSizeChange={handlePageSizeChange}
                            sortModel={passesTableSortModel}
                            onSortModelChange={handleSortModelChange}
                            scheduledObservations={scheduledObservations}
                            satelliteId={satelliteId}
                            onRowContextMenu={handlePassRowContextMenu}
                        />
                    )}
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
            <TargetPassesTableSettingsDialog
                open={openPassesTableSettingsDialog}
                onClose={handleCloseSettings}
            />
            {rotatorSelectionDialog}
            <SatelliteEditDialog
                open={satelliteEditDialogOpen}
                onClose={() => setSatelliteEditDialogOpen(false)}
                satelliteData={contextSatelliteForDialogs}
                onSaved={handleSatelliteSaved}
            />
            <TransmittersDialog
                open={transmittersDialogOpen}
                onClose={() => setTransmittersDialogOpen(false)}
                title={earthViewT('satellites_table.context_menu.edit_transmitters_title', {
                    name: contextSatelliteForDialogs?.name || contextSatelliteForDialogs?.norad_id || '',
                })}
                satelliteData={contextSatelliteForDialogs}
                variant="paper"
                widthOffsetPx={20}
            />
        </>
    );
});

export default NextPassesIsland;
