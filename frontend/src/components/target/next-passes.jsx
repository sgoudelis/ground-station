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
import {
    getClassNamesBasedOnGridEditing,
    getTimeFromISO,
    humanizeFutureDateInMinutes,
    islandTitleBarCompactSx,
    TitleBar
} from "../common/common.jsx";
import {DataGrid, gridClasses, useGridApiRef} from "@mui/x-data-grid";
import { useDispatch, useSelector } from 'react-redux';
import {alpha, darken, lighten, styled} from "@mui/material/styles";
import {Box, Typography, IconButton, Tooltip, Button, Chip, useMediaQuery, useTheme} from '@mui/material';
import ProgressFormatter from "../earthview/progressbar-widget.jsx";
import { useTranslation } from 'react-i18next';
import { enUS, elGR } from '@mui/x-data-grid/locales';
import RefreshIcon from '@mui/icons-material/Refresh';
import SettingsIcon from '@mui/icons-material/Settings';
import RadioButtonCheckedIcon from '@mui/icons-material/RadioButtonChecked';
import AccessTimeFilledIcon from '@mui/icons-material/AccessTimeFilled';
import DoneAllIcon from '@mui/icons-material/DoneAll';
import ArrowUpwardRoundedIcon from '@mui/icons-material/ArrowUpwardRounded';
import {
    fetchNextPasses,
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
import { fetchCelestialTracks, fetchSolarSystemScene } from '../celestial/celestial-slice.jsx';
import {
    buildTargetCelestialPayload,
    buildTargetKeyFromTrackingState,
    filterPassesForTargetWindow,
    normalizeTargetType,
    resolveTargetDisplayName,
} from './celestial-target-utils.js';

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

const PassStatusCell = React.memo(function PassStatusCell({status}) {
    const { t } = useTranslation('earthview');
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
        <Chip
            icon={config.icon}
            size="small"
            label={config.label}
            color={config.color}
            variant={status === 'upcoming' ? 'outlined' : 'filled'}
            sx={{ fontWeight: 700, minWidth: 85 }}
        />
    );
});

