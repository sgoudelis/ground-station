import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DataGrid, gridClasses } from '@mui/x-data-grid';
import { alpha, styled } from '@mui/material/styles';
import {
    Box,
    Button,
    Checkbox,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    Divider,
    FormControl,
    FormControlLabel,
    FormGroup,
    InputLabel,
    MenuItem,
    Select,
    Typography,
} from '@mui/material';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import {
    MONITORED_TABLE_DEFAULT_COLUMN_VISIBILITY,
    MONITORED_TABLE_DEFAULT_PAGE_SIZE,
    MONITORED_TABLE_DEFAULT_SORT_MODEL,
    setSelectedMonitoredIds,
    setMonitoredTableColumnVisibility,
    setMonitoredTablePageSize,
    setMonitoredTableSortModel,
    setOpenGridSettingsDialog,
} from './monitored-slice.jsx';
import { toRowSelectionModel, toSelectedIds } from '../../utils/datagrid-selection.js';
import { useUserTimeSettings } from '../../hooks/useUserTimeSettings.jsx';
import TargetNumberIcon from '../common/target-number-icon.jsx';
import { buildTargetKeyFromCelestialRow } from '../target/celestial-target-utils.js';
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
const FOOTER_ACTION_ROW_SX = {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    gap: 1,
    overflowX: 'auto',
    msOverflowStyle: 'none',
    scrollbarWidth: 'none',
    '&::-webkit-scrollbar': { display: 'none' },
    '& > *': {
        flexShrink: 0,
        whiteSpace: 'nowrap',
    },
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
    if (targetType === 'body') {
        const bodyId = String(trackingState?.body_id || '').trim().toLowerCase();
        return bodyId ? `body:${bodyId}` : '';
    }
    if (targetType === 'mission') {
        const command = String(trackingState?.command || '').trim();
        return command ? `mission:${command}` : '';
    }
    return '';
};

