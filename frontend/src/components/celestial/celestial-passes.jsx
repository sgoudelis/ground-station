import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Box,
    Button,
    Chip,
    IconButton,
    Tooltip,
    Typography,
    useMediaQuery,
    useTheme,
} from '@mui/material';
import { alpha, darken, lighten, styled } from '@mui/material/styles';
import {
    DataGrid,
    gridClasses,
} from '@mui/x-data-grid';
import AccessTimeFilledIcon from '@mui/icons-material/AccessTimeFilled';
import ArrowUpwardRoundedIcon from '@mui/icons-material/ArrowUpwardRounded';
import CellTowerOutlinedIcon from '@mui/icons-material/CellTowerOutlined';
import ContentCopyOutlinedIcon from '@mui/icons-material/ContentCopyOutlined';
import DoneAllIcon from '@mui/icons-material/DoneAll';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import KeyOutlinedIcon from '@mui/icons-material/KeyOutlined';
import MyLocationOutlinedIcon from '@mui/icons-material/MyLocationOutlined';
import RadioButtonCheckedIcon from '@mui/icons-material/RadioButtonChecked';
import RefreshIcon from '@mui/icons-material/Refresh';
import SummarizeOutlinedIcon from '@mui/icons-material/SummarizeOutlined';
import TimelineOutlinedIcon from '@mui/icons-material/TimelineOutlined';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import {
    refreshMonitoredCelestialNow,
    setCelestialPassesTableColumnVisibility,
    setCelestialPassesTablePageSize,
    setCelestialPassesTableSortModel,
} from './celestial-slice.jsx';
import {
    fetchMonitoredCelestial,
    updateMonitoredCelestial,
} from './monitored-slice.jsx';
import { getClassNamesBasedOnGridEditing, islandTitleBarCompactSx, TitleBar } from '../common/common.jsx';
import { useUserTimeSettings } from '../../hooks/useUserTimeSettings.jsx';
import { toRowSelectionModel, toSelectedIds } from '../../utils/datagrid-selection.js';
import ProgressFormatter from '../earthview/progressbar-widget.jsx';
import TargetNumberIcon from '../common/target-number-icon.jsx';
import GridPaginationActions from '../common/grid-pagination-actions.jsx';
import {compactGridFooterSx} from '../common/compact-grid-footer.js';
import GridTableToolbar from '../common/grid-table-toolbar.jsx';
import CelestialContextMenu from '../target/celestialcontextmenu.jsx';
import { useSocket } from '../common/socket.jsx';
import { useTargetRotatorSelectionDialog } from '../target/use-target-rotator-selection-dialog.jsx';
import { setRotator, setTrackerId, setTrackingStateInBackend } from '../target/target-slice.jsx';
import { toast } from '../../utils/toast-with-timestamp.jsx';
import TransmittersDialog from '../satellites/transmitters-dialog.jsx';
import ElevationDisplay from '../common/elevation-display.jsx';
import {
    calculateElevationTrend,
    pruneElevationHistory,
    updateElevationHistory,
} from '../../utils/elevationtrend.js';
import { replaceCelestialTargetKey } from '../target/celestial-target-utils.js';
import CelestialEditDialog from './celestialeditdialog.jsx';
import VectorCoverageDialog from './vector-coverage-dialog.jsx';

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
    },
    '& .passes-cell-passed': {
        backgroundColor: alpha(theme.palette.info.main, 0.28),
        borderLeft: `2px solid ${alpha(theme.palette.info.main, 0.85)}`,
        ...theme.applyStyles('light', {
            backgroundColor: alpha(theme.palette.info.main, 0.14),
            borderLeft: `2px solid ${alpha(theme.palette.info.main, 0.55)}`,
        }),
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
    '& .passes-cell-status': {
        alignItems: 'center',
        paddingTop: 0,
        paddingBottom: 0,
    },
}));
export const getCelestialPassStatus = (row, now) => {
    const startMs = Number(row?.eventStartMs);
    const endMs = Number(row?.eventEndMs);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
        return 'upcoming';
    }
    if (row?.estimatedEnd && endMs < now) return 'projection-expired';
    if (startMs <= now && endMs >= now) return 'live';
    if (endMs < now) return 'passed';
    return 'upcoming';
};

const PROJECTION_PROGRESS_INTERVAL_MS = 5000;

export const calculateProjectionProgress = (row, nowMs) => {
    const startMs = Number(row?.eventStartMs);
    const endMs = Number(row?.eventEndMs);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
        return 0;
    }
    const cadenceNowMs = Math.floor(Number(nowMs) / PROJECTION_PROGRESS_INTERVAL_MS)
        * PROJECTION_PROGRESS_INTERVAL_MS;
    const percentage = ((cadenceNowMs - startMs) / (endMs - startMs)) * 100;
    return Math.max(0, Math.min(100, Math.round(percentage)));
};

export const calculateProjectionRemainingSeconds = (row, nowMs) => {
    const endMs = Number(row?.eventEndMs);
    const currentMs = Number(nowMs);
    if (!Number.isFinite(endMs) || !Number.isFinite(currentMs)) return Number.NaN;
    return Math.max(0, Math.ceil((endMs - currentMs) / 1000));
};

export const resolvePassBoundaryNowMs = (sceneTimestampUtc, fallbackNowMs) => {
    const sceneTimestampMs = new Date(sceneTimestampUtc || '').getTime();
    return Number.isFinite(sceneTimestampMs) ? sceneTimestampMs : Number(fallbackNowMs);
};

const ProjectionProgress = ({ row, nowMs, t }) => {
    return (
        <Tooltip title={t('passes.projection_window_progress', { defaultValue: 'Projection window progress' })}>
            <Box sx={{ width: '100%' }}>
                <ProgressFormatter row={row} nowMs={nowMs} />
            </Box>
        </Tooltip>
    );
};

