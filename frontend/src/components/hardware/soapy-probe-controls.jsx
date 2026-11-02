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


import {useCallback, useEffect, useRef, useState} from 'react';
import {Alert, Box, Button, CircularProgress, Stack, Typography} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import {useTranslation} from 'react-i18next';

export default function SoapyProbeControls({
    socket, values, discovering = false, onDiscover, onParameters, onProbingChange, selector,
    autoProbeRequest = null, onAutoProbeStarted,
}) {
    const {t} = useTranslation('hardware');
    const [probing, setProbing] = useState(false);
    const [error, setError] = useState('');
    const [result, setResult] = useState(null);
    const mounted = useRef(true);
    const pending = useRef(false);
    const lastAutoProbeRequest = useRef(null);
    const isRemote = values.type === 'soapysdrremote';
    const ready = Boolean(values.driver?.trim()) && (!isRemote || (
        Boolean(values.host?.trim()) && Number(values.port) >= 1 && Number(values.port) <= 65535
    ));

    useEffect(() => {
        mounted.current = true;
        // Strict Mode replays mount effects after an automatic probe starts.
        if (pending.current) onProbingChange?.(true);
        return () => {
            // Closing the dialog or changing device context discards late replies.
            mounted.current = false;
            onProbingChange?.(false);
        };
    }, [onProbingChange]);

    const probe = useCallback(async () => {
        if (!socket || pending.current || !ready) return;
        pending.current = true;
        setProbing(true);
        onProbingChange?.(true);
        setError('');
        setResult(null);
        try {
            const response = await new Promise((resolve, reject) => {
                socket.timeout(35000).emit('api.call', {
                    cmd: 'probe-sdr',
                    data: values,
                }, (timeoutError, reply) => {
                    if (timeoutError) reject(new Error(t('sdr.probe_timeout')));
                    else resolve(reply);
                });
            });
            if (!mounted.current) return;
            if (!response?.success) throw new Error(response?.error || t('sdr.probe_failed'));
            setResult(response);
            onParameters?.(response.data);
        } catch (failure) {
            if (mounted.current) setError(failure.message || t('sdr.probe_failed'));
        } finally {
            pending.current = false;
            if (mounted.current) {
                setProbing(false);
                onProbingChange?.(false);
            }
        }
    }, [socket, ready, values, t, onParameters, onProbingChange]);

    useEffect(() => {
        if (!autoProbeRequest || lastAutoProbeRequest.current === autoProbeRequest
            || discovering || !socket || !ready) return;
        // Consume each explicit device selection once, including during effect
        // replays. Errors stay visible for a manual retry instead of looping.
        lastAutoProbeRequest.current = autoProbeRequest;
        onAutoProbeStarted?.();
        void probe();
    }, [autoProbeRequest, discovering, socket, ready, probe, onAutoProbeStarted]);

    return (
        <Stack spacing={1}>
            <Stack direction="row" spacing={1} alignItems="center"
                   sx={{flexWrap: selector ? 'nowrap' : 'wrap', gap: 1}}>
                {selector && <Box sx={{flex: 1, minWidth: 0}}>{selector}</Box>}
                {isRemote && onDiscover && (
                    <Button size="small" variant="outlined" onClick={onDiscover}
                            disabled={!socket || discovering || probing} startIcon={<RefreshIcon/>}>
                        {discovering ? t('sdr.discovering_servers') : t('sdr.discover_servers')}
                    </Button>
                )}
                <Button size={selector ? 'medium' : 'small'} variant="outlined" onClick={probe}
                        disabled={!socket || !ready || discovering || probing}
                        sx={{flexShrink: 0, whiteSpace: 'nowrap', alignSelf: selector ? 'stretch' : undefined}}
                        startIcon={probing ? <CircularProgress size={16}/> : <RefreshIcon/>}>
                    {probing ? t('sdr.probing_selected') : t('sdr.probe_selected')}
                </Button>
            </Stack>
            <Typography variant="caption" color="text.secondary">{t('sdr.probe_help')}</Typography>
            {error && <Alert severity="error">{error}</Alert>}
            {result && (
                <Alert severity="success">
                    <Box>
                        <Typography variant="body2">
                            {result.cached ? t('sdr.probe_cached') : t('sdr.probe_complete')}
                        </Typography>
                        <Typography variant="caption" component="div">
                            {t('sdr.probe_summary', {
                                rates: result.data.sample_rate_values?.length || 0,
                                gains: result.data.gain_values?.length || 0,
                                rx: result.data.antennas?.rx?.join(', ') || '—',
                                tx: result.data.antennas?.tx?.join(', ') || '—',
                            })}
                        </Typography>
                    </Box>
                </Alert>
            )}
        </Stack>
    );
}
