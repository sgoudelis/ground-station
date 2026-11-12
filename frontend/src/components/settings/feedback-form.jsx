/** Copyright (c) 2026 Efstratios Goudelis. SPDX-License-Identifier: GPL-3.0-or-later */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, Chip, CircularProgress, Stack, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useSocket } from '../common/socket.jsx';
import FeedbackDisclosure, { CENSUS_NOTICE_VERSION } from './feedback-disclosure.jsx';
import { SettingsSection, SettingsSurface } from './shared/index.js';

export default function FeedbackForm() {
    const { socket } = useSocket();
    const { t } = useTranslation('settings');
    const [status, setStatus] = useState(null);
    const [enabled, setEnabled] = useState(false);
    const [environment, setEnvironment] = useState('unknown');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [saved, setSaved] = useState(false);
    const request = useRef(0);

    const call = useCallback(async (cmd, data) => {
        if (!socket?.connected) throw new Error(t('feedback.connection_required'));
        const reply = await socket.timeout(45000).emitWithAck('api.call', { cmd, data });
        if (!reply?.success) throw new Error(reply?.error || t('feedback.request_failed'));
        return reply.data;
    }, [socket, t]);

    const load = useCallback(async () => {
        const id = ++request.current;
        setBusy(true);
        setError('');
        setSaved(false);
        try {
            const result = await call('feedback.get');
            if (id !== request.current) return;
            setStatus(result);
            setEnabled(result.enabled);
            setEnvironment(result.environment);
        } catch (failure) {
            if (id === request.current) setError(failure.message);
        } finally {
            if (id === request.current) setBusy(false);
        }
    }, [call]);

    useEffect(() => {
        load();
        // A reconnect reloads server consent, including changes by another admin.
        socket?.on('connect', load);
        return () => { request.current += 1; socket?.off('connect', load); };
    }, [socket, load]);

    const save = async () => {
        setBusy(true);
        setError('');
        setSaved(false);
        try {
            const result = await call('feedback.update', {
                enabled,
                environment,
                consent_notice_version: CENSUS_NOTICE_VERSION,
            });
            // Replace the draft only after persistence succeeds. The update
            // reply deliberately contains no credential or unsent hardware data.
            setStatus({ ...result, sample: status?.sample });
            setEnabled(result.enabled);
            setEnvironment(result.environment);
            setSaved(true);
        } catch (failure) {
            setError(failure.message);
        } finally {
            setBusy(false);
        }
    };

    const dirty = status && (enabled !== status.enabled || environment !== status.environment);
    const sample = status?.sample ? {
        ...status.sample,
        consent_notice_version: status.enabled ? status.accepted_notice_version : CENSUS_NOTICE_VERSION,
        installation_id: status.installation_id || status.sample.installation_id,
        deployment: { ...status.sample.deployment, environment },
    } : null;

    return (
        <SettingsSurface>
            <Stack spacing={2}>
                <Stack direction="row" justifyContent="space-between" alignItems="center">
                    <Chip label={t(status?.enabled ? 'feedback.enabled' : 'feedback.disabled')} color={status?.enabled ? 'success' : 'default'} />
                    <Button onClick={load} disabled={busy}>{t('feedback.refresh')}</Button>
                </Stack>
                {busy && <CircularProgress size={24} aria-label={t('feedback.loading')} />}
                {error && <Alert severity="error">{error}</Alert>}
                {saved && !dirty && <Alert severity="success">{t('feedback.saved')}</Alert>}
                {dirty && <Alert severity="warning">{t('feedback.unsaved')}</Alert>}
                {status?.storage_error && <Alert severity="error">{t('feedback.storage_error')}</Alert>}
                {status?.deletion_pending && <Alert severity="warning">{t('feedback.deletion_pending')}</Alert>}
                {status?.blocked && <Alert severity="warning">{t('feedback.blocked')}</Alert>}
                {status?.error && <Alert severity="warning">{status.error}</Alert>}
                {status?.preview_error && <Alert severity="warning">{status.preview_error}</Alert>}
                {status?.needs_consent_review && <Alert severity="info">{t('feedback.country_review')}</Alert>}

                <FeedbackDisclosure
                    enabled={enabled}
                    onChange={(value) => { setEnabled(value); setSaved(false); }}
                    environment={environment}
                    onEnvironmentChange={(value) => { setEnvironment(value); setSaved(false); }}
                    disabled={busy || !status || status.storage_error}
                    actions={(
                        <Box>
                            <Button variant="contained" onClick={save} disabled={busy || !status || status.storage_error || (!dirty && !status.blocked && !status.needs_consent_review)}>
                                {t('feedback.save')}
                            </Button>
                        </Box>
                    )}
                />
                {status && (
                    <SettingsSection title={t('feedback.status_title')}>
                        <Typography variant="body2">{t('feedback.last_report', { value: status.last_success_at ? new Date(status.last_success_at).toLocaleString() : t('feedback.never') })}</Typography>
                        {status.enabled && !status.blocked && <Typography variant="body2">{t('feedback.next_report', { value: status.next_attempt_at ? new Date(status.next_attempt_at * 1000).toLocaleString() : t('feedback.soon') })}</Typography>}
                        <Typography variant="body2">{t('feedback.refresh_help')}</Typography>
                    </SettingsSection>
                )}
                {sample && (
                    <SettingsSection title={t('feedback.preview_title')} description={t('feedback.preview_help')}>
                        <Box component="pre" sx={{ m: 0, p: 1.5, bgcolor: 'action.hover', overflowX: 'auto', fontSize: '0.8rem' }}>{JSON.stringify(sample, null, 2)}</Box>
                    </SettingsSection>
                )}
            </Stack>
        </SettingsSurface>
    );
}
