import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DataGrid, gridClasses } from '@mui/x-data-grid';
import { alpha, styled } from '@mui/material/styles';
import CellTowerOutlinedIcon from '@mui/icons-material/CellTowerOutlined';
import ContentCopyOutlinedIcon from '@mui/icons-material/ContentCopyOutlined';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import KeyOutlinedIcon from '@mui/icons-material/KeyOutlined';
import MyLocationOutlinedIcon from '@mui/icons-material/MyLocationOutlined';
import SummarizeOutlinedIcon from '@mui/icons-material/SummarizeOutlined';
import TimelineOutlinedIcon from '@mui/icons-material/TimelineOutlined';
import VisibilityOffOutlinedIcon from '@mui/icons-material/VisibilityOffOutlined';
import {
    Box,
    Button,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    Typography,
} from '@mui/material';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import {
    deleteMonitoredCelestial,
    fetchMonitoredCelestial,
    setSelectedMonitoredIds,
    setMonitoredTableColumnVisibility,
    setMonitoredTablePageSize,
    setMonitoredTableSortModel,
    updateMonitoredCelestial,
} from './monitored-slice.jsx';
import { refreshMonitoredCelestialNow } from './celestial-slice.jsx';
import { toRowSelectionModel, toSelectedIds } from '../../utils/datagrid-selection.js';
import { useUserTimeSettings } from '../../hooks/useUserTimeSettings.jsx';
import TargetNumberIcon from '../common/target-number-icon.jsx';
import GridTableToolbar from '../common/grid-table-toolbar.jsx';
import {
    buildTargetKeyFromCelestialRow,
    replaceCelestialTargetKey,
} from '../target/celestial-target-utils.js';
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
import CelestialEditDialog from './celestialeditdialog.jsx';
import VectorCoverageDialog from './vector-coverage-dialog.jsx';

const AU_IN_KM = 149597870.7;
const SECONDS_PER_DAY = 86400;
const AU_PER_DAY_TO_KM_PER_S = AU_IN_KM / SECONDS_PER_DAY;
const LIGHT_TIME_MIN_PER_AU = 8.316746397;
const DIALOG_PAPER_SX = {
    bgcolor: 'background.paper',
    border: (theme) => `1px solid ${theme.palette.divider}`,
    borderRadius: 2,
};
const DIALOG_TITLE_SX = {
    bgcolor: (theme) => (theme.palette.mode === 'dark' ? 'grey.900' : 'grey.100'),
    borderBottom: (theme) => `1px solid ${theme.palette.divider}`,
    fontSize: '1.125rem',
    fontWeight: 'bold',
    py: 2.2,
};
const DIALOG_CONTENT_SX = {
    px: 2,
    pt: 2,
    pb: 1.5,
};
const DIALOG_ACTIONS_SX = {
    bgcolor: 'background.paper',
    borderTop: (theme) => `1px solid ${theme.palette.divider}`,
    px: 2,
    py: 1.5,
};
const StyledDataGrid = styled(DataGrid)(({ theme }) => ({
    '& .MuiDataGrid-row': {
        borderLeft: '3px solid transparent',
    },
    '& .celestial-row-visible': {
        backgroundColor: alpha(theme.palette.success.main, 0.15),
        borderLeftColor: alpha(theme.palette.success.main, 0.9),
        ...theme.applyStyles('light', {
            backgroundColor: alpha(theme.palette.success.main, 0.08),
            borderLeftColor: alpha(theme.palette.success.main, 0.6),
        }),
        '&:hover': {
            backgroundColor: alpha(theme.palette.success.main, 0.2),
            ...theme.applyStyles('light', {
                backgroundColor: alpha(theme.palette.success.main, 0.12),
            }),
        },
    },
    '& .celestial-row-below': {
        backgroundColor: alpha(theme.palette.info.main, 0.1),
        borderLeftColor: alpha(theme.palette.info.main, 0.75),
        ...theme.applyStyles('light', {
            backgroundColor: alpha(theme.palette.info.main, 0.05),
            borderLeftColor: alpha(theme.palette.info.main, 0.5),
        }),
    },
    '& .celestial-row-dead': {
        backgroundColor: alpha(theme.palette.error.main, 0.18),
        borderLeftColor: alpha(theme.palette.error.main, 0.9),
        ...theme.applyStyles('light', {
            backgroundColor: alpha(theme.palette.error.main, 0.1),
            borderLeftColor: alpha(theme.palette.error.main, 0.65),
        }),
        '& .MuiDataGrid-cell': {
            color: theme.palette.text.secondary,
        },
    },
    '& .celestial-row-unknown': {
        borderLeftColor: alpha(theme.palette.text.secondary, 0.55),
    },
    '& .celestial-row-disabled .MuiDataGrid-cell': {
        color: theme.palette.text.disabled,
        textDecoration: 'line-through',
    },
    '& .celestial-row-selected': {
        backgroundColor: alpha(theme.palette.secondary.main, 0.25),
        borderLeftColor: alpha(theme.palette.secondary.main, 0.95),
        fontWeight: 'bold',
        ...theme.applyStyles('light', {
            backgroundColor: alpha(theme.palette.secondary.main, 0.12),
            borderLeftColor: alpha(theme.palette.secondary.main, 0.75),
        }),
        '&:hover': {
            backgroundColor: alpha(theme.palette.secondary.main, 0.3),
            ...theme.applyStyles('light', {
                backgroundColor: alpha(theme.palette.secondary.main, 0.16),
            }),
        },
    },
}));

