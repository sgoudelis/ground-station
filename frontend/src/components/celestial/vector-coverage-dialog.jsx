/**
 * @license
 * Copyright (c) 2026 Efstratios Goudelis
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {Alert,Box,Chip,CircularProgress,Dialog,DialogActions,DialogContent,DialogContentText,DialogTitle,Divider,IconButton,Paper,Stack,Tooltip,Typography,} from '@mui/material';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import CachedIcon from '@mui/icons-material/Cached';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import DeleteSweepIcon from '@mui/icons-material/DeleteSweep';
import RefreshIcon from '@mui/icons-material/Refresh';
import TimelineIcon from '@mui/icons-material/Timeline';
import { useTranslation } from 'react-i18next';
import CapsButton from '../common/capsbutton.jsx';

const parseTime = (value) => {
    const milliseconds = Date.parse(value || '');
    return Number.isFinite(milliseconds) ? milliseconds : null;
};

const formatTime = (value, timezone, locale) => {
    const milliseconds = parseTime(value);
    if (milliseconds === null) return '—';
    return new Intl.DateTimeFormat(locale, {
        dateStyle: 'medium',
        timeStyle: 'medium',
        timeZone: timezone,
    }).format(new Date(milliseconds));
};

function StatusCard({ icon, label, value, color = 'default', detail }) {
    return (
        <Paper variant="outlined" sx={{ p: 1.5, minWidth: 0 }}>
            <Stack direction="row" spacing={1} alignItems="center">
                <Box sx={{ color: color === 'default' ? 'text.secondary' : `${color}.main`, display: 'flex' }}>{icon}</Box>
                <Box sx={{ minWidth: 0 }}>
                    <Typography variant="caption" color="text.secondary" display="block">{label}</Typography>
                    <Stack direction="row" spacing={0.75} alignItems="baseline" sx={{ minWidth: 0 }}>
                        <Typography variant="body2" fontWeight={700} sx={{ flexShrink: 0 }}>{value}</Typography>
                        {detail ? (
                            <Typography
                                variant="caption"
                                color="text.secondary"
                                title={detail}
                                sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                            >
                                {detail}
                            </Typography>
                        ) : null}
                    </Stack>
                </Box>
            </Stack>
        </Paper>
    );
}

function TimelineLegendItem({ offsetX, offsetY, label, children }) {
    return (
        <g transform={`translate(${offsetX} ${offsetY})`}>
            {children}
            <text x="38" y="4" fill="currentColor" opacity="0.78" fontSize="11">{label}</text>
        </g>
    );
}

function VectorTimeline({ snapshots, nowUtc, timezone, locale, t }) {
    const [hoverIndicator, setHoverIndicator] = useState(null);
    const model = useMemo(() => {
        const visibleSnapshots = snapshots.slice(0, 12);
        const points = [parseTime(nowUtc)];
        visibleSnapshots.forEach((snapshot) => {
            [snapshot.sample_start_utc, snapshot.sample_end_utc, snapshot.requested_start_utc,
                snapshot.requested_end_utc, snapshot.fetched_at, snapshot.expires_at]
                .forEach((value) => points.push(parseTime(value)));
        });
        const validPoints = points.filter((value) => value !== null);
        if (validPoints.length === 0) return null;
        let start = Math.min(...validPoints);
        let end = Math.max(...validPoints);
        if (start === end) end = start + 60 * 60 * 1000;
        const padding = Math.max((end - start) * 0.04, 15 * 60 * 1000);
        return { snapshots: visibleSnapshots, start: start - padding, end: end + padding };
    }, [nowUtc, snapshots]);

    if (!model) return null;
    const width = 940;
    const left = 154;
    const right = 22;
    const top = 46;
    const rowHeight = 60;
    const plotBottom = top + model.snapshots.length * rowHeight;
    const axisLabelY = plotBottom + 24;
    const legendTop = plotBottom + 57;
    const height = plotBottom + 102;
    const plotWidth = width - left - right;
    const x = (value) => {
        const milliseconds = parseTime(value);
        return milliseconds === null ? null : left + ((milliseconds - model.start) / (model.end - model.start)) * plotWidth;
    };
    const nowX = x(nowUtc);
    const ticks = Array.from({ length: 5 }, (_, index) => model.start + ((model.end - model.start) * index) / 4);
    const handlePointerMove = (event) => {
        const bounds = event.currentTarget.getBoundingClientRect();
        if (!bounds.width || !bounds.height) return;
        const pointerX = ((event.clientX - bounds.left) / bounds.width) * width;
        const pointerY = ((event.clientY - bounds.top) / bounds.height) * height;
        if (pointerX < left || pointerX > width - right || pointerY < 20 || pointerY > plotBottom + 3) {
            setHoverIndicator(null);
            return;
        }
        const timestamp = model.start + ((pointerX - left) / plotWidth) * (model.end - model.start);
        setHoverIndicator({ x: pointerX, timestamp });
    };
    const hoverDate = hoverIndicator ? new Intl.DateTimeFormat(locale, {
        year: 'numeric', month: 'short', day: 'numeric', timeZone: timezone,
    }).format(new Date(hoverIndicator.timestamp)) : '';
    const hoverTime = hoverIndicator ? new Intl.DateTimeFormat(locale, {
        hour: '2-digit', minute: '2-digit', timeZone: timezone, timeZoneName: 'short',
    }).format(new Date(hoverIndicator.timestamp)) : '';
    const hoverLabelWidth = 174;
    const hoverLabelX = hoverIndicator
        ? Math.max(4, Math.min(hoverIndicator.x - hoverLabelWidth / 2, width - hoverLabelWidth - 4))
        : 0;

    return (
        <Box sx={{ overflowX: 'auto', border: 1, borderColor: 'divider', borderRadius: 1.5 }}>
            <Box component="svg" role="img" aria-label={t('admin.targets.vectors.timeline_aria')}
                viewBox={`0 0 ${width} ${height}`}
                onPointerMove={handlePointerMove}
                onPointerLeave={() => setHoverIndicator(null)}
                sx={{ display: 'block', width: '100%', minWidth: 720, height: 'auto', bgcolor: 'background.default' }}>
                {ticks.map((tick, index) => {
                    const tickX = left + (plotWidth * index) / 4;
                    return (
                        <g key={tick}>
                            <line x1={tickX} x2={tickX} y1={top - 10} y2={plotBottom + 3} stroke="currentColor" opacity="0.12" />
                            <text x={tickX} y={axisLabelY} textAnchor={index === 0 ? 'start' : index === 4 ? 'end' : 'middle'} fill="currentColor" opacity="0.7" fontSize="11">
                                {new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: timezone }).format(new Date(tick))}
                            </text>
                        </g>
                    );
                })}
                {model.snapshots.map((snapshot, index) => {
                    const y = top + index * rowHeight;
                    const coverageStart = x(snapshot.sample_start_utc);
                    const coverageEnd = x(snapshot.sample_end_utc);
                    const requestedStart = x(snapshot.requested_start_utc);
                    const requestedEnd = x(snapshot.requested_end_utc);
                    const fetchedAt = x(snapshot.fetched_at);
                    const expiresAt = x(snapshot.expires_at);
                    return (
                        <g key={snapshot.id}>
                            <rect x="0" y={y - 17} width={width} height={rowHeight} fill="currentColor" opacity={index % 2 ? 0.025 : 0} />
                            <text x="14" y={y + 1} fill="currentColor" fontSize="12" fontWeight="600">
                                {index === 0 ? t('admin.targets.vectors.latest') : t('admin.targets.vectors.snapshot_number', { number: index + 1 })}
                            </text>
                            <text x="14" y={y + 18} fill="currentColor" opacity="0.65" fontSize="10">{snapshot.sample_count} {t('admin.targets.vectors.samples')}</text>
                            <line x1={left} x2={width - right} y1={y} y2={y} stroke="currentColor" opacity="0.18" strokeWidth="2" />
                            {requestedStart !== null && requestedEnd !== null ? <rect
                                x={Math.min(requestedStart, requestedEnd)} y={y - 10}
                                width={Math.max(Math.abs(requestedEnd - requestedStart), 2)} height="20" rx="3"
                                fill="none" stroke="currentColor" opacity="0.5" strokeDasharray="5 4"
                            /> : null}
                            {coverageStart !== null && coverageEnd !== null ? <rect
                                x={Math.min(coverageStart, coverageEnd)} y={y - 6}
                                width={Math.max(Math.abs(coverageEnd - coverageStart), 3)} height="12" rx="6" fill="#1976d2"
                            /> : null}
                            {fetchedAt !== null && expiresAt !== null ? <line
                                x1={fetchedAt} x2={expiresAt} y1={y + 14} y2={y + 14}
                                stroke={snapshot.cache_fresh ? '#2e7d32' : '#ed6c02'} strokeWidth="5" strokeLinecap="round"
                            /> : null}
                            {fetchedAt !== null ? <circle cx={fetchedAt} cy={y + 14} r="4" fill="#7b1fa2"><title>{`${t('admin.targets.vectors.synced')}: ${formatTime(snapshot.fetched_at, timezone, locale)}`}</title></circle> : null}
                            {expiresAt !== null ? <path d={`M ${expiresAt - 4} ${y + 10} L ${expiresAt + 4} ${y + 18} M ${expiresAt + 4} ${y + 10} L ${expiresAt - 4} ${y + 18}`} stroke="#d32f2f" strokeWidth="2"><title>{`${t('admin.targets.vectors.expired')}: ${formatTime(snapshot.expires_at, timezone, locale)}`}</title></path> : null}
                        </g>
                    );
                })}
                {nowX !== null ? <g>
                    <line x1={nowX} x2={nowX} y1={20} y2={plotBottom + 3} stroke="#d32f2f" strokeWidth="2" />
                    <rect x={nowX - 19} y="4" width="38" height="17" rx="8" fill="#d32f2f" />
                    <text x={nowX} y="16" textAnchor="middle" fill="#fff" fontSize="10" fontWeight="700">{t('admin.targets.vectors.now')}</text>
                </g> : null}
                <line x1="14" x2={width - 14} y1={plotBottom + 39} y2={plotBottom + 39} stroke="currentColor" opacity="0.12" />
                <TimelineLegendItem offsetX={20} offsetY={legendTop} label={t('admin.targets.vectors.legend.samples')}>
                    <rect x="0" y="-6" width="28" height="12" rx="6" fill="#1976d2" />
                </TimelineLegendItem>
                <TimelineLegendItem offsetX={252} offsetY={legendTop} label={t('admin.targets.vectors.legend.requested')}>
                    <rect x="0" y="-10" width="28" height="20" rx="3" fill="none" stroke="currentColor" opacity="0.5" strokeDasharray="5 4" />
                </TimelineLegendItem>
                <TimelineLegendItem offsetX={510} offsetY={legendTop} label={t('admin.targets.vectors.legend.fresh_cache')}>
                    <line x1="1" x2="27" y1="0" y2="0" stroke="#2e7d32" strokeWidth="5" strokeLinecap="round" />
                </TimelineLegendItem>
                <TimelineLegendItem offsetX={738} offsetY={legendTop} label={t('admin.targets.vectors.legend.expired_cache')}>
                    <line x1="1" x2="27" y1="0" y2="0" stroke="#ed6c02" strokeWidth="5" strokeLinecap="round" />
                </TimelineLegendItem>
                <TimelineLegendItem offsetX={20} offsetY={legendTop + 27} label={t('admin.targets.vectors.legend.synchronized')}>
                    <circle cx="14" cy="0" r="4" fill="#7b1fa2" />
                </TimelineLegendItem>
                <TimelineLegendItem offsetX={252} offsetY={legendTop + 27} label={t('admin.targets.vectors.legend.current_time')}>
                    <line x1="14" x2="14" y1="-10" y2="10" stroke="#d32f2f" strokeWidth="2" />
                </TimelineLegendItem>
                <TimelineLegendItem offsetX={510} offsetY={legendTop + 27} label={t('admin.targets.vectors.legend.expiry')}>
                    <path d="M 10 -4 L 18 4 M 18 -4 L 10 4" stroke="#d32f2f" strokeWidth="2" />
                </TimelineLegendItem>
                {hoverIndicator ? <g pointerEvents="none">
                    <line
                        x1={hoverIndicator.x} x2={hoverIndicator.x} y1="20" y2={plotBottom + 3}
                        stroke="#0288d1" strokeWidth="1.5" strokeDasharray="4 3"
                    />
                    <rect x={hoverLabelX} y="2" width={hoverLabelWidth} height="38" rx="5" fill="#0288d1" />
                    <text x={hoverLabelX + hoverLabelWidth / 2} y="16" textAnchor="middle" fill="#fff" fontSize="11" fontWeight="700">{hoverDate}</text>
                    <text x={hoverLabelX + hoverLabelWidth / 2} y="31" textAnchor="middle" fill="#fff" fontSize="10">{hoverTime}</text>
                </g> : null}
            </Box>
        </Box>
    );
}

export default function VectorCoverageDialog({ open, target, socket, timezone, locale, onClose, onRefresh }) {
    const { t } = useTranslation('celestial');
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [pendingDelete, setPendingDelete] = useState(null);
    const [error, setError] = useState('');
    const requestIdRef = useRef(0);

    const loadHistory = useCallback(({ background = false } = {}) => new Promise((resolve) => {
        if (!open || !socket || !target?.targetKey) {
            resolve(false);
            return;
        }
        const requestId = requestIdRef.current + 1;
        requestIdRef.current = requestId;
        if (!background) setLoading(true);
        setError('');
        socket.emit('api.call', {
            cmd: 'get-celestial-vector-snapshot-history',
            data: {
                target_key: target.targetKey,
                limit: 24,
                past_hours: target.projectionPastHours,
                future_hours: target.projectionFutureHours,
                step_minutes: target.projectionStepMinutes,
            },
        }, (response) => {
            // A target can change while its Socket.IO acknowledgement is in
            // flight. Ignore late data instead of showing it under a new name.
            if (requestId !== requestIdRef.current) {
                resolve(false);
                return;
            }
            if (response?.success) setData(response.data);
            else setError(response?.error || t('admin.targets.vectors.load_failed'));
            if (!background) setLoading(false);
            resolve(Boolean(response?.success));
        });
    }), [
        open,
        socket,
        t,
        target?.targetKey,
        target?.projectionPastHours,
        target?.projectionFutureHours,
        target?.projectionStepMinutes,
    ]);

    useEffect(() => {
        if (open) {
            setData(null);
            void loadHistory();
        }
        return () => {
            requestIdRef.current += 1;
        };
    }, [loadHistory, open]);

    const handleRefresh = async () => {
        if (!onRefresh) return;
        setRefreshing(true);
        setError('');
        try {
            await onRefresh(target.id);
            await loadHistory({ background: true });
        } catch (refreshError) {
            setError(String(refreshError?.message || refreshError));
        } finally {
            setRefreshing(false);
        }
    };

    const handleDelete = async () => {
        if (!socket || !pendingDelete || !target?.targetKey) return;
        setDeleting(true);
        setError('');
        try {
            await new Promise((resolve, reject) => {
                const isSingleSnapshot = pendingDelete.kind === 'single';
                socket.emit('api.call', {
                    cmd: isSingleSnapshot
                        ? 'delete-celestial-vector-snapshot'
                        : 'clear-celestial-vector-snapshots',
                    data: isSingleSnapshot
                        ? {
                            target_key: target.targetKey,
                            snapshot_id: pendingDelete.snapshot.id,
                        }
                        : {
                            target_key: target.targetKey,
                            expired_only: pendingDelete.kind === 'expired',
                        },
                }, (response) => {
                    if (response?.success) resolve(response.data);
                    else reject(new Error(response?.error || t('admin.targets.vectors.delete_failed')));
                });
            });
            setPendingDelete(null);
            await loadHistory({ background: true });
        } catch (deleteError) {
            setPendingDelete(null);
            setError(String(deleteError?.message || deleteError));
        } finally {
            setDeleting(false);
        }
    };

    const snapshots = data?.snapshots || [];
    const latest = snapshots[0];
    const snapshotCount = Number(data?.snapshot_count ?? snapshots.length);
    const expiredSnapshotCount = Number(
        data?.expired_snapshot_count
        ?? snapshots.filter((snapshot) => !snapshot.cache_fresh).length,
    );
    const identifier = target?.targetType === 'body' ? target?.bodyId : target?.command;
    const confirmationTitle = pendingDelete?.kind === 'single'
        ? t('admin.targets.vectors.confirm_delete_title')
        : pendingDelete?.kind === 'expired'
            ? t('admin.targets.vectors.confirm_clear_expired_title')
            : t('admin.targets.vectors.confirm_clear_all_title');
    const confirmationMessage = pendingDelete?.kind === 'single'
        ? t('admin.targets.vectors.confirm_delete_message', {
            time: formatTime(pendingDelete.snapshot.fetched_at, timezone, locale),
        })
        : pendingDelete?.kind === 'expired'
            ? t('admin.targets.vectors.confirm_clear_expired_message', {
                count: expiredSnapshotCount,
                name: target?.displayName || target?.targetKey || '',
            })
            : t('admin.targets.vectors.confirm_clear_all_message', {
                count: snapshotCount,
                name: target?.displayName || target?.targetKey || '',
            });
    const confirmationAction = pendingDelete?.kind === 'single'
        ? t('admin.targets.vectors.delete_snapshot')
        : pendingDelete?.kind === 'expired'
            ? t('admin.targets.vectors.clear_expired')
            : t('admin.targets.vectors.clear_all');
    return (
        <>
        <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
            <DialogTitle sx={{ pb: 1 }}><Stack direction="row" spacing={1.25} alignItems="center">
                <TimelineIcon color="primary" />
                <Box><Typography variant="h6" component="div">{t('admin.targets.vectors.title', { name: target?.displayName || '' })}</Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>{target?.targetKey || '—'}</Typography></Box>
            </Stack></DialogTitle>
            <DialogContent dividers><Stack spacing={2.5}>
                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' }, gap: 1.5 }}>
                    <Box><Typography variant="caption" color="text.secondary">{t('admin.targets.vectors.target_type')}</Typography><Typography variant="body2">{t(`common.${target?.targetType}`, { defaultValue: target?.targetType || '—' })}</Typography></Box>
                    <Box><Typography variant="caption" color="text.secondary">{t('admin.targets.vectors.identifier')}</Typography><Typography variant="body2" sx={{ fontFamily: 'monospace' }}>{identifier || '—'}</Typography></Box>
                    <Box><Typography variant="caption" color="text.secondary">{t('admin.targets.vectors.server_time')}</Typography><Typography variant="body2">{formatTime(data?.now_utc, timezone, locale)}</Typography></Box>
                </Box>
                {loading ? <Stack alignItems="center" spacing={1} sx={{ py: 6 }}><CircularProgress size={32} /><Typography color="text.secondary">{t('common.loading')}</Typography></Stack> : null}
                {error ? <Alert severity="error" action={<CapsButton color="inherit" size="small" onClick={() => void loadHistory()}>{t('admin.targets.vectors.retry')}</CapsButton>}>{error}</Alert> : null}
                {!loading && !error && snapshots.length === 0 ? <Alert severity="info">{t('admin.targets.vectors.empty')}</Alert> : null}
                {!loading && latest ? <>
                    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4, 1fr)' }, gap: 1.25 }}>
                        <StatusCard icon={latest.vector_available ? <CheckCircleOutlineIcon /> : <ErrorOutlineIcon />} color={latest.vector_available ? 'success' : 'error'} label={t('admin.targets.vectors.available')} value={latest.vector_available ? t('common.yes') : t('common.no')} detail={latest.error || undefined} />
                        <StatusCard icon={<CachedIcon />} color={latest.cache_fresh ? 'success' : 'warning'} label={t('admin.targets.vectors.cache')} value={latest.cache_fresh ? t('admin.targets.vectors.fresh') : t('admin.targets.vectors.expired')} detail={formatTime(latest.expires_at, timezone, locale)} />
                        <StatusCard icon={<AccessTimeIcon />} color={latest.covers_now ? 'success' : 'error'} label={t('admin.targets.vectors.current_time_covered')} value={latest.covers_now ? t('common.yes') : t('common.no')} />
                        <StatusCard icon={<TimelineIcon />} color={latest.covers_projection_window ? 'success' : 'error'} label={t('admin.targets.vectors.requested_window_covered')} value={latest.covers_projection_window ? t('common.yes') : t('common.no')} detail={`-${latest.requested_past_hours}h / +${latest.requested_future_hours}h · ${latest.requested_step_minutes} min`} />
                    </Box>
                    {!latest.covers_now ? <Alert severity="error">{t('admin.targets.vectors.diagnosis.current_missing')}</Alert>
                        : !latest.covers_projection_window ? <Alert severity="warning">{t('admin.targets.vectors.diagnosis.window_short')}</Alert>
                            : !latest.cache_fresh ? <Alert severity="warning">{t('admin.targets.vectors.diagnosis.cache_expired')}</Alert>
                                : <Alert severity="success">{t('admin.targets.vectors.diagnosis.target_ready')}</Alert>}
                    <Box><Typography variant="subtitle1" fontWeight={700} gutterBottom>{t('admin.targets.vectors.timeline')}</Typography>
                        <VectorTimeline snapshots={snapshots} nowUtc={data.now_utc} timezone={timezone} locale={locale} t={t} />
                    </Box>
                    <Divider />
                    <Box><Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }} justifyContent="space-between" sx={{ mb: 1 }}>
                        <Typography variant="subtitle1" fontWeight={700}>{t('admin.targets.vectors.history', { count: snapshotCount })}</Typography>
                        <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                            <CapsButton
                                size="small"
                                variant="outlined"
                                startIcon={<DeleteSweepIcon />}
                                disabled={deleting || expiredSnapshotCount === 0}
                                onClick={() => setPendingDelete({ kind: 'expired' })}
                            >
                                {t('admin.targets.vectors.clear_expired')}
                            </CapsButton>
                            <CapsButton
                                size="small"
                                variant="outlined"
                                color="error"
                                startIcon={<DeleteOutlineIcon />}
                                disabled={deleting || snapshotCount === 0}
                                onClick={() => setPendingDelete({ kind: 'all' })}
                            >
                                {t('admin.targets.vectors.clear_all')}
                            </CapsButton>
                        </Stack>
                    </Stack>
                        <Stack spacing={1}>{snapshots.map((snapshot, index) => <Paper key={snapshot.id} variant="outlined" sx={{ p: 1.5 }}>
                            <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} justifyContent="space-between">
                                <Box><Typography variant="body2" fontWeight={700}>{index === 0 ? t('admin.targets.vectors.latest_snapshot') : formatTime(snapshot.epoch_bucket_utc, timezone, locale)}</Typography>
                                    <Typography variant="caption" color="text.secondary" display="block">{t('admin.targets.vectors.coverage')}: {formatTime(snapshot.sample_start_utc, timezone, locale)} → {formatTime(snapshot.sample_end_utc, timezone, locale)}</Typography>
                                    <Typography variant="caption" color="text.secondary" display="block">{t('admin.targets.vectors.required_window')}: {formatTime(snapshot.requested_start_utc, timezone, locale)} → {formatTime(snapshot.requested_end_utc, timezone, locale)}</Typography>
                                    <Typography variant="caption" color="text.secondary" display="block">{t('admin.targets.vectors.provider_envelope', { defaultValue: 'Provider envelope' })}: -{snapshot.past_hours}h / +{snapshot.future_hours}h · {snapshot.step_minutes} min</Typography></Box>
                                <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" alignItems="center">
                                    <Chip size="small" label={`${snapshot.sample_count} ${t('admin.targets.vectors.samples')}`} />
                                    <Chip size="small" color={snapshot.cache_fresh ? 'success' : 'warning'} label={snapshot.cache_fresh ? t('admin.targets.vectors.fresh') : t('admin.targets.vectors.expired')} />
                                    <Typography variant="caption" color="text.secondary">{t('admin.targets.vectors.synced')}: {formatTime(snapshot.fetched_at, timezone, locale)}</Typography>
                                    <Typography variant="caption" color="text.secondary">{t('admin.targets.vectors.cache_expiry')}: {formatTime(snapshot.expires_at, timezone, locale)}</Typography>
                                    <Tooltip title={t('admin.targets.vectors.delete_snapshot')}>
                                        <span>
                                            <IconButton
                                                size="small"
                                                color="error"
                                                aria-label={t('admin.targets.vectors.delete_snapshot')}
                                                disabled={deleting}
                                                onClick={() => setPendingDelete({ kind: 'single', snapshot })}
                                            >
                                                <DeleteOutlineIcon fontSize="small" />
                                            </IconButton>
                                        </span>
                                    </Tooltip>
                                </Stack>
                            </Stack>
                        </Paper>)}</Stack>
                    </Box>
                </> : null}
            </Stack></DialogContent>
            <DialogActions><CapsButton onClick={onClose}>{t('admin.targets.vectors.close')}</CapsButton>
                {onRefresh ? <CapsButton variant="contained" startIcon={refreshing ? <CircularProgress size={16} color="inherit" /> : <RefreshIcon />} disabled={!socket || refreshing || deleting} onClick={handleRefresh}>{t('admin.targets.actions.refresh')}</CapsButton> : null}
            </DialogActions>
        </Dialog>
        <Dialog open={Boolean(pendingDelete)} onClose={deleting ? undefined : () => setPendingDelete(null)} maxWidth="sm" fullWidth>
            <DialogTitle>{confirmationTitle}</DialogTitle>
            <DialogContent sx={{ pt: '12px !important' }}>
                <DialogContentText>{confirmationMessage}</DialogContentText>
            </DialogContent>
            <DialogActions>
                <CapsButton onClick={() => setPendingDelete(null)} disabled={deleting}>{t('admin.common.cancel')}</CapsButton>
                <CapsButton
                    variant="contained"
                    color="error"
                    startIcon={deleting ? <CircularProgress size={16} color="inherit" /> : <DeleteOutlineIcon />}
                    disabled={deleting}
                    onClick={() => void handleDelete()}
                >
                    {confirmationAction}
                </CapsButton>
            </DialogActions>
        </Dialog>
        </>
    );
}
