/**
 * @license
 * Copyright (c) 2026 Efstratios Goudelis
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

import * as React from 'react';
import {useCallback, useEffect, useMemo, useState} from 'react';
import {
    Alert,
    Box,
    Chip,
    CircularProgress,
    IconButton,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Tooltip,
    Typography,
} from '@mui/material';
import {alpha} from '@mui/material/styles';
import RefreshIcon from '@mui/icons-material/Refresh';
import {useSelector} from 'react-redux';
import {useTranslation} from 'react-i18next';
import {useSocket} from '../common/socket.jsx';
import {islandTitleBarCompactSx, TitleBar} from '../common/common.jsx';
import {formatDateTime} from '../../utils/date-time.js';

const normalizeForecastHours = (value) => {
    const hours = Number(value);
    return Number.isFinite(hours) && hours > 0 ? hours : 24;
};

const formatDuration = (pass, now = Date.now()) => {
    if (pass?.is_geostationary || pass?.is_geosynchronous) return '∞';
    if (!pass?.event_start || !pass?.event_end) return '—';

    const start = new Date(pass?.event_start).getTime();
    const end = new Date(pass?.event_end).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return '—';

    const seconds = Math.floor(((start <= now && now < end) ? end - now : end - start) / 1000);
    const minutes = Math.floor(seconds / 60);
    return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`;
};

const formatNumber = (value, digits, suffix) => {
    if (value == null || value === '') return '—';
    const number = Number(value);
    return Number.isFinite(number) ? `${number.toFixed(digits)}${suffix}` : '—';
};

const getPassStatus = (pass, now = Date.now()) => {
    if (pass?.status === 'dead') return 'dead';
    const start = new Date(pass?.event_start).getTime();
    const end = new Date(pass?.event_end).getTime();
    if (start <= now && end >= now) return 'live';
    if (end < now) return 'passed';
    return 'upcoming';
};

const getPassRowClassName = (pass, now = Date.now()) => {
    const status = getPassStatus(pass, now);
    const classes = [`satellite-pass-row`, `satellite-pass-${status}`];
    const startsAt = new Date(pass?.event_start).getTime();
    // Match Earth View's warning accent for passes starting within 30 minutes.
    if (status === 'upcoming' && startsAt - now <= 30 * 60 * 1000) {
        classes.push('satellite-pass-upcoming-soon');
    }
    return classes.join(' ');
};

const getPassStatusLabel = (status, tEarthView) => {
    const key = status === 'live' ? 'visible' : status;
    return tEarthView(`passes_table.status_${key}`, {defaultValue: key});
};

const passStatusColors = {
    live: 'success',
    upcoming: 'warning',
    passed: 'info',
    dead: 'error',
};

const passTagColors = {
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
};

const SatellitePasses = ({noradId, enabled = true}) => {
    const {t, i18n} = useTranslation('satellites');
    const {t: tEarthView} = useTranslation('earthview');
    const {socket} = useSocket();
    const configuredHours = useSelector((state) => state.targetSatTrack?.nextPassesHours);
    const timezone = useSelector((state) => {
        const timezonePreference = state.preferences?.preferences?.find((preference) => preference.name === 'timezone');
        return timezonePreference?.value || 'UTC';
    });
    const hours = normalizeForecastHours(configuredHours);
    const [passes, setPasses] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(false);
    const [refreshSequence, setRefreshSequence] = useState(0);
    const [nowMs, setNowMs] = useState(() => Date.now());

    useEffect(() => {
        if (!enabled) return undefined;
        // Keep status accents and progress bars aligned with the current pass window.
        const interval = setInterval(() => setNowMs(Date.now()), 1000);
        return () => clearInterval(interval);
    }, [enabled]);

    const requestPasses = useCallback((forceRecalculate = false) => {
        if (!enabled || !socket || noradId == null) return () => {};

        let cancelled = false;
        setLoading(true);
        setError(false);

        socket.emit('api.call', {
            cmd: 'fetch-next-passes',
            data: {
                norad_id: Number(noradId),
                hours,
                force_recalculate: forceRecalculate,
            },
        }, (response) => {
            if (cancelled) return;
            if (response?.success) {
                setPasses(Array.isArray(response.data) ? response.data : []);
                setError(false);
            } else {
                setPasses([]);
                setError(true);
            }
            setLoading(false);
        });

        return () => {
            cancelled = true;
        };
    }, [enabled, hours, noradId, socket]);

    useEffect(() => {
        if (!enabled) {
            setPasses([]);
            setLoading(false);
            setError(false);
            return undefined;
        }
        return requestPasses(refreshSequence > 0);
    }, [enabled, refreshSequence, requestPasses]);

    const dateTimeOptions = useMemo(() => ({
        timezone,
        locale: i18n.language,
        options: {
            dateStyle: 'medium',
            timeStyle: 'medium',
        },
    }), [i18n.language, timezone]);

    const handleRefresh = () => {
        setRefreshSequence((sequence) => sequence + 1);
    };

    return (
        <Box
            data-testid="satellite-future-passes"
            sx={{
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 0,
                bgcolor: 'background.paper',
                overflow: 'hidden',
            }}
        >
            <TitleBar sx={{...islandTitleBarCompactSx, px: 1.5, justifyContent: 'space-between'}}>
                <Typography variant="subtitle2" sx={{fontWeight: 700}}>
                    {t('satellite_info.future_passes.title', {hours})}
                </Typography>
                <Tooltip title={t('satellite_info.future_passes.refresh')}>
                    <span>
                        <IconButton
                            size="small"
                            aria-label={t('satellite_info.future_passes.refresh')}
                            disabled={loading || !enabled || noradId == null}
                            onClick={handleRefresh}
                        >
                            <RefreshIcon fontSize="small" />
                        </IconButton>
                    </span>
                </Tooltip>
            </TitleBar>

            {loading && passes.length === 0 && (
                <Box sx={{minHeight: 112, display: 'grid', placeItems: 'center'}}>
                    <CircularProgress size={28} aria-label={t('satellite_info.future_passes.loading')} />
                </Box>
            )}

            {!loading && error && (
                <Alert severity="error" sx={{borderRadius: 0}}>
                    {t('satellite_info.future_passes.error')}
                </Alert>
            )}

            {!loading && !error && passes.length === 0 && (
                <Box sx={{minHeight: 96, display: 'grid', placeItems: 'center', px: 2, textAlign: 'center'}}>
                    <Typography variant="body2" color="text.secondary">
                        {t('satellite_info.future_passes.empty', {hours})}
                    </Typography>
                </Box>
            )}

            {passes.length > 0 && (
                <TableContainer sx={(theme) => ({
                    maxHeight: 320,
                    borderTop: '1px solid',
                    borderColor: 'divider',
                    '& .MuiTable-root': {
                        minWidth: {xs: '100%', md: 1080},
                        tableLayout: 'auto',
                    },
                    '& .MuiTableCell-root': {
                        px: 1,
                        py: 0.75,
                    },
                    '& .MuiTableCell-head': {
                        backgroundColor: theme.palette.background.titleBar || theme.palette.background.elevated,
                        color: theme.palette.text.secondary,
                        fontSize: '0.68rem',
                        fontWeight: 700,
                        letterSpacing: '0.04em',
                        textTransform: 'uppercase',
                        borderBottom: `1px solid ${theme.palette.divider}`,
                        whiteSpace: 'nowrap',
                    },
                    '& .MuiTableCell-body': {
                        fontSize: '0.75rem',
                        borderBottom: `1px solid ${theme.palette.divider}`,
                    },
                    '& .satellite-pass-row > .MuiTableCell-root:first-of-type': {
                        borderLeft: '3px solid transparent',
                    },
                    '& .satellite-pass-row:nth-of-type(even)': {
                        backgroundColor: theme.palette.action.hover,
                    },
                    '& .satellite-pass-row:hover': {
                        backgroundColor: theme.palette.action.selected,
                    },
                    '& .satellite-pass-live': {
                        backgroundColor: alpha(theme.palette.success.main, theme.palette.mode === 'dark' ? 0.2 : 0.1),
                    },
                    '& .satellite-pass-live > .MuiTableCell-root:first-of-type': {
                        borderLeftColor: alpha(theme.palette.success.main, 0.8),
                    },
                    '& .satellite-pass-row.satellite-pass-live:hover': {
                        backgroundColor: alpha(theme.palette.success.main, theme.palette.mode === 'dark' ? 0.27 : 0.14),
                    },
                    '& .satellite-pass-row.satellite-pass-upcoming-soon': {
                        backgroundColor: alpha(theme.palette.warning.main, theme.palette.mode === 'dark' ? 0.14 : 0.08),
                    },
                    '& .satellite-pass-upcoming-soon > .MuiTableCell-root:first-of-type': {
                        borderLeftColor: alpha(theme.palette.warning.main, 0.7),
                    },
                    '& .satellite-pass-passed .MuiTableCell-body': {
                        color: theme.palette.text.secondary,
                    },
                    '& .satellite-pass-row.satellite-pass-dead': {
                        backgroundColor: alpha(theme.palette.error.main, theme.palette.mode === 'dark' ? 0.24 : 0.1),
                    },
                    '& .satellite-pass-dead > .MuiTableCell-root:first-of-type': {
                        borderLeftColor: alpha(theme.palette.error.main, 0.75),
                    },
                })}>
                    <Table stickyHeader size="small" aria-label={t('satellite_info.future_passes.table_label')}>
                        <TableHead>
                            <TableRow>
                                <TableCell width={120}>{tEarthView('satellites_table.status')}</TableCell>
                                <TableCell align="center">{tEarthView('passes_table.peak_elevation')}</TableCell>
                                <TableCell align="center" sx={{display: {xs: 'none', md: 'table-cell'}}}>
                                    {tEarthView('passes_table.duration')}
                                </TableCell>
                                <TableCell sx={{display: {xs: 'none', md: 'table-cell'}}}>
                                    {tEarthView('passes_table.pass_types')}
                                </TableCell>
                                <TableCell>{tEarthView('passes_table.start')}</TableCell>
                                <TableCell sx={{display: {xs: 'none', md: 'table-cell'}}}>
                                    {tEarthView('passes_table.end')}
                                </TableCell>
                                <TableCell align="center" sx={{display: {xs: 'none', md: 'table-cell'}}}>
                                    AOS
                                </TableCell>
                                <TableCell align="center" sx={{display: {xs: 'none', md: 'table-cell'}}}>
                                    LOS
                                </TableCell>
                                <TableCell align="center" sx={{display: {xs: 'none', md: 'table-cell'}}}>
                                    Peak
                                </TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {passes.map((pass, index) => {
                                const status = getPassStatus(pass, nowMs);
                                const statusColor = passStatusColors[status] || 'info';
                                return (
                                    <TableRow key={pass.id ?? `${pass.event_start}-${index}`} hover className={getPassRowClassName(pass, nowMs)}>
                                        <TableCell sx={{whiteSpace: 'nowrap'}}>
                                            <Chip
                                                size="small"
                                                color={statusColor}
                                                variant={status === 'upcoming' ? 'outlined' : 'filled'}
                                                label={getPassStatusLabel(status, tEarthView)}
                                                sx={{height: 20, fontSize: '0.65rem', fontWeight: 700}}
                                            />
                                        </TableCell>
                                        <TableCell align="center" sx={{whiteSpace: 'nowrap'}}>
                                            {formatNumber(pass.peak_altitude, 2, '°')}
                                        </TableCell>
                                        <TableCell align="center" sx={{display: {xs: 'none', md: 'table-cell'}, whiteSpace: 'nowrap'}}>
                                            {formatDuration(pass, nowMs)}
                                        </TableCell>
                                        <TableCell sx={{display: {xs: 'none', md: 'table-cell'}, maxWidth: 240}}>
                                            <Box sx={{display: 'flex', alignItems: 'center', gap: 0.5, overflow: 'hidden', whiteSpace: 'nowrap'}}>
                                                {(Array.isArray(pass.pass_tags) ? pass.pass_tags : [])
                                                    .filter((tag) => tag && tag !== 'elevation_medium')
                                                    .map((tag) => (
                                                        <Tooltip key={tag} title={tEarthView(`passes_table.pass_tag_tooltips.${tag}`, {defaultValue: tag})}>
                                                            <Chip
                                                                size="small"
                                                                label={tEarthView(`passes_table.pass_tag_labels.${tag}`, {defaultValue: tag})}
                                                                sx={{
                                                                    height: 20,
                                                                    flexShrink: 0,
                                                                    fontSize: '0.64rem',
                                                                    fontWeight: 700,
                                                                    bgcolor: passTagColors[tag] || 'text.secondary',
                                                                    color: 'common.white',
                                                                    '& .MuiChip-label': {px: 0.7},
                                                                }}
                                                            />
                                                        </Tooltip>
                                                    ))}
                                                {(!Array.isArray(pass.pass_tags) || pass.pass_tags.length === 0) && (
                                                    <Typography variant="caption" color="text.secondary">—</Typography>
                                                )}
                                            </Box>
                                        </TableCell>
                                        <TableCell sx={{whiteSpace: 'nowrap'}}>
                                            {formatDateTime(pass.event_start, dateTimeOptions) || '—'}
                                        </TableCell>
                                        <TableCell sx={{display: {xs: 'none', md: 'table-cell'}, whiteSpace: 'nowrap'}}>
                                            {formatDateTime(pass.event_end, dateTimeOptions) || '—'}
                                        </TableCell>
                                        {[pass.distance_at_start, pass.distance_at_end, pass.distance_at_peak].map((distance, distanceIndex) => (
                                            <TableCell
                                                key={`${pass.id ?? pass.event_start}-distance-${distanceIndex}`}
                                                align="center"
                                                sx={{display: {xs: 'none', md: 'table-cell'}, whiteSpace: 'nowrap'}}
                                            >
                                                {formatNumber(distance, 2, ' km')}
                                            </TableCell>
                                        ))}
                                    </TableRow>
                                );
                            })}
                        </TableBody>
                    </Table>
                </TableContainer>
            )}
        </Box>
    );
};

export default SatellitePasses;