const formatNumeric = (value, digits = 3) => {
    if (!Number.isFinite(value)) return '-';
    return Number(value).toFixed(digits);
};

const formatNumericUpTo = (value, maxDigits = 3) => {
    if (!Number.isFinite(value)) return '-';
    return Number(value)
        .toFixed(maxDigits)
        .replace(/\.?0+$/, '');
};

const formatLastRefresh = (value, timezone, locale, t) => {
    if (!value) return t('common.never');
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return t('common.unknown');
    const options = timezone ? { timeZone: timezone } : undefined;
    return parsed.toLocaleString(locale, options);
};

const formatAge = (value, nowMs, t) => {
    if (!value) return t('common.never');
    const parsed = new Date(value).getTime();
    if (!Number.isFinite(parsed)) return t('common.unknown');
    const diffSec = Math.max(0, Math.floor((nowMs - parsed) / 1000));
    if (diffSec < 60) return t('time.age.seconds', { count: diffSec });
    if (diffSec < 3600) return t('time.age.minutes', { count: Math.floor(diffSec / 60) });
    if (diffSec < 86400) return t('time.age.hours', { count: Math.floor(diffSec / 3600) });
    return t('time.age.days', { count: Math.floor(diffSec / 86400) });
};

const magnitude3 = (vector) => {
    if (!Array.isArray(vector) || vector.length < 3) return NaN;
    const [x, y, z] = vector;
    if (![x, y, z].every((v) => Number.isFinite(v))) return NaN;
    return Math.sqrt(x * x + y * y + z * z);
};

const computeProjectionSpan = (orbitSampling, t) => {
    const past = Number(orbitSampling?.past_hours);
    const future = Number(orbitSampling?.future_hours);
    const step = Number(orbitSampling?.step_minutes);
    if (!Number.isFinite(past) || !Number.isFinite(future) || !Number.isFinite(step)) {
        return '-';
    }
    return t('time.projection_span', { past, future, step });
};

const getVisibilityState = (visible, elevationDeg) => {
    if (typeof visible === 'boolean') {
        return visible ? 'visible' : 'below';
    }
    if (Number.isFinite(elevationDeg)) {
        return elevationDeg > 0 ? 'visible' : 'below';
    }
    return 'unknown';
};

