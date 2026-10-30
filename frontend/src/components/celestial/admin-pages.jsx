/**
 * @license
 * Copyright (c) 2025 Efstratios Goudelis
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Alert,
    AlertTitle,
    Box,
    Button,
    Chip,
    CircularProgress,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    FormControl,
    IconButton,
    InputAdornment,
    InputLabel,
    LinearProgress,
    MenuItem,
    Paper,
    Select,
    Stack,
    Switch,
    TextField,
    Tooltip,
    Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import {
    DataGrid,
    gridClasses,
    gridPageCountSelector,
    useGridApiContext,
    useGridSelector,
} from '@mui/x-data-grid';
import MuiPagination from '@mui/material/Pagination';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import CloudOffIcon from '@mui/icons-material/CloudOff';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import EditIcon from '@mui/icons-material/Edit';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import Brightness2OutlinedIcon from '@mui/icons-material/Brightness2Outlined';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import PendingActionsIcon from '@mui/icons-material/PendingActions';
import RefreshIcon from '@mui/icons-material/Refresh';
import RocketLaunchOutlinedIcon from '@mui/icons-material/RocketLaunchOutlined';
import SearchIcon from '@mui/icons-material/Search';
import ClearIcon from '@mui/icons-material/Clear';
import SettingsInputAntennaIcon from '@mui/icons-material/SettingsInputAntenna';
import StorageIcon from '@mui/icons-material/Storage';
import SyncIcon from '@mui/icons-material/Sync';
import TimelineIcon from '@mui/icons-material/Timeline';
import PublicIcon from '@mui/icons-material/Public';
import PublicOutlinedIcon from '@mui/icons-material/PublicOutlined';
import ToggleOffIcon from '@mui/icons-material/ToggleOff';
import ToggleOnIcon from '@mui/icons-material/ToggleOn';
import TripOriginIcon from '@mui/icons-material/TripOrigin';
import VisibilityOffOutlinedIcon from '@mui/icons-material/VisibilityOffOutlined';
import WbSunnyOutlinedIcon from '@mui/icons-material/WbSunnyOutlined';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { useSocket } from '../common/socket.jsx';
import { humanizeDate } from '../common/common.jsx';
import ErrorDialog from '../common/error-dialog.jsx';
import {
    createMonitoredCelestial,
    deleteMonitoredCelestial,
    fetchMonitoredCelestial,
    toggleMonitoredCelestialEnabled,
    updateMonitoredCelestial,
} from './monitored-slice.jsx';
import {
    refreshMonitoredCelestialNow,
    setCelestialEphemerisStatus,
    setCelestialEphemerisSyncCompleted,
    setCelestialEphemerisSyncFailed,
    setCelestialEphemerisSyncProgress,
    setCelestialEphemerisSyncStarted,
} from './celestial-slice.jsx';
import { buildEphemerisSyncFailure, describeHorizonsFailure } from './ephemeris-errors.js';
import { toRowSelectionModel, toSelectedIds } from '../../utils/datagrid-selection.js';
import { useUserTimeSettings } from '../../hooks/useUserTimeSettings.jsx';
import CelestialEditDialog from './celestialeditdialog.jsx';
import VectorCoverageDialog from './vector-coverage-dialog.jsx';
import TransmittersDialog from '../satellites/transmitters-dialog.jsx';

const PAGE_PAPER_SX = { padding: 2, marginTop: 0, borderRadius: 0 };
const DATA_GRID_SX = {
    border: 0,
    marginTop: 0,
    minHeight: 420,
    '& .MuiDataGrid-cell': {
        display: 'flex',
        alignItems: 'center',
        py: 0.5,
    },
    [`& .${gridClasses.cell}:focus, & .${gridClasses.cell}:focus-within`]: {
        outline: 'none',
    },
    [`& .${gridClasses.columnHeader}:focus, & .${gridClasses.columnHeader}:focus-within`]: {
        outline: 'none',
    },
    '& .MuiDataGrid-columnHeaders': {
        backgroundColor: (theme) => alpha(
            theme.palette.primary.main,
            theme.palette.mode === 'dark' ? 0.18 : 0.10,
        ),
        // Keep the separator inside MUI's measured header height to avoid wheel-catching overflow.
        borderBottom: 0,
        boxShadow: (theme) => `inset 0 -2px 0 ${alpha(theme.palette.primary.main, 0.45)}`,
    },
    '& .MuiDataGrid-columnHeader': {
        backgroundColor: 'transparent',
    },
    '& .MuiDataGrid-columnHeaderTitle': {
        fontSize: '0.8125rem',
        fontWeight: 700,
        letterSpacing: '0.02em',
    },
    '& .MuiDataGrid-overlay': {
        fontSize: '0.875rem',
        fontStyle: 'italic',
        color: 'text.secondary',
    },
};

const apiCall = (socket, cmd, data = null, t = null) => new Promise((resolve, reject) => {
    if (!socket) {
        reject(new Error(t
            ? t('admin.common.no_backend_connection')
            : 'No active backend connection.'));
        return;
    }
    socket.emit('api.call', { cmd, data }, (response) => {
        if (response?.success) {
            resolve(response.data);
            return;
        }
        const error = new Error(response?.error || (t
            ? t('admin.common.command_failed', { command: cmd })
            : `Command ${cmd} failed.`));
        error.response = response;
        reject(error);
    });
});

const formatDateTime = (value, timezone, locale, t = null) => {
    if (!value) return t ? t('common.never') : 'Never';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return t ? t('common.unknown') : 'Unknown';
    const options = timezone ? { timeZone: timezone } : undefined;
    return date.toLocaleString(locale, options);
};

function ResponsiveActionButton({ label, icon, ...buttonProps }) {
    return (
        <Button
            {...buttonProps}
            aria-label={label}
            startIcon={icon}
            sx={{
                minWidth: { xs: 40, sm: 64 },
                px: { xs: 1, sm: 2 },
                '& .MuiButton-startIcon': {
                    mr: { xs: 0, sm: 1 },
                    ml: { xs: 0, sm: -0.5 },
                },
            }}
        >
            <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>
                {label}
            </Box>
        </Button>
    );
}

function CatalogPagination({ page, onPageChange, className }) {
    const apiRef = useGridApiContext();
    const pageCount = useGridSelector(apiRef, gridPageCountSelector);
    const [gridWidth, setGridWidth] = useState(0);

    useEffect(() => {
        const gridElement = apiRef.current.rootElementRef?.current;
        if (!gridElement) return undefined;

        const updateWidth = () => setGridWidth(gridElement.clientWidth);
        updateWidth();

        if (typeof ResizeObserver === 'undefined') return undefined;
        const observer = new ResizeObserver(updateWidth);
        observer.observe(gridElement);
        return () => observer.disconnect();
    }, [apiRef]);

    const boundaryCount = gridWidth > 0 && gridWidth < 650 ? 0 : 1;
    const siblingCount = gridWidth >= 1200 ? 2 : gridWidth >= 900 ? 1 : 0;

    return (
        <MuiPagination
            color="primary"
            className={className}
            count={pageCount}
            page={page + 1}
            boundaryCount={boundaryCount}
            siblingCount={siblingCount}
            size={gridWidth > 0 && gridWidth < 850 ? 'small' : 'medium'}
            onChange={(event, newPage) => onPageChange(event, newPage - 1)}
        />
    );
}

const catalogTypeTranslationKey = (type) => (type === 'dwarf' ? 'dwarf-planet' : type);

function CatalogObjectIcon({ type, label }) {
    const normalizedType = String(type || '').toLowerCase();
    let Icon = HelpOutlineIcon;
    let color = 'text.secondary';

    if (normalizedType === 'star') {
        Icon = WbSunnyOutlinedIcon;
        color = 'warning.main';
    } else if (normalizedType === 'planet') {
        Icon = PublicOutlinedIcon;
        color = 'primary.main';
    } else if (normalizedType === 'moon') {
        Icon = Brightness2OutlinedIcon;
        color = 'text.secondary';
    } else if (normalizedType === 'dwarf' || normalizedType === 'dwarf-planet') {
        Icon = TripOriginIcon;
        color = 'secondary.main';
    } else if (normalizedType === 'spacecraft') {
        Icon = RocketLaunchOutlinedIcon;
        color = 'info.main';
    }

    return (
        <Tooltip title={label}>
            <Box
                role="img"
                aria-label={label}
                sx={{
                    width: 32,
                    height: 32,
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    bgcolor: 'action.hover',
                    color,
                }}
            >
                <Icon fontSize="small" />
            </Box>
        </Tooltip>
    );
}

function MetricCard({ icon, label, value, detail, tone = 'info' }) {
    return (
        <Paper
            elevation={3}
            sx={(theme) => ({
                flex: '1 1 210px',
                minWidth: 0,
                overflow: 'hidden',
                borderRadius: 1,
                border: `1px solid ${theme.palette[tone].main}4D`,
                backgroundColor: `${theme.palette[tone].main}1A`,
            })}
        >
            <Box sx={(theme) => ({ px: 1.5, py: 1, backgroundColor: `${theme.palette[tone].main}33` })}>
                <Typography variant="caption" sx={{ color: `${tone}.main`, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    {label}
                </Typography>
            </Box>
            <Stack direction="row" spacing={1.5} alignItems="center" sx={{ p: 1.5 }}>
                <Box sx={{ color: `${tone}.main`, display: 'flex' }}>{icon}</Box>
                <Box sx={{ minWidth: 0 }}>
                    <Typography variant="h6" sx={{ lineHeight: 1.25 }}>{value}</Typography>
                    {detail ? <Typography variant="caption" color="text.secondary">{detail}</Typography> : null}
                </Box>
            </Stack>
        </Paper>
    );
}

export function CelestialEphemerisPage() {
    const dispatch = useDispatch();
    const { socket } = useSocket();
    const { t } = useTranslation('celestial');
    const { timezone, locale } = useUserTimeSettings();
    const [status, setStatus] = useState(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [pruning, setPruning] = useState(false);
    const [message, setMessage] = useState(null);
    const [inspectionTarget, setInspectionTarget] = useState(null);
    const [syncProgress, setSyncProgress] = useState({
        processed: 0,
        total: 0,
        percent: 0,
        refreshed: 0,
        provider_fetched: 0,
        cache_reused: 0,
        stale_fallback: 0,
        failed: 0,
        phase: 'idle',
        current_target: null,
    });

    const applyStatus = useCallback((nextStatus) => {
        setStatus(nextStatus);
        dispatch(setCelestialEphemerisStatus(nextStatus));

        const terminalState = nextStatus?.sync?.state || {};
        if (String(terminalState.status || '').toLowerCase() === 'inprogress') {
            setSyncProgress((current) => ({
                ...current,
                processed: Number(terminalState.processed || 0),
                total: Number(terminalState.count || 0),
                percent: Number(terminalState.progress || 0),
                refreshed: Number(terminalState.refreshed || 0),
                provider_fetched: Number(terminalState.provider_fetched || 0),
                cache_reused: Number(terminalState.cache_reused || 0),
                stale_fallback: Number(terminalState.stale_fallback || 0),
                current_target: terminalState.current_target || null,
                phase: terminalState.phase || 'processing',
            }));
        }
        const normalizedStatus = String(terminalState.status || '').toLowerCase();
        const hasFailed = normalizedStatus === 'failed'
            || (normalizedStatus === 'complete' && terminalState.success === false);
        if (hasFailed) {
            setMessage({
                severity: 'error',
                failure: buildEphemerisSyncFailure({
                    ...terminalState,
                    provider_status: nextStatus?.provider?.status || null,
                }, terminalState.message, t),
            });
        } else if (normalizedStatus === 'complete' && terminalState.success === true) {
            setMessage(null);
        }
    }, [dispatch, t]);

    const loadStatus = useCallback(async () => {
        if (!socket) {
            setLoading(false);
            setMessage({ severity: 'error', text: t('admin.common.no_backend_connection') });
            return;
        }
        setLoading(true);
        try {
            const nextStatus = await apiCall(socket, 'get-celestial-ephemeris-status', null, t);
            applyStatus(nextStatus);
        } catch (error) {
            setMessage({ severity: 'error', text: error.message });
        } finally {
            setLoading(false);
        }
    }, [applyStatus, socket, t]);

    useEffect(() => {
        loadStatus();
    }, [loadStatus]);

    useEffect(() => {
        if (!socket) return undefined;

        const handleProgress = (progress) => {
            setSyncProgress((current) => ({ ...current, ...(progress || {}) }));
            dispatch(setCelestialEphemerisSyncProgress(progress));
        };
        const handleStatus = (response) => {
            if (response?.success && response.data) {
                applyStatus(response.data);
                setLoading(false);
                return;
            }
            if (response?.error) {
                setMessage({ severity: 'error', text: response.error });
            }
        };
        socket.on('celestial-cache-refresh-progress', handleProgress);
        socket.on('celestial-ephemeris-status-update', handleStatus);
        return () => {
            socket.off('celestial-cache-refresh-progress', handleProgress);
            socket.off('celestial-ephemeris-status-update', handleStatus);
        };
    }, [applyStatus, dispatch, socket]);

    const handleRefreshCache = async () => {
        dispatch(setCelestialEphemerisSyncStarted());
        setRefreshing(true);
        setMessage(null);
        setSyncProgress({
            processed: 0,
            total: 0,
            percent: 0,
            refreshed: 0,
            provider_fetched: 0,
            cache_reused: 0,
            stale_fallback: 0,
            failed: 0,
            phase: 'starting',
            current_target: null,
        });
        try {
            const result = await apiCall(socket, 'refresh-celestial-cache-now', null, t);
            dispatch(setCelestialEphemerisSyncCompleted(result));
            setSyncProgress((current) => ({
                ...current,
                processed: result?.count ?? current.processed,
                total: result?.count ?? current.total,
                percent: 100,
                refreshed: result?.refreshed ?? current.refreshed,
                provider_fetched: result?.provider_fetched ?? current.provider_fetched,
                cache_reused: result?.cache_reused ?? current.cache_reused,
                stale_fallback: result?.stale_fallback ?? current.stale_fallback,
                failed: result?.failed ?? current.failed,
                phase: 'complete',
            }));
        } catch (error) {
            const result = error.response?.data;
            const failure = buildEphemerisSyncFailure(result, error.message, t);
            dispatch(setCelestialEphemerisSyncFailed({ result, error: error.message }));
            setSyncProgress((current) => ({ ...current, phase: 'failed' }));
            setMessage({ severity: 'error', failure });
        } finally {
            setRefreshing(false);
        }
    };

    const handlePruneCache = async () => {
        setPruning(true);
        setMessage(null);
        try {
            const result = await apiCall(socket, 'prune-celestial-vector-snapshots', null, t);
            setMessage({
                severity: 'success',
                text: t('admin.ephemeris.output.pruned', {
                    count: Number(result?.deleted_count || 0),
                    defaultValue: `Removed ${Number(result?.deleted_count || 0)} expired snapshots.`,
                }),
            });
            await loadStatus();
        } catch (error) {
            setMessage({ severity: 'error', text: error.message });
        } finally {
            setPruning(false);
        }
    };

    const provider = status?.provider || {};
    const providerStatus = provider.status || {};
    const cache = status?.cache || {};
    const sync = status?.sync || {};
    const persistedSyncState = sync.state || {};
    const effectiveProjection = persistedSyncState.projection || sync;
    const availability = providerStatus.availability || 'unknown';
    const operationalTargets = Number(cache.operational_targets || 0);
    const readyTargets = Number(cache.ready_targets || 0);
    const freshnessPercent = operationalTargets > 0
        ? Math.round((readyTargets / operationalTargets) * 100)
        : 0;
    const syncPercent = Math.max(0, Math.min(100, Number(syncProgress.percent || 0)));
    const syncHasTotal = Number(syncProgress.total || 0) > 0;
    const normalizedSyncStatus = String(persistedSyncState.status || 'idle').toLowerCase();
    const syncIsRunning = refreshing || normalizedSyncStatus === 'inprogress';
    const syncIsCompleted = !message?.failure
        && normalizedSyncStatus === 'complete'
        && persistedSyncState.success !== false;
    const syncNeedsAttention = Boolean(message?.failure) || (
        normalizedSyncStatus === 'complete' && persistedSyncState.success === false
    ) || normalizedSyncStatus === 'failed';
    const currentTargetName = syncProgress.current_target?.name || syncProgress.current_target?.key;
    const activeFailureStatus = message?.failure || {};
    const failureReason = activeFailureStatus.reason || providerStatus.reason;
    const failureCause = failureReason
        ? describeHorizonsFailure(failureReason, t)
        : activeFailureStatus.cause;
    const failureRetryAt = activeFailureStatus.retryAtUtc || providerStatus.retry_at_utc;
    const lastFailureAt = activeFailureStatus.lastFailureAtUtc || providerStatus.last_failure_at_utc;
    const outputMessage = syncIsRunning
        ? currentTargetName
            ? t(syncProgress.phase === 'processed'
                ? 'admin.ephemeris.output.processed_target'
                : 'admin.ephemeris.output.processing_target', {
                target: currentTargetName,
                processed: syncProgress.processed,
                total: syncProgress.total,
            })
            : t('admin.ephemeris.output.preparing_sync')
        : message?.text || (message?.failure
            ? t('admin.ephemeris.output.stopped_with_errors')
            : availability === 'available'
            ? t('admin.ephemeris.output.cache_ready')
            : availability === 'unavailable'
                ? t('admin.ephemeris.output.using_cached_data')
                : t('admin.ephemeris.output.ready'));

    return (
        <Paper elevation={3} sx={PAGE_PAPER_SX}>
            <Paper
                variant="outlined"
                sx={{ mt: 0, borderRadius: 2, borderColor: 'divider', overflow: 'hidden' }}
            >
                <Box
                    sx={{
                        px: { xs: 2, md: 2.5 },
                        py: 1.75,
                        borderBottom: '1px solid',
                        borderColor: 'divider',
                        backgroundColor: (theme) => theme.palette.mode === 'dark'
                            ? alpha(theme.palette.primary.main, 0.07)
                            : alpha(theme.palette.primary.main, 0.04),
                    }}
                >
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1.5 }}>
                        <Stack direction="row" spacing={1.5} alignItems="center">
                            <Box
                                sx={{
                                    width: 36,
                                    height: 36,
                                    borderRadius: 1.5,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    color: 'primary.main',
                                    backgroundColor: (theme) => theme.palette.mode === 'dark'
                                        ? alpha(theme.palette.primary.main, 0.22)
                                        : alpha(theme.palette.primary.main, 0.12),
                                }}
                            >
                                <PublicIcon sx={{ fontSize: 20 }} />
                            </Box>
                            <Box>
                                <Typography variant="subtitle1" sx={{ fontWeight: 700, lineHeight: 1.3 }}>
                                    {t('admin.ephemeris.title')}
                                </Typography>
                                <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.4 }}>
                                    {t('admin.ephemeris.subtitle', { provider: provider.name || 'NASA JPL Horizons' })}
                                </Typography>
                            </Box>
                        </Stack>
                        <Stack direction="row" spacing={1}>
                            <Button size="small" variant="contained" startIcon={refreshing ? <CircularProgress size={16} color="inherit" /> : <SyncIcon />} onClick={handleRefreshCache} disabled={!socket || loading || syncIsRunning}>
                                {t('admin.ephemeris.actions.synchronize_now')}
                            </Button>
                            <Button size="small" variant="outlined" startIcon={pruning ? <CircularProgress size={16} /> : <DeleteOutlineIcon />} onClick={handlePruneCache} disabled={!socket || loading || pruning || syncIsRunning}>
                                {t('admin.ephemeris.actions.prune_expired', { defaultValue: 'Prune expired history' })}
                            </Button>
                        </Stack>
                    </Box>

                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mt: 1 }}>
                        <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 500 }}>
                            {t('admin.ephemeris.labels.status')}
                        </Typography>
                        {syncIsRunning ? (
                            <Chip size="small" color="info" icon={<PendingActionsIcon />} label={t('admin.ephemeris.status.running')} />
                        ) : syncIsCompleted ? (
                            <Chip size="small" color="success" icon={<CheckCircleOutlineIcon />} label={t('admin.ephemeris.status.completed')} />
                        ) : syncNeedsAttention ? (
                            <Chip size="small" color="error" icon={<ErrorOutlineIcon />} label={t('admin.ephemeris.status.action_required')} />
                        ) : (
                            <Chip size="small" variant="outlined" label={t('admin.ephemeris.status.idle')} />
                        )}
                        {persistedSyncState.last_update ? (
                            <Typography
                                variant="caption"
                                color="text.disabled"
                                sx={{ ml: 'auto', fontFamily: 'monospace', textAlign: 'right' }}
                            >
                                {t('admin.ephemeris.labels.last_update', {
                                    value: formatDateTime(persistedSyncState.last_update, timezone, locale, t),
                                })}
                            </Typography>
                        ) : null}
                    </Box>

                </Box>

                <Box sx={{ px: { xs: 2, md: 2.5 }, pt: 1.75, pb: 2 }}>
                    {loading && !status ? <Box sx={{ py: 8, textAlign: 'center' }}><CircularProgress /></Box> : (
                        <>
                            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.75 }}>
                                <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 500 }}>
                                    {syncIsRunning
                                        ? t('admin.ephemeris.labels.synchronization_progress')
                                        : t('admin.ephemeris.labels.cache_freshness')}
                                </Typography>
                                <Typography variant="caption" color="text.disabled" sx={{ fontFamily: 'monospace' }}>
                                    {syncIsRunning
                                        ? syncHasTotal
                                            ? `${syncProgress.processed}/${syncProgress.total} · ${Math.round(syncPercent)}%`
                                            : t('admin.ephemeris.labels.preparing')
                                        : `${freshnessPercent}%`}
                                </Typography>
                            </Box>
                            <LinearProgress
                                variant={syncIsRunning && !syncHasTotal ? 'indeterminate' : 'determinate'}
                                value={syncIsRunning ? syncPercent : freshnessPercent}
                                sx={{ height: 3, borderRadius: 999, mb: 0.75 }}
                            />
                            <Stack direction="row" spacing={0.75} alignItems="baseline" sx={{ mb: 1.5 }}>
                                <Typography variant="caption" color="text.disabled" sx={{ fontWeight: 600, flexShrink: 0 }}>{t('admin.ephemeris.labels.output')}</Typography>
                                <Typography variant="caption" color="text.secondary" title={outputMessage} sx={{ fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {outputMessage}
                                </Typography>
                            </Stack>
                            {(syncProgress.provider_fetched || syncProgress.cache_reused || syncProgress.stale_fallback) ? (
                                <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap" sx={{ mb: 1.5 }}>
                                    <Chip size="small" variant="outlined" label={t('admin.ephemeris.labels.provider_fetched', { count: syncProgress.provider_fetched || 0, defaultValue: `Provider fetched: ${syncProgress.provider_fetched || 0}` })} />
                                    <Chip size="small" variant="outlined" label={t('admin.ephemeris.labels.cache_reused', { count: syncProgress.cache_reused || 0, defaultValue: `Cache reused: ${syncProgress.cache_reused || 0}` })} />
                                    <Chip size="small" variant="outlined" label={t('admin.ephemeris.labels.stale_fallback', { count: syncProgress.stale_fallback || 0, defaultValue: `Stale fallback: ${syncProgress.stale_fallback || 0}` })} />
                                </Stack>
                            ) : null}

                            {message ? (
                                <Alert severity={message.severity} sx={{ mb: 1.5 }}>
                                    {message.failure ? (
                                        <>
                                            <AlertTitle>{message.failure.title}</AlertTitle>
                                            <Typography variant="body2">{message.failure.summary}</Typography>
                                            {failureCause ? (
                                                <Typography variant="body2" sx={{ mt: 0.75 }}>
                                                    <Box component="span" sx={{ fontWeight: 700 }}>{t('admin.ephemeris.labels.cause')}</Box>{' '}
                                                    {failureCause}
                                                </Typography>
                                            ) : null}
                                            {failureRetryAt ? (
                                                <Typography variant="body2">
                                                    <Box component="span" sx={{ fontWeight: 700 }}>{t('admin.ephemeris.labels.next_connection_attempt')}</Box>{' '}
                                                    {formatDateTime(failureRetryAt, timezone, locale, t)}
                                                </Typography>
                                            ) : null}
                                            {lastFailureAt ? (
                                                <Typography variant="body2">
                                                    <Box component="span" sx={{ fontWeight: 700 }}>{t('admin.ephemeris.labels.last_failed_attempt')}</Box>{' '}
                                                    {formatDateTime(lastFailureAt, timezone, locale, t)}
                                                </Typography>
                                            ) : null}
                                            {message.failure.errors.length > 0 ? (
                                                <Box component="details" sx={{ mt: 1 }}>
                                                    <Box component="summary" sx={{ cursor: 'pointer', fontWeight: 600 }}>
                                                        {t('admin.ephemeris.labels.failed_targets', { count: message.failure.errors.length })}
                                                    </Box>
                                                    <Box component="ul" sx={{ maxHeight: 180, overflowY: 'auto', mt: 0.75, mb: 0, pl: 2.5 }}>
                                                        {message.failure.errors.map((entry, index) => (
                                                            <Box component="li" key={`${entry.targetKey}-${index}`} sx={{ mb: 0.5 }}>
                                                                <Typography component="span" variant="body2" sx={{ fontWeight: 600 }}>
                                                                    {entry.targetName}
                                                                </Typography>
                                                                <Typography component="span" variant="body2">
                                                                    {` — ${entry.message}`}
                                                                </Typography>
                                                            </Box>
                                                        ))}
                                                    </Box>
                                                </Box>
                                            ) : null}
                                        </>
                                    ) : message.text}
                                </Alert>
                            ) : null}
                            {availability === 'unavailable' && !message?.failure ? (
                                <Box sx={(theme) => ({ backgroundColor: `${theme.palette.error.main}1A`, border: `1px solid ${theme.palette.error.main}4D`, borderRadius: 1, p: 1.25, mb: 1.5 })}>
                                    <Stack direction="row" spacing={1} alignItems="center">
                                        <CloudOffIcon color="error" fontSize="small" />
                                        <Box>
                                            <Typography variant="body2" color="error.main" fontWeight={600}>{t('admin.ephemeris.horizons_unavailable.title')}</Typography>
                                            <Typography variant="caption" color="text.secondary">
                                                {t('admin.ephemeris.horizons_unavailable.detail', {
                                                    cause: describeHorizonsFailure(failureReason, t),
                                                    value: formatDateTime(providerStatus.retry_at_utc, timezone, locale, t),
                                                })}
                                            </Typography>
                                        </Box>
                                    </Stack>
                                </Box>
                            ) : null}

                            <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ mt: 2 }}>
                                <MetricCard icon={<StorageIcon />} label={t('admin.ephemeris.metrics.stored_snapshots')} value={cache.total_snapshots ?? 0} detail={`${t('admin.ephemeris.metrics.targets', { count: cache.distinct_targets ?? 0 })}${cache.database_size_bytes ? ` · ${(cache.database_size_bytes / (1024 * 1024)).toFixed(1)} MB` : ''}`} tone="info" />
                                <MetricCard icon={<CheckCircleOutlineIcon />} label={t('admin.ephemeris.metrics.ready_targets', { defaultValue: 'Ready targets' })} value={readyTargets} detail={t('admin.ephemeris.metrics.refresh_due', { count: cache.refresh_due_targets ?? 0, defaultValue: `${cache.refresh_due_targets ?? 0} refresh due` })} tone="success" />
                                <MetricCard icon={<CloudOffIcon />} label={t('admin.ephemeris.metrics.expired_snapshots')} value={cache.expired_snapshots ?? 0} detail={t('admin.ephemeris.metrics.with_errors', { count: cache.error_snapshots ?? 0 })} tone="warning" />
                            </Stack>

                            <Box sx={{ mt: 2, pt: 1.5, borderTop: '1px solid', borderColor: 'divider' }}>
                                <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 600, mb: 1 }}>{t('admin.ephemeris.periodic.title')}</Typography>
                                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={3}>
                                    <Box><Typography variant="caption" color="text.secondary">{t('admin.ephemeris.labels.status')}</Typography><Box><Chip size="small" color={sync.enabled ? 'success' : 'default'} label={sync.enabled ? t('admin.ephemeris.periodic.enabled') : t('admin.ephemeris.periodic.disabled')} /></Box></Box>
                                    <Box><Typography variant="caption" color="text.secondary">{t('admin.ephemeris.periodic.interval')}</Typography><Typography variant="body2">{t('admin.ephemeris.periodic.every_minutes', { count: sync.interval_minutes ?? 60 })}</Typography></Box>
                                    <Box><Typography variant="caption" color="text.secondary">{t('admin.ephemeris.periodic.effective_projection', { defaultValue: 'Effective projection' })}</Typography><Typography variant="body2">{`-${effectiveProjection.past_hours ?? 1}h / +${effectiveProjection.future_hours ?? 24}h / ${effectiveProjection.step_minutes ?? 60}m`}</Typography></Box>
                                    <Box><Typography variant="caption" color="text.secondary">{t('admin.ephemeris.periodic.next_provider_refresh', { defaultValue: 'Next provider refresh' })}</Typography><Typography variant="body2">{formatDateTime(cache.next_refresh_at, timezone, locale, t)}</Typography></Box>
                                    <Box><Typography variant="caption" color="text.secondary">{t('admin.ephemeris.periodic.next_scheduler_run', { defaultValue: 'Next scheduler check' })}</Typography><Typography variant="body2">{formatDateTime(sync.next_run_at, timezone, locale, t)}</Typography></Box>
                                    <Box><Typography variant="caption" color="text.secondary">{t('admin.ephemeris.periodic.last_failure')}</Typography><Typography variant="body2">{formatDateTime(providerStatus.last_failure_at_utc, timezone, locale, t)}</Typography></Box>
                                </Stack>
                            </Box>
                            <Box sx={{ mt: 2, pt: 1.5, borderTop: '1px solid', borderColor: 'divider' }}>
                                <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 600, mb: 1 }}>
                                    {t('admin.ephemeris.targets.title', { defaultValue: 'Target cache inspection' })}
                                </Typography>
                                <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap">
                                    {(cache.targets || []).map((target) => (
                                        <Button
                                            key={target.target_key}
                                            size="small"
                                            variant="outlined"
                                            color={target.status === 'ready' ? 'success' : target.status === 'failed' ? 'error' : 'warning'}
                                            onClick={() => setInspectionTarget({
                                                targetKey: target.target_key,
                                                displayName: target.display_name,
                                                targetType: target.target_type,
                                                bodyId: target.body_id,
                                                command: target.command,
                                                projectionPastHours: effectiveProjection.past_hours ?? 1,
                                                projectionFutureHours: effectiveProjection.future_hours ?? 24,
                                                projectionStepMinutes: effectiveProjection.step_minutes ?? 60,
                                            })}
                                        >
                                            {target.display_name}
                                        </Button>
                                    ))}
                                </Stack>
                            </Box>
                        </>
                    )}
                </Box>
            </Paper>
            <VectorCoverageDialog
                open={Boolean(inspectionTarget)}
                target={inspectionTarget}
                socket={socket}
                timezone={timezone}
                locale={locale}
                onClose={() => setInspectionTarget(null)}
            />
        </Paper>
    );
}

export function CelestialCatalogPage() {
    const dispatch = useDispatch();
    const { socket } = useSocket();
    const { t } = useTranslation('celestial');
    const { t: tSat } = useTranslation('satellites');
    const { timezone, locale } = useUserTimeSettings();
    const {
        monitored = [],
        loading: monitoredLoading = false,
        saveLoading = false,
    } = useSelector((state) => state.celestialMonitored || {});
    const [bodies, setBodies] = useState([]);
    const [missions, setMissions] = useState([]);
    const [kind, setKind] = useState('all');
    const [statusFilter, setStatusFilter] = useState('all');
    const [monitoringFilter, setMonitoringFilter] = useState('all');
    const [search, setSearch] = useState('');
    const [loading, setLoading] = useState(true);
    // `null` is the idle sentinel; an empty target key can arrive from an older
    // backend and must never make that row look permanently busy.
    const [busyCatalogId, setBusyCatalogId] = useState(null);
    const catalogActionInProgressRef = useRef(false);
    const [message, setMessage] = useState(null);
    const [monitorError, setMonitorError] = useState('');
    const [pendingUnmonitor, setPendingUnmonitor] = useState(null);
    const [unmonitorError, setUnmonitorError] = useState('');
    const [transmittersDialogData, setTransmittersDialogData] = useState(null);
    const [selected, setSelected] = useState([]);
    const [editTarget, setEditTarget] = useState(null);
    const [editError, setEditError] = useState('');
    const [vectorTarget, setVectorTarget] = useState(null);
    const [rowRefreshStates, setRowRefreshStates] = useState({});

    const loadCatalog = useCallback(async () => {
        if (!socket) {
            setLoading(false);
            setMessage({ severity: 'error', text: t('admin.common.no_backend_connection') });
            return;
        }
        setLoading(true);
        const [bodyResult, missionResult, monitoredResult] = await Promise.allSettled([
            apiCall(socket, 'get-celestial-body-catalog', null, t),
            apiCall(socket, 'get-spacecraft-index', { limit: 1000 }, t),
            dispatch(fetchMonitoredCelestial({ socket })).unwrap(),
        ]);

        if (bodyResult.status === 'fulfilled') {
            setBodies((bodyResult.value || []).filter((body) => body?.monitorable !== false));
        }
        if (missionResult.status === 'fulfilled') {
            setMissions(missionResult.value || []);
        }

        // Existing monitored targets remain manageable even when one catalog source is unavailable.
        const failures = [bodyResult, missionResult, monitoredResult]
            .filter((result) => result.status === 'rejected')
            .map((result) => String(result.reason?.message || result.reason));
        setMessage(failures.length > 0 ? { severity: 'error', text: failures.join(' ') } : null);
        setLoading(false);
    }, [dispatch, socket, t]);

    useEffect(() => {
        loadCatalog();
    }, [loadCatalog]);

    const monitoredByKey = useMemo(() => new Map(
        monitored
            .map((entry) => [String(entry.targetKey || '').trim(), entry])
            .filter(([key]) => key),
    ), [monitored]);

    const rows = useMemo(() => {
        const catalogRows = bodies.map((body) => {
            const targetKey = String(body.target_key || '').trim();
            return {
                // Keep grid identity independent from backend target identity so
                // one malformed catalog row cannot corrupt virtualized pages.
                catalogId: targetKey || `catalog:body:${String(body.body_id || '').trim()}`,
                key: targetKey,
                kind: 'body',
                name: t(`admin.catalog.bodies.${body.body_id}`, { defaultValue: body.name }),
                catalogName: body.name,
                identifier: body.body_id,
                type: body.body_type,
                parent: body.parent_body_id
                    ? t(`admin.catalog.bodies.${body.parent_body_id}`, { defaultValue: body.parent_body_id })
                    : t('admin.catalog.parent_sun'),
                catalogStatus: 'available',
                raw: body,
            };
        }).concat(missions.map((mission) => {
            const targetKey = String(mission.target_key || '').trim();
            const catalogIdentifier = String(mission.id || mission.command || '').trim();
            return {
                catalogId: targetKey || `catalog:mission:${catalogIdentifier}`,
                key: targetKey,
                kind: 'mission',
                name: mission.display_name,
                catalogName: mission.display_name,
                identifier: mission.command,
                type: 'spacecraft',
                parent: mission.agency || t('admin.catalog.unknown_agency'),
                catalogStatus: mission.mission_status || 'unknown',
                raw: mission,
            };
        }));

        const matchedMonitoredIds = new Set();
        const enrichedCatalogRows = catalogRows.map((row) => {
            const monitoredEntry = row.key ? monitoredByKey.get(row.key) : null;
            if (monitoredEntry?.id) matchedMonitoredIds.add(monitoredEntry.id);
            return {
                ...row,
                name: monitoredEntry?.displayName || row.name,
                monitored: monitoredEntry || null,
                monitoringState: monitoredEntry
                    ? (monitoredEntry.enabled ? 'enabled' : 'disabled')
                    : 'not_monitored',
                lastRefreshAt: monitoredEntry?.lastRefreshAt || null,
                lastError: monitoredEntry?.lastError || null,
            };
        });

        // Free-form Horizons commands and legacy entries may not exist in either catalog.
        const customRows = monitored
            .filter((entry) => !matchedMonitoredIds.has(entry.id))
            .map((entry) => ({
                // Keep row identity stable if the matching catalog arrives after monitored data.
                catalogId: entry.targetKey || `monitored:${entry.id}`,
                key: entry.targetKey,
                kind: entry.targetType || 'mission',
                name: entry.displayName || entry.command || entry.bodyId || entry.targetKey,
                catalogName: '',
                identifier: entry.targetType === 'body' ? entry.bodyId : entry.command,
                type: entry.targetType === 'body' ? 'body' : 'spacecraft',
                parent: t('admin.catalog.custom'),
                catalogStatus: 'custom',
                raw: {},
                monitored: entry,
                monitoringState: entry.enabled ? 'enabled' : 'disabled',
                lastRefreshAt: entry.lastRefreshAt || null,
                lastError: entry.lastError || null,
            }));

        const needle = search.trim().toLowerCase();
        return [...enrichedCatalogRows, ...customRows].filter((row) => {
            if (kind !== 'all' && row.kind !== kind) return false;
            if (statusFilter !== 'all' && row.kind === 'mission' && row.catalogStatus !== statusFilter) return false;
            if (monitoringFilter === 'monitored' && !row.monitored) return false;
            if (monitoringFilter === 'enabled' && row.monitoringState !== 'enabled') return false;
            if (monitoringFilter === 'disabled' && row.monitoringState !== 'disabled') return false;
            if (monitoringFilter === 'not_monitored' && row.monitored) return false;
            if (!needle) return true;
            const aliases = row.raw.aliases || [];
            return [row.name, row.catalogName, row.identifier, row.type, row.parent, ...aliases]
                .some((value) => String(value || '').toLowerCase().includes(needle));
        });
    }, [bodies, kind, missions, monitored, monitoredByKey, monitoringFilter, search, statusFilter, t]);
    const selectedRows = useMemo(() => {
        const selectedIds = new Set(selected);
        return rows.filter((row) => selectedIds.has(row.catalogId));
    }, [rows, selected]);
    const rowSelectionModel = useMemo(() => toRowSelectionModel(selected), [selected]);
    const selectedRow = selectedRows.length === 1 ? selectedRows[0] : null;
    const selectedMonitoredRows = useMemo(
        () => selectedRows.filter((row) => row.monitored),
        [selectedRows],
    );
    const selectedUnmonitoredRows = useMemo(
        () => selectedRows.filter((row) => row.key && !row.monitored),
        [selectedRows],
    );
    const pendingUnmonitorRows = useMemo(
        () => (Array.isArray(pendingUnmonitor)
            ? pendingUnmonitor
            : (pendingUnmonitor ? [pendingUnmonitor] : [])),
        [pendingUnmonitor],
    );

    useEffect(() => {
        const validIds = new Set(rows.map((row) => row.catalogId));
        setSelected((current) => current.filter((id) => validIds.has(id)));
    }, [rows]);

    const handleMonitor = async (catalogRows) => {
        const rowsToMonitor = (Array.isArray(catalogRows) ? catalogRows : [catalogRows])
            .filter((row) => row?.key && !monitoredByKey.has(row.key));
        if (rowsToMonitor.length === 0 || catalogActionInProgressRef.current) return;

        // Guard synchronously so rapid repeated clicks cannot start overlapping batches.
        catalogActionInProgressRef.current = true;
        setBusyCatalogId(rowsToMonitor[0].catalogId);
        setMessage(null);
        setMonitorError('');

        const createdTargets = [];
        const createFailures = [];
        try {
            for (const row of rowsToMonitor) {
                try {
                    const created = await dispatch(createMonitoredCelestial({
                        socket,
                        entry: {
                            targetType: row.kind,
                            displayName: row.name,
                            command: row.kind === 'mission' ? row.identifier : '',
                            bodyId: row.kind === 'body' ? row.identifier : '',
                            enabled: true,
                            sourceMode: row.kind === 'mission' ? 'catalog' : 'static-body',
                        },
                    })).unwrap();
                    createdTargets.push({ row, id: created.id });
                } catch (error) {
                    createFailures.push({ row, error });
                }
            }

            let nextError = '';
            if (createdTargets.length > 0) {
                const refreshResult = await dispatch(refreshMonitoredCelestialNow({
                    socket,
                    ids: createdTargets.map((target) => target.id),
                }));
                await dispatch(fetchMonitoredCelestial({ socket }));
                if (refreshMonitoredCelestialNow.rejected.match(refreshResult)) {
                    nextError = t('admin.catalog.feedback.first_refresh_failed', {
                        name: createdTargets.map(({ row }) => row.name).join(', '),
                        error: refreshResult.payload
                            || refreshResult.error?.message
                            || t('admin.common.unknown_error'),
                    });
                }
            }

            if (createFailures.length > 0) {
                const createError = createFailures.map(({ row, error }) => (
                    t('admin.catalog.feedback.monitor_failed', {
                        name: row.name,
                        error: String(error?.message || error),
                    })
                )).join('\n');
                nextError = [nextError, createError].filter(Boolean).join('\n');
            }
            setMonitorError(nextError);
        } finally {
            catalogActionInProgressRef.current = false;
            setBusyCatalogId(null);
        }
    };

    const handleConfirmUnmonitor = async () => {
        const ids = pendingUnmonitorRows
            .map((row) => row.monitored?.id)
            .filter(Boolean);
        if (ids.length === 0 || catalogActionInProgressRef.current) return;

        catalogActionInProgressRef.current = true;
        setBusyCatalogId(pendingUnmonitorRows[0]?.catalogId || 'selection');
        setUnmonitorError('');
        try {
            await dispatch(deleteMonitoredCelestial({ socket, ids })).unwrap();
            setPendingUnmonitor(null);
        } catch (error) {
            setUnmonitorError(String(error?.message || error));
        } finally {
            catalogActionInProgressRef.current = false;
            setBusyCatalogId(null);
        }
    };

    const setRowsRefreshState = (ids, status, error = '') => {
        setRowRefreshStates((current) => {
            const next = { ...current };
            ids.forEach((id) => {
                next[id] = { status, error };
            });
            return next;
        });
    };

    const runMonitoredAction = async (action, targetRows) => {
        const entries = (Array.isArray(targetRows) ? targetRows : [targetRows])
            .map((row) => row?.monitored || row)
            .filter((entry) => entry?.id);
        const ids = entries.map((entry) => entry.id);
        if (ids.length === 0 || catalogActionInProgressRef.current) return;

        catalogActionInProgressRef.current = true;
        setBusyCatalogId(targetRows?.[0]?.catalogId || ids[0]);
        setMessage(null);
        if (action === 'refresh') setRowsRefreshState(ids, 'refreshing');
        try {
            if (action === 'refresh') {
                await dispatch(refreshMonitoredCelestialNow({ socket, ids })).unwrap();
            } else {
                await Promise.all(entries.map((entry) => dispatch(toggleMonitoredCelestialEnabled({
                    socket,
                    id: entry.id,
                    enabled: action === 'enable',
                })).unwrap()));
            }

            const refreshedRows = await dispatch(fetchMonitoredCelestial({ socket })).unwrap();
            if (action === 'refresh') {
                const refreshedById = new Map(refreshedRows.map((row) => [row.id, row]));
                setRowRefreshStates((current) => {
                    const next = { ...current };
                    ids.forEach((id) => {
                        const refreshed = refreshedById.get(id);
                        next[id] = refreshed?.lastError
                            ? { status: 'error', error: refreshed.lastError }
                            : { status: 'success', error: '' };
                    });
                    return next;
                });
            }
        } catch (error) {
            const errorText = String(error?.message || error);
            if (action === 'refresh') setRowsRefreshState(ids, 'error', errorText);
            else setMessage({ severity: 'error', text: errorText });
        } finally {
            catalogActionInProgressRef.current = false;
            setBusyCatalogId(null);
        }
    };

    const handleSaveEdit = async () => {
        const name = String(editTarget?.displayName || '').trim();
        const identifier = editTarget?.targetType === 'body'
            ? String(editTarget.bodyId || '').trim()
            : String(editTarget?.command || '').trim();
        if (!name || !identifier) {
            setEditError(t('admin.targets.errors.name_identifier_required'));
            return;
        }
        try {
            await dispatch(updateMonitoredCelestial({ socket, entry: editTarget })).unwrap();
            setEditTarget(null);
            setEditError('');
            setMessage({ severity: 'success', text: t('admin.targets.feedback.updated') });
        } catch (error) {
            setEditError(String(error?.message || error));
        }
    };

    const handleOpenTransmitters = useCallback((row) => {
        if (!row?.key) return;

        setTransmittersDialogData({
            name: row.name || row.identifier || row.key,
            target_key: row.key,
            // Catalog endpoints do not hydrate transmitters; the shared dialog
            // fetches the current list from the target key when it opens.
            transmitters: Array.isArray(row.raw?.transmitters) ? row.raw.transmitters : [],
        });
    }, []);

    const statuses = useMemo(
        () => [...new Set(missions.map((row) => row.mission_status).filter(Boolean))].sort(),
        [missions],
    );
    const activeFilters = [
        search.trim() && {
            key: 'search',
            label: `${t('admin.catalog.filters.search')}: ${search.trim()}`,
            onDelete: () => setSearch(''),
        },
        kind !== 'all' && {
            key: 'catalog',
            label: t(`admin.catalog.filters.${kind === 'body' ? 'solar_bodies' : 'spacecraft'}`),
            onDelete: () => setKind('all'),
        },
        statusFilter !== 'all' && {
            key: 'status',
            label: t(`admin.catalog.status.${statusFilter}`, { defaultValue: statusFilter }),
            onDelete: () => setStatusFilter('all'),
        },
        monitoringFilter !== 'all' && {
            key: 'monitoring',
            label: t(`admin.catalog.filters.${monitoringFilter}`),
            onDelete: () => setMonitoringFilter('all'),
        },
    ].filter(Boolean);
    const clearAllFilters = () => {
        setSearch('');
        setKind('all');
        setStatusFilter('all');
        setMonitoringFilter('all');
    };
    const columns = [
        {
            field: 'name',
            headerName: t('admin.catalog.columns.name'),
            minWidth: 210,
            flex: 1,
            renderCell: (params) => {
                const typeLabel = t(`admin.catalog.types.${catalogTypeTranslationKey(params.row.type)}`, {
                    defaultValue: params.row.type,
                });
                return (
                    <Stack direction="row" spacing={1.25} alignItems="center" sx={{ minWidth: 0 }}>
                        <CatalogObjectIcon type={params.row.type} label={typeLabel} />
                        <Typography variant="body2" fontWeight={500} noWrap>{params.value}</Typography>
                    </Stack>
                );
            },
        },
        {
            field: 'type',
            headerName: t('admin.catalog.columns.type'),
            width: 120,
            renderCell: (params) => (
                <Chip
                    size="small"
                    variant="outlined"
                    label={t(`admin.catalog.types.${catalogTypeTranslationKey(params.value)}`, {
                        defaultValue: params.value,
                    })}
                />
            ),
        },
        { field: 'parent', headerName: t('admin.catalog.columns.agency_parent'), minWidth: 150, flex: 0.8 },
        {
            field: 'catalogStatus',
            headerName: t('admin.catalog.columns.catalog_status'),
            width: 120,
            renderCell: (params) => (
                <Chip
                    size="small"
                    color={params.value === 'active' || params.value === 'available' ? 'success' : 'default'}
                    label={t(`admin.catalog.status.${params.value}`, { defaultValue: params.value })}
                />
            ),
        },
        {
            field: 'identifier',
            headerName: t('admin.catalog.columns.identifier'),
            minWidth: 190,
            flex: 1,
            renderCell: (params) => <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>{params.value}</Typography>,
        },
        {
            field: 'monitoring',
            headerName: t('admin.catalog.columns.monitoring'),
            width: 190,
            sortable: false,
            filterable: false,
            disableColumnMenu: true,
            align: 'center',
            headerAlign: 'center',
            renderCell: (params) => {
                const state = params.row.monitoringState;
                const isMonitored = Boolean(params.row.monitored);
                return (
                    <Stack direction="row" spacing={0.5} alignItems="center">
                        <Chip
                            size="small"
                            color={state === 'enabled' ? 'success' : 'default'}
                            variant={isMonitored ? 'filled' : 'outlined'}
                            icon={state === 'enabled' ? <CheckCircleOutlineIcon /> : <ToggleOffIcon />}
                            label={t(`admin.catalog.monitoring.${state}`)}
                        />
                        {isMonitored ? (
                            <Switch
                                size="small"
                                checked={state === 'enabled'}
                                disabled={!socket || Boolean(busyCatalogId)}
                                inputProps={{
                                    'aria-label': t(state === 'enabled'
                                        ? 'admin.targets.actions.disable'
                                        : 'admin.targets.actions.enable'),
                                }}
                                onClick={(event) => event.stopPropagation()}
                                onChange={() => runMonitoredAction(
                                    state === 'enabled' ? 'disable' : 'enable',
                                    [params.row],
                                )}
                            />
                        ) : null}
                    </Stack>
                );
            },
        },
        {
            field: 'lastRefreshAt',
            headerName: t('admin.targets.columns.last_refresh'),
            minWidth: 180,
            flex: 0.8,
            renderCell: (params) => {
                if (!params.row.monitored) return t('admin.common.not_available');
                if (!params.value) return t('common.never');

                const parsed = new Date(params.value);
                if (Number.isNaN(parsed.getTime())) return t('common.unknown');

                return (
                    <Tooltip title={formatDateTime(params.value, timezone, locale, t)}>
                        <Typography variant="body2" noWrap>{humanizeDate(params.value)}</Typography>
                    </Tooltip>
                );
            },
        },
        {
            field: 'lastError',
            headerName: t('admin.targets.columns.status'),
            width: 135,
            renderCell: (params) => {
                if (!params.row.monitored) return t('admin.common.not_available');
                const refreshState = rowRefreshStates[params.row.monitored.id];
                if (refreshState?.status === 'refreshing') {
                    return <Chip size="small" color="info" icon={<CircularProgress size={14} color="inherit" />} label={t('admin.targets.status.refreshing')} />;
                }
                if (refreshState?.status === 'success') {
                    return <Chip size="small" color="success" label={t('admin.targets.status.refreshed')} />;
                }
                if (refreshState?.status === 'error') {
                    return <Tooltip title={refreshState.error || t('admin.targets.status.refresh_failed')}><Chip size="small" color="error" label={t('admin.targets.status.refresh_failed')} /></Tooltip>;
                }
                return params.value ? (
                    <Tooltip title={params.value}><Chip size="small" color="error" label={t('common.error')} /></Tooltip>
                ) : (
                    <Chip
                        size="small"
                        color={params.row.lastRefreshAt ? 'success' : 'warning'}
                        label={params.row.lastRefreshAt ? t('admin.targets.status.ready') : t('admin.targets.status.not_fetched')}
                    />
                );
            },
        },
        {
            field: 'row_actions',
            headerName: t('admin.catalog.columns.actions'),
            width: 202,
            sortable: false,
            filterable: false,
            disableColumnMenu: true,
            align: 'center',
            headerAlign: 'center',
            renderCell: (params) => {
                const transmitterLabel = tSat('satellite_database.edit_transmitters');
                if (!params.row.monitored) {
                    const monitorLabel = t('admin.catalog.actions.monitor_target', { name: params.row.name });
                    return (
                        <Stack direction="row" spacing={0.25}>
                            <Tooltip title={transmitterLabel}><span><IconButton aria-label={`${transmitterLabel}: ${params.row.name}`} size="small" disabled={!params.row.key} onClick={(event) => { event.stopPropagation(); handleOpenTransmitters(params.row); }}><SettingsInputAntennaIcon fontSize="small" /></IconButton></span></Tooltip>
                            <Tooltip title={monitorLabel}>
                                <span>
                                    <IconButton
                                        aria-label={monitorLabel}
                                        size="small"
                                        disabled={!socket || !params.row.key || Boolean(busyCatalogId)}
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            handleMonitor([params.row]);
                                        }}
                                    >
                                        <ToggleOnIcon fontSize="small" />
                                    </IconButton>
                                </span>
                            </Tooltip>
                        </Stack>
                    );
                }
                const unmonitorLabel = t('admin.catalog.actions.unmonitor_target', { name: params.row.name });
                return (
                    <Stack direction="row" spacing={0.25}>
                        <Tooltip title={transmitterLabel}><span><IconButton aria-label={`${transmitterLabel}: ${params.row.name}`} size="small" disabled={!params.row.key} onClick={(event) => { event.stopPropagation(); handleOpenTransmitters(params.row); }}><SettingsInputAntennaIcon fontSize="small" /></IconButton></span></Tooltip>
                        <Tooltip title={t('admin.targets.actions.vector_details')}><span><IconButton aria-label={t('admin.targets.actions.vector_details')} size="small" disabled={!socket || !params.row.key} onClick={(event) => { event.stopPropagation(); setVectorTarget(params.row.monitored); }}><TimelineIcon fontSize="small" /></IconButton></span></Tooltip>
                        <Tooltip title={t('admin.targets.actions.refresh')}><span><IconButton aria-label={t('admin.targets.actions.refresh')} size="small" disabled={!socket || Boolean(busyCatalogId)} onClick={(event) => { event.stopPropagation(); runMonitoredAction('refresh', [params.row]); }}>{rowRefreshStates[params.row.monitored.id]?.status === 'refreshing' ? <CircularProgress size={18} /> : <RefreshIcon fontSize="small" />}</IconButton></span></Tooltip>
                        <Tooltip title={t('admin.targets.actions.edit')}><span><IconButton aria-label={t('admin.targets.actions.edit')} size="small" disabled={!socket || Boolean(busyCatalogId)} onClick={(event) => { event.stopPropagation(); setEditTarget({ ...params.row.monitored }); }}><EditIcon fontSize="small" /></IconButton></span></Tooltip>
                        <Tooltip title={unmonitorLabel}><span><IconButton aria-label={unmonitorLabel} size="small" color="error" disabled={!socket || Boolean(busyCatalogId)} onClick={(event) => { event.stopPropagation(); setPendingUnmonitor([params.row]); }}><VisibilityOffOutlinedIcon fontSize="small" /></IconButton></span></Tooltip>
                    </Stack>
                );
            },
        },
    ];

    return (
        <Paper elevation={3} sx={PAGE_PAPER_SX}>
            {message ? <Alert severity={message.severity} sx={{ mb: 2 }} onClose={() => setMessage(null)}>{message.text}</Alert> : null}
            <Paper
                variant="outlined"
                sx={{
                    p: { xs: 1.5, md: 2 },
                    mb: 2,
                    borderRadius: 2,
                    backgroundColor: (theme) => (
                        theme.palette.mode === 'dark'
                            ? alpha(theme.palette.grey[700], 0.18)
                            : alpha(theme.palette.grey[100], 0.9)
                    ),
                }}
            >
                <TextField
                    fullWidth
                    size="small"
                    label={t('admin.catalog.filters.search')}
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    variant="outlined"
                    InputProps={{
                        startAdornment: <InputAdornment position="start"><SearchIcon /></InputAdornment>,
                        endAdornment: search ? (
                            <InputAdornment position="end">
                                <IconButton
                                    aria-label={t('admin.catalog.filters.clear_search')}
                                    onClick={() => setSearch('')}
                                    edge="end"
                                    size="small"
                                >
                                    <ClearIcon />
                                </IconButton>
                            </InputAdornment>
                        ) : null,
                    }}
                />
                <Box
                    sx={{
                        display: 'grid',
                        gridTemplateColumns: {
                            xs: '1fr',
                            sm: 'repeat(2, minmax(0, 1fr))',
                            lg: 'repeat(3, minmax(0, 1fr))',
                        },
                        gap: 1.25,
                        mt: 1.5,
                    }}
                >
                    <FormControl size="small" fullWidth>
                        <InputLabel>{t('admin.catalog.filters.catalog')}</InputLabel>
                        <Select label={t('admin.catalog.filters.catalog')} value={kind} onChange={(event) => setKind(event.target.value)}>
                            <MenuItem value="all">{t('admin.catalog.filters.all_entries')}</MenuItem>
                            <MenuItem value="body">{t('admin.catalog.filters.solar_bodies')}</MenuItem>
                            <MenuItem value="mission">{t('admin.catalog.filters.spacecraft')}</MenuItem>
                        </Select>
                    </FormControl>
                    <FormControl size="small" fullWidth disabled={kind === 'body'}>
                        <InputLabel>{t('admin.catalog.filters.status')}</InputLabel>
                        <Select label={t('admin.catalog.filters.status')} value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                            <MenuItem value="all">{t('admin.catalog.filters.all_statuses')}</MenuItem>
                            {statuses.map((status) => <MenuItem key={status} value={status}>{t(`admin.catalog.status.${status}`, { defaultValue: status })}</MenuItem>)}
                        </Select>
                    </FormControl>
                    <FormControl size="small" fullWidth>
                        <InputLabel>{t('admin.catalog.filters.monitoring')}</InputLabel>
                        <Select
                            label={t('admin.catalog.filters.monitoring')}
                            value={monitoringFilter}
                            onChange={(event) => setMonitoringFilter(event.target.value)}
                        >
                            <MenuItem value="all">{t('admin.catalog.filters.all_monitoring')}</MenuItem>
                            <MenuItem value="monitored">{t('admin.catalog.filters.monitored')}</MenuItem>
                            <MenuItem value="enabled">{t('admin.catalog.filters.enabled')}</MenuItem>
                            <MenuItem value="disabled">{t('admin.catalog.filters.disabled')}</MenuItem>
                            <MenuItem value="not_monitored">{t('admin.catalog.filters.not_monitored')}</MenuItem>
                        </Select>
                    </FormControl>
                </Box>
                <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between" sx={{ mt: 1.5, minHeight: 32 }}>
                    <Stack
                        direction="row"
                        spacing={0.75}
                        alignItems="center"
                        sx={{
                            flex: 1,
                            minWidth: 0,
                            overflowX: 'auto',
                            overflowY: 'hidden',
                            scrollbarWidth: 'none',
                            '&::-webkit-scrollbar': { display: 'none' },
                        }}
                    >
                        {activeFilters.map((filter) => (
                            <Chip
                                key={filter.key}
                                label={filter.label}
                                onDelete={filter.onDelete}
                                size="small"
                                sx={{ flexShrink: 0 }}
                            />
                        ))}
                        {activeFilters.length > 1 ? (
                            <Button size="small" onClick={clearAllFilters} sx={{ flexShrink: 0 }}>
                                {t('admin.catalog.filters.clear_all')}
                            </Button>
                        ) : null}
                    </Stack>
                    <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'nowrap', flexShrink: 0 }}>
                        {t('admin.catalog.filters.results', { count: rows.length })}
                    </Typography>
                </Stack>
            </Paper>
            <DataGrid
                loading={loading || monitoredLoading}
                rows={rows}
                columns={columns}
                getRowId={(row) => row.catalogId}
                pageSizeOptions={[5, 10, 20, 50, 100]}
                initialState={{ pagination: { paginationModel: { pageSize: 10 } } }}
                rowHeight={52}
                checkboxSelection
                rowSelectionModel={rowSelectionModel}
                onRowSelectionModelChange={(selection) => setSelected(toSelectedIds(selection))}
                slotProps={{
                    basePagination: {
                        ActionsComponent: CatalogPagination,
                    },
                }}
                localeText={{ noRowsLabel: t('admin.catalog.empty') }}
                sx={{
                    ...DATA_GRID_SX,
                    '& .MuiDataGrid-row': { cursor: 'pointer' },
                }}
            />
            <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ mt: 2 }}>
                <Button
                    variant="contained"
                    disabled={selected.length !== 1 || !selectedRow?.key}
                    onClick={() => {
                        if (selectedRow) handleOpenTransmitters(selectedRow);
                    }}
                >
                    {tSat('satellite_database.edit_transmitters')}
                </Button>
                <Button
                    variant="contained"
                    disabled={
                        !socket
                        || selectedUnmonitoredRows.length === 0
                        || Boolean(busyCatalogId)
                    }
                    onClick={() => handleMonitor(selectedUnmonitoredRows)}
                >
                    {busyCatalogId
                        ? t('admin.catalog.actions.working')
                        : t('admin.catalog.actions.monitor')}
                </Button>
                <Button
                    variant="contained"
                    color="error"
                    disabled={
                        !socket
                        || selectedMonitoredRows.length === 0
                        || Boolean(busyCatalogId)
                    }
                    onClick={() => {
                        setUnmonitorError('');
                        setPendingUnmonitor(selectedMonitoredRows);
                    }}
                >
                    {t('admin.catalog.actions.unmonitor')}
                </Button>
                <ResponsiveActionButton
                    label={t('admin.targets.actions.refresh_selected')}
                    icon={<RefreshIcon />}
                    variant="contained"
                    disabled={!socket || Boolean(busyCatalogId) || selectedMonitoredRows.length === 0}
                    onClick={() => runMonitoredAction('refresh', selectedMonitoredRows)}
                />
                <ResponsiveActionButton
                    label={t('admin.targets.actions.enable')}
                    icon={<ToggleOnIcon />}
                    variant="outlined"
                    disabled={!socket || Boolean(busyCatalogId) || selectedMonitoredRows.length === 0}
                    onClick={() => runMonitoredAction('enable', selectedMonitoredRows)}
                />
                <ResponsiveActionButton
                    label={t('admin.targets.actions.disable')}
                    icon={<ToggleOffIcon />}
                    variant="outlined"
                    disabled={!socket || Boolean(busyCatalogId) || selectedMonitoredRows.length === 0}
                    onClick={() => runMonitoredAction('disable', selectedMonitoredRows)}
                />
            </Stack>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>{t('admin.catalog.summary', { entries: rows.length, monitored: monitored.length })}</Typography>
            <Alert severity="info" sx={{ mt: 2 }}>
                <AlertTitle>{t('admin.catalog.info.title')}</AlertTitle>
                {t('admin.catalog.info.description')}
            </Alert>

            <ErrorDialog
                open={Boolean(monitorError)}
                message={monitorError}
                onClose={() => setMonitorError('')}
            />

            <TransmittersDialog
                open={Boolean(transmittersDialogData)}
                onClose={() => setTransmittersDialogData(null)}
                title={tSat('satellite_database.edit_transmitters_title', {
                    name: transmittersDialogData?.name || '',
                })}
                satelliteData={transmittersDialogData}
                variant="paper"
                widthOffsetPx={20}
            />

            <VectorCoverageDialog
                open={Boolean(vectorTarget)}
                target={vectorTarget}
                socket={socket}
                timezone={timezone}
                locale={locale}
                onClose={() => setVectorTarget(null)}
                onRefresh={(id) => runMonitoredAction('refresh', [{ monitored: { id } }])}
            />

            <CelestialEditDialog
                target={editTarget}
                saving={saveLoading}
                error={editError}
                onChange={(field, value) => setEditTarget((current) => (
                    current ? { ...current, [field]: value } : current
                ))}
                onClose={() => {
                    setEditTarget(null);
                    setEditError('');
                }}
                onSave={handleSaveEdit}
            />

            <Dialog
                open={Boolean(pendingUnmonitor)}
                onClose={() => !busyCatalogId && setPendingUnmonitor(null)}
                maxWidth="sm"
                fullWidth
                PaperProps={{ sx: { bgcolor: 'background.paper', borderRadius: 2 } }}
            >
                <DialogTitle
                    sx={{
                        bgcolor: 'error.main',
                        color: 'error.contrastText',
                        fontSize: '1.125rem',
                        fontWeight: 600,
                        py: 2,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 1.5,
                    }}
                >
                    <Box
                        component="span"
                        sx={{
                            width: 24,
                            height: 24,
                            borderRadius: '50%',
                            bgcolor: 'error.contrastText',
                            color: 'error.main',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontWeight: 'bold',
                            fontSize: '1rem',
                        }}
                    >
                        !
                    </Box>
                    {t('admin.catalog.confirm.title')}
                </DialogTitle>
                <DialogContent sx={{ px: 3, pt: 3, pb: 3 }}>
                    <Typography variant="body1" sx={{ mt: 2, mb: 1 }}>
                        {t('admin.catalog.confirm.question', {
                            target: pendingUnmonitorRows.length > 0
                                ? pendingUnmonitorRows.map((row) => row.name).join(', ')
                                : t('admin.catalog.confirm.this_target'),
                        })}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                        {t('admin.catalog.confirm.description')}
                    </Typography>
                    {unmonitorError ? <Alert severity="error" sx={{ mt: 2 }}>{unmonitorError}</Alert> : null}
                </DialogContent>
                <DialogActions
                    sx={{
                        bgcolor: (theme) => theme.palette.mode === 'dark' ? 'grey.900' : 'grey.100',
                        borderTop: '1px solid',
                        borderColor: 'divider',
                        px: 3,
                        py: 2,
                        gap: 1,
                    }}
                >
                    <Button variant="outlined" onClick={() => setPendingUnmonitor(null)} disabled={Boolean(busyCatalogId)}>
                        {t('admin.common.cancel')}
                    </Button>
                    <Button
                        variant="contained"
                        color="error"
                        startIcon={<VisibilityOffOutlinedIcon />}
                        disabled={pendingUnmonitorRows.length === 0 || Boolean(busyCatalogId)}
                        onClick={handleConfirmUnmonitor}
                    >
                        {t('admin.catalog.actions.unmonitor')}
                    </Button>
                </DialogActions>
            </Dialog>
        </Paper>
    );
}