const getPassTagLabel = (tag, t) => {
    const labels = {
        north_crossing: t('next_passes.pass_tag_labels.north_crossing', { defaultValue: 'North crossing' }),
        south_crossing: t('next_passes.pass_tag_labels.south_crossing', { defaultValue: 'South crossing' }),
        direction_cw: t('next_passes.pass_tag_labels.direction_cw', { defaultValue: 'CW' }),
        direction_ccw: t('next_passes.pass_tag_labels.direction_ccw', { defaultValue: 'CCW' }),
        direction_mixed: t('next_passes.pass_tag_labels.direction_mixed', { defaultValue: 'Mixed' }),
        elevation_low: t('next_passes.pass_tag_labels.elevation_low', { defaultValue: 'Low elevation' }),
        elevation_medium: t('next_passes.pass_tag_labels.elevation_medium', { defaultValue: 'Medium elevation' }),
        elevation_high: t('next_passes.pass_tag_labels.elevation_high', { defaultValue: 'High elevation' }),
        elevation_overhead: t('next_passes.pass_tag_labels.elevation_overhead', { defaultValue: 'Overhead' }),
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


const MemoizedStyledDataGrid = React.memo(function MemoizedStyledDataGrid({
    satellitePasses,
    passesLoading,
    columnVisibility,
    onColumnVisibilityChange,
    pageSize = 15,
    onPageSizeChange,
    sortModel,
    onSortModelChange
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

    useEffect(() => {
        const intervalId = setInterval(() => {
            setNowMs(Date.now());
        }, 1000);

        return () => clearInterval(intervalId);
    }, []);


    const columns = [
        {
            field: 'status',
            minWidth: 100,
            headerName: 'Status',
            align: 'center',
            headerAlign: 'center',
            flex: 1,
            valueGetter: (_value, row) => getPassStatus(row, new Date(nowMsRef.current)),
            sortComparator: (v1, v2) => getPassStatusPriority(v1) - getPassStatusPriority(v2),
            renderCell: (params) => <PassStatusCell status={params.value} />
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
            minWidth: 220,
            headerName: t('next_passes.pass_types', { defaultValue: 'Pass Types' }),
            flex: 2,
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

    return (
        <StyledDataGrid
            apiRef={apiRef}
            fullWidth={true}
            loading={passesLoading}
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
        prevProps.sortModel === nextProps.sortModel
    );
});


const NextPassesIsland = React.memo(function NextPassesIsland() {
    const {socket} = useSocket();
    const dispatch = useDispatch();
    const { t } = useTranslation('target');
    const theme = useTheme();
    const isCompactHeader = useMediaQuery(theme.breakpoints.down('lg'));
    const isTightHeader = useMediaQuery(theme.breakpoints.down('md'));
    const trackerInstances = useSelector((state) => state.trackerInstances?.instances || []);
    const trackingState = useSelector((state) => state.targetSatTrack?.trackingState || {});
    const satelliteDetails = useSelector((state) => state.targetSatTrack?.satelliteData?.details || {});
    const celestialState = useSelector((state) => state.celestial || {});
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
    const nonSatelliteTargetName = useMemo(() => {
        return resolveTargetDisplayName({
            trackingState,
            satelliteDetails,
            monitoredRows,
            celestialRows: celestialState?.celestialTracks?.celestial || [],
        });
    }, [celestialState?.celestialTracks?.celestial, monitoredRows, satelliteDetails, trackingState]);
    const minHeight = 200;
    const maxHeight = 400;
    const hasLoadedFromStorageRef = useRef(false);
    const isLoadingRef = useRef(false);
    const curveCalcInFlightRef = useRef(false);
    const curveCalcTimeoutRef = useRef(null);
    const attemptedCurvePassKeysRef = useRef(new Set());
    const [quickFilterPreset, setQuickFilterPreset] = useState('all');
    const [filterNowMs, setFilterNowMs] = useState(() => Date.now());
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
            passes: celestialState?.celestialTracks?.celestial_passes || [],
            targetKey,
            nextPassesHours,
            nowMs: filterNowMs,
        }),
        [celestialState?.celestialTracks?.celestial_passes, filterNowMs, nextPassesHours, targetKey],
    );
    const nonSatelliteTracks = useMemo(() => {
        const rows = Array.isArray(celestialState?.celestialTracks?.celestial)
            ? celestialState.celestialTracks.celestial
            : [];
        if (!targetKey) return [];
        return rows.filter((row) => String(row?.target_key || '').trim() === targetKey);
    }, [celestialState?.celestialTracks?.celestial, targetKey]);

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
                    dispatch(setPassesTableColumnVisibility(parsedVisibility));
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
            Promise.all([
                dispatch(fetchSolarSystemScene({ socket, payload: nonSatellitePayload })),
                dispatch(fetchCelestialTracks({ socket, payload: nonSatellitePayload })),
            ]);
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
                loading={Boolean(celestialState?.tracksLoading)}
                gridEditable={gridEditable}
                onRefresh={handleRefreshPasses}
                refreshDisabled={!socket || !nonSatellitePayload || Boolean(celestialState?.tracksLoading)}
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
                        <Tooltip title="All passes (Alt+1)">
                            <span>
                                <Button
                                    size="small"
                                    variant={quickFilterPreset === 'all' ? 'contained' : 'outlined'}
                                    onClick={() => handleQuickPreset('all')}
                                    sx={quickFilterButtonSx}
                                    aria-label="All passes"
                                >
                                    {useIconQuickFilters ? <DoneAllIcon sx={{ fontSize: isTightHeader ? '0.82rem' : '0.9rem' }} /> : 'All'}
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
                                    {useIconQuickFilters ? <RadioButtonCheckedIcon sx={{ fontSize: isTightHeader ? '0.82rem' : '0.9rem' }} /> : 'Live'}
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
                                    {useIconQuickFilters ? <AccessTimeFilledIcon sx={{ fontSize: isTightHeader ? '0.82rem' : '0.9rem' }} /> : 'Next 30m'}
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
                        <Tooltip title="Refresh passes (force recalculate)">
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
                                    No targets configured
                                </Typography>
                                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                                    Add a target to load upcoming passes and visibility windows.
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
                        />
                    )}
                </div>
            </div>
            <TargetPassesTableSettingsDialog
                open={openPassesTableSettingsDialog}
                onClose={handleCloseSettings}
            />
        </>
    );
});

export default NextPassesIsland;
