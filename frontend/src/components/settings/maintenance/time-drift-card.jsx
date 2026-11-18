/**
 * @license
 * Copyright (c) 2025 Efstratios Goudelis
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {Alert,Box,Chip,Divider,Stack,Typography,} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import { useTranslation } from 'react-i18next';
import CapsButton from '../../common/capsbutton.jsx';
import { useUserTimeSettings } from '../../../hooks/useUserTimeSettings.jsx';
import { formatDateTime } from '../../../utils/date-time.js';
import { useSocket } from '../../common/socket.jsx';

const CLOCK_POLL_INTERVAL_MS = 10000;
const WARN_DRIFT_MS = 250;
const HIGH_DRIFT_MS = 1000;

const getSeverity = (absOffsetMs) => {
    if (absOffsetMs >= HIGH_DRIFT_MS) return 'error';
    if (absOffsetMs >= WARN_DRIFT_MS) return 'warning';
    return 'success';
};

const TimeDriftCard = () => {
    const { t } = useTranslation('settings');
    const { socket } = useSocket();
    const { timezone, locale } = useUserTimeSettings();
    const [tickNow, setTickNow] = useState(Date.now());
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [sample, setSample] = useState({
        offsetMs: 0,
        rttMs: null,
        sampledAtMs: null,
    });

    const sampleBackendClock = useCallback(async () => {
        setLoading(true);
        setError('');

        const requestStartMs = Date.now();
        try {
            if (!socket?.connected) {
                throw new Error('Socket is disconnected.');
            }
            const reply = await socket.timeout(5000).emitWithAck('api.call', {
                cmd: 'system.version',
                data: null,
            });
            const requestEndMs = Date.now();
            if (!reply?.success || !reply.data) {
                throw new Error(reply?.error || 'Version request failed.');
            }

            const payload = reply.data;
            const serverEpochMsRaw = Number(payload?.serverTimeEpochMs);
            const serverEpochMs = Number.isFinite(serverEpochMsRaw)
                ? serverEpochMsRaw
                : Number(new Date(payload?.serverTimeIsoUtc || '').getTime());

            if (!Number.isFinite(serverEpochMs)) {
                throw new Error('Missing server time in version response');
            }

            const midpointMs = (requestStartMs + requestEndMs) / 2;
            setSample({
                offsetMs: Math.round(serverEpochMs - midpointMs),
                rttMs: requestEndMs - requestStartMs,
                sampledAtMs: requestEndMs,
            });
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Unknown error');
        } finally {
            setLoading(false);
        }
    }, [socket]);

    useEffect(() => {
        if (!socket) return;
        if (socket.connected) sampleBackendClock();
        socket.on('connect', sampleBackendClock);
        const intervalId = setInterval(sampleBackendClock, CLOCK_POLL_INTERVAL_MS);
        return () => {
            socket.off('connect', sampleBackendClock);
            clearInterval(intervalId);
        };
    }, [sampleBackendClock, socket]);

    useEffect(() => {
        const tickId = setInterval(() => {
            setTickNow(Date.now());
        }, 1000);
        return () => clearInterval(tickId);
    }, []);

    const frontendDate = useMemo(() => new Date(tickNow), [tickNow]);
    const backendDate = useMemo(() => new Date(tickNow + sample.offsetMs), [tickNow, sample.offsetMs]);
    const absOffsetMs = Math.abs(sample.offsetMs);
    const severity = getSeverity(absOffsetMs);

    return (
        <>
            <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
                <Typography variant="h6">
                    {t('maintenance.time_drift_title', { defaultValue: 'Frontend vs Backend Time' })}
                </Typography>
                <CapsButton
                    variant="outlined"
                    size="small"
                    startIcon={<RefreshIcon />}
                    onClick={sampleBackendClock}
                    disabled={loading}
                >
                    {t('maintenance.time_drift_refresh', { defaultValue: 'Refresh' })}
                </CapsButton>
            </Stack>
            <Divider sx={{ mb: 2 }} />

            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                {t('maintenance.time_drift_subtitle', {
                    defaultValue: 'Compares browser time against backend server time using request midpoint estimation.',
                })}
            </Typography>

            {error && (
                <Alert severity="error" sx={{ mb: 2 }}>
                    {t('maintenance.time_drift_error', { defaultValue: 'Failed to sample backend time: {{error}}', error })}
                </Alert>
            )}

            <Stack spacing={1.25}>
                <Box>
                    <Typography variant="caption" color="text.secondary">
                        {t('maintenance.time_drift_frontend_label', { defaultValue: 'Frontend Time' })}
                    </Typography>
                    <Typography variant="body1" sx={{ fontFamily: 'monospace' }}>
                        {formatDateTime(frontendDate, { timezone, locale })}
                    </Typography>
                </Box>

                <Box>
                    <Typography variant="caption" color="text.secondary">
                        {t('maintenance.time_drift_backend_label', { defaultValue: 'Backend Time (estimated)' })}
                    </Typography>
                    <Typography variant="body1" sx={{ fontFamily: 'monospace' }}>
                        {formatDateTime(backendDate, { timezone, locale })}
                    </Typography>
                </Box>

                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                    <Chip
                        size="small"
                        color={severity}
                        label={t('maintenance.time_drift_delta_label', {
                            defaultValue: 'Drift: {{value}} ms',
                            value: sample.offsetMs,
                        })}
                    />
                    <Chip
                        size="small"
                        variant="outlined"
                        label={t('maintenance.time_drift_rtt_label', {
                            defaultValue: 'Round-trip: {{value}} ms',
                            value: sample.rttMs ?? '—',
                        })}
                    />
                    <Chip
                        size="small"
                        variant="outlined"
                        label={t('maintenance.time_drift_status_label', {
                            defaultValue: 'Status: {{status}}',
                            status: t(`maintenance.time_drift_status_${severity}`, {
                                defaultValue: severity,
                            }),
                        })}
                    />
                </Stack>

                <Typography variant="caption" color="text.secondary">
                    {t('maintenance.time_drift_last_sampled', {
                        defaultValue: 'Last sampled: {{time}}',
                        time: sample.sampledAtMs
                            ? formatDateTime(sample.sampledAtMs, { timezone, locale })
                            : '—',
                    })}
                </Typography>
            </Stack>
        </>
    );
};

export default TimeDriftCard;