const ProjectionLimitMarker = ({ title }) => (
    <Tooltip title={title}>
        <Box
            component="span"
            aria-label={title}
            sx={{
                width: 17,
                height: 17,
                flexShrink: 0,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: 1,
                borderColor: 'divider',
                borderRadius: '50%',
                color: 'text.secondary',
            }}
        >
            <AccessTimeFilledIcon sx={{ fontSize: 11 }} />
        </Box>
    </Tooltip>
);

const getStatusPriority = (status) => {
    if (status === 'live') return 0;
    if (status === 'upcoming') return 1;
    if (status === 'passed') return 2;
    return 3;
};

const formatRelativeTime = (isoValue, nowMs, t) => {
    const parsed = new Date(isoValue).getTime();
    if (!Number.isFinite(parsed)) return '-';
    const deltaSec = Math.round((parsed - nowMs) / 1000);
    const absSec = Math.abs(deltaSec);

    if (absSec < 60) return deltaSec >= 0 ? t('time.relative.in_less_than_minute') : t('time.relative.less_than_minute_ago');
    if (absSec < 3600) {
        const minutes = Math.floor(absSec / 60);
        return deltaSec >= 0
            ? t('time.relative.in_minutes', { count: minutes })
            : t('time.relative.minutes_ago', { count: minutes });
    }
    if (absSec < 86400) {
        const hours = Math.floor(absSec / 3600);
        return deltaSec >= 0
            ? t('time.relative.in_hours', { count: hours })
            : t('time.relative.hours_ago', { count: hours });
    }
    const days = Math.floor(absSec / 86400);
    return deltaSec >= 0
        ? t('time.relative.in_days', { count: days })
        : t('time.relative.days_ago', { count: days });
};

const formatAbsoluteTime = (isoValue, timezone, locale) => {
    const parsed = new Date(isoValue);
    if (Number.isNaN(parsed.getTime())) return '-';
    const options = timezone ? { timeZone: timezone } : undefined;
    return parsed.toLocaleString(locale, options);
};

const formatDuration = (seconds, t) => {
    const value = Number(seconds);
    if (!Number.isFinite(value) || value < 0) return '-';
    const whole = Math.round(value);
    const minutes = Math.floor(whole / 60);
    const remainder = whole % 60;
    return t('time.duration.minutes_seconds', { minutes, seconds: String(remainder).padStart(2, '0') });
};

const formatAngle = (value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return '-';
    return `${numeric.toFixed(2)}°`;
};

const buildTrackingTargetKey = (trackingState = {}) => {
    const targetType = String(
        trackingState?.target_type
        || (trackingState?.command ? 'mission' : (trackingState?.body_id ? 'body' : 'satellite')),
    ).toLowerCase();
    return targetType === 'mission' || targetType === 'body'
        ? String(trackingState?.target_key || '').trim()
        : '';
};

const PassStatusCell = ({ status, targetNumber = null, t }) => {
    const hasTargetNumber = Number.isFinite(Number(targetNumber)) && Number(targetNumber) > 0;
    const markerSize = 16;
    let statusChip = null;
    if (status === 'live') {
        statusChip = (
            <Chip
                icon={<RadioButtonCheckedIcon sx={{ fontSize: '0.85rem' }} />}
                size="small"
                color="success"
                label={t('passes.status.visible')}
                variant="filled"
                sx={{ fontWeight: 700, minWidth: 85 }}
            />
        );
    } else if (status === 'projection-expired') {
        statusChip = (
            <Chip
                icon={<AccessTimeFilledIcon sx={{ fontSize: '0.85rem' }} />}
                size="small"
                color="warning"
                label={t('passes.status.projection_expired', { defaultValue: 'Projection expired' })}
                variant="outlined"
                sx={{ fontWeight: 700, minWidth: 125 }}
            />
        );
    } else if (status === 'passed') {
        statusChip = (
            <Chip
                icon={<DoneAllIcon sx={{ fontSize: '0.85rem' }} />}
                size="small"
                color="info"
                label={t('passes.status.passed')}
                variant="filled"
                sx={{ fontWeight: 700, minWidth: 85 }}
            />
        );
    } else {
        statusChip = (
            <Chip
                icon={<AccessTimeFilledIcon sx={{ fontSize: '0.85rem' }} />}
                size="small"
                color="warning"
                label={t('passes.status.upcoming')}
                variant="outlined"
                sx={{ fontWeight: 700, minWidth: 85 }}
            />
        );
    }

    return (
        <Box sx={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 0.6, width: '100%' }}>
            {statusChip}
            <Box sx={{ minWidth: markerSize + 6, display: 'inline-flex', justifyContent: 'center', alignItems: 'center', flexShrink: 0 }}>
                {hasTargetNumber ? (
                    <TargetNumberIcon
                        targetNumber={targetNumber}
                        prefix="T"
                        size={markerSize}
                        sx={{ filter: 'brightness(1.12)' }}
                    />
                ) : null}
            </Box>
        </Box>
    );
};