const SettingsDialog = ({ open, onClose }) => {
    const dispatch = useDispatch();
    const { t } = useTranslation('celestial');
    const columnVisibility = useSelector((state) => state.celestialMonitored.tableColumnVisibility);
    const tablePageSize = useSelector((state) => state.celestialMonitored.tablePageSize);
    const handleResetValues = useCallback(() => {
        dispatch(setMonitoredTableColumnVisibility({ ...MONITORED_TABLE_DEFAULT_COLUMN_VISIBILITY }));
        dispatch(setMonitoredTablePageSize(MONITORED_TABLE_DEFAULT_PAGE_SIZE));
        dispatch(setMonitoredTableSortModel([...MONITORED_TABLE_DEFAULT_SORT_MODEL]));
    }, [dispatch]);

    const columns = [
        { name: 'displayName', label: t('monitored.columns.name'), category: 'identity', alwaysVisible: true },
        { name: 'targetType', label: t('monitored.columns.type'), category: 'identity' },
        { name: 'command', label: t('monitored.columns.target_id'), category: 'identity' },
        { name: 'source', label: t('monitored.columns.source'), category: 'identity' },
        { name: 'sourceMode', label: t('monitored.columns.source_mode'), category: 'identity' },
        { name: 'elevationDeg', label: t('monitored.columns.elevation'), category: 'state' },
        { name: 'azimuthDeg', label: t('monitored.columns.azimuth'), category: 'state' },
        { name: 'distanceFromSunAu', label: t('monitored.columns.distance_from_sun_au'), category: 'metrics' },
        { name: 'speedKmS', label: t('monitored.columns.speed_km_s'), category: 'metrics' },
        { name: 'lightTimeMinutes', label: t('monitored.columns.light_time_min'), category: 'metrics' },
        { name: 'lastRefreshAt', label: t('monitored.columns.last_refresh'), category: 'state' },
        { name: 'lastRefreshAge', label: t('monitored.columns.refresh_age'), category: 'state' },
        { name: 'projectionSpan', label: t('monitored.columns.projection_span'), category: 'projection' },
        { name: 'cacheStatus', label: t('monitored.columns.cache'), category: 'projection' },
        { name: 'stale', label: t('monitored.columns.stale'), category: 'projection' },
        { name: 'sampleCount', label: t('monitored.columns.samples'), category: 'projection' },
        { name: 'lastError', label: t('monitored.columns.last_error'), category: 'state' },
    ];

    const categories = {
        identity: t('monitored.settings.categories.identity'),
        state: t('monitored.settings.categories.state'),
        metrics: t('monitored.settings.categories.metrics'),
        projection: t('monitored.settings.categories.projection'),
    };

    const columnsByCategory = {
        identity: columns.filter((col) => col.category === 'identity'),
        state: columns.filter((col) => col.category === 'state'),
        metrics: columns.filter((col) => col.category === 'metrics'),
        projection: columns.filter((col) => col.category === 'projection'),
    };

    return (
        <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth PaperProps={{ sx: DIALOG_PAPER_SX }}>
            <DialogTitle sx={DIALOG_TITLE_SX}>{t('monitored.settings.title')}</DialogTitle>
            <DialogContent sx={DIALOG_CONTENT_SX}>
                <Box sx={{ mb: 2 }}>
                    <FormControl fullWidth size="small" sx={{ mt: 2 }}>
                        <InputLabel id="celestial-table-rows-label">{t('monitored.settings.rows_per_page')}</InputLabel>
                        <Select
                            labelId="celestial-table-rows-label"
                            value={tablePageSize}
                            label={t('monitored.settings.rows_per_page')}
                            onChange={(event) => dispatch(setMonitoredTablePageSize(event.target.value))}
                        >
                            {[5, 10, 15, 20, 25].map((option) => (
                                <MenuItem key={option} value={option}>
                                    {option}
                                </MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                    <Divider sx={{ mt: 2 }} />
                </Box>

                {Object.entries(columnsByCategory).map(([category, cols]) => (
                    <Box key={category} sx={{ mb: 2 }}>
                        <Typography variant="subtitle2" sx={{ fontWeight: 'bold', mb: 1 }}>
                            {categories[category]}
                        </Typography>
                        <FormGroup>
                            {cols.map((column) => (
                                <FormControlLabel
                                    key={column.name}
                                    control={
                                        <Checkbox
                                            checked={column.alwaysVisible || columnVisibility[column.name] !== false}
                                            onChange={() =>
                                                dispatch(
                                                    setMonitoredTableColumnVisibility({
                                                        ...columnVisibility,
                                                        [column.name]: !columnVisibility[column.name],
                                                    }),
                                                )
                                            }
                                            disabled={column.alwaysVisible}
                                        />
                                    }
                                    label={column.label}
                                />
                            ))}
                        </FormGroup>
                        <Divider sx={{ mt: 1 }} />
                    </Box>
                ))}
            </DialogContent>
            <DialogActions sx={DIALOG_ACTIONS_SX}>
                <Box sx={FOOTER_ACTION_ROW_SX}>
                    <Button onClick={handleResetValues} variant="outlined">
                        {t('monitored.settings.reset_values')}
                    </Button>
                    <Box sx={{ flex: 1, minWidth: 8 }} />
                    <Button onClick={onClose} variant="contained">
                        {t('monitored.settings.close')}
                    </Button>
                </Box>
            </DialogActions>
        </Dialog>
    );
};

const MonitoredCelestialGridIsland = ({
    rows = [],
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
        openGridSettingsDialog,
    } = useSelector((state) => state.celestialMonitored);
    const [nowMs, setNowMs] = useState(() => Date.now());
    const [page, setPage] = useState(0);
    const [rowContextMenu, setRowContextMenu] = useState(null);
    const [transmittersDialogOpen, setTransmittersDialogOpen] = useState(false);
    const [transmittersDialogData, setTransmittersDialogData] = useState(null);
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
                    projectionSpan: computeProjectionSpan(track.orbit_sampling, tCelestial),
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
                    />
                ),
            },
            {
                field: 'azimuthDeg',
                width: 90,
                minWidth: 90,
                headerName: tCelestial('monitored.columns.azimuth'),
                align: 'center',
                headerAlign: 'center',
                valueGetter: (value) => formatAngle(value, 2),
            },
            {
                field: 'distanceFromSunAu',
                headerName: tCelestial('monitored.columns.distance_from_sun_au'),
                width: 100,
                minWidth: 100,
                valueGetter: (value) => {
                    const formatted = formatNumericUpTo(value, 3);
                    return formatted === '-' ? formatted : `${formatted} ${tCelestial('units.au')}`;
                },
            },
            {
                field: 'speedKmS',
                headerName: tCelestial('monitored.columns.speed_km_s'),
                width: 100,
                minWidth: 100,
                valueGetter: (value) => {
                    const formatted = formatNumeric(value, 3);
                    return formatted === '-' ? formatted : `${formatted} ${tCelestial('units.km_per_s')}`;
                },
            },
            {
                field: 'lightTimeMinutes',
                headerName: tCelestial('monitored.columns.light_time_min'),
                width: 90,
                minWidth: 90,
                valueGetter: (value) => formatNumeric(value, 2),
            },
            { field: 'lastRefreshAge', headerName: tCelestial('monitored.columns.refresh_age'), width: 70, minWidth: 70 },
            { field: 'projectionSpan', headerName: tCelestial('monitored.columns.projection_span'), minWidth: 150 },
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
        [timezone, locale, targetNumberByTargetKey, tCelestial],
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

                const targetPatch = targetType === 'body'
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
                    };

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
                disabled: !socket || !isTargetable || isCurrentlyTargeted,
                onClick: () => handleRowMenuAction('set-target'),
            },
            {
                key: 'edit-transmitters',
                label: t('satellites_table.context_menu.edit_transmitters'),
                disabled: !row?.targetKey,
                onClick: () => handleRowMenuAction('edit-transmitters'),
            },
            { type: 'divider', key: 'divider-copy' },
            {
                key: 'copy-identifier',
                label: row.targetType === 'body'
                    ? tCelestial('context.copy_body_id')
                    : tCelestial('context.copy_mission_command'),
                onClick: () => handleRowMenuAction('copy-identifier'),
            },
            { key: 'copy-target-key', label: tCelestial('context.copy_target_key'), onClick: () => handleRowMenuAction('copy-target-key') },
            { key: 'copy-summary', label: tCelestial('context.copy_target_summary'), onClick: () => handleRowMenuAction('copy-summary') },
        ];
    }, [currentlyTrackedTargetKey, handleRowMenuAction, rowContextMenu?.row, socket, t, tCelestial]);

    return (
        <>
            {rotatorSelectionDialog}
            <Box sx={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <Box sx={{ width: '100%', flex: 1, minHeight: 0 }}>
                <StyledDataGrid
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
                        if ((selectedIds || [])[0] === params.row.id) {
                            return 'celestial-row-selected pointer-cursor';
                        }
                        if (params.row.lastError && params.row.lastError !== '-') {
                            return 'celestial-row-dead pointer-cursor';
                        }
                        if (params.row.visibility === 'visible') {
                            return 'celestial-row-visible pointer-cursor';
                        }
                        if (params.row.visibility === 'below') {
                            return 'celestial-row-below pointer-cursor';
                        }
                        return 'celestial-row-unknown pointer-cursor';
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
            <SettingsDialog
                open={openGridSettingsDialog}
                onClose={() => dispatch(setOpenGridSettingsDialog(false))}
            />
            </Box>
        </>
    );
};

export default React.memo(MonitoredCelestialGridIsland);