const formatAngle = (value, digits = 1) => {
    if (!Number.isFinite(value)) return '-';
    return `${Number(value).toFixed(digits)}°`;
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

const MonitoredCelestialGridIsland = ({
    rows = [],
    toolbarContainer = null,
    loading = false,
    onRowDoubleClick = null,
    onTargetSelected = null,
    targetNumberByTargetKey = {},
}) => {
    const { t } = useTranslation('earthview');
    const { t: tCelestial } = useTranslation('celestial');
    const { t: tSat } = useTranslation('satellites');
    const { socket } = useSocket();
    const dispatch = useDispatch();
    const { requestRotatorForTarget, dialog: rotatorSelectionDialog } = useTargetRotatorSelectionDialog();
    const { timezone, locale } = useUserTimeSettings();
    const tracks = useSelector((state) => state.celestial?.celestialTracks?.celestial || []);
    const trackerInstances = useSelector((state) => state.trackerInstances?.instances || []);
    const { trackingState, trackerViews } = useSelector((state) => state.targetSatTrack || {});
    const {
        selectedIds,
        tableColumnVisibility,
        tablePageSize,
        tableSortModel,
    } = useSelector((state) => state.celestialMonitored);
    const [nowMs, setNowMs] = useState(() => Date.now());
    const [page, setPage] = useState(0);
    const [rowContextMenu, setRowContextMenu] = useState(null);
    const [transmittersDialogOpen, setTransmittersDialogOpen] = useState(false);
    const [transmittersDialogData, setTransmittersDialogData] = useState(null);
    const [propertiesTarget, setPropertiesTarget] = useState(null);
    const [propertiesSaving, setPropertiesSaving] = useState(false);
    const [propertiesError, setPropertiesError] = useState('');
    const [vectorTarget, setVectorTarget] = useState(null);
    const [unmonitorTarget, setUnmonitorTarget] = useState(null);
    const [unmonitoring, setUnmonitoring] = useState(false);
    const elevationHistoryByTargetKeyRef = useRef({});
    const rowSelectionModel = useMemo(() => toRowSelectionModel(selectedIds), [selectedIds]);
    const currentlyTrackedTargetKey = useMemo(() => buildTrackingTargetKey(trackingState), [trackingState]);

    useEffect(() => {
        const interval = setInterval(() => setNowMs(Date.now()), 30000);
        return () => clearInterval(interval);
    }, []);

    const trackByTargetKey = useMemo(() => {
        const entries = Array.isArray(tracks) ? tracks : [];
        return entries.reduce((acc, track) => {
            const key = buildTargetKeyFromCelestialRow(track);
            if (key) acc[key] = track;
            return acc;
        }, {});
    }, [tracks]);

    const elevationTrendByTargetKey = useMemo(() => {
        const historyByTargetKey = elevationHistoryByTargetKeyRef.current;
        const nextTrendByTargetKey = {};
        const activeTargetKeys = new Set();
        const entries = Array.isArray(tracks) ? tracks : [];

        entries.forEach((track) => {
            const targetKey = buildTargetKeyFromCelestialRow(track);
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

    const enrichedRows = useMemo(
        () =>
            (rows || []).map((row) => {
                const targetKey = buildTargetKeyFromCelestialRow(row);
                const track = trackByTargetKey[targetKey] || {};
                const targetType = String(row.targetType || row.target_type || 'mission').toLowerCase();
                const distanceAu = magnitude3(track.position_xyz_au);
                const speedAuPerDay = magnitude3(track.velocity_xyz_au_per_day);
                const speedKmS = Number.isFinite(speedAuPerDay) ? speedAuPerDay * AU_PER_DAY_TO_KM_PER_S : NaN;
                const lightTimeMin = Number.isFinite(distanceAu) ? distanceAu * LIGHT_TIME_MIN_PER_AU : NaN;
                const sampleCount = Array.isArray(track.orbit_samples_xyz_au) ? track.orbit_samples_xyz_au.length : 0;
                const rawElevationDeg = Number(track?.sky_position?.el_deg);
                const rawAzimuthDeg = Number(track?.sky_position?.az_deg);
                const elevationDeg = Number.isFinite(rawElevationDeg) ? rawElevationDeg : null;
                const azimuthDeg = Number.isFinite(rawAzimuthDeg) ? rawAzimuthDeg : null;
                const elevationTrend = elevationTrendByTargetKey[targetKey] || {};
                const visibility = getVisibilityState(track?.visibility?.visible, rawElevationDeg);
                const targetIdentifier = targetType === 'body'
                    ? String(row.bodyId || row.body_id || row.command || '').trim().toLowerCase()
                    : String(row.command || row.mission_id || row.missionId || '').trim();
                return {
                    ...row,
                    targetType,
                    targetKey,
                    targetIdentifier,
                    missionId: String(row.mission_id || row.missionId || '').trim().toLowerCase(),
                    command: String(row.command || '').trim(),
                    bodyId: String(row.bodyId || row.body_id || '').trim().toLowerCase(),
                    transmitters: Array.isArray(row?.transmitters)
                        ? row.transmitters
                        : (Array.isArray(track?.transmitters) ? track.transmitters : []),
                    color: row.color || track.color || null,
                    source: track.source || '-',
                    sourceMode: row.sourceMode || row.source_mode || (targetType === 'body' ? 'static-body' : '-'),
                    visibility,
                    elevationDeg,
                    elevationTrend: elevationTrend.trend || null,
                    elevationRate: Number.isFinite(elevationTrend.elRate) ? elevationTrend.elRate : null,
                    azimuthDeg,
                    distanceFromSunAu: distanceAu,
                    speedKmS,
                    lightTimeMinutes: lightTimeMin,
                    lastRefreshAge: formatAge(row.lastRefreshAt, nowMs, tCelestial),
                    projectionSpan: computeProjectionSpan(
                        {
                            past_hours: row.projectionPastHours,
                            future_hours: row.projectionFutureHours,
                            step_minutes: row.projectionStepMinutes,
                        },
                        tCelestial,
                    ),
                    cacheStatus: track.cache || '-',
                    stale: track.stale ? tCelestial('common.yes') : tCelestial('common.no'),
                    sampleCount,
                };
            }),
        [rows, trackByTargetKey, elevationTrendByTargetKey, nowMs, tCelestial],
    );
    const applyTargetSelection = useCallback((rawId) => {
        if (rawId == null) return;
        const selectedRow = enrichedRows.find((row) => String(row.id) === String(rawId));
        if (!selectedRow) return;
        dispatch(setSelectedMonitoredIds([selectedRow.id]));
        if (onTargetSelected) {
            onTargetSelected(selectedRow);
        }
    }, [dispatch, enrichedRows, onTargetSelected]);

    const openPropertiesDialog = useCallback((row) => {
        setPropertiesError('');
        setPropertiesTarget({
            ...row,
            projectionPastHours: Number(row.projectionPastHours || 1),
            projectionFutureHours: Number(row.projectionFutureHours || 24),
            projectionStepMinutes: Number(row.projectionStepMinutes || 60),
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

    const refreshVectorTarget = useCallback(async (id) => {
        if (!socket || !id) return;
        await dispatch(refreshMonitoredCelestialNow({ socket, ids: [id] })).unwrap();
        await dispatch(fetchMonitoredCelestial({ socket })).unwrap();
    }, [dispatch, socket]);

    const confirmUnmonitor = useCallback(async () => {
        if (!socket || !unmonitorTarget?.id || unmonitoring) return;
        setUnmonitoring(true);
        try {
            await dispatch(deleteMonitoredCelestial({
                socket,
                ids: [unmonitorTarget.id],
            })).unwrap();
            toast.success(tCelestial('admin.catalog.feedback.unmonitored', {
                name: unmonitorTarget.displayName || unmonitorTarget.targetIdentifier || '',
            }));
            setUnmonitorTarget(null);
        } catch (error) {
            toast.error(error?.message || error?.error || tCelestial('errors.unknown_error'));
        } finally {
            setUnmonitoring(false);
        }
    }, [dispatch, socket, tCelestial, unmonitorTarget, unmonitoring]);

    const columns = useMemo(
        () => [
            {
                field: 'displayName',
                headerName: tCelestial('monitored.columns.name'),
                minWidth: 170,
                flex: 1,
                renderCell: (params) => (
                    <Box
                        sx={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'flex-start',
                            width: '100%',
                            height: '100%',
                            minWidth: 0,
                            gap: 0.75,
                        }}
                    >
                        {(() => {
                            const targetKey = String(params.row?.targetKey || '').trim();
                            const targetNumber = Number(targetNumberByTargetKey?.[targetKey]);
                            if (!Number.isFinite(targetNumber) || targetNumber <= 0) return null;
                            return (
                                <TargetNumberIcon
                                    targetNumber={targetNumber}
                                    prefix="T"
                                    size={16}
                                    sx={{ flexShrink: 0 }}
                                />
                            );
                        })()}
                        {(() => {
                            const value = String(params.row?.color || '').trim();
                            const valid = /^#[0-9A-Fa-f]{6}$/.test(value);
                            const swatchColor = valid ? value : 'transparent';
                            return (
                                <Box
                                    sx={{
                                        width: 12,
                                        height: 12,
                                        borderRadius: '3px',
                                        border: '1px solid',
                                        borderColor: 'divider',
                                        bgcolor: swatchColor,
                                        flexShrink: 0,
                                    }}
                                    title={valid ? value.toUpperCase() : tCelestial('monitored.no_color')}
                                />
                            );
                        })()}
                        <Typography
                            component="span"
                            variant="body2"
                            sx={{
                                fontWeight: 700,
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                lineHeight: 1.2,
                                minWidth: 0,
                            }}
                        >
                            {params?.value || '-'}
                        </Typography>
                    </Box>
                ),
            },
            {
                field: 'targetType',
                headerName: tCelestial('monitored.columns.type'),
                minWidth: 95,
                valueGetter: (value) => (
                    String(value || '').toLowerCase() === 'body' ? tCelestial('common.body') : tCelestial('common.mission')
                ),
            },
            {
                field: 'command',
                headerName: tCelestial('monitored.columns.target_id'),
                minWidth: 170,
                flex: 1,
                valueGetter: (value, row) =>
                    String(row?.targetType || '').toLowerCase() === 'body' ? (row?.bodyId || value) : value,
            },
            { field: 'source', headerName: tCelestial('monitored.columns.source'), minWidth: 110, flex: 0.7 },
            { field: 'sourceMode', headerName: tCelestial('monitored.columns.source_mode'), minWidth: 120, flex: 0.8 },
            {
                field: 'elevationDeg',
                width: 92,
                minWidth: 92,
                headerName: tCelestial('monitored.columns.elevation'),
                type: 'number',
                align: 'center',
                headerAlign: 'center',
                renderCell: (params) => (
                    <ElevationDisplay
                        elevation={params.row?.elevationDeg}
                        trend={params.row?.elevationTrend}
                        elRate={params.row?.elevationRate}
                        showNegative={true}
                        decimalPlaces={2}
                    />
                ),
            },
            {
                field: 'azimuthDeg',
                type: 'number',
                width: 90,
                minWidth: 90,
                headerName: tCelestial('monitored.columns.azimuth'),
                align: 'center',
                headerAlign: 'center',
                valueFormatter: (value) => formatAngle(value, 2),
            },
            {
                field: 'distanceFromSunAu',
                type: 'number',
                headerName: tCelestial('monitored.columns.distance_from_sun_au'),
                width: 100,
                minWidth: 100,
                valueFormatter: (value) => {
                    const formatted = formatNumericUpTo(value, 3);
                    return formatted === '-' ? formatted : `${formatted} ${tCelestial('units.au')}`;
                },
            },
            {
                field: 'speedKmS',
                type: 'number',
                headerName: tCelestial('monitored.columns.speed_km_s'),
                width: 100,
                minWidth: 100,
                valueFormatter: (value) => {
                    const formatted = formatNumeric(value, 3);
                    return formatted === '-' ? formatted : `${formatted} ${tCelestial('units.km_per_s')}`;
                },
            },
            {
                field: 'lightTimeMinutes',
                type: 'number',
                headerName: tCelestial('monitored.columns.light_time_min'),
                width: 90,
                minWidth: 90,
                valueFormatter: (value) => formatNumeric(value, 2),
            },
            { field: 'lastRefreshAge', headerName: tCelestial('monitored.columns.refresh_age'), width: 70, minWidth: 70 },
            {
                field: 'projectionSpan',
                headerName: tCelestial('monitored.columns.projection_span'),
                minWidth: 170,
                renderCell: (params) => (
                    <Button
                        size="small"
                        variant="text"
                        onClick={(event) => {
                            event.stopPropagation();
                            openPropertiesDialog(params.row);
                        }}
                        sx={{ fontFamily: 'monospace', textTransform: 'none' }}
                    >
                        {params.value}
                    </Button>
                ),
            },
            { field: 'cacheStatus', headerName: tCelestial('monitored.columns.cache'), minWidth: 90 },
            { field: 'stale', headerName: tCelestial('monitored.columns.stale'), minWidth: 80 },
            { field: 'sampleCount', headerName: tCelestial('monitored.columns.samples'), minWidth: 90, type: 'number' },
            {
                field: 'lastError',
                headerName: tCelestial('monitored.columns.last_error'),
                minWidth: 250,
                flex: 1.2,
                valueGetter: (value) => value || '-',
            },
            {
                field: 'lastRefreshAt',
                headerName: tCelestial('monitored.columns.last_refresh'),
                minWidth: 185,
                valueGetter: (value) => formatLastRefresh(value, timezone, locale, tCelestial),
            },
        ],
        [timezone, locale, openPropertiesDialog, targetNumberByTargetKey, tCelestial],
    );

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

    // Bind context-menu directly on each row for consistent browser behavior.
    const handleRowContextMenu = useCallback((event) => {
        const rowId = event.currentTarget?.getAttribute?.('data-id');
        if (!rowId) return;
        const row = enrichedRows.find((entry) => String(entry?.id) === String(rowId));
        if (!row) return;
        event.preventDefault();
        event.stopPropagation();
        // Match earth-view UX: right-click again closes an already open menu.
        if (rowContextMenu) {
            setRowContextMenu(null);
            return;
        }
        applyTargetSelection(row.id);
        setRowContextMenu({
            mouseX: event.clientX + 2,
            mouseY: event.clientY - 6,
            row,
        });
    }, [applyTargetSelection, enrichedRows, rowContextMenu]);

    const handleRowMenuAction = useCallback(async (action) => {
        const row = rowContextMenu?.row;
        if (!row) return;
        try {
            if (action === 'set-target') {
                const targetType = String(row.targetType || '').toLowerCase() === 'body' ? 'body' : 'mission';
                const missionCommand = String(row.command || row.targetIdentifier || '').trim();
                const missionId = String(row.missionId || '').trim().toLowerCase();
                const bodyId = String(row.bodyId || row.targetIdentifier || '').trim().toLowerCase();
                const isTargetable = targetType === 'body' ? Boolean(bodyId) : Boolean(missionCommand);
                if (!socket || !isTargetable) {
                    return;
                }
                const selectedAssignment = await requestRotatorForTarget(row.displayName || row.targetIdentifier || row.targetKey);
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
                        target_name: row.displayName || bodyId,
                        body_id: bodyId,
                        mission_id: null,
                        command: null,
                    }
                    : {
                        target_type: 'mission',
                        target_name: row.displayName || missionCommand,
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
                    name: row.displayName || row.targetIdentifier || row.targetKey || '',
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
                setVectorTarget(row);
                return;
            }
            if (action === 'unmonitor') {
                setUnmonitorTarget(row);
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
                    row.displayName || '-',
                    row.targetType === 'body'
                        ? `${tCelestial('common.body')} ${row.targetIdentifier || '-'}`
                        : `${tCelestial('common.mission')} ${row.targetIdentifier || '-'}`,
                    `${tCelestial('monitored.summary.source')} ${row.source || '-'}`,
                    `${tCelestial('monitored.summary.mode')} ${row.sourceMode || '-'}`,
                ].join(' | ');
                await copyTextToClipboard(summary);
            }
        } catch (error) {
            toast.error(`${t('satellite_info.failed_tracking')}: ${error?.message || error?.error || tCelestial('errors.unknown_error')}`);
        } finally {
            setRowContextMenu(null);
        }
    }, [
        applyTargetSelection,
        copyTextToClipboard,
        dispatch,
        openPropertiesDialog,
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
        const targetType = String(row.targetType || '').toLowerCase() === 'body' ? 'body' : 'mission';
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
                disabled: !socket,
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
                label: row.targetType === 'body'
                    ? tCelestial('context.copy_body_id')
                    : tCelestial('context.copy_mission_command'),
                icon: <ContentCopyOutlinedIcon />,
                onClick: () => handleRowMenuAction('copy-identifier'),
            },
            { key: 'copy-target-key', label: tCelestial('context.copy_target_key'), icon: <KeyOutlinedIcon />, onClick: () => handleRowMenuAction('copy-target-key') },
            { key: 'copy-summary', label: tCelestial('context.copy_target_summary'), icon: <SummarizeOutlinedIcon />, onClick: () => handleRowMenuAction('copy-summary') },
            { type: 'divider', key: 'divider-unmonitor' },
            {
                key: 'unmonitor',
                label: tCelestial('admin.catalog.actions.unmonitor'),
                icon: <VisibilityOffOutlinedIcon />,
                disabled: !socket || unmonitoring,
                onClick: () => handleRowMenuAction('unmonitor'),
            },
        ];
    }, [currentlyTrackedTargetKey, handleRowMenuAction, rowContextMenu?.row, socket, t, tCelestial, unmonitoring]);

    return (
        <>
            {rotatorSelectionDialog}
            <Box sx={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <Box sx={{ width: '100%', flex: 1, minHeight: 0 }}>
                <StyledDataGrid
                    showToolbar
                    slots={{ toolbar: GridTableToolbar }}
                    rows={enrichedRows}
                    columns={columns}
                    getRowId={(row) => row.id}
                    loading={loading}
                    disableMultipleRowSelection
                    disableRowSelectionOnClick={false}
                    rowSelectionModel={rowSelectionModel}
                    onRowSelectionModelChange={(nextSelection) => {
                        const selected = toSelectedIds(nextSelection);
                        const selectedId = selected.length ? selected[0] : null;
                        // Keep one-target behavior deterministic: ignore transient de-select events
                        // and only update when we have an actual row target.
                        if (selectedId == null) return;
                        applyTargetSelection(selectedId);
                    }}
                    // Row click must also trigger focus. A newly added target can already be selected
                    // in state, so selection-change callbacks may not fire on first user click.
                    onRowClick={(params) => {
                        applyTargetSelection(params?.row?.id);
                    }}
                    onRowDoubleClick={(params) => {
                        if (onRowDoubleClick) {
                            onRowDoubleClick(params?.row || null);
                        }
                    }}
                    slotProps={{
                        toolbar: { container: toolbarContainer },
                        row: {
                            onContextMenu: handleRowContextMenu,
                        },
                    }}
                    density="compact"
                    columnVisibilityModel={tableColumnVisibility}
                    onColumnVisibilityModelChange={(model) => dispatch(setMonitoredTableColumnVisibility(model))}
                    paginationModel={{ pageSize: tablePageSize, page }}
                    onPaginationModelChange={(model) => {
                        setPage(model.page);
                        dispatch(setMonitoredTablePageSize(model.pageSize));
                    }}
                    pageSizeOptions={[5, 10, 15, 20, 25]}
                    sortModel={tableSortModel}
                    onSortModelChange={(model) => dispatch(setMonitoredTableSortModel(model))}
                    getRowClassName={(params) => {
                        const classes = ['pointer-cursor'];
                        if (params.row.enabled === false) {
                            classes.push('celestial-row-disabled');
                        }
                        if ((selectedIds || [])[0] === params.row.id) {
                            classes.push('celestial-row-selected');
                        } else if (params.row.lastError && params.row.lastError !== '-') {
                            classes.push('celestial-row-dead');
                        } else if (params.row.visibility === 'visible') {
                            classes.push('celestial-row-visible');
                        } else if (params.row.visibility === 'below') {
                            classes.push('celestial-row-below');
                        } else {
                            classes.push('celestial-row-unknown');
                        }
                        return classes.join(' ');
                    }}
                    sx={{
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
                title={rowContextMenu?.row?.displayName || '-'}
                targetType={rowContextMenu?.row?.targetType || 'mission'}
                targetIdentifier={rowContextMenu?.row?.targetIdentifier || '-'}
                items={rowContextMenuItems}
            />
            <TransmittersDialog
                open={transmittersDialogOpen}
                onClose={() => setTransmittersDialogOpen(false)}
                title={tSat('satellite_database.edit_transmitters_title', {
                    name: transmittersDialogData?.name || rowContextMenu?.row?.displayName || '',
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
                onRefresh={refreshVectorTarget}
            />
            <Dialog
                open={Boolean(unmonitorTarget)}
                onClose={() => {
                    if (!unmonitoring) setUnmonitorTarget(null);
                }}
                maxWidth="xs"
                fullWidth
                PaperProps={{ sx: DIALOG_PAPER_SX }}
            >
                <DialogTitle sx={DIALOG_TITLE_SX}>
                    {tCelestial('admin.catalog.confirm.title')}
                </DialogTitle>
                <DialogContent sx={DIALOG_CONTENT_SX}>
                    <Typography variant="body1" sx={{ mt: 1, mb: 1 }}>
                        {tCelestial('admin.catalog.confirm.question', {
                            target: unmonitorTarget?.displayName
                                || unmonitorTarget?.targetIdentifier
                                || tCelestial('admin.catalog.confirm.this_target'),
                        })}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                        {tCelestial('admin.catalog.confirm.description')}
                    </Typography>
                </DialogContent>
                <DialogActions sx={DIALOG_ACTIONS_SX}>
                    <Button
                        variant="outlined"
                        onClick={() => setUnmonitorTarget(null)}
                        disabled={unmonitoring}
                    >
                        {tCelestial('admin.common.cancel')}
                    </Button>
                    <Button
                        variant="contained"
                        color="error"
                        onClick={confirmUnmonitor}
                        disabled={!socket || !unmonitorTarget?.id || unmonitoring}
                    >
                        {tCelestial('admin.catalog.actions.unmonitor')}
                    </Button>
                </DialogActions>
            </Dialog>
            </Box>
        </>
    );
};

export default React.memo(MonitoredCelestialGridIsland);