const CelestialPasses = ({
    passes = [],
    tracks = [],
    monitoredRows = [],
    sceneTimestampUtc = '',
    loading = false,
    gridEditable = false,
    targetNumberByTargetKey = {},
    onTargetSelected = null,
    onRefresh = null,
    refreshDisabled = false,
}) => {
    const { t } = useTranslation('earthview');
    const { t: tCelestial } = useTranslation('celestial');
    const { t: tSat } = useTranslation('satellites');
    const { socket } = useSocket();
    const dispatch = useDispatch();
    const { requestRotatorForTarget, dialog: rotatorSelectionDialog } = useTargetRotatorSelectionDialog();
    const theme = useTheme();
    const isCompactHeader = useMediaQuery(theme.breakpoints.down('lg'));
    const isTightHeader = useMediaQuery(theme.breakpoints.down('md'));
    const { timezone, locale } = useUserTimeSettings();
    const trackerInstances = useSelector((state) => state.trackerInstances?.instances || []);
    const { trackingState, trackerViews } = useSelector((state) => state.targetSatTrack || {});
    const [quickFilterPreset, setQuickFilterPreset] = useState('all');
    const [toolbarContainer, setToolbarContainer] = useState(null);
    const [nowMs, setNowMs] = useState(() => Date.now());
    // Pass boundaries and this timestamp are produced by the same backend
    // snapshot, so relative Start/End labels cannot straddle a client timer tick.
    const boundaryNowMs = resolvePassBoundaryNowMs(sceneTimestampUtc, nowMs);
    const [page, setPage] = useState(0);
    const [selectedIds, setSelectedIds] = useState([]);
    const [rowContextMenu, setRowContextMenu] = useState(null);
    const [transmittersDialogOpen, setTransmittersDialogOpen] = useState(false);
    const [transmittersDialogData, setTransmittersDialogData] = useState(null);
    const [propertiesTarget, setPropertiesTarget] = useState(null);
    const [propertiesSaving, setPropertiesSaving] = useState(false);
    const [propertiesError, setPropertiesError] = useState('');
    const [vectorTarget, setVectorTarget] = useState(null);
    const elevationHistoryByTargetKeyRef = useRef({});
    const columnVisibility = useSelector((state) => state.celestial?.passesTableColumnVisibility || {});
    const pageSize = useSelector((state) => state.celestial?.passesTablePageSize || 10);
    const sortModel = useSelector((state) => state.celestial?.passesTableSortModel || []);
    const rowSelectionModel = useMemo(() => toRowSelectionModel(selectedIds), [selectedIds]);
    const currentlyTrackedTargetKey = useMemo(() => buildTrackingTargetKey(trackingState), [trackingState]);

    useEffect(() => {
        const interval = setInterval(() => setNowMs(Date.now()), PROJECTION_PROGRESS_INTERVAL_MS);
        return () => clearInterval(interval);
    }, []);

    const trackByTargetKey = useMemo(() => {
        const entries = Array.isArray(tracks) ? tracks : [];
        return entries.reduce((acc, track) => {
            const key = String(track?.target_key || track?.targetKey || '').trim();
            if (key) acc[key] = track;
            return acc;
        }, {});
    }, [tracks]);

    const monitoredByTargetKey = useMemo(() => (monitoredRows || []).reduce((acc, entry) => {
        const key = String(entry?.targetKey || entry?.target_key || '').trim();
        if (key) acc[key] = entry;
        return acc;
    }, {}), [monitoredRows]);

    const elevationTrendByTargetKey = useMemo(() => {
        const historyByTargetKey = elevationHistoryByTargetKeyRef.current;
        const nextTrendByTargetKey = {};
        const activeTargetKeys = new Set();
        const entries = Array.isArray(tracks) ? tracks : [];

        entries.forEach((track) => {
            const targetKey = String(track?.target_key || track?.targetKey || '').trim();
            if (!targetKey) return;
            activeTargetKeys.add(targetKey);

            const elevationDeg = Number(track?.sky_position?.el_deg);
            if (!Number.isFinite(elevationDeg)) return;

            const history = updateElevationHistory(historyByTargetKey, targetKey, elevationDeg);
            nextTrendByTargetKey[targetKey] = calculateElevationTrend(history, elevationDeg);
        });

        pruneElevationHistory(historyByTargetKey, activeTargetKeys);
        return nextTrendByTargetKey;
    }, [tracks]);

    const rows = useMemo(() => (passes || []).map((pass) => {
        const eventStartMs = new Date(pass.event_start).getTime();
        const eventEndMs = new Date(pass.event_end).getTime();
        const targetTypeKey = String(pass.target_type || 'mission').toLowerCase() === 'body' ? 'body' : 'mission';
        const normalizedTargetKey = String(pass.target_key || '').trim();
        const track = trackByTargetKey[normalizedTargetKey] || {};
        const monitoredEntry = monitoredByTargetKey[normalizedTargetKey] || null;
        const missionCommand = String(
            pass.command
            || track.command
            || ''
        ).trim();
        const missionId = String(pass.mission_id || pass.missionId || track.mission_id || track.missionId || '').trim().toLowerCase();
        const bodyId = String(pass.body_id || pass.bodyId || track.body_id || track.bodyId || '').trim().toLowerCase();
        const targetIdentifier = targetTypeKey === 'body'
            ? String(bodyId || pass.target_identifier || '').trim().toLowerCase()
            : String(
                missionCommand
                || pass.target_identifier
                || missionId
                || ''
            ).trim();
        const rawCurrentElevationDeg = Number(track?.sky_position?.el_deg);
        const currentElevationDeg = Number.isFinite(rawCurrentElevationDeg) ? rawCurrentElevationDeg : null;
        const estimatedEnd = Boolean(pass.estimated_end ?? pass.estimatedEnd);
        const estimatedStart = Boolean(pass.estimated_start ?? pass.estimatedStart);
        const status = getCelestialPassStatus({ eventStartMs, eventEndMs, estimatedEnd }, nowMs);
        const elevationTrend = elevationTrendByTargetKey[normalizedTargetKey] || {};
        const peakTimeMs = new Date(pass.peak_time).getTime();
        const timeToPeakSeconds = Number.isFinite(peakTimeMs) && peakTimeMs > nowMs
            ? Math.floor((peakTimeMs - nowMs) / 1000)
            : null;
        return {
            id: pass.id || `${pass.target_key || 'target'}_${pass.event_start || ''}`,
            status,
            name: pass.name || '-',
            targetType: targetTypeKey === 'body' ? tCelestial('common.body') : tCelestial('common.mission'),
            targetTypeKey,
            targetKey: pass.target_key || '',
            monitoredEntry,
            targetIdentifier,
            command: missionCommand,
            missionId,
            bodyId,
            transmitters: Array.isArray(pass?.transmitters)
                ? pass.transmitters
                : (Array.isArray(track?.transmitters) ? track.transmitters : []),
            peakElevationDeg: Number(pass.peak_elevation_deg),
            currentElevationDeg,
            elevationTrend: elevationTrend.trend || null,
            elevationRate: Number.isFinite(elevationTrend.elRate) ? elevationTrend.elRate : null,
            timeToPeakSeconds,
            eventStart: pass.event_start,
            eventEnd: pass.event_end,
            estimatedEnd,
            estimatedStart,
            projectionEnd: pass.projection_end || pass.projectionEnd || null,
            projectionStart: pass.projection_start || pass.projectionStart || null,
            event_start: pass.event_start,
            event_end: pass.event_end,
            peak_time: pass.peak_time,
            eventStartMs,
            eventEndMs,
            durationSeconds: Number(pass.duration_seconds),
            startAzimuthDeg: Number(pass.start_azimuth_deg),
            endAzimuthDeg: Number(pass.end_azimuth_deg),
            peakAzimuthDeg: Number(pass.peak_azimuth_deg),
            cacheStatus: pass.cache || '-',
            stale: pass.stale ? tCelestial('common.yes') : tCelestial('common.no'),
            source: pass.source || '-',
        };
    }), [passes, nowMs, trackByTargetKey, monitoredByTargetKey, elevationTrendByTargetKey, tCelestial]);

    const filteredRows = useMemo(() => {
        if (quickFilterPreset === 'live') {
            return rows.filter((row) => row.status === 'live');
        }
        if (quickFilterPreset === 'next30') {
            return rows.filter((row) => {
                if (row.status === 'live') return true;
                if (row.status !== 'upcoming') return false;
                return (row.eventStartMs - nowMs) <= 30 * 60 * 1000;
            });
        }
        if (quickFilterPreset === 'highEl') {
            return [...rows]
                .filter((row) => Number.isFinite(row.peakElevationDeg) && row.peakElevationDeg >= 20)
                .sort((a, b) => b.peakElevationDeg - a.peakElevationDeg);
        }
        return rows;
    }, [rows, quickFilterPreset, nowMs]);

    useEffect(() => {
        const selectedId = selectedIds[0];
        if (!selectedId) return;
        const exists = filteredRows.some((row) => row.id === selectedId);
        if (!exists) {
            setSelectedIds([]);
        }
    }, [filteredRows, selectedIds]);

    const lastPage = Math.max(0, Math.ceil(filteredRows.length / pageSize) - 1);
    const paginationModel = useMemo(() => ({ pageSize, page }), [pageSize, page]);

    const handlePageChange = useCallback((nextPage) => {
        const normalizedPage = Math.max(0, Math.min(Number(nextPage) || 0, lastPage));
        setPage(normalizedPage);
    }, [lastPage]);

    const handlePageSizeChange = useCallback((event) => {
        const nextPageSize = Number(event?.target?.value ?? event);
        if (!Number.isFinite(nextPageSize) || nextPageSize <= 0) return;
        setPage(0);
        dispatch(setCelestialPassesTablePageSize(nextPageSize));
    }, [dispatch]);

    useEffect(() => {
        // Live celestial payloads can change the row count. Keep the current
        // page when it still exists and clamp only after a genuine reduction.
        setPage((currentPage) => Math.min(currentPage, lastPage));
    }, [lastPage]);

    const columns = useMemo(() => [
        {
            field: 'status',
            headerName: tCelestial('passes.columns.status'),
            width: 150,
            minWidth: 150,
            align: 'center',
            headerAlign: 'center',
            cellClassName: 'passes-cell-status',
            sortComparator: (v1, v2) => getStatusPriority(v1) - getStatusPriority(v2),
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
                        t={tCelestial}
                        targetNumber={targetNumberByTargetKey?.[String(params.row?.targetKey || '').trim()] ?? null}
                    />
                </Box>
            ),
        },
        {
            field: 'name',
            headerName: tCelestial('passes.columns.name'),
            minWidth: 110,
            flex: 0.8,
            renderCell: (params) => (
                <Typography
                    component="span"
                    variant="body2"
                    sx={{
                        fontWeight: 700,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        lineHeight: 1.2,
                    }}
                >
                    {params?.value || '-'}
                </Typography>
            ),
        },
        { field: 'targetType', headerName: tCelestial('passes.columns.type'), minWidth: 90, flex: 0.8 },
        {
            field: 'peakElevationDeg', type: 'number',
            headerName: tCelestial('passes.columns.peak_elevation'),
            width: 90,
            minWidth: 90,
            valueFormatter: (value) => formatAngle(value),
            cellClassName: (params) => {
                const value = Number(params?.value);
                if (!Number.isFinite(value)) return '';
                if (value < 10.0) return 'passes-cell-warning';
                if (value > 45.0) return 'passes-cell-success';
                return '';
            },
        },
        {
            field: 'currentElevationDeg', type: 'number',
            headerName: tCelestial('passes.columns.current_elevation', { defaultValue: 'Current Elevation' }),
            width: 120,
            minWidth: 120,
            align: 'center',
            headerAlign: 'center',
            sortable: false,
            renderCell: (params) => {
                return (
                    <ElevationDisplay
                        elevation={params.row?.currentElevationDeg}
                        trend={params.row?.elevationTrend}
                        elRate={params.row?.elevationRate}
                        timeToMaxEl={params.row?.timeToPeakSeconds}
                        // This is the target's current sky position, not the
                        // elevation at the pass event, so retain it below 0°.
                        showNegative={true}
                        decimalPlaces={2}
                    />
                );
            },
        },
        {
            field: 'progress',
            filterable: false,
            headerName: tCelestial('passes.columns.progress'),
            minWidth: 150,
            sortable: false,
            renderCell: (params) => {
                if (params.row?.estimatedEnd) {
                    return <ProjectionProgress row={params.row} nowMs={nowMs} t={tCelestial} />;
                }
                return <ProgressFormatter row={params.row} nowMs={nowMs} />;
            },
        },
        {
            field: 'duration',
            headerName: tCelestial('passes.columns.duration'),
            minWidth: 100,
            valueGetter: (_value, row) => {
                if (row.estimatedEnd) {
                    return formatDuration(
                        calculateProjectionRemainingSeconds(row, nowMs),
                        tCelestial,
                    );
                }
                return formatDuration(row.durationSeconds, tCelestial);
            },
            renderCell: (params) => params.row?.estimatedEnd ? (
                <Tooltip title={tCelestial('passes.projection_time_remaining', {
                    defaultValue: 'Time remaining until projection limit',
                })}>
                    <Typography component="span" variant="body2">
                        {params.value}
                    </Typography>
                </Tooltip>
            ) : params.value,
        },
        {
            field: 'eventStart',
            headerName: tCelestial('passes.columns.start'),
            minWidth: 240,
            renderCell: (params) => (
                <Box sx={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden' }}>
                    <Typography component="span" variant="caption" sx={{ display: 'inline-flex', alignItems: 'center', lineHeight: 1.2, fontWeight: 700, color: 'text.primary' }}>
                        {formatRelativeTime(params.value, boundaryNowMs, tCelestial)}
                    </Typography>
                    {params.row?.estimatedStart && (
                        <ProjectionLimitMarker title={tCelestial('passes.projection_limit')} />
                    )}
                    <Typography component="span" className="passes-time-absolute" variant="caption" sx={{ display: 'inline-flex', alignItems: 'center', lineHeight: 1.2, color: 'text.secondary', ml: 0.5 }}>
                        · {formatAbsoluteTime(params.value, timezone, locale)}
                    </Typography>
                </Box>
            ),
        },
        {
            field: 'eventEnd',
            headerName: tCelestial('passes.columns.end'),
            minWidth: 230,
            renderCell: (params) => (
                <Box sx={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden' }}>
                    <Typography component="span" variant="caption" sx={{ display: 'inline-flex', alignItems: 'center', lineHeight: 1.2, fontWeight: 700, color: 'text.primary' }}>
                        {params.row?.estimatedEnd && params.row?.eventEndMs < boundaryNowMs
                            ? tCelestial('passes.projection_expired', { defaultValue: 'Projection expired' })
                            : formatRelativeTime(params.value, boundaryNowMs, tCelestial)}
                    </Typography>
                    {params.row?.estimatedEnd && (
                        <ProjectionLimitMarker title={params.row?.eventEndMs < boundaryNowMs
                            ? tCelestial('passes.projection_expired', { defaultValue: 'Projection expired' })
                            : tCelestial('passes.projection_limit')} />
                    )}
                    <Typography component="span" className="passes-time-absolute" variant="caption" sx={{ display: 'inline-flex', alignItems: 'center', lineHeight: 1.2, color: 'text.secondary', ml: 0.5 }}>
                        · {formatAbsoluteTime(params.value, timezone, locale)}
                    </Typography>
                </Box>
            ),
        },
        { field: 'startAzimuthDeg', type: 'number', headerName: tCelestial('passes.columns.start_azimuth'), width: 90, minWidth: 90, valueFormatter: (value) => formatAngle(value) },
        { field: 'endAzimuthDeg', type: 'number', headerName: tCelestial('passes.columns.end_azimuth'), width: 90, minWidth: 90, valueFormatter: (value) => formatAngle(value) },
        { field: 'peakAzimuthDeg', type: 'number', headerName: tCelestial('passes.columns.peak_azimuth'), minWidth: 120, valueFormatter: (value) => formatAngle(value) },
        { field: 'cacheStatus', headerName: tCelestial('passes.columns.cache'), width: 90, minWidth: 90 },
        { field: 'stale', headerName: tCelestial('passes.columns.stale'), width: 80, minWidth: 80 },
        { field: 'source', headerName: tCelestial('passes.columns.source'), width: 110, minWidth: 110 },
    ], [boundaryNowMs, nowMs, timezone, locale, targetNumberByTargetKey, tCelestial]);

    const handleQuickPreset = useCallback((preset) => {
        setQuickFilterPreset(preset);
        if (preset === 'highEl') {
            dispatch(setCelestialPassesTableSortModel([
                { field: 'peakElevationDeg', sort: 'desc' },
                { field: 'eventStart', sort: 'asc' },
            ]));
            return;
        }
        dispatch(setCelestialPassesTableSortModel([
            { field: 'status', sort: 'asc' },
            { field: 'eventStart', sort: 'asc' },
        ]));
    }, [dispatch]);

    useEffect(() => {
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
    }, [handleQuickPreset]);

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
        () => ({ p: isTightHeader ? '1px' : '2px' }),
        [isTightHeader]
    );

    const getRowClassName = (params) => {
        const classes = ['pointer-cursor'];
        if (params.row.status === 'live') classes.push('passes-row-live');
        else if (params.row.status === 'passed') classes.push('passes-row-passed');
        if (
            params.row.status === 'upcoming'
            && Number.isFinite(params.row.eventStartMs)
            && (params.row.eventStartMs - nowMs) <= 30 * 60 * 1000
        ) {
            classes.push('passes-row-upcoming-soon');
        }
        return classes.join(' ');
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

    const openPropertiesDialog = useCallback((row) => {
        const monitoredEntry = row?.monitoredEntry;
        if (!monitoredEntry?.id) return;
        setPropertiesError('');
        setPropertiesTarget({
            ...monitoredEntry,
            projectionPastHours: Number(monitoredEntry.projectionPastHours ?? 1),
            projectionFutureHours: Number(monitoredEntry.projectionFutureHours ?? 24),
            projectionStepMinutes: Number(monitoredEntry.projectionStepMinutes ?? 60),
        });
    }, []);

    const saveProperties = useCallback(async () => {
        if (!socket || !propertiesTarget) return;
        const name = String(propertiesTarget.displayName || '').trim();
        const identifier = propertiesTarget.targetType === 'body'
            ? String(propertiesTarget.bodyId || '').trim()
            : String(propertiesTarget.command || '').trim();
        if (!name || !identifier) {
            setPropertiesError(tCelestial('admin.targets.errors.name_identifier_required'));
            return;
        }
        setPropertiesSaving(true);
        setPropertiesError('');
        try {
            await dispatch(updateMonitoredCelestial({
                socket,
                entry: propertiesTarget,
            })).unwrap();
            await dispatch(refreshMonitoredCelestialNow({
                socket,
                ids: [propertiesTarget.id],
            })).unwrap();
            await dispatch(fetchMonitoredCelestial({ socket })).unwrap();
            setPropertiesTarget(null);
        } catch (error) {
            setPropertiesError(error?.message || error?.error || tCelestial('errors.unknown_error'));
        } finally {
            setPropertiesSaving(false);
        }
    }, [dispatch, propertiesTarget, socket, tCelestial]);

    const openVectorDialog = useCallback((row) => {
        const monitoredEntry = row?.monitoredEntry || {};
        if (!row?.targetKey) return;
        setVectorTarget({
            ...monitoredEntry,
            id: monitoredEntry.id || null,
            targetKey: row.targetKey,
            targetType: row.targetTypeKey,
            displayName: row.name,
            command: row.command,
            bodyId: row.bodyId,
            projectionPastHours: Number(monitoredEntry.projectionPastHours ?? 1),
            projectionFutureHours: Number(monitoredEntry.projectionFutureHours ?? 24),
            projectionStepMinutes: Number(monitoredEntry.projectionStepMinutes ?? 60),
        });
    }, []);

    const refreshVectorTarget = useCallback(async (id) => {
        if (!socket || !id) return;
        await dispatch(refreshMonitoredCelestialNow({ socket, ids: [id] })).unwrap();
        await dispatch(fetchMonitoredCelestial({ socket })).unwrap();
    }, [dispatch, socket]);

    const handleCloseRowContextMenu = useCallback(() => {
        setRowContextMenu(null);
    }, []);

    const handleSuppressNativeContextMenu = useCallback((event) => {
        event.preventDefault();
        if (typeof event.stopPropagation === 'function') {
            event.stopPropagation();
        }
        setRowContextMenu(null);
    }, []);

    // Bind context-menu directly on rows for stable behavior across browsers.
    const handleRowContextMenu = useCallback((event) => {
        const rowId = event.currentTarget?.getAttribute?.('data-id');
        if (!rowId) return;
        const row = filteredRows.find((entry) => String(entry?.id) === String(rowId));
        if (!row) return;
        event.preventDefault();
        event.stopPropagation();
        // Match earth-view behavior: a second right-click closes the open menu.
        if (rowContextMenu) {
            setRowContextMenu(null);
            return;
        }
        setSelectedIds([row.id]);
        if (row?.targetKey && onTargetSelected) {
            onTargetSelected(row.targetKey);
        }
        setRowContextMenu({
            mouseX: event.clientX + 2,
            mouseY: event.clientY - 6,
            row,
        });
    }, [filteredRows, onTargetSelected, rowContextMenu]);

    const handleRowMenuAction = useCallback(async (action) => {
        const row = rowContextMenu?.row;
        if (!row) return;
        try {
            if (action === 'set-target') {
                const targetType = row.targetTypeKey === 'body' ? 'body' : 'mission';
                const missionCommand = String(row.command || row.targetIdentifier || '').trim();
                const missionId = String(row.missionId || '').trim().toLowerCase();
                const bodyId = String(row.bodyId || row.targetIdentifier || '').trim().toLowerCase();
                const isTargetable = targetType === 'body' ? Boolean(bodyId) : Boolean(missionCommand);
                if (!socket || !isTargetable) {
                    return;
                }
                const selectedAssignment = await requestRotatorForTarget(row.name || row.targetIdentifier || row.targetKey);
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

                dispatch(setTrackerId(trackerId));
                dispatch(setRotator({ value: nextRotatorId, trackerId }));

                const targetPatch = replaceCelestialTargetKey(targetType === 'body'
                    ? {
                        target_type: 'body',
                        target_name: row.name || bodyId,
                        body_id: bodyId,
                        mission_id: null,
                        command: null,
                    }
                    : {
                        target_type: 'mission',
                        target_name: row.name || missionCommand,
                        mission_id: missionId || null,
                        command: missionCommand,
                        body_id: null,
                    }, row.targetKey);

                const newTrackingState = isCreateNewSlot
                    ? {
                        tracker_id: trackerId,
                        ...targetPatch,
                        norad_id: null,
                        group_id: null,
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
                        ...targetPatch,
                        norad_id: null,
                        group_id: null,
                        rig_id: nextRigId,
                        rotator_id: nextRotatorId,
                        transmitter_id: nextTransmitterId,
                    };

                await dispatch(setTrackingStateInBackend({ socket, data: newTrackingState })).unwrap();
                return;
            }
            if (action === 'edit-transmitters') {
                setTransmittersDialogData({
                    name: row.name || row.targetIdentifier || row.targetKey || '',
                    target_key: row.targetKey || '',
                    transmitters: Array.isArray(row.transmitters) ? row.transmitters : [],
                });
                setTransmittersDialogOpen(true);
                return;
            }
            if (action === 'edit-properties') {
                openPropertiesDialog(row);
                return;
            }
            if (action === 'vector-details') {
                openVectorDialog(row);
                return;
            }
            if (action === 'copy-identifier') {
                await copyTextToClipboard(row.targetIdentifier || '-');
                return;
            }
            if (action === 'copy-target-key') {
                await copyTextToClipboard(row.targetKey || '-');
                return;
            }
            if (action === 'copy-summary') {
                const summary = [
                    row.name || '-',
                    row.targetTypeKey === 'body'
                        ? `${tCelestial('common.body')} ${row.targetIdentifier || '-'}`
                        : `${tCelestial('common.mission')} ${row.targetIdentifier || '-'}`,
                    `${tCelestial('passes.summary.start')} ${row.eventStart || '-'}`,
                    `${tCelestial('passes.summary.end')} ${row.eventEnd || '-'}`,
                ].join(' | ');
                await copyTextToClipboard(summary);
            }
        } catch (error) {
            toast.error(`${t('satellite_info.failed_tracking')}: ${error?.message || error?.error || tCelestial('errors.unknown_error')}`);
        } finally {
            setRowContextMenu(null);
        }
    }, [
        copyTextToClipboard,
        dispatch,
        onTargetSelected,
        openPropertiesDialog,
        openVectorDialog,
        requestRotatorForTarget,
        rowContextMenu?.row,
        socket,
        t,
        tCelestial,
        trackerInstances,
        trackerViews,
    ]);

    const rowContextMenuItems = useMemo(() => {
        const row = rowContextMenu?.row;
        if (!row) return [];
        const targetType = row.targetTypeKey === 'body' ? 'body' : 'mission';
        const missionCommand = String(row.command || row.targetIdentifier || '').trim();
        const bodyId = String(row.bodyId || row.targetIdentifier || '').trim().toLowerCase();
        const isTargetable = targetType === 'body' ? Boolean(bodyId) : Boolean(missionCommand);
        const isCurrentlyTargeted = Boolean(row.targetKey) && String(row.targetKey).trim() === currentlyTrackedTargetKey;
        return [
            {
                key: 'set-target',
                label: t('satellites_table.context_menu.set_as_target'),
                icon: <MyLocationOutlinedIcon />,
                opensDialog: true,
                disabled: !socket || !isTargetable || isCurrentlyTargeted,
                onClick: () => handleRowMenuAction('set-target'),
            },
            {
                key: 'edit-properties',
                label: tCelestial('admin.targets.actions.edit_properties', { defaultValue: 'Edit properties' }),
                icon: <EditOutlinedIcon />,
                opensDialog: true,
                disabled: !socket || !row?.monitoredEntry?.id,
                onClick: () => handleRowMenuAction('edit-properties'),
            },
            {
                key: 'edit-transmitters',
                label: t('satellites_table.context_menu.edit_transmitters'),
                icon: <CellTowerOutlinedIcon />,
                opensDialog: true,
                disabled: !row?.targetKey,
                onClick: () => handleRowMenuAction('edit-transmitters'),
            },
            {
                key: 'vector-details',
                label: tCelestial('admin.targets.actions.vector_details'),
                icon: <TimelineOutlinedIcon />,
                opensDialog: true,
                disabled: !socket || !row?.targetKey,
                onClick: () => handleRowMenuAction('vector-details'),
            },
            { type: 'divider', key: 'divider-copy' },
            {
                key: 'copy-identifier',
                label: row.targetTypeKey === 'body'
                    ? tCelestial('context.copy_body_id')
                    : tCelestial('context.copy_mission_command'),
                icon: <ContentCopyOutlinedIcon />,
                onClick: () => handleRowMenuAction('copy-identifier'),
            },
            {
                key: 'copy-target-key',
                label: tCelestial('context.copy_target_key'),
                icon: <KeyOutlinedIcon />,
                onClick: () => handleRowMenuAction('copy-target-key'),
            },
            {
                key: 'copy-summary',
                label: tCelestial('context.copy_pass_summary'),
                icon: <SummarizeOutlinedIcon />,
                onClick: () => handleRowMenuAction('copy-summary'),
            },
        ];
    }, [currentlyTrackedTargetKey, handleRowMenuAction, rowContextMenu?.row, socket, t, tCelestial]);

    return (
        <>
            {rotatorSelectionDialog}
            <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <TitleBar
                className={getClassNamesBasedOnGridEditing(gridEditable, ['window-title-bar'])}
                sx={islandTitleBarCompactSx}
            >
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', height: '100%' }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, flex: 1 }}>
                        <Typography variant="subtitle2" sx={{ fontWeight: 700, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {tCelestial('passes.title')}
                        </Typography>
                        <Typography variant="caption" sx={{ color: 'text.secondary', whiteSpace: 'nowrap' }}>
                            ({rows.length} {rows.length === 1
                                ? tCelestial('passes.count_label_single')
                                : tCelestial('passes.count_label_plural')})
                        </Typography>
                    </Box>
                    <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
                        <Tooltip title={tCelestial('passes.quick_filters.all_tooltip')}>
                            <span>
                                <Button
                                    size="small"
                                    variant={quickFilterPreset === 'all' ? 'contained' : 'outlined'}
                                    onClick={() => handleQuickPreset('all')}
                                    sx={quickFilterButtonSx}
                                    aria-label={tCelestial('passes.quick_filters.all_aria')}
                                >
                                    {useIconQuickFilters ? <DoneAllIcon sx={{ fontSize: isTightHeader ? '0.82rem' : '0.9rem' }} /> : tCelestial('passes.quick_filters.all_short')}
                                </Button>
                            </span>
                        </Tooltip>
                        <Tooltip title={tCelestial('passes.quick_filters.live_tooltip')}>
                            <span>
                                <Button
                                    size="small"
                                    variant={quickFilterPreset === 'live' ? 'contained' : 'outlined'}
                                    onClick={() => handleQuickPreset('live')}
                                    sx={quickFilterButtonSx}
                                    aria-label={tCelestial('passes.quick_filters.live_aria')}
                                >
                                    {useIconQuickFilters ? <RadioButtonCheckedIcon sx={{ fontSize: isTightHeader ? '0.82rem' : '0.9rem' }} /> : tCelestial('passes.quick_filters.live_short')}
                                </Button>
                            </span>
                        </Tooltip>
                        <Tooltip title={tCelestial('passes.quick_filters.next_30_tooltip')}>
                            <span>
                                <Button
                                    size="small"
                                    variant={quickFilterPreset === 'next30' ? 'contained' : 'outlined'}
                                    onClick={() => handleQuickPreset('next30')}
                                    sx={quickFilterButtonSx}
                                    aria-label={tCelestial('passes.quick_filters.next_30_aria')}
                                >
                                    {useIconQuickFilters ? <AccessTimeFilledIcon sx={{ fontSize: isTightHeader ? '0.82rem' : '0.9rem' }} /> : tCelestial('passes.quick_filters.next_30_short')}
                                </Button>
                            </span>
                        </Tooltip>
                        <Tooltip title={tCelestial('passes.quick_filters.highest_elevation_tooltip')}>
                            <span>
                                <Button
                                    size="small"
                                    variant={quickFilterPreset === 'highEl' ? 'contained' : 'outlined'}
                                    onClick={() => handleQuickPreset('highEl')}
                                    sx={quickFilterButtonSx}
                                    aria-label={tCelestial('passes.quick_filters.highest_elevation_aria')}
                                >
                                    {useIconQuickFilters ? <ArrowUpwardRoundedIcon sx={{ fontSize: isTightHeader ? '0.82rem' : '0.9rem' }} /> : tCelestial('passes.quick_filters.high_el_short')}
                                </Button>
                            </span>
                        </Tooltip>
                        <Box ref={setToolbarContainer} />
                        <Tooltip title={tCelestial('passes.refresh')}>
                            <span>
                                <IconButton
                                    size="small"
                                    onClick={onRefresh}
                                    disabled={refreshDisabled || !onRefresh}
                                    sx={titleIconButtonSx}
                                >
                                    <RefreshIcon fontSize="small" />
                                </IconButton>
                            </span>
                        </Tooltip>
                    </Box>
                </Box>
            </TitleBar>
            <Box sx={{ flex: 1, minHeight: 0 }}>
                <StyledDataGrid
                    showToolbar
                    slots={{ toolbar: GridTableToolbar }}
                    rows={filteredRows}
                    columns={columns}
                    loading={loading}
                    slotProps={{
                        toolbar: { container: toolbarContainer },
                        row: {
                            onContextMenu: handleRowContextMenu,
                        },
                        basePagination: {
                            ActionsComponent: GridPaginationActions,
                            // Live row replacements should only clamp the page when it no longer exists.
                            onPageChange: (_event, nextPage) => handlePageChange(nextPage),
                            onRowsPerPageChange: handlePageSizeChange,
                        },
                    }}
                    disableMultipleRowSelection
                    pageSizeOptions={[5, 10, 15, 20, 25]}
                    paginationModel={paginationModel}
                    rowSelectionModel={rowSelectionModel}
                    onRowSelectionModelChange={(model) => {
                        const ids = toSelectedIds(model);
                        const selectedId = ids.length ? ids[0] : null;
                        setSelectedIds(selectedId ? [selectedId] : []);
                        if (!selectedId || !onTargetSelected) return;
                        const selectedRow = filteredRows.find((row) => row.id === selectedId);
                        if (selectedRow?.targetKey) {
                            onTargetSelected(selectedRow.targetKey);
                        }
                    }}
                    sortModel={sortModel}
                    onSortModelChange={(model) => dispatch(setCelestialPassesTableSortModel(model))}
                    columnVisibilityModel={columnVisibility}
                    onColumnVisibilityModelChange={(model) => dispatch(setCelestialPassesTableColumnVisibility(model))}
                    getRowClassName={getRowClassName}
                    density="compact"
                    sx={{
                        ...compactGridFooterSx,
                        border: 0,
                        marginTop: 0,
                        [`& .${gridClasses.cell}:focus, & .${gridClasses.cell}:focus-within`]: {
                            outline: 'none',
                        },
                        [`& .${gridClasses.columnHeader}:focus, & .${gridClasses.columnHeader}:focus-within`]: {
                            outline: 'none',
                        },
                        '& .MuiDataGrid-overlay': {
                            fontSize: '0.875rem',
                            fontStyle: 'italic',
                            color: 'text.secondary',
                        },
                    }}
                />
            </Box>
            <CelestialContextMenu
                open={Boolean(rowContextMenu)}
                onClose={handleCloseRowContextMenu}
                onSuppressNativeContextMenu={handleSuppressNativeContextMenu}
                anchorPosition={
                    rowContextMenu
                        ? { top: rowContextMenu.mouseY, left: rowContextMenu.mouseX }
                        : undefined
                }
                title={rowContextMenu?.row?.name || '-'}
                targetType={rowContextMenu?.row?.targetTypeKey || 'mission'}
                targetIdentifier={rowContextMenu?.row?.targetIdentifier || '-'}
                items={rowContextMenuItems}
            />
            <TransmittersDialog
                open={transmittersDialogOpen}
                onClose={() => setTransmittersDialogOpen(false)}
                title={tSat('satellite_database.edit_transmitters_title', {
                    name: transmittersDialogData?.name || rowContextMenu?.row?.name || '',
                })}
                satelliteData={transmittersDialogData}
                variant="paper"
                widthOffsetPx={20}
            />
            <CelestialEditDialog
                target={propertiesTarget}
                saving={propertiesSaving}
                error={propertiesError}
                onChange={(field, value) => {
                    setPropertiesTarget((current) => (
                        current ? { ...current, [field]: value } : current
                    ));
                }}
                onClose={() => {
                    setPropertiesTarget(null);
                    setPropertiesError('');
                }}
                onSave={saveProperties}
            />
            <VectorCoverageDialog
                open={Boolean(vectorTarget)}
                target={vectorTarget}
                socket={socket}
                timezone={timezone}
                locale={locale}
                onClose={() => setVectorTarget(null)}
                onRefresh={vectorTarget?.id ? refreshVectorTarget : null}
            />
            </Box>
        </>
    );
};

export default React.memo(CelestialPasses);
